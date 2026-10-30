// Puts a recipe into the slot a swap was started from: a day's meal (Day
// Detail / meal popup) or a slot in the plan being customized. Shared by the
// recipe picker and the recipe page ("Use this recipe" after Custom Recipe).

import type { PendingSwap, SavedRecipe } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

// Returns an undo that puts back exactly what the swap replaced.
export function applyRecipeSwap(pending: PendingSwap, recipe: SavedRecipe): () => void {
  const deps = useMealStore.getState();
  const prevDayLog = pending.type === 'daily' ? deps.logs[pending.date] : undefined;
  const prevDraft = deps.customizeDraft;
  const undo = () => {
    const st = useMealStore.getState();
    if (pending.type === 'daily') st.restoreDayLog(pending.date, prevDayLog);
    else st.setCustomizeDraft(prevDraft);
  };
  if (pending.type === 'daily') {
    deps.swapMealInDay(
      pending.date,
      { slotId: pending.slotId, slotName: pending.slotName, time: pending.time },
      {
        recipeId: recipe.recipeId,
        name: recipe.name,
        calories: recipe.calories,
        cookTimeMin: recipe.cookTimeMin,
        macros: recipe.macros,
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        category: recipe.category,
        source: recipe.source,
      },
    );
    return undo;
  }

  const draft = deps.customizeDraft;
  if (!draft) return undo;
  const planRecipeId = recipe.recipeId ?? recipe.id;
  const nextDays = draft.draftPlan.days.map((day, di) => {
    if (di !== pending.dayIdx) return day;
    let found = false;
    const updated = day.map(m => {
      if (m.slotName === pending.slotName && m.time === pending.time) {
        found = true;
        return { ...m, recipeId: planRecipeId, recipeName: recipe.name };
      }
      return m;
    });
    if (!found) {
      updated.push({ slotName: pending.slotName, time: pending.time, recipeId: planRecipeId, recipeName: recipe.name });
    }
    return updated.sort((a, b) => a.time.localeCompare(b.time));
  });
  deps.ensureRecipeSaved({
    recipeId: recipe.recipeId,
    name: recipe.name,
    category: recipe.category,
    calories: recipe.calories,
    cookTimeMin: recipe.cookTimeMin,
    macros: recipe.macros,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    source: recipe.source,
  });
  deps.setCustomizeDraft({
    planId: draft.planId,
    draftPlan: { ...draft.draftPlan, days: nextDays },
  });
  return undo;
}
