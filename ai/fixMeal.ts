// Client wrapper for the `fix-meal` edge function (AI correction).
//
// Sends the current meal estimate + a free-text correction to Supabase, which
// holds the Gemini key server-side, enforces the premium gate + rate limit, and
// returns the fully corrected meal. Invoke/timeout/error-parsing/mapping
// plumbing is shared via ./aiEdgeClient.

import type { Ingredient } from '@/store/types';
import type { MealDraft } from './types';
import {
  AIError,
  type AIErrorCode,
  invokeAIFunction,
  mapDraft,
  mapIngredients,
} from './aiEdgeClient';

export type FixErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, rate_limited ->
// "try again later", etc.), consistent with EstimateError.
export class FixError extends AIError {
  constructor(code: FixErrorCode, message: string) {
    super(code, message);
    this.name = 'FixError';
  }
}

export interface FixMealResult {
  draft: MealDraft;
  ingredients: Ingredient[];
}

// Shape the edge function expects for the current meal being corrected. Mirrors
// estimate-nutrition's response field names for symmetry on the wire.
function toCurrentDraft(draft: MealDraft, ingredients: Ingredient[]): Record<string, unknown> {
  return {
    meal_name: draft.name,
    calories: draft.calories,
    protein: draft.macros.protein,
    carbs: draft.macros.carbs,
    fats: draft.macros.fats,
    ingredients: ingredients.map(i => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      calories: i.calories ?? 0,
      protein: i.macros?.protein ?? 0,
      carbs: i.macros?.carbs ?? 0,
      fats: i.macros?.fats ?? 0,
    })),
  };
}

export async function fixMeal(
  fixText: string,
  draft: MealDraft,
  ingredients: Ingredient[],
  // Earlier corrections to this same meal (oldest first) so a follow-up builds
  // on them instead of starting over.
  history: string[] = [],
  // Scan id (scan card) or meal id (meal popup), for the server's ai_events log.
  flowId?: string,
): Promise<FixMealResult> {
  const data = await invokeAIFunction(
    'fix-meal',
    { fixText, currentDraft: toCurrentDraft(draft, ingredients), history, flow_id: flowId },
    {
      logPrefix: '[fixMeal]',
      makeError: (code, message) => new FixError(code, message),
      timeoutMessage: 'The AI corrector took too long to respond. Please try again.',
      notAvailableMessage: 'AI corrections are not available yet. Please try again later.',
    },
  );

  return {
    draft: mapDraft(data),
    ingredients: mapIngredients(data.ingredients),
  };
}
