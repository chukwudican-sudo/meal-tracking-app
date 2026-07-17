// Pure local <-> Supabase row mappers. No network here; the repository calls
// these to build rows for upserts and to reverse-map pulled rows into domain
// objects. The store stays metric internally; we always WRITE metric to the
// server (height_unit='cm', *_weight_unit='kg') for unit-consistent data.

import { classifyIngredient, normalizeIngredientName } from '@/constants/ingredientCategories';
import { premadeUuidForSlug } from '@/constants/premadeRecipes';
import type {
  GroceryItem,
  GrocerySection,
  Ingredient,
  MealEntry,
  NutrientKey,
  RecipeCategory,
  RecipeDifficulty,
  SavedRecipe,
  SavedRecipeSource,
  UserGoals,
  UserProfile,
  WeightLogEntry,
} from '@/store/types';
import { newId } from './uuid';
import { cupsToLiters, litersToCups } from './units';
import type { SyncTable } from './types';

// ─── Users (profile + goals) ───────────────────────────────────────────────

export function profileToUsersRow(
  userId: string,
  profile: UserProfile,
  goals: UserGoals,
): Record<string, unknown> {
  return {
    id: userId,
    email: profile.email ?? null,
    first_name: profile.firstName ?? (profile.name || null),
    gender: profile.gender ?? null,
    birthday: profile.birthday ?? null,
    age: profile.age ?? null,
    height_value: profile.heightCm ?? null,
    height_unit: profile.heightCm != null ? 'cm' : null,
    current_weight_value: profile.weightKg ?? null,
    current_weight_unit: profile.weightKg != null ? 'kg' : null,
    target_weight_value: profile.targetWeightKg ?? null,
    target_weight_unit: profile.targetWeightKg != null ? 'kg' : null,
    goal_type: profile.goalType ?? null,
    activity_level: profile.activityLevel ?? null,
    pace_value: profile.paceLbsPerWeek ?? null,
    dietary_preferences: profile.dietaryRestrictions ?? [],
    allergies: profile.allergies ?? [],
    secondary_nutrient_priorities: profile.trackedNutrients ?? [],
    daily_calorie_target: goals.dailyCalories ?? null,
    protein_target_grams: goals.protein ?? null,
    carbs_target_grams: goals.carbs ?? null,
    fats_target_grams: goals.fats ?? null,
    water_target_liters:
      goals.waterTargetCups != null ? cupsToLiters(goals.waterTargetCups) : null,
    goal_date: profile.goalDate ?? null,
    notification_permission: profile.notificationsAllowed ?? false,
    // NOTE: free_scans_remaining and subscription_* are trigger-protected on
    // the server and must never be sent from the client.
  };
}

export function usersRowToProfileGoals(row: Record<string, any>): {
  profile: Partial<UserProfile>;
  goals: Partial<UserGoals>;
} {
  const profile: Partial<UserProfile> = {
    email: row.email ?? undefined,
    firstName: row.first_name ?? undefined,
    gender: row.gender ?? undefined,
    birthday: row.birthday ?? undefined,
    age: row.age ?? undefined,
    heightCm: numOrUndef(row.height_value),
    weightKg: numOrUndef(row.current_weight_value),
    targetWeightKg: numOrUndef(row.target_weight_value),
    goalType: row.goal_type ?? undefined,
    activityLevel: row.activity_level ?? undefined,
    paceLbsPerWeek: numOrUndef(row.pace_value) ?? null,
    dietaryRestrictions: row.dietary_preferences ?? [],
    allergies: row.allergies ?? [],
    trackedNutrients: (row.secondary_nutrient_priorities ?? []) as NutrientKey[],
    goalDate: row.goal_date ?? null,
    notificationsAllowed: row.notification_permission ?? undefined,
  };
  // Use undefined (not 0) for missing targets so a near-empty server row never
  // zeroes out locally-computed goals during the merge (stripUndefined skips them).
  const goals: Partial<UserGoals> = {
    dailyCalories: numOrUndef(row.daily_calorie_target),
    protein: numOrUndef(row.protein_target_grams),
    carbs: numOrUndef(row.carbs_target_grams),
    fats: numOrUndef(row.fats_target_grams),
    waterTargetCups:
      row.water_target_liters != null ? Math.round(litersToCups(row.water_target_liters)) : undefined,
  };
  return { profile, goals };
}

// ─── Meal logs (+ ingredients) ─────────────────────────────────────────────

export interface MealLogRows {
  row: Record<string, unknown>;
  ingredients: Record<string, unknown>[];
}

