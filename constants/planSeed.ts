import type { PlanDayMeal, PlanTemplate } from '@/store/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Shorthand for slot+time bundles to keep day-array literals readable.
const BREAKFAST = (recipeId: string, name: string): PlanDayMeal => ({
  slotName: 'Breakfast', time: '07:30', recipeId, recipeName: name,
});
const MIDMORN = (recipeId: string, name: string): PlanDayMeal => ({
  slotName: 'Mid-morning Snack', time: '10:30', recipeId, recipeName: name,
});
const LUNCH = (recipeId: string, name: string): PlanDayMeal => ({
  slotName: 'Lunch', time: '13:00', recipeId, recipeName: name,
});
const AFTERNOON = (recipeId: string, name: string): PlanDayMeal => ({
  slotName: 'Afternoon Snack', time: '15:30', recipeId, recipeName: name,
});
const DINNER = (recipeId: string, name: string): PlanDayMeal => ({
  slotName: 'Dinner', time: '19:00', recipeId, recipeName: name,
});

// Build a 7-day pattern by rotating breakfast/lunch/dinner options.
// Indices supply variety while keeping macro profiles within the same family.
function rotateDays(
  breakfasts: { id: string; name: string }[],
  lunches: { id: string; name: string }[],
  dinners: { id: string; name: string }[],
  snacks: { id: string; name: string }[],
  includeSnacks: { am: boolean; pm: boolean },
): PlanDayMeal[][] {
  return Array.from({ length: 7 }, (_, day) => {
    const bf = breakfasts[day % breakfasts.length];
    const ln = lunches[day % lunches.length];
    const dn = dinners[day % dinners.length];
    const am = snacks[day % snacks.length];
    const pm = snacks[(day + 1) % snacks.length];
    const meals: PlanDayMeal[] = [BREAKFAST(bf.id, bf.name)];
    if (includeSnacks.am) meals.push(MIDMORN(am.id, am.name));
    meals.push(LUNCH(ln.id, ln.name));
    if (includeSnacks.pm) meals.push(AFTERNOON(pm.id, pm.name));
    meals.push(DINNER(dn.id, dn.name));
    return meals;
  });
}

const DEFAULT_DISCLAIMER =
  'These meals are a starting point. Adjust portions and ingredients to match your goals, preferences, and any medical advice.';

// ─── Plans ───────────────────────────────────────────────────────────────────

