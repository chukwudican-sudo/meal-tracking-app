// ─── Core data models ─────────────────────────────────────────────────────────

// Secondary nutrients the user can optionally track beyond the core macros.
export type NutrientKey =
  | 'fiber'
  | 'sugar'
  | 'sodium'
  | 'potassium'
  | 'cholesterol'
  | 'saturatedFat'
  | 'iron';

export type NutrientValues = Partial<Record<NutrientKey, number>>;

export interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  // Optional per-ingredient nutrition (populated by AI/manual edit; legacy
  // ingredients may omit these and display as 0).
  calories?: number;
  macros?: Macros;
  servings?: number;
  nutrients?: NutrientValues;
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
  templateId?: string;  // id of the MealTemplate that generated this entry (planned meals only)
  isAdHoc?: boolean;    // true if added outside the original plan structure (permanent flag)
  slotId?: string;      // id of the MealSlot this entry fills (used by the slot-section Day Detail)
  category?: RecipeCategory; // meal type tag (Breakfast/Lunch/Dinner/Snacks)
  servings?: number;    // serving multiplier (default 1); scales calories/macros/ingredients
  nutrients?: NutrientValues; // optional secondary nutrient totals for this meal
  photoUri?: string;    // optional meal photo (scanned capture or user upload)
  seed?: boolean;       // built-in demo/sample data — excluded from cloud sync
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
  secondaryTargets?: NutrientValues; // optional daily targets for tracked secondary nutrients
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
  birthday?: string;                  // ISO yyyy-mm-dd captured during onboarding
  heightCm?: number;
  weightKg?: number;
  targetWeightKg?: number;            // goal weight (== weightKg for "eat healthier")
  gender?: Gender;
  activityLevel?: ActivityLevel;
  goalType?: GoalType;
  paceLbsPerWeek?: number | null;     // desired rate of change (null for "eat healthier")
  goalDate?: string | null;           // ISO date the user is projected to hit their goal

  // Onboarding lifecycle
  onboardingComplete?: boolean;       // gates the app entry; false shows the onboarding flow
  pendingFirstPlan?: boolean;         // true after onboarding until the first plan is built (Home nudge)
  notificationsAllowed?: boolean;     // result of the onboarding notification prompt
  // True after an email/password signup whose address is not yet verified.
  // Drives the Home "verify your email" banner; cleared once a confirmed
  // session is observed. Persisted so the banner survives app restarts.
  pendingEmailVerification?: boolean;

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

  // Secondary nutrients the user has chosen to track (shown on macro page 2).
  trackedNutrients?: NutrientKey[];

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

export type RecipeDifficulty = 'Easy' | 'Medium' | 'Hard';

export interface RecipeTemplate {
  id: string;                 // Stable id (e.g. 'premade-bf-oats')
  name: string;
  category: RecipeCategory;
  calories: number;
  cookTimeMin: number;        // estimated cooking time in minutes
  macros: Macros;
  ingredients: Ingredient[];
  steps: string[];            // numbered cooking steps in order
  difficulty?: RecipeDifficulty; // shown on the full recipe detail page
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
  difficulty?: RecipeDifficulty; // shown on the full recipe detail page
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

// ─── Cross-screen swap coordination (ephemeral UI state) ─────────────────────

// Set by Day Detail (daily) or Customize Plan (plan) before navigating to the
// Saved Recipes page in swap mode. The Saved Recipes page reads this to know
// where to put the chosen recipe, then clears it.
export type PendingSwap =
  | { type: 'daily'; date: string; slotName: string; slotId?: string; time: string; category?: RecipeCategory }
  | { type: 'plan'; dayIdx: number; slotName: string; time: string; category?: RecipeCategory };

// Holds the in-progress Customize Plan draft so it survives the round-trip to
// the Saved Recipes swap page (which unmounts the Plan Detail modal stack).
export interface CustomizeDraft {
  planId: string;
  draftPlan: MealPlan;
}

// In-progress edit of a single logged meal. Shared between the meal detail
// popup and the full-screen macro/ingredient edit routes so the popup can
// dismiss for navigation and reappear with the latest draft values.
export interface MealEditSession {
  date: string;
  context: 'home' | 'plan';
  draft: MealEntry;
}

// ─── Cloud sync ───────────────────────────────────────────────────────────────

// Reverse-mapped Supabase data ready to merge into the store. Everything is in
// the app's domain shape (metric units, GroceryItem, MealEntry, etc.).
export interface ServerSnapshot {
  profile?: Partial<UserProfile>;
  goals?: Partial<UserGoals>;
  weightLog?: WeightLogEntry[];
  savedRecipes?: SavedRecipe[];
  groceryItems?: GroceryItem[];
  logsByDate?: Record<string, MealEntry[]>;
  // User plans (never premade). activePlanName mirrors the server's is_active
  // flag back to the local name-based pointer.
  plans?: MealPlan[];
  activePlanName?: string;
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
  recipes: RecipeTemplate[];          // premade catalog (seeded)
  savedRecipes: SavedRecipe[];        // user's saved + favourited recipes
  weightLog: WeightLogEntry[];        // chronological weight history (Profile + Progress)
  plans: PlanTemplate[];              // premade plan catalog (seeded)
  savedPlans: MealPlan[];             // user-snapshotted plans
  viewedRecipeIds: string[];          // saved recipe ids the user has opened (clears NEW tag)