export function mealEntryToRows(
  userId: string,
  date: string,
  entry: MealEntry,
  slotName: string | null,
): MealLogRows {
  const row = {
    id: entry.id,
    user_id: userId,
    recipe_id: null, // local meals carry no server recipe uuid
    date,
    time: entry.time ?? null,
    slot_name: slotName,
    meal_name: entry.name,
    calories: entry.calories ?? null,
    protein_grams: entry.macros?.protein ?? null,
    carbs_grams: entry.macros?.carbs ?? null,
    fats_grams: entry.macros?.fats ?? null,
    servings: entry.servings ?? 1,
    is_completed: entry.status === 'completed',
    is_ad_hoc: entry.isAdHoc ?? false,
    image_url: entry.photoUri ?? null,
    health_rating: null,
  };
  const ingredients = (entry.ingredients ?? []).map((ing, idx) => ({
    id: newId(),
    meal_log_id: entry.id,
    ingredient_name: ing.name,
    quantity: ing.quantity ?? null,
    unit: ing.unit ?? null,
    calories: ing.calories ?? null,
    protein_grams: ing.macros?.protein ?? null,
    carbs_grams: ing.macros?.carbs ?? null,
    fats_grams: ing.macros?.fats ?? null,
    sort_order: idx,
  }));
  return { row, ingredients };
}

export function rowToMealEntry(
  row: Record<string, any>,
  ingredientRows: Record<string, any>[],
): { date: string; entry: MealEntry } {
  const ingredients: Ingredient[] = (ingredientRows ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(ir => ({
      id: ir.id,
      name: ir.ingredient_name,
      quantity: numOrZero(ir.quantity),
      unit: ir.unit ?? '',
      calories: numOrUndef(ir.calories),
      macros:
        ir.protein_grams != null || ir.carbs_grams != null || ir.fats_grams != null
          ? {
              protein: numOrZero(ir.protein_grams),
              carbs: numOrZero(ir.carbs_grams),
              fats: numOrZero(ir.fats_grams),
            }
          : undefined,
    }));
  const entry: MealEntry = {
    id: row.id,
    name: row.meal_name,
    time: row.time ?? '',
    calories: numOrZero(row.calories),
    ingredients,
    macros: {
      protein: numOrZero(row.protein_grams),
      carbs: numOrZero(row.carbs_grams),
      fats: numOrZero(row.fats_grams),
    },
    status: row.is_completed ? 'completed' : 'pending',
    isAdHoc: row.is_ad_hoc ?? undefined,
    servings: numOrUndef(row.servings),
    photoUri: row.image_url ?? undefined,
  };
  return { date: row.date, entry };
}

// ─── Weight logs ───────────────────────────────────────────────────────────
// We store one logical entry per calendar day. logged_at is normalized to UTC
// midnight so (user_id, logged_at) is a stable natural key for LWW upserts.

export function weightToRow(userId: string, entry: WeightLogEntry): Record<string, unknown> {
  return {
    user_id: userId,
    weight_value: entry.weightKg,
    weight_unit: 'kg',
    logged_at: `${entry.date}T00:00:00.000Z`,
  };
}

export function rowToWeight(row: Record<string, any>): WeightLogEntry {
  const date = String(row.logged_at ?? '').slice(0, 10);
  return { date, weightKg: numOrZero(row.weight_value) };
}

// ─── Saved recipes (+ recipes, ingredients, steps) ─────────────────────────

export interface SavedRecipeRows {
  recipeUuid: string;
  // When null, the recipe is a seeded premade one and must NOT be upserted
  // (admin-managed / RLS-protected). Otherwise it's a per-user recipe copy.
  recipeRow: Record<string, unknown> | null;
  ingredientRows: Record<string, unknown>[];
  stepRows: Record<string, unknown>[];
  savedRow: Record<string, unknown>;
}

export function savedRecipeToRows(userId: string, sr: SavedRecipe): SavedRecipeRows {
  const premadeUuid = sr.source === 'premade' ? premadeUuidForSlug(sr.recipeId) : null;

  if (premadeUuid) {
    return {
      recipeUuid: premadeUuid,
      recipeRow: null,
      ingredientRows: [],
      stepRows: [],
      savedRow: {
        id: sr.id,
        user_id: userId,
        recipe_id: premadeUuid,
        is_bookmarked: sr.favourited ?? false,
        saved_at: sr.addedAt ?? new Date().toISOString(),
      },
    };
  }

  // Per-user recipe copy — reuse the saved recipe's own uuid as the recipe id.
  const recipeUuid = sr.id;
  const recipeRow = {
    id: recipeUuid,
    user_id: userId,
    name: sr.name,
    calories: sr.calories ?? null,
    protein_grams: sr.macros?.protein ?? null,
    carbs_grams: sr.macros?.carbs ?? null,
    fats_grams: sr.macros?.fats ?? null,
    cook_time_minutes: sr.cookTimeMin ?? null,
    difficulty: sr.difficulty ?? null,
    meal_type: sr.category ?? null,
    image_url: null,
    is_premade: false,
    source: sr.source ?? 'manual',
    has_full_recipe: !!(sr.steps && sr.steps.length > 0),
  };
  const ingredientRows = (sr.ingredients ?? []).map((ing, idx) => ({
    id: newId(),
    recipe_id: recipeUuid,
    ingredient_name: ing.name,
    quantity: ing.quantity ?? null,
    unit: ing.unit ?? null,
    calories: ing.calories ?? null,
    protein_grams: ing.macros?.protein ?? null,
    carbs_grams: ing.macros?.carbs ?? null,
    fats_grams: ing.macros?.fats ?? null,
    sort_order: idx,
  }));
  const stepRows = (sr.steps ?? []).map((text, idx) => ({
    id: newId(),
    recipe_id: recipeUuid,
    step_number: idx + 1,
    instruction_text: text,
  }));
  const savedRow = {
    id: sr.id,
    user_id: userId,
    recipe_id: recipeUuid,
    is_bookmarked: sr.favourited ?? false,
    saved_at: sr.addedAt ?? new Date().toISOString(),
  };
  return { recipeUuid, recipeRow, ingredientRows, stepRows, savedRow };
}

export function rowsToSavedRecipe(
  savedRow: Record<string, any>,
  recipeRow: Record<string, any> | undefined,
  ingredientRows: Record<string, any>[],
  stepRows: Record<string, any>[],
): SavedRecipe {
  const ingredients: Ingredient[] = (ingredientRows ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(ir => ({
      id: ir.id,
      name: ir.ingredient_name,
      quantity: numOrZero(ir.quantity),
      unit: ir.unit ?? '',
      calories: numOrUndef(ir.calories),
    }));
  const steps = (stepRows ?? [])
    .slice()
    .sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0))
    .map(s => s.instruction_text as string);

  return {
    id: savedRow.id,
    recipeId: recipeRow?.is_premade ? savedRow.recipe_id : undefined,
    name: recipeRow?.name ?? 'Recipe',
    category: (recipeRow?.meal_type as RecipeCategory) ?? undefined,
    calories: numOrZero(recipeRow?.calories),
    cookTimeMin: numOrUndef(recipeRow?.cook_time_minutes),
    macros: {
      protein: numOrZero(recipeRow?.protein_grams),
      carbs: numOrZero(recipeRow?.carbs_grams),
      fats: numOrZero(recipeRow?.fats_grams),
    },
    ingredients,
    steps: steps.length > 0 ? steps : undefined,
    difficulty: (recipeRow?.difficulty as RecipeDifficulty) ?? undefined,
    source: (recipeRow?.source as SavedRecipeSource) ?? 'manual',
    favourited: savedRow.is_bookmarked ?? false,
    addedAt: savedRow.saved_at ?? new Date().toISOString(),
  };
}

