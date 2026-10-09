// generate-plan-shortlist — redesigned "Build My Plan" backend.
//
// One call returns a small, curated shortlist of meal ideas per requested meal
// type (e.g. 4 Breakfast, 4 Lunch, 4 Dinner, 2 Snacks), personalised to the
// user's picked protein/carb/fat preferences (the primary signal) plus the
// optional secondary preferences carried over from the old wizard (cuisines,
// loved foods, cook time, foods to avoid) and their profile goal/dietary/
// allergy data. The user then picks favourites from each shortlist and plain
// app logic distributes them across the 7-day week — no further AI needed.
//
// Used at two seams: the initial generation (all active meal types at once) and
// the per-type "Generate more" top-up (a single meal type, smaller count). Both
// are one Gemini round-trip and cost exactly one scan.
//
// Same auth + entitlement (including free scans) + rate limit + Gemini plumbing
// as the other AI functions, composed from ../_shared/. Prompt/sanitization
// helpers are shared with generate-meal-suggestions via ../_shared/
// mealPromptHelpers.ts so the hard-constraint / style-cue logic never drifts.
//
// The Gemini key lives ONLY as a Supabase secret (GEMINI_API_KEY) and never
// touches the client bundle. Set it with:
//   supabase secrets set GEMINI_API_KEY=<key>
//
// Deploy with:
//   supabase functions deploy generate-plan-shortlist

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';
import {
  buildHardConstraints,
  buildStyleCues,
  buildUserContext,
  CARB_FAMILIES,
  expandFamilyPicks,
  PROTEIN_FAMILIES,
  DIFFICULTIES,
  type CookTime,
  type ProfileContext,
  sanitizeCookTime,
  sanitizeStringList,
} from '../_shared/mealPromptHelpers.ts';

// Single, easily-changeable model handle. Kept in lockstep with the other AI
// functions — see estimate-nutrition's comment for why gemini-3.6-flash.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Independent bucket from the other AI functions (keyed by this function_name
// in ai_usage_log).
const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
type MealType = (typeof MEAL_TYPES)[number];

// Default shortlist sizes: mains get a handful, snacks a couple. Overridable
// per type by the client (used by "Generate more" to request a smaller top-up
// batch for a single type).
const DEFAULT_COUNTS: Record<MealType, number> = {
  Breakfast: 4,
  Lunch: 4,
  Dinner: 4,
  Snacks: 2,
};
const MIN_PER_TYPE = 1;
const MAX_PER_TYPE = 6;
const MAX_MACRO_ITEMS = 15;

// A shortlist across up to 4 meal types (~14 short recipes with steps) is the
// heaviest payload of the meal functions, so use the same generous ceiling as
// suggest-kitchen-recipes rather than the lighter 20s used for single-slot
// suggestions.
const GEMINI_TIMEOUT_MS = 25000;
const FUNCTION_NAME = 'generate-plan-shortlist';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

interface RequestPrefs {
  proteins: string[];
  carbs: string[];
  fats: string[];
  cuisines: string[];
  cookTime: CookTime | null;
  loves: string[];
  avoid: string[];
}

// The per-item shape mirrors generate-meal-suggestions exactly, minus the
// `category` field — here the meal type is implied by which shortlist key the
// item lives under, so the client stamps it rather than the model.
function suggestionItemSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
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
      'name', 'calories', 'cookTimeMin', 'difficulty',
      'protein', 'carbs', 'fats', 'ingredients', 'steps',
    ],
  };
}

// Structured-output schema, built per request so `shortlist` has exactly one
// array key per requested meal type, each sized to its requested count.
function buildResponseSchema(
  types: MealType[],
  counts: Record<MealType, number>,
): Record<string, unknown> {
  const item = suggestionItemSchema();
  const properties: Record<string, unknown> = {};
  for (const t of types) {
    properties[t] = { type: 'array', minItems: counts[t], maxItems: counts[t], items: item };
  }
  return {
    type: 'object',
    properties: {
      shortlist: { type: 'object', properties, required: types },
    },
    required: ['shortlist'],
  };
}

function sanitizeMealTypes(raw: unknown): MealType[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MealType[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!(MEAL_TYPES as readonly string[]).includes(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item as MealType);
  }
  return out;
}

// Resolve the per-type count for each requested type: an explicit, in-range
// client override wins; otherwise the type's default. Silently clamped, never
// rejected (mirrors sanitizeCount in generate-meal-suggestions).
function resolveCounts(types: MealType[], rawOverride: unknown): Record<MealType, number> {
  const override = (rawOverride && typeof rawOverride === 'object')
    ? rawOverride as Record<string, unknown>
    : {};
  const counts = {} as Record<MealType, number>;
  for (const t of types) {
    const n = Math.round(Number(override[t]));
    counts[t] = Number.isFinite(n)
      ? Math.max(MIN_PER_TYPE, Math.min(MAX_PER_TYPE, n))
      : DEFAULT_COUNTS[t];
  }
  return counts;
}

interface MacroExpansions {
  proteins: { directPicks: string[]; expansions: string[] };
  carbs: { directPicks: string[]; expansions: string[] };
}

