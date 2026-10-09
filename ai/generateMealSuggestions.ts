// Client wrapper for the `generate-meal-suggestions` edge function ("Build My Plan").
//
// Sends the requested meal type + count + the Build My Plan onboarding answers
// to Supabase, which holds the Gemini key server-side, enforces the entitlement
// gate + rate limit, loads profile context server-side, and returns a batch of
// meal suggestions. Invoke/timeout/error-parsing plumbing is shared via
// ./aiEdgeClient.

import { newId } from '@/lib/sync/uuid';
import type { Ingredient, RecipeCategory, RecipeDifficulty } from '@/store/types';
import { AIError, type AIErrorCode, invokeAIFunction, toInt } from './aiEdgeClient';
import type { RecipeConcept } from './types';

export type GenerateMealSuggestionsErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, rate_limited ->
// toast, etc.), consistent with ScanError/SuggestRecipesError/FixError.
export class GenerateMealSuggestionsError extends AIError {
  constructor(code: GenerateMealSuggestionsErrorCode, message: string) {
    super(code, message);
    this.name = 'GenerateMealSuggestionsError';
  }
}

export type CookTimePref = 'quick' | 'moderate' | 'full';

export interface GenerateMealSuggestionsParams {
  mealType: RecipeCategory;
  count: number;
  cuisines?: string[];
  cookTime?: CookTimePref | null;
  loves?: string[];
  avoid?: string[];
  description?: string;
}

const VALID_DIFFICULTIES = new Set<RecipeDifficulty>(['Easy', 'Medium', 'Hard']);

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

// Map the wire shape { suggestions: [...] } into RecipeConcept[]. The server
// locks `category` to the requested meal type, so we stamp it directly rather
// than trusting per-item values.
function mapSuggestions(data: Record<string, unknown>, mealType: RecipeCategory): RecipeConcept[] {
  const raw = Array.isArray(data.suggestions) ? data.suggestions : [];
  const out: RecipeConcept[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    out.push({
      name,
      category: mealType,
      calories: toInt(o.calories),
      cookTimeMin: toInt(o.cookTimeMin) || 20,
      difficulty: toDifficulty(o.difficulty),
      macros: {
        protein: toInt(o.protein),
        carbs: toInt(o.carbs),
        fats: toInt(o.fats),
      },
      ingredients: mapIngredients(o.ingredients),
      steps: mapSteps(o.steps),
    });
  }
  return out;
}

export async function generateMealSuggestions(
  params: GenerateMealSuggestionsParams,
): Promise<RecipeConcept[]> {
  const body = {
    mealType: params.mealType,
    count: params.count,
    cuisines: (params.cuisines ?? []).map(c => c.trim()).filter(Boolean).slice(0, 20),
    cookTime: params.cookTime ?? null,
    loves: (params.loves ?? []).map(l => l.trim()).filter(Boolean).slice(0, 20),
    avoid: (params.avoid ?? []).map(a => a.trim()).filter(Boolean).slice(0, 20),
    description: params.description?.trim().slice(0, 200) || undefined,
  };

  const data = await invokeAIFunction(
    'generate-meal-suggestions',
    body,
    {
      logPrefix: '[generateMealSuggestions]',
      makeError: (code, message) => new GenerateMealSuggestionsError(code, message),
      timeoutMessage: 'The AI took too long to suggest meals. Please try again.',
      notAvailableMessage: 'AI meal suggestions are not available yet. Please try again later.',
    },
  );

  return mapSuggestions(data, params.mealType);
}
