// scan-kitchen — AI kitchen/pantry scan backend (Phase 3, feature 4, vision).
//
// Takes one or more photos of a fridge/pantry/cupboard (inline base64) and
// returns the distinct food ingredients visible, each with an auto-assigned
// category matching the app's My Kitchen categories. Same auth + entitlement +
// rate limit + Gemini plumbing as scan-meal, composed from ../_shared/. Photos
// are sent inline to Gemini per request — no Supabase Storage involved.
//
// The Gemini key lives ONLY as a Supabase secret (GEMINI_API_KEY) and never
// touches the client bundle. Set it with:
//   supabase secrets set GEMINI_API_KEY=<key>
//
// Deploy with:
//   supabase functions deploy scan-kitchen

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { consumeFreeScan, resolveEntitlement } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';

// Single, easily-changeable model handle. gemini-3.6-flash is multimodal
// (accepts image input) — see estimate-nutrition for why this model is pinned.
const GEMINI_MODEL = 'gemini-3.6-flash';

// Independent bucket from the other AI functions (keyed by this function_name
// in ai_usage_log).
const RATE_LIMIT = 30; // calls per hour, per user
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Up to 4 photos per scan (fridge, freezer, pantry, a cupboard shelf). Each is
// capped like scan-meal's single image (~10MB base64 abuse guard); the combined
// cap is defense-in-depth against Gemini's inline-payload ceiling — real
// captures are compressed client-side to well under this.
const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64_LEN = 10_000_000;
const MAX_TOTAL_BASE64_LEN = 16_000_000;
// Vision over several images can take longer — a bit more headroom than
// scan-meal's single-image 20s.
const GEMINI_TIMEOUT_MS = 25000;
const FUNCTION_NAME = 'scan-kitchen';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

// Must stay in sync with the app's IngredientCategory union (store/types.ts).
const CATEGORIES = [
  'Proteins',
  'Carbs & Grains',
  'Fruits & Vegetables',
  'Dairy',
  'Oils & Fats',
  'Spices & Seasonings',
  'Condiments',
  'Other',
] as const;

// Structured-output schema — a list of { name, category }, category constrained
// to the fixed enum so Gemini can't invent categories the app doesn't know.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
        },
        required: ['name', 'category'],
      },
    },
  },
  required: ['ingredients'],
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
    'You are a kitchen inventory assistant. You are given one or more photos of ' +
    "a person's fridge, freezer, pantry, or cupboards. Identify the distinct " +
    'food and drink ingredients that are clearly visible. Return each unique ' +
    'ingredient once, even if it appears in more than one photo. Use short, ' +
    'generic ingredient names (e.g. "milk", "chicken breast", "olive oil"), not ' +
    'brand names or packaging text. Assign each a category, choosing the ' +
    `best fit from exactly this list: ${CATEGORIES.join(', ')}. Use "Other" when ` +
    'nothing else fits. Ignore non-food items, utensils, and anything you cannot ' +
    'confidently identify. Respond with JSON only, matching the provided schema.';

  const userText = context
    ? `User context: ${context}\n\nIdentify the ingredients visible in these photos.`
    : 'Identify the ingredients visible in these photos.';

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

  // Parse + validate the images array.
  let images: { base64: string; mimeType: string }[] = [];
  try {
    const body = await req.json();
    const raw = Array.isArray(body?.images) ? body.images : [];
    images = raw
      .map((img: unknown) => {
        if (!img || typeof img !== 'object') return null;
        const o = img as Record<string, unknown>;
        const base64 = typeof o.base64 === 'string' ? o.base64 : '';
        const mimeType =
          typeof o.mimeType === 'string' && ALLOWED_MIME_TYPES.has(o.mimeType) ? o.mimeType : 'image/jpeg';
        if (!base64) return null;
        return { base64, mimeType };
      })
      .filter((x: unknown): x is { base64: string; mimeType: string } => x !== null);
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }

  if (images.length === 0) return errorResponse('invalid_input', 'At least one photo is required', 400);
  if (images.length > MAX_IMAGES) {
    return errorResponse('invalid_input', `Please send at most ${MAX_IMAGES} photos`, 400);
  }
  let totalLen = 0;
  for (const img of images) {
    if (img.base64.length > MAX_IMAGE_BASE64_LEN) {
      return errorResponse('invalid_input', 'One of the photos is too large', 400);
    }
    totalLen += img.base64.length;
  }
  if (totalLen > MAX_TOTAL_BASE64_LEN) {
    return errorResponse('invalid_input', 'The photos are too large in total', 400);
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

  let result: unknown;
  try {
    result = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: RESPONSE_SCHEMA,
      logPrefix: LOG_PREFIX,
      timeoutMs: GEMINI_TIMEOUT_MS,
      images,
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    const message =
      e instanceof GeminiTimeoutError
        ? 'The AI scanner took too long to respond. Please try again.'
        : 'Could not identify ingredients from these photos. Please try again.';
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
