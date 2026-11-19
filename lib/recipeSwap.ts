// Puts a recipe into the slot a swap was started from: a day's meal (Day
// Detail / meal popup) or a slot in the plan being customized. Shared by the
// recipe picker and the recipe page ("Use this recipe" after Custom Recipe).

import { isPlaceholderSlot } from '@/constants/planSlots';
import { portionOf, swapPortion } from '@/lib/planNutrition';
import type { PendingSwap, PlanDayMeal, SavedRecipe } from '@/store/types';
import { planMealResolver, useMealStore } from '@/store/useMealStore';

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
      { slotId: pending.slotId, mealId: pending.mealId, slotName: pending.slotName, time: pending.time },
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
  // The slot keeps its calories (same rule as a day's swap, swapPortion): the
  // new recipe's portion is sized to what the replaced meal gave the plan.
  // Both sides come from the resolver the plan's numbers and meals use — not
  // `recipe.calories`, which may be an older saved copy of a built-in recipe.
  // An empty/removed slot has no calories to keep — the recipe goes in at 1×.
  // Saved first, so the resolver finds the new recipe (never a name guess).
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
  const fresh = useMealStore.getState();
  const resolve = planMealResolver(fresh.recipes, fresh.savedRecipes);
  const newCalories = resolve(planRecipeId, recipe.name).calories;
  const swapped = (m: PlanDayMeal): PlanDayMeal => {
    const next: PlanDayMeal = { ...m, recipeId: planRecipeId, recipeName: recipe.name };
    const portion = isPlaceholderSlot(m.recipeId)
      ? 1
      : swapPortion(resolve(m.recipeId, m.recipeName).calories * portionOf(m), newCalories) ?? portionOf(m);
    if (portion === 1) delete next.servings;
    else next.servings = portion;
    return next;
  };
  const nextDays = draft.draftPlan.days.map((day, di) => {
    if (di !== pending.dayIdx) return day;
    let found = false;
    const updated = day.map(m => {
      if (m.slotName === pending.slotName && m.time === pending.time) {
        found = true;
        return swapped(m);
      }
      return m;
    });
    if (!found) {
      updated.push({ slotName: pending.slotName, time: pending.time, recipeId: planRecipeId, recipeName: recipe.name });
    }
    return updated.sort((a, b) => a.time.localeCompare(b.time));
  });
  deps.setCustomizeDraft({
    planId: draft.planId,
    draftPlan: { ...draft.draftPlan, days: nextDays },
  });
  return undo;
}
