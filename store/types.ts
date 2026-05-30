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
  protein: number;          // grams
  carbs: number;            // grams
  fats: number;             // grams
  waterTargetCups: number;  // daily water target in cups (8oz)
  isCalculated?: boolean;   // true when set by Edit Goal flow; cleared when manually edited
}

// ─── Goal / activity / unit enums ────────────────────────────────────────────

export type GoalType = 'lose_weight' | 'maintain' | 'gain_muscle' | 'lean_bulk';
export type ActivityLevel =
  | 'sedentary'
  | 'lightly_active'
  | 'moderately_active'
  | 'very_active'
  | 'extra_active';
export type WeightUnit = 'lbs' | 'kg';
export type Gender = 'male' | 'female' | 'other';
export type GoalPace = 'slow' | 'moderate' | 'aggressive';
export type SubscriptionTier = 'free' | 'premium';
export type RemindMinutes = 5 | 10 | 15 | 30;

export interface WeightLogEntry {
  date: string;       // ISO yyyy-mm-dd
  weightKg: number;
}

export interface MealSlot {
  id: string;
  name: string;     // e.g. "Breakfast"
  time: string;     // "HH:MM"
  skipped?: boolean; // if true, slot is excluded from Build My Plan and daily schedule
}

export interface UserProfile {
  // Identity
  name: string;                       // First name, used in AI greetings ("Hey Alex!")
  firstName?: string;                 // Settings → Account form
  lastName?: string;
  email?: string;

  // Body & goals
  age?: number;
  heightCm?: number;
  weightKg?: number;
  gender?: Gender;
  activityLevel?: ActivityLevel;
  goalType?: GoalType;

  // Preferences
  weightUnit: WeightUnit;             // 'lbs' default — switch from Profile or Settings
  subscription: SubscriptionTier;     // shell only for MVP
  dietaryRestrictions: string[];      // e.g. ['Vegetarian']. Read by AI shells.
  allergies: string[];                // e.g. ['Peanuts','Shellfish']. Read by AI shells.

  // Notifications
  mealRemindersEnabled: boolean;
  remindMinutesBefore: RemindMinutes;

  // Meal slots (Build My Plan walks these in order; default to 5 slots).
  mealSlots: MealSlot[];

  // Name of the currently active plan (set when a plan is activated).
  activePlanName?: string;
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

// ─── Recipes ─────────────────────────────────────────────────────────────────

export type RecipeCategory = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks';

export interface RecipeTemplate {
  id: string;                 // Stable id (e.g. 'premade-bf-oats')
  name: string;
  category: RecipeCategory;
  calories: number;
  cookTimeMin: number;        // estimated cooking time in minutes
  macros: Macros;
  ingredients: Ingredient[];
  steps: string[];            // numbered cooking steps in order
}

export type SavedRecipeSource = 'premade' | 'ai' | 'manual';

// A user-saved recipe. Recipes auto-save when added to plan/today, and can be
// explicitly favourited via the heart icon.
export interface SavedRecipe {
  id: string;                    // unique within savedRecipes
  recipeId?: string;             // source RecipeTemplate id when source==='premade'
  name: string;
  category?: RecipeCategory;
  calories: number;
  cookTimeMin?: number;
  macros: Macros;
  ingredients: Ingredient[];
  steps?: string[];
  source: SavedRecipeSource;
  favourited: boolean;           // explicit heart tap
  addedAt: string;               // ISO timestamp — drives "Recently Added" order
}

// ─── Meal plans ──────────────────────────────────────────────────────────────

export type PlanCategory =
  | 'Balanced'
  | 'High Protein'
  | 'Low Carb'
  | 'High Fiber'
  | 'Keto'
  | 'Mediterranean';

// One slot's meal in a plan day.
export interface PlanDayMeal {
  slotName: string;        // "Breakfast"
  time: string;            // "HH:MM"
  recipeId: string;        // refers to RecipeTemplate.id (or 'custom' for AI cards)
  recipeName: string;
}

// A persisted plan (either premade or saved by the user).
// `days` is exactly 7 entries indexed Monday=0 .. Sunday=6.
export interface MealPlan {
  id: string;
  name: string;
  description?: string;
  disclaimer?: string;
  category?: PlanCategory;
  days: PlanDayMeal[][];
  targets?: { calories: number; protein: number; carbs: number; fats: number };
  savedAt: string;
  source: 'premade' | 'user';
}

export type PlanTemplate = MealPlan;

// ─── Zustand store shape ──────────────────────────────────────────────────────

export interface AppStore {
  logs: Record<string, DailyLog>;
  goals: UserGoals;
  profile: UserProfile;
  streak: number;
  templates: MealTemplate[];
  library: SavedMeal[];
  grocery: GroceryState;
  recipes: RecipeTemplate[];          // premade catalog (seeded)
  savedRecipes: SavedRecipe[];        // user's saved + favourited recipes
  weightLog: WeightLogEntry[];        // chronological weight history (Profile + Progress)
  plans: PlanTemplate[];              // premade plan catalog (seeded)
  savedPlans: MealPlan[];             // user-snapshotted plans

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
  logWeight:              (weightKg: number) => void;
  resetUserData:          () => void;
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

  // ─── Recipe actions ──────────────────────────────────────────────────────
  // Auto-save a recipe (idempotent on `recipeId` when source==='premade',
  // otherwise on `id`). Returns the resulting saved recipe.
  ensureRecipeSaved: (recipe: Omit<SavedRecipe, 'id' | 'addedAt' | 'favourited'> & { id?: string; favourited?: boolean }) => SavedRecipe;
  toggleFavouriteRecipe: (recipe: Omit<SavedRecipe, 'id' | 'addedAt' | 'favourited'> & { id?: string }) => SavedRecipe;
  removeSavedRecipe: (id: string) => void;
  // Add a recipe to today's log immediately. Auto-saves and ingests ingredients.
  addRecipeToToday: (recipe: Pick<SavedRecipe, 'name' | 'calories' | 'macros' | 'ingredients'> & { recipeId?: string; cookTimeMin?: number; steps?: string[]; category?: RecipeCategory; source?: SavedRecipeSource }) => MealEntry;
  // Add a recipe to a future date by creating a one-off MealTemplate.
  addRecipeToPlan: (recipe: Pick<SavedRecipe, 'name' | 'calories' | 'macros' | 'ingredients'> & { recipeId?: string; cookTimeMin?: number; steps?: string[]; category?: RecipeCategory; source?: SavedRecipeSource }, dateIso: string, time: string) => MealTemplate;

  // ─── Meal plan actions ───────────────────────────────────────────────────
  // Activates a plan: replaces templates[] with one MealTemplate per slot
  // per day (weekly recurrence). Sets profile.activePlanName. Ingests any
  // missing ingredients into Planned Ingredients.
  activatePlan: (plan: MealPlan) => void;
  // Snapshots current templates[] into a MealPlan and pushes onto savedPlans.
  saveCurrentPlanAs: (name: string) => MealPlan;
  renameSavedPlan: (id: string, name: string) => void;
  removeSavedPlan: (id: string) => void;
}
