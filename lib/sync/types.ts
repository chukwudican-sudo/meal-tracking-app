import type { ServerSnapshot } from '@/store/types';

export type { ServerSnapshot };

// Logical tables the sync layer knows how to push/pull. Child tables
// (meal_log_ingredients, recipe_ingredients, recipe_steps, recipes) are
// handled inside their parent's repository operation, not as top-level ops.
export type SyncTable =
  | 'users'
  | 'meal_logs'
  | 'weight_logs'
  | 'saved_recipes'
  | 'kitchen_items'
  | 'cart_items'
  | 'planned_ingredients';

export type OutboxOp = 'upsert' | 'delete';

// A single durable mutation waiting to be flushed to Supabase. `entityKey`
// uniquely identifies the logical record so newer writes coalesce onto older
// pending ones instead of piling up.
export interface OutboxItem {
  id: string;
  table: SyncTable;
  op: OutboxOp;
  entityKey: string;
  payload: unknown;
  attempts: number;
  nextAttemptAt: number;
  deadLetter?: boolean;
}

// ─── Entity-key builders ───────────────────────────────────────────────────
// The SAME key identifies a record in the outbox (for coalescing + dirty
// detection) and in applyServerSnapshot's dirty-guard, so a locally-pending
// change is never clobbered by an incoming pull.

export const entityKey = {
  usersSelf: () => 'users:self',
  mealLog: (mealId: string) => `meal_logs:${mealId}`,
  weightLog: (date: string) => `weight_logs:${date}`,
  savedRecipe: (savedRecipeId: string) => `saved_recipes:${savedRecipeId}`,
  // Grocery keys are table-scoped so a section move (delete-old + upsert-new)
  // produces two distinct keys that both survive outbox coalescing.
  grocery: (table: SyncTable, groceryKey: string) => `${table}:${groceryKey}`,
};

const GROCERY_TABLES: SyncTable[] = ['kitchen_items', 'cart_items', 'planned_ingredients'];

// A grocery key is "dirty" if a pending op exists for it in ANY section table,
// so an in-flight move can't be clobbered by a pull.
export function isGroceryKeyDirty(dirtyKeys: Set<string>, groceryKey: string): boolean {
  return GROCERY_TABLES.some(t => dirtyKeys.has(`${t}:${groceryKey}`));
}