export const PLAN_SEED: PlanTemplate[] = [
  // ── Balanced ────────────────────────────────────────────────────────────
  {
    id: 'plan-balanced-weekday',
    name: 'Balanced Weekday',
    description: 'A 5-meal balanced split designed for steady energy and easy maintenance.',
    disclaimer: DEFAULT_DISCLAIMER,
    category: 'Balanced',
    targets: { calories: 2200, protein: 165, carbs: 220, fats: 65 },
    days: rotateDays(
      [
        { id: 'rcp-bf-oats-berries',      name: 'Oats & Berries' },
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl' },
        { id: 'rcp-bf-avocado-toast',     name: 'Avocado Toast' },
      ],
      [
        { id: 'rcp-ln-chicken-caesar', name: 'Chicken Caesar Salad' },
        { id: 'rcp-ln-turkey-sandwich', name: 'Turkey Sandwich' },
        { id: 'rcp-ln-quinoa-bowl',    name: 'Quinoa Power Bowl' },
      ],
      [
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice' },
        { id: 'rcp-dn-chicken-stir-fry', name: 'Chicken Stir-Fry' },
        { id: 'rcp-dn-pasta-primavera',  name: 'Pasta Primavera' },
      ],
      [
        { id: 'rcp-sn-yogurt-honey',    name: 'Greek Yogurt with Honey' },
        { id: 'rcp-sn-apple-almonds',   name: 'Apple & Almonds' },
        { id: 'rcp-sn-hummus-carrots',  name: 'Hummus & Carrots' },
      ],
      { am: true, pm: true },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },
  {
    id: 'plan-balanced-relaxed',
    name: 'Balanced Three-Meal',
    description: 'Three solid meals — perfect if snacks aren\'t your thing.',
    disclaimer: DEFAULT_DISCLAIMER,
    category: 'Balanced',
    targets: { calories: 2000, protein: 140, carbs: 210, fats: 65 },
    days: rotateDays(
      [
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl' },
        { id: 'rcp-bf-avocado-toast',     name: 'Avocado Toast' },
        { id: 'rcp-bf-veggie-omelette',   name: 'Veggie Omelette' },
      ],
      [
        { id: 'rcp-ln-quinoa-bowl',     name: 'Quinoa Power Bowl' },
        { id: 'rcp-ln-turkey-sandwich', name: 'Turkey Sandwich' },
        { id: 'rcp-ln-tuna-wrap',       name: 'Tuna Wrap' },
      ],
      [
        { id: 'rcp-dn-pasta-primavera',  name: 'Pasta Primavera' },
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice' },
        { id: 'rcp-dn-veggie-curry',     name: 'Veggie Curry' },
      ],
      [{ id: 'rcp-sn-apple-almonds', name: 'Apple & Almonds' }],
      { am: false, pm: false },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },

  // ── High Protein ────────────────────────────────────────────────────────
  {
    id: 'plan-high-protein-builder',
    name: 'Lean Muscle Builder',
    description: 'Protein-forward at every slot for hypertrophy training blocks.',
    disclaimer: DEFAULT_DISCLAIMER,
    category: 'High Protein',
    targets: { calories: 2600, protein: 210, carbs: 230, fats: 75 },
    days: rotateDays(
      [
        { id: 'rcp-bf-protein-pancakes',  name: 'Protein Pancakes' },
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl' },
        { id: 'rcp-bf-veggie-omelette',   name: 'Veggie Omelette' },
      ],
      [
        { id: 'rcp-ln-chicken-caesar', name: 'Chicken Caesar Salad' },
        { id: 'rcp-ln-tuna-wrap',      name: 'Tuna Wrap' },
        { id: 'rcp-ln-turkey-sandwich', name: 'Turkey Sandwich' },
      ],
      [
        { id: 'rcp-dn-chicken-stir-fry', name: 'Chicken Stir-Fry' },
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice' },
        { id: 'rcp-dn-beef-tacos',       name: 'Beef Tacos' },
      ],
      [
        { id: 'rcp-sn-protein-smoothie', name: 'Protein Smoothie' },
        { id: 'rcp-sn-yogurt-honey',     name: 'Greek Yogurt with Honey' },
      ],
      { am: true, pm: true },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },
  {
    id: 'plan-high-protein-cut',
    name: 'High Protein Cut',
    description: 'Higher protein, lower calorie — built for a sustainable deficit.',
    disclaimer: DEFAULT_DISCLAIMER,
    category: 'High Protein',
    targets: { calories: 1800, protein: 180, carbs: 140, fats: 55 },
    days: rotateDays(
      [
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl' },
        { id: 'rcp-bf-veggie-omelette',   name: 'Veggie Omelette' },
      ],
      [
        { id: 'rcp-ln-chicken-caesar', name: 'Chicken Caesar Salad' },
        { id: 'rcp-ln-tuna-wrap',      name: 'Tuna Wrap' },
      ],
      [
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice' },
        { id: 'rcp-dn-chicken-stir-fry', name: 'Chicken Stir-Fry' },
      ],
      [{ id: 'rcp-sn-protein-smoothie', name: 'Protein Smoothie' }],
      { am: false, pm: true },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },

  // ── Low Carb ─────────────────────────────────────────────────────────────
  {
    id: 'plan-low-carb-classic',
    name: 'Low Carb Classic',
    description: 'Carb-conscious meals that still keep you full.',
    disclaimer: DEFAULT_DISCLAIMER,
    category: 'Low Carb',
    targets: { calories: 1900, protein: 160, carbs: 110, fats: 95 },
    days: rotateDays(
      [
        { id: 'rcp-bf-veggie-omelette', name: 'Veggie Omelette' },
        { id: 'rcp-bf-avocado-toast',   name: 'Avocado Toast' },
      ],
      [
        { id: 'rcp-ln-chicken-caesar', name: 'Chicken Caesar Salad' },
        { id: 'rcp-ln-tuna-wrap',      name: 'Tuna Wrap' },
      ],
      [
        { id: 'rcp-dn-chicken-stir-fry', name: 'Chicken Stir-Fry' },
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice' },
      ],
      [
        { id: 'rcp-sn-apple-almonds', name: 'Apple & Almonds' },
        { id: 'rcp-sn-yogurt-honey',  name: 'Greek Yogurt with Honey' },
      ],
      { am: true, pm: false },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },

  // ── High Fiber ───────────────────────────────────────────────────────────
  {
    id: 'plan-high-fiber-gut',
    name: 'Gut-Friendly High Fiber',
    description: 'Plenty of whole grains, legumes, and produce to support gut health.',
    disclaimer: DEFAULT_DISCLAIMER,
    category: 'High Fiber',
    targets: { calories: 2100, protein: 110, carbs: 280, fats: 70 },
    days: rotateDays(
      [
        { id: 'rcp-bf-oats-berries',  name: 'Oats & Berries' },
        { id: 'rcp-bf-avocado-toast', name: 'Avocado Toast' },
      ],
      [
        { id: 'rcp-ln-quinoa-bowl',     name: 'Quinoa Power Bowl' },
        { id: 'rcp-ln-veggie-stir-fry', name: 'Veggie Stir-Fry' },
      ],
      [
        { id: 'rcp-dn-veggie-curry',    name: 'Veggie Curry' },
        { id: 'rcp-dn-pasta-primavera', name: 'Pasta Primavera' },
      ],
      [
        { id: 'rcp-sn-hummus-carrots', name: 'Hummus & Carrots' },
        { id: 'rcp-sn-apple-almonds',  name: 'Apple & Almonds' },
      ],
      { am: true, pm: true },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },

  // ── Keto ─────────────────────────────────────────────────────────────────
  {
    id: 'plan-keto-starter',
    name: 'Keto Starter',
    description: 'Very low carb, high fat, moderate protein.',
    disclaimer:
      'Keto is restrictive. Consult a clinician if you have medical concerns. ' + DEFAULT_DISCLAIMER,
    category: 'Keto',
    targets: { calories: 1900, protein: 130, carbs: 40, fats: 140 },
    days: rotateDays(
      [
        { id: 'rcp-bf-veggie-omelette', name: 'Veggie Omelette' },
        { id: 'rcp-bf-avocado-toast',   name: 'Avocado Toast' },
      ],
      [
        { id: 'rcp-ln-chicken-caesar', name: 'Chicken Caesar Salad' },
        { id: 'rcp-ln-tuna-wrap',      name: 'Tuna Wrap' },
      ],
      [
        { id: 'rcp-dn-chicken-stir-fry', name: 'Chicken Stir-Fry' },
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice' },
      ],
      [{ id: 'rcp-sn-apple-almonds', name: 'Apple & Almonds' }],
      { am: false, pm: true },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },

  // ── Mediterranean ────────────────────────────────────────────────────────
  {
    id: 'plan-med-classic',
    name: 'Mediterranean Classic',
    description: 'Olive oil, fish, whole grains, vegetables — Mediterranean staples.',
    disclaimer: DEFAULT_DISCLAIMER,
    category: 'Mediterranean',
    targets: { calories: 2100, protein: 130, carbs: 230, fats: 80 },
    days: rotateDays(
      [
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl' },
        { id: 'rcp-bf-avocado-toast',     name: 'Avocado Toast' },
        { id: 'rcp-bf-oats-berries',      name: 'Oats & Berries' },
      ],
      [
        { id: 'rcp-ln-quinoa-bowl',     name: 'Quinoa Power Bowl' },
        { id: 'rcp-ln-chicken-caesar',  name: 'Chicken Caesar Salad' },
      ],
      [
        { id: 'rcp-dn-salmon-rice',     name: 'Salmon & Rice' },
        { id: 'rcp-dn-pasta-primavera', name: 'Pasta Primavera' },
        { id: 'rcp-dn-veggie-curry',    name: 'Veggie Curry' },
      ],
      [
        { id: 'rcp-sn-hummus-carrots',  name: 'Hummus & Carrots' },
        { id: 'rcp-sn-yogurt-honey',    name: 'Greek Yogurt with Honey' },
      ],
      { am: true, pm: true },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },
];
