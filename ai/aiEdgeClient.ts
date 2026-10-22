// Shared client-side plumbing for calling AI edge functions.
//
// Every AI feature (estimate-nutrition, fix-meal, and the ones still to come)
// invokes a Supabase edge function that speaks the same contract: on failure it
// returns `{ error: { code, message } }`, and the supabase-js client attaches
// the signed-in user's access token automatically. Rather than re-implement the
// invoke + timeout + error-parsing dance in every wrapper, they compose these
// helpers — the client-side mirror of the server-side `_shared/` folder.

import { supabase } from '@/lib/supabase';
import { newId } from '@/lib/sync/uuid';
import type { Ingredient } from '@/store/types';
import type { MealDraft } from './types';

export type AIErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_premium'
  | 'rate_limited'
  | 'ai_failed'
  | 'unknown';

// Base class for every AI edge-function error so the UI can branch generically
// on `instanceof AIError` + `.code`. Per-feature wrappers subclass this only to
// set a distinct `name` for clearer logs (e.g. EstimateError, FixError).
export class AIError extends Error {
  code: AIErrorCode;
  constructor(code: AIErrorCode, message: string) {
    super(message);
    this.name = 'AIError';
    this.code = code;
  }
}

type MakeError = (code: AIErrorCode, message: string) => AIError;

export interface InvokeAIOptions {
  // Log line prefix, e.g. '[fixMeal]', so invoke timings/errors are attributable.
  logPrefix: string;
  // Wrap parsed errors in a feature-specific subclass (defaults to AIError).
  makeError?: MakeError;
  // Message when the request never comes back (client-side timeout / network).
  timeoutMessage?: string;
  // Message when the function isn't deployed yet (gateway 404).
  notAvailableMessage?: string;
}

// Backstop for a hung request (e.g. the edge function's own Gemini timeout
// somehow didn't fire, or the response never comes back at all). Set above the
// longest edge-function Gemini timeout (25s for scan-kitchen / suggest-kitchen-
// recipes) so, in the normal case, the function's own clear message wins the
// race and reaches the client first — this is just the worst-case ceiling.
export const INVOKE_TIMEOUT_MS = 35000;

// User-facing text for a failed AI call. Callers handle not_premium first (it
// opens the paywall); everything else shows the server's own message when it
// sent one, so a failure is never silent or generic.
export function aiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof AIError) {
    if (e.code === 'unauthorized') return 'Your session expired. Please sign in again.';
    if (e.message) return e.message;
  }
  return fallback;
}

export function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// Ingredient macros keep one decimal: they're sent back to fix-meal as the
// meal's memory, and rounding each item to whole grams made the totals drift
// ~1g from the sum of the items after a fix. Meal totals stay whole numbers.
export function toOneDecimal(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0;
}

// Both estimate and fix return ingredients in the same wire shape; map them to
// the app's Ingredient model with a fresh local id.
export function mapIngredients(raw: unknown): Ingredient[] {
  return Array.isArray(raw)
    ? raw.map((ing: Record<string, unknown>) => ({
        id: newId(),
        name: String(ing.name ?? '').slice(0, 60),
        quantity: Number(ing.quantity) > 0 ? Number(ing.quantity) : 1,
        unit: String(ing.unit ?? 'serving'),
        servings: 1,
        calories: toInt(ing.calories),
        macros: {
          protein: toOneDecimal(ing.protein),
          carbs: toOneDecimal(ing.carbs),
          fats: toOneDecimal(ing.fats),
        },
      }))
    : [];
}

// Map the common { meal_name, calories, protein, carbs, fats } fields returned
// by the AI functions into a MealDraft.
export function mapDraft(data: Record<string, unknown>): MealDraft {
  return {
    name: String(data.meal_name ?? 'New meal').slice(0, 60),
    time: nowHHMM(),
    calories: toInt(data.calories),
    macros: {
      protein: toInt(data.protein),
      carbs: toInt(data.carbs),
      fats: toInt(data.fats),
    },
  };
}

// Pull the { error: { code, message } } contract out of a failed invoke. The
// FunctionsHttpError carries the raw Response on `.context`. Read the body as
// text first (always succeeds) then attempt to parse it as JSON — a gateway-
// level failure (bad/expired JWT, function not deployed, etc.) can return a
// non-JSON body, and swallowing that silently makes it impossible to tell
// "our function returned a typed error" apart from "the request never reached
// our function at all". Always log so a real cause is diagnosable.
async function toAIError(error: unknown, opts: InvokeAIOptions, make: MakeError): Promise<AIError> {
  const ctx = (error as { context?: unknown })?.context as Response | undefined;

  if (ctx && typeof ctx.text === 'function') {
    let raw = '';
    try {
      raw = await ctx.text();
    } catch (readErr) {
      console.warn(`${opts.logPrefix} could not read error response body:`, readErr);
    }

    if (raw) {
      try {
        const body = JSON.parse(raw);
        const code = body?.error?.code as AIErrorCode | undefined;
        const message = body?.error?.message as string | undefined;
        if (code) return make(code, message ?? 'Request failed');
      } catch (parseErr) {
        console.warn(
          `${opts.logPrefix} non-JSON error body (status ${ctx.status}):`,
          raw.slice(0, 300),
          parseErr,
        );
      }
    }

    // Gateway-level rejection (e.g. verify_jwt failed before our code ran) —
    // map the HTTP status to something the UI can act on instead of 'unknown'.
    if (ctx.status === 401 || ctx.status === 403) {
      return make('unauthorized', 'Your session expired. Please sign in again.');
    }
    if (ctx.status === 404) {
      return make(
        'ai_failed',
        opts.notAvailableMessage ?? 'This AI feature is not available yet. Please try again later.',
      );
    }
  }

  // FunctionsFetchError means the request never got a response at all (client
  // aborted it, or a real network failure) — most commonly our own client-side
  // timeout above firing because the function hung longer than expected.
  if ((error as { name?: string })?.name === 'FunctionsFetchError') {
    return make(
      'ai_failed',
      opts.timeoutMessage ?? 'The AI took too long to respond. Please try again.',
    );
  }

  const msg = (error as { message?: string })?.message ?? 'Something went wrong.';
  console.warn(`${opts.logPrefix} falling back to generic error:`, msg);
  return make('unknown', msg);
}

// Invoke an AI edge function and return its raw JSON payload, throwing a typed
// AIError (or subclass, via opts.makeError) on any failure.
export async function invokeAIFunction(
  functionName: string,
  body: Record<string, unknown>,
  opts: InvokeAIOptions,
): Promise<Record<string, unknown>> {
  const make = opts.makeError ?? ((code, message) => new AIError(code, message));
  const startedAt = Date.now();
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    timeout: INVOKE_TIMEOUT_MS,
  });
  console.info(`${opts.logPrefix} invoke took ${Date.now() - startedAt}ms (error=${!!error})`);

  if (error) throw await toAIError(error, opts, make);
  if (!data) throw make('unknown', 'No response returned.');
  return data as Record<string, unknown>;
}
