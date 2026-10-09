// Client wrapper for the `generate-recipe-steps` edge function (Custom Recipe,
// "unlock full recipe" second stage).
//
// Sends the concept the user already saw (name + description + macros) to
// Supabase, which enforces the subscription-only entitlement gate (no free-scan
// fallback) + rate limit, and returns the full ingredient list + numbered
// steps. Invoke/timeout/error-parsing plumbing is shared via ./aiEdgeClient.

import { newId } from '@/lib/sync/uuid';
import type { Ingredient, RecipeCategory } from '@/store/types';
import { AIError, type AIErrorCode, invokeAIFunction } from './aiEdgeClient';

export type GenerateRecipeStepsErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, etc.).
export class GenerateRecipeStepsError extends AIError {
  constructor(code: GenerateRecipeStepsErrorCode, message: string) {
    super(code, message);
    this.name = 'GenerateRecipeStepsError';
  }
}

export interface GenerateRecipeStepsParams {
  name: string;
  description?: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  mealType?: RecipeCategory;
}

export interface RecipeStepsResult {
  ingredients: Ingredient[];
  steps: string[];
}

function mapIngredients(raw: unknown): Ingredient[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((ing): Ingredient | null => {
      if (!ing || typeof ing !== 'object') return null;
      const o = ing as Record<string, unknown>;
      const name = String(o.name ?? '').trim().slice(0, 60);
      if (!name) return null;
      const quantity = Number(o.quantity);
      return {
        id: newId(),
        name,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit: String(o.unit ?? 'serving').slice(0, 40),
        servings: 1,
      };
    })
    .filter((i): i is Ingredient => i !== null);
}

function mapSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(s => String(s ?? '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

export async function generateRecipeSteps(
  params: GenerateRecipeStepsParams,
): Promise<RecipeStepsResult> {
  const body = {
    name: params.name.trim().slice(0, 120),
    description: params.description?.trim().slice(0, 500) || undefined,
    calories: params.calories,
    protein: params.protein,
    carbs: params.carbs,
    fats: params.fats,
    mealType: params.mealType,
  };

  const data = await invokeAIFunction('generate-recipe-steps', body, {
    logPrefix: '[generateRecipeSteps]',
    makeError: (code, message) => new GenerateRecipeStepsError(code, message),
    timeoutMessage: 'The AI took too long to write the full recipe. Please try again.',
    notAvailableMessage: 'AI recipe creation is not available yet. Please try again later.',
  });

  return {
    ingredients: mapIngredients(data.ingredients),
    steps: mapSteps(data.steps),
  };
}
