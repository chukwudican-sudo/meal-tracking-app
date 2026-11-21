import { useMemo } from 'react';

import { recipeRequiresPro } from '@/lib/entitlements';
import type { Ingredient, Macros, RecipeDifficulty } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

// One recipe looked up by the id a recipe route carries: a built-in recipe's
// id, or a saved recipe's own id. Shared by the full recipe page and the
// Recipe Assistant page so both always show the same recipe.
export interface ResolvedRecipe {
  source: 'premade' | 'saved';
  // Whether viewing the full ingredients/steps requires an active Pro
  // subscription — see lib/entitlements.ts#recipeRequiresPro. Always false
  // for 'manual' saved recipes, always true for 'ai', and flag-dependent for
  // premade (RecipeTemplate.isFree).
  requiresPro: boolean;
  id: string;
  recipeId?: string;
  name: string;
  category?: string;
  calories: number;
  cookTimeMin?: number;
  macros: Macros;
  ingredients: Ingredient[];
  steps?: string[];
  difficulty?: RecipeDifficulty;
  favourited: boolean;
}

export function useResolvedRecipe(id: string): ResolvedRecipe | null {
  const recipes = useMealStore(s => s.recipes);
  const savedRecipes = useMealStore(s => s.savedRecipes);

  return useMemo<ResolvedRecipe | null>(() => {
    const premade = recipes.find(r => r.id === id);
    if (premade) {
      const saved = savedRecipes.find(s => s.recipeId === premade.id);
      return {
        source: 'premade',
        requiresPro: recipeRequiresPro({ source: 'premade', isFree: premade.isFree }),
        id: premade.id,
        recipeId: premade.id,
        name: premade.name,
        category: premade.category,
        calories: premade.calories,
        cookTimeMin: premade.cookTimeMin,
        macros: premade.macros,
        ingredients: premade.ingredients,
        steps: premade.steps,
        difficulty: premade.difficulty,
        favourited: !!saved?.favourited,
      };
    }
    const saved = savedRecipes.find(s => s.id === id);
    if (saved) {
      // A saved copy of a premade recipe (source 'premade') defers to the
      // linked catalog entry's isFree flag rather than being unconditionally
      // free/paid itself.
      const linkedPremade = saved.source === 'premade'
        ? recipes.find(r => r.id === saved.recipeId)
        : undefined;
      return {
        source: 'saved',
        requiresPro: recipeRequiresPro({ source: saved.source, isFree: linkedPremade?.isFree }),
        id: saved.id,
        recipeId: saved.recipeId,
        name: saved.name,
        category: saved.category,
        calories: saved.calories,
        cookTimeMin: saved.cookTimeMin,
        macros: saved.macros,
        ingredients: saved.ingredients,
        steps: saved.steps,
        difficulty: saved.difficulty,
        favourited: saved.favourited,
      };
    }
    return null;
  }, [recipes, savedRecipes, id]);
}
