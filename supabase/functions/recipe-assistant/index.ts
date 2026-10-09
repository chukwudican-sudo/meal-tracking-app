// recipe-assistant — in-recipe chat backend ("Recipe Assistant" panel).
//
// Powers the slide-up chat on the recipe detail screen: the user asks about a
// specific recipe (swaps, substitutions, tweaks, technique) and gets a reply
// with awareness of their dietary preferences / allergies.
//
// Entitlement is TWO gates, both mandatory:
//   1. Active subscription — unconditional. This is a premium-only feature with
//      no free-tier path at all (no free-scan pool involvement).
//   2. Recipe "unlocked" sequencing check for AI/Custom recipes — the request
//      must carry a non-empty `steps` array, proving generate-recipe-steps has
//      already run for this recipe. Premade recipes need no extra check (a
//      subscriber already has full access to every premade recipe).
// Both failures reuse the `not_premium` code/402 so the client's existing
// paywall-alert handling needs no special-casing.
//
// UNMETERED AS A PRODUCT FEATURE: this function does NOT call consumeFreeScan
// and chat is never presented to the user as having a limit — no counter, no
// "X messages left" UI, nothing. Per the explicit "unlimited and unmetered"
// requirement, a subscriber's conversation never runs out.
//
// It DOES still carry the same technical rate-limit backstop every other AI
// function has (isRateLimited/logAiUsage against ai_usage_log), just set high
// enough (60/minute) that no real conversation would ever brush against it —
// this exists purely to catch a runaway client bug or scripted abuse, not to
// ration usage. If it ever fires, the error is intentionally generic (same
// wording as any other transient AI failure) so it never reads as "you've hit
// your limit" to the user.
//
// Same auth + Gemini plumbing as the other AI functions, composed from
// ../_shared/. The Gemini key lives ONLY as a Supabase secret.
//
// Deploy with:
//   supabase functions deploy recipe-assistant

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { isEntitled } from '../_shared/entitlement.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { callGeminiJSON, GeminiTimeoutError } from '../_shared/gemini.ts';
import {
  buildHardConstraints,
  buildUserContext,
  type ProfileContext,
} from '../_shared/mealPromptHelpers.ts';

const GEMINI_MODEL = 'gemini-3.6-flash';

const GEMINI_TIMEOUT_MS = 15000; // conversational reply, lighter output
const MAX_NAME_LEN = 120;
const MAX_INGREDIENTS = 60;
const MAX_STEPS = 40;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LEN = 1000;
const FUNCTION_NAME = 'recipe-assistant';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

// Generous technical backstop only — not a product limit. 60/minute is far
// above what any real back-and-forth conversation would ever hit; it exists
// solely to catch a runaway client bug or scripted abuse.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

const RECIPE_SOURCES = ['ai', 'premade'] as const;
type RecipeSource = (typeof RECIPE_SOURCES)[number];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
  },
  required: ['reply'],
};

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface IngredientInput {
  name: string;
  quantity?: number;
  unit?: string;
}

interface RequestBody {
  recipeName: string;
  recipeSource: RecipeSource;
  ingredients: IngredientInput[];
  steps: string[];
  messages: ChatTurn[];
}

function sanitizeSource(raw: unknown): RecipeSource | null {
  return typeof raw === 'string' && (RECIPE_SOURCES as readonly string[]).includes(raw)
    ? (raw as RecipeSource)
    : null;
}

function sanitizeIngredients(raw: unknown): IngredientInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_INGREDIENTS)
    .map((i): IngredientInput | null => {
      if (!i || typeof i !== 'object') return null;
      const o = i as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name.trim().slice(0, MAX_NAME_LEN) : '';
      if (!name) return null;
      const quantity = Number(o.quantity);
      return {
        name,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
        unit: typeof o.unit === 'string' ? o.unit.slice(0, 40) : undefined,
      };
    })
    .filter((i): i is IngredientInput => i !== null);
}

function sanitizeSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_STEPS)
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
}

function sanitizeMessages(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-MAX_MESSAGES)
    .map((m): ChatTurn | null => {
      if (!m || typeof m !== 'object') return null;
      const o = m as Record<string, unknown>;
      const role = o.role === 'assistant' ? 'assistant' : o.role === 'user' ? 'user' : null;
      const text = typeof o.text === 'string' ? o.text.trim().slice(0, MAX_MESSAGE_LEN) : '';
      if (!role || !text) return null;
      return { role, text };
    })
    .filter((m): m is ChatTurn => m !== null);
}

function formatIngredient(i: IngredientInput): string {
  const qty = i.quantity != null ? `${i.quantity}${i.unit ? ' ' + i.unit : ''} ` : '';
  return `${qty}${i.name}`.trim();
}

