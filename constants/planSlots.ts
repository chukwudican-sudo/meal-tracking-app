// Placeholder recipe ids used inside a plan's days while customizing: an
// empty slot waiting for a recipe, and a slot whose recipe was removed. They
// are never real meals (also read by lib/sync/mappers.ts for synced plans).
export const EMPTY_SLOT = '__empty__';
export const REMOVED_SLOT = '__removed__';

export function isPlaceholderSlot(recipeId: string): boolean {
  return recipeId === EMPTY_SLOT || recipeId === REMOVED_SLOT;
}
