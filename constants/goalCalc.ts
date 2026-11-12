import type {
  ActivityLevel,
  Gender,
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
  // An unknown level (old or bad data) counts as sedentary, never NaN.
  return bmr * (ACTIVITY_MULTIPLIER[activity] ?? ACTIVITY_MULTIPLIER.sedentary);
}

// ─── The one goal calculator (Nov 11) ───────────────────────────────────────
// Onboarding and Edit Goal both call calcTargets, so the same person always
// gets the same numbers (they used to run two different formulas).
//
// Calories (Alex's onboarding spec): Mifflin–St Jeor BMR × activity, then
// 1 lb/week of change = 500 kcal/day of deficit or surplus. Never below
// 1,200 kcal; a man losing weight never below 1,500.
//
// Macros, the way coaching apps set them: protein from BODY WEIGHT (not a
// share of calories, which gave a 62 kg person 197 g), fat as a share of
// calories with a healthy minimum, carbs fill the rest.

const KCAL_PER_LB_PER_WEEK = 500;

// Pace in lb/week, picked on one slider (components/PaceSlider) in both
// onboarding and Edit Goal: losing 0.5–2, gaining 0.25–1, in 0.25 steps.
export const PACE_STEP = 0.25;
export const DEFAULT_PACE_LBS = 1;

export function paceRange(goal: GoalType): { min: number; max: number } | null {
  if (goal === 'lose_weight') return { min: 0.5, max: 2 };
  if (goal === 'maintain') return null;
  return { min: 0.25, max: 1 };
}

// The pace actually used for a goal: inside its range, on a 0.25 step (a 2 lb
// loss pace carried over to a muscle goal becomes 1). Null for maintain.
export function clampPace(goal: GoalType, lbs: number | null | undefined): number | null {
  const r = paceRange(goal);
  if (!r) return null;
  const v = lbs != null && Number.isFinite(lbs) && lbs > 0 ? lbs : DEFAULT_PACE_LBS;
  const snapped = Math.round(v / PACE_STEP) * PACE_STEP;
  return Math.min(r.max, Math.max(r.min, snapped));
}

// −1 losing, 0 maintaining, +1 gaining.
export function goalDirection(g: GoalType): -1 | 0 | 1 {
  return g === 'lose_weight' ? -1 : g === 'maintain' ? 0 : 1;
}

// "1.5 lbs / week" or "0.68 kg / week" (same wording as onboarding's slider).
export function formatPace(lbsPerWeek: number, imperial: boolean): string {
  return imperial
    ? `${lbsPerWeek} lbs / week`
    : `${Math.round((lbsPerWeek / 2.20462) * 100) / 100} kg / week`;
}

// Protein in g per kg (ISSN position stand: 1.4–2.0 g/kg a day for people who
// exercise, toward the top while in a deficit to keep muscle).
const PROTEIN_G_PER_KG: Record<GoalType, number> = {
  lose_weight: 2.0,
  maintain:    1.6,
  gain_muscle: 2.0,
  lean_bulk:   2.0,
};
// Fat as a share of calories, never under 0.6 g/kg (hormone health).
const FAT_SHARE: Record<GoalType, number> = {
  lose_weight: 0.25,
  maintain:    0.30,
  gain_muscle: 0.25,
  lean_bulk:   0.25,
};
const FAT_MIN_G_PER_KG = 0.6;
// Ceilings so carbs always keep at least a quarter of the calories, even on a
// 1,200 kcal day.
const PROTEIN_MAX_SHARE = 0.40;
const FAT_MAX_SHARE = 0.35;
// A heavier body is mostly extra fat, not extra muscle needing protein: above
// a BMI of 25, protein uses the weight at a BMI of 25 for your height
// (without it, a 120 kg person eating healthier would be set 190 g+).
const PROTEIN_BMI_CAP = 25;

// 4 kcal/g for protein & carbs, 9 kcal/g for fat.
const KCAL_PER_G = { p: 4, c: 4, f: 9 };

const L_PER_CUP = 0.2366; // 8 fl oz cup in liters

export interface GoalInputs {
  weightKg: number;
  // Goal weight — protein while losing is based on it (the body you're
  // keeping), when it's below the current weight.
  targetWeightKg?: number | null;
  heightCm: number;
  age: number;
  gender: Gender;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  paceLbsPerWeek: number | null; // ignored for maintain; clamped by clampPace
}

export interface GoalTargets {
  bmr: number;
  tdee: number;
  dailyCalories: number;
  protein: number;          // grams (rounded)
  carbs: number;            // grams
  fats: number;             // grams
  waterTargetCups: number;  // 8oz cups
}

// The body weight protein (and the fat minimum) are counted from.
export function proteinWeightKg(i: Pick<GoalInputs, 'weightKg' | 'targetWeightKg' | 'heightCm' | 'goalType'>): number {
  let w = i.weightKg;
  const t = i.targetWeightKg;
  if (i.goalType === 'lose_weight' && t != null && Number.isFinite(t) && t > 0 && t < w) w = t;
  const m = i.heightCm / 100;
  if (Number.isFinite(m) && m > 0) w = Math.min(w, PROTEIN_BMI_CAP * m * m);
  return w;
}

export function calcTargets(inputs: GoalInputs): GoalTargets {
  const g = inputs.goalType;
  const bmr = calcBMR(inputs.weightKg, inputs.heightCm, inputs.age, inputs.gender);
  const tdee = calcTDEE(bmr, inputs.activityLevel);

  const pace = clampPace(g, inputs.paceLbsPerWeek) ?? 0;
  const direction = goalDirection(g);
  const floor = g === 'lose_weight' && inputs.gender === 'male' ? 1500 : 1200;
  const calories = Math.max(floor, Math.round(tdee + direction * pace * KCAL_PER_LB_PER_WEEK));

  const w = proteinWeightKg(inputs);
  const protein = Math.round(Math.min(
    w * PROTEIN_G_PER_KG[g],
    (calories * PROTEIN_MAX_SHARE) / KCAL_PER_G.p,
  ));
  const fats = Math.round(Math.min(
    Math.max((calories * FAT_SHARE[g]) / KCAL_PER_G.f, w * FAT_MIN_G_PER_KG),
    (calories * FAT_MAX_SHARE) / KCAL_PER_G.f,
  ));
  const carbs = Math.max(0, Math.round(
    (calories - protein * KCAL_PER_G.p - fats * KCAL_PER_G.f) / KCAL_PER_G.c,
  ));

  // Water (onboarding spec): 0.033 L per kg, to the nearest 0.1 L, as 8 oz
  // cups — kept within 6–16 cups (16 ≈ 3.8 L, the top of daily guidance).
  const waterLiters = Math.round(inputs.weightKg * 0.033 * 10) / 10;
  const waterTargetCups = Math.min(16, Math.max(6, Math.round(waterLiters / L_PER_CUP)));

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    dailyCalories: calories,
    protein,
    carbs,
    fats,
    waterTargetCups,
  };
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
