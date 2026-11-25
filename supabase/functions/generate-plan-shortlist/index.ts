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
import { aiConsentGiven, consentRequiredResponse } from '../_shared/aiConsent.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { recordAiEvent } from '../_shared/aiEvents.ts';
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

// Speed (Nov 23, two tests of 12 runs each on the real request): one call for
// all ~14 recipes with cooking steps took 18–41s and timed out at 25s. Now:
// - no cooking steps: they're written only for the meals the user keeps, when
//   a recipe is first opened (generate-recipe-steps, the recipe page's path);
// - one small call per meal type, all at once, with low thinking: 4.9–5.1s,
//   calories in line with the slow version.
// Each part retries once (Google's guidance for timeouts / 429 / 5xx / a bad
// answer), all inside one overall budget below the app's 35s timeout. Any part
// still failing fails the whole request: never a half-empty shortlist.
const PART_TIMEOUT_MS = 12000;
const OVERALL_BUDGET_MS = 25000;
const PART_RETRY_DELAY_MS = 800;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const FUNCTION_NAME = 'generate-plan-shortlist';
// Bump on any prompt/schema change so ai_events can compare versions.
const PROMPT_VERSION = 'shortlist-2026-11-25';
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
    },
    required: [
      'name', 'calories', 'cookTimeMin', 'difficulty',
      'protein', 'carbs', 'fats', 'ingredients',
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

// Each meal's usual share of the day (Nov 23, Alex): the daily target alone
// left the model to guess how big a lunch should be. Snacks are per snack.
const MEAL_SHARE: Record<MealType, [number, number]> = {
  Breakfast: [0.2, 0.3],
  Lunch: [0.25, 0.35],
  Dinner: [0.25, 0.35],
  Snacks: [0.05, 0.15],
};

// What each meal type looks like (Nov 25 audit): each type is its own
// parallel call that never sees the others, so lunch and dinner came back as
// the same chicken-rice / beef-corn / egg-potato plates. Examples are a
// direction, not a menu; cuisines and the user's foods still shape the dish.
const MEAL_STYLE: Record<MealType, string> = {
  Breakfast:
    'Breakfast: morning dishes (e.g. eggs, oats, yogurt bowls, toast, smoothies, ' +
    'pancakes, breakfast wraps), not lunch or dinner plates.',
  // "Quick", not "light": lunch gets the same share of the day as dinner.
  Lunch:
    'Lunch: quick midday meals (e.g. grain or rice bowls, wraps, salads, ' +
    'sandwiches, soups) rather than the cooked mains typical of dinner.',
  Dinner:
    'Dinner: hearty cooked evening meals (e.g. stir-fries, curries, stews, ' +
    'pasta, bakes, roasts, skillet dishes) rather than the bowls, salads and ' +
    'sandwiches typical of lunch.',
  Snacks:
    'Snacks: small, simple bites (e.g. fruit, yogurt, nuts, boiled eggs, ' +
    'popcorn), not mini meals.',
};

function buildCalorieRanges(types: MealType[], dailyTarget: number | null): string {
  if (!dailyTarget || dailyTarget <= 0) return '';
  const r10 = (n: number) => Math.round(n / 10) * 10;
  return types
    .map(t => `${t} ${r10(dailyTarget * MEAL_SHARE[t][0])}–${r10(dailyTarget * MEAL_SHARE[t][1])} kcal`)
    .join(', ');
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
    `which meals get selected. Each suggestion needs a short name (2–5 words, ` +
    `about 40 characters at most) that reads like a real dish's name (e.g. ` +
    `"Egg Fried Rice", "Yam and Egg Sauce"), not a list of its ingredients, a ` +
    `calorie estimate for one serving, cookTimeMin, difficulty (Easy/Medium/` +
    `Hard), macros (protein/carbs/fats in grams), and an ingredients list ` +
    `with quantity and unit.` +
    (hasExpansions
      ? ` IMPORTANT: when a family expansion is provided (for proteins or carbs), ` +
        `always use the specific variety name in the meal's name, still keeping ` +
        `the name short — e.g. ` +
        `"Chicken Thigh Stir Fry" not "Chicken Stir Fry", "Russet Potato Soup" ` +
        `not "Potato Soup", "Ground Beef Tacos" not "Beef Tacos". ` +
        `The variety should be visible to the user in the meal name.`
      : '') +
    ` Respond with JSON only, matching the provided schema.`;

  const perTypeRequest = types.map(t => `${t}: ${counts[t]}`).join(', ');
  const calorieRanges = buildCalorieRanges(types, p.daily_calorie_target);

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
    `Meal style: ${types.map(t => MEAL_STYLE[t]).join(' ')}`,
    calorieRanges
      ? `Size each option for one serving within its meal's share of the daily ` +
        `target: ${calorieRanges}.`
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
        'ai_consent, subscription_status, subscription_expiry_date, free_scans_remaining, dietary_preferences, allergies, ' +
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
  // Apple 5.1.2: nothing goes to Gemini without the user's yes (_shared/aiConsent.ts).
  if (!aiConsentGiven(profileRow)) return consentRequiredResponse();

  // Entitlement gate: subscribers are unlimited; everyone else spends a free
  // scan (consumed only on success, below). The app uses not_premium to trigger
  // the paywall.
  const entitlement = await resolveEntitlement(admin, user.id, profileRow);
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

  const deadline = Date.now() + OVERALL_BUDGET_MS;
  const startedAt = Date.now();
  const event = { userId: user.id, functionName: FUNCTION_NAME, promptVersion: PROMPT_VERSION, startedAt, input: { mealTypes, counts, ...prefs } };

  // One meal type's options: up to 2 tries, each capped by what's left of the
  // overall budget.
  const generateType = async (t: MealType): Promise<unknown[]> => {
    const { system, userText } = buildPrompt([t], counts, prefs, profile);
    let lastError: unknown = new Error(`${t}: no time left`);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 3000) break;
      try {
        const out = await callGeminiJSON({
          apiKey: geminiKey,
          model: GEMINI_MODEL,
          systemInstruction: system,
          userText,
          responseSchema: buildResponseSchema([t], counts),
          logPrefix: `${LOG_PREFIX} ${t}`,
          timeoutMs: Math.min(PART_TIMEOUT_MS, left),
          thinkingLevel: 'low',
        });
        const items = (out as { shortlist?: Record<string, unknown> })?.shortlist?.[t];
        if (Array.isArray(items) && items.length > 0) return items;
        throw new Error(`${t}: no options in the answer`);
      } catch (e) {
        lastError = e;
        console.warn(`${LOG_PREFIX} ${t} attempt ${attempt} failed:`, e);
        if (attempt === 1) await sleep(PART_RETRY_DELAY_MS + Math.random() * 400);
      }
    }
    throw lastError;
  };

  const parts = await Promise.allSettled(mealTypes.map(generateType));
  const failed = parts.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length > 0) {
    console.error(`${LOG_PREFIX} ${failed.length} of ${mealTypes.length} meal types failed after retries`);
    const timedOut = failed.some(f => f.reason instanceof GeminiTimeoutError);
    recordAiEvent(admin, { ...event, success: false, errorCode: timedOut ? 'timeout' : 'ai_failed' });
    const message = timedOut
      ? 'The AI took too long to build your shortlist. Please try again.'
      : 'Could not generate your meal shortlist. Please try again.';
    return errorResponse('ai_failed', message, 502);
  }
  const shortlist: Record<string, unknown[]> = {};
  mealTypes.forEach((t, i) => {
    shortlist[t] = (parts[i] as PromiseFulfilledResult<unknown[]>).value;
  });
  const result = { shortlist };
  console.info(`${LOG_PREFIX} shortlist ready in ${Date.now() - startedAt}ms (${mealTypes.length} types)`);

  // Only charge the call (rate-limit log + free scan) once it succeeded, so our
  // own failures/timeouts don't burn the user's quota or free scans.
  // Usage logging is fire-and-forget bookkeeping — don't block the response on
  // it. consumeFreeScan stays awaited: it's the atomic guard enforcing the
  // free-scan limit and must register before we respond.
  void logAiUsage(admin, user.id, FUNCTION_NAME);
  recordAiEvent(admin, { ...event, success: true, output: result });
  if (!entitlement.isSubscriber) {
    await consumeFreeScan(admin, user.id);
  }

  return jsonResponse(result, 200);
});
