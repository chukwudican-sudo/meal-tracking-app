// Plan portions and plan nutrition (Nov 10). A premade plan is a fixed
// product you pick ("Lean Muscle Builder, ~2,600 kcal"), so its numbers must
// be TRUE: they are worked out from its meals × portions here, never typed by
// hand (hand-typed targets drifted 10–30% from the meals — Nov 10 audit).
// Pure: no store import, so the store, screens and Find Your Plan share it.

import type {
  Ingredient, Macros, MealPlan, NutrientKey, NutrientValues, PlanCategory, PlanDayMeal,
} from '@/store/types';
import { isPlaceholderSlot } from '@/constants/planSlots';

// Portions move in quarter servings (0.25 … 4).
export const PORTION_STEP = 0.25;
export const MIN_PORTION = 0.25;
export const MAX_PORTION = 4;

export function clampPortion(n: number): number {
  if (!Number.isFinite(n)) return 1;
  const q = Math.round(n / PORTION_STEP) * PORTION_STEP;
  return Math.min(MAX_PORTION, Math.max(MIN_PORTION, q));
}

export function portionOf(m: Pick<PlanDayMeal, 'servings'>): number {
  return m.servings && m.servings > 0 ? clampPortion(m.servings) : 1;
}

// "1.25×" style label; null at 1 (nothing to show).
export function portionLabel(servings: number | undefined): string | null {
  const s = servings ?? 1;
  if (Math.abs(s - 1) < 1e-9) return null;
  return `${Number(s.toFixed(2))}×`;
}

// ─── Scaling ────────────────────────────────────────────────────────────────

export function scaleMacros(m: Macros, ratio: number, decimals = 0): Macros {
  const f = 10 ** decimals;
  return {
    protein: Math.round(m.protein * ratio * f) / f,
    carbs: Math.round(m.carbs * ratio * f) / f,
    fats: Math.round(m.fats * ratio * f) / f,
  };
}

export function scaleNutrients(n: NutrientValues | undefined, ratio: number): NutrientValues | undefined {
  if (!n) return n;
  const out: NutrientValues = {};
  (Object.keys(n) as NutrientKey[]).forEach(k => {
    const v = n[k];
    if (v != null) out[k] = Math.round(v * ratio);
  });
  return out;
}

// Amounts a person would actually measure: grams/ml to 5 (to 1 under 20);
// kg/l/lb to 0.05; oz to a half; spoons and cups to a quarter; countable
// things (eggs, cloves, leaves, units…) to a half, or a quarter under 1
// (¼ lime stays ¼, not ½).
const FINE_UNITS = new Set(['g', 'gram', 'grams', 'ml']);
const BULK_UNITS = new Set(['kg', 'l', 'lb', 'lbs', 'litre', 'liter']);
const SPOON_UNITS = new Set([
  'tbsp', 'tsp', 'cup', 'cups', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons',
]);

export function roundQuantity(q: number, unit: string): number {
  if (!Number.isFinite(q) || q <= 0) return 0;
  const u = unit.trim().toLowerCase();
  if (FINE_UNITS.has(u)) return q >= 20 ? Math.round(q / 5) * 5 : Math.max(1, Math.round(q));
  if (BULK_UNITS.has(u)) return Math.max(0.05, Math.round(q * 20) / 20);
  if (u === 'oz') return Math.max(0.5, Math.round(q * 2) / 2);
  if (SPOON_UNITS.has(u)) return Math.max(0.25, Math.round(q * 4) / 4);
  if (q < 1) return Math.max(0.25, Math.round(q * 4) / 4);
  return Math.round(q * 2) / 2;
}

export function scaleIngredients(items: Ingredient[], ratio: number): Ingredient[] {
  if (Math.abs(ratio - 1) < 1e-9) return items;
  return items.map(i => ({
    ...i,
    quantity: roundQuantity((i.quantity ?? 0) * ratio, i.unit ?? ''),
    calories: i.calories != null ? Math.round(i.calories * ratio) : i.calories,
    macros: i.macros ? scaleMacros(i.macros, ratio, 1) : i.macros,
    nutrients: scaleNutrients(i.nutrients, ratio),
  }));
}

// ─── Plan nutrition ─────────────────────────────────────────────────────────

export interface MealNutrition { calories: number; macros: Macros }
export type ResolveMeal = (recipeId: string, recipeName: string) => MealNutrition | undefined;

export interface PlanNutrition {
  // Average day (what the plan's goals are set to).
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  minCalories: number;
  maxCalories: number;
  // Meals that couldn't be resolved (deleted custom recipe…): numbers are
  // then a lower bound.
  unresolved: number;
}

export function planNutrition(plan: Pick<MealPlan, 'days'>, resolve: ResolveMeal): PlanNutrition | null {
  const days = (plan.days ?? []).filter(d => (d ?? []).some(m => !isPlaceholderSlot(m.recipeId)));
  if (days.length === 0) return null;
  let unresolved = 0;
  const totals = days.map(day => {
    const t = { calories: 0, protein: 0, carbs: 0, fats: 0 };
    for (const m of day) {
      if (isPlaceholderSlot(m.recipeId)) continue;
      const n = resolve(m.recipeId, m.recipeName);
      if (!n) { unresolved++; continue; }
      const s = portionOf(m);
      t.calories += n.calories * s;
      t.protein += n.macros.protein * s;
      t.carbs += n.macros.carbs * s;
      t.fats += n.macros.fats * s;
    }
    return t;
  });
  const avg = (k: keyof (typeof totals)[number]) => Math.round(totals.reduce((n, t) => n + t[k], 0) / totals.length);
  // Plan calories read as a clean number (Alex, Nov 10): nearest 10, so
  // 2,007 → 2,010 on the card, the page and the goal alike (≤5 kcal — well
  // inside normal food variation). Macros stay whole grams.
  const to10 = (n: number) => Math.round(n / 10) * 10;
  return {
    calories: to10(totals.reduce((n, t) => n + t.calories, 0) / totals.length),
    protein: avg('protein'),
    carbs: avg('carbs'),
    fats: avg('fats'),
    minCalories: to10(Math.min(...totals.map(t => t.calories))),
    maxCalories: to10(Math.max(...totals.map(t => t.calories))),
    unresolved,
  };
}

// Plans with a style (every premade plan, and the user's customized copies of
// one) set the user's goals to their real numbers while running — you pick a
// plan for its calories and macros. Plans the user builds keep the user's own
// goals.
export function planSetsGoals(plan: Pick<MealPlan, 'category'>): boolean {
  return !!plan.category;
}

// The plan styles (single list; sync validates against it).
export const PLAN_CATEGORIES = [
  'Balanced', 'High Protein', 'Low Carb', 'High Fiber', 'Keto', 'Mediterranean',
] as const satisfies readonly PlanCategory[];

export function isPlanCategory(v: unknown): v is PlanCategory {
  return typeof v === 'string' && (PLAN_CATEGORIES as readonly string[]).includes(v);
}
