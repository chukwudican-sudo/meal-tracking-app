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

// Each recipe's portion in a plan (quarter steps, default 1) sits next to it.
// A plan reaches its calories with portions — its numbers are then worked out
// from the meals (lib/planNutrition.ts), never typed here. Portions are set
// per recipe, not per meal type, so every day lands near the plan's number
// (Nov 18 retune with USDA recipe values: per-type portions swung some days
// ±400 kcal; per recipe keeps every day within ~±80). Kept between 0.5× and
// 2× (a double portion at most — 2.5 wraps isn't a meal) with a usual meal
// split (breakfast ~25%, lunch ~35%, dinner ~30%, snacks ~10% each).
// `npm run check:recipe-nutrition` enforces the range and the carb limits.
type PlanOption = { id: string; name: string; servings?: number };

function withPortion(m: PlanDayMeal, servings: number | undefined): PlanDayMeal {
  return servings && servings !== 1 ? { ...m, servings } : m;
}

// Build a 7-day pattern by rotating breakfast/lunch/dinner options.
// Indices supply variety while keeping macro profiles within the same family.
function rotateDays(
  breakfasts: PlanOption[],
  lunches: PlanOption[],
  dinners: PlanOption[],
  snacks: PlanOption[],
  includeSnacks: { am: boolean; pm: boolean },
): PlanDayMeal[][] {
  return Array.from({ length: 7 }, (_, day) => {
    const bf = breakfasts[day % breakfasts.length];
    const ln = lunches[day % lunches.length];
    const dn = dinners[day % dinners.length];
    const am = snacks[day % snacks.length];
    const pm = snacks[(day + 1) % snacks.length];
    const meals: PlanDayMeal[] = [withPortion(BREAKFAST(bf.id, bf.name), bf.servings)];
    if (includeSnacks.am) meals.push(withPortion(MIDMORN(am.id, am.name), am.servings));
    meals.push(withPortion(LUNCH(ln.id, ln.name), ln.servings));
    if (includeSnacks.pm) meals.push(withPortion(AFTERNOON(pm.id, pm.name), pm.servings));
    meals.push(withPortion(DINNER(dn.id, dn.name), dn.servings));
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
    days: rotateDays(
      [
        { id: 'rcp-bf-oats-berries',      name: 'Oats & Berries' },
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl', servings: 1.25 },
        { id: 'rcp-bf-avocado-toast',     name: 'Avocado Toast', servings: 1.5 },
      ],
      [
        { id: 'rcp-ln-chicken-caesar', name: 'Chicken Caesar Salad', servings: 1.25 },
        { id: 'rcp-ln-turkey-sandwich', name: 'Turkey Sandwich', servings: 2 },
        { id: 'rcp-ln-quinoa-bowl',    name: 'Quinoa Power Bowl', servings: 1.25 },
      ],
      [
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice', servings: 0.75 },
        { id: 'rcp-dn-chicken-stir-fry', name: 'Chicken Stir-Fry', servings: 0.75 },
        { id: 'rcp-dn-pasta-primavera',  name: 'Pasta Primavera', servings: 0.75 },
      ],
      [
        { id: 'rcp-sn-yogurt-honey',    name: 'Greek Yogurt with Honey', servings: 0.75 },
        { id: 'rcp-sn-apple-almonds',   name: 'Apple & Almonds' },
        { id: 'rcp-sn-hummus-carrots',  name: 'Hummus & Carrots', servings: 1.25 },
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
    days: rotateDays(
      [
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl', servings: 1.5 },
        { id: 'rcp-bf-avocado-toast',     name: 'Avocado Toast', servings: 1.5 },
        { id: 'rcp-bf-veggie-omelette',   name: 'Veggie Omelette', servings: 2 },
      ],
      [
        { id: 'rcp-ln-quinoa-bowl',     name: 'Quinoa Power Bowl', servings: 1.5 },
        { id: 'rcp-ln-turkey-sandwich', name: 'Turkey Sandwich', servings: 2 },
        { id: 'rcp-ln-tuna-wrap',       name: 'Tuna Wrap', servings: 2 },
      ],
      [
        { id: 'rcp-dn-pasta-primavera',  name: 'Pasta Primavera', servings: 0.75 },
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice' },
        { id: 'rcp-dn-veggie-curry',     name: 'Veggie Curry', servings: 1.25 },
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
    days: rotateDays(
      [
        { id: 'rcp-bf-protein-pancakes',  name: 'Protein Pancakes' },
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl', servings: 2 },
        { id: 'rcp-bf-veggie-omelette',   name: 'Veggie Omelette', servings: 1.25 },
      ],
      [
        { id: 'rcp-ln-chicken-caesar', name: 'Chicken Caesar Salad', servings: 1.25 },
        { id: 'rcp-ln-tuna-wrap',      name: 'Tuna Wrap', servings: 2 },
        { id: 'rcp-ln-turkey-sandwich', name: 'Turkey Sandwich', servings: 2 },
      ],
      [
        { id: 'rcp-dn-chicken-stir-fry', name: 'Chicken Stir-Fry' },
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice', servings: 0.75 },
        { id: 'rcp-dn-beef-tacos',       name: 'Beef Tacos' },
      ],
      [
        { id: 'rcp-sn-protein-smoothie', name: 'Protein Smoothie', servings: 0.75 },
        { id: 'rcp-sn-yogurt-honey',     name: 'Greek Yogurt with Honey', servings: 1.5 },
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
    days: rotateDays(
      [
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl', servings: 1.5 },
        { id: 'rcp-bf-veggie-omelette',   name: 'Veggie Omelette', servings: 1.25 },
      ],
      [
        { id: 'rcp-ln-chicken-caesar', name: 'Chicken Caesar Salad' },
        { id: 'rcp-ln-tuna-wrap',      name: 'Tuna Wrap', servings: 2 },
      ],
      [
        { id: 'rcp-dn-salmon-rice',      name: 'Salmon & Rice', servings: 0.5 },
        { id: 'rcp-dn-chicken-stir-fry', name: 'Chicken Stir-Fry', servings: 0.75 },
      ],
      [{ id: 'rcp-sn-protein-smoothie', name: 'Protein Smoothie', servings: 0.75 }],
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
    // Nov 10: no more toast, wraps or rice dishes; every day is well under
    // 100 g of carbs.
    days: rotateDays(
      [
        { id: 'rcp-bf-veggie-omelette', name: 'Veggie Omelette' },
        { id: 'rcp-bf-egg-muffins',     name: 'Spinach & Feta Egg Muffins', servings: 1.75 },
      ],
      [
        { id: 'rcp-ln-greek-salad-chicken',   name: 'Greek Salad with Chicken', servings: 1.25 },
        { id: 'rcp-ln-chicken-caesar',        name: 'Chicken Caesar Salad' },
        { id: 'rcp-ln-chicken-lettuce-wraps', name: 'Chicken Avocado Lettuce Wraps', servings: 1.5 },
      ],
      [
        { id: 'rcp-dn-baked-salmon-veg',      name: 'Baked Salmon with Vegetables', servings: 0.75 },
        { id: 'rcp-dn-garlic-butter-steak',   name: 'Garlic Butter Steak & Asparagus', servings: 0.75 },
        { id: 'rcp-dn-creamy-tuscan-chicken', name: 'Creamy Tuscan Chicken', servings: 0.75 },
        { id: 'rcp-dn-lemon-salmon-greens',   name: 'Lemon Herb Salmon with Greens', servings: 0.75 },
      ],
      [
        { id: 'rcp-sn-boiled-eggs',   name: 'Boiled Eggs' },
        { id: 'rcp-sn-guacamole-veg', name: 'Guacamole & Veg Sticks' },
        { id: 'rcp-sn-edamame',       name: 'Steamed Edamame', servings: 1.5 },
      ],
      { am: true, pm: true },
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
    days: rotateDays(
      [
        { id: 'rcp-bf-oats-berries',  name: 'Oats & Berries', servings: 0.75 },
        { id: 'rcp-bf-avocado-toast', name: 'Avocado Toast', servings: 1.5 },
      ],
      [
        { id: 'rcp-ln-quinoa-bowl',     name: 'Quinoa Power Bowl', servings: 1.25 },
        { id: 'rcp-ln-veggie-stir-fry', name: 'Veggie Stir-Fry', servings: 1.25 },
      ],
      [
        { id: 'rcp-dn-veggie-curry',    name: 'Veggie Curry' },
        { id: 'rcp-dn-pasta-primavera', name: 'Pasta Primavera', servings: 0.75 },
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
    // Nov 10: rebuilt from real keto recipes (was toast, wraps and rice —
    // ~3× the carb limit). Every day stays under 40 g carbs.
    days: rotateDays(
      [
        { id: 'rcp-bf-veggie-omelette', name: 'Veggie Omelette' },
        { id: 'rcp-bf-egg-muffins',     name: 'Spinach & Feta Egg Muffins', servings: 1.75 },
      ],
      [
        { id: 'rcp-ln-chicken-lettuce-wraps', name: 'Chicken Avocado Lettuce Wraps', servings: 1.25 },
        { id: 'rcp-ln-tuna-stuffed-avocado',  name: 'Tuna-Stuffed Avocado', servings: 0.75 },
        { id: 'rcp-ln-greek-salad-chicken',   name: 'Greek Salad with Chicken', servings: 1.25 },
      ],
      [
        { id: 'rcp-dn-garlic-butter-steak',   name: 'Garlic Butter Steak & Asparagus' },
        { id: 'rcp-dn-lemon-salmon-greens',   name: 'Lemon Herb Salmon with Greens', servings: 1.25 },
        { id: 'rcp-dn-creamy-tuscan-chicken', name: 'Creamy Tuscan Chicken', servings: 0.75 },
      ],
      [
        { id: 'rcp-sn-cheese-olives', name: 'Cheese & Olives', servings: 0.75 },
        { id: 'rcp-sn-boiled-eggs',   name: 'Boiled Eggs' },
      ],
      { am: true, pm: true },
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
    days: rotateDays(
      [
        { id: 'rcp-bf-greek-yogurt-bowl', name: 'Greek Yogurt Bowl', servings: 1.25 },
        { id: 'rcp-bf-avocado-toast',     name: 'Avocado Toast', servings: 2 },
        { id: 'rcp-bf-oats-berries',      name: 'Oats & Berries' },
      ],
      [
        { id: 'rcp-ln-quinoa-bowl',     name: 'Quinoa Power Bowl', servings: 1.25 },
        { id: 'rcp-ln-chicken-caesar',  name: 'Chicken Caesar Salad', servings: 1.25 },
      ],
      [
        { id: 'rcp-dn-salmon-rice',     name: 'Salmon & Rice', servings: 0.75 },
        { id: 'rcp-dn-pasta-primavera', name: 'Pasta Primavera', servings: 0.75 },
        { id: 'rcp-dn-veggie-curry',    name: 'Veggie Curry' },
      ],
      [
        { id: 'rcp-sn-hummus-carrots',  name: 'Hummus & Carrots', servings: 0.75 },
        { id: 'rcp-sn-yogurt-honey',    name: 'Greek Yogurt with Honey', servings: 0.5 },
      ],
      { am: true, pm: true },
    ),
    savedAt: '2024-01-01T00:00:00.000Z',
    source: 'premade',
  },
];
