// generate-recipe-concept — Custom Recipe preview backend (cheap first stage).
//
// Takes the user's freeform recipe description (from the Custom Recipe screen)
// and returns a lightweight concept: a name, a short description, and a rough
// macro estimate — NO ingredient list and NO steps. That fuller content is a
// separate, subscription-gated call (generate-recipe-steps). This stage is
// meant to be freely triable within the existing free-tier allowance, so it
// uses the same free-scan-pool entitlement as the other scan-pool AI features.
//
// Same auth + entitlement (including free scans) + rate limit + Gemini plumbing
// as the other AI functions, composed from ../_shared/.
//
// The Gemini key lives ONLY as a Supabase secret (GEMINI_API_KEY) and never
// touches the client bundle. Set it with:
//   supabase secrets set GEMINI_API_KEY=<key>
//
// Deploy with:
//   supabase functions deploy generate-recipe-concept

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';
import {
  buildHardConstraints,
  buildUserContext,
  type ProfileContext,
} from '../_shared/mealPromptHelpers.ts';

// Single, easily-changeable model handle. Kept in lockstep with the other AI
// functions — see estimate-nutrition's comment for why gemini-3.6-flash.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Independent bucket from the other AI functions (keyed by this function_name
// in ai_usage_log).
const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_DESCRIPTION_LEN = 500;
const FUNCTION_NAME = 'generate-recipe-concept';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

// A lightweight concept preview — name, short description, and a rough macro
// estimate. No ingredients / steps (those are generate-recipe-steps' job).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    calories: { type: 'integer' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fats: { type: 'number' },
  },
  required: ['name', 'description', 'calories', 'protein', 'carbs', 'fats'],
};

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
type MealType = (typeof MEAL_TYPES)[number];

function sanitizeMealType(raw: unknown): MealType | null {
  return typeof raw === 'string' && (MEAL_TYPES as readonly string[]).includes(raw)
    ? (raw as MealType)
    : null;
}

function buildPrompt(
  description: string,
  mealType: MealType | null,
  p: ProfileContext,
): { system: string; userText: string } {
  const userContext = buildUserContext(p);
  const hardConstraints = buildHardConstraints(p, []);

  const system =
    'You are a recipe-concept assistant. Given a freeform description of a ' +
    'recipe the user wants, return a lightweight PREVIEW concept only: a clear, ' +
    'accurately-named recipe (based only on what the user actually described — ' +
    'do not invent a cuisine style, sauce, or flavor descriptor the user did not ' +
    'mention or clearly imply), a one- or two-sentence description, and a rough ' +
    'per-serving macro estimate (calories + protein/carbs/fats in grams). Do ' +
    'NOT return an ingredient list or cooking steps — those come later. Keep ' +
    'the estimate realistic for a single serving. Allergies and dietary ' +
    'preferences are HARD constraints you must never violate. Respond with JSON ' +
    'only, matching the provided schema.';

  const parts = [
    userContext ? `User context: ${userContext}` : '',
    hardConstraints ? `Hard constraints (must always respect, no exceptions): ${hardConstraints}` : '',
    mealType ? `Meal type: ${mealType}.` : '',
    `Recipe description:\n${description}`,
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

  let description = '';
  let mealType: MealType | null = null;
  try {
    const body = await req.json();
    description = typeof body?.description === 'string' ? body.description.trim() : '';
    mealType = sanitizeMealType(body?.mealType);
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }
  if (!description) return errorResponse('invalid_input', 'A recipe description is required', 400);
  if (description.length > MAX_DESCRIPTION_LEN) {
    return errorResponse('invalid_input', 'Description is too long', 400);
  }

  // Load the authoritative profile row (never trust client-sent entitlement)
  // and check the rate limit together — both only depend on user.id, so
  // there's no reason to pay for two sequential DB round-trips.
  const [profileResult, rateLimitResult] = await Promise.all([
    admin
      .from('users')
      .select('subscription_status, free_scans_remaining, dietary_preferences, allergies, goal_type')
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
  // scan (consumed only on success, below). not_premium triggers the paywall.
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
      "You've reached the hourly limit for recipe ideas. Try again later.",
      429,
    );
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
    goal_type: profileRow.goal_type ?? null,
    daily_calorie_target: null,
  };

  const { system, userText } = buildPrompt(description, mealType, profile);

  let result: unknown;
  try {
    result = await callGeminiJSON({
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
        ? 'The AI took too long to sketch your recipe. Please try again.'
        : 'Could not generate a recipe concept. Please try again.';
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
