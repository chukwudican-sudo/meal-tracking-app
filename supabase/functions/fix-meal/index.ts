// fix-meal — AI correction backend (Phase 3, feature 2).
//
// Takes the current meal estimate (name, calories, macros, ingredients) plus a
// free-text correction the user typed ("this was grilled not fried", "I only
// had half the portion") and returns the fully corrected meal in the same
// shape — preserving whatever was already right and only changing what the
// correction addresses. Same auth + premium gate + rate limit + Gemini plumbing
// as estimate-nutrition, composed from ../_shared/.
//
// The Gemini key lives ONLY as a Supabase secret (GEMINI_API_KEY) and never
// touches the client bundle. Set it with:
//   supabase secrets set GEMINI_API_KEY=<key>
//
// Deploy with:
//   supabase functions deploy fix-meal

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';
import { recordAiEvent, sanitizeFlowId } from '../_shared/aiEvents.ts';

// Single, easily-changeable model handle. Kept in lockstep with
// estimate-nutrition — see that file's comment for why gemini-3.6-flash.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Independent bucket from estimate-nutrition (keyed by this function_name in
// ai_usage_log), so corrections don't eat into the estimate budget.
const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_FIX_TEXT_LEN = 1000;
const MAX_INGREDIENTS = 50;
const FUNCTION_NAME = 'fix-meal';
// Bump on any prompt/schema change so ai_events can compare versions.
const PROMPT_VERSION = 'fix-2026-10-22-edits';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

// Structured-output schema — same nutrition fields as estimate-nutrition (minus
// description / meal_type / health_rating, which a correction never touches).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    meal_name: { type: 'string' },
    calories: { type: 'integer' },
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
          calories: { type: 'integer' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fats: { type: 'number' },
          // "AI decides, code calculates": the model labels each item; the
          // server then does the arithmetic (see applyEdits).
          change: { type: 'string', enum: ['unchanged', 'amount', 'replaced', 'added'] },
          // Index of this item in the CURRENT meal's ingredients; -1 if added.
          source_index: { type: 'integer' },
        },
        required: ['name', 'quantity', 'unit', 'calories', 'protein', 'carbs', 'fats', 'change', 'source_index'],
      },
    },
  },
  required: ['meal_name', 'calories', 'protein', 'carbs', 'fats', 'ingredients'],
};

type ChangeKind = 'unchanged' | 'amount' | 'replaced' | 'added';

interface AiIngredient extends IngredientInput {
  change?: ChangeKind;
  source_index?: number;
}

interface FixOutput {
  meal_name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  ingredients: IngredientInput[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const finiteOr0 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const normUnit = (u: string) => {
  const x = u.trim().toLowerCase();
  if (['g', 'gram', 'grams', 'gr'].includes(x)) return 'g';
  if (['ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters'].includes(x)) return 'ml';
  return x;
};

// The model only DECIDES what changed; code does the maths so results are
// exact and consistent (a real past bug: "150 sweet potato" made the model
// re-derive the fries as plain sweet potato — 50% more food came out lighter):
// - unchanged items are copied verbatim from the current meal (no drift)
// - amount-only changes scale the original item proportionally
// - replaced/added items take the model's numbers
// - removed items are simply absent
// - totals are always the sum of the items
function applyEdits(before: CurrentDraft, raw: unknown): FixOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const ai = raw as { meal_name?: unknown; calories?: unknown; protein?: unknown; carbs?: unknown; fats?: unknown; ingredients?: unknown };
  const name = typeof ai.meal_name === 'string' && ai.meal_name.trim() ? ai.meal_name.trim().slice(0, 120) : before.meal_name;
  const list = Array.isArray(ai.ingredients) ? (ai.ingredients as AiIngredient[]).slice(0, MAX_INGREDIENTS) : [];

  const items: IngredientInput[] = list.map(it => {
    const idx = Number.isInteger(it.source_index) ? (it.source_index as number) : -1;
    const src = idx >= 0 ? before.ingredients[idx] : undefined;
    const qty = finiteOr0(it.quantity);
    if (src && it.change === 'unchanged') return { ...src };
    if (src && it.change === 'amount' && src.quantity > 0 && qty > 0 && normUnit(src.unit) === normUnit(String(it.unit ?? ''))) {
      const r = qty / src.quantity;
      return {
        name: src.name,
        quantity: qty,
        unit: src.unit,
        calories: Math.round(src.calories * r),
        protein: round1(src.protein * r),
        carbs: round1(src.carbs * r),
        fats: round1(src.fats * r),
      };
    }
    return {
      name: String(it.name ?? '').trim().slice(0, 120) || (src?.name ?? 'Item'),
      quantity: qty || 1,
      unit: String(it.unit ?? 'g').slice(0, 40),
      calories: Math.round(finiteOr0(it.calories)),
      protein: round1(finiteOr0(it.protein)),
      carbs: round1(finiteOr0(it.carbs)),
      fats: round1(finiteOr0(it.fats)),
    };
  });

  // A meal with no item breakdown (older meals) keeps the model's totals.
  if (items.length === 0) {
    return {
      meal_name: name,
      calories: Math.round(finiteOr0(ai.calories)),
      protein: round1(finiteOr0(ai.protein)),
      carbs: round1(finiteOr0(ai.carbs)),
      fats: round1(finiteOr0(ai.fats)),
      ingredients: [],
    };
  }
  const sum = (k: 'calories' | 'protein' | 'carbs' | 'fats') => items.reduce((acc, i) => acc + i[k], 0);
  return {
    meal_name: name,
    calories: Math.round(sum('calories')),
    protein: round1(sum('protein')),
    carbs: round1(sum('carbs')),
    fats: round1(sum('fats')),
    ingredients: items,
  };
}

interface IngredientInput {
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

interface CurrentDraft {
  meal_name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  ingredients: IngredientInput[];
}

interface ProfileContext {
  dietary_preferences: string[];
  allergies: string[];
}

// Coerce an untrusted client-sent draft into a clean, bounded shape before we
// hand it to Gemini. Returns null if it's unusable (missing name/macros).
function sanitizeDraft(raw: unknown): CurrentDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;

