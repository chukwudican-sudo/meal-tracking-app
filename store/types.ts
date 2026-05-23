// ─── Core data models ─────────────────────────────────────────────────────────

export interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

export interface Macros {
  protein: number;
  carbs: number;
  fats: number;
}

export type MealStatus = 'pending' | 'completed' | 'missed';

export interface MealEntry {
  id: string;
  name: string;
  time: string;         // "HH:MM"
  duration?: number;    // minutes (optional — how long the meal takes)
  calories: number;
  ingredients: Ingredient[];
  macros: Macros;
  status: MealStatus;
}

export interface DailyLog {
  date: string;         // "YYYY-MM-DD"
  meals: MealEntry[];
  waterMl: number;
}

export interface UserGoals {
  dailyCalories: number;
  protein: number;      // grams
  carbs: number;        // grams
  fats: number;         // grams
}

export interface UserProfile {
  name: string;         // First name, used in AI greetings ("Hey Alex!")
}

// ─── Recurrence & templates ───────────────────────────────────────────────────

export type RecurrenceRule =
  | { type: 'once'; date: string }
  | { type: 'daily'; every?: number; startDate?: string; untilDate?: string; excludeDates?: string[] }
  | { type: 'weekly'; days: number[]; every?: number; startDate?: string; untilDate?: string; excludeDates?: string[] } // 0=Sun … 6=Sat
  | { type: 'monthly'; day: number; every?: number; startDate?: string; untilDate?: string; excludeDates?: string[] };

export interface MealTemplate {
  id: string;
  name: string;
  time: string;
  duration?: number;    // minutes (optional)
  calories: number;
  ingredients: Ingredient[];
  macros: Macros;
  recurrence: RecurrenceRule;
}

// ─── Library (saved meals) ────────────────────────────────────────────────────

export interface SavedMeal {
  id: string;
  name: string;
  calories: number;
  ingredients: Ingredient[];
  macros: Macros;
  usageCount: number;
  lastUsed: string;     // ISO date
}

// ─── Zustand store shape ──────────────────────────────────────────────────────

export interface AppStore {
  logs: Record<string, DailyLog>;
  goals: UserGoals;
  profile: UserProfile;
  streak: number;
  templates: MealTemplate[];
  library: SavedMeal[];

  toggleMealStatus:       (date: string, mealId: string) => void;
  logWater:               (date: string, ml: number) => void;
  addMealToDay:           (date: string, entry: MealEntry) => void;
  removeMealFromDay:      (date: string, mealId: string) => void;
  restoreMealToDay:       (date: string, entry: MealEntry, index: number) => void;
  editMealOnDay:          (date: string, entry: MealEntry) => void;
  markPastDueMealsAsMissed:(date?: string) => void;
  addTemplate:            (template: MealTemplate) => void;
  updateTemplate:         (template: MealTemplate) => void;
  removeTemplate:         (id: string) => void;
  resolveDayFromTemplates:(date: string) => void;
  saveToLibrary:          (meal: SavedMeal) => void;
  removeFromLibrary:      (id: string) => void;
  updateLibraryMeal:      (meal: SavedMeal) => void;
  updateGoals:            (goals: Partial<UserGoals>) => void;
  updateProfile:          (profile: Partial<UserProfile>) => void;
  recalcStreak:           () => void;
}
