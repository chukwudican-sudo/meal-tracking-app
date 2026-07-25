// Client wrapper for the `estimate-nutrition` edge function (AI Describe).
//
// Replaces the client-side OpenAI call for the initial meal estimate: the
// request goes to Supabase, which holds the Gemini key server-side, enforces
// the premium gate + rate limit, and returns a structured estimate. The
// supabase-js client automatically attaches the signed-in user's access token.
//
// Invoke/timeout/error-parsing/mapping plumbing is shared via ./aiEdgeClient.

import type { Ingredient, RecipeCategory } from '@/store/types';
import type { MealDraft } from './types';
import {
  AIError,
  type AIErrorCode,
  invokeAIFunction,
  mapDraft,
  mapIngredients,
  toInt,
} from './aiEdgeClient';

export type EstimateErrorCode = AIErrorCode;

// Typed error so the UI can branch (e.g. not_premium -> paywall, rate_limited
// -> "try again later") instead of showing a single generic message.
export class EstimateError extends AIError {
  constructor(code: EstimateErrorCode, message: string) {
    super(code, message);
    this.name = 'EstimateError';
  }
}

export interface EstimateResult {
  draft: MealDraft;
  ingredients: Ingredient[];
  category?: RecipeCategory;
  healthRating?: number;
  description?: string;
}

const MEAL_TYPES: RecipeCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

function asCategory(value: unknown): RecipeCategory | undefined {
  return MEAL_TYPES.find(c => c === value);
}

export async function estimateNutrition(description: string): Promise<EstimateResult> {
  const data = await invokeAIFunction(
    'estimate-nutrition',
    { description },
    {
      logPrefix: '[estimateNutrition]',
      makeError: (code, message) => new EstimateError(code, message),
      timeoutMessage: 'The AI estimator took too long to respond. Please try again.',
      notAvailableMessage: 'AI Describe is not available yet. Please try again later.',
    },
  );

  return {
    draft: mapDraft(data),
    ingredients: mapIngredients(data.ingredients),
    category: asCategory(data.meal_type),
    healthRating: toInt(data.health_rating) || undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
  };
}