  const name = typeof d.meal_name === 'string' ? d.meal_name.trim().slice(0, 120) : '';
  if (!name) return null;

  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const ingredientsRaw = Array.isArray(d.ingredients) ? d.ingredients.slice(0, MAX_INGREDIENTS) : [];
  const ingredients: IngredientInput[] = ingredientsRaw
    .map((i): IngredientInput | null => {
      if (!i || typeof i !== 'object') return null;
      const ing = i as Record<string, unknown>;
      const iName = typeof ing.name === 'string' ? ing.name.trim().slice(0, 120) : '';
      if (!iName) return null;
      return {
        name: iName,
        quantity: num(ing.quantity) || 1,
        unit: typeof ing.unit === 'string' ? ing.unit.slice(0, 40) : 'serving',
        calories: Math.round(num(ing.calories)),
        protein: num(ing.protein),
        carbs: num(ing.carbs),
        fats: num(ing.fats),
      };
    })
    .filter((i): i is IngredientInput => i !== null);

  return {
    meal_name: name,
    calories: Math.round(num(d.calories)),
    protein: num(d.protein),
    carbs: num(d.carbs),
    fats: num(d.fats),
    ingredients,
  };
}

// Earlier corrections the user already made to this same meal (oldest first),
// so a follow-up builds on them instead of starting over.
const MAX_HISTORY = 10;

function sanitizeHistory(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is string => typeof h === 'string')
    .map(h => h.trim().slice(0, MAX_FIX_TEXT_LEN))
    .filter(Boolean)
    .slice(-MAX_HISTORY);
}

