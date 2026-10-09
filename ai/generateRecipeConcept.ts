// Client wrapper for the `generate-recipe-concept` edge function (Custom Recipe,
// cheap first stage).
//
// Sends the user's freeform description (+ optional meal type) to Supabase,
// which holds the Gemini key server-side, enforces the free-scan-pool
// entitlement gate + rate limit, loads profile context, and returns a
// lightweight concept preview (name + description + rough macros — no
// ingredients/steps). Invoke/timeout/error-parsing plumbing is shared via
// ./aiEdgeClient.

import type { RecipeCategory } from '@/store/types';
import { AIError, type AIErrorCode, invokeAIFunction, toInt } from './aiEdgeClient';
import type { RecipeConcept } from './types';

export type GenerateRecipeConceptErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, rate_limited ->
// toast, etc.), consistent with the other AI wrappers.
export class GenerateRecipeConceptError extends AIError {
  constructor(code: GenerateRecipeConceptErrorCode, message: string) {
    super(code, message);
    this.name = 'GenerateRecipeConceptError';
  }
}

// A concept preview: RecipeConcept shape (with empty ingredients / no steps yet,
// since those are unlocked separately by generate-recipe-steps) plus the short
// description the model wrote, which we keep around to feed the steps call.
export type ConceptPreview = RecipeConcept & { description: string };

export interface GenerateRecipeConceptParams {
  description: string;
  mealType?: RecipeCategory;
}

function mapConcept(
  data: Record<string, unknown>,
  mealType: RecipeCategory,
): ConceptPreview {
  return {
    name: String(data.name ?? '').trim().slice(0, 80) || 'New recipe',
    description: String(data.description ?? '').trim().slice(0, 500),
    category: mealType,
    calories: toInt(data.calories),
    cookTimeMin: 20,
    macros: {
      protein: toInt(data.protein),
      carbs: toInt(data.carbs),
      fats: toInt(data.fats),
    },
    ingredients: [],
    steps: undefined,
  };
}

export async function generateRecipeConcept(
  params: GenerateRecipeConceptParams,
): Promise<ConceptPreview> {
  const mealType: RecipeCategory = params.mealType ?? 'Lunch';
  const body = {
    description: params.description.trim().slice(0, 500),
    mealType: params.mealType,
  };

  const data = await invokeAIFunction('generate-recipe-concept', body, {
    logPrefix: '[generateRecipeConcept]',
    makeError: (code, message) => new GenerateRecipeConceptError(code, message),
    timeoutMessage: 'The AI took too long to sketch your recipe. Please try again.',
    notAvailableMessage: 'AI recipe creation is not available yet. Please try again later.',
  });

  return mapConcept(data, mealType);
}
