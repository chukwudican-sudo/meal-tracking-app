// suggest-kitchen-recipes — "What Can I Make" backend (Phase 3, feature 5).
//
// Takes the caller's kitchen inventory (ingredient names) and returns ~10 full
// recipe suggestions that maximize use of what they already have. Same auth +
// entitlement (including free scans) + rate limit + Gemini plumbing as the
// other AI functions, composed from ../_shared/.
//
// The Gemini key lives ONLY as a Supabase secret (GEMINI_API_KEY) and never
// touches the client bundle. Set it with:
//   supabase secrets set GEMINI_API_KEY=<key>
//
// Deploy with:
//   supabase functions deploy suggest-kitchen-recipes

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';

// Single, easily-changeable model handle. Kept in lockstep with
// estimate-nutrition — see that file's comment for why gemini-3.6-flash.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Independent bucket from the other AI functions (keyed by this function_name
// in ai_usage_log).
const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;

const MAX_KITCHEN_ITEMS = 60;
const MAX_ITEM_NAME_LEN = 60;
const SUGGESTION_COUNT = 10;
// One call returns ~10 full recipes with steps — more output than the other
// text-only functions, so give Gemini a bit more headroom.
const GEMINI_TIMEOUT_MS = 25000;
const FUNCTION_NAME = 'suggest-kitchen-recipes';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;

// Structured-output schema — a batch of full recipes so tapping a card is
// instant (no second AI call). Per-ingredient calories/macros omitted: the
// concept screen never displays them.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: MEAL_TYPES },
          calories: { type: 'integer' },
          cookTimeMin: { type: 'integer' },
          difficulty: { type: 'string', enum: DIFFICULTIES },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fats: { type: 'number' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                quantity: { type: 'number' },
                unit: { type: 'string' },
              },
              required: ['name', 'quantity', 'unit'],
            },
          },
          steps: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'name', 'category', 'calories', 'cookTimeMin', 'difficulty',
          'protein', 'carbs', 'fats', 'ingredients', 'steps',
        ],
      },
    },
  },
  required: ['suggestions'],
};

interface ProfileContext {
  dietary_preferences: string[];
  allergies: string[];
  goal_type: string | null;
  daily_calorie_target: number | null;
}

function sanitizeKitchenItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.slice(0, MAX_KITCHEN_ITEMS)) {
    const name = typeof item === 'string' ? item.trim().slice(0, MAX_ITEM_NAME_LEN) : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function buildPrompt(
  kitchenItems: string[],
  p: ProfileContext,
): { system: string; userText: string } {
  const context = [
    p.dietary_preferences.length ? `Dietary preferences: ${p.dietary_preferences.join(', ')}.` : '',
    p.allergies.length ? `Allergies (must never include these): ${p.allergies.join(', ')}.` : '',
    p.goal_type ? `Goal: ${p.goal_type}.` : '',
    p.daily_calorie_target ? `Daily calorie target: ${p.daily_calorie_target} kcal.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const system =
    `You are a home-cooking recipe suggestion assistant. Given a list of ` +
    `ingredients the user already has in their kitchen, generate exactly ` +
    `${SUGGESTION_COUNT} distinct, practical recipes that maximize use of those ` +
    `ingredients. Missing pantry staples (oil, salt, pepper, water) are fine; ` +
    `minimize other missing items. Respect dietary preferences and NEVER include ` +
    `allergens. Vary meal categories (Breakfast, Lunch, Dinner, Snacks), cook ` +
    `times, and difficulty. Each recipe needs a short name, category, calorie ` +
    `estimate for one serving, cookTimeMin, difficulty (Easy/Medium/Hard), ` +
    `macros (protein/carbs/fats in grams), an ingredients list with quantity ` +
    `and unit, and clear numbered cooking steps. Respond with JSON only, ` +
    `matching the provided schema.`;

  const base =
    `Kitchen ingredients:\n${kitchenItems.map(i => `- ${i}`).join('\n')}\n\n` +
    `Suggest ${SUGGESTION_COUNT} recipes.`;
  const userText = context ? `User context: ${context}\n\n${base}` : base;

  return { system, userText };
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse('invalid_input', 'Method not allowed', 405);

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return errorResponse('ai_failed', 'AI provider not configured', 500);

  const admin = createAdminClient();
  if (!admin) return errorResponse('ai_failed', 'Server not configured', 500);

  const user = await getAuthedUser(req, admin);
  if (!user) return errorResponse('unauthorized', 'Not signed in', 401);

  let kitchenItems: string[] = [];
  try {
    const body = await req.json();
    kitchenItems = sanitizeKitchenItems(body?.kitchenItems);
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }
  if (kitchenItems.length === 0) {
    return errorResponse('invalid_input', 'At least one kitchen item is required', 400);
  }

  // Load the authoritative profile row (never trust client-sent entitlement)
  // and check the rate limit together — both only depend on user.id, so
  // there's no reason to pay for two sequential DB round-trips.
  const [profileResult, rateLimitResult] = await Promise.all([
    admin
      .from('users')
      .select(
        'subscription_status, free_scans_remaining, dietary_preferences, allergies, ' +
          'goal_type, daily_calorie_target',
      )
      .eq('id', user.id)
      .single(),
    isRateLimited(admin, user.id, FUNCTION_NAME, RATE_LIMIT, RATE_WINDOW_MS).catch((e) => {
      console.error(`${LOG_PREFIX} rate limit check failed:`, e);
      return null;
    }),
  ]);

  const { data: profileRow, error: profileErr } = profileResult;
  if (profileErr || !profileRow) {
    return errorResponse('ai_failed', 'Could not load your profile', 500);
  }

  // Entitlement gate: subscribers are unlimited; everyone else spends a free
  // scan (consumed only on success, below). The app uses not_premium to trigger
  // the paywall.
  const entitlement = resolveEntitlement(profileRow.subscription_status, profileRow.free_scans_remaining);
  if (!entitlement.allowed) {
    return errorResponse(
      'not_premium',
      "You've used all your free AI scans. Upgrade to Premium for unlimited access.",
      402,
    );
  }

  // null means the rate-limit check itself errored (caught above).
  if (rateLimitResult === null) {
    return errorResponse('ai_failed', 'Could not check usage', 500);
  }
  if (rateLimitResult) {
    return errorResponse(
      'rate_limited',
      "You've reached the hourly limit for recipe suggestions. Try again later.",
      429,
    );
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
    goal_type: profileRow.goal_type ?? null,
    daily_calorie_target: profileRow.daily_calorie_target ?? null,
  };

  const { system, userText } = buildPrompt(kitchenItems, profile);

  let result: unknown;
  try {
    result = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: RESPONSE_SCHEMA,
      logPrefix: LOG_PREFIX,
      timeoutMs: GEMINI_TIMEOUT_MS,
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    const message =
      e instanceof GeminiTimeoutError
        ? 'The AI took too long to suggest recipes. Please try again.'
        : 'Could not suggest recipes from your kitchen. Please try again.';
    return errorResponse('ai_failed', message, 502);
  }

  // Only charge the call (rate-limit log + free scan) once it succeeded, so our
  // own failures/timeouts don't burn the user's quota or free scans.
  // Usage logging is fire-and-forget bookkeeping — don't block the response on
  // it. consumeFreeScan stays awaited: it's the atomic guard enforcing the
  // free-scan limit and must register before we respond.
  void logAiUsage(admin, user.id, FUNCTION_NAME);
  if (!entitlement.isSubscriber) {
    await consumeFreeScan(admin, user.id);
  }

  return jsonResponse(result, 200);
});
