// Fetches the Build My Plan macro picker options (protein/carb/fat food names)
// from Supabase. These live in three reference tables seeded once from USDA
// FoodData Central (see scripts/import-macro-foods.ts) and are editable in the
// Table Editor, so the picker lists can change without an app release.
//
// Uses the app-wide anon-key client — the tables are world-readable to any
// authenticated user via RLS (select using true), so no special access needed.

import { supabase } from '@/lib/supabase';

export type MacroGroup = 'proteins' | 'carbs' | 'fats';

const TABLE_BY_GROUP: Record<MacroGroup, string> = {
  proteins: 'macro_proteins',
  carbs: 'macro_carbs',
  fats: 'macro_fats',
};

/**
 * Loads all three macro option lists in parallel, ordered by everyday
 * familiarity (most recognizable foods first) so the picker surfaces staples
 * like chicken breast / eggs / rice ahead of obscure items. `familiarity_score`
 * is populated by scripts/score-macro-familiarity.ts; rows still unscored (null)
 * fall to the bottom and are broken alphabetically. Throws if any query fails so
 * the caller can show a retry state.
 */
export async function fetchMacroFoodOptions(): Promise<Record<MacroGroup, string[]>> {
  const load = (table: string) =>
    supabase
      .from(table)
      .select('name')
      .order('familiarity_score', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true });

  const [proteins, carbs, fats] = await Promise.all([
    load(TABLE_BY_GROUP.proteins),
    load(TABLE_BY_GROUP.carbs),
    load(TABLE_BY_GROUP.fats),
  ]);

  const firstError = proteins.error ?? carbs.error ?? fats.error;
  if (firstError) throw new Error(firstError.message);

  const names = (rows: { name: string }[] | null) =>
    (rows ?? []).map((r) => r.name);

  return {
    proteins: names(proteins.data),
    carbs: names(carbs.data),
    fats: names(fats.data),
  };
}

/**
 * Fetches ALL food names from proteins+carbs+fats combined into one flat array,
 * properly sorted by familiarity_score across all categories. Used by the
 * "foods to avoid" searchable list which draws from the entire food pool.
 */
export async function fetchAllFoodOptionsCombined(): Promise<string[]> {
  const load = (table: string) =>
    supabase
      .from(table)
      .select('name, familiarity_score');

  const [proteins, carbs, fats] = await Promise.all([
    load(TABLE_BY_GROUP.proteins),
    load(TABLE_BY_GROUP.carbs),
    load(TABLE_BY_GROUP.fats),
  ]);

  const firstError = proteins.error ?? carbs.error ?? fats.error;
  if (firstError) throw new Error(firstError.message);

  type Row = { name: string; familiarity_score: number | null };
  const all: Row[] = [
    ...((proteins.data as Row[]) ?? []),
    ...((carbs.data as Row[]) ?? []),
    ...((fats.data as Row[]) ?? []),
  ];

  all.sort((a, b) => (b.familiarity_score ?? 0) - (a.familiarity_score ?? 0));

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of all) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row.name);
  }
  return result;
}
