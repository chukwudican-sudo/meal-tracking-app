import { useCallback } from 'react';
import { Alert } from 'react-native';

import type {
  Ingredient,
  Macros,
  RecipeCategory,
  RecipeDifficulty,
  RecipeTemplate,
  SavedRecipe,
  SavedRecipeSource,
} from '@/store/types';
import { toIsoDate, useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import { useUndoStore } from '@/store/useUndoStore';

// Lightweight common shape accepted by all actions. Premade templates and
// SavedRecipes both project cleanly into this.
export interface RecipeInput {
  recipeId?: string;
  name: string;
  calories: number;
  cookTimeMin?: number;
  macros: Macros;
  ingredients: Ingredient[];
  steps?: string[];
  category?: RecipeCategory;
  difficulty?: RecipeDifficulty;
  source?: SavedRecipeSource;
}

// Adapter helpers — components can pass a premade or saved recipe directly.
export function toRecipeInputFromTemplate(t: RecipeTemplate): RecipeInput {
  return {
    recipeId:    t.id,
    name:        t.name,
    calories:    t.calories,
    cookTimeMin: t.cookTimeMin,
    macros:      t.macros,
    ingredients: t.ingredients,
    steps:       t.steps,
    category:    t.category,
    difficulty:  t.difficulty,
    source:      'premade',
  };
}

export function toRecipeInputFromSaved(s: SavedRecipe): RecipeInput {
  return {
    recipeId:    s.recipeId,
    name:        s.name,
    calories:    s.calories,
    cookTimeMin: s.cookTimeMin,
    macros:      s.macros,
    ingredients: s.ingredients,
    steps:       s.steps,
    category:    s.category,
    difficulty:  s.difficulty,
    source:      s.source,
  };
}

export function useRecipeActions() {
  const addRecipeToToday  = useMealStore(s => s.addRecipeToToday);
  const addRecipeToPlan   = useMealStore(s => s.addRecipeToPlan);
  const toggleFavourite   = useMealStore(s => s.toggleFavouriteRecipe);
  const removeMealFromDay = useMealStore(s => s.removeMealFromDay);
  const removeTemplate    = useMealStore(s => s.removeTemplate);
  const showUndo          = useUndoStore(s => s.showUndo);
  const showToast         = useToastStore(s => s.showToast);

  const addToToday = useCallback(
    (recipe: RecipeInput, opts?: { save?: boolean }) => {
      const todayIso = toIsoDate(new Date());
      const entry = addRecipeToToday(recipe, opts);
      showUndo({
        message: 'Added to Today',
        undo: () => removeMealFromDay(todayIso, entry.id),
      });
    },
    [addRecipeToToday, removeMealFromDay, showUndo]
  );

  const addToPlan = useCallback(
    (recipe: RecipeInput) => {
      // For MVP, ask for a date inline via a simple prompt-like dialog.
      // The user types a YYYY-MM-DD; defaults to tomorrow. A full date+time
      // picker can be added later.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const defaultIso = toIsoDate(tomorrow);

      Alert.prompt(
        'Add to Plan',
        'Which date? (YYYY-MM-DD)',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add',
            onPress: (input) => {
              const dateIso = (input ?? '').trim() || defaultIso;
              const template = addRecipeToPlan(recipe, dateIso, '12:00');
              showUndo({
                message: `${recipe.name} added to plan`,
                undo: () => removeTemplate(template.id),
              });
            },
          },
        ],
        'plain-text',
        defaultIso
      );
    },
    [addRecipeToPlan, removeTemplate, showUndo]
  );

  const favourite = useCallback(
    (recipe: RecipeInput) => {
      const updated = toggleFavourite(recipe);
      showToast(updated.favourited ? 'Added to Saved Recipes' : 'Removed from Saved Recipes');
      return updated;
    },
    [toggleFavourite, showToast]
  );

  return { addToToday, addToPlan, favourite };
}