function buildMacroPrefs(prefs: RequestPrefs, exp: MacroExpansions): string {
  const parts: string[] = [];

  if (exp.proteins.directPicks.length) {
    parts.push(`Preferred proteins: ${exp.proteins.directPicks.join(', ')}.`);
  }
  for (const e of exp.proteins.expansions) parts.push(e);

  if (exp.carbs.directPicks.length) {
    parts.push(`Preferred carbs: ${exp.carbs.directPicks.join(', ')}.`);
  }
  for (const e of exp.carbs.expansions) parts.push(e);

  if (prefs.fats.length) {
    parts.push(`Preferred fats: ${prefs.fats.join(', ')}.`);
  }

  return parts.join(' ');
}

function buildPrompt(
  types: MealType[],
  counts: Record<MealType, number>,
  prefs: RequestPrefs,
  p: ProfileContext,
): { system: string; userText: string } {
  const userContext = buildUserContext(p);
  const hardConstraints = buildHardConstraints(p, prefs.avoid);
  const macroExp: MacroExpansions = {
    proteins: expandFamilyPicks(prefs.proteins, PROTEIN_FAMILIES),
    carbs: expandFamilyPicks(prefs.carbs, CARB_FAMILIES),
  };
  const macroPrefs = buildMacroPrefs(prefs, macroExp);
  const styleCues = buildStyleCues(prefs.cuisines, prefs.loves, prefs.cookTime);
  const hasStyleCues = prefs.cuisines.length > 0 || prefs.loves.length > 0;
  const hasExpansions =
    macroExp.proteins.expansions.length > 0 || macroExp.carbs.expansions.length > 0;

  const system =
    `You are a meal-planning assistant building a personalised shortlist of ` +
    `meal ideas. For each requested meal type, generate the requested number of ` +
    `distinct, practical options. The user's preferred proteins, carbs, and ` +
    `fats are the PRIMARY personalisation signal: build most options around ` +
    `those ingredients where it makes culinary sense, while still keeping the ` +
    `options within each meal type varied — do not force every preferred ` +
    `ingredient into every dish. Allergies, the user's avoid list, and dietary ` +
    `preferences are HARD constraints you must never violate — never include ` +
    `allergens, never include anything on the avoid list, and always respect ` +
    `dietary restrictions, no exceptions. Cuisines and loved foods are light ` +
    `flavour cues for variety only, not requirements. Cook time preference ` +
    `carries almost no weight — only use it as a barely-perceptible tie-breaker ` +
    `between otherwise equally-suitable options; it should never visibly steer ` +
    `which meals get selected. Each suggestion needs a short name, a ` +
    `calorie estimate for one serving, cookTimeMin, difficulty (Easy/Medium/` +
    `Hard), macros (protein/carbs/fats in grams), an ingredients list with ` +
    `quantity and unit, and clear numbered cooking steps.` +
    (hasExpansions
      ? ` IMPORTANT: when a family expansion is provided (for proteins or carbs), ` +
        `always use the specific variety name in the meal's name — e.g. ` +
        `"Chicken Thigh Stir Fry" not "Chicken Stir Fry", "Russet Potato Soup" ` +
        `not "Potato Soup", "Ground Beef Tacos" not "Beef Tacos". ` +
        `The variety should be visible to the user in the meal name.`
      : '') +
    ` Respond with JSON only, matching the provided schema.`;

  const perTypeRequest = types.map(t => `${t}: ${counts[t]}`).join(', ');

  const parts = [
    userContext ? `User context: ${userContext}` : '',
    hardConstraints ? `Hard constraints (must always respect, no exceptions): ${hardConstraints}` : '',
    macroPrefs ? `Primary preferences (build most options around these where sensible): ${macroPrefs}` : '',
    styleCues ? `Style cues (light variety flavour only, not requirements): ${styleCues}` : '',
    hasStyleCues
      ? `Within each meal type, only about 1 in 3 to 1 in 4 of the options ` +
        `should lean into the style cues above; the rest must be genuinely ` +
        `varied, general, traditional dishes across different culinary styles — ` +
        `not thematically repetitive.`
      : '',
    `Generate this many options per meal type: ${perTypeRequest}.`,
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

  let mealTypes: MealType[];
  let counts: Record<MealType, number>;
  let prefs: RequestPrefs;
  try {
    const body = await req.json();
    mealTypes = sanitizeMealTypes(body?.mealTypes);
    if (mealTypes.length === 0) {
      return errorResponse('invalid_input', 'At least one valid meal type is required', 400);
    }
    counts = resolveCounts(mealTypes, body?.countPerType);
    prefs = {
      proteins: sanitizeStringList(body?.proteins, MAX_MACRO_ITEMS),
      carbs: sanitizeStringList(body?.carbs, MAX_MACRO_ITEMS),
      fats: sanitizeStringList(body?.fats, MAX_MACRO_ITEMS),
      cuisines: sanitizeStringList(body?.cuisines),
      cookTime: sanitizeCookTime(body?.cookTime),
      loves: sanitizeStringList(body?.loves),
      avoid: sanitizeStringList(body?.avoid),
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

  const { system, userText } = buildPrompt(mealTypes, counts, prefs, profile);

  let result: unknown;
  try {
    result = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: buildResponseSchema(mealTypes, counts),
      logPrefix: LOG_PREFIX,
      timeoutMs: GEMINI_TIMEOUT_MS,
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    const message =
      e instanceof GeminiTimeoutError
        ? 'The AI took too long to build your shortlist. Please try again.'
        : 'Could not generate your meal shortlist. Please try again.';
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
