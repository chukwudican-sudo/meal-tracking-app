import type { MealEntry, MealSlot, RecipeCategory } from '@/store/types';

// Map a meal-slot name to the recipe category used for filtering the Saved
// Recipes swap page. Keyword based so custom slot names still resolve
// (e.g. "Mid-morning Snack" → Snacks, "Pre-workout Lunch" → Lunch).
export function slotNameToCategory(name: string): RecipeCategory | undefined {
  const n = name.toLowerCase();
  if (n.includes('breakfast') || n.includes('brunch')) return 'Breakfast';
  if (n.includes('lunch')) return 'Lunch';
  if (n.includes('dinner') || n.includes('supper')) return 'Dinner';
  if (n.includes('snack')) return 'Snacks';
  return undefined;
}

// The user's meal slot a day's meal sits in — the rule Day Detail places it
// by: its slotId, else the slot at its time. Plan meals carry no slotId and no
// meal-type tag, so their time is what places them (the meal popup's "Swap
// instead" opened on "All" for a plan dinner before, Nov 18).
export function slotForMeal(
  meal: Pick<MealEntry, 'slotId' | 'time'>,
  slots: MealSlot[] | undefined,
): MealSlot | undefined {
  const active = (slots ?? []).filter(s => !s.skipped);
  return (meal.slotId ? active.find(s => s.id === meal.slotId) : undefined)
    ?? active.find(s => s.time === meal.time);
}