function buildPrompt(
  body: RequestBody,
  p: ProfileContext,
): { system: string; userText: string } {
  const userContext = buildUserContext(p);
  const hardConstraints = buildHardConstraints(p, []);

  const system =
    'You are a friendly, knowledgeable cooking assistant helping the user with ' +
    'one specific recipe. Answer their questions naturally and concisely — ' +
    'ingredient swaps, substitutions, portion tweaks, techniques, and timing. ' +
    'Stay focused on the recipe in context. When suggesting substitutions, ' +
    'respect the user\'s dietary preferences and allergies as HARD constraints ' +
    '— never suggest something they cannot eat. If a question is unrelated to ' +
    'cooking or this recipe, gently steer back. Respond with JSON only, ' +
    'matching the provided schema (a single "reply" string).';

  const ingredientsBlock = body.ingredients.length
    ? body.ingredients.map(formatIngredient).map(s => `- ${s}`).join('\n')
    : '(none provided)';
  const stepsBlock = body.steps.length
    ? body.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '(none provided)';
  const conversation = body.messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    .join('\n');

  const parts = [
    userContext ? `User context: ${userContext}` : '',
    hardConstraints ? `Hard constraints (must always respect, no exceptions): ${hardConstraints}` : '',
    `Recipe: ${body.recipeName}`,
    `Ingredients:\n${ingredientsBlock}`,
    `Steps:\n${stepsBlock}`,
    `Conversation so far (reply to the final user message):\n${conversation}`,
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

  let body: RequestBody | null = null;
  try {
    const raw = await req.json();
    const recipeName = typeof raw?.recipeName === 'string' ? raw.recipeName.trim().slice(0, MAX_NAME_LEN) : '';
    const recipeSource = sanitizeSource(raw?.recipeSource);
    const messages = sanitizeMessages(raw?.messages);
    if (!recipeName || !recipeSource) {
      return errorResponse('invalid_input', 'A recipe and source are required', 400);
    }
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return errorResponse('invalid_input', 'A user message is required', 400);
    }
    body = {
      recipeName,
      recipeSource,
      ingredients: sanitizeIngredients(raw?.ingredients),
      steps: sanitizeSteps(raw?.steps),
      messages,
    };
  } catch {
    return errorResponse('invalid_input', 'Invalid request body', 400);
  }

  // Load the authoritative profile row (never trust client-sent entitlement)
  // and check the rate limit together — both only depend on user.id, so
  // there's no reason to pay for two sequential DB round-trips. The rate-limit
  // check is a technical backstop only (see file header) — deliberately generic
  // messaging, never a product-level "you've hit your limit" notice.
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

  // Gate 1 — subscription, unconditional. Premium-only feature, no free tier.
  if (!isEntitled(profileRow.subscription_status)) {
    return errorResponse('not_premium', 'Chat with the Recipe Assistant is a Premium feature.', 402);
  }

  // Gate 2 — sequencing, AI/Custom recipes only. A non-empty steps array proves
  // generate-recipe-steps already ran for this recipe. Premade recipes skip
  // this (a subscriber already has full access to every premade recipe). Reuses
  // not_premium so the client needs no special-casing.
  if (body.recipeSource === 'ai' && body.steps.length === 0) {
    return errorResponse('not_premium', 'Generate the full recipe before chatting about it.', 402);
  }

  // null means the rate-limit check itself errored (caught above).
  if (rateLimitResult === null) {
    return errorResponse('ai_failed', 'Could not get a reply right now. Please try again.', 500);
  }
  if (rateLimitResult) {
    console.warn(`${LOG_PREFIX} technical rate-limit backstop triggered for user ${user.id}`);
    return errorResponse('rate_limited', 'Could not get a reply right now. Please try again.', 429);
  }

  const profile: ProfileContext = {
    dietary_preferences: profileRow.dietary_preferences ?? [],
    allergies: profileRow.allergies ?? [],
    goal_type: null,
    daily_calorie_target: null,
  };

  const { system, userText } = buildPrompt(body, profile);

  let result: unknown;
  try {
    result = await callGeminiJSON({
      apiKey: geminiKey,
      model: GEMINI_MODEL,
      systemInstruction: system,
      userText,
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.6,
      timeoutMs: GEMINI_TIMEOUT_MS,
      logPrefix: LOG_PREFIX,
    });
  } catch (e) {
    console.error(`${LOG_PREFIX} Gemini call failed:`, e);
    const message =
      e instanceof GeminiTimeoutError
        ? 'The assistant took too long to respond. Please try again.'
        : 'Could not get a reply right now. Please try again.';
    return errorResponse('ai_failed', message, 502);
  }

  // Log against the technical rate-limit bucket only — no consumeFreeScan,
  // since chat remains unlimited/unmetered as a product feature. Fire-and-forget:
  // it's bookkeeping, so don't block the reply on the write.
  void logAiUsage(admin, user.id, FUNCTION_NAME);

  return jsonResponse(result, 200);
});
