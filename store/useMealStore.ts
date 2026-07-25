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
  MealSlot,
  MealTemplate,
  PendingSwap,
  PlanDayMeal,
  RecurrenceRule,
  SavedMeal,
  SavedRecipe,
  UserGoals,
  UserProfile,
  WeightLogEntry,
} from './types';
import { RECIPE_SEED } from '@/constants/recipeSeed';
import { PLAN_SEED } from '@/constants/planSeed';
import { DEFAULT_TRACKED_NUTRIENTS } from '@/constants/nutrients';
import { classifyIngredient, normalizeIngredientName } from '@/constants/ingredientCategories';
import { newId, isUuid } from '@/lib/sync/uuid';
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
function buildTemplatesFromPlan(state: AppStore, plan: MealPlan): MealTemplate[] {
  const recipeById = new Map(state.recipes.map(r => [r.id, r]));
  const savedById = new Map(state.savedRecipes.map(r => [r.id, r]));
  const savedByRecipeId = new Map(
    state.savedRecipes.filter(r => r.recipeId).map(r => [r.recipeId as string, r]),
  );
  // Resolve a plan meal's nutrition from premade recipes first, then the
  // user's saved/AI recipes (by id, source id, or name). Without this,
  // custom recipes referenced by a plan resolved to 0 calories, so the
  // Home progress rings never moved when those meals were completed.
  const resolveNutrition = (recipeId: string, recipeName: string) => {
    const nameKey = recipeName.trim().toLowerCase();
    return (
      recipeById.get(recipeId) ??
      savedById.get(recipeId) ??
      savedByRecipeId.get(recipeId) ??
      state.recipes.find(r => r.name.trim().toLowerCase() === nameKey) ??
      state.savedRecipes.find(r => r.name.trim().toLowerCase() === nameKey)
    );
  };

  // Build one MealTemplate per (slotName + time + recipe) combo, with
  // a weekly recurrence whose `days[]` is the set of weekdays that
  // pairing appears on. Weekday convention: Mon=0..Sun=6.
  type Bucket = {
    slotName: string;
    time: string;
    recipeId: string;
    recipeName: string;
    days: number[];
  };
  const buckets = new Map<string, Bucket>();

  plan.days.forEach((dayMeals, dayIdx) => {
    (dayMeals ?? []).forEach(m => {
      const key = `${m.slotName}|${m.time}|${m.recipeId}|${m.recipeName}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.days.push(dayIdx);
      } else {
        buckets.set(key, {
          slotName: m.slotName,
          time: m.time,
          recipeId: m.recipeId,
          recipeName: m.recipeName,
          days: [dayIdx],
        });
      }
    });
  });

  const now = Date.now();
  let idCounter = 0;
  const nextTemplates: MealTemplate[] = [];

  buckets.forEach(bucket => {
    const recipe = resolveNutrition(bucket.recipeId, bucket.recipeName);
    // Fall back to deterministic non-zero nutrition if the recipe can't be
    // resolved, so plan meals always contribute to the Home progress.
    const fb          = fallbackNutrition(bucket.recipeName);
    const calories    = recipe?.calories && recipe.calories > 0 ? recipe.calories : fb.calories;
    const macros      = recipe?.macros ?? fb.macros;
    const ingredients = recipe ? cloneIngredients(recipe.ingredients) : [];

    // Plan day indices are Monday=0..Sunday=6, but recurrence.days uses
    // the JS weekday convention Sunday=0..Saturday=6. Convert so the
    // meals a user planned for "Monday" actually recur on Mondays.
    const recurrence: RecurrenceRule = {
      type: 'weekly',
      days: [...new Set(bucket.days.map(d => (d + 1) % 7))].sort((a, b) => a - b),
    };

    nextTemplates.push({
      id: `tpl-plan-${now}-${idCounter++}`,
      name: bucket.recipeName,
      time: bucket.time,
      calories,
      ingredients,
      macros,
      recurrence,
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
      pendingSwap:    null,
      customizeDraft: null,
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
        set(state => {
          const log = state.logs[date] ?? { date, meals: [], waterMl: 0 };
          return {
            logs: {
              ...state.logs,
              [date]: { ...log, meals: [...log.meals, entry] },
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
                  return {
                    ...entry,
                    isAdHoc:    entry.isAdHoc    ?? m.isAdHoc,
                    templateId: entry.templateId ?? m.templateId,
                    seed:       entry.seed       ?? m.seed,
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

          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          let changed = false;

          const nextMeals = log.meals.map(meal => {
            if (meal.status !== 'pending') return meal;
            const mealMinutes = toMinutesFromHHMM(meal.time);
            if (mealMinutes === null || mealMinutes > nowMinutes) return meal;
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
          const applicable = state.templates.filter(t => isTemplateApplicableOnDate(t, date));
          if (applicable.length === 0) return state;
          const meals: MealEntry[] = applicable.map(t => ({
            id:          newId(),
            name:        t.name,
            time:        t.time,
            calories:    t.calories,
            ingredients: t.ingredients,
            macros:      t.macros,
            status:      'pending',
            templateId:  t.id,
          }));
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
      updateGoals: partial =>
        set(state => ({ goals: { ...state.goals, ...partial } })),

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
          logs:         {},
          goals:        DEFAULT_GOALS,
          // DEFAULT_PROFILE has onboardingComplete:false, so a reset restarts
          // the onboarding flow on next app entry.
          profile:      DEFAULT_PROFILE,
          streak:       0,
          templates:    [],
          library:      [],
          grocery:      INITIAL_GROCERY,
          savedRecipes: [],
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
        set(state => ({
          savedRecipes: state.savedRecipes.filter(r => r.id !== id),
        }));
      },

      markRecipeViewed: (id) => {
        set(state =>
          state.viewedRecipeIds.includes(id)
            ? state
            : { viewedRecipeIds: [...state.viewedRecipeIds, id] }
        );
      },

      addRecipeToToday: (recipe, opts) => {
        const todayIso = toIsoDate(new Date());
        const entry: MealEntry = {
          id: newId(),
          name: recipe.name,
          time: roundToNextHalfHour(new Date()),
          calories: recipe.calories,
          ingredients: cloneIngredients(recipe.ingredients),
          macros: recipe.macros,
          status: 'pending',
        };
        get().addMealToDay(todayIso, entry);

        // Ingest ingredients into the grocery system (no-op for items already in Kitchen).
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
        const todayMeals: MealEntry[] = nextTemplates
          .filter(t => isTemplateApplicableOnDate(t, today))
          .map(t => ({
            id:          newId(),
            name:        t.name,
            time:        t.time,
            calories:    t.calories,
            ingredients: t.ingredients,
            macros:      t.macros,
            status:      'pending',
            templateId:  t.id,
          }));

        // Preserve past days (history / streaks) but discard today + any future
        // logs so they re-resolve from the new plan. This guarantees an old
        // plan's meals are fully replaced everywhere when a new plan activates.
        const refreshedLogs: Record<string, DailyLog> = {};
        Object.entries(state.logs).forEach(([d, log]) => {
          if (d < today) refreshedLogs[d] = log;
        });
        refreshedLogs[today] = {
          date: today,
          meals: todayMeals,
          waterMl: state.logs[today]?.waterMl ?? 0,
        };

        // If the plan defines explicit daily targets (premade plans), reflect
        // them in the Home tab goals. Built plans have no targets, so the
        // user's onboarding-derived goals are kept.
        const nextGoals = plan.targets
          ? {
              ...state.goals,
              dailyCalories: plan.targets.calories,
              protein: plan.targets.protein,
              carbs: plan.targets.carbs,
              fats: plan.targets.fats,
            }
          : state.goals;

        set({
          templates: nextTemplates,
          logs: refreshedLogs,
          goals: nextGoals,
          // Building/activating a plan satisfies the onboarding "first plan"
          // step, so clear the persistent Home nudge.
          profile: { ...state.profile, activePlanName: plan.name, pendingFirstPlan: false },
        });

        // Rebuild Planned Ingredients from the new plan's templates for the
        // current week — this clears the previous plan's planned items and
        // repopulates from the meals that are actually scheduled.
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
        if (state.templates.length > 0) return; // a plan is already live; leave it

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
          }));

        const mergedTodayMeals = [...existingToday, ...materialized].sort((a, b) =>
          (a.time ?? '').localeCompare(b.time ?? ''),
        );

        const nextGoals = plan.targets
          ? {
              ...state.goals,
              dailyCalories: plan.targets.calories,
              protein: plan.targets.protein,
              carbs: plan.targets.carbs,
              fats: plan.targets.fats,
            }
          : state.goals;

        set({
          templates: nextTemplates,
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
            });
          });
        });
        days.forEach(d => d.sort((a, b) => a.time.localeCompare(b.time)));

        const plan: MealPlan = {
          // UUID so the local id doubles as the server plans.id primary key.
          id: newId(),
          name,
          description: undefined,
          disclaimer: undefined,
          category: undefined,
          days,
          targets: undefined,
          savedAt: new Date().toISOString(),
          source: 'user',
        };
        set({ savedPlans: [plan, ...state.savedPlans] });
        return plan;
      },

      renameSavedPlan: (id, name) => {
        set(state => ({
          savedPlans: state.savedPlans.map(p =>
            p.id === id ? { ...p, name } : p,
          ),
        }));
      },

      removeSavedPlan: (id) => {
        set(state => ({
          savedPlans: state.savedPlans.filter(p => p.id !== id),
        }));
      },

      updateSavedPlan: (id, plan) => {
        // Replace the matching saved plan in-place. We only update `savedPlans`
        // here — the active templates (used for week resolution) are untouched
        // since the spec only requires the saved plan record to reflect the
        // new structure for now. If a future change should also rewrite the
        // user's day-by-day templates, it can be layered on top of this.
        set(state => ({
          savedPlans: state.savedPlans.map(p =>
            p.id === id ? { ...plan, id, source: p.source } : p,
          ),
        }));
      },

      // ─── Swap coordination ──────────────────────────────────────────────
      setPendingSwap: (swap) => set({ pendingSwap: swap }),
      clearPendingSwap: () => set({ pendingSwap: null }),
      setCustomizeDraft: (draft) => set({ customizeDraft: draft }),
      clearCustomizeDraft: () => set({ customizeDraft: null }),

      swapMealInDay: (date, slot, recipe) => {
        set(state => {
          const log = state.logs[date] ?? { date, meals: [], waterMl: 0 };
          // Identify the existing entry for this slot: match slotId first,
          // then fall back to time (legacy entries that predate slotId).
          const matchIdx = log.meals.findIndex(m =>
            slot.slotId ? m.slotId === slot.slotId : m.time === slot.time,
          );
          const nextEntry: MealEntry = {
            id: matchIdx >= 0
              ? log.meals[matchIdx].id
              : newId(),
            name: recipe.name,
            time: slot.time,
            calories: recipe.calories,
            ingredients: cloneIngredients(recipe.ingredients),
            macros: recipe.macros,
            status: matchIdx >= 0 ? log.meals[matchIdx].status : 'pending',
            slotId: slot.slotId,
            category: recipe.category,
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

      // ── Cloud sync merge ───────────────────────────────────────────────────
      applyServerSnapshot: (snapshot, dirtyKeys) => {
        set(state => {
          const usersDirty = dirtyKeys.has(entityKey.usersSelf());

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

          // Logs — union per date by meal id; keep local water + local-only meals.
          let logs = state.logs;
          if (snapshot.logsByDate) {
            logs = { ...state.logs };
            for (const [date, meals] of Object.entries(snapshot.logsByDate)) {
              const byId = new Map((logs[date]?.meals ?? []).map(m => [m.id, m]));
              meals.forEach(m => {
                if (!dirtyKeys.has(entityKey.mealLog(m.id))) byId.set(m.id, m);
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

          // Active-plan pointer — mirror the server is_active flag onto the local
          // name-based pointer, but never clobber a local activation still pending
          // in the outbox (any dirty plan key means the user just changed plans).
          let nextProfile = profile;
          const anyPlanDirty = Array.from(dirtyKeys).some(k => k.startsWith('plans:'));
          if (snapshot.activePlanName != null && !anyPlanDirty) {
            nextProfile = { ...nextProfile, activePlanName: snapshot.activePlanName };
          }

          return { profile: nextProfile, goals, weightLog, savedRecipes, grocery, logs, savedPlans };
        });
        get().recalcStreak();
      },
    }),
    {
      name:    'meal-app-store-v2',
      version: 6,
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
          recipes:      p.recipes      ?? current.recipes,
          savedRecipes,
          grocery:      p.grocery      ?? current.grocery,
          weightLog:    p.weightLog    ?? current.weightLog ?? [],
          plans:        p.plans        ?? current.plans,
          savedPlans:   p.savedPlans   ?? current.savedPlans ?? [],
          viewedRecipeIds: p.viewedRecipeIds ?? current.viewedRecipeIds ?? [],
          // Ephemeral swap coordination — always start clean on launch so a
          // stale persisted swap target can never fire on the wrong screen.
          pendingSwap:    null,
          customizeDraft: null,
          mealEditSession: null,
        } as AppStore;
      },
    }
  )
);
