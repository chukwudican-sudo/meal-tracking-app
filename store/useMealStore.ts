import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

import type {
  AppStore,
  CustomizeDraft,
  DailyLog,
  GroceryItem,
  GroceryState,
  Ingredient,
  Macros,
  MealEditSession,
  MealEntry,
  MealPlan,
  MealStatus,
  MealSlot,
  MealTemplate,
  PendingSwap,
  PlanDayMeal,
  RecurrenceRule,
  SavedMeal,
  RecipeTemplate,
  SavedRecipe,
  UserGoals,
  UserProfile,
  WeightLogEntry,
} from './types';
import { RECIPE_SEED } from '@/constants/recipeSeed';
import { isPlaceholderSlot } from '@/constants/planSlots';
import {
  planNutrition, planSetsGoals, portionOf, scaleIngredients, scaleMacros, type PlanNutrition,
} from '@/lib/planNutrition';
import { PLAN_SEED } from '@/constants/planSeed';
import { DEFAULT_TRACKED_NUTRIENTS } from '@/constants/nutrients';
import { classifyIngredient, normalizeIngredientName } from '@/constants/ingredientCategories';
import { newId, isUuid, stableId } from '@/lib/sync/uuid';
import { entityKey, isGroceryKeyDirty } from '@/lib/sync/types';

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function toIsoDate(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Round a Date forward to the next :00 or :30 mark, returned as "HH:MM".
function roundToNextHalfHour(d: Date): string {
  const minutes = d.getMinutes();
  const target = new Date(d);
  if (minutes < 30) target.setMinutes(30, 0, 0);
  else { target.setHours(target.getHours() + 1); target.setMinutes(0, 0, 0); }
  const hh = String(target.getHours()).padStart(2, '0');
  const mm = String(target.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Drop keys whose value is undefined so a server snapshot never overwrites a
// present local field with `undefined` during a spread merge.
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// Deep-clone ingredients with fresh ids so multiple meals don't share refs.
function cloneIngredients(items: Ingredient[]): Ingredient[] {
  return items.map((i, idx) => ({
    ...i,
    id: `ing-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
  }));
}

// ─── Nutrition backfill (keeps the app testable) ──────────────────────────────
// Legacy persisted meals — and custom/AI/plan-derived entries created before
// nutrition resolution existed — can carry calories:0 with all-zero macros,
// which makes the Home progress never move when they're completed. On rehydrate
// we backfill deterministic, realistic values for any entry that is COMPLETELY
// empty. Entries that already have real numbers are left untouched.
function isNutritionEmpty(calories?: number, macros?: Macros): boolean {
  const c = typeof calories === 'number' ? calories : 0;
  return c <= 0
    && (macros?.protein ?? 0) <= 0
    && (macros?.carbs ?? 0) <= 0
    && (macros?.fats ?? 0) <= 0;
}

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic per-name macros so different meals show different (but sensible)
// values rather than an identical placeholder everywhere.
function fallbackNutrition(name: string): { calories: number; macros: Macros } {
  const seed = seedFromString(name || 'meal');
  const protein = 20 + (seed % 25);         // 20–44 g
  const carbs   = 30 + ((seed >> 3) % 40);  // 30–69 g
  const fats    = 8  + ((seed >> 6) % 15);  // 8–22 g
  return { calories: protein * 4 + carbs * 4 + fats * 9, macros: { protein, carbs, fats } };
}

function ensureNutrition<T extends { name: string; calories?: number; macros?: Macros }>(m: T): T {
  if (!isNutritionEmpty(m.calories, m.macros)) return m;
  const fb = fallbackNutrition(m.name);
  return { ...m, calories: fb.calories, macros: fb.macros };
}

// Match priority: by recipeId (premade source of truth), then by lowercased name.
function findExistingSavedRecipe(
  list: SavedRecipe[],
  candidate: { recipeId?: string; name: string }
): SavedRecipe | undefined {
  if (candidate.recipeId) {
    const byRecipeId = list.find(r => r.recipeId === candidate.recipeId);
    if (byRecipeId) return byRecipeId;
  }
  const lower = candidate.name.trim().toLowerCase();
  return list.find(r => r.name.trim().toLowerCase() === lower);
}

export function getDayOfWeek(isoDate: string): number {
  return new Date(isoDate + 'T00:00:00').getDay();
}

function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso + 'T00:00:00').getTime();
  const end = new Date(endIso + 'T00:00:00').getTime();
  return Math.floor((end - start) / 86400000);
}

function monthsBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso + 'T00:00:00');
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function isOutsideRange(date: string, recurrence: RecurrenceRule): boolean {
  if ('excludeDates' in recurrence && recurrence.excludeDates?.includes(date)) return true;
  if ('startDate' in recurrence && recurrence.startDate && date < recurrence.startDate) return true;
  if ('untilDate' in recurrence && recurrence.untilDate && date > recurrence.untilDate) return true;
  return false;
}

export function isTemplateApplicableOnDate(template: MealTemplate, date: string): boolean {
  const recurrence = template.recurrence;
  if (recurrence.type === 'once') return recurrence.date === date;
  if (isOutsideRange(date, recurrence)) return false;

  if (recurrence.type === 'daily') {
    const every = Math.max(1, recurrence.every ?? 1);
    if (every === 1 || !recurrence.startDate) return true;
    return daysBetween(recurrence.startDate, date) % every === 0;
  }

  if (recurrence.type === 'weekly') {
    if (!recurrence.days.includes(getDayOfWeek(date))) return false;
    const every = Math.max(1, recurrence.every ?? 1);
    if (every === 1 || !recurrence.startDate) return true;
    return Math.floor(daysBetween(recurrence.startDate, date) / 7) % every === 0;
  }

  if (recurrence.type === 'monthly') {
    const currentDay = new Date(date + 'T00:00:00').getDate();
    if (currentDay !== recurrence.day) return false;
    const every = Math.max(1, recurrence.every ?? 1);
    if (every === 1 || !recurrence.startDate) return true;
    return monthsBetween(recurrence.startDate, date) % every === 0;
  }

  return false;
}

// Turn a weekly MealPlan into runtime MealTemplates (one per distinct
// slot+time+recipe pairing, with a weekly recurrence covering the weekdays it
// appears on). Shared by activatePlan and the non-destructive
// hydrateActivePlanIfNeeded so both derive identical templates.
// One resolver for a plan meal's recipe (1 serving), shared by the meals a
// plan creates and the plan's displayed/goal numbers, so the two can never
// disagree. Premade recipes first, then the user's saved/AI recipes (by id,
// source id, or name); an unknown recipe gets deterministic non-zero
// nutrition so plan meals always count on Home.
function planMealResolver(recipes: RecipeTemplate[], savedRecipes: SavedRecipe[]) {
  const recipeById = new Map(recipes.map(r => [r.id, r]));
  const savedById = new Map(savedRecipes.map(r => [r.id, r]));
  const savedByRecipeId = new Map(
    savedRecipes.filter(r => r.recipeId).map(r => [r.recipeId as string, r]),
  );
  return (recipeId: string, recipeName: string): { calories: number; macros: Macros; ingredients: Ingredient[] } => {
    const nameKey = recipeName.trim().toLowerCase();
    const recipe =
      recipeById.get(recipeId) ??
      savedById.get(recipeId) ??
      savedByRecipeId.get(recipeId) ??
      recipes.find(r => r.name.trim().toLowerCase() === nameKey) ??
      savedRecipes.find(r => r.name.trim().toLowerCase() === nameKey);
    const fb = fallbackNutrition(recipeName);
    return {
      calories: recipe?.calories && recipe.calories > 0 ? recipe.calories : fb.calories,
      macros: recipe?.macros ?? fb.macros,
      ingredients: recipe?.ingredients ?? [],
    };
  };
}

// A plan's real daily calories/macros (meals × portions, 7-day average).
// Screens pass the store's recipes/savedRecipes; see lib/planNutrition.ts.
export function planNutritionOf(
  plan: Pick<MealPlan, 'days'>,
  recipes: RecipeTemplate[],
  savedRecipes: SavedRecipe[],
): PlanNutrition | null {
  return planNutrition(plan, planMealResolver(recipes, savedRecipes));
}

// Goals while a plan with its own numbers runs: the plan's real averages.
function goalsForPlan(state: AppStore, plan: MealPlan, base: UserGoals): UserGoals {
  const n = planNutritionOf(plan, state.recipes, state.savedRecipes);
  if (!n) return base;
  return { ...base, dailyCalories: n.calories, protein: n.protein, carbs: n.carbs, fats: n.fats };
}

function buildTemplatesFromPlan(state: AppStore, plan: MealPlan): MealTemplate[] {
  const resolveNutrition = planMealResolver(state.recipes, state.savedRecipes);

  // Build one MealTemplate per (slotName + time + recipe) combo, with
  // a weekly recurrence whose `days[]` is the set of weekdays that
  // pairing appears on. Weekday convention: Mon=0..Sun=6.
  type Bucket = {
    slotName: string;
    time: string;
    recipeId: string;
    recipeName: string;
    servings: number;
    days: number[];
  };
  const buckets = new Map<string, Bucket>();

  plan.days.forEach((dayMeals, dayIdx) => {
    (dayMeals ?? []).forEach(m => {
      // Empty / removed customize slots are placeholders, never meals.
      if (isPlaceholderSlot(m.recipeId)) return;
      // Portion is part of the key: the same recipe at another portion on
      // another day is a different meal.
      const servings = portionOf(m);
      const key = `${m.slotName}|${m.time}|${m.recipeId}|${m.recipeName}|${servings}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.days.push(dayIdx);
      } else {
        buckets.set(key, {
          slotName: m.slotName,
          time: m.time,
          recipeId: m.recipeId,
          recipeName: m.recipeName,
          servings,
          days: [dayIdx],
        });
      }
    });
  });

  const now = Date.now();
  let idCounter = 0;
  const nextTemplates: MealTemplate[] = [];

  buckets.forEach(bucket => {
    const base = resolveNutrition(bucket.recipeId, bucket.recipeName);
    const s = bucket.servings;
    const calories    = Math.round(base.calories * s);
    const macros      = scaleMacros(base.macros, s);
    const ingredients = cloneIngredients(scaleIngredients(base.ingredients, s));

    // Plan day indices are Monday=0..Sunday=6, but recurrence.days uses
    // the JS weekday convention Sunday=0..Saturday=6. Convert so the
    // meals a user planned for "Monday" actually recur on Mondays.
    // startDate: a plan applies from the day it's activated, never to earlier
    // days (without it, every past weekday back-filled with plan meals when
    // viewed — Oct 28 bug). A login restore can't know the original start, so
    // it starts that day; days before already have their synced logs.
    const recurrence: RecurrenceRule = {
      type: 'weekly',
      days: [...new Set(bucket.days.map(d => (d + 1) % 7))].sort((a, b) => a - b),
      startDate: toIsoDate(new Date()),
    };

    nextTemplates.push({
      id: `tpl-plan-${now}-${idCounter++}`,
      name: bucket.recipeName,
      time: bucket.time,
      calories,
      ingredients,
      macros,
      recurrence,
      ...(s !== 1 ? { servings: s } : {}),
    });
  });

  return nextTemplates;
}

// Find the Monday on-or-before a given ISO date (the start of that week).
export function mondayOfWeek(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun … 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // shift Sun to previous Monday
  d.setDate(d.getDate() + diff);
  return toIsoDate(d);
}

function shiftIsoLocal(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

// Collect all "active" meal names — used by Grocery cleanup to determine
// whether an ingredient is still needed after a meal is removed.
function collectActiveMealNames(state: AppStore): string[] {
  const names = new Set<string>();
  state.templates.forEach(t => names.add(t.name));
  Object.values(state.logs).forEach(log => {
    log.meals.forEach(m => names.add(m.name));
  });
  return Array.from(names);
}

function toMinutesFromHHMM(value: string): number | null {
  const [hh, mm] = value.split(':');
  const hours = Number(hh);
  const minutes = Number(mm);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Status for a meal the USER adds (Scan / AI / Manual / Recipes): logging means
// you ate it, so now-or-earlier today (or any past day) counts immediately;
// later today or a future day is planned and waits to be ticked off. Before,
// every add was 'pending' at "now" and flipped to 'missed' a minute later, so
// scanned meals never counted toward the rings.
export function initialMealStatus(date: string, time: string, now: Date = new Date()): MealStatus {
  const today = toIsoDate(now);
  if (date < today) return 'completed';
  if (date > today) return 'pending';
  const mins = toMinutesFromHHMM(time);
  return mins === null || mins <= now.getHours() * 60 + now.getMinutes() ? 'completed' : 'pending';
}

// What a meal shows as. A planned meal (not the user's own) still unticked
// after its time is "missed" — worked out here, not stored: the stored flag
// was only ever set for today while the app was open, so days the app wasn't
// opened, and every past day after a reinstall (the server keeps only eaten /
// not eaten), showed skipped meals as merely unticked.
export function displayMealStatus(
  meal: Pick<MealEntry, 'status' | 'isAdHoc' | 'time'>,
  date: string,
  now: Date = new Date(),
): MealStatus {
  if (meal.status !== 'pending' || meal.isAdHoc) return meal.status;
  const today = toIsoDate(now);
  if (date < today) return 'missed';
  if (date > today) return 'pending';
  const mins = toMinutesFromHHMM(meal.time);
  return mins !== null && mins <= now.getHours() * 60 + now.getMinutes() ? 'missed' : 'pending';
}

// The user's own meals after today (their meals on future days, recipes
// scheduled on unopened days, own repeating meals) — what re-applying a plan
// would replace, excluding the plan's own meals.
export function countOwnFutureMeals(
  logs: Record<string, DailyLog>,
  templates: MealTemplate[],
  now: Date = new Date(),
): number {
  const today = toIsoDate(now);
  const inLogs = Object.entries(logs).reduce(
    (n, [d, log]) => (d > today ? n + log.meals.filter(m => m.isAdHoc).length : n),
    0,
  );
  const own = templates.filter(
    t => !isPlanTemplate(t) && (t.recurrence.type !== 'once' || (t.recurrence.date > today && !logs[t.recurrence.date])),
  ).length;
  return inLogs + own;
}

// "This profile holds the user's real data" (onboarding answers or a pulled
// account): a name, or any onboarding answer — accounts from Apple/Google
// sign-in may have no name. Used by the sync engine's first-login decision.
// (The login gate's own `!!firstName` check is deliberately untouched —
// widening it is a separate pass Alex deferred.)
export function profileHasData(p: Partial<UserProfile> | undefined | null): boolean {
  if (!p) return false;
  return !!p.firstName || p.goalType != null || p.heightCm != null || p.weightKg != null || p.age != null;
}

// The single test for "does this template belong to the plan?". Plan
// templates are always minted as `tpl-plan-…` (buildTemplatesFromPlan); the
// demo seeds (exact ids in SEED_TEMPLATES) act as a plan too. Anything else is
// the user's own (scheduled recipes; draft-card repeating meals, which are
// `tpl-${Date.now()}` — so never match seeds by pattern). Works for data
// persisted before this rule existed — no flag/migration needed.
export function isPlanTemplate(t: Pick<MealTemplate, 'id'>): boolean {
  return t.id.startsWith('tpl-plan-') || SEED_TEMPLATES.some(s => s.id === t.id);
}

// The active plan is matched by name, so two plans with one name get mixed
// up (which is current, which a reinstall restores). Every new or renamed
// plan takes a name no saved or Explore plan has: "My Plan — Nov 6 (2)".
export function uniquePlanName(base: string, plans: Pick<MealPlan, 'name'>[]): string {
  const taken = new Set(plans.map(p => p.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
  return name;
}

// The first-launch demo meals (exact ids) — never the user's own food.
export function isSeedTemplate(t: Pick<MealTemplate, 'id'>): boolean {
  return SEED_TEMPLATES.some(s => s.id === t.id);
}

// Recipes the user made (Custom Recipe / AI / manual) can be fixed; the
// app's built-in recipes ('premade') are reference content and can't.
export function isOwnRecipe(r: Pick<SavedRecipe, 'source'>): boolean {
  return r.source !== 'premade';
}

// The meals templates put on a day that has no log yet. A meal from the
// user's own template gets a stable id per (template, day), so two phones
// opening the same day sync one row, not two copies.
function mealsFromTemplates(templates: MealTemplate[], date: string): MealEntry[] {
  return templates
    .filter(t => isTemplateApplicableOnDate(t, date))
    .map(t => {
      const own = !isPlanTemplate(t);
      return {
        id:          own ? stableId(`tpl-meal|${t.id}|${date}`) : newId(),
        name:        t.name,
        time:        t.time,
        calories:    t.calories,
        ingredients: t.ingredients,
        macros:      t.macros,
        status:      'pending' as const,
        templateId:  t.id,
        ...(t.servings ? { servings: t.servings } : {}),
        // Built from the user's own template (scheduled recipe / repeating
        // meal): theirs, not the plan's — for heatmap, activation, swaps.
        ...(own ? { isAdHoc: true } : {}),
      };
    });
}

// Items another phone deleted (sync_deletions notes on a delta pull) are
// removed here before the pulled rows merge, so an item deleted and then
// re-created (same Kitchen name, same weight day) correctly stays. An item
// with a write still queued on this phone is kept: its upload wins, and
// unsynced data is never dropped.
const GROCERY_TABLE_BY_SECTION: Partial<Record<GroceryItem['section'], string>> = {
  kitchen: 'kitchen_items',
  cart: 'cart_items',
  planned: 'planned_ingredients',
};

function withoutDeleted(
  state: AppStore,
  deletions: { table: string; key: string }[] | undefined,
  dirtyKeys: Set<string>,
): AppStore {
  if (!deletions || deletions.length === 0) return state;
  const keys = (table: string) => new Set(deletions.filter(d => d.table === table).map(d => d.key));
  const meals = keys('meal_logs');
  const weights = keys('weight_logs');
  const saved = keys('saved_recipes');
  const plans = keys('plans');
  const tpls = keys('meal_templates');
  const groceryByTable: Record<string, Set<string>> = {};
  ['kitchen_items', 'cart_items', 'planned_ingredients'].forEach(t => {
    groceryByTable[t] = new Set(Array.from(keys(t)).map(normalizeIngredientName));
  });

  let logs = state.logs;
  if (meals.size > 0) {
    logs = {};
    for (const [date, log] of Object.entries(state.logs)) {
      const kept = log.meals.filter(m => !meals.has(m.id) || dirtyKeys.has(entityKey.mealLog(m.id)));
      logs[date] = kept.length === log.meals.length ? log : { ...log, meals: kept };
    }
  }
  const weightLog = weights.size > 0
    ? state.weightLog.filter(w => !weights.has(w.date) || dirtyKeys.has(entityKey.weightLog(w.date)))
    : state.weightLog;
  const savedRecipes = saved.size > 0
    ? state.savedRecipes.filter(r => !saved.has(r.id) || dirtyKeys.has(entityKey.savedRecipe(r.id)))
    : state.savedRecipes;
  const savedPlans = plans.size > 0
    ? state.savedPlans.filter(p => !plans.has(p.id) || dirtyKeys.has(entityKey.plan(p.id)))
    : state.savedPlans;
  const templates = tpls.size > 0
    ? state.templates.filter(t => isPlanTemplate(t) || !tpls.has(t.id) || dirtyKeys.has(entityKey.template(t.id)))
    : state.templates;
  let grocery = state.grocery;
  const anyGrocery = Object.values(groceryByTable).some(set => set.size > 0);
  if (anyGrocery) {
    const items: Record<string, GroceryItem> = {};
    for (const [key, item] of Object.entries(state.grocery.items)) {
      // Only when it's still in the section it was deleted from: a move
      // (Cart → Kitchen) deletes from the old table and re-adds in the new.
      const table = GROCERY_TABLE_BY_SECTION[item.section];
      const gone = !!table && groceryByTable[table].has(key) && !isGroceryKeyDirty(dirtyKeys, key);
      if (!gone) items[key] = item;
    }
    grocery = { ...state.grocery, items };
  }
  return { ...state, logs, weightLog, savedRecipes, savedPlans, templates, grocery };
}

// One rule for "this meal is the user's, keep it" (plan activation + end).
function isUserOwnedMeal(m: MealEntry, ownTemplateIds: Set<string>): boolean {
  return !!m.isAdHoc || m.status === 'completed' || (!!m.templateId && ownTemplateIds.has(m.templateId));
}

// The plan's part of the schedule, removed from today on: its templates go,
// and from today on only what the user owns stays (meals they added, anything
// eaten, meals from their own templates). Past days are history. Shared by
// endPlan and by a pull that says the plan ended/changed on another phone;
// `keepMeal` lets the latter keep meals with a write still queued.
function withoutPlanFromToday(
  templates: MealTemplate[],
  logs: Record<string, DailyLog>,
  today: string,
  keepMeal: (m: MealEntry) => boolean = () => false,
): { templates: MealTemplate[]; logs: Record<string, DailyLog> } {
  const keptTemplates = templates.filter(t => !isPlanTemplate(t));
  const keptTemplateIds = new Set(keptTemplates.map(t => t.id));
  const nextLogs: Record<string, DailyLog> = {};
  Object.entries(logs).forEach(([d, log]) => {
    if (d < today) {
      nextLogs[d] = log;
      return;
    }
    const keep = log.meals.filter(m => isUserOwnedMeal(m, keptTemplateIds) || keepMeal(m));
    if (d > today && keep.length === 0) return;
    nextLogs[d] = { ...log, meals: keep };
  });
  return { templates: keptTemplates, logs: nextLogs };
}

// Meals on days after today — the ones activating a new plan replaces.
export function countFutureMeals(
  logs: Record<string, DailyLog>,
  templates: MealTemplate[],
  now: Date = new Date(),
): number {
  const today = toIsoDate(now);
  const inLogs = Object.entries(logs).reduce((n, [d, log]) => (d > today ? n + log.meals.length : n), 0);
  // Recipes scheduled on a future day nobody has opened yet live only as
  // 'once' templates — activation drops them too, so they count.
  const unopened = templates.filter(
    t => t.recurrence.type === 'once' && t.recurrence.date >= today && !logs[t.recurrence.date],
  ).length;
  // The user's own repeating meals live only as templates too.
  const ownRepeating = templates.filter(t => !isPlanTemplate(t) && t.recurrence.type !== 'once').length;
  return inLogs + unopened + ownRepeating;
}

// ─── Goals ────────────────────────────────────────────────────────────────────

const DEFAULT_GOALS: UserGoals = {
  dailyCalories:    2200,
  protein:           165,
  carbs:             220,
  fats:               65,
  waterTargetCups:     8,
  isCalculated:    false,
};

const DEFAULT_MEAL_SLOTS: MealSlot[] = [
  { id: 'slot-bf',  name: 'Breakfast',          time: '07:30', skipped: false },
  { id: 'slot-am',  name: 'Mid-morning Snack',  time: '10:30', skipped: false },
  { id: 'slot-ln',  name: 'Lunch',              time: '13:00', skipped: false },
  { id: 'slot-pm',  name: 'Afternoon Snack',    time: '15:30', skipped: false },
  { id: 'slot-dn',  name: 'Dinner',             time: '19:00', skipped: false },
];

const DEFAULT_PROFILE: UserProfile = {
  name: '',
  firstName: undefined,
  lastName:  undefined,
  email:     undefined,

  age:           undefined,
  heightCm:      undefined,
  weightKg:      undefined,
  gender:        undefined,
  activityLevel: undefined,
  goalType:      undefined,

  weightUnit: 'lbs',
  subscription: 'free',
  dietaryRestrictions: [],
  allergies: [],

  mealRemindersEnabled: true,
  remindMinutesBefore:  15,

  mealSlots: DEFAULT_MEAL_SLOTS,
  trackedNutrients: DEFAULT_TRACKED_NUTRIENTS,
  activePlanName: undefined,

  // Onboarding lifecycle — a brand-new profile has not completed onboarding.
  onboardingComplete: false,
  pendingFirstPlan: false,
  notificationsAllowed: undefined,
  pendingEmailVerification: false,
};

// ─── Templates ────────────────────────────────────────────────────────────────

const SEED_TEMPLATES: MealTemplate[] = [
  {
    id: 'tpl-1',
    name: 'Breakfast',
    time: '07:30',
    calories: 420,
    ingredients: [
      { id: 'i1', name: 'Oats',           quantity: 80, unit: 'g' },
      { id: 'i2', name: 'Protein powder', quantity: 30, unit: 'g' },
      { id: 'i3', name: 'Banana',         quantity: 1,  unit: ''  },
    ],
    macros: { protein: 35, carbs: 55, fats: 8 },
    recurrence: { type: 'daily' },
  },
  {
    id: 'tpl-2',
    name: 'Mid-morning snack',
    time: '10:30',
    calories: 180,
    ingredients: [
      { id: 'i4', name: 'Greek yogurt', quantity: 150, unit: 'g' },
      { id: 'i5', name: 'Almonds',      quantity: 20,  unit: 'g' },
    ],
    macros: { protein: 15, carbs: 12, fats: 7 },
    recurrence: { type: 'weekly', days: [1, 2, 3, 4, 5] },
  },
  {
    id: 'tpl-3',
    name: 'Lunch',
    time: '13:00',
    calories: 520,
    ingredients: [
      { id: 'i6', name: 'Chicken breast', quantity: 200, unit: 'g' },
      { id: 'i7', name: 'Brown rice',     quantity: 150, unit: 'g' },
      { id: 'i8', name: 'Broccoli',       quantity: 100, unit: 'g' },
    ],
    macros: { protein: 42, carbs: 55, fats: 8 },
    recurrence: { type: 'daily' },
  },
  {
    id: 'tpl-4',
    name: 'Pre-workout',
    time: '16:30',
    calories: 200,
    ingredients: [
      { id: 'i9',  name: 'Rice cakes',     quantity: 3,  unit: '' },
      { id: 'i10', name: 'Peanut butter',  quantity: 20, unit: 'g' },
    ],
    macros: { protein: 8, carbs: 28, fats: 7 },
    recurrence: { type: 'weekly', days: [1, 2, 3, 4, 5] },
  },
  {
    id: 'tpl-5',
    name: 'Dinner',
    time: '19:30',
    calories: 480,
    ingredients: [
      { id: 'i11', name: 'Salmon',       quantity: 180, unit: 'g' },
      { id: 'i12', name: 'Sweet potato', quantity: 200, unit: 'g' },
      { id: 'i13', name: 'Spinach',      quantity: 80,  unit: 'g' },
    ],
    macros: { protein: 42, carbs: 38, fats: 16 },
    recurrence: { type: 'daily' },
  },
];

// ─── Seed logs (dynamic — always relative to today at module load) ─────────────

function buildSeedLog(daysAgo: number): [string, DailyLog] {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const date       = toIsoDate(d);

  const applicable = SEED_TEMPLATES.filter(t => isTemplateApplicableOnDate(t, date));

  const meals: MealEntry[] = applicable.map(t => ({
    id:          newId(),
    name:        t.name,
    time:        t.time,
    calories:    t.calories,
    ingredients: t.ingredients,
    macros:      t.macros,
    status:      'completed',
    seed:        true,   // built-in sample history — never uploaded to the cloud
  }));

  return [date, { date, meals, waterMl: 500 }];
}

const SEED_LOGS: Record<string, DailyLog> = Object.fromEntries([
  buildSeedLog(4),
  buildSeedLog(3),
  buildSeedLog(2),
  buildSeedLog(1),
]);

// ─── Initial grocery state ────────────────────────────────────────────────────

const INITIAL_GROCERY: GroceryState = {
  weekStart: '',                // empty so first refresh always runs
  items: {},
  hasSeenTip: false,
  cartOldWeekItems: [],
};

const SEED_LIBRARY: SavedMeal[] = SEED_TEMPLATES.map(t => ({
  id:         `lib-${t.id}`,
  name:        t.name,
  calories:    t.calories,
  ingredients: t.ingredients,
  macros:      t.macros,
  usageCount:  0,
  lastUsed:    toIsoDate(new Date()),
}));

// ─── Storage fallback (prevents runtime crashes if native module missing) ─────

const memoryStore: Record<string, string> = {};

const memoryStorage: StateStorage = {
  getItem: async (name) => memoryStore[name] ?? null,
  setItem: async (name, value) => {
    memoryStore[name] = value;
  },
  removeItem: async (name) => {
    delete memoryStore[name];
  },
};

const webStorage: StateStorage = {
  getItem: async (name) => {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(name);
    } catch {
      return memoryStorage.getItem(name);
    }
  },
  setItem: async (name, value) => {
    try {
      if (typeof localStorage === 'undefined') {
        await memoryStorage.setItem(name, value);
        return;
      }
      localStorage.setItem(name, value);
    } catch {
      await memoryStorage.setItem(name, value);
    }
  },
  removeItem: async (name) => {
    try {
      if (typeof localStorage === 'undefined') {
        await memoryStorage.removeItem(name);
        return;
      }
      localStorage.removeItem(name);
    } catch {
      await memoryStorage.removeItem(name);
    }
  },
};

const nativeStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await AsyncStorage.getItem(name);
    } catch {
      return memoryStorage.getItem(name);
    }
  },
  setItem: async (name, value) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch {
      await memoryStorage.setItem(name, value);
    }
  },
  removeItem: async (name) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch {
      await memoryStorage.removeItem(name);
    }
  },
};