  // Ephemeral swap coordination (not persisted across launches in practice).
  pendingSwap: PendingSwap | null;
  customizeDraft: CustomizeDraft | null;
  // In-progress single-meal edit (popup + edit routes). Not persisted.
  mealEditSession: MealEditSession | null;

  toggleMealStatus:       (date: string, mealId: string) => void;
  logWater:               (date: string, ml: number) => void;
  addMealToDay:           (date: string, entry: MealEntry) => void;
  removeMealFromDay:      (date: string, mealId: string) => void;
  // Recurrence-aware removal used by the Day Detail page X button.
  // 'this' = single occurrence; 'future' = end the template at this date;
  // 'all' = drop the template entirely.
  removeDayMealWithScope: (date: string, mealId: string, scope: 'this' | 'future' | 'all') => void;
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
  // Mark a saved recipe as viewed so its "NEW" tag clears.
  markRecipeViewed: (id: string) => void;
  // Add a recipe to today's log immediately. Ingests ingredients; auto-saves
  // unless opts.save === false (used by premade plus-tap which must not persist
  // into the user's Recently Added collection).
  addRecipeToToday: (recipe: Pick<SavedRecipe, 'name' | 'calories' | 'macros' | 'ingredients'> & { recipeId?: string; cookTimeMin?: number; steps?: string[]; category?: RecipeCategory; source?: SavedRecipeSource }, opts?: { save?: boolean }) => MealEntry;
  // Add a recipe to a future date by creating a one-off MealTemplate.
  addRecipeToPlan: (recipe: Pick<SavedRecipe, 'name' | 'calories' | 'macros' | 'ingredients'> & { recipeId?: string; cookTimeMin?: number; steps?: string[]; category?: RecipeCategory; source?: SavedRecipeSource }, dateIso: string, time: string) => MealTemplate;

  // ─── Meal plan actions ───────────────────────────────────────────────────
  // Activates a plan: replaces templates[] with one MealTemplate per slot
  // per day (weekly recurrence). Sets profile.activePlanName. Ingests any
  // missing ingredients into Planned Ingredients.
  activatePlan: (plan: MealPlan) => void;
  // Non-destructive re-activation on restore: if there's an active plan pointer
  // but no local templates (fresh device / wiped cache), re-derive templates and
  // fill today's missing slots WITHOUT clobbering existing/synced logs. No-op if
  // templates already exist. Run after meal_logs are pulled.
  hydrateActivePlanIfNeeded: () => void;
  // Snapshots current templates[] into a MealPlan and pushes onto savedPlans.
  saveCurrentPlanAs: (name: string) => MealPlan;
  renameSavedPlan: (id: string, name: string) => void;
  removeSavedPlan: (id: string) => void;
  /** Replace a saved plan in-place, e.g. after Customize Plan edits. */
  updateSavedPlan: (id: string, plan: MealPlan) => void;

  // ─── Swap coordination actions ──────────────────────────────────────────
  setPendingSwap: (swap: PendingSwap | null) => void;
  clearPendingSwap: () => void;
  setCustomizeDraft: (draft: CustomizeDraft | null) => void;
  clearCustomizeDraft: () => void;
  // Replace (or fill) the meal in the given slot for one specific day's log.
  swapMealInDay: (
    date: string,
    slot: { slotId?: string; slotName: string; time: string },
    recipe: Pick<SavedRecipe, 'name' | 'calories' | 'macros' | 'ingredients'> & { recipeId?: string; cookTimeMin?: number; steps?: string[]; category?: RecipeCategory; source?: SavedRecipeSource },
  ) => void;

  // ─── Meal edit session (popup + macro/ingredient edit routes) ────────────
  openMealEditSession: (date: string, context: 'home' | 'plan', entry: MealEntry) => void;
  updateMealDraft: (patch: Partial<MealEntry>) => void;
  updateDraftIngredient: (ingredientId: string, patch: Partial<Ingredient>) => void;
  removeDraftIngredient: (ingredientId: string) => void;
  commitMealEditSession: () => void;
  closeMealEditSession: () => void;

  // ─── Cloud sync (Supabase) ───────────────────────────────────────────────
  // Merge a reverse-mapped server snapshot into local state. Records whose
  // entityKey is present in `dirtyKeys` (a pending local write) are left
  // untouched so an in-flight change is never clobbered by an incoming pull.
  applyServerSnapshot: (snapshot: ServerSnapshot, dirtyKeys: Set<string>) => void;
}
