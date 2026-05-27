import type {
  ActivityLevel,
  Gender,
  GoalPace,
  GoalType,
  UserGoals,
} from '@/store/types';

// ─── Pure calculation helpers ────────────────────────────────────────────────
// All numbers stay in metric internally (kg, cm). The UI converts to lbs/in
// at the edge based on profile.weightUnit.

// Mifflin–St Jeor.
export function calcBMR(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: Gender
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (gender === 'male') return base + 5;
  if (gender === 'female') return base - 161;
  // Treat 'other' as the average of the two.
  return base - 78;
}

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary:           1.2,
  lightly_active:      1.375,
  moderately_active:   1.55,
  very_active:         1.725,
  extra_active:        1.9,
};

export function calcTDEE(bmr: number, activity: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIER[activity];
}

// Daily kcal delta keyed by goal + pace.
const PACE_DELTA: Record<GoalType, Record<GoalPace, number>> = {
  lose_weight: { slow: -250, moderate: -500, aggressive: -750 },
  maintain:    { slow:    0, moderate:    0, aggressive:    0 },
  gain_muscle: { slow:  150, moderate:  250, aggressive:  400 },
  lean_bulk:   { slow:  250, moderate:  400, aggressive:  600 },
};

// Macro split as fractions of total calories.
const MACRO_SPLIT: Record<GoalType, { p: number; c: number; f: number }> = {
  lose_weight: { p: 0.40, c: 0.35, f: 0.25 },
  maintain:    { p: 0.30, c: 0.45, f: 0.25 },
  gain_muscle: { p: 0.35, c: 0.40, f: 0.25 },
  lean_bulk:   { p: 0.30, c: 0.45, f: 0.25 },
};

// 4 kcal/g for protein & carbs, 9 kcal/g for fat.
const KCAL_PER_G = { p: 4, c: 4, f: 9 };

export interface GoalInputs {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: Gender;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  pace: GoalPace;
}

export interface GoalTargets {
  dailyCalories: number;
  protein: number;          // grams (rounded)
  carbs: number;            // grams
  fats: number;             // grams
  waterTargetCups: number;  // 8oz cups
}

export function calcTargets(inputs: GoalInputs): GoalTargets {
  const bmr = calcBMR(inputs.weightKg, inputs.heightCm, inputs.age, inputs.gender);
  const tdee = calcTDEE(bmr, inputs.activityLevel);
  const calories = Math.max(1200, Math.round(tdee + PACE_DELTA[inputs.goalType][inputs.pace]));

  const split = MACRO_SPLIT[inputs.goalType];
  const protein = Math.round((calories * split.p) / KCAL_PER_G.p);
  const carbs   = Math.round((calories * split.c) / KCAL_PER_G.c);
  const fats    = Math.round((calories * split.f) / KCAL_PER_G.f);

  // ~0.5 oz per lb bodyweight, capped 6–16 cups.
  const lbs = inputs.weightKg * 2.20462;
  const waterTargetCups = Math.min(16, Math.max(6, Math.round((lbs * 0.5) / 8)));

  return { dailyCalories: calories, protein, carbs, fats, waterTargetCups };
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export const GOAL_LABEL: Record<GoalType, string> = {
  lose_weight: 'Lose Weight',
  maintain:    'Maintain',
  gain_muscle: 'Gain Muscle',
  lean_bulk:   'Lean Bulk',
};

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary:           'Sedentary',
  lightly_active:      'Lightly active',
  moderately_active:   'Moderately active',
  very_active:         'Very active',
  extra_active:        'Extra active',
};

export const ACTIVITY_HINT: Record<ActivityLevel, string> = {
  sedentary:           'Little or no exercise.',
  lightly_active:      'Light exercise 1–3 days/week.',
  moderately_active:   'Moderate exercise 3–5 days/week.',
  very_active:         'Hard exercise 6–7 days/week.',
  extra_active:        'Very intense training, physical job.',
};

// Pace label per goal — text varies because surplus vs deficit reads differently.
export function paceLabel(goal: GoalType, pace: GoalPace): string {
  if (goal === 'maintain') {
    return { slow: 'Steady', moderate: 'Steady', aggressive: 'Steady' }[pace];
  }
  if (goal === 'lose_weight') {
    return { slow: '0.5 lb / week', moderate: '1 lb / week', aggressive: '1.5 lb / week' }[pace];
  }
  // gain_muscle / lean_bulk
  return { slow: 'Slow surplus', moderate: 'Moderate surplus', aggressive: 'Aggressive surplus' }[pace];
}

// ─── Unit conversion ─────────────────────────────────────────────────────────

export function kgToLbs(kg: number): number { return kg * 2.20462; }
export function lbsToKg(lbs: number): number { return lbs / 2.20462; }
export function cmToIn(cm: number): number { return cm / 2.54; }
export function inToCm(inches: number): number { return inches * 2.54; }

// Convert a stored UserGoals into a copy with isCalculated cleared, used when
// a manual edit happens.
export function withManualEdit(goals: UserGoals): UserGoals {
  return { ...goals, isCalculated: false };
}
