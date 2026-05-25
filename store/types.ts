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

// ─── Grocery (Kitchen / Cart / Planned ingredients) ──────────────────────────

export type IngredientCategory =
  | 'Proteins'
  | 'Carbs & Grains'
  | 'Fruits & Vegetables'
  | 'Dairy'
  | 'Oils & Fats'
  | 'Spices & Seasonings'
  | 'Condiments'
  | 'Other';

export type GrocerySection = 'planned' | 'kitchen' | 'cart' | 'none';

export interface GroceryItem {
  key: string;              // normalized lowercased name (the shared key)
  name: string;             // display name (first occurrence wins)
  category: IngredientCategory;
  section: GrocerySection;
  isCustom?: boolean;       // true for manually added Cart items that don't move to Kitchen
  struckThrough?: boolean;  // Cart only — user tapped to indicate bought
  mealNames?: string[];     // which meals use this ingredient (for Skip warning)
  updatedAt: string;        // ISO timestamp
}

export interface GroceryState {
  weekStart: string;                      // ISO of Monday that populated Planned
  items: Record<string, GroceryItem>;     // key = normalized name
  hasSeenTip: boolean;                    // dismisses the onboarding banner
  cartOldWeekItems: string[];             // keys of Cart items from last week pending keep/remove decision
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
  grocery: GroceryState;

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

  // ─── Grocery actions ──────────────────────────────────────────────────────
  refreshGroceryWeek:            (weekStart: string) => void;
  sortIngredient:                (key: string, to: 'kitchen' | 'cart') => void;
  skipIngredient:                (key: string) => void;
  moveKitchenToCart:             (key: string) => void;
  toggleCartStrikethrough:       (key: string) => void;
  addManualCartItem:             (name: string) => void;
  addManualKitchenItem:          (name: string) => void;
  removeGroceryItem:             (key: string) => void;
  doneShopping:                  () => void;
  resolveOldCartItems:           (decisions: Record<string, 'keep' | 'remove'>) => void;
  dismissGroceryTip:             () => void;
  ingestMidWeekIngredients:      (ingredients: { name: string; mealName: string }[]) => void;
  cleanupRemovedMealIngredients: (mealIngredientNames: string[], remainingMealNames: string[]) => void;
}
