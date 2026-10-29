// Client wrapper for the `generate-plan-shortlist` edge function (redesigned
// "Build My Plan").
//
// Sends the user's picked protein/carb/fat preferences (primary signal) plus
// the optional secondary preferences (cuisines, cook time, loved foods, foods
// to avoid) and the meal types to generate for. Supabase holds the Gemini key
// server-side, enforces the entitlement gate + rate limit, loads profile
// context server-side, and returns one shortlist of options per meal type.
// Invoke/timeout/error-parsing plumbing is shared via ./aiEdgeClient.

import { newId } from '@/lib/sync/uuid';
import type { Ingredient, RecipeCategory, RecipeDifficulty } from '@/store/types';
import { AIError, type AIErrorCode, invokeAIFunction, toInt } from './aiEdgeClient';
import type { RecipeConcept } from './types';
import type { CookTimePref } from './generateMealSuggestions';
import { PLAN_PICK_LIMITS } from '@/constants/planPicks';

export type GeneratePlanShortlistErrorCode = AIErrorCode;

// Typed error so the UI can branch (not_premium -> paywall, rate_limited ->
// toast, etc.), consistent with the other AI wrappers.
export class GeneratePlanShortlistError extends AIError {
  constructor(code: GeneratePlanShortlistErrorCode, message: string) {
    super(code, message);
    this.name = 'GeneratePlanShortlistError';
  }
}

export interface GeneratePlanShortlistParams {
  mealTypes: RecipeCategory[];
  proteins?: string[];
  carbs?: string[];
  fats?: string[];
  cuisines?: string[];
  cookTime?: CookTimePref | null;
  loves?: string[];
  avoid?: string[];
  // Optional per-type count override (e.g. { Lunch: 3 } for a "Generate more"
  // top-up). Omitted keys use the server defaults (mains 4, snacks 2).
  countPerType?: Partial<Record<RecipeCategory, number>>;
}

// A shortlist keyed by meal type. Only requested types are present.
export type PlanShortlist = Partial<Record<RecipeCategory, RecipeConcept[]>>;

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

// Map one raw suggestion item into a RecipeConcept. The meal type comes from
// which shortlist key it lived under (the server omits `category`), so we stamp
// it here.
function mapItem(o: Record<string, unknown>, category: RecipeCategory): RecipeConcept | null {
  const name = String(o.name ?? '').trim().slice(0, 80);
  if (!name) return null;
  return {
    name,
    category,
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
  };
}

// Map the wire shape { shortlist: { [mealType]: [...] } } into a PlanShortlist,
// only including the meal types that were actually requested.
function mapShortlist(data: Record<string, unknown>, mealTypes: RecipeCategory[]): PlanShortlist {
  const shortlist =
    data.shortlist && typeof data.shortlist === 'object'
      ? (data.shortlist as Record<string, unknown>)
      : {};
  const out: PlanShortlist = {};
  for (const mealType of mealTypes) {
    const raw = Array.isArray(shortlist[mealType]) ? (shortlist[mealType] as unknown[]) : [];
    const concepts: RecipeConcept[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const concept = mapItem(item as Record<string, unknown>, mealType);
      if (concept) concepts.push(concept);
    }
    out[mealType] = concepts;
  }
  return out;
}

function cleanList(raw: string[] | undefined, cap: number): string[] {
  return (raw ?? []).map(s => s.trim()).filter(Boolean).slice(0, cap);
}

export async function generatePlanShortlist(
  params: GeneratePlanShortlistParams,
): Promise<PlanShortlist> {
  const body = {
    mealTypes: params.mealTypes,
    proteins: cleanList(params.proteins, PLAN_PICK_LIMITS.proteins),
    carbs: cleanList(params.carbs, PLAN_PICK_LIMITS.carbs),
    fats: cleanList(params.fats, PLAN_PICK_LIMITS.fats),
    cuisines: cleanList(params.cuisines, PLAN_PICK_LIMITS.cuisines),
    cookTime: params.cookTime ?? null,
    loves: cleanList(params.loves, PLAN_PICK_LIMITS.loves),
    avoid: cleanList(params.avoid, PLAN_PICK_LIMITS.avoid),
    countPerType: params.countPerType ?? undefined,
  };

  const data = await invokeAIFunction('generate-plan-shortlist', body, {
    logPrefix: '[generatePlanShortlist]',
    makeError: (code, message) => new GeneratePlanShortlistError(code, message),
    timeoutMessage: 'The AI took too long to build your shortlist. Please try again.',
    notAvailableMessage: 'AI meal planning is not available yet. Please try again later.',
  });

  return mapShortlist(data, params.mealTypes);
}
