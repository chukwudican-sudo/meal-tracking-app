// Thin data-access layer over the Supabase client. `pushItem` executes one
// outbox mutation (fanning out to child tables where needed); `pullAll` reads
// the user's rows from every synced table and reverse-maps them into a
// domain-shaped ServerSnapshot. RLS guarantees we only ever touch our own rows.

import { supabase } from '@/lib/supabase';
import type {
  GroceryItem,
  MealEntry,
  SavedRecipe,
  UserGoals,
  UserProfile,
  WeightLogEntry,
} from '@/store/types';
import * as M from './mappers';
import type { OutboxItem, ServerSnapshot, SyncTable } from './types';

function throwIf(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

// ─── Push a single outbox mutation ─────────────────────────────────────────

export async function pushItem(userId: string, item: OutboxItem): Promise<void> {
  const p = item.payload as any;
  switch (item.table) {
    case 'users': {
      const row = M.profileToUsersRow(userId, p.profile as UserProfile, p.goals as UserGoals);
      const { error } = await supabase.from('users').upsert(row, { onConflict: 'id' });
      throwIf(error, 'users.upsert');
      return;
    }

    case 'meal_logs': {
      if (item.op === 'delete') {
        const { error } = await supabase
          .from('meal_logs')
          .delete()
          .eq('id', p.mealId)
          .eq('user_id', userId);
        throwIf(error, 'meal_logs.delete');
        return;
      }
      const { row, ingredients } = M.mealEntryToRows(
        userId,
        p.date as string,
        p.entry as MealEntry,
        (p.slotName ?? null) as string | null,
      );
      const up = await supabase.from('meal_logs').upsert(row, { onConflict: 'id' });
      throwIf(up.error, 'meal_logs.upsert');
      // Replace children so removed/edited ingredients don't linger.
      const del = await supabase.from('meal_log_ingredients').delete().eq('meal_log_id', (row as any).id);
      throwIf(del.error, 'meal_log_ingredients.delete');
      if (ingredients.length > 0) {
        const ins = await supabase.from('meal_log_ingredients').insert(ingredients);
        throwIf(ins.error, 'meal_log_ingredients.insert');
      }
      return;
    }

    case 'weight_logs': {
      if (item.op === 'delete') {
        const { error } = await supabase
          .from('weight_logs')
          .delete()
          .eq('user_id', userId)
          .eq('logged_at', `${p.date}T00:00:00.000Z`);
        throwIf(error, 'weight_logs.delete');
        return;
      }
      const row = M.weightToRow(userId, p.entry as WeightLogEntry);
      const { error } = await supabase
        .from('weight_logs')
        .upsert(row, { onConflict: 'user_id,logged_at' });
      throwIf(error, 'weight_logs.upsert');
      return;
    }

    case 'saved_recipes': {
      const sr = p.savedRecipe as SavedRecipe;
      const rows = M.savedRecipeToRows(userId, sr);
      if (item.op === 'delete') {
        const delSaved = await supabase
          .from('saved_recipes')
          .delete()
          .eq('user_id', userId)
          .eq('recipe_id', rows.recipeUuid);
        throwIf(delSaved.error, 'saved_recipes.delete');
        if (rows.recipeRow) {
          const delRecipe = await supabase
            .from('recipes')
            .delete()
            .eq('id', rows.recipeUuid)
            .eq('user_id', userId);
          throwIf(delRecipe.error, 'recipes.delete');
        }
        return;
      }
      // Upsert the per-user recipe copy + its children (skipped for premade).
      if (rows.recipeRow) {
        const upR = await supabase.from('recipes').upsert(rows.recipeRow, { onConflict: 'id' });
        throwIf(upR.error, 'recipes.upsert');
        const delI = await supabase.from('recipe_ingredients').delete().eq('recipe_id', rows.recipeUuid);
        throwIf(delI.error, 'recipe_ingredients.delete');
        if (rows.ingredientRows.length > 0) {
          const insI = await supabase.from('recipe_ingredients').insert(rows.ingredientRows);
          throwIf(insI.error, 'recipe_ingredients.insert');
        }
        const delS = await supabase.from('recipe_steps').delete().eq('recipe_id', rows.recipeUuid);
        throwIf(delS.error, 'recipe_steps.delete');
        if (rows.stepRows.length > 0) {
          const insS = await supabase.from('recipe_steps').insert(rows.stepRows);
          throwIf(insS.error, 'recipe_steps.insert');
        }
      }
      // Conflict-resolve on the PRIMARY KEY (id), which we set deterministically
      // to the saved recipe's own id. Using the secondary (user_id, recipe_id)
      // key caused a saved_recipes_pkey duplicate whenever a row with this id
      // already existed under a different recipe_id (e.g. its recipe mapping
      // changed) — the upsert would attempt an INSERT and collide on the PK.
      const upSaved = await supabase
        .from('saved_recipes')
        .upsert(rows.savedRow, { onConflict: 'id' });
      throwIf(upSaved.error, 'saved_recipes.upsert');
      return;
    }

    case 'kitchen_items':
    case 'cart_items':
    case 'planned_ingredients': {
      if (item.op === 'delete') {
        const { error } = await supabase
          .from(item.table)
          .delete()
          .eq('user_id', userId)
          .eq('ingredient_name', p.name);
        throwIf(error, `${item.table}.delete`);
        return;
      }
      const row = M.groceryItemToRow(userId, p.item as GroceryItem);
      const { error } = await supabase
        .from(item.table)
        .upsert(row, { onConflict: 'user_id,ingredient_name' });
      throwIf(error, `${item.table}.upsert`);
      return;
    }
  }
}

// ─── Pull the per-user dataset (full or incremental) ───────────────────────
// `since` null → full pull (first claim / account switch / reinstall).
// `since` set  → delta pull: only rows with updated_at > since. The returned
// snapshot is union-merged into local state, so a partial delta leaves
// untouched records in place.

export async function pullSince(userId: string, since: string | null): Promise<ServerSnapshot> {
  const snapshot: ServerSnapshot = {};

  // users (profile + goals) — omitted from the snapshot when unchanged in a delta.
  {
    let q = supabase.from('users').select('*').eq('id', userId);
    if (since != null) q = q.gt('updated_at', since);
    const { data, error } = await q.maybeSingle();
    throwIf(error, 'users.select');
    if (data) {
      const { profile, goals } = M.usersRowToProfileGoals(data);
      snapshot.profile = profile;
      snapshot.goals = goals;
    }
  }

  // weight_logs
  {
    let q = supabase.from('weight_logs').select('*').eq('user_id', userId);
    if (since != null) q = q.gt('updated_at', since);
    const { data, error } = await q;
    throwIf(error, 'weight_logs.select');
    const byDate = new Map<string, WeightLogEntry>();
    (data ?? []).forEach(r => {
      const e = M.rowToWeight(r);
      byDate.set(e.date, e); // last row per date wins
    });
    snapshot.weightLog = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // meal_logs (+ ingredients) — children fetched only for the changed meals.
  {
    let q = supabase.from('meal_logs').select('*').eq('user_id', userId);
    if (since != null) q = q.gt('updated_at', since);
    const { data: logs, error } = await q;
    throwIf(error, 'meal_logs.select');
    const ids = (logs ?? []).map(l => l.id);
    let ingByMeal = new Map<string, any[]>();
    if (ids.length > 0) {
      const { data: ings, error: ingErr } = await supabase
        .from('meal_log_ingredients')
        .select('*')
        .in('meal_log_id', ids);
      throwIf(ingErr, 'meal_log_ingredients.select');
      ingByMeal = groupBy(ings ?? [], r => r.meal_log_id);
    }
    const byDate: Record<string, MealEntry[]> = {};
    (logs ?? []).forEach(l => {
      const { date, entry } = M.rowToMealEntry(l, ingByMeal.get(l.id) ?? []);
      (byDate[date] ??= []).push(entry);
    });
    snapshot.logsByDate = byDate;
  }

  // saved_recipes (+ recipes, ingredients, steps). A recipe's content can change
  // without its saved_recipes row changing, so on a delta the affected recipe ids
  // are the union of changed saved rows and changed user-owned recipes; we then
  // load the saved rows for those recipes and rebuild them fully.
  {
    let savedRows: any[] = [];
    if (since == null) {
      const { data: saved, error } = await supabase.from('saved_recipes').select('*').eq('user_id', userId);
      throwIf(error, 'saved_recipes.select');
      savedRows = saved ?? [];
    } else {
      const [{ data: changedSaved, error: csErr }, { data: changedRecipes, error: crErr }] =
        await Promise.all([
          supabase.from('saved_recipes').select('recipe_id').eq('user_id', userId).gt('updated_at', since),
          supabase.from('recipes').select('id').eq('user_id', userId).gt('updated_at', since),
        ]);
      throwIf(csErr, 'saved_recipes.select.delta');
      throwIf(crErr, 'recipes.select.delta');
      const affected = new Set<string>();
      (changedSaved ?? []).forEach(s => affected.add(s.recipe_id));
      (changedRecipes ?? []).forEach(r => affected.add(r.id));
      if (affected.size > 0) {
        const { data: saved, error } = await supabase
          .from('saved_recipes')
          .select('*')
          .eq('user_id', userId)
          .in('recipe_id', Array.from(affected));
        throwIf(error, 'saved_recipes.select');
        savedRows = saved ?? [];
      }
    }

    const recipeIds = Array.from(new Set(savedRows.map(s => s.recipe_id)));
    let recipeById = new Map<string, any>();
    let ingByRecipe = new Map<string, any[]>();
    let stepByRecipe = new Map<string, any[]>();
    if (recipeIds.length > 0) {
      const [{ data: recipes, error: rErr }, { data: ings, error: iErr }, { data: steps, error: sErr }] =
        await Promise.all([
          supabase.from('recipes').select('*').in('id', recipeIds),
          supabase.from('recipe_ingredients').select('*').in('recipe_id', recipeIds),
          supabase.from('recipe_steps').select('*').in('recipe_id', recipeIds),
        ]);
      throwIf(rErr, 'recipes.select');
      throwIf(iErr, 'recipe_ingredients.select');
      throwIf(sErr, 'recipe_steps.select');
      recipeById = new Map((recipes ?? []).map(r => [r.id, r]));
      ingByRecipe = groupBy(ings ?? [], r => r.recipe_id);
      stepByRecipe = groupBy(steps ?? [], r => r.recipe_id);
    }
    snapshot.savedRecipes = savedRows.map(s =>
      M.rowsToSavedRecipe(
        s,
        recipeById.get(s.recipe_id),
        ingByRecipe.get(s.recipe_id) ?? [],
        stepByRecipe.get(s.recipe_id) ?? [],
      ),
    );
  }

  // grocery (kitchen / cart / planned)
  {
    const kq = supabase.from('kitchen_items').select('*').eq('user_id', userId);
    const cq = supabase.from('cart_items').select('*').eq('user_id', userId);
    const pq = supabase.from('planned_ingredients').select('*').eq('user_id', userId);
    const [{ data: kitchen, error: kErr }, { data: cart, error: cErr }, { data: planned, error: pErr }] =
      await Promise.all([
        since != null ? kq.gt('updated_at', since) : kq,
        since != null ? cq.gt('updated_at', since) : cq,
        since != null ? pq.gt('updated_at', since) : pq,
      ]);
    throwIf(kErr, 'kitchen_items.select');
    throwIf(cErr, 'cart_items.select');
    throwIf(pErr, 'planned_ingredients.select');
    const items: GroceryItem[] = [
      ...(kitchen ?? []).map(r => M.rowToGroceryItem('kitchen_items', r)),
      ...(cart ?? []).map(r => M.rowToGroceryItem('cart_items', r)),
      ...(planned ?? []).map(r => M.rowToGroceryItem('planned_ingredients', r)),
    ];
    snapshot.groceryItems = items;
  }

  return snapshot;
}

// Full pull — convenience wrapper used for the first claim, account switch, and
// any pull that has no cursor yet.
export async function pullAll(userId: string): Promise<ServerSnapshot> {
  return pullSince(userId, null);
}

// Server clock read for the delta cursor. Captured BEFORE a pull and stored only
// after it succeeds, so the cursor never depends on the (possibly skewed) device
// clock. Falls back to device time if the RPC is unavailable.
export async function serverNow(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('server_now');
    if (error || data == null) return new Date().toISOString();
    return typeof data === 'string' ? data : new Date(data as any).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// Returns true when the user has no server-side data yet (fresh account).
export async function serverIsEmpty(userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('meal_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) return false;
  return (count ?? 0) === 0;
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  rows.forEach(r => {
    const k = keyFn(r);
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  });
  return map;
}
