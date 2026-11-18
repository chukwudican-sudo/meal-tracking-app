/**
 * Recipe nutrition check (Nov 18, 2026): the built-in recipes' calories and
 * macros must equal the sum of their ingredients, computed from USDA
 * FoodData Central (SR Legacy, each ingredient in the form the recipe
 * measures it — raw, or canned/cooked where it says so; the standard
 * "ingredient method" used by nutrition professionals and recipe builders).
 * Exceptions are marked in ingredients.json (`dataType`, `note`): the
 * stir-fry vegetable blend is FNDDS, curry paste is a label estimate.
 *
 * It also checks the premade plans (constants/planSeed.ts): portions stay
 * between 0.5× and 2×, Keto Starter stays under 40 g carbs every day and Low
 * Carb Classic under 100 g.
 *
 *   npm run check:recipe-nutrition            # report recipes that don't match
 *   npm run check:recipe-nutrition -- --json  # print the computed values
 *
 * ingredients.json (next to this file) maps every ingredient name used in
 * constants/recipeSeed.ts to its USDA entry (fdcId), a snapshot of its values
 * per 100 g, and gram weights for non-gram units (USDA portion weights unless
 * a `note` says otherwise). A new ingredient needs an entry there first —
 * look it up at fdc.nal.usda.gov (prefer SR Legacy, in the recipe's form).
 *
 * Recipe = one serving: quantities as you'd measure them — rice, pasta,
 * grains and lentils dry ("Cook rice per package"), canned or cooked items as
 * named — and the totals are what one person eats.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAN_SEED } from '../../constants/planSeed';
import { RECIPE_SEED } from '../../constants/recipeSeed';

type Entry = {
  per100g: { kcal: number; protein: number; carbs: number; fat: number };
  grams?: Record<string, number>;
  edibleShare?: number;
};

const here = dirname(fileURLToPath(import.meta.url));
const INGREDIENTS: Record<string, Entry> = JSON.parse(readFileSync(join(here, 'ingredients.json'), 'utf8'));

export function computeRecipe(ingredients: { name: string; quantity: number; unit: string }[]) {
  const t = { calories: 0, protein: 0, carbs: 0, fats: 0 };
  for (const i of ingredients) {
    const e = INGREDIENTS[i.name];
    if (!e) throw new Error(`No ingredients.json entry for "${i.name}"`);
    const perUnit = i.unit === 'g' ? 1 : e.grams?.[i.unit];
    if (perUnit == null) throw new Error(`No gram weight for "${i.unit}" of "${i.name}"`);
    const grams = i.quantity * perUnit * (e.edibleShare ?? 1);
    t.calories += (e.per100g.kcal * grams) / 100;
    t.protein += (e.per100g.protein * grams) / 100;
    t.carbs += (e.per100g.carbs * grams) / 100;
    t.fats += (e.per100g.fat * grams) / 100;
  }
  return {
    calories: Math.round(t.calories),
    macros: { protein: Math.round(t.protein), carbs: Math.round(t.carbs), fats: Math.round(t.fats) },
  };
}

const json = process.argv.includes('--json');
const computed = RECIPE_SEED.map(r => ({ id: r.id, name: r.name, ...computeRecipe(r.ingredients) }));

if (json) {
  console.log(JSON.stringify(computed, null, 2));
} else {
  const off = computed.filter(c => {
    const r = RECIPE_SEED.find(x => x.id === c.id)!;
    return r.calories !== c.calories
      || r.macros.protein !== c.macros.protein
      || r.macros.carbs !== c.macros.carbs
      || r.macros.fats !== c.macros.fats;
  });
  for (const c of off) {
    const r = RECIPE_SEED.find(x => x.id === c.id)!;
    console.log(`${r.name}: seed ${r.calories} kcal P${r.macros.protein} C${r.macros.carbs} F${r.macros.fats} ≠ USDA ${c.calories} kcal P${c.macros.protein} C${c.macros.carbs} F${c.macros.fats}`);
  }
  console.log(off.length === 0 ? `All ${computed.length} recipes match their ingredients.` : `${off.length} of ${computed.length} recipes don't match.`);

  // Premade plans: portion range and per-day carb limits.
  const CARB_LIMIT: Record<string, number> = { 'Keto Starter': 40, 'Low Carb Classic': 100 };
  const planProblems: string[] = [];
  for (const p of PLAN_SEED) {
    p.days.forEach((day, di) => {
      let carbs = 0;
      for (const m of day) {
        const r = RECIPE_SEED.find(x => x.id === m.recipeId);
        if (!r) { planProblems.push(`${p.name} day ${di + 1}: unknown recipe ${m.recipeId}`); continue; }
        const s = m.servings ?? 1;
        if (s < 0.5 || s > 2) planProblems.push(`${p.name} day ${di + 1}: ${m.recipeName} portion ${s}× (keep 0.5–2×)`);
        carbs += r.macros.carbs * s;
      }
      const limit = CARB_LIMIT[p.name];
      if (limit != null && carbs >= limit) planProblems.push(`${p.name} day ${di + 1}: ${carbs.toFixed(1)} g carbs (limit < ${limit} g)`);
    });
  }
  planProblems.forEach(line => console.log(line));
  console.log(planProblems.length === 0 ? `All ${PLAN_SEED.length} premade plans are within their limits.` : `${planProblems.length} plan problem(s).`);
  process.exit(off.length === 0 && planProblems.length === 0 ? 0 : 1);
}
