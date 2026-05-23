import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

import type {
  AppStore,
  DailyLog,
  MealEntry,
  MealTemplate,
  RecurrenceRule,
  SavedMeal,
  UserGoals,
  UserProfile,
} from './types';

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function toIsoDate(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  dailyCalories: 2200,
  protein: 165,
  carbs:   220,
  fats:     65,
};

const DEFAULT_PROFILE: UserProfile = {
  name: '',
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
      logs:      SEED_LOGS,
      goals:     DEFAULT_GOALS,
      profile:   DEFAULT_PROFILE,
      streak:    5,
      templates: SEED_TEMPLATES,
      library:   SEED_LIBRARY,

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

      removeTemplate: id =>
        set(state => ({ templates: state.templates.filter(t => t.id !== id) })),

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
    }),
    {
      name:    'meal-app-store-v2',
      storage: createJSONStorage(() => appStorage),
    }
  )
);
