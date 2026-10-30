// fix-recipe — AI correction of a full recipe (ingredients + steps + macros).
//
// Takes the current recipe, the user's correction and their earlier
// corrections to the same recipe, and returns the complete corrected recipe:
// only what the correction addresses changes. Same auth + entitlement
// (free-scan pool / Pro) + rate limit + Gemini plumbing as fix-meal, composed
// from ../_shared/. Recipes carry no per-ingredient nutrition, so the model
// re-estimates the per-serving totals itself.
//
// Deploy with:
//   supabase functions deploy fix-recipe

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';
import { recordAiEvent, sanitizeFlowId } from '../_shared/aiEvents.ts';

// Kept in lockstep with the other recipe functions.
const GEMINI_MODEL = 'gemini-3.6-flash';

const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_FIX_TEXT_LEN = 1000;
const MAX_HISTORY = 10;
const MAX_INGREDIENTS = 40;
const MAX_STEPS = 30;
const MAX_STEP_LEN = 600;
// Writing a whole recipe takes longer than a meal fix. Default (medium)
// thinking on purpose: recipes need consistent amounts, steps and macros
// (Oct 29 decision — 'low' is for the simple scan/fix-meal tasks).
const GEMINI_TIMEOUT_MS = 25000;
const FUNCTION_NAME = 'fix-recipe';
// Bump on any prompt/schema change so ai_events can compare versions.
const PROMPT_VERSION = 'fix-recipe-2026-10-30';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    calories: { type: 'integer' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fats: { type: 'number' },
    cook_time_minutes: { type: 'integer' },
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
    steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'calories', 'protein', 'carbs', 'fats', 'ingredients', 'steps'],
};

interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
}

interface RecipeInput {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  cook_time_minutes: number | null;
  ingredients: RecipeIngredient[];
  steps: string[];
}

interface ProfileContext {
  dietary_preferences: string[];
  allergies: string[];
}

const num = (v: unknown, max = 100000): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : 0;
};
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// A recipe beyond the limits is refused, never trimmed: the fixed result
// replaces the saved recipe, so trimming would silently drop content.
function exceedsLimits(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  const ings = Array.isArray(r.ingredients) ? r.ingredients : [];
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const badQty = ings.some(i => {
    const q = Number((i as Record<string, unknown> | null)?.quantity);
    return Number.isFinite(q) && (q < 0 || q > 100000);
  });
  return badQty
    || ings.length > MAX_INGREDIENTS
    || steps.length > MAX_STEPS
    || steps.some(s => typeof s === 'string' && s.length > MAX_STEP_LEN);
}

// Client data is untrusted: bound every field before it reaches the model.
function sanitizeRecipe(raw: unknown): RecipeInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = text(r.name, 120);
  if (!name) return null;
  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients.slice(0, MAX_INGREDIENTS) : [])
    .map((i): RecipeIngredient | null => {
      if (!i || typeof i !== 'object') return null;
      const ing = i as Record<string, unknown>;
      const iName = text(ing.name, 120);
      if (!iName) return null;
      return { name: iName, quantity: num(ing.quantity, 100000), unit: text(ing.unit, 40) };
    })
    .filter((i): i is RecipeIngredient => i !== null);
  const steps = (Array.isArray(r.steps) ? r.steps.slice(0, MAX_STEPS) : [])
    .map(s => text(s, MAX_STEP_LEN))
    .filter(Boolean);
  const cook = num(r.cook_time_minutes, 1440);
  return {
    name,
    calories: Math.round(num(r.calories, 10000)),
    protein: num(r.protein, 1000),
    carbs: num(r.carbs, 1000),
    fats: num(r.fats, 1000),
    cook_time_minutes: cook > 0 ? Math.round(cook) : null,
    ingredients,
    steps,
  };
}

function sanitizeHistory(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(h => text(h, MAX_FIX_TEXT_LEN))
    .filter(Boolean)
    .slice(-MAX_HISTORY);
}

// The model's output is untrusted too: same bounds as the input, and a
// result that lost its ingredients or steps is rejected rather than saved.
function sanitizeResult(raw: unknown, before: RecipeInput): RecipeInput | null {
  const r = sanitizeRecipe(raw);
  if (!r || r.ingredients.length === 0) return null;
  if (before.steps.length > 0 && r.steps.length === 0) return null;
  // No steps yet: a Fix changes ingredients/macros only. Steps are written
  // later from the final ingredients (generate-recipe-steps, Pro).
  if (before.steps.length === 0) return { ...r, steps: [], cook_time_minutes: r.cook_time_minutes ?? before.cook_time_minutes };
  return { ...r, cook_time_minutes: r.cook_time_minutes ?? before.cook_time_minutes };
}

