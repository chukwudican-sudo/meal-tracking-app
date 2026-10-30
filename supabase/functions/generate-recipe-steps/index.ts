// generate-recipe-steps — Custom Recipe "unlock full recipe" backend.
//
// Second stage of the Custom Recipe flow. The user has already seen a concept
// preview (name + description + rough macros from generate-recipe-concept) and
// now wants the full recipe: an ingredient list and numbered steps. Concepts
// aren't stored server-side, so the client resends the concept fields as the
// target to build around.
//
// Entitlement here is DIFFERENT from the scan-pool functions: unlocking the
// full recipe is a subscription-only feature. Non-subscribers are always
// rejected with `not_premium` (402) — the free-scan pool does NOT apply and is
// never consumed by this function. `not_premium` triggers the standard paywall
// in the app.
//
// Same auth + rate limit + Gemini plumbing as the other AI functions, composed
// from ../_shared/. The Gemini key lives ONLY as a Supabase secret.
//
// Deploy with:
//   supabase functions deploy generate-recipe-steps

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { isEntitled } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';
import { recordAiEvent, sanitizeFlowId } from '../_shared/aiEvents.ts';
import {
  buildHardConstraints,
  buildUserContext,
  type ProfileContext,
} from '../_shared/mealPromptHelpers.ts';

const GEMINI_MODEL = 'gemini-3.6-flash';

const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_WINDOW_LABEL = 'hour';
const GEMINI_TIMEOUT_MS = 20000; // heavier output (ingredients + numbered steps)
const MAX_NAME_LEN = 120;
const MAX_DESCRIPTION_LEN = 500;
const FUNCTION_NAME = 'generate-recipe-steps';
// Bump on any prompt/schema change so ai_events can compare versions.
const PROMPT_VERSION = 'steps-2026-10-30';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
type MealType = (typeof MEAL_TYPES)[number];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
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
  required: ['ingredients', 'steps'],
};

interface ConceptInput {
  name: string;
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  mealType: MealType | null;
  // The recipe's existing ingredient list (from the concept / a Fix). When
  // present, the steps are written from exactly these and the list is
  // returned unchanged — the user already saw and approved it.
  ingredients: { name: string; quantity: number; unit: string }[];
}

const MAX_INGREDIENTS = 40;

function sanitizeMealType(raw: unknown): MealType | null {
  return typeof raw === 'string' && (MEAL_TYPES as readonly string[]).includes(raw)
    ? (raw as MealType)
    : null;
}

// Coerce the untrusted client-sent concept into a clean, bounded shape. Returns
// null if unusable (missing name).
function sanitizeConcept(raw: unknown): ConceptInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;

  const name = typeof d.name === 'string' ? d.name.trim().slice(0, MAX_NAME_LEN) : '';
  if (!name) return null;

  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  return {
    name,
    description: typeof d.description === 'string' ? d.description.trim().slice(0, MAX_DESCRIPTION_LEN) : '',
    calories: Math.round(num(d.calories)),
    protein: num(d.protein),
    carbs: num(d.carbs),
    fats: num(d.fats),
    mealType: sanitizeMealType(d.mealType),
    ingredients: (Array.isArray(d.ingredients) ? d.ingredients.slice(0, MAX_INGREDIENTS) : [])
      .map(i => {
        const o = (i ?? {}) as Record<string, unknown>;
        const iName = typeof o.name === 'string' ? o.name.trim().slice(0, MAX_NAME_LEN) : '';
        const q = Number(o.quantity);
        return iName
          // Same fallback as the app (ai/aiEdgeClient mapRecipeIngredients).
          ? { name: iName, quantity: Number.isFinite(q) && q >= 0 && q <= 100000 ? q : 1, unit: typeof o.unit === 'string' ? o.unit.slice(0, 40) : '' }
          : null;
      })
      .filter((i): i is { name: string; quantity: number; unit: string } => i !== null),
  };
}

