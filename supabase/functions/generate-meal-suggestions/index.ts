// generate-meal-suggestions — "Build My Plan" backend (Phase 3, feature 6).
//
// Given a meal type (Breakfast/Lunch/Dinner/Snacks), a requested count, and the
// user's Build My Plan onboarding answers (cuisines, cook time, foods loved,
// foods to avoid), returns that many distinct meal suggestions personalised to
// the caller's profile. Used at two seams in the wizard: the "Describe what you
// want" flow (count 1, with a free-text description) and as a top-up when the
// static catalog pool for a slot is exhausted (count = the Suggest-more batch).
//
// Same auth + entitlement (including free scans) + rate limit + Gemini plumbing
// as the other AI functions, composed from ../_shared/.
//
// The Gemini key lives ONLY as a Supabase secret (GEMINI_API_KEY) and never
// touches the client bundle. Set it with:
//   supabase secrets set GEMINI_API_KEY=<key>
//
// Deploy with:
//   supabase functions deploy generate-meal-suggestions

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';
import {
  buildHardConstraints,
  buildRatioInstruction,
  buildStyleCues,
  buildUserContext,
  DIFFICULTIES,
  type CookTime,
  type ProfileContext,
  sanitizeCookTime,
  sanitizeStringList,
} from '../_shared/mealPromptHelpers.ts';

// Single, easily-changeable model handle. Kept in lockstep with
// estimate-nutrition — see that file's comment for why gemini-3.6-flash.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Independent bucket from the other AI functions (keyed by this function_name
// in ai_usage_log).
const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
type MealType = (typeof MEAL_TYPES)[number];

const MIN_COUNT = 1;
const MAX_COUNT = 8;
const MAX_DESCRIPTION_LEN = 200;
// A batch of short recipes (1-8) with steps — lighter than suggest-kitchen's
// 10-recipe payload, so a slightly shorter Gemini ceiling is plenty.
const GEMINI_TIMEOUT_MS = 20000;
const FUNCTION_NAME = 'generate-meal-suggestions';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

// Structured-output schema. Built per-request so `category` is locked to the
// single requested meal type (the wizard scopes each call to one slot), which
// guarantees consistency without any client-side re-mapping. Per-ingredient
// calories/macros omitted: the plan cards never display them.
function buildResponseSchema(mealType: MealType): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: [mealType] },
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
}

interface RequestPrefs {
  cuisines: string[];
  cookTime: CookTime | null;
  loves: string[];
  avoid: string[];
  description: string | null;
}

function sanitizeCount(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return MIN_COUNT;
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, n));
}

function buildPrompt(
  mealType: MealType,
  count: number,
  prefs: RequestPrefs,
  p: ProfileContext,
): { system: string; userText: string } {
  const userContext = buildUserContext(p);
  const hardConstraints = buildHardConstraints(p, prefs.avoid);
  const styleCues = buildStyleCues(prefs.cuisines, prefs.loves, prefs.cookTime);

  const system =
    `You are a meal-planning assistant. Generate exactly ${count} distinct, ` +
    `practical ${mealType} idea${count === 1 ? '' : 's'} personalised to the ` +
    `user. Allergies, the user's avoid list, and dietary preferences are HARD ` +
    `constraints you must never violate — never include allergens, never ` +
    `include anything on the avoid list, and always respect dietary ` +
    `restrictions, no exceptions. Cuisines and loved foods are light flavor ` +
    `cues for variety only, not requirements — most suggestions should be ` +
    `genuinely varied, general, traditional dishes across different culinary ` +
    `styles rather than repeatedly leaning into the same cuisine or loved ` +
    `foods. Cook time preference carries almost no weight — only use it as ` +
    `a barely-perceptible tie-breaker between otherwise equally-suitable ` +
    `options; it should never visibly steer which meals get selected. Each ` +
    `suggestion needs a short name, a calorie estimate for one serving, ` +
    `cookTimeMin, difficulty (Easy/Medium/Hard), macros (protein/carbs/fats in ` +
    `grams), an ingredients list with quantity and unit, and clear numbered ` +
    `cooking steps. Vary the suggestions so they are meaningfully different ` +
    `from one another. Respond with JSON only, matching the provided schema.`;

  const parts = [
    userContext ? `User context: ${userContext}` : '',
    hardConstraints ? `Hard constraints (must always respect, no exceptions): ${hardConstraints}` : '',
    styleCues ? `Style cues (light variety flavor only, not requirements): ${styleCues}` : '',
    // Ratio guidance only makes sense for a multi-suggestion batch with no
    // description — a Describe call is always count 1 and handled below.
    !prefs.description && count > 1 && (prefs.cuisines.length > 0 || prefs.loves.length > 0)
      ? buildRatioInstruction(count)
      : '',
    prefs.description
      ? `The user specifically described what they want: "${prefs.description}". ` +
        `Follow this description closely — it is the dominant instruction. The ` +
        `style cues above (cuisines, loved foods) only apply if they don't ` +
        `conflict with the description; drop them entirely if they would. The ` +
        `hard constraints above (allergies, avoid list, dietary preferences) ` +
        `still always apply, no matter what the description says.`
      : '',
    `Generate ${count} ${mealType} suggestion${count === 1 ? '' : 's'}.`,
  ].filter(Boolean);

  return { system, userText: parts.join('\n\n') };
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

  let mealType: MealType;
  let count: number;
  let prefs: RequestPrefs;
  try {
    const body = await req.json();
    const rawMealType = typeof body?.mealType === 'string' ? body.mealType : '';
    if (!(MEAL_TYPES as readonly string[]).includes(rawMealType)) {
      return errorResponse('invalid_input', 'A valid meal type is required', 400);
    }
    mealType = rawMealType as MealType;
    count = sanitizeCount(body?.count);
    const description =
      typeof body?.description === 'string'
        ? body.description.trim().slice(0, MAX_DESCRIPTION_LEN) || null
        : null;
    prefs = {
      cuisines: sanitizeStringList(body?.cuisines),
      cookTime: sanitizeCookTime(body?.cookTime),
      loves: sanitizeStringList(body?.loves),
      avoid: sanitizeStringList(body?.avoid),
      description,
    };
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
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
      "You've reached the hourly limit for meal suggestions. Try again later.",
      429,
    );
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
    goal_type: profileRow.goal_type ?? null,
    daily_calorie_target: profileRow.daily_calorie_target ?? null,
  };

  const { system, userText } = buildPrompt(mealType, count, prefs, profile);

  let result: unknown;
  try {
    result = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: buildResponseSchema(mealType),
      logPrefix: LOG_PREFIX,
      timeoutMs: GEMINI_TIMEOUT_MS,
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    const message =
      e instanceof GeminiTimeoutError
        ? 'The AI took too long to suggest meals. Please try again.'
        : 'Could not generate meal suggestions. Please try again.';
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
