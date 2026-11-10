// Find Your Plan matching (Nov 10). Pure, on-device and rule-based (no AI, no
// network): the user's 5 answers are scored against each premade plan. Plans
// containing anything the user avoids are never suggested — the ingredient
// check errs on the side of excluding (e.g. Caesar dressing counts as fish,
// egg and dairy; granola as gluten and nuts).

import type {
  FindAvoid, FindGoal, FindPlanAnswers, FindStyle, GoalType, MealPlan, PlanCategory, RecipeTemplate, UserProfile,
} from '@/store/types';

export type { FindAvoid, FindGoal, FindMeals, FindPlanAnswers, FindStyle, FindTime } from '@/store/types';

export interface PlanMatch {
  plan: MealPlan;
  score: number;         // 0–100, shown as "% match"
  reasons: string[];     // "why it fits", best first
  caloriesPerDay: number | null;
  mealsPerDay: number;
}

// ─── Ingredient classification ──────────────────────────────────────────────

type Flag =
  | 'meat' | 'red_meat' | 'pork' | 'fish' | 'shellfish' | 'dairy' | 'egg' | 'gluten' | 'nuts' | 'soy' | 'honey';

// Each keyword matches at the START of a word ("egg" → "eggs", not
// "veggie"), so "coconut" isn't nuts and "champignon" isn't ham. "=word"
// matches the whole word only ("bun", not "bunch"); "*word" matches anywhere
// ("flatbread", "shortbread"). `except` phrases are removed first.
// Conservative on purpose: unsure → flag (a missed allergen is far worse than
// one plan too few). New recipes: check their ingredients land here.
const RULES: Record<Flag, { words: string[]; except?: string[] }> = {
  meat: {
    words: ['chicken', 'turkey', 'beef', 'pork', 'bacon', 'ham', 'lamb', 'sausage', 'steak', 'prosciutto', 'salami',
      'duck', 'veal', 'pepperoni', 'chorizo', 'mince', 'meatball', 'jerky', 'stock', 'broth', 'gelatin', 'lard'],
    except: ['vegetable stock', 'vegetable broth', 'veggie stock', 'veggie broth', 'mushroom broth'],
  },
  red_meat: {
    words: ['beef', 'pork', 'bacon', 'ham', 'lamb', 'sausage', 'steak', 'prosciutto', 'salami', 'veal', 'pepperoni',
      'chorizo', 'meatball', 'jerky', 'lard'],
  },
  pork: { words: ['pork', 'bacon', 'ham', 'prosciutto', 'salami', 'pepperoni', 'chorizo', 'sausage', 'lard', 'gelatin'] },
  fish: {
    words: ['salmon', 'tuna', 'cod', 'fish', 'tilapia', 'sardine', 'mackerel', 'anchov', 'trout', 'halibut', 'haddock',
      'bonito', 'dashi', 'caesar', 'worcestershire', 'curry paste'],
  },
  shellfish: {
    words: ['shrimp', 'prawn', 'crab', 'lobster', 'scallop', 'mussel', 'clam', 'oyster', 'crawfish', 'crayfish',
      'squid', 'calamari', 'octopus', 'curry paste'],
  },
  dairy: {
    words: ['milk', 'cheese', 'cheddar', 'parmesan', 'mozzarella', 'feta', 'halloumi', 'ricotta', 'paneer', 'yogurt',
      'yoghurt', 'butter', 'cream', 'whey', 'ghee', 'kefir', 'caesar', 'pesto', 'protein powder', 'bechamel', 'custard',
      'chocolate'],
    except: ['almond milk', 'oat milk', 'soy milk', 'coconut milk', 'rice milk', 'cashew milk', 'coconut cream',
      'peanut butter', 'almond butter', 'nut butter', 'cashew butter', 'cocoa butter', 'butternut', 'cream of tartar',
      'dairy-free chocolate'],
  },
  egg: { words: ['egg', 'mayonnaise', 'mayo', 'aioli', 'meringue', 'caesar'], except: ['eggplant'] },
  gluten: {
    words: ['bread', 'toast', 'wrap', 'tortilla', 'pasta', 'spaghetti', 'noodle', 'wheat', 'flour', 'couscous',
      'barley', 'oat', 'soy sauce', 'bagel', 'pita', 'granola', 'crouton', 'cracker', '=bun', '=buns', 'ciabatta',
      'pizza', 'teriyaki', 'panko', 'udon', 'ramen', 'spelt', 'seitan', 'bulgur', 'worcestershire', 'rye', 'muffin',
      'biscuit', 'cereal', 'beer', 'malt', 'pancake', 'sourdough', 'naan', 'brioche', 'gnocchi', 'semolina', 'orzo',
      'farro', 'dumpling', 'pretzel', '*bread'],
    except: ['corn tortilla'],
  },
  nuts: {
    words: ['almond', 'walnut', 'cashew', 'pecan', 'peanut', 'pistachio', 'hazelnut', 'macadamia', 'nut', 'granola',
      'pesto', 'chestnut', 'praline', 'marzipan', 'nutella'],
    except: ['nutmeg', 'butternut', 'nutritional yeast'],
  },
  soy: { words: ['soy', 'tofu', 'edamame', 'tempeh', 'miso', 'teriyaki', 'chocolate'], except: ['dairy-free chocolate'] },
  honey: { words: ['honey'] },
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const COMPILED = (Object.keys(RULES) as Flag[]).map(flag => ({
  flag,
  words: RULES[flag].words.map(w =>
    w.startsWith('=') ? new RegExp(`(^|[^a-z])${escapeRe(w.slice(1))}([^a-z]|$)`)
    : w.startsWith('*') ? new RegExp(escapeRe(w.slice(1)))
    : new RegExp(`(^|[^a-z])${escapeRe(w)}`)),
  except: RULES[flag].except ?? [],
}));

function flagsFor(ingredientName: string): Set<Flag> {
  const base = ingredientName.toLowerCase();
  const flags = new Set<Flag>();
  for (const rule of COMPILED) {
    let name = base;
    for (const phrase of rule.except) name = name.split(phrase).join(' ');
    if (rule.words.some(re => re.test(name))) flags.add(rule.flag);
  }
  return flags;
}

// What each "avoid" answer rules out.
const AVOID_BLOCKS: Record<FindAvoid, Flag[]> = {
  vegetarian: ['meat', 'fish', 'shellfish'],
  vegan: ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey'],
  pescetarian: ['meat'],
  no_fish: ['fish'],
  no_shellfish: ['shellfish'],
  no_red_meat: ['red_meat'],
  no_pork: ['pork'],
  no_dairy: ['dairy'],
  no_eggs: ['egg'],
  gluten_free: ['gluten'],
  no_nuts: ['nuts'],
  no_soy: ['soy'],
};

// ─── Profile → pre-filled answers ───────────────────────────────────────────

export function goalFromProfile(goalType: GoalType | undefined): FindGoal {
  if (goalType === 'lose_weight') return 'lose';
  if (goalType === 'gain_muscle' || goalType === 'lean_bulk') return 'muscle';
  if (goalType === 'maintain') return 'maintain';
  return 'healthy';
}

export function avoidFromProfile(profile: Pick<UserProfile, 'dietaryRestrictions' | 'allergies'>): FindAvoid[] {
  // Onboarding saves e.g. 'Dairy-free', 'Halal', 'Soy'; Settings saves e.g.
  // 'Allergic to milk', 'Lactose intolerant'. Both are matched here.
  const out = new Set<FindAvoid>();
  const items = [...(profile.dietaryRestrictions ?? []), ...(profile.allergies ?? [])].map(s => s.toLowerCase());
  for (const s of items) {
    if (s.includes('vegan')) out.add('vegan');
    else if (s.includes('vegetarian')) out.add('vegetarian');
    else if (s.includes('pesc')) out.add('pescetarian');
    if (s.includes('halal')) out.add('no_pork');
    if (s.includes('kosher')) { out.add('no_pork'); out.add('no_shellfish'); }
    if (s.includes('gluten') || s.includes('wheat')) out.add('gluten_free');
    if (s.includes('lactose') || s.includes('milk') || s.includes('dairy')) out.add('no_dairy');
    if (s.includes('egg')) out.add('no_eggs');
    if (s.includes('shellfish')) out.add('no_shellfish');
    else if (s.includes('fish')) out.add('no_fish');
    if (s.includes('nut')) out.add('no_nuts');
    if (s.includes('soy')) out.add('no_soy');
  }
  return Array.from(out);
}

export function defaultAnswers(profile: UserProfile): FindPlanAnswers {
  const keto = (profile.dietaryRestrictions ?? []).some(d => d.toLowerCase().includes('keto'));
  return {
    goal: goalFromProfile(profile.goalType),
    styles: keto ? ['keto'] : [],
    meals: 'any',
    avoid: avoidFromProfile(profile),
    time: 'any',
  };
}

// Last time's answers, but the profile's current diet/allergies always added
// (an allergy added since must never be dropped by old saved answers).
export function startingAnswers(profile: UserProfile, saved: FindPlanAnswers | null): FindPlanAnswers {
  if (!saved) return defaultAnswers(profile);
  const avoid = Array.from(new Set([...saved.avoid, ...avoidFromProfile(profile)]));
  return { ...saved, avoid };
}

// ─── Scoring ────────────────────────────────────────────────────────────────

const STYLE_OF: Record<PlanCategory, FindStyle> = {
  'Balanced': 'balanced',
  'High Protein': 'protein',
  'Low Carb': 'lowcarb',
  'Keto': 'keto',
  'Mediterranean': 'med',
  'High Fiber': 'fiber',
};

const STYLE_LABEL: Record<FindStyle, string> = {
  balanced: 'Balanced eating', protein: 'High protein', lowcarb: 'Low carb',
  keto: 'Keto', med: 'Mediterranean', fiber: 'High fiber',
};

// How well each eating style suits each goal (0–1).
const GOAL_FIT: Record<FindGoal, Record<FindStyle, number>> = {
  lose:     { protein: 1, lowcarb: 1, keto: 0.8, fiber: 0.6, med: 0.6, balanced: 0.5 },
  maintain: { balanced: 1, med: 1, fiber: 0.8, protein: 0.6, lowcarb: 0.6, keto: 0.4 },
  muscle:   { protein: 1, balanced: 0.6, med: 0.5, lowcarb: 0.4, fiber: 0.4, keto: 0.3 },
  healthy:  { med: 1, fiber: 1, balanced: 0.9, lowcarb: 0.6, protein: 0.6, keto: 0.4 },
};

const GOAL_REASON: Record<FindGoal, string> = {
  lose: 'Built for losing weight',
  maintain: 'Good for maintaining',
  muscle: 'Built for gaining muscle',
  healthy: 'Great for eating healthier',
};

// Weights add up to 100.
const W = { goal: 35, style: 25, calories: 15, meals: 15, time: 10 };
const NEUTRAL = 0.6; // "no preference" answers score every plan the same

export function matchPlans(
  plans: MealPlan[],
  recipes: RecipeTemplate[],
  answers: FindPlanAnswers,
  calorieTarget: number | undefined,
): PlanMatch[] {
  const recipeById = new Map(recipes.map(r => [r.id, r]));
  const blocked = new Set(answers.avoid.flatMap(a => AVOID_BLOCKS[a]));

  const matches: (PlanMatch & { raw: number; calorieGap: number })[] = [];
  for (const plan of plans) {
    const recipeIds = Array.from(new Set(plan.days.flat().map(m => m.recipeId)));
    const planRecipes = recipeIds.map(id => recipeById.get(id));
    // A meal we can't check can't be promised safe: skip the plan when the
    // user avoids anything.
    if (blocked.size > 0 && planRecipes.some(r => !r)) continue;
    const hasBlocked = planRecipes.some(r =>
      r?.ingredients.some(i => Array.from(flagsFor(i.name)).some(f => blocked.has(f))) ?? false,
    );
    if (hasBlocked) continue;

    const style = plan.category ? STYLE_OF[plan.category] : 'balanced';
    const mealsPerDay = Math.max(...plan.days.map(d => d.length), 0);
    const known = planRecipes.filter((r): r is RecipeTemplate => !!r);
    const avgCook = known.length > 0 ? known.reduce((n, r) => n + r.cookTimeMin, 0) / known.length : 20;
    const calories = plan.targets?.calories ?? null;

    const reasons: { text: string; weight: number }[] = [];

    // The plan's calories must point the right way for the goal: a 2,600 kcal
    // plan isn't "built for losing weight" for someone on 1,850.
    // No target yet: compare against a typical 2,000 kcal day.
    let goalFit = GOAL_FIT[answers.goal][style];
    const refTarget = calorieTarget && calorieTarget > 0 ? calorieTarget : 2000;
    if (calories) {
      if (answers.goal === 'lose' && calories > refTarget + 250) goalFit *= 0.4;
      if (answers.goal === 'muscle' && calories < refTarget) goalFit *= 0.5;
    }
    const goalPts = W.goal * goalFit;
    if (goalFit >= 0.8) reasons.push({ text: GOAL_REASON[answers.goal], weight: goalPts });

    let stylePts: number;
    if (answers.styles.length === 0) stylePts = W.style * NEUTRAL;
    else if (answers.styles.includes(style)) {
      stylePts = W.style;
      reasons.push({ text: `${STYLE_LABEL[style]}, as you picked`, weight: stylePts });
    } else stylePts = 0;

    let calPts = W.calories * NEUTRAL;
    if (calories && calorieTarget && calorieTarget > 0) {
      const diff = Math.abs(calories - calorieTarget);
      calPts = W.calories * Math.max(0, 1 - diff / 600);
      if (diff <= 200) {
        reasons.push({ text: `Close to your ${calorieTarget.toLocaleString()} kcal target`, weight: calPts });
      }
    }

    let mealPts = W.meals * NEUTRAL;
    if (answers.meals === '3') {
      mealPts = mealsPerDay <= 3 ? W.meals : 0;
      if (mealsPerDay <= 3) reasons.push({ text: '3 meals a day, as you prefer', weight: mealPts });
    } else if (answers.meals === '5') {
      mealPts = mealsPerDay >= 4 ? W.meals : 0;
      if (mealsPerDay >= 4) reasons.push({ text: 'Meals plus snacks, as you prefer', weight: mealPts });
    }

    let timePts = W.time;
    if (answers.time === 'quick') {
      timePts = avgCook <= 15 ? W.time : avgCook <= 20 ? W.time * 0.6 : W.time * 0.2;
      if (avgCook <= 15) reasons.push({ text: `Quick meals (about ${Math.round(avgCook)} min)`, weight: timePts });
    } else if (answers.time === 'some') {
      timePts = avgCook <= 35 ? W.time : W.time * 0.5;
    }

    if (answers.avoid.length > 0) reasons.push({ text: 'Free of the foods you avoid', weight: 1 });
    if (reasons.length === 0) reasons.push({ text: `${STYLE_LABEL[style]} plan`, weight: 0 });

    const raw = goalPts + stylePts + calPts + mealPts + timePts;
    matches.push({
      plan,
      raw,
      calorieGap: calories ? Math.abs(calories - refTarget) : Number.POSITIVE_INFINITY,
      score: Math.max(0, Math.min(100, Math.round(raw))),
      reasons: reasons.sort((a, b) => b.weight - a.weight).map(r => r.text).slice(0, 3),
      caloriesPerDay: calories,
      mealsPerDay,
    });
  }
  // Exact score first; ties go to the plan closest to the calorie target,
  // then to the name (stable, never seed order by accident).
  return matches
    .sort((a, b) => b.raw - a.raw || a.calorieGap - b.calorieGap || a.plan.name.localeCompare(b.plan.name))
    .map(({ raw: _raw, calorieGap: _gap, ...m }) => m);
}

// Below this a plan is shown, but not called "Best match".
export const BEST_MATCH_MIN = 60;

// Exported for tests / review.
export const __test = { flagsFor };