function buildPrompt(
  fixText: string,
  recipe: RecipeInput,
  p: ProfileContext,
  history: string[],
): { system: string; userText: string } {
  const context = [
    p.dietary_preferences.length ? `Dietary preferences: ${p.dietary_preferences.join(', ')}.` : '',
    p.allergies.length ? `Allergies: ${p.allergies.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const system =
    'You are a recipe correction assistant. You are given a recipe (as JSON) ' +
    'and a correction the user typed. Apply the correction and return the ' +
    'COMPLETE corrected recipe in the same structure — not a diff. Change only ' +
    'what the correction addresses (an ingredient, an amount, a cooking ' +
    'method, a step); keep every other ingredient, amount and step exactly as ' +
    'given. If the recipe has no steps, return an empty steps list. Update any ' +
    'steps that mention a changed ingredient, amount, time or ' +
    'temperature so they stay consistent. Re-estimate the per-serving calories ' +
    'and macros (grams) for the corrected recipe; if nothing that affects ' +
    'nutrition changed, return the same numbers. Keep the recipe name. Earlier ' +
    'corrections, when given, are ' +
    'already applied — keep them. Never add ingredients, details or claims the ' +
    'user did not ask for. Keep the existing conventions: grams (g) or ' +
    'millilitres (ml) for food, tsp/tbsp only for seasonings and oils, ' +
    'temperatures as "°C / °F". Allergies and dietary preferences are HARD ' +
    'constraints you must never violate. Respond with JSON only, matching the ' +
    'provided schema.';

  const earlier = history.length
    ? `Earlier corrections (already applied, oldest first):\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\n`
    : '';
  const base = `Current recipe:\n${JSON.stringify(recipe)}\n\n${earlier}User correction:\n${fixText}`;
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

  let fixText = '';
  let recipe: RecipeInput | null = null;
  let history: string[] = [];
  let flowId: string | null = null;
  try {
    const body = await req.json();
    flowId = sanitizeFlowId(body?.flow_id);
    fixText = typeof body?.fixText === 'string' ? body.fixText.trim() : '';
    if (exceedsLimits(body?.recipe)) {
      return errorResponse('invalid_input', 'This recipe is too long to fix automatically.', 400);
    }
    recipe = sanitizeRecipe(body?.recipe);
    history = sanitizeHistory(body?.history);
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }
  if (!fixText) return errorResponse('invalid_input', 'A correction is required', 400);
  if (fixText.length > MAX_FIX_TEXT_LEN) return errorResponse('invalid_input', 'Correction is too long', 400);
  if (!recipe) return errorResponse('invalid_input', 'A valid recipe is required', 400);

  // Authoritative profile row (never trust client-sent entitlement) + rate
  // limit, in parallel.
  const [profileResult, rateLimitResult] = await Promise.all([
    admin
      .from('users')
      .select('subscription_status, free_scans_remaining, dietary_preferences, allergies')
      .eq('id', user.id)
      .single(),
    isRateLimited(admin, user.id, FUNCTION_NAME, RATE_LIMIT, RATE_WINDOW_MS).catch((e) => {
      console.error(`${LOG_PREFIX} rate limit check failed:`, e);
      return null;
    }),
  ]);

  const { data: profileRow, error: profileErr } = profileResult;
  if (profileErr || !profileRow) return errorResponse('ai_failed', 'Could not load your profile', 500);

  // Gate cost, not features: subscribers unlimited, others spend a free scan
  // (consumed only on success, below).
  const entitlement = resolveEntitlement(profileRow.subscription_status, profileRow.free_scans_remaining);
  if (!entitlement.allowed) {
    return errorResponse(
      'not_premium',
      "You've used all your free AI scans. Upgrade to Premium for unlimited access.",
      402,
    );
  }
  if (rateLimitResult === null) return errorResponse('ai_failed', 'Could not check usage', 500);
  if (rateLimitResult) {
    return errorResponse('rate_limited', "You've reached the hourly limit for AI corrections. Try again later.", 429);
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
  };
  const { system, userText } = buildPrompt(fixText, recipe, profile, history);

  const startedAt = Date.now();
  const event = {
    userId: user.id,
    functionName: FUNCTION_NAME,
    promptVersion: PROMPT_VERSION,
    flowId,
    startedAt,
    input: { fixText, history, before: recipe },
  };

  let raw: unknown;
  try {
    raw = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: RESPONSE_SCHEMA,
      timeoutMs: GEMINI_TIMEOUT_MS,
      logPrefix: LOG_PREFIX,
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    recordAiEvent(admin, { ...event, success: false, errorCode: e instanceof GeminiTimeoutError ? 'timeout' : 'ai_failed' });
    const message =
      e instanceof GeminiTimeoutError
        ? 'The AI took too long to update this recipe. Please try again.'
        : 'Could not update this recipe. Please try again.';
    return errorResponse('ai_failed', message, 502);
  }

  const result = sanitizeResult(raw, recipe);
  if (!result) {
    recordAiEvent(admin, { ...event, success: false, errorCode: 'bad_output', output: { ai: raw } });
    return errorResponse('ai_failed', 'Could not update this recipe. Please try again.', 502);
  }

  // Charge only after success (failures never burn quota or free scans).
  void logAiUsage(admin, user.id, FUNCTION_NAME);
  recordAiEvent(admin, { ...event, success: true, output: result });
  if (!entitlement.isSubscriber) {
    await consumeFreeScan(admin, user.id);
  }

  return jsonResponse(result, 200);
});
