// Client-side gating rules for content that requires an active Pro
// subscription. This mirrors (but is independent of) the server-side
// entitlement checks in supabase/functions/_shared/entitlement.ts — those
// protect the AI edge functions themselves; this protects the purely
// client-side surfaces (viewing a full premade recipe, activating a built
// plan) that have no edge function of their own to gate.
//
// Gating is by cost, not by an arbitrary feature line: only AI-generated
// content (source 'ai') and the subset of the premade catalog not flagged
// `isFree` require Pro. A user's own hand-typed ("manual") recipes are
// always free — there's no AI cost to gate.

import type { RecipeTemplate, SavedRecipeSource } from '@/store/types';

export interface RecipeGateInput {
  source: SavedRecipeSource;
  // Only consulted when source === 'premade'. Undefined/false => requires Pro.
  isFree?: boolean;
}

export function recipeRequiresPro(input: RecipeGateInput): boolean {
  switch (input.source) {
    case 'ai':
      return true;
    case 'manual':
      return false;
    case 'premade':
    default:
      return input.isFree !== true;
  }
}

/** Convenience for gating a premade RecipeTemplate directly (Build My Plan, recipe lists). */
export function premadeRecipeRequiresPro(recipe: Pick<RecipeTemplate, 'isFree'>): boolean {
  return recipeRequiresPro({ source: 'premade', isFree: recipe.isFree });
}
