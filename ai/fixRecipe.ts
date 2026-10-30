// Client wrapper for the `fix-recipe` edge function: applies a free-text
// correction to a full recipe (ingredients, steps, per-serving macros).
// Invoke/timeout/error plumbing is shared via ./aiEdgeClient.

import type { Ingredient, Macros } from '@/store/types';
import { AIError, type AIErrorCode, invokeAIFunction, mapRecipeIngredients, toInt } from './aiEdgeClient';

export class FixRecipeError extends AIError {
  constructor(code: AIErrorCode, message: string) {
    super(code, message);
    this.name = 'FixRecipeError';
  }
}

export interface RecipeForFix {
  name: string;
  calories: number;
  macros: Macros;
  cookTimeMin?: number;
  ingredients: Ingredient[];
  steps: string[];
}

// The name never changes on a Fix (plans refer to recipes by name).
export interface FixedRecipe {
  calories: number;
  macros: Macros;
  cookTimeMin?: number;
  ingredients: Ingredient[];
  steps: string[];
}

export async function fixRecipe(
  fixText: string,
  recipe: RecipeForFix,
  // Earlier corrections to this recipe (oldest first) so a follow-up builds on them.
  history: string[] = [],
  // Recipe id, for the server's ai_events log.
  flowId?: string,
): Promise<FixedRecipe> {
  const data = await invokeAIFunction(
    'fix-recipe',
    {
      fixText,
      history,
      flow_id: flowId,
      recipe: {
        name: recipe.name,
        calories: recipe.calories,
        protein: recipe.macros.protein,
        carbs: recipe.macros.carbs,
        fats: recipe.macros.fats,
        cook_time_minutes: recipe.cookTimeMin ?? null,
        ingredients: recipe.ingredients.map(i => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
        steps: recipe.steps,
      },
    },
    {
      logPrefix: '[fixRecipe]',
      makeError: (code, message) => new FixRecipeError(code, message),
      timeoutMessage: 'The AI took too long to update this recipe. Please try again.',
      notAvailableMessage: 'Recipe corrections are not available yet. Please try again later.',
    },
  );

  const ingredients = mapRecipeIngredients(data.ingredients);
  const steps = (Array.isArray(data.steps) ? data.steps : [])
    .map((s: unknown) => String(s ?? '').trim())
    .filter(Boolean);
  // A recipe that had steps must keep some; one saved without steps may stay so.
  if (ingredients.length === 0 || (recipe.steps.length > 0 && steps.length === 0)) {
    throw new FixRecipeError('ai_failed', 'Could not update this recipe. Please try again.');
  }
  const cook = Number(data.cook_time_minutes);
  return {
    calories: toInt(data.calories),
    macros: { protein: toInt(data.protein), carbs: toInt(data.carbs), fats: toInt(data.fats) },
    cookTimeMin: Number.isFinite(cook) && cook > 0 ? Math.round(cook) : recipe.cookTimeMin,
    ingredients,
    steps,
  };
}
