import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

import type {
  AppStore,
  DailyLog,
  GroceryItem,
  GroceryState,
  Ingredient,
  MealEntry,
  MealPlan,
  MealSlot,
  MealTemplate,
  RecurrenceRule,
  SavedMeal,
  SavedRecipe,
  UserGoals,
  UserProfile,
  WeightLogEntry,
} from './types';
import { RECIPE_SEED } from '@/constants/recipeSeed';
import { PLAN_SEED } from '@/constants/planSeed';
import { classifyIngredient, normalizeIngredientName } from '@/constants/ingredientCategories';

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

// Deep-clone ingredients with fresh ids so multiple meals don't share refs.
function cloneIngredients(items: Ingredient[]): Ingredient[] {
  return items.map((i, idx) => ({
    ...i,
    id: `ing-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
  }));
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
  activePlanName: undefined,
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
    id:          `${date}-${t.id}`,
    name:        t.name,
    time:        t.time,
    calories:    t.calories,
    ingredients: t.ingredients,
    macros:      t.macros,
    status:      'completed',
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
                meals: log.meals.map(m => m.id === entry.id ? entry : m),
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
            id:          `${date}-${t.id}`,
            name:        t.name,
            time:        t.time,
            calories:    t.calories,
            ingredients: t.ingredients,
            macros:      t.macros,
            status:      'pending',
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
          profile:      DEFAULT_PROFILE,
          streak:       0,
          templates:    [],
          library:      [],
          grocery:      INITIAL_GROCERY,
          savedRecipes: [],
          weightLog:    [],
          savedPlans:   [],
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
          id: `sav-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          recipeId: recipe.recipeId,
          name: recipe.name,
          category: recipe.category,
          calories: recipe.calories,
          cookTimeMin: recipe.cookTimeMin,
          macros: recipe.macros,
          ingredients: cloneIngredients(recipe.ingredients),
          steps: recipe.steps ? [...recipe.steps] : undefined,
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
          id: `sav-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          recipeId: recipe.recipeId,
          name: recipe.name,
          category: recipe.category,
          calories: recipe.calories,
          cookTimeMin: recipe.cookTimeMin,
          macros: recipe.macros,
          ingredients: cloneIngredients(recipe.ingredients),
          steps: recipe.steps ? [...recipe.steps] : undefined,
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

      addRecipeToToday: (recipe) => {
        const todayIso = toIsoDate(new Date());
        const entry: MealEntry = {
          id: `meal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

        // Auto-save the recipe to savedRecipes.
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
        const recipeById = new Map(state.recipes.map(r => [r.id, r]));

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
          dayMeals.forEach(m => {
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
        // Track all ingredients to feed Planned Ingredients.
        const ingredientFeed: { name: string; mealName: string }[] = [];

        buckets.forEach(bucket => {
          const recipe = recipeById.get(bucket.recipeId);
          // Fall back to lightweight defaults if recipe is missing.
          const calories      = recipe?.calories ?? 0;
          const macros        = recipe?.macros ?? { protein: 0, carbs: 0, fats: 0 };
          const ingredients   = recipe ? cloneIngredients(recipe.ingredients) : [];

          const recurrence: RecurrenceRule = {
            type: 'weekly',
            days: [...new Set(bucket.days)].sort((a, b) => a - b),
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

          ingredients.forEach(ing => {
            ingredientFeed.push({ name: ing.name, mealName: bucket.recipeName });
          });
        });

        set({
          templates: nextTemplates,
          profile: { ...state.profile, activePlanName: plan.name },
        });

        if (ingredientFeed.length > 0) {
          get().ingestMidWeekIngredients(ingredientFeed);
        }
      },

      saveCurrentPlanAs: (name) => {
        const state = get();
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
          targetDays.forEach(d => {
            days[d].push({
              slotName: t.name,
              time: t.time,
              recipeId: 'custom',
              recipeName: t.name,
            });
          });
        });
        days.forEach(d => d.sort((a, b) => a.time.localeCompare(b.time)));

        const plan: MealPlan = {
          id: `plan-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
    }),
    {
      name:    'meal-app-store-v2',
      storage: createJSONStorage(() => appStorage),
      // Shallow merge by default discards any new top-level/profile fields
      // we add in later releases (e.g. dietaryRestrictions/allergies, recipes,
      // savedRecipes). Provide an explicit merge that fills in defaults for
      // any field missing on persisted state.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppStore>;
        return {
          ...current,
          ...p,
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
            activePlanName:       p.profile?.activePlanName,
          },
          goals: {
            ...DEFAULT_GOALS,
            ...(p.goals ?? {}),
            // Older stores didn't carry waterTargetCups.
            waterTargetCups: p.goals?.waterTargetCups ?? DEFAULT_GOALS.waterTargetCups,
          },
          recipes:      p.recipes      ?? current.recipes,
          savedRecipes: p.savedRecipes ?? current.savedRecipes,
          grocery:      p.grocery      ?? current.grocery,
          weightLog:    p.weightLog    ?? current.weightLog ?? [],
          plans:        p.plans        ?? current.plans,
          savedPlans:   p.savedPlans   ?? current.savedPlans ?? [],
        } as AppStore;
      },
    }
  )
);