// ─── Grocery items (kitchen / cart / planned) ──────────────────────────────

export function sectionToTable(section: GrocerySection): SyncTable | null {
  switch (section) {
    case 'kitchen':
      return 'kitchen_items';
    case 'cart':
      return 'cart_items';
    case 'planned':
      return 'planned_ingredients';
    default:
      return null; // 'none' — not represented server-side
  }
}

export function groceryItemToRow(
  userId: string,
  item: GroceryItem,
): Record<string, unknown> {
  const table = sectionToTable(item.section);
  if (table === 'planned_ingredients') {
    return {
      user_id: userId,
      plan_id: null,
      ingredient_name: item.name,
      category: item.category ?? null,
      status: 'planned',
    };
  }
  if (table === 'cart_items') {
    return {
      user_id: userId,
      ingredient_name: item.name,
      is_bought: item.struckThrough ?? false,
    };
  }
  // kitchen_items
  return {
    user_id: userId,
    ingredient_name: item.name,
    category: item.category ?? null,
  };
}

export function rowToGroceryItem(
  table: SyncTable,
  row: Record<string, any>,
): GroceryItem {
  const name: string = row.ingredient_name;
  const section: GrocerySection =
    table === 'kitchen_items' ? 'kitchen' : table === 'cart_items' ? 'cart' : 'planned';
  return {
    key: normalizeIngredientName(name),
    name,
    category: row.category ?? classifyIngredient(name),
    section,
    struckThrough: table === 'cart_items' ? !!row.is_bought : undefined,
    updatedAt: row.added_at ?? new Date().toISOString(),
  };
}

// ─── small helpers ─────────────────────────────────────────────────────────

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' ? v : v == null ? undefined : Number(v);
}
function numOrZero(v: unknown): number {
  const n = numOrUndef(v);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}