function buildPrompt(
  fixText: string,
  draft: CurrentDraft,
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
    'You are a nutrition correction assistant. You are given a meal that was ' +
    'previously estimated (as JSON) and a correction the user typed. Apply the ' +
    'correction and return the COMPLETE corrected meal in the same structure — ' +
    'not a diff. Preserve every value that the correction does not affect; only ' +
    'change what the correction addresses (e.g. cooking method, portion size, ' +
    'adding/removing/substituting an ingredient). Keep per-ingredient calories ' +
    'and macros consistent with the meal totals. A correction usually refers to ' +
    'one item in the ingredients list: change only that item. Earlier ' +
    'corrections, when given, are already reflected in the estimate — keep ' +
    'them. For EVERY item in your answer set source_index to its position ' +
    '(0-based) in the current ingredients list, or -1 if it is new, and set ' +
    'change: "unchanged" if the correction does not touch it; "amount" if ONLY ' +
    'its quantity changes (same food, same cooking — keep its name and unit); ' +
    '"replaced" if the user names a different food or cooking method for it; ' +
    '"added" for a new item. Leave removed items out. Keep the food the ' +
    'estimate already has unless the user clearly names a different food or ' +
    'cooking method (e.g. "150 sweet potato" for sweet potato fries is an ' +
    'amount change). An item\'s name must describe the food its numbers ' +
    'represent. Use grams (g) for food amounts and millilitres (ml) for drinks. ' +
    'Never invent ingredients the user did not mention. Respond with JSON only, ' +
    'matching the provided schema.';

  const draftJson = JSON.stringify({
    meal_name: draft.meal_name,
    calories: draft.calories,
    protein: draft.protein,
    carbs: draft.carbs,
    fats: draft.fats,
    ingredients: draft.ingredients,
  });

  const earlier = history.length
    ? `Earlier corrections (already applied, oldest first):\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\n`
    : '';
  const base = `Current meal estimate:\n${draftJson}\n\n${earlier}User correction:\n${fixText}`;
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
  let draft: CurrentDraft | null = null;
  let history: string[] = [];
  let flowId: string | null = null;
  try {
    const body = await req.json();
    flowId = sanitizeFlowId(body?.flow_id);
    fixText = typeof body?.fixText === 'string' ? body.fixText.trim() : '';
    draft = sanitizeDraft(body?.currentDraft);
    history = sanitizeHistory(body?.history);
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }
  if (!fixText) return errorResponse('invalid_input', 'A correction is required', 400);
  if (fixText.length > MAX_FIX_TEXT_LEN) {
    return errorResponse('invalid_input', 'Correction is too long', 400);
  }
  if (!draft) return errorResponse('invalid_input', 'A valid current meal is required', 400);

  // Load the authoritative profile row (never trust client-sent entitlement)
  // and check the rate limit together — both only depend on user.id, so
  // there's no reason to pay for two sequential DB round-trips.
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
  if (profileErr || !profileRow) {
    return errorResponse('ai_failed', 'Could not load your profile', 500);
  }

  // Entitlement gate — re-checked on every call (a fix is a separate request
  // from the initial estimate). Subscribers are unlimited; everyone else spends
  // a free scan (consumed only on success, below). not_premium triggers the
  // paywall in the app.
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
    return errorResponse('rate_limited', "You've reached the hourly limit for AI corrections. Try again later.", 429);
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
  };

  const { system, userText } = buildPrompt(fixText, draft, profile, history);

  const startedAt = Date.now();
  const event = {
    userId: user.id,
    functionName: FUNCTION_NAME,
    promptVersion: PROMPT_VERSION,
    flowId,
    startedAt,
    input: { fixText, history, before: draft },
  };

  let corrected: unknown;
  try {
    corrected = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: RESPONSE_SCHEMA,
      logPrefix: LOG_PREFIX,
      // Speed: applying a correction is simple; low thinking (vs the default
      // medium) cuts the ~5s wait.
      thinkingLevel: 'low',
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    recordAiEvent(admin, { ...event, success: false, errorCode: e instanceof GeminiTimeoutError ? 'timeout' : 'ai_failed' });
    const message =
      e instanceof GeminiTimeoutError
        ? 'The AI corrector took too long to respond. Please try again.'
        : 'Could not update this meal. Please try again.';
    return errorResponse('ai_failed', message, 502);
  }

  // Only charge the call (rate-limit log + free scan) once it succeeded, so our
  // own failures/timeouts don't burn the user's quota or free scans.
  // Usage logging is fire-and-forget bookkeeping — don't block the response on
  // it. consumeFreeScan stays awaited: it's the atomic guard enforcing the
  // free-scan limit and must register before we respond.
  const result = applyEdits(draft, corrected);
  if (!result) {
    recordAiEvent(admin, { ...event, success: false, errorCode: 'bad_output', output: { ai: corrected } });
    return errorResponse('ai_failed', 'Could not update this meal. Please try again.', 502);
  }

  void logAiUsage(admin, user.id, FUNCTION_NAME);
  // Keep the model's raw labels next to the final result for analysis.
  recordAiEvent(admin, { ...event, success: true, output: { ...result, ai: corrected } });
  if (!entitlement.isSubscriber) {
    await consumeFreeScan(admin, user.id);
  }

  return jsonResponse(result, 200);
});