function buildPrompt(
  concept: ConceptInput,
  p: ProfileContext,
): { system: string; userText: string } {
  const userContext = buildUserContext(p);
  const hardConstraints = buildHardConstraints(p, []);

  const system =
    'You are a recipe-writing assistant. Given a recipe concept (name, short ' +
    'description, and a per-serving macro target the user has already seen), ' +
    'return the full recipe: a concrete ingredient list (each with a name, ' +
    'quantity, and unit) and clear numbered cooking steps. Keep the recipe ' +
    'consistent with the macro target you are given — the calories and ' +
    'protein/carbs/fats should roughly match what the user already saw, so do ' +
    'not silently redesign it into a different dish. Use exactly the foods the ' +
    'concept names; add only what is needed to cook it the way described (e.g. ' +
    'a cooking oil to pan-fry, water to boil). For savory cooked dishes list ' +
    'salt and black pepper with a starting amount, named "Salt (to taste)" and ' +
    '"Black pepper (to taste)"; never add them to sweet or no-cook dishes. Any ' +
    'other addition (herbs, spices, sauces, garnishes) must end its name with ' +
    '" (optional)" and is not counted in the macro target. In the steps, refer ' +
    'to seasonings plainly ("season with salt and pepper", "add the garlic ' +
    'powder if using") without repeating their amounts or labels. Use grams ' +
    '(g) or millilitres (ml) for food amounts; tsp/tbsp only for small ' +
    'seasonings and oils. Give every cooking temperature in both units, e.g. ' +
    '"74°C / 165°F" or "200°C / 400°F". Allergies and dietary preferences are ' +
    'HARD constraints you must never violate. Respond with JSON only, matching ' +
    'the provided schema.';

  const conceptJson = JSON.stringify({
    name: concept.name,
    description: concept.description,
    calories: concept.calories,
    protein: concept.protein,
    carbs: concept.carbs,
    fats: concept.fats,
    mealType: concept.mealType,
    ...(concept.ingredients.length ? { ingredients: concept.ingredients } : {}),
  });

  const parts = [
    userContext ? `User context: ${userContext}` : '',
    hardConstraints ? `Hard constraints (must always respect, no exceptions): ${hardConstraints}` : '',
    concept.ingredients.length
      ? 'The ingredient list is final: write the steps using exactly these ingredients and amounts, ' +
        'add nothing, and return the list unchanged.'
      : '',
    `Recipe concept to build ingredients + steps for:\n${conceptJson}`,
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

  let concept: ConceptInput | null = null;
  let flowId: string | null = null;
  try {
    const body = await req.json();
    concept = sanitizeConcept(body);
    flowId = sanitizeFlowId(body?.flow_id);
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }
  if (!concept) return errorResponse('invalid_input', 'A valid recipe concept is required', 400);

  // Load the authoritative profile row (never trust client-sent entitlement)
  // and check the rate limit together — both only depend on user.id, so
  // there's no reason to pay for two sequential DB round-trips.
  const [profileResult, rateLimitResult] = await Promise.all([
    admin
      .from('users')
      .select('subscription_status, dietary_preferences, allergies')
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

  // Entitlement gate — subscription-only. Unlike the scan-pool functions there
  // is NO free-scan fallback: non-subscribers are always rejected regardless of
  // free_scans_remaining, and this function never consumes a free scan.
  if (!isEntitled(profileRow.subscription_status)) {
    return errorResponse(
      'not_premium',
      'Unlock the full recipe (ingredients + steps) with Premium.',
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
      `You've reached the hourly limit for full recipes. Try again in an ${RATE_WINDOW_LABEL}.`,
      429,
    );
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
    goal_type: null,
    daily_calorie_target: null,
  };

  const { system, userText } = buildPrompt(concept, profile);

  const startedAt = Date.now();
  const event = { userId: user.id, functionName: FUNCTION_NAME, promptVersion: PROMPT_VERSION, flowId, startedAt, input: { concept } };

  let result: unknown;
  try {
    result = await callGeminiJSON({
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
        ? 'The AI took too long to write the full recipe. Please try again.'
        : 'Could not generate the full recipe. Please try again.';
    return errorResponse('ai_failed', message, 502);
  }

  // Log usage only after success. No consumeFreeScan here — this function is
  // subscription-only and never touches the free-scan pool. Fire-and-forget:
  // it's bookkeeping, so don't block the response on the write.
  // Code enforces what the prompt asks: a recipe that arrived with
  // ingredients keeps exactly those (the model only writes the steps).
  if (concept.ingredients.length && result && typeof result === 'object') {
    result = { ...(result as Record<string, unknown>), ingredients: concept.ingredients };
  }

  void logAiUsage(admin, user.id, FUNCTION_NAME);
  recordAiEvent(admin, { ...event, success: true, output: result });

  return jsonResponse(result, 200);
});
