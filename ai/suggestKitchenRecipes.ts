// Client wrapper for the `suggest-kitchen-recipes` edge function ("What Can I Make").
//
// Sends the caller's kitchen ingredient names to Supabase, which holds the
// Gemini key server-side, enforces the entitlement gate + rate limit, and
// returns a batch of full recipe concepts. Invoke/timeout/error-parsing
// plumbing is shared via ./aiEdgeClient.

import { newId } from '@/lib/sync/uuid';
import type { Ingredient, RecipeCategory, RecipeDifficulty } from '@/store/types';
import { AIError, type AIErrorCode, invokeAIFunction, toInt } from './aiEdgeClient';
import type { RecipeConcept } from './types';

export type SuggestRecipesErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, rate_limited ->
// toast, etc.), consistent with ScanError/ScanKitchenError/FixError.
export class SuggestRecipesError extends AIError {
  constructor(code: SuggestRecipesErrorCode, message: string) {
    super(code, message);
    this.name = 'SuggestRecipesError';
  }
}

const VALID_CATEGORIES = new Set<RecipeCategory>(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
const VALID_DIFFICULTIES = new Set<RecipeDifficulty>(['Easy', 'Medium', 'Hard']);

function toCategory(raw: unknown): RecipeCategory {
  return typeof raw === 'string' && VALID_CATEGORIES.has(raw as RecipeCategory)
    ? (raw as RecipeCategory)
    : 'Lunch';
}

function toDifficulty(raw: unknown): RecipeDifficulty | undefined {
  return typeof raw === 'string' && VALID_DIFFICULTIES.has(raw as RecipeDifficulty)
    ? (raw as RecipeDifficulty)
    : undefined;
}

function mapIngredients(raw: unknown): Ingredient[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((ing): Ingredient | null => {
      if (!ing || typeof ing !== 'object') return null;
      const o = ing as Record<string, unknown>;
      const name = String(o.name ?? '').trim().slice(0, 60);
      if (!name) return null;
      const quantity = Number(o.quantity);
      return {
        id: newId(),
        name,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit: String(o.unit ?? 'serving').slice(0, 40),
        servings: 1,
      };
    })
    .filter((i): i is Ingredient => i !== null);
}

function mapSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(s => String(s ?? '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

// Map the wire shape { suggestions: [...] } into RecipeConcept[]. Category /
// difficulty are validated against the known enums (defense in depth beyond
// the response-schema enum).
function mapSuggestions(data: Record<string, unknown>): RecipeConcept[] {
  const raw = Array.isArray(data.suggestions) ? data.suggestions : [];
  const out: RecipeConcept[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    const ingredients = mapIngredients(o.ingredients);
    if (ingredients.length === 0) continue;
    out.push({
      name,
      category: toCategory(o.category),
      calories: toInt(o.calories),
      cookTimeMin: toInt(o.cookTimeMin) || 20,
      difficulty: toDifficulty(o.difficulty),
      macros: {
        protein: toInt(o.protein),
        carbs: toInt(o.carbs),
        fats: toInt(o.fats),
      },
      ingredients,
      steps: mapSteps(o.steps),
    });
  }
  return out;
}

export async function suggestKitchenRecipes(kitchenItemNames: string[]): Promise<RecipeConcept[]> {
  const kitchenItems = kitchenItemNames
    .map(n => n.trim())
    .filter(Boolean)
    .slice(0, 60);

  const data = await invokeAIFunction(
    'suggest-kitchen-recipes',
    { kitchenItems },
    {
      logPrefix: '[suggestKitchenRecipes]',
      makeError: (code, message) => new SuggestRecipesError(code, message),
      timeoutMessage: 'The AI took too long to suggest recipes. Please try again.',
      notAvailableMessage: 'AI recipe suggestions are not available yet. Please try again later.',
    },
  );

  return mapSuggestions(data);
}
