import { COLORS } from '@/constants/theme';
import type { Macros, UserGoals } from '@/store/types';

export interface MealRating {
  label: string;
  color: string;
}

// Contextual rating. Compares a meal's calories/macros to the user's daily goal
// and surfaces the most actionable single-sentence signal — not a generic grade.
// Shared by the Scan result badge and the meal detail popup.
export function rateMeal(
  meal: { calories: number; macros: Macros },
  goals: UserGoals,
): MealRating {
  const calRatio     = goals.dailyCalories > 0 ? meal.calories / goals.dailyCalories : 0;
  const proteinRatio = goals.protein > 0 ? meal.macros.protein / goals.protein : 0;
  const carbsRatio   = goals.carbs   > 0 ? meal.macros.carbs   / goals.carbs   : 0;
  const fatsRatio    = goals.fats    > 0 ? meal.macros.fats    / goals.fats    : 0;

  if (calRatio >= 0.6) {
    return { label: `Heavy meal — ${Math.round(calRatio * 100)}% of your daily calories`, color: COLORS.orange };
  }
  if (proteinRatio >= 0.4) {
    return { label: `Solid protein hit — ${meal.macros.protein}g`, color: COLORS.green };
  }
  if (carbsRatio >= 0.5 && carbsRatio > fatsRatio) {
    return { label: `Carb-heavy — watch the rest of the day`, color: COLORS.orange };
  }
  if (fatsRatio >= 0.5) {
    return { label: `Fat-heavy — balance with leaner meals later`, color: COLORS.orange };
  }
  if (calRatio < 0.1) {
    return { label: `Light snack — fits easily in your day`, color: COLORS.green };
  }
  return { label: `Balanced — fits comfortably in your goals`, color: COLORS.green };
}

export type MealGrade = 'Good' | 'Okay' | 'Poor';

export interface MealGradeRating {
  label: MealGrade;
  color: string;
}

// Coarse, at-a-glance grade for the meal detail header. Good = balanced and
// protein-forward; Poor = overly calorie- or fat-dominant relative to goals;
// otherwise Okay. Used by the meal detail popup badge.
export function rateMealGrade(
  meal: { calories: number; macros: Macros },
  goals: UserGoals,
): MealGradeRating {
  const calRatio     = goals.dailyCalories > 0 ? meal.calories / goals.dailyCalories : 0;
  const proteinRatio = goals.protein > 0 ? meal.macros.protein / goals.protein : 0;
  const fatsRatio    = goals.fats    > 0 ? meal.macros.fats    / goals.fats    : 0;

  // Poor: dominates the day's calories or is very fat-heavy.
  if (calRatio >= 0.6 || fatsRatio >= 0.6) {
    return { label: 'Poor', color: COLORS.red };
  }
  // Good: a solid protein contribution without blowing the calorie budget.
  if (proteinRatio >= 0.3 && calRatio <= 0.45) {
    return { label: 'Good', color: COLORS.green };
  }
  // Everything in between.
  return { label: 'Okay', color: COLORS.orange };
}
