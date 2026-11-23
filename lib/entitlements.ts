// Client-side gating rules for content that requires an active Pro
// subscription. This mirrors (but is independent of) the server-side
// entitlement checks in supabase/functions/_shared/entitlement.ts — those
// protect the AI edge functions themselves; this protects the purely
// client-side surfaces (an AI recipe's full steps, starting a premade plan)
// that have no edge function of their own to gate.
//
// The line (Nov 23, 2026, reports/Recipe paywalls and content management.md):
// recipes are free, plans and AI are Pro. Every built-in recipe and the user's
// own are free to read in full; AI-written recipes need Pro for their steps
// (writing them is an AI call); the premade meal plans need Pro to start or
// customize (planRequiresPro). Peer trackers sell the plan, not the recipe.

import type { MealPlan, SavedRecipeSource } from '@/store/types';

export interface RecipeGateInput {
  source: SavedRecipeSource;
}

export function recipeRequiresPro(input: RecipeGateInput): boolean {
  return input.source === 'ai';
}

// Premade plans are the product Pro sells. The user's own plans (Build My
// Plan, saved or customized copies, source 'user') start freely: they were
// made with Pro and stay theirs. A plan already running keeps running when
// Pro ends — never take away what a user has.
export function planRequiresPro(plan: Pick<MealPlan, 'source'>): boolean {
  return plan.source === 'premade';
}
