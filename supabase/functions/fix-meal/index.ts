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
import { isEntitled } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';

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
        },
        required: ['name', 'quantity', 'unit', 'calories', 'protein', 'carbs', 'fats'],
      },
    },
  },
  required: ['meal_name', 'calories', 'protein', 'carbs', 'fats', 'ingredients'],
};

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

function buildPrompt(
  fixText: string,
  draft: CurrentDraft,
  p: ProfileContext,
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
    'and macros consistent with the meal totals. Never invent ingredients the ' +
    'user did not mention. Respond with JSON only, matching the provided schema.';

  const draftJson = JSON.stringify({
    meal_name: draft.meal_name,
    calories: draft.calories,
    protein: draft.protein,
    carbs: draft.carbs,
    fats: draft.fats,
    ingredients: draft.ingredients,
  });

  const base = `Current meal estimate:\n${draftJson}\n\nUser correction:\n${fixText}`;
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
  try {
    const body = await req.json();
    fixText = typeof body?.fixText === 'string' ? body.fixText.trim() : '';
    draft = sanitizeDraft(body?.currentDraft);
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }
  if (!fixText) return errorResponse('invalid_input', 'A correction is required', 400);
  if (fixText.length > MAX_FIX_TEXT_LEN) {
    return errorResponse('invalid_input', 'Correction is too long', 400);
  }
  if (!draft) return errorResponse('invalid_input', 'A valid current meal is required', 400);

  // Load the authoritative profile row (never trust client-sent entitlement).
  const { data: profileRow, error: profileErr } = await admin
    .from('users')
    .select('subscription_status, dietary_preferences, allergies')
    .eq('id', user.id)
    .single();

  if (profileErr || !profileRow) {
    return errorResponse('ai_failed', 'Could not load your profile', 500);
  }

  // Entitlement gate — re-checked on every call (a fix is a separate request
  // from the initial estimate); the app uses this to trigger the paywall.
  if (!isEntitled(profileRow.subscription_status)) {
    return errorResponse('not_premium', 'AI corrections are a Premium feature', 402);
  }

  let limited: boolean;
  try {
    limited = await isRateLimited(admin, user.id, FUNCTION_NAME, RATE_LIMIT, RATE_WINDOW_MS);
  } catch (e) {
    console.error(`${LOG_PREFIX} rate limit check failed:`, e);
    return errorResponse('ai_failed', 'Could not check usage', 500);
  }
  if (limited) {
    return errorResponse('rate_limited', "You've reached the hourly limit for AI corrections. Try again later.", 429);
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
  };

  const { system, userText } = buildPrompt(fixText, draft, profile);

  let corrected: unknown;
  try {
    corrected = await callGeminiJSON({
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
        ? 'The AI corrector took too long to respond. Please try again.'
        : 'Could not update this meal. Please try again.';
    return errorResponse('ai_failed', message, 502);
  }

  // Only log a call once it actually succeeded, so our own failures/timeouts
  // don't burn the user's hourly quota.
  await logAiUsage(admin, user.id, FUNCTION_NAME);

  return jsonResponse(corrected, 200);
});
