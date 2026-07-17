import type { RecipeCategory } from '@/store/types';

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