const appStorage = Platform.OS === 'web' ? webStorage : nativeStorage;

// ─── Store ────────────────────────────────────────────────────────────────────

export const useMealStore = create<AppStore>()(
  persist(
    (set, get) => ({
      logs:         SEED_LOGS,
      goals:        DEFAULT_GOALS,
      profile:      DEFAULT_PROFILE,
      streak:       5,
      templates:    SEED_TEMPLATES,
      library:      SEED_LIBRARY,
      grocery:      INITIAL_GROCERY,
      recipes:      RECIPE_SEED,
      savedRecipes: [],
      weightLog:    [],
      plans:        PLAN_SEED,
      savedPlans:   [],
      viewedRecipeIds: [],
      planAvoidFoods: [],
      findPlanAnswers: null,
      recipeFixHistory: {},
      goalsBeforePlan: null,
      pendingSwap:    null,
      customizeDraft: null,
      pendingRecipeConcept: null,
      mealEditSession: null,

      // ── Toggle completion ──────────────────────────────────────────────────
      toggleMealStatus: (date, mealId) => {
        set(state => {
          const log = state.logs[date];
          if (!log) return state;
          return {
            logs: {
              ...state.logs,
              [date]: {
                ...log,
                meals: log.meals.map(m =>
                  m.id === mealId
                    ? { ...m, status: m.status === 'completed' ? 'pending' : 'completed' }
                    : m
                ),
              },
            },
          };
        });
        // Recalculate streak immediately after any toggle
        get().recalcStreak();
      },

      // ── Water ──────────────────────────────────────────────────────────────
      logWater: (date, ml) => {
        set(state => {
          const log = state.logs[date] ?? { date, meals: [], waterMl: 0 };
          return {
            logs: {
              ...state.logs,
              [date]: { ...log, waterMl: Math.max(0, log.waterMl + ml) },
            },
          };
        });
      },

      // ── Meal CRUD on a day ─────────────────────────────────────────────────
      addMealToDay: (date, entry) => {
        // A today/future day with no log yet would be created holding ONLY this
        // meal, and resolveDayFromTemplates skips days that already have a log,
        // so that day's plan meals would never appear. Fill them in first.
        const resolvedNow = !get().logs[date] && date >= toIsoDate(new Date());
        if (resolvedNow) get().resolveDayFromTemplates(date);
        set(state => {
          const log = state.logs[date] ?? { date, meals: [], waterMl: 0 };
          // Only right after that pre-resolve: if it just built a meal for the
          // entry's own template (draft card: addTemplate then addMealToDay),
          // replace it instead of adding the same meal twice.
          const dupIdx = resolvedNow && entry.templateId
            ? log.meals.findIndex(m => m.templateId === entry.templateId)
            : -1;
          const meals = dupIdx >= 0
            ? log.meals.map((m, i) => (i === dupIdx ? entry : m))
            : [...log.meals, entry];
          return {
            logs: {
              ...state.logs,
              [date]: { ...log, meals },
            },
          };
        });
      },

      removeMealFromDay: (date, mealId) => {
        // Capture removed meal's ingredient names before mutating state.
        const before = get();
        const removed = before.logs[date]?.meals.find(m => m.id === mealId);
        const removedIngredientNames =
          removed?.ingredients?.map(i => i.name).filter(Boolean) ?? [];

        set(state => {
          const log = state.logs[date];
          if (!log) return state;
          return {
            logs: {
              ...state.logs,
              [date]: { ...log, meals: log.meals.filter(m => m.id !== mealId) },
            },
          };
        });

        if (removedIngredientNames.length > 0) {
          const after = get();
          const remainingMealNames = collectActiveMealNames(after);
          after.cleanupRemovedMealIngredients(
            removedIngredientNames,
            remainingMealNames,
          );
        }
      },

      // Recurrence-aware removal for the Day Detail page X button.
      // Mirrors the Google Calendar 3-option semantic.
      removeDayMealWithScope: (date, mealId, scope) => {
        const before = get();
        const meal = before.logs[date]?.meals.find(m => m.id === mealId);
        const templateId = meal?.templateId;

        // Always drop the entry from this day.
        before.removeMealFromDay(date, mealId);

        if (!templateId) return;

        if (scope === 'all') {
          get().removeTemplate(templateId);
          return;
        }

        if (scope === 'future') {
          // End the recurrence the day before `date`. Once-templates are no-ops here
          // since "this and future" reduces to "this only" for a single occurrence.
          const prev = new Date(date + 'T00:00:00');
          prev.setDate(prev.getDate() - 1);
          const untilDate = toIsoDate(prev);
          set(state => ({
            templates: state.templates.map(t => {
              if (t.id !== templateId) return t;
              if (t.recurrence.type === 'once') return t;
              return {
                ...t,
                recurrence: { ...t.recurrence, untilDate },
              } as MealTemplate;
            }),
          }));
        }
        // scope === 'this' is already handled by the removeMealFromDay call above.
      },

      restoreMealToDay: (date, entry, index) => {
        set(state => {
          const log = state.logs[date] ?? { date, meals: [], waterMl: 0 };
          const existingIndex = log.meals.findIndex(m => m.id === entry.id);
          if (existingIndex >= 0) return state;

          const insertAt = Math.max(0, Math.min(index, log.meals.length));
          const nextMeals = [...log.meals];
          nextMeals.splice(insertAt, 0, entry);

          return {
            logs: {
              ...state.logs,
              [date]: { ...log, meals: nextMeals },
            },
          };
        });
      },

      editMealOnDay: (date, entry) => {
        set(state => {
          const log = state.logs[date];
          if (!log) return state;
          return {
            logs: {
              ...state.logs,
              [date]: {
                ...log,
                meals: log.meals.map(m => {
                  if (m.id !== entry.id) return m;
                  // Preserve the permanent ad-hoc flag, templateId link, and the
                  // seed marker from the existing entry — callers may not include
                  // them in `entry`. Keeping `seed` means built-in demo meals stay
                  // excluded from cloud sync even after being edited.
                  // Same photo as stored: keep what sync recorded for it (an
                  // upload may have finished while this draft was open — the
                  // draft's copy would drop it and trigger a re-upload).
                  const samePhoto = entry.photoUri !== undefined && entry.photoUri === m.photoUri;
                  return {
                    ...entry,
                    isAdHoc:    entry.isAdHoc    ?? m.isAdHoc,
                    templateId: entry.templateId ?? m.templateId,
                    seed:       entry.seed       ?? m.seed,
                    ...(samePhoto
                      ? { photoPath: m.photoPath ?? entry.photoPath, photoUploadedFrom: m.photoUploadedFrom ?? entry.photoUploadedFrom }
                      : {}),
                  };
                }),
              },
            },
          };
        });
      },

      // ── Missed meals ────────────────────────────────────────────────────────
      markPastDueMealsAsMissed: (dateArg) => {
        set(state => {
          const now = new Date();
          const todayIso = toIsoDate(now);
          const targetDate = dateArg ?? todayIso;
          if (targetDate !== todayIso) return state;

          const log = state.logs[targetDate];
          if (!log) return state;

          let changed = false;

          const nextMeals = log.meals.map(meal => {
            // Same rule as the display (only planned meals can be "missed").
            if (meal.status !== 'pending' || displayMealStatus(meal, targetDate, now) !== 'missed') return meal;
            changed = true;
            return { ...meal, status: 'missed' as const };
          });

          if (!changed) return state;
          return {
            logs: {
              ...state.logs,
              [targetDate]: {
                ...log,
                meals: nextMeals,
              },
            },
          };
        });
      },

      // ── Templates ─────────────────────────────────────────────────────────
      addTemplate: template =>
        set(state => ({ templates: [...state.templates, template] })),

      updateTemplate: template =>
        set(state => ({
          templates: state.templates.map(t => t.id === template.id ? template : t),
        })),

      removeTemplate: id => {
        const before = get();
        const removedTemplate = before.templates.find(t => t.id === id);
        const removedIngredientNames =
          removedTemplate?.ingredients?.map(i => i.name).filter(Boolean) ?? [];

        set(state => ({ templates: state.templates.filter(t => t.id !== id) }));

        if (removedIngredientNames.length > 0) {
          const after = get();
          const remainingMealNames = collectActiveMealNames(after);
          after.cleanupRemovedMealIngredients(
            removedIngredientNames,
            remainingMealNames,
          );
        }
      },

      // ── Resolve day from templates ─────────────────────────────────────────
      resolveDayFromTemplates: (date) => {
        set(state => {
          if (state.logs[date]) return state;  // already has entries — skip
          const meals = mealsFromTemplates(state.templates, date);
          if (meals.length === 0) return state;
          return {
            logs: {
              ...state.logs,
              [date]: { date, meals, waterMl: 0 },
            },
          };
        });
      },

      // ── Library ───────────────────────────────────────────────────────────
      saveToLibrary: meal =>
        set(state => ({ library: [...state.library, meal] })),

      removeFromLibrary: id =>
        set(state => ({ library: state.library.filter(m => m.id !== id) })),

      updateLibraryMeal: meal =>
        set(state => ({ library: state.library.map(m => m.id === meal.id ? meal : m) })),

      // ── Goals ─────────────────────────────────────────────────────────────
      // A manual edit wins: nothing gets restored over it when a plan ends.
      updateGoals: partial =>
        set(state => ({ goals: { ...state.goals, ...partial }, goalsBeforePlan: null })),

      // ── Profile ───────────────────────────────────────────────────────────
      updateProfile: partial =>
        set(state => ({ profile: { ...state.profile, ...partial } })),

      // ── Weight log ─────────────────────────────────────────────────────────
      // Records a weight entry (also used by the Progress chart) and updates
      // the canonical profile.weightKg in one transaction. If an entry already
      // exists for today, it's replaced (last write wins).
      logWeight: (weightKg) => {
        if (!Number.isFinite(weightKg) || weightKg <= 0) return;
        const today = toIsoDate(new Date());
        set(state => {
          const filtered = state.weightLog.filter(e => e.date !== today);
          const next: WeightLogEntry[] = [...filtered, { date: today, weightKg }]
            .sort((a, b) => a.date.localeCompare(b.date));
          return {
            weightLog: next,
            profile:   { ...state.profile, weightKg },
          };
        });
      },

      // Reset of all user-entered data (used by Settings → Delete Account).
      // Keeps the seeded recipes catalog and grocery initial state intact.
      resetUserData: () => {
        set({
          findPlanAnswers: null, // per account
          logs:         {},
          goals:        DEFAULT_GOALS,
          goalsBeforePlan: null,
          // DEFAULT_PROFILE has onboardingComplete:false, so a reset restarts
          // the onboarding flow on next app entry.
          profile:      DEFAULT_PROFILE,
          streak:       0,
          templates:    [],
          library:      [],
          grocery:      INITIAL_GROCERY,
          savedRecipes: [],
          recipeFixHistory: {},
          weightLog:    [],
          savedPlans:   [],
          viewedRecipeIds: [],
          mealEditSession: null,
        });
      },

      // ── Streak ────────────────────────────────────────────────────────────
      recalcStreak: () => {
        set(state => {
          const today    = new Date();
          const todayIso = toIsoDate(today);
          // If today already has a completion, count from today; otherwise start
          // from yesterday so the streak persists until the first meal is done today.
          const todayHasCompletion = state.logs[todayIso]?.meals.some(
            m => m.status === 'completed'
          ) ?? false;
          const startOffset = todayHasCompletion ? 0 : 1;
          let streak = 0;
          for (let i = startOffset; i < 365; i++) {
            const d   = new Date(today);
            d.setDate(today.getDate() - i);
            const log = state.logs[toIsoDate(d)];
            if (!log?.meals.some(m => m.status === 'completed')) break;
            streak++;
          }
          return { streak };
        });
      },

      // ─────────────────────────────────────────────────────────────────────
      // Grocery actions
      // ─────────────────────────────────────────────────────────────────────

      refreshGroceryWeek: (weekStart) => {
        const state = get();
        const sameWeek = state.grocery.weekStart === weekStart;

        // Capture leftover unbought Cart items from last week (only when the
        // Monday actually rolled over — not on first load when weekStart === '').
        let cartOldWeekItems: string[] = state.grocery.cartOldWeekItems;
        if (!sameWeek && state.grocery.weekStart) {
          cartOldWeekItems = Object.values(state.grocery.items)
            .filter(i => i.section === 'cart' && !i.struckThrough && !i.isCustom)
            .map(i => i.key);
        }

        // Derive this week's ingredients from templates applicable on each day.
        const days = Array.from({ length: 7 }, (_, i) => shiftIsoLocal(weekStart, i));
        const weekIngredients = new Map<string, { name: string; mealNames: Set<string> }>();
        days.forEach(iso => {
          state.templates.forEach(t => {
            if (!isTemplateApplicableOnDate(t, iso)) return;
            t.ingredients.forEach(ing => {
              const key = normalizeIngredientName(ing.name);
              if (!key) return;
              if (!weekIngredients.has(key)) {
                weekIngredients.set(key, { name: ing.name, mealNames: new Set() });
              }
              weekIngredients.get(key)!.mealNames.add(t.name);
            });
          });
        });

        // Plus meals already on the days (today onward) that are planned but not
        // eaten — the user's own (recipes added for later, Day Detail slots)
        // and materialised plan meals. Rebuilding from templates alone wiped
        // the user's own planned ingredients every time Cart opened.
        const todayIso = toIsoDate(new Date());
        days.forEach(iso => {
          if (iso < todayIso) return;
          (state.logs[iso]?.meals ?? []).forEach(m => {
            if (m.status !== 'pending') return;
            (m.ingredients ?? []).forEach(ing => {
              const key = normalizeIngredientName(ing.name);
              if (!key) return;
              if (!weekIngredients.has(key)) {
                weekIngredients.set(key, { name: ing.name, mealNames: new Set() });
              }
              weekIngredients.get(key)!.mealNames.add(m.name);
            });
          });
        });

        // Start from existing items but clear out any 'planned' items
        // (per spec: only Planned section is cleared and repopulated on refresh).
        const nextItems: Record<string, GroceryItem> = {};
        Object.values(state.grocery.items).forEach(item => {
          if (item.section === 'planned') return; // dropped
          nextItems[item.key] = item;
        });

        const now = new Date().toISOString();
        weekIngredients.forEach(({ name, mealNames }, key) => {
          const existing = nextItems[key];
          // If already in kitchen or cart, skip — silent merge per spec.
          if (existing && (existing.section === 'kitchen' || existing.section === 'cart')) {
            return;
          }
          // Otherwise (none, or wasn't present at all) → add to planned.
          nextItems[key] = {
            key,
            name,
            category: classifyIngredient(name),
            section: 'planned',
            mealNames: Array.from(mealNames),
            updatedAt: now,
          };
        });

        set({
          grocery: {
            ...state.grocery,
            weekStart,
            items: nextItems,
            cartOldWeekItems,
          },
        });
      },

      sortIngredient: (key, to) => {
        set(state => {
          const item = state.grocery.items[key];
          if (!item) return state;
          // If moving to kitchen and an item with same key already in kitchen,
          // it's the same record — silently no-op (already sorted there).
          if (to === 'kitchen' && item.section === 'kitchen') return state;
          if (to === 'cart' && item.section === 'cart') return state;
          return {
            grocery: {
              ...state.grocery,
              items: {
                ...state.grocery.items,
                [key]: {
                  ...item,
                  section: to,
                  struckThrough: false,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          };
        });
      },

      skipIngredient: (key) => {
        set(state => {
          const item = state.grocery.items[key];
          if (!item) return state;
          return {
            grocery: {
              ...state.grocery,
              items: {
                ...state.grocery.items,
                [key]: { ...item, section: 'none', updatedAt: new Date().toISOString() },
              },
            },
          };
        });
      },

      moveKitchenToCart: (key) => {
        set(state => {
          const item = state.grocery.items[key];
          if (!item || item.section !== 'kitchen') return state;
          return {
            grocery: {
              ...state.grocery,
              items: {
                ...state.grocery.items,
                [key]: {
                  ...item,
                  section: 'cart',
                  struckThrough: false,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          };
        });
      },

      toggleCartStrikethrough: (key) => {
        set(state => {
          const item = state.grocery.items[key];
          if (!item || item.section !== 'cart') return state;
          return {
            grocery: {
              ...state.grocery,
              items: {
                ...state.grocery.items,
                [key]: {
                  ...item,
                  struckThrough: !item.struckThrough,
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          };
        });
      },

      addManualCartItem: (rawName) => {
        const name = rawName.trim();
        if (!name) return;
        const key = normalizeIngredientName(name);
        set(state => {
          const existing = state.grocery.items[key];
          // If a non-custom item already exists in cart with same key, no-op.
          if (existing && existing.section === 'cart') return state;
          const next: GroceryItem = {
            key,
            name,
            category: classifyIngredient(name),
            section: 'cart',
            isCustom: true,
            struckThrough: false,
            updatedAt: new Date().toISOString(),
          };
          return {
            grocery: {
              ...state.grocery,
              items: { ...state.grocery.items, [key]: next },
            },
          };
        });
      },

      addManualKitchenItem: (rawName) => {
        const name = rawName.trim();
        if (!name) return;
        const key = normalizeIngredientName(name);
        set(state => {
          const existing = state.grocery.items[key];
          if (existing && existing.section === 'kitchen') return state;
          const next: GroceryItem = {
            key,
            name,
            category: classifyIngredient(name),
            section: 'kitchen',
            updatedAt: new Date().toISOString(),
          };
          return {
            grocery: {
              ...state.grocery,
              items: { ...state.grocery.items, [key]: next },
            },
          };
        });
      },

      // Bulk-add AI-scanned kitchen items. Unlike addManualKitchenItem, the
      // category comes straight from the AI (already validated client-side)
      // rather than classifyIngredient. Dedupes against items already in the
      // kitchen and within the batch itself; returns how many were actually
      // added so the caller can show an accurate confirmation.
      addScannedKitchenItems: (items) => {
        let added = 0;
        set(state => {
          const now = new Date().toISOString();
          const nextItems = { ...state.grocery.items };
          for (const item of items) {
            const name = item.name.trim();
            if (!name) continue;
            const key = normalizeIngredientName(name);
            if (!key) continue;
            const existing = nextItems[key];
            if (existing && existing.section === 'kitchen') continue;
            nextItems[key] = {
              key,
              name,
              category: item.category,
              section: 'kitchen',
              updatedAt: now,
            };
            added += 1;
          }
          if (added === 0) return state;
          return { grocery: { ...state.grocery, items: nextItems } };
        });
        return added;
      },

      removeGroceryItem: (key) => {
        set(state => {
          if (!state.grocery.items[key]) return state;
          const nextItems = { ...state.grocery.items };
          delete nextItems[key];
          return { grocery: { ...state.grocery, items: nextItems } };
        });
      },

      doneShopping: () => {
        set(state => {
          const nextItems: Record<string, GroceryItem> = {};
          const now = new Date().toISOString();
          Object.values(state.grocery.items).forEach(item => {
            if (item.section === 'cart' && item.struckThrough) {
              if (item.isCustom) {
                // Custom struck-through items are cleared (no Kitchen persistence).
                return;
              }
              // Plan-derived struck-through items move to Kitchen.
              nextItems[item.key] = {
                ...item,
                section: 'kitchen',
                struckThrough: false,
                isCustom: false,
                updatedAt: now,
              };
              return;
            }
            nextItems[item.key] = item;
          });
          return { grocery: { ...state.grocery, items: nextItems } };
        });
      },

      resolveOldCartItems: (decisions) => {
        set(state => {
          const nextItems = { ...state.grocery.items };
          Object.entries(decisions).forEach(([key, decision]) => {
            const item = nextItems[key];
            if (!item) return;
            if (decision === 'remove') {
              delete nextItems[key];
            }
            // 'keep' = no change; item already in cart.
          });
          return {
            grocery: {
              ...state.grocery,
              items: nextItems,
              cartOldWeekItems: [],
            },
          };
        });
      },

      dismissGroceryTip: () => {
        set(state => ({ grocery: { ...state.grocery, hasSeenTip: true } }));
      },

      ingestMidWeekIngredients: (ingredients) => {
        set(state => {
          const nextItems = { ...state.grocery.items };
          const now = new Date().toISOString();
          ingredients.forEach(({ name, mealName }) => {
            const key = normalizeIngredientName(name);
            if (!key) return;
            const existing = nextItems[key];
            // If already in kitchen or cart, silent no-op.
            if (existing && (existing.section === 'kitchen' || existing.section === 'cart')) {
              return;
            }
            // Add (or re-add if previously skipped/none) to Planned.
            const prevMealNames = existing?.mealNames ?? [];
            const mergedMeals = Array.from(new Set([...prevMealNames, mealName]));
            nextItems[key] = {
              key,
              name: existing?.name ?? name,
              category: existing?.category ?? classifyIngredient(name),
              section: 'planned',
              mealNames: mergedMeals,
              updatedAt: now,
            };
          });
          return { grocery: { ...state.grocery, items: nextItems } };
        });
      },

      cleanupRemovedMealIngredients: (mealIngredientNames, remainingMealNames) => {
        set(state => {
          const nextItems = { ...state.grocery.items };
          const now = new Date().toISOString();
          const remaining = new Set(remainingMealNames);

          // Build set of ingredient names still required by remaining meals,
          // looking across both templates AND any one-off meals in logs.
          const stillNeededKeys = new Set<string>();
          state.templates.forEach(t => {
            if (!remaining.has(t.name)) return;
            t.ingredients.forEach(ing => {
              stillNeededKeys.add(normalizeIngredientName(ing.name));
            });
          });
          Object.values(state.logs).forEach(log => {
            log.meals.forEach(m => {
              if (!remaining.has(m.name)) return;
              m.ingredients.forEach(ing => {
                stillNeededKeys.add(normalizeIngredientName(ing.name));
              });
            });
          });

          mealIngredientNames.forEach(rawName => {
            const key = normalizeIngredientName(rawName);
            if (!key) return;
            if (stillNeededKeys.has(key)) return; // another meal still needs it
            const item = nextItems[key];
            if (!item) return;
            if (item.section === 'planned') {
              // Auto-remove from Planned (no popup per spec).
              nextItems[key] = { ...item, section: 'none', updatedAt: now };
            }
            // Cart/Kitchen left alone — caller handles Cart popup, Kitchen is independent.
          });

          return { grocery: { ...state.grocery, items: nextItems } };
        });
      },

      // ─── Recipe actions ─────────────────────────────────────────────────
      ensureRecipeSaved: (recipe) => {
        const state = get();
        const existing = findExistingSavedRecipe(state.savedRecipes, recipe);
        if (existing) return existing;

        const next: SavedRecipe = {
          id: newId(),
          recipeId: recipe.recipeId,
          name: recipe.name,
          category: recipe.category,
          calories: recipe.calories,
          cookTimeMin: recipe.cookTimeMin,
          macros: recipe.macros,
          ingredients: cloneIngredients(recipe.ingredients),
          steps: recipe.steps ? [...recipe.steps] : undefined,
          difficulty: recipe.difficulty,
          source: recipe.source ?? 'manual',
          favourited: recipe.favourited ?? false,
          addedAt: new Date().toISOString(),
        };
        set({ savedRecipes: [next, ...state.savedRecipes] });
        return next;
      },

      toggleFavouriteRecipe: (recipe) => {
        const state = get();
        const existing = findExistingSavedRecipe(state.savedRecipes, recipe);
        if (existing) {
          // Flip the heart on the existing entry.
          const updated: SavedRecipe = { ...existing, favourited: !existing.favourited };
          set({
            savedRecipes: state.savedRecipes.map(r =>
              r.id === existing.id ? updated : r
            ),
          });
          return updated;
        }
        // No existing — create one as favourited.
        const next: SavedRecipe = {
          id: newId(),
          recipeId: recipe.recipeId,
          name: recipe.name,
          category: recipe.category,
          calories: recipe.calories,
          cookTimeMin: recipe.cookTimeMin,
          macros: recipe.macros,
          ingredients: cloneIngredients(recipe.ingredients),
          steps: recipe.steps ? [...recipe.steps] : undefined,
          difficulty: recipe.difficulty,
          source: recipe.source ?? 'manual',
          favourited: true,
          addedAt: new Date().toISOString(),
        };
        set({ savedRecipes: [next, ...state.savedRecipes] });
        return next;
      },

      removeSavedRecipe: (id) => {
        set(state => {
          const { [id]: _dropped, ...recipeFixHistory } = state.recipeFixHistory;
          return { savedRecipes: state.savedRecipes.filter(r => r.id !== id), recipeFixHistory };
        });
      },

      markRecipeViewed: (id) => {
        set(state =>
          state.viewedRecipeIds.includes(id)
            ? state
            : { viewedRecipeIds: [...state.viewedRecipeIds, id] }
        );
      },

      addRecipeToToday: (recipe, opts) => {
        const now = new Date();
        const todayIso = toIsoDate(now);
        // After 23:30 the next half hour is 00:00 (tomorrow) — keep it today.
        const rounded = roundToNextHalfHour(now);
        const time = rounded < `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` ? '23:59' : rounded;
        const entry: MealEntry = {
          id: newId(),
          name: recipe.name,
          time,
          calories: recipe.calories,
          ingredients: cloneIngredients(recipe.ingredients),
          macros: recipe.macros,
          // "Add to Today" from a recipe means "to cook": always planned,
          // waiting to be ticked once eaten.
          status: 'pending',
          // The user's own addition: survives plan activation, shows "Added".
          isAdHoc: true,
        };
        get().addMealToDay(todayIso, entry);

        // Ingest ingredients into the grocery system (no-op for items already in
        // Kitchen) — Add to Today is always a planned meal.
        if (recipe.ingredients.length > 0) {
          get().ingestMidWeekIngredients(
            recipe.ingredients.map(i => ({ name: i.name, mealName: recipe.name }))
          );
        }

        // Auto-save the recipe to savedRecipes unless explicitly suppressed.
        // Premade plus-tap passes { save: false } so it logs to today without
        // adding the template to the user's Recently Added collection.
        if (opts?.save !== false) {
          get().ensureRecipeSaved({
            recipeId: recipe.recipeId,
            name: recipe.name,
            category: recipe.category,
            calories: recipe.calories,
            cookTimeMin: recipe.cookTimeMin,
            macros: recipe.macros,
            ingredients: recipe.ingredients,
            steps: recipe.steps,
            source: recipe.source ?? 'manual',
          });
        }

        return entry;
      },

      addRecipeToPlan: (recipe, dateIso, time) => {
        const template: MealTemplate = {
          id: `tpl-rcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: recipe.name,
          time,
          calories: recipe.calories,
          ingredients: cloneIngredients(recipe.ingredients),
          macros: recipe.macros,
          recurrence: { type: 'once', date: dateIso },
        };
        get().addTemplate(template);

        if (recipe.ingredients.length > 0) {
          get().ingestMidWeekIngredients(
            recipe.ingredients.map(i => ({ name: i.name, mealName: recipe.name }))
          );
        }

        get().ensureRecipeSaved({
          recipeId: recipe.recipeId,
          name: recipe.name,
          category: recipe.category,
          calories: recipe.calories,
          cookTimeMin: recipe.cookTimeMin,
          macros: recipe.macros,
          ingredients: recipe.ingredients,
          steps: recipe.steps,
          source: recipe.source ?? 'manual',
        });

        return template;
      },

      // ─── Meal plan actions ─────────────────────────────────────────────
      activatePlan: (plan) => {
        const state = get();
        const nextTemplates = buildTemplatesFromPlan(state, plan);

        // Materialize today's log immediately from the new templates so the
        // Home tab and Day Detail reflect the plan the instant it's activated.
        const today = toIsoDate(new Date());
        const planMealsFor = (date: string, keep: MealEntry[]): MealEntry[] => {
          const kept = new Set(keep.map(m => `${m.time}|${m.name}`));
          return nextTemplates
            .filter(t => isTemplateApplicableOnDate(t, date))
            .filter(t => !kept.has(`${t.time}|${t.name}`))
            .map(t => ({
              id:          newId(),
              name:        t.name,
              time:        t.time,
              calories:    t.calories,
              ingredients: t.ingredients,
              macros:      t.macros,
              status:      'pending' as const,
              templateId:  t.id,
              ...(t.servings ? { servings: t.servings } : {}),
            }));
        };

        // Past days are history and stay as they are. Today keeps the user's
        // own meals and anything already ticked (activation used to wipe them
        // and sync the deletes, losing meals the user had eaten); today's
        // untouched old-plan meals are replaced. Future days belong to the new
        // plan entirely (Alex, Oct 28: keeping hand-added future meals would
        // double up slots) — they're dropped and re-resolve from the new plan
        // when viewed. The UI warns first (lib/planActivation.ts).
        const ownTemplateIds = new Set(state.templates.filter(t => !isPlanTemplate(t)).map(t => t.id));
        const refreshedLogs: Record<string, DailyLog> = {};
        Object.entries(state.logs).forEach(([d, log]) => {
          if (d < today) {
            refreshedLogs[d] = log;
            return;
          }
          if (d > today) return;
          const keep = log.meals.filter(m => isUserOwnedMeal(m, ownTemplateIds));
          refreshedLogs[d] = {
            ...log,
            meals: [...keep, ...planMealsFor(d, keep)].sort((a, b) => a.time.localeCompare(b.time)),
          };
        });
        if (!refreshedLogs[today]) {
          refreshedLogs[today] = { date: today, meals: planMealsFor(today, []), waterMl: 0 };
        }

        // A plan with its own numbers (premade, or a customized copy of one)
        // sets the goals to what its meals really add up to — you pick a plan
        // for its calories and macros (Alex, Nov 10). Built plans keep the
        // user's goals. The user's own goals are saved first (only once —
        // switching plan to plan keeps the original) and restored by endPlan,
        // or by starting a plan without its own numbers.
        const ownGoals = state.goalsBeforePlan ?? state.goals;
        const setsGoals = planSetsGoals(plan);
        const nextGoals = setsGoals ? goalsForPlan(state, plan, ownGoals) : ownGoals;

        set({
          templates: nextTemplates,
          logs: refreshedLogs,
          goals: nextGoals,
          goalsBeforePlan: setsGoals ? ownGoals : null,
          // Building/activating a plan satisfies the onboarding "first plan"
          // step, so clear the persistent Home nudge.
          profile: { ...state.profile, activePlanName: plan.name, pendingFirstPlan: false },
        });

        // Rebuild Planned Ingredients from the new plan's templates for the
        // current week — this clears the previous plan's planned items and
        // repopulates from the meals that are actually scheduled.
        get().refreshGroceryWeek(mondayOfWeek(today));
      },

      endPlan: () => {
        const state = get();
        const today = toIsoDate(new Date());

        // The user's own templates and meals stay; the plan's go — including
        // slots filled from Day Detail.
        const { templates, logs } = withoutPlanFromToday(state.templates, state.logs, today);

        set({
          templates,
          logs,
          // Clearing the pointer makes the projector re-push every saved plan
          // with is_active=false, so login's hydrateActivePlanIfNeeded can't
          // bring the plan back.
          profile: { ...state.profile, activePlanName: undefined },
          goals: state.goalsBeforePlan ?? state.goals,
          goalsBeforePlan: null,
          customizeDraft: null,
        });
        get().refreshGroceryWeek(mondayOfWeek(today));
      },

      // Non-destructive re-activation used on restore (after a login pull). Only
      // runs when there's an active plan pointer but NO local templates (fresh
      // device / wiped cache), so it never clobbers a live in-app activation.
      // Unlike activatePlan it PRESERVES all existing logs — past, today, and
      // future — and only fills today's missing slots + sets templates so future
      // days repopulate. This must run AFTER meal_logs are pulled so already
      // logged/synced meals win and aren't duplicated.
      hydrateActivePlanIfNeeded: () => {
        const state = get();
        const activeName = state.profile.activePlanName;
        if (!activeName) return;
        // A plan is already live; leave it. (Only plan templates count: the
        // user's own scheduled recipes must not block rebuilding a plan that
        // another phone switched to.)
        if (state.templates.some(isPlanTemplate)) return;

        const plan =
          state.savedPlans.find(p => p.name === activeName) ??
          state.plans.find(p => p.name === activeName);
        if (!plan) return;

        const nextTemplates = buildTemplatesFromPlan(state, plan);

        const today = toIsoDate(new Date());
        const existingToday = state.logs[today]?.meals ?? [];
        // Key existing meals by slot-time+name so we don't re-add a meal the pull
        // already restored (synced/logged meals win).
        const existingKeys = new Set(existingToday.map(m => `${m.time}|${m.name}`));
        const materialized: MealEntry[] = nextTemplates
          .filter(t => isTemplateApplicableOnDate(t, today))
          .filter(t => !existingKeys.has(`${t.time}|${t.name}`))
          .map(t => ({
            id:          newId(),
            name:        t.name,
            time:        t.time,
            calories:    t.calories,
            ingredients: t.ingredients,
            macros:      t.macros,
            status:      'pending' as const,
            templateId:  t.id,
            ...(t.servings ? { servings: t.servings } : {}),
          }));

        const mergedTodayMeals = [...existingToday, ...materialized].sort((a, b) =>
          (a.time ?? '').localeCompare(b.time ?? ''),
        );

        const nextGoals = planSetsGoals(plan) ? goalsForPlan(state, plan, state.goals) : state.goals;

        set({
          // The user's own templates stay (they sync now; dropping them here
          // would delete them on the server too).
          templates: [...state.templates.filter(t => !isPlanTemplate(t)), ...nextTemplates],
          goals: nextGoals,
          logs: {
            ...state.logs,
            [today]: {
              date: today,
              meals: mergedTodayMeals,
              waterMl: state.logs[today]?.waterMl ?? 0,
            },
          },
          profile: { ...state.profile, pendingFirstPlan: false },
        });

        get().refreshGroceryWeek(mondayOfWeek(today));
      },

      saveCurrentPlanAs: (name) => {
        const state = get();

        // Fixed meal slots (Breakfast, Lunch, …) so each template lands in the
        // right slot section rather than inventing a slot named after the meal.
        const activeSlots = (state.profile.mealSlots ?? [])
          .filter(s => !s.skipped)
          .slice()
          .sort((a, b) => a.time.localeCompare(b.time));
        const slotNameForTime = (time: string): string => {
          if (activeSlots.length === 0) return 'Meal';
          const exact = activeSlots.find(s => s.time === time);
          if (exact) return exact.name;
          const tMin = toMinutesFromHHMM(time) ?? 0;
          let best = activeSlots[0];
          let bestDiff = Infinity;
          for (const s of activeSlots) {
            const sMin = toMinutesFromHHMM(s.time) ?? 0;
            const diff = Math.abs(sMin - tMin);
            if (diff < bestDiff) { bestDiff = diff; best = s; }
          }
          return best.name;
        };
        // Prefer a real recipe id (so the plan view can show calories/meta);
        // otherwise fall back to the template id so every meal stays distinct
        // (using a constant would collapse the "Meals in this plan" list).
        const recipeIdForTemplate = (t: MealTemplate): string => {
          const match = state.recipes.find(
            r => r.name.trim().toLowerCase() === t.name.trim().toLowerCase(),
          );
          return match?.id ?? t.id;
        };

        const runningPlan = state.profile.activePlanName
          ? state.savedPlans.find(p => p.name === state.profile.activePlanName) ??
            state.plans.find(p => p.name === state.profile.activePlanName)
          : undefined;

        // Reverse-map templates -> 7-day plan structure using each template's
        // weekly recurrence days (falling back to "every day" for `daily`).
        const days: PlanDayMeal[][] = Array.from({ length: 7 }, () => [] as PlanDayMeal[]);
        state.templates.forEach(t => {
          const targetDays: number[] = (() => {
            switch (t.recurrence.type) {
              case 'weekly':  return t.recurrence.days;
              case 'daily':   return [0, 1, 2, 3, 4, 5, 6];
              case 'monthly': return []; // not representable in a weekly plan snapshot
              case 'once':    return []; // one-off entries are not part of the snapshot
              default:        return [];
            }
          })();
          const slotName = slotNameForTime(t.time);
          const recipeId = recipeIdForTemplate(t);
          targetDays.forEach(d => {
            // recurrence.days is JS weekday (Sun=0); plan.days is Monday=0.
            const planIdx = (d + 6) % 7;
            days[planIdx].push({
              slotName,
              time: t.time,
              recipeId,
              recipeName: t.name,
              // Template numbers are already scaled; recipeId points at the
              // 1-serving recipe, so keep the portion.
              ...(t.servings ? { servings: t.servings } : {}),
            });
          });
        });
        days.forEach(d => d.sort((a, b) => a.time.localeCompare(b.time)));

        const plan: MealPlan = {
          // UUID so the local id doubles as the server plans.id primary key.
          id: newId(),
          // "Save current plan" passes the active plan's own name.
          name: uniquePlanName(name, [...state.savedPlans, ...state.plans]),
          // A snapshot of a style plan (premade / its copy) keeps the style,
          // so restarting it sets the goals the same way.
          description: runningPlan?.description,
          disclaimer: runningPlan?.disclaimer,
          category: runningPlan?.category,
          days,
          savedAt: new Date().toISOString(),
          source: 'user',
        };
        set({ savedPlans: [plan, ...state.savedPlans] });
        return plan;
      },

      renameSavedPlan: (id, name) => {
        set(state => {
          const plan = state.savedPlans.find(p => p.id === id);
          if (!plan || plan.name === name) return {};
          const others = [...state.savedPlans.filter(p => p.id !== id), ...state.plans];
          const unique = uniquePlanName(name, others);
          // The pointer is the name: renaming the running plan must carry it,
          // or the plan stops being "current" (and syncs as inactive).
          const wasActive = state.profile.activePlanName === plan.name;
          return {
            savedPlans: state.savedPlans.map(p => (p.id === id ? { ...p, name: unique } : p)),
            ...(wasActive ? { profile: { ...state.profile, activePlanName: unique } } : {}),
          };
        });
      },

      removeSavedPlan: (id) => {
        set(state => ({
          savedPlans: state.savedPlans.filter(p => p.id !== id),
        }));
      },

      saveCustomizedPlan: (sourceId, draft) => {
        const state = get();
        const own = state.savedPlans.find(p => p.id === sourceId);
        const current = own ?? state.plans.find(p => p.id === sourceId);
        // Nothing changed: no copy, no re-activation.
        if (current && JSON.stringify(current.days) === JSON.stringify(draft.days)) return current;
        let applied: MealPlan;
        if (own) {
          applied = { ...draft, id: own.id, name: own.name, source: own.source };
          set({ savedPlans: state.savedPlans.map(p => (p.id === own.id ? applied : p)) });
        } else {
          // Premade: read-only seed content. Save the edits as the user's own
          // plan (UUID id so it syncs; unique name since the active plan is
          // matched by name).
          const name = uniquePlanName(`My ${draft.name}`, [...state.savedPlans, ...state.plans]);
          applied = { ...draft, id: newId(), name, source: 'user', savedAt: new Date().toISOString() };
          set({ savedPlans: [applied, ...state.savedPlans] });
        }
        // Same rules as starting a plan: today keeps eaten/own meals, future
        // days follow the edited plan, past days untouched. A plan with its own
        // numbers now sets the goals to the EDITED plan's real totals (swapping
        // meals changes them — the rings must match the meals); the user's own
        // goals stay saved in goalsBeforePlan. Other plans keep goals as they are.
        const { goals, goalsBeforePlan } = state;
        get().activatePlan(applied);
        if (!planSetsGoals(applied)) set({ goals, goalsBeforePlan });
        return applied;
      },

      // ─── Plan avoid foods ────────────────────────────────────────────────
      setPlanAvoidFoods: (foods) => set({ planAvoidFoods: foods }),
      setFindPlanAnswers: (answers) => set({ findPlanAnswers: answers }),

      // ─── Swap coordination ──────────────────────────────────────────────
      setPendingSwap: (swap) => set({ pendingSwap: swap }),
      clearPendingSwap: () => set({ pendingSwap: null }),
      setCustomizeDraft: (draft) => set({ customizeDraft: draft }),
      clearCustomizeDraft: () => set({ customizeDraft: null }),
      setPendingRecipeConcept: (concept) => set({ pendingRecipeConcept: concept }),
      clearPendingRecipeConcept: () => set({ pendingRecipeConcept: null }),

      applyRecipeFix: (savedId, fixText, fixed) => {
        const state = get();
        const own = state.savedRecipes.find(r => r.id === savedId && isOwnRecipe(r));
        if (!own) return null;
        // The name stays: plans and saved-recipe lookups refer to recipes by
        // name, so a Fix never renames.
        const updated: SavedRecipe = {
          ...own,
          calories: fixed.calories,
          macros: fixed.macros,
          cookTimeMin: fixed.cookTimeMin ?? own.cookTimeMin,
          ingredients: cloneIngredients(fixed.ingredients),
          steps: [...fixed.steps],
        };
        const previousHistory = state.recipeFixHistory[own.id] ?? [];
        set({
          savedRecipes: state.savedRecipes.map(r => (r.id === own.id ? updated : r)),
          recipeFixHistory: { ...state.recipeFixHistory, [own.id]: [...previousHistory, fixText] },
        });
        return { applied: updated, previous: own, previousHistory };
      },

      revertRecipeFix: (savedId, previous, previousHistory) => {
        set(state => ({
          savedRecipes: state.savedRecipes.map(r =>
            r.id === savedId
              ? {
                  ...r,
                  calories: previous.calories,
                  macros: previous.macros,
                  cookTimeMin: previous.cookTimeMin,
                  ingredients: previous.ingredients,
                  steps: previous.steps,
                }
              : r,
          ),
          recipeFixHistory: { ...state.recipeFixHistory, [savedId]: previousHistory },
        }));
      },

      addCustomRecipe: (recipe) => {
        const state = get();
        const taken = new Set([...state.savedRecipes, ...state.recipes].map(r => r.name.trim().toLowerCase()));
        let name = recipe.name;
        for (let n = 2; taken.has(name.trim().toLowerCase()); n++) name = `${recipe.name} ${n}`;
        const saved: SavedRecipe = {
          id: newId(),
          name,
          category: recipe.category,
          calories: recipe.calories,
          cookTimeMin: recipe.cookTimeMin,
          macros: recipe.macros,
          ingredients: cloneIngredients(recipe.ingredients),
          steps: recipe.steps && recipe.steps.length > 0 ? [...recipe.steps] : undefined,
          difficulty: recipe.difficulty,
          source: 'ai',
          favourited: false,
          addedAt: new Date().toISOString(),
        };
        set({ savedRecipes: [saved, ...state.savedRecipes] });
        return saved;
      },

      setRecipeSteps: (savedId, steps) => {
        set(state => ({
          savedRecipes: state.savedRecipes.map(r => (r.id === savedId ? { ...r, steps: [...steps] } : r)),
        }));
      },

      restoreDayLog: (date, log) => {
        set(state => {
          const logs = { ...state.logs };
          if (log) logs[date] = log;
          else delete logs[date];
          return { logs };
        });
        // The swap added the new meal's ingredients; rebuilding drops them
        // unless something else still needs them.
        get().refreshGroceryWeek(mondayOfWeek(toIsoDate(new Date())));
      },

      swapMealInDay: (date, slot, recipe) => {
        set(state => {
          const log = state.logs[date] ?? { date, meals: [], waterMl: 0 };
          // Identify the existing entry for this slot: match slotId first,
          // then fall back to time (legacy entries that predate slotId).
          // The time fallback (legacy slots without slotId) must never match a
          // meal the user added themselves.
          const matchIdx = log.meals.findIndex(m =>
            slot.slotId ? m.slotId === slot.slotId : !m.isAdHoc && m.time === slot.time,
          );
          // The swapped-in recipe takes the replaced meal's portion, so a
          // plan day stays near its numbers (1.5× dinner → 1.5× the new one).
          const portion = matchIdx >= 0 ? (log.meals[matchIdx].servings ?? 1) : 1;
          const nextEntry: MealEntry = {
            id: matchIdx >= 0
              ? log.meals[matchIdx].id
              : newId(),
            name: recipe.name,
            time: slot.time,
            calories: Math.round(recipe.calories * portion),
            ingredients: cloneIngredients(scaleIngredients(recipe.ingredients, portion)),
            macros: scaleMacros(recipe.macros, portion),
            status: matchIdx >= 0 ? log.meals[matchIdx].status : 'pending',
            slotId: slot.slotId,
            category: recipe.category,
            ...(portion !== 1 ? { servings: portion } : {}),
          };
          const meals = matchIdx >= 0
            ? log.meals.map((m, i) => (i === matchIdx ? nextEntry : m))
            : [...log.meals, nextEntry];
          meals.sort((a, b) => a.time.localeCompare(b.time));
          return { logs: { ...state.logs, [date]: { ...log, meals } } };
        });

        // Feed ingredients into the grocery system.
        if (recipe.ingredients.length > 0) {
          get().ingestMidWeekIngredients(
            recipe.ingredients.map(i => ({ name: i.name, mealName: recipe.name })),
          );
        }
        // Auto-save the recipe so it stays available in Saved Recipes.
        get().ensureRecipeSaved({
          recipeId: recipe.recipeId,
          name: recipe.name,
          category: recipe.category,
          calories: recipe.calories,
          cookTimeMin: recipe.cookTimeMin,
          macros: recipe.macros,
          ingredients: recipe.ingredients,
          steps: recipe.steps,
          source: recipe.source ?? 'manual',
        });
      },

      // ── Meal edit session (popup + macro/ingredient edit routes) ───────────
      openMealEditSession: (date, context, entry) => {
        // Deep-ish clone so draft edits don't mutate the stored entry until commit.
        const draft: MealEntry = {
          ...entry,
          servings: entry.servings ?? 1,
          macros: { ...entry.macros },
          nutrients: { ...(entry.nutrients ?? {}) },
          ingredients: entry.ingredients.map(i => ({
            ...i,
            macros: i.macros ? { ...i.macros } : undefined,
            nutrients: i.nutrients ? { ...i.nutrients } : undefined,
          })),
        };
        set({ mealEditSession: { date, context, draft } });
      },

      updateMealDraft: (patch) => {
        set(state => {
          if (!state.mealEditSession) return state;
          return {
            mealEditSession: {
              ...state.mealEditSession,
              draft: { ...state.mealEditSession.draft, ...patch },
            },
          };
        });
      },

      updateDraftIngredient: (ingredientId, patch) => {
        set(state => {
          if (!state.mealEditSession) return state;
          const draft = state.mealEditSession.draft;
          return {
            mealEditSession: {
              ...state.mealEditSession,
              draft: {
                ...draft,
                ingredients: draft.ingredients.map(i =>
                  i.id === ingredientId ? { ...i, ...patch } : i,
                ),
              },
            },
          };
        });
      },

      removeDraftIngredient: (ingredientId) => {
        set(state => {
          if (!state.mealEditSession) return state;
          const draft = state.mealEditSession.draft;
          return {
            mealEditSession: {
              ...state.mealEditSession,
              draft: {
                ...draft,
                ingredients: draft.ingredients.filter(i => i.id !== ingredientId),
              },
            },
          };
        });
      },

      commitMealEditSession: () => {
        const session = get().mealEditSession;
        if (!session) return;
        get().editMealOnDay(session.date, session.draft);
        set({ mealEditSession: null });
      },

      closeMealEditSession: () => set({ mealEditSession: null }),

      // ── AI permission (Apple 5.1.2) ────────────────────────────────────────
      setAiConsent: (allowed) =>
        set(state => ({
          profile: { ...state.profile, aiConsent: allowed, aiConsentAt: new Date().toISOString() },
        })),

      // ── Meal photo sync ────────────────────────────────────────────────────
      setMealPhotoSynced: (mealId, from, path) => {
        const { logs } = get();
        for (const [date, log] of Object.entries(logs)) {
          const idx = log.meals.findIndex(m => m.id === mealId);
          if (idx < 0) continue;
          const m = log.meals[idx];
          if (m.photoUri !== from) return false; // photo changed meanwhile: next sync handles it
          const meals = log.meals.slice();
          meals[idx] = { ...m, photoUploadedFrom: from, photoPath: path };
          set({ logs: { ...logs, [date]: { ...log, meals } } });
          return true;
        }
        return false;
      },

      // ── Cloud sync merge ───────────────────────────────────────────────────
      applyServerSnapshot: (snapshot, dirtyKeys) => {
        let planChanged = false;
        set(current => {
          const state = withoutDeleted(current, snapshot.deletions, dirtyKeys);
          const usersDirty = dirtyKeys.has(entityKey.usersSelf());
          const today = toIsoDate(new Date());

          // Active plan — follow the server when another phone ended or
          // switched it, but never over a local change still queued (any
          // dirty plan key or the users row = the user just changed plans
          // here). serverName: a name, null = no plan, undefined = no news.
          const anyPlanDirty = Array.from(dirtyKeys).some(k => k.startsWith('plans:'));
          const serverName =
            snapshot.activePlanName ?? (snapshot.activePlanEnded ? null : undefined);
          const localName = state.profile.activePlanName || null;
          const pointerNews =
            !anyPlanDirty && !usersDirty && serverName !== undefined && serverName !== localName;
          const findPlan = (name: string | null) =>
            name == null
              ? undefined
              : (snapshot.plans ?? []).find(p => p.name === name) ??
                state.savedPlans.find(p => p.name === name) ??
                state.plans.find(p => p.name === name);
          const serverPlan = findPlan(serverName ?? null);
          const localPlan = findPlan(localName);
          // Same plan under a new name (renamed on the other phone): only the
          // pointer moves; the running plan and its meals stay as they are.
          const renamedOnly = pointerNews && !!serverPlan && serverPlan.id === localPlan?.id;
          planChanged = pointerNews && !renamedOnly;
          // The old plan's meals go from today on, like endPlan — before the
          // pulled meals merge in, so a switched-to plan's synced meals stay.
          // Each phone clears its own copies (sync_deletions only names rows
          // deleted outright, not a plan's meals that never synced here).
          // A switch also empties future days, as activatePlan does on the
          // other phone (or they'd never get the new plan's meals). Meals with
          // a write still queued are kept (never drop unsynced data).
          const isDirtyMeal = (m: MealEntry) => dirtyKeys.has(entityKey.mealLog(m.id));
          let base = { templates: state.templates, logs: state.logs };
          if (planChanged && localName) {
            base = withoutPlanFromToday(state.templates, state.logs, today, isDirtyMeal);
          }
          if (planChanged && serverName) {
            const logsNow: Record<string, DailyLog> = {};
            Object.entries(base.logs).forEach(([d, log]) => {
              if (d <= today) {
                logsNow[d] = log;
                return;
              }
              const keep = log.meals.filter(isDirtyMeal);
              if (keep.length > 0) logsNow[d] = { ...log, meals: keep };
            });
            base = { ...base, logs: logsNow };
          }
          // Own goals while a plan with its own numbers runs (endPlan restores
          // them). The pulled goals may already be the new plan's, so save
          // this phone's goals from before the merge — unless this is a
          // restore (reset profile: its goals are only defaults).
          const goalsBeforePlan =
            serverName === null || (serverPlan && !planSetsGoals(serverPlan))
              ? null
              : serverPlan && planSetsGoals(serverPlan) && profileHasData(state.profile)
                ? state.goalsBeforePlan ?? state.goals
                : state.goalsBeforePlan;

          const profile =
            snapshot.profile && !usersDirty
              ? { ...state.profile, ...stripUndefined(snapshot.profile) }
              : state.profile;
          const goals =
            snapshot.goals && !usersDirty
              ? { ...state.goals, ...stripUndefined(snapshot.goals) }
              : state.goals;

          // Weight log — union by date; server wins unless the date is dirty.
          let weightLog = state.weightLog;
          if (snapshot.weightLog) {
            const byDate = new Map(state.weightLog.map(e => [e.date, e]));
            snapshot.weightLog.forEach(e => {
              if (!dirtyKeys.has(entityKey.weightLog(e.date))) byDate.set(e.date, e);
            });
            weightLog = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
          }

          // Saved recipes — union by id.
          let savedRecipes = state.savedRecipes;
          if (snapshot.savedRecipes) {
            const byId = new Map(state.savedRecipes.map(r => [r.id, r]));
            snapshot.savedRecipes.forEach(r => {
              if (!dirtyKeys.has(entityKey.savedRecipe(r.id))) byId.set(r.id, r);
            });
            savedRecipes = Array.from(byId.values());
          }

          // Grocery — union by key; a moving item is protected across all tables.
          let grocery = state.grocery;
          if (snapshot.groceryItems) {
            const items = { ...state.grocery.items };
            snapshot.groceryItems.forEach(it => {
              if (!isGroceryKeyDirty(dirtyKeys, it.key)) {
                items[it.key] = { ...items[it.key], ...it };
              }
            });
            grocery = { ...state.grocery, items };
          }

          // Logs — union per date by meal id; keep local-only meals.
          let logs = base.logs;
          if (snapshot.logsByDate) {
            logs = { ...base.logs };
            for (const [date, meals] of Object.entries(snapshot.logsByDate)) {
              const byId = new Map((logs[date]?.meals ?? []).map(m => [m.id, m]));
              meals.forEach(m => {
                if (dirtyKeys.has(entityKey.mealLog(m.id))) return;
                // The server never has this phone's own photo file: keep it
                // while it's still the same photo (cloud copy unchanged).
                const local = byId.get(m.id);
                byId.set(
                  m.id,
                  local?.photoUri && local.photoPath === m.photoPath
                    ? { ...m, photoUri: local.photoUri, photoUploadedFrom: local.photoUploadedFrom }
                    : m,
                );
              });
              logs[date] = {
                date,
                meals: Array.from(byId.values()),
                waterMl: logs[date]?.waterMl ?? 0,
              };
            }
          }

          // Plans — union by id (never premade); server wins unless the plan is dirty.
          let savedPlans = state.savedPlans;
          if (snapshot.plans) {
            const byId = new Map(state.savedPlans.map(pl => [pl.id, pl]));
            snapshot.plans.forEach(pl => {
              if (!dirtyKeys.has(entityKey.plan(pl.id))) byId.set(pl.id, pl);
            });
            savedPlans = Array.from(byId.values());
          }

          // The user's own templates (repeating meals, scheduled recipes) —
          // union by id; server wins unless queued here. Never plan templates.
          let templates = base.templates;
          if (snapshot.templates && snapshot.templates.length > 0) {
            const byId = new Map(base.templates.map(t => [t.id, t]));
            snapshot.templates.forEach(t => {
              if (!isPlanTemplate(t) && !dirtyKeys.has(entityKey.template(t.id))) byId.set(t.id, t);
            });
            templates = Array.from(byId.values());
          }

          // Water per day — server wins unless this phone's change is queued.
          // A day with no log yet is created with its template meals, as
          // opening it would (an empty log would stop them ever filling in).
          if (snapshot.waterByDate) {
            for (const [date, ml] of Object.entries(snapshot.waterByDate)) {
              if (dirtyKeys.has(entityKey.water(date))) continue;
              const log = logs[date];
              if (log) {
                if (log.waterMl === ml) continue;
              } else if (ml === 0) {
                continue; // no day to create for "no water"
              }
              if (logs === base.logs) logs = { ...base.logs };
              logs[date] = { ...(log ?? { date, meals: mealsFromTemplates(templates, date) }), waterMl: ml };
            }
          }

          if (renamedOnly) {
            return {
              profile: { ...profile, activePlanName: serverName ?? undefined },
              goals, weightLog, savedRecipes, grocery, logs, savedPlans, templates,
            };
          }
          if (!planChanged) {
            return { profile, goals, weightLog, savedRecipes, grocery, logs, savedPlans, templates };
          }
          // Goals arrive with the users row (the other phone already restored
          // or set them). A switched-to plan is rebuilt by the engine's
          // hydrateActivePlanIfNeeded right after this merge.
          return {
            profile: { ...profile, activePlanName: serverName ?? undefined },
            goals,
            weightLog,
            savedRecipes,
            grocery,
            logs,
            savedPlans,
            templates,
            customizeDraft: null,
            goalsBeforePlan,
          };
        });
        if (planChanged) get().refreshGroceryWeek(mondayOfWeek(toIsoDate(new Date())));
        get().recalcStreak();
      },
    }),
    {
      name:    'meal-app-store-v2',
      version: 7,
      // Assign UUIDs to any records (meals + saved recipes + saved plans) with a
      // non-UUID id, so their local id can double as the Supabase primary key. v4
      // re-runs this to heal meals created by UI paths that briefly still
      // generated legacy `meal-<ts>` ids (those fail the uuid-typed meal_logs.id
      // on sync); v5 additionally heals saved-plan ids (were `plan-user-<ts>-…` /
      // `plan-built-<ts>`) so plans can sync into the uuid-typed plans.id; v6
      // re-runs it once more to heal scan-path meal ids (were `<date>-scan-<ts>`
      // before the scan flow switched to newId()).
      // templateId references are left intact (local-only).
      migrate: (persisted, _version) => {
        const p = (persisted ?? {}) as Partial<AppStore>;
        // v7: plans activated before startDate existed applied to every past
        // weekday too. Start them today so no further past days fill. Meals
        // already back-filled aren't auto-removed: sync drops the meal->template
        // link, so they can't be told apart from real history (Oct 28).
        if (p.templates) {
          const today = toIsoDate(new Date());
          p.templates = p.templates.map(t =>
            isPlanTemplate(t) && t.recurrence.type !== 'once' && !t.recurrence.startDate
              ? { ...t, recurrence: { ...t.recurrence, startDate: today } }
              : t,
          );
        }
        if (p.logs) {
          for (const log of Object.values(p.logs)) {
            (log?.meals ?? []).forEach(m => {
              if (!isUuid(m.id)) m.id = newId();
            });
          }
        }
        if (p.savedRecipes) {
          p.savedRecipes.forEach(r => {
            if (!isUuid(r.id)) r.id = newId();
          });
        }
        if (p.savedPlans) {
          p.savedPlans.forEach(pl => {
            if (!isUuid(pl.id)) pl.id = newId();
          });
        }
        return p as AppStore;
      },
      storage: createJSONStorage(() => appStorage),
      // The premade catalogs (recipes, plans) are read-only app content, not user
      // data — never persist them. Persisting froze each install on whatever
      // RECIPE_SEED / PLAN_SEED looked like at its first launch: new recipes and
      // isFree flags never arrived, and a duplicate id fixed in the seed on Aug 19
      // lived on in phones that had saved it on Aug 17.
      partialize: state =>
        Object.fromEntries(
          Object.entries(state).filter(([key]) => key !== 'recipes' && key !== 'plans'),
        ) as Partial<AppStore>,
      // Shallow merge by default discards any new top-level/profile fields
      // we add in later releases (e.g. dietaryRestrictions/allergies, recipes,
      // savedRecipes). Provide an explicit merge that fills in defaults for
      // any field missing on persisted state.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppStore>;

        // Backfill non-zero nutrition on any completely-empty meal/template/recipe
        // so completed meals always contribute to the Home progress totals.
        const rawLogs = (p.logs ?? current.logs ?? {}) as Record<string, DailyLog>;
        const logs: Record<string, DailyLog> = {};
        for (const [date, log] of Object.entries(rawLogs)) {
          logs[date] = { ...log, meals: (log?.meals ?? []).map(ensureNutrition) };
        }
        const templates = (p.templates ?? current.templates ?? []).map(ensureNutrition);
        const savedRecipes = (p.savedRecipes ?? current.savedRecipes ?? []).map(ensureNutrition);

        return {
          ...current,
          ...p,
          logs,
          templates,
          profile: {
            ...DEFAULT_PROFILE,
            ...(p.profile ?? {}),
            dietaryRestrictions: p.profile?.dietaryRestrictions ?? [],
            allergies:           p.profile?.allergies           ?? [],
            // New fields fall back to defaults if persisted store predates them.
            weightUnit:           p.profile?.weightUnit           ?? DEFAULT_PROFILE.weightUnit,
            subscription:         p.profile?.subscription         ?? DEFAULT_PROFILE.subscription,
            mealRemindersEnabled: p.profile?.mealRemindersEnabled ?? DEFAULT_PROFILE.mealRemindersEnabled,
            remindMinutesBefore: (p.profile?.remindMinutesBefore  ?? DEFAULT_PROFILE.remindMinutesBefore),
            mealSlots:            (p.profile?.mealSlots && p.profile.mealSlots.length > 0)
                                    // Backfill skipped: false on slots persisted before that field existed.
                                    ? p.profile.mealSlots.map(s => ({ ...s, skipped: s.skipped ?? false }))
                                    : DEFAULT_PROFILE.mealSlots,
            trackedNutrients:     p.profile?.trackedNutrients ?? DEFAULT_TRACKED_NUTRIENTS,
            activePlanName:       p.profile?.activePlanName,
            // Anyone with a persisted profile predates onboarding — treat them as
            // already onboarded so they aren't trapped in the flow. Only a truly
            // fresh install (no persisted profile) sees onboarding.
            onboardingComplete:   p.profile?.onboardingComplete ?? (p.profile ? true : false),
            pendingFirstPlan:     p.profile?.pendingFirstPlan ?? false,
          },
          goals: {
            ...DEFAULT_GOALS,
            ...(p.goals ?? {}),
            // Older stores didn't carry waterTargetCups.
            waterTargetCups: p.goals?.waterTargetCups ?? DEFAULT_GOALS.waterTargetCups,
            secondaryTargets: p.goals?.secondaryTargets ?? {},
          },
          // Always the bundled seed — ignores any catalog older installs saved
          // before partialize excluded it (see partialize above).
          recipes:      current.recipes,
          savedRecipes,
          grocery:      p.grocery      ?? current.grocery,
          weightLog:    p.weightLog    ?? current.weightLog ?? [],
          plans:        current.plans,
          savedPlans:   p.savedPlans   ?? current.savedPlans ?? [],
          viewedRecipeIds: p.viewedRecipeIds ?? current.viewedRecipeIds ?? [],
          planAvoidFoods: p.planAvoidFoods ?? current.planAvoidFoods ?? [],
          recipeFixHistory: p.recipeFixHistory ?? {},
          goalsBeforePlan: p.goalsBeforePlan ?? null,
          // Ephemeral swap coordination — always start clean on launch so a
          // stale persisted swap target can never fire on the wrong screen.
          pendingSwap:    null,
          customizeDraft: null,
          pendingRecipeConcept: null,
          mealEditSession: null,
        } as AppStore;
      },
    }
  )
);
