// scan-meal — AI photo scan backend (Phase 3, feature 3, vision).
//
// Takes a meal photo (inline base64) and returns a minimal nutrition estimate
// (name + calories + macros). Same auth + premium gate + rate limit + Gemini
// plumbing as estimate-nutrition/fix-meal, composed from ../_shared/. The photo
// is sent inline to Gemini per request — no Supabase Storage involved.
//
// The Gemini key lives ONLY as a Supabase secret (GEMINI_API_KEY) and never
// touches the client bundle. Set it with:
//   supabase secrets set GEMINI_API_KEY=<key>
//
// Deploy with:
//   supabase functions deploy scan-meal

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';

// Single, easily-changeable model handle. gemini-3.6-flash is multimodal
// (accepts image input) — see estimate-nutrition for why this model is pinned.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Independent bucket from estimate-nutrition/fix-meal (keyed by this
// function_name in ai_usage_log).
const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;
// Base64 string length cap (~10MB). Real captures from the app (quality 0.5
// JPEG) are 0.5-2MB; this guards against abuse while staying well under
// Gemini's 100MB inline limit and the 150MB function memory ceiling.
const MAX_IMAGE_BASE64_LEN = 10_000_000;
// Vision calls can take a touch longer than text — give a bit more headroom
// than the shared 15s default.
const GEMINI_TIMEOUT_MS = 20000;
const FUNCTION_NAME = 'scan-meal';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

// Minimal structured-output schema — name + calories + macros only (matches
// ScanTab's MealDraft; no ingredients/meal_type/health_rating).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    meal_name: { type: 'string' },
    calories: { type: 'integer' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fats: { type: 'number' },
  },
  required: ['meal_name', 'calories', 'protein', 'carbs', 'fats'],
};

interface ProfileContext {
  dietary_preferences: string[];
  allergies: string[];
}

function buildPrompt(p: ProfileContext): { system: string; userText: string } {
  const context = [
    p.dietary_preferences.length ? `Dietary preferences: ${p.dietary_preferences.join(', ')}.` : '',
    p.allergies.length ? `Allergies: ${p.allergies.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const system =
    'You are a nutrition estimation assistant. Identify the meal in the photo ' +
    'and estimate its nutrition as accurately as possible for the single ' +
    'serving/portion visible in the image. Give a short, human-friendly ' +
    'meal_name. Estimate calories and macros (protein, carbs, fats in grams) ' +
    'for the portion shown. Use the user context only to inform reasonable ' +
    'assumptions; never claim to see foods that are not visible. Respond with ' +
    'JSON only, matching the provided schema.';

  const userText = context
    ? `User context: ${context}\n\nIdentify this meal and estimate its nutrition.`
    : 'Identify this meal and estimate its nutrition.';

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

  let imageBase64 = '';
  let mimeType = 'image/jpeg';
  try {
    const body = await req.json();
    imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : '';
    if (typeof body?.mimeType === 'string' && ALLOWED_MIME_TYPES.has(body.mimeType)) {
      mimeType = body.mimeType;
    }
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }
  if (!imageBase64) return errorResponse('invalid_input', 'A meal photo is required', 400);
  if (imageBase64.length > MAX_IMAGE_BASE64_LEN) {
    return errorResponse('invalid_input', 'Image is too large', 400);
  }

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
    return errorResponse('rate_limited', "You've reached the hourly limit for AI scans. Try again later.", 429);
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
  };

  const { system, userText } = buildPrompt(profile);

  let estimate: unknown;
  try {
    estimate = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: RESPONSE_SCHEMA,
      logPrefix: LOG_PREFIX,
      timeoutMs: GEMINI_TIMEOUT_MS,
      images: [{ base64: imageBase64, mimeType }],
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    const message =
      e instanceof GeminiTimeoutError
        ? 'The AI scanner took too long to respond. Please try again.'
        : 'Could not identify this meal. Please try again.';
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
