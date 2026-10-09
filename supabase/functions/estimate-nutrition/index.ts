// estimate-nutrition — AI Describe backend (Phase 3 pilot).
//
// Takes a free-text meal description, checks the caller is authenticated and
// entitled (subscription_status in 'active'/'trial'), enforces a 30-calls/hour
// per-user rate limit via ai_usage_log, then asks Gemini for a structured
// nutrition estimate and returns clean JSON.
//
// The Gemini key lives ONLY as a Supabase secret (GEMINI_API_KEY) and never
// touches the client bundle. Set it with:
//   supabase secrets set GEMINI_API_KEY=<key>
//
// Deploy with:
//   supabase functions deploy estimate-nutrition
//
// Shared auth/entitlement/rate-limit/Gemini-call plumbing lives in
// ../_shared/ — reuse it for future AI functions instead of duplicating.

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';

// Single, easily-changeable model handle. Pinned to gemini-3.6-flash —
// gemini-2.5-flash was dropped after hitting "This model ... is no longer
// available to new users" (404), a known recurring Google-side config bug
// (their AI developer forum, 2026-07) that specifically hits newly-rotated
// API keys on older models, not a real availability/capacity issue.
// gemini-3.6-flash is the Stable-tier model Google's own deprecations page
// (ai.google.dev/gemini-api/docs/deprecations) lists as the recommended
// replacement for gemini-2.5-flash, so it sidesteps that whole bug class.
// Alternatives: 'gemini-flash-latest' (floating alias, always newest Flash)
// or 'gemini-3.1-flash-lite' (cheaper, less reasoning).
const GEMINI_MODEL = 'gemini-3.6-flash';

const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_DESCRIPTION_LEN = 2000;
const FUNCTION_NAME = 'estimate-nutrition';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;

// Structured-output schema so Gemini returns parseable JSON, not prose.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    meal_name: { type: 'string' },
    description: { type: 'string' },
    calories: { type: 'integer' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fats: { type: 'number' },
    meal_type: { type: 'string', enum: MEAL_TYPES },
    health_rating: { type: 'integer' }, // 1 (poor) .. 10 (excellent)
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          calories: { type: 'integer' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fats: { type: 'number' },
        },
        required: ['name', 'quantity', 'unit', 'calories', 'protein', 'carbs', 'fats'],
      },
    },
  },
  required: [
    'meal_name', 'description', 'calories', 'protein', 'carbs', 'fats',
    'meal_type', 'health_rating', 'ingredients',
  ],
};

interface ProfileContext {
  dietary_preferences: string[];
  allergies: string[];
  goal_type: string | null;
  daily_calorie_target: number | null;
  protein_target_grams: number | null;
  carbs_target_grams: number | null;
  fats_target_grams: number | null;
}

function buildPrompt(description: string, p: ProfileContext): { system: string; userText: string } {
  const context = [
    p.dietary_preferences.length ? `Dietary preferences: ${p.dietary_preferences.join(', ')}.` : '',
    p.allergies.length ? `Allergies: ${p.allergies.join(', ')}.` : '',
    p.goal_type ? `Goal: ${p.goal_type}.` : '',
    p.daily_calorie_target ? `Daily calorie target: ${p.daily_calorie_target} kcal.` : '',
    p.protein_target_grams ? `Protein target: ${p.protein_target_grams} g.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const system =
    'You are a nutrition estimation assistant. Given a free-text description of ' +
    'a meal, estimate its nutrition as accurately as possible for a single ' +
    'serving as described. Break the meal into its component ingredients with ' +
    'per-ingredient calories and macros that sum close to the meal totals. ' +
    'Pick the closest meal_type from Breakfast, Lunch, Dinner, Snacks. ' +
    'health_rating is an integer 1 (very unhealthy) to 10 (very healthy) based ' +
    'on nutritional quality. Use the user context only to inform reasonable ' +
    'assumptions; never invent ingredients the user did not describe. Respond ' +
    'with JSON only, matching the provided schema.';

  const userText = context
    ? `User context: ${context}\n\nMeal description: ${description}`
    : `Meal description: ${description}`;

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

  let description = '';
  try {
    const body = await req.json();
    description = typeof body?.description === 'string' ? body.description.trim() : '';
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }
  if (!description) return errorResponse('invalid_input', 'A meal description is required', 400);
  if (description.length > MAX_DESCRIPTION_LEN) {
    return errorResponse('invalid_input', 'Description is too long', 400);
  }

  // Load the authoritative profile row (never trust client-sent entitlement)
  // and check the rate limit together — both only depend on user.id, so
  // there's no reason to pay for two sequential DB round-trips.
  const [profileResult, rateLimitResult] = await Promise.all([
    admin
      .from('users')
      .select(
        'subscription_status, free_scans_remaining, dietary_preferences, allergies, goal_type, ' +
          'daily_calorie_target, protein_target_grams, carbs_target_grams, fats_target_grams',
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
    return errorResponse('rate_limited', "You've reached the hourly limit for AI estimates. Try again later.", 429);
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
    goal_type: profileRow.goal_type ?? null,
    daily_calorie_target: profileRow.daily_calorie_target ?? null,
    protein_target_grams: profileRow.protein_target_grams ?? null,
    carbs_target_grams: profileRow.carbs_target_grams ?? null,
    fats_target_grams: profileRow.fats_target_grams ?? null,
  };

  const { system, userText } = buildPrompt(description, profile);

  let estimate: unknown;
  try {
    estimate = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: RESPONSE_SCHEMA,
      logPrefix: LOG_PREFIX,
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    const message =
      e instanceof GeminiTimeoutError
        ? 'The AI estimator took too long to respond. Please try again.'
        : 'Could not estimate this meal. Please try again.';
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

  return jsonResponse(estimate, 200);
});
