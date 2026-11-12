import type { ActivityLevel, Gender, GoalType } from '@/store/types';
import { calcTargets, type GoalTargets } from '@/constants/goalCalc';

// ─── Onboarding-specific helpers ─────────────────────────────────────────────
// The targets themselves come from the one calculator in goalCalc.ts (shared
// with Edit Goal). This file keeps onboarding's goal names, the goal-date
// projection and unit constants.

export type OnboardingGoal = 'lose' | 'healthier' | 'muscle';

export const ONBOARDING_GOAL_TYPE: Record<OnboardingGoal, GoalType> = {
  lose: 'lose_weight',
  healthier: 'maintain',
  muscle: 'gain_muscle',
};

export const LBS_PER_KG = 2.20462;
export const KG_PER_LB = 1 / LBS_PER_KG;

export interface OnboardingCalcInputs {
  goal: OnboardingGoal;
  gender: Gender;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number | null;
  activityLevel: ActivityLevel;
  paceLbsPerWeek: number | null; // null for "eat healthier"
}

export function calcOnboardingTargets(inputs: OnboardingCalcInputs): GoalTargets {
  return calcTargets({
    weightKg: inputs.weightKg,
    targetWeightKg: inputs.targetWeightKg,
    heightCm: inputs.heightCm,
    age: inputs.age,
    gender: inputs.gender,
    activityLevel: inputs.activityLevel,
    goalType: ONBOARDING_GOAL_TYPE[inputs.goal],
    paceLbsPerWeek: inputs.paceLbsPerWeek,
  });
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
  // Local calendar date (toISOString is UTC: a day late on evenings west of UTC).
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
