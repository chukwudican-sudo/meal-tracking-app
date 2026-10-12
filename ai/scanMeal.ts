// Client wrapper for the `scan-meal` edge function (photo-based AI scan).
//
// Sends a captured/uploaded photo (inline base64) to Supabase, which holds the
// Gemini key server-side, enforces the premium gate + rate limit, and returns a
// minimal nutrition estimate. Invoke/timeout/error-parsing/mapping plumbing is
// shared via ./aiEdgeClient.

import type { MealDraft } from './types';
import { AIError, type AIErrorCode, invokeAIFunction, mapDraft } from './aiEdgeClient';

export type ScanErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, rate_limited ->
// toast, etc.), consistent with EstimateError/FixError.
export class ScanError extends AIError {
  constructor(code: ScanErrorCode, message: string) {
    super(code, message);
    this.name = 'ScanError';
  }
}

// Strip a `data:<mime>;base64,` prefix if present, leaving the bare base64 the
// edge function expects. The camera/picker hand us either the raw base64
// (shot.base64) or a full data URI depending on the caller.
function stripDataUriPrefix(input: string): string {
  const comma = input.indexOf('base64,');
  return comma >= 0 ? input.slice(comma + 'base64,'.length) : input;
}

// 'meal' estimates a plated meal; 'label' reads a packaged food's Nutrition
// Facts label (per serving). Both return the same draft shape and share quota.
export type ScanMode = 'meal' | 'label';

export async function scanMeal(
  imageBase64: string,
  mimeType = 'image/jpeg',
  mode: ScanMode = 'meal',
): Promise<MealDraft> {
  const data = await invokeAIFunction(
    'scan-meal',
    { imageBase64: stripDataUriPrefix(imageBase64), mimeType, mode },
    {
      logPrefix: '[scanMeal]',
      makeError: (code, message) => new ScanError(code, message),
      timeoutMessage: 'The AI scanner took too long to respond. Please try again.',
      notAvailableMessage: 'AI meal scanning is not available yet. Please try again later.',
    },
  );

  return mapDraft(data);
}
