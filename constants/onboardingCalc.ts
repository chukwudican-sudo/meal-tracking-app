import type { ActivityLevel, Gender } from '@/store/types';
import { calcBMR } from '@/constants/goalCalc';

// ─── Onboarding-specific calculations ────────────────────────────────────────
// These follow the Onboarding Flow Spec exactly (Mifflin–St Jeor BMR, activity
// multipliers, pace-based deficit/surplus, 30/40/30 macro split, water target,
// goal-date projection). Kept separate from goalCalc.ts so the spec's defaults
// aren't entangled with the goal-specific splits used by the Edit Goal flow.

export type OnboardingGoal = 'lose' | 'healthier' | 'muscle';

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary:         1.2,
  lightly_active:    1.375,
  moderately_active: 1.55,
  very_active:       1.725,
  extra_active:      1.9,
};

export const LBS_PER_KG = 2.20462;
export const KG_PER_LB = 1 / LBS_PER_KG;
const L_PER_CUP = 0.2366; // 8 fl oz cup in liters

export interface OnboardingCalcInputs {
  goal: OnboardingGoal;
  gender: Gender;
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  paceLbsPerWeek: number | null; // null for "eat healthier"
}

export interface OnboardingTargets {
  bmr: number;
  tdee: number;
  dailyCalories: number;
  protein: number;         // grams
  carbs: number;           // grams
  fats: number;            // grams
  waterLiters: number;     // rounded to 0.1 L
  waterTargetCups: number; // 8oz cups (stored in UserGoals)
}

// Daily calorie target per the spec: 1 lb/week === 500 kcal/day.
export function calcDailyCalories(inputs: OnboardingCalcInputs, tdee: number): number {
  const pace = inputs.paceLbsPerWeek ?? 0;
  if (inputs.goal === 'lose') {
    const deficit = pace * 500;
    const floor = inputs.gender === 'male' ? 1500 : 1200;
    return Math.max(floor, Math.round(tdee - deficit));
  }
  if (inputs.goal === 'muscle') {
    const surplus = pace * 500;
    return Math.round(tdee + surplus);
  }
  // "eat healthier" → maintenance.
  return Math.round(tdee);
}

export function calcOnboardingTargets(inputs: OnboardingCalcInputs): OnboardingTargets {
  const bmr = calcBMR(inputs.weightKg, inputs.heightCm, inputs.age, inputs.gender);
  const tdee = bmr * ACTIVITY_MULTIPLIER[inputs.activityLevel];
  const dailyCalories = calcDailyCalories(inputs, tdee);

  // Default macro split: 30% protein / 40% carbs / 30% fats.
  const protein = Math.round((dailyCalories * 0.30) / 4);
  const carbs   = Math.round((dailyCalories * 0.40) / 4);
  const fats    = Math.round((dailyCalories * 0.30) / 9);

  // Water: 0.033 L per kg body weight, rounded to nearest 0.1 L.
  const waterLiters = Math.round(inputs.weightKg * 0.033 * 10) / 10;
  const waterTargetCups = Math.max(1, Math.round(waterLiters / L_PER_CUP));

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    dailyCalories,
    protein,
    carbs,
    fats,
    waterLiters,
    waterTargetCups,
  };
}

// Goal timeline: weeks-to-goal = |currentLbs − targetLbs| / paceLbsPerWeek.
// Returns null when the pace/goal makes a projection meaningless.
export function calcGoalDate(
  currentWeightKg: number,
  targetWeightKg: number,
  paceLbsPerWeek: number | null,
): string | null {
  if (!paceLbsPerWeek || paceLbsPerWeek <= 0) return null;
  const diffLbs = Math.abs(currentWeightKg - targetWeightKg) * LBS_PER_KG;
  if (diffLbs < 0.1) return null;
  const weeks = diffLbs / paceLbsPerWeek;
  const date = new Date();
  date.setDate(date.getDate() + Math.round(weeks * 7));
  return date.toISOString().slice(0, 10);
}

export function weeksToGoal(
  currentWeightKg: number,
  targetWeightKg: number,
  paceLbsPerWeek: number | null,
): number | null {
  if (!paceLbsPerWeek || paceLbsPerWeek <= 0) return null;
  const diffLbs = Math.abs(currentWeightKg - targetWeightKg) * LBS_PER_KG;
  if (diffLbs < 0.1) return null;
  return Math.round(diffLbs / paceLbsPerWeek);
}

// Age in whole years from an ISO birthday.
export function ageFromBirthday(iso: string): number {
  const b = new Date(iso + 'T00:00:00');
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return Math.max(0, age);
}
