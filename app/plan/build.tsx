import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { newId } from '@/lib/sync/uuid';
import { fetchAllFoodOptionsCombined, fetchMacroFoodOptions } from '@/lib/macroFoodOptions';
import { AIError } from '@/ai/aiEdgeClient';
import { generateMealSuggestions } from '@/ai/generateMealSuggestions';
import { generatePlanShortlist } from '@/ai/generatePlanShortlist';
import { openPaywall } from '@/lib/paywall';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import type {
  MealPlan,
  MealSlot,
  PlanDayMeal,
  RecipeCategory,
  RecipeConcept,
  RecipeTemplate,
  UserProfile,
} from '@/store/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// PAGE_SIZE counts items per page (meals + Suggest more). Non-last pages
// hold 5 meal cards. The last page holds 1–4 meal cards plus Suggest more
// for a total of 5 items.
const PAGE_SIZE = 5;
// Opaque background for cards rendered inside a transparent Modal. COLORS.card
// is a translucent white meant to sit on the opaque app background, so it looks
// see-through inside a Modal — matches the ScanTab fix for the same issue.
const OPAQUE_SHEET_BG = '#1C1C1C';
// INITIAL_SEED and SUGGEST_BATCH are sized against the ~15-recipe-per-category
// static catalog in constants/recipeSeed.ts. With 15 per category, the initial
// seed (9) leaves 6 unseen, so the first Suggest more returns 5 fresh catalog
// cards and a second returns the last 1 before the AI top-up kicks in — the
// relationship is intentional, so keep these in sync if the catalog size or
// per-category count changes.
// Meals seeded the first time a slot is entered.
const INITIAL_SEED = 9;
// Meals generated per Suggest more click (or per Describe call: just 1).
const SUGGEST_BATCH = 5;
// Suggest-more click count that triggers the Describe-suggestion popup
// (once per slot, dismissable; never blocks Suggest more).
const SUGGEST_POPUP_AT = 5;
// Friendly label used on the guide page + summary copy.
const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Lose Weight',
  maintain: 'Maintain',
  gain_muscle: 'Gain Muscle',
  lean_bulk: 'Lean Bulk',
};
function goalTypeLabel(goalType: string | undefined): string {
  return GOAL_LABELS[goalType ?? ''] ?? 'Not set';
}

function categoryForSlot(slotName: string): RecipeCategory {
  const lc = slotName.toLowerCase();
  if (lc.includes('snack')) return 'Snacks';
  if (lc.includes('breakfast')) return 'Breakfast';
  if (lc.includes('lunch')) return 'Lunch';
  if (lc.includes('dinner') || lc.includes('supper')) return 'Dinner';
  return 'Lunch';
}

// Filter the catalogue by dietary preferences + allergies coming from profile.
function applyDietaryFilter(
  recipes: RecipeTemplate[],
  profile: UserProfile,
): RecipeTemplate[] {
  const allergies = (profile.allergies ?? []).map(a => a.toLowerCase()).filter(Boolean);
  const dietary = (profile.dietaryRestrictions ?? []).map(d => d.toLowerCase());
  const vegetarian = dietary.some(d => d.includes('vegetarian'));
  const vegan = dietary.some(d => d.includes('vegan'));
  const pesc = dietary.some(d => d.includes('pesc'));

  const MEAT_KEYWORDS = ['chicken', 'beef', 'turkey', 'pork', 'bacon', 'ham', 'sausage'];
  const SEAFOOD_KEYWORDS = ['fish', 'salmon', 'tuna', 'shrimp', 'prawn'];
  const ANIMAL_KEYWORDS = ['egg', 'milk', 'yogurt', 'cheese', 'butter', 'cream'];

  return recipes.filter(r => {
    const text = r.ingredients.map(i => i.name.toLowerCase()).join(' ') + ' ' + r.name.toLowerCase();
    if (allergies.some(a => text.includes(a))) return false;
    if (vegan && [...MEAT_KEYWORDS, ...SEAFOOD_KEYWORDS, ...ANIMAL_KEYWORDS].some(k => text.includes(k))) return false;
    if (vegetarian && [...MEAT_KEYWORDS, ...SEAFOOD_KEYWORDS].some(k => text.includes(k))) return false;
    if (pesc && MEAT_KEYWORDS.some(k => text.includes(k))) return false;
    return true;
  });
}

// Rank recipes by goal-aware score, optionally biased by the wizard's
// mini onboarding answers (cuisines, cook time, loves, avoid).
//
// Avoid tokens are *soft* filters — a strong negative score rather than a
// hard removal — to keep the candidate pool from collapsing on common
// inputs like "tomato". The user's hard constraints (allergies, dietary
// preferences) still apply via `applyDietaryFilter` upstream.
function rankForGoal(
  recipes: RecipeTemplate[],
  profile: UserProfile,
  prefs?: WizardPrefs,
): RecipeTemplate[] {
  const goal = profile.goalType;
  const cookCeiling = prefs?.cookTime === 'quick'
    ? 15
    : prefs?.cookTime === 'moderate'
    ? 30
    : null; // 'full' or null → no penalty

  const wantsEverything = !!prefs?.cuisines.includes(EVERYTHING_KEY);
  const cuisineFilter = wantsEverything ? null : (prefs?.cuisines ?? []).map(c => c.toLowerCase());
  const loves = (prefs?.loves ?? []).map(t => t.toLowerCase());
  const avoid = (prefs?.avoid ?? []).map(t => t.toLowerCase());
  // The macro picks are the primary signal for the AI shortlist, so let them
  // bias the swap catalogue too — otherwise someone who asked for chicken and
  // rice gets an unrelated catalogue the moment they swap a meal.
  const macroPicks = [
    ...(prefs?.proteins ?? []),
    ...(prefs?.carbs ?? []),
    ...(prefs?.fats ?? []),
  ].map(t => t.toLowerCase());

  const scored = recipes.map(r => {
    let score = 0;
    if (goal === 'gain_muscle' || goal === 'lean_bulk') score += r.macros.protein * 1.2;
    if (goal === 'lose_weight') score -= r.calories * 0.5;
    if (goal === 'maintain') score += r.macros.protein * 0.5;

    // Mini-onboarding biases.
    const text = (r.name + ' ' + r.ingredients.map(i => i.name).join(' ')).toLowerCase();

    // Cook-time penalty: scales with how far the recipe overruns the ceiling.
    if (cookCeiling != null && r.cookTimeMin > cookCeiling) {
      score -= (r.cookTimeMin - cookCeiling) * 1.5;
    }

    // Cuisine bias: name match gets a strong boost.
    if (cuisineFilter && cuisineFilter.length > 0) {
      const hit = cuisineFilter.some(c => text.includes(c));
      score += hit ? 25 : -5;
    }

    // Loves: each match adds a sizeable boost.
    loves.forEach(t => { if (text.includes(t)) score += 20; });

    // Macro picks: same idea, slightly softer than an explicit "love".
    macroPicks.forEach(t => { if (text.includes(t)) score += 15; });

    // Avoid: each match penalises heavily but doesn't hard-drop.
    avoid.forEach(t => { if (text.includes(t)) score -= 100; });

    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.r);
}

// A Page is a derived view of the slot's flat meals array. Pages are
// recomputed from `mealsBySlot` on every render rather than maintained
// independently, so the page-fill rules below are a pure function of the
// meal count and never get out of sync.
interface Page {
  cards: RecipeTemplate[];
  isLast: boolean;
}

function buildAutoPage(
  pool: RecipeTemplate[],
  alreadyShownIds: Set<string>,
  limit: number = SUGGEST_BATCH,
): RecipeTemplate[] {
  return pool.filter(r => !alreadyShownIds.has(r.id)).slice(0, limit);
}

// Enable LayoutAnimation on Android (iOS has it on by default). Calling
// more than once is a no-op.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Distribute a flat list of meals into pages.
//
// Rules:
// - Non-last pages contain exactly 5 meal cards (no Suggest more).
// - Last page contains 1–4 meal cards (Suggest more is rendered after
//   the last card by the pick screen, so it doesn't appear here).
// - Edge case: if the meal count is a multiple of 5, splitting into 5s
//   would leave the last page empty. We "demote" one meal from the
//   previous page so the last page has 1 meal + Suggest more.
// - Empty meal list → one empty last page (Suggest more visible alone).
function distributeMealsIntoPages(meals: RecipeTemplate[]): Page[] {
  const total = meals.length;
  if (total === 0) return [{ cards: [], isLast: true }];

  const pages: Page[] = [];
  let i = 0;
  while (total - i > PAGE_SIZE) {
    pages.push({ cards: meals.slice(i, i + PAGE_SIZE), isLast: false });
    i += PAGE_SIZE;
  }
  let remainder = meals.slice(i);
  if (remainder.length === 0 && pages.length > 0) {
    // Demote one meal from the previous full page so the last page has
    // a single meal + Suggest more rather than just Suggest more alone.
    const prev = pages[pages.length - 1];
    const demoted = prev.cards.pop()!;
    remainder = [demoted];
  }
  pages.push({ cards: remainder, isLast: true });
  return pages;
}

// Turn an AI-generated RecipeConcept (no id) into a RecipeTemplate the pick
// flow can render. The `custom-` prefix keeps these out of the catalogue
// lookup (recipeById), matching how Describe-generated cards behaved before.
function conceptToTemplate(concept: RecipeConcept, category: RecipeCategory): RecipeTemplate {
  return {
    id: `custom-${newId()}`,
    name: concept.name,
    category,
    calories: concept.calories,
    cookTimeMin: concept.cookTimeMin,
    macros: concept.macros,
    ingredients: concept.ingredients,
    steps: concept.steps ?? [],
    difficulty: concept.difficulty,
  };
}

function autoPlanName(): string {
  const today = new Date();
  return `My Plan — ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

// Distribute selections across 7 days for active slots.
function buildPreviewDays(
  activeSlots: MealSlot[],
  selections: Record<string, RecipeTemplate[]>,
): PlanDayMeal[][] {
  return Array.from({ length: 7 }, (_, day) => {
    const dayMeals: PlanDayMeal[] = [];
    activeSlots.forEach(slot => {
      const picks = selections[slot.id] ?? [];
      if (picks.length === 0) return;
      const pick = picks[day % picks.length];
      dayMeals.push({
        slotName: slot.name,
        time: slot.time,
        recipeId: pick.id,
        recipeName: pick.name,
      });
    });
    // Sort by time so the day reads top-to-bottom in chronological order.
    dayMeals.sort((a, b) => a.time.localeCompare(b.time));
    return dayMeals;
  });
}

// ─── Step model ──────────────────────────────────────────────────────────────

type Mode =
  | { kind: 'normal' }
  | { kind: 'preview-swap'; dayIdx: number; mealIdx: number };

type Step =
  | { kind: 'macroPicker'; group: MacroGroup }
  | { kind: 'secondaryPrefs'; questionIdx: 0 | 1 | 2 | 3 }
  | { kind: 'guide' }
  | { kind: 'shortlist' }
  | { kind: 'pick'; slotIdx: number }
  | { kind: 'preview' };

// ─── Preferences ─────────────────────────────────────────────────────────────
// Gathered fresh every Build My Plan run (re-shown on Regenerate). Answers live
// only in component state — never persisted to profile (people's mood changes
// day to day). The protein/carb/fat picks are the PRIMARY personalisation
// signal for the AI shortlist; cuisines/cookTime/loves are light secondary
// flavour cues and avoid is a hard constraint (all optional).

type CookTime = 'quick' | 'moderate' | 'full';

interface WizardPrefs {
  proteins: string[];          // primary signal — preferred protein sources
  carbs: string[];             // primary signal — preferred carb sources
  fats: string[];              // primary signal — preferred fat sources
  cuisines: string[];          // multi-select; "Everything" is mutually exclusive
  cookTime: CookTime | null;   // single select
  loves: string[];             // chips + free text combined
  avoid: string[];             // chips + free text combined
}

// The three primary-signal groups, so the picker UI can be driven by one
// generic handler instead of three near-identical copies.
type MacroGroup = 'proteins' | 'carbs' | 'fats';
const MACRO_GROUPS: MacroGroup[] = ['proteins', 'carbs', 'fats'];

// Protein/carb/fat picker options now come from Supabase (macro_proteins /
// macro_carbs / macro_fats), seeded from USDA FoodData Central and editable in
// the Table Editor — see lib/macroFoodOptions.ts and scripts/import-macro-foods.ts.
// The old hardcoded PROTEIN_OPTIONS/CARB_OPTIONS/FAT_OPTIONS arrays were removed.

const CUISINE_OPTIONS: string[] = [
  'Nigerian',
  'Mediterranean',
  'Asian',
  'American',
  'Mexican',
  'Indian',
  'Italian',
  'Mixed or Everything',
];
const EVERYTHING_KEY = 'Mixed or Everything';

const LOVE_SUGGESTIONS = ['Chicken', 'Rice', 'Eggs', 'Pasta', 'Salmon', 'Beef', 'Potatoes', 'Tofu'];

// Secondary preference questions (cuisines, cook time, loves, avoid). Optional
// depth after the primary protein/carb/fat picker.
const SECONDARY_TOTAL = 4;

// Extra options appended per "Generate more" tap for a single meal type. The
// initial shortlist uses the server-side defaults (mains 4, snacks 2).
const GENERATE_MORE_COUNT = 3;

// Gentle-nudge threshold for swaps: within ±15% of the daily calorie target is
// fine; beyond it we show a soft, non-blocking heads-up (never a block).
const SWAP_NUDGE_THRESHOLD = 0.15;

const EMPTY_PREFS: WizardPrefs = {
  proteins: [],
  carbs: [],
  fats: [],
  cuisines: [],
  cookTime: null,
  loves: [],
  avoid: [],
};

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function BuildPlanScreen() {
  const profile = useMealStore(s => s.profile);
  const recipes = useMealStore(s => s.recipes);
  const templates = useMealStore(s => s.templates);
  const activatePlan = useMealStore(s => s.activatePlan);
  const saveCurrentPlanAs = useMealStore(s => s.saveCurrentPlanAs);
  const ensureRecipeSaved = useMealStore(s => s.ensureRecipeSaved);
  const goals = useMealStore(s => s.goals);
  const planAvoidFoods = useMealStore(s => s.planAvoidFoods);
  const setPlanAvoidFoods = useMealStore(s => s.setPlanAvoidFoods);
  const showToast = useToastStore(s => s.showToast);
  const isPro = useEntitlementStore(s => s.isPro);
  const insets = useSafeAreaInsets();
  const footerBottomPad = Math.max(insets.bottom, 16) + 16;

  // Active slots: only those not skipped, sorted by time so the wizard walks
  // them in the canonical order Breakfast → Mid-morning → Lunch → ... → Dinner.
  const activeSlots = useMemo<MealSlot[]>(
    () => profile.mealSlots.filter(s => !s.skipped).sort((a, b) => a.time.localeCompare(b.time)),
    [profile.mealSlots],
  );

  // Distinct meal types across the active slots, in slot (time) order. The AI
  // shortlist is generated per meal type; when several slots share a type
  // (e.g. two snack slots) they draw from the same type's picks.
  const activeCategories = useMemo<RecipeCategory[]>(() => {
    const seen = new Set<RecipeCategory>();
    const out: RecipeCategory[] = [];
    activeSlots.forEach(s => {
      const c = categoryForSlot(s.name);
      if (!seen.has(c)) { seen.add(c); out.push(c); }
    });
    return out;
  }, [activeSlots]);

  const dietaryFiltered = useMemo(() => applyDietaryFilter(recipes, profile), [recipes, profile]);

  // Catalogue lookup by id, for resolving nutrition in swap-time handlers where
  // the render-scoped recipeById map isn't in scope yet.
  const recipesById = useMemo(() => {
    const m = new Map<string, RecipeTemplate>();
    recipes.forEach(r => m.set(r.id, r));
    return m;
  }, [recipes]);

  // ── Wizard state ────────────────────────────────────────────────────────
  // Flow: macroPicker (required) → secondaryPrefs (optional, skippable) →
  // guide (review) → AI shortlist call → shortlist (pick favourites) →
  // preview (7-day schedule + swaps) → activate. The guide doubles as the
  // confirm gate before the one AI call, so a scan is never spent until the
  // user has seen exactly what it will be based on.
  const [step, setStep] = useState<Step>({ kind: 'macroPicker', group: 'proteins' });
  const [mode, setMode] = useState<Mode>({ kind: 'normal' });
  // Preference answers, gathered fresh each run. The protein/carb/fat picks
  // drive the AI shortlist; cuisines/cookTime/loves/avoid feed it too and also
  // bias the swap catalogue via `byCategory`/`rankForGoal`.
  const [prefs, setPrefs] = useState<WizardPrefs>(EMPTY_PREFS);

  // Seed the avoid list from the persisted store on mount so returning users
  // don't have to re-type items like "shellfish" every session.
  const avoidSeeded = useRef(false);
  useEffect(() => {
    if (!avoidSeeded.current && planAvoidFoods.length > 0) {
      avoidSeeded.current = true;
      setPrefs(p => ({ ...p, avoid: planAvoidFoods }));
    }
  }, [planAvoidFoods]);

  // Persist changes to the avoid list back to the store whenever they change,
  // so they survive across sessions without explicit "save" buttons.
  useEffect(() => {
    setPlanAvoidFoods(prefs.avoid);
  }, [prefs.avoid, setPlanAvoidFoods]);

  // Free-text input boxes for the macro picker + love/avoid questions.
  const [proteinInput, setProteinInput] = useState('');
  const [carbInput, setCarbInput] = useState('');
  const [fatInput, setFatInput] = useState('');
  const [loveInput, setLoveInput] = useState('');
  const [avoidInput, setAvoidInput] = useState('');

  // Macro picker options, loaded once from Supabase (see lib/macroFoodOptions).
  // null while loading; `macroOptionsError` flips true if the fetch fails, in
  // which case the picker falls back to the free-text "add your own" box.
  const [macroOptions, setMacroOptions] = useState<Record<MacroGroup, string[]> | null>(null);
  const [macroOptionsError, setMacroOptionsError] = useState(false);
  const [macroReloadKey, setMacroReloadKey] = useState(0);
  // Search text for filtering the current macro group's checklist. Reset when
  // moving between groups so each screen starts unfiltered.
  const [macroSearch, setMacroSearch] = useState('');
  // Combined all-food list for the avoid picker (proteins+carbs+fats merged,
  // sorted by familiarity). Loaded in parallel with macroOptions.
  const [allFoodOptions, setAllFoodOptions] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMacroOptions(null);
    setMacroOptionsError(false);
    setAllFoodOptions(null);
    fetchMacroFoodOptions()
      .then(opts => { if (!cancelled) setMacroOptions(opts); })
      .catch(() => { if (!cancelled) setMacroOptionsError(true); });
    fetchAllFoodOptionsCombined()
      .then(all => { if (!cancelled) setAllFoodOptions(all); })
      .catch(() => { /* avoid list gracefully degrades to custom-only */ });
    return () => { cancelled = true; };
  }, [macroReloadKey]);

  // AI shortlist state (redesigned flow). `shortlistByType` holds the options
  // returned by generate-plan-shortlist per meal type; `selectedByType` holds
  // the user's picked favourites per meal type (in pick order). Both are keyed
  // by RecipeCategory since the AI generates per meal type, not per slot.
  const [shortlistByType, setShortlistByType] = useState<Partial<Record<RecipeCategory, RecipeTemplate[]>>>({});
  const [selectedByType, setSelectedByType] = useState<Partial<Record<RecipeCategory, RecipeTemplate[]>>>({});
  // In-flight flags: whole-shortlist generation (initial / Regenerate) and the
  // per-type "Generate more" top-up.
  const [shortlistLoading, setShortlistLoading] = useState(false);
  const [generateMoreLoadingByType, setGenerateMoreLoadingByType] = useState<Partial<Record<RecipeCategory, boolean>>>({});

  // Re-bucket recipes by category whenever profile, recipe pool, or wizard
  // prefs change. Pages already built for a slot keep their cards (we only
  // re-rank the pool used to seed *future* pages and Suggest more batches),
  // so changing prefs mid-flow doesn't yank cards out from under the user.
  const byCategory = useMemo<Record<RecipeCategory, RecipeTemplate[]>>(() => {
    const map: Record<RecipeCategory, RecipeTemplate[]> = {
      Breakfast: [], Lunch: [], Dinner: [], Snacks: [],
    };
    rankForGoal(dietaryFiltered, profile, prefs).forEach(r => { map[r.category].push(r); });
    return map;
  }, [dietaryFiltered, profile, prefs]);
  // Describe popup state — opened from the bottom button on each pick page.
  const [describeModalVisible, setDescribeModalVisible] = useState(false);
  const [describeModalText, setDescribeModalText] = useState('');
  // In-flight flag for the Describe AI call (keeps the modal open + disables
  // the Generate button while we wait).
  const [describeLoading, setDescribeLoading] = useState(false);
  // Per-slot in-flight flag for the Suggest-more AI top-up (only set on the
  // catalog-exhaustion path, so normal Suggest more stays instant).
  const [suggestMoreLoadingBySlot, setSuggestMoreLoadingBySlot] = useState<Record<string, boolean>>({});
  // Preview "Meals in this plan" collapse state.
  const [previewMealsExpanded, setPreviewMealsExpanded] = useState(false);
  // Per-slot: a flat array of meal cards. Keyed by slot.id so it survives
  // even if active slots are recomputed (e.g. user toggles a slot mid-
  // session). Pages are derived from this list on every render via
  // `distributeMealsIntoPages`.
  const [mealsBySlot, setMealsBySlot] = useState<Record<string, RecipeTemplate[]>>({});
  // Per-slot selected recipes preserved in user-pick order.
  const [selectionsBySlot, setSelectionsBySlot] = useState<Record<string, RecipeTemplate[]>>({});
  // Lookup of every card generated/selected this session (both catalogue and
  // AI/Describe cards), keyed by id. Used to resolve real nutrition for custom
  // (`custom-`) cards in the preview totals and to persist them on activate,
  // since PlanDayMeal only carries recipeId/recipeName, not nutrition.
  const sessionCardById = useMemo<Map<string, RecipeTemplate>>(() => {
    const map = new Map<string, RecipeTemplate>();
    Object.values(mealsBySlot).forEach(list => list.forEach(r => map.set(r.id, r)));
    Object.values(selectionsBySlot).forEach(list => list.forEach(r => map.set(r.id, r)));
    // Include every AI shortlist card (shown or picked) so their real nutrition
    // resolves in the preview totals and persists correctly on activation.
    Object.values(shortlistByType).forEach(list => list?.forEach(r => map.set(r.id, r)));
    Object.values(selectedByType).forEach(list => list?.forEach(r => map.set(r.id, r)));
    return map;
  }, [mealsBySlot, selectionsBySlot, shortlistByType, selectedByType]);
  // Per-slot active page index in the horizontal pager.
  const [pageIdxBySlot, setPageIdxBySlot] = useState<Record<string, number>>({});
  // Per-slot Suggest more click count. Used purely to trigger the
  // "Try Describe" popup once at SUGGEST_POPUP_AT — Suggest more itself
  // never disappears.
  const [suggestClicksBySlot, setSuggestClicksBySlot] = useState<Record<string, number>>({});
  // Tracks whether the popup has already shown at least once for a slot
  // so we don't pester the user every additional 5 clicks.
  const [suggestPopupShownBySlot, setSuggestPopupShownBySlot] = useState<Record<string, boolean>>({});
  // The popup's visibility (per-slot popup, only one slot active at a time).
  const [suggestPopupVisible, setSuggestPopupVisible] = useState(false);
  // Preview state
  const [previewDays, setPreviewDays] = useState<PlanDayMeal[][]>([]);
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set([0]));
  const [quickSwap, setQuickSwap] = useState<{ dayIdx: number; mealIdx: number } | null>(null);

  // Pager geometry
  const [pageWidth, setPageWidth] = useState(0);
  const pagerRef = useRef<ScrollView | null>(null);

  // ── Initialisation: seed INITIAL_SEED meals for the current pick slot ──
  useEffect(() => {
    if (step.kind !== 'pick') return;
    const slot = activeSlots[step.slotIdx];
    if (!slot) return;
    if (mealsBySlot[slot.id]) return;
    const pool = byCategory[categoryForSlot(slot.name)] ?? [];
    const seed = buildAutoPage(pool, new Set(), INITIAL_SEED);
    setMealsBySlot(prev => ({ ...prev, [slot.id]: seed }));
    setPageIdxBySlot(prev => ({ ...prev, [slot.id]: prev[slot.id] ?? 0 }));
  }, [step, activeSlots, byCategory, mealsBySlot]);

  // Whenever pages grow OR the user switches slots, scroll the pager to the
  // current page index. Done on next frame so layout settles first.
  useEffect(() => {
    if (step.kind !== 'pick' || pageWidth === 0) return;
    const slot = activeSlots[step.slotIdx];
    if (!slot) return;
    const idx = pageIdxBySlot[slot.id] ?? 0;
    requestAnimationFrame(() => {
      pagerRef.current?.scrollTo({ x: idx * pageWidth, animated: true });
    });
  }, [step, activeSlots, pageWidth, pageIdxBySlot]);

  // ── All-slots-skipped guard ─────────────────────────────────────────────
  // Checked before any wizard screen so the user can't fill in preferences
  // only to find there's nothing to plan for.
  if (activeSlots.length === 0) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Header title="Build My Plan" onBack={() => router.back()} />
        <View style={styles.guardWrap}>
          <Text style={styles.guardEmoji}>🍽️</Text>
          <Text style={styles.guardTitle}>You&apos;ve skipped all meal slots</Text>
          <Text style={styles.guardBody}>
            Enable at least one slot in Personal Details to continue building a plan.
          </Text>
          <TouchableOpacity
            style={styles.guardCta}
            onPress={() => router.replace('/profile/personal-details')}
          >
            <Text style={styles.guardCtaText}>Open Personal Details</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.guardSecondary} onPress={() => router.back()}>
            <Text style={styles.guardSecondaryText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  // ── Shortlist generation loading screen ─────────────────────────────────
  // Covers both the initial build and a Regenerate re-run. A full screen (not
  // just a button spinner) because the call can take 10-20s and the user has
  // nothing else to do on the review page while it runs.
  if (shortlistLoading) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Header title="Building your shortlist" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.green} />
          <Text style={styles.loadingText}>Putting together your options…</Text>
          <Text style={styles.loadingSub}>
            We&apos;re building ideas for {activeCategories.length}{' '}
            meal {activeCategories.length === 1 ? 'type' : 'types'} around the foods you picked.
            This usually takes a few seconds.
          </Text>
        </View>
      </Screen>
    );
  }

  // ── Guide preview (review step) ─────────────────────────────────────────
  // Sits *after* the preference steps so the user can review both their fresh
  // answers and their saved profile before we spend an AI call. Read-only —
  // to change an answer, the user goes back.
  if (step.kind === 'guide') {
    const dietary = profile.dietaryRestrictions ?? [];
    const allergies = profile.allergies ?? [];
    const slotCount = activeSlots.length;
    const cookTimeLabel = prefs.cookTime === 'quick'
      ? 'Quick · under 15 min'
      : prefs.cookTime === 'moderate'
      ? 'Moderate · 15–30 min'
      : prefs.cookTime === 'full'
      ? 'Full cooking · 30+ min'
      : null;

    return (
      <Screen edges={['top', 'bottom']}>
        <Header
          title="Review"
          onBack={() => setStep({ kind: 'secondaryPrefs', questionIdx: 3 })}
        />

        <ScrollView contentContainerStyle={styles.guideBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.guideHero}>Looking good</Text>
          <Text style={styles.guideHeroSub}>
            Here&apos;s what we&apos;ll use to suggest meals{profile.firstName ? `, ${profile.firstName}` : ''}.
          </Text>

          {/* Profile section */}
          <View style={styles.guideCard}>
            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Goal</Text>
              <View style={styles.guidePill}>
                <Text style={styles.guidePillText}>{goalTypeLabel(profile.goalType)}</Text>
              </View>
            </View>

            <View style={styles.guideDivider} />

            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Diet</Text>
              <View style={styles.guidePillGroup}>
                {dietary.length === 0 ? (
                  <Text style={styles.guideMuted}>No restrictions</Text>
                ) : (
                  dietary.map(d => (
                    <View key={d} style={styles.guidePill}><Text style={styles.guidePillText}>{d}</Text></View>
                  ))
                )}
              </View>
            </View>

            <View style={styles.guideDivider} />

            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Allergies</Text>
              <View style={styles.guidePillGroup}>
                {allergies.length === 0 ? (
                  <Text style={styles.guideMuted}>None</Text>
                ) : (
                  allergies.map(a => (
                    <View key={a} style={[styles.guidePill, styles.guidePillWarn]}>
                      <Text style={[styles.guidePillText, styles.guidePillTextWarn]}>{a}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>

          {/* Primary signal — the protein/carb/fat picks that drive the shortlist. */}
          <View style={styles.guideCard}>
            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Proteins</Text>
              <View style={styles.guidePillGroup}>
                {prefs.proteins.length === 0 ? (
                  <Text style={styles.guideMuted}>Any</Text>
                ) : (
                  prefs.proteins.map(p => (
                    <View key={p} style={styles.guidePill}><Text style={styles.guidePillText}>{p}</Text></View>
                  ))
                )}
              </View>
            </View>

            <View style={styles.guideDivider} />

            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Carbs</Text>
              <View style={styles.guidePillGroup}>
                {prefs.carbs.length === 0 ? (
                  <Text style={styles.guideMuted}>Any</Text>
                ) : (
                  prefs.carbs.map(c => (
                    <View key={c} style={styles.guidePill}><Text style={styles.guidePillText}>{c}</Text></View>
                  ))
                )}
              </View>
            </View>

            <View style={styles.guideDivider} />

            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Fats</Text>
              <View style={styles.guidePillGroup}>
                {prefs.fats.length === 0 ? (
                  <Text style={styles.guideMuted}>Any</Text>
                ) : (
                  prefs.fats.map(f => (
                    <View key={f} style={styles.guidePill}><Text style={styles.guidePillText}>{f}</Text></View>
                  ))
                )}
              </View>
            </View>
          </View>

          {/* Secondary preferences — fresh-this-session, all optional */}
          <View style={styles.guideCard}>
            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Cuisines</Text>
              <View style={styles.guidePillGroup}>
                {prefs.cuisines.length === 0 ? (
                  <Text style={styles.guideMuted}>Anything</Text>
                ) : (
                  prefs.cuisines.map(c => (
                    <View key={c} style={styles.guidePill}><Text style={styles.guidePillText}>{c}</Text></View>
                  ))
                )}
              </View>
            </View>

            <View style={styles.guideDivider} />

            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Cook time</Text>
              <View style={styles.guidePillGroup}>
                {cookTimeLabel ? (
                  <View style={styles.guidePill}><Text style={styles.guidePillText}>{cookTimeLabel}</Text></View>
                ) : (
                  <Text style={styles.guideMuted}>No preference</Text>
                )}
              </View>
            </View>

            <View style={styles.guideDivider} />

            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Loves</Text>
              <View style={styles.guidePillGroup}>
                {prefs.loves.length === 0 ? (
                  <Text style={styles.guideMuted}>None</Text>
                ) : (
                  prefs.loves.map(l => (
                    <View key={l} style={styles.guidePill}><Text style={styles.guidePillText}>{l}</Text></View>
                  ))
                )}
              </View>
            </View>

            <View style={styles.guideDivider} />

            <View style={styles.guideRow}>
              <Text style={styles.guideRowLabel}>Avoid</Text>
              <View style={styles.guidePillGroup}>
                {prefs.avoid.length === 0 ? (
                  <Text style={styles.guideMuted}>None</Text>
                ) : (
                  prefs.avoid.map(a => (
                    <View key={a} style={[styles.guidePill, styles.guidePillWarn]}>
                      <Text style={[styles.guidePillText, styles.guidePillTextWarn]}>{a}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>

          <Text style={styles.guideHint}>
            Want to change something? Tap back to revisit the questions.
          </Text>

          <View style={styles.guideStepsCard}>
            <Text style={styles.guideStepsTitle}>What&apos;s next</Text>
            <View style={styles.guideStepRow}>
              <View style={styles.guideStepBullet}><Text style={styles.guideStepBulletText}>1</Text></View>
              <Text style={styles.guideStepText}>
                We&apos;ll build a shortlist of ideas for each of your {slotCount} meal{' '}
                {slotCount === 1 ? 'type' : 'types'}.
              </Text>
            </View>
            <View style={styles.guideStepRow}>
              <View style={styles.guideStepBullet}><Text style={styles.guideStepBulletText}>2</Text></View>
              <Text style={styles.guideStepText}>
                Pick your favourites — ask for more options any time.
              </Text>
            </View>
            <View style={styles.guideStepRow}>
              <View style={styles.guideStepBullet}><Text style={styles.guideStepBulletText}>3</Text></View>
              <Text style={styles.guideStepText}>
                We&apos;ll rotate them through the week into a balanced plan you can still swap.
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
          <TouchableOpacity
            style={[styles.primaryBtn, styles.guideCta, shortlistLoading && styles.disabledBtn]}
            onPress={() => runShortlistGeneration()}
            disabled={shortlistLoading}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>
              {shortlistLoading ? 'Building…' : 'Build my shortlist'}
            </Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  // ── Render: MACRO PICKER (primary, required) ────────────────────────────
  // The protein/carb/fat picks are the dominant personalisation signal for the
  // AI shortlist, so this is the one step the user can't skip. Options are a
  // searchable checklist loaded from Supabase (USDA-sourced); the de-emphasised
  // free-text box below covers anything genuinely missing.
  if (step.kind === 'macroPicker') {
    // One group per screen (Proteins → Carbs → Fats), matching the app's
    // one-question-per-screen pattern. Metadata is keyed by group so the same
    // render handles all three.
    const MACRO_META: Record<
      MacroGroup,
      { title: string; question: string; value: string; setValue: (v: string) => void; placeholder: string }
    > = {
      proteins: {
        title: 'Proteins',
        question: 'What proteins do you like?',
        value: proteinInput,
        setValue: setProteinInput,
        placeholder: 'e.g. lamb, cottage cheese',
      },
      carbs: {
        title: 'Carbs',
        question: 'What carbs do you like?',
        value: carbInput,
        setValue: setCarbInput,
        placeholder: 'e.g. plantain, barley',
      },
      fats: {
        title: 'Fats',
        question: 'What fats do you like?',
        value: fatInput,
        setValue: setFatInput,
        placeholder: 'e.g. tahini, sesame oil',
      },
    };

    const group = step.group;
    const g = MACRO_META[group];
    const groupIdx = MACRO_GROUPS.indexOf(group);
    const isFirst = groupIdx === 0;
    const isLastGroup = groupIdx === MACRO_GROUPS.length - 1;
    // Per-screen gate: each group needs at least one pick before advancing, so
    // the AI shortlist always has a protein, a carb, and a fat to build around.
    const groupHasPick = prefs[group].length > 0;

    const options = macroOptions?.[group] ?? [];
    // Free-text picks that aren't in the loaded checklist — shown as their own
    // removable rows so they don't get lost when the list is filtered/scrolled.
    const customTokens = prefs[group].filter(
      t => !options.some(o => o.toLowerCase() === t.toLowerCase()),
    );
    const query = macroSearch.trim().toLowerCase();
    // `options` arrives already ordered by familiarity (see fetchMacroFoodOptions).
    // While searching, keep substring matches anywhere in the name but float the
    // ones that *start with* the query above ones that merely *contain* it — a
    // stable sort preserves familiarity order within each bucket, so e.g. "beef"
    // surfaces "Beef" before "Ground Beef", both near the top.
    const filteredOptions = query
      ? options
          .filter(o => o.toLowerCase().includes(query))
          .sort(
            (a, b) =>
              Number(!a.toLowerCase().startsWith(query)) -
              Number(!b.toLowerCase().startsWith(query)),
          )
      : options;

    const goBack = () => {
      setMacroSearch('');
      if (isFirst) router.back();
      else setStep({ kind: 'macroPicker', group: MACRO_GROUPS[groupIdx - 1] });
    };
    const goNext = () => {
      setMacroSearch('');
      if (isLastGroup) setStep({ kind: 'secondaryPrefs', questionIdx: 0 });
      else setStep({ kind: 'macroPicker', group: MACRO_GROUPS[groupIdx + 1] });
    };

    const renderChecklistRow = (opt: string, idx: number, checked: boolean) => (
      <TouchableOpacity
        key={opt}
        style={[styles.macroPickRow, idx > 0 && styles.macroPickRowDivider]}
        onPress={() => toggleMacroOption(group, opt)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={checked ? COLORS.green : COLORS.textMuted}
        />
        <Text style={[styles.macroPickRowName, !checked && styles.macroPickRowNameOff]}>{opt}</Text>
      </TouchableOpacity>
    );

    return (
      <Screen edges={['top', 'bottom']}>
        <StepProgressBar
          step={1}
          total={2}
          label={`Your foods · ${g.title} (${groupIdx + 1} of ${MACRO_GROUPS.length})`}
        />
        <Header title={g.question} onBack={goBack} />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {macroOptions === null && !macroOptionsError ? (
            <View style={styles.macroLoading}>
              <ActivityIndicator size="large" color={COLORS.green} />
              <Text style={styles.macroLoadingText}>Loading foods…</Text>
            </View>
          ) : (
            <>
              <Text style={[styles.onbHint, styles.macroHint]}>
                We&apos;ll build most of your meal ideas around these. Pick as many or as
                few as you like — or add your own below.
              </Text>

              {/* Search bar (hidden if the list failed to load — free-text is
                  the fallback in that case). */}
              {!macroOptionsError && (
                <View style={styles.macroSearchWrap}>
                  <Ionicons name="search" size={18} color={COLORS.textMuted} />
                  <TextInput
                    style={styles.macroSearchInput}
                    value={macroSearch}
                    onChangeText={setMacroSearch}
                    placeholder={`Search ${g.title.toLowerCase()}`}
                    placeholderTextColor={COLORS.textMuted}
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                  {macroSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setMacroSearch('')} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.macroListBody}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {macroOptionsError ? (
                  <View style={styles.macroError}>
                    <Text style={styles.macroErrorText}>
                      Couldn&apos;t load the food list. You can still add your own below, or retry.
                    </Text>
                    <TouchableOpacity
                      style={styles.macroRetryBtn}
                      onPress={() => setMacroReloadKey(k => k + 1)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.macroRetryText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    {/* Selected free-text additions first, so they're always
                        visible regardless of the current search filter. */}
                    {customTokens.map((t, i) => renderChecklistRow(t, i, true))}
                    {filteredOptions.map((opt, i) =>
                      renderChecklistRow(opt, customTokens.length + i, prefs[group].some(x => x.toLowerCase() === opt.toLowerCase())),
                    )}
                    {filteredOptions.length === 0 && customTokens.length === 0 && (
                      <Text style={styles.macroEmpty}>
                        {query ? 'No matches — add it as your own below.' : 'No options available.'}
                      </Text>
                    )}
                  </>
                )}

                {/* De-emphasised free-text fallback for genuine gaps. */}
                <View style={styles.macroFallback}>
                  <Text style={styles.macroFallbackLabel}>Don&apos;t see it? Add your own</Text>
                  <View style={styles.tokenInputRow}>
                    <TextInput
                      style={styles.tokenInput}
                      value={g.value}
                      onChangeText={g.setValue}
                      placeholder={g.placeholder}
                      placeholderTextColor={COLORS.textMuted}
                      onSubmitEditing={() => { addMacroToken(group, g.value); g.setValue(''); }}
                      returnKeyType="done"
                    />
                    <TouchableOpacity
                      style={[styles.tokenAddBtn, !g.value.trim() && styles.disabledBtn]}
                      disabled={!g.value.trim()}
                      onPress={() => { addMacroToken(group, g.value); g.setValue(''); }}
                    >
                      <Text style={styles.tokenAddBtnText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
            </>
          )}

          <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.guideCta, !groupHasPick && styles.disabledBtn]}
              disabled={!groupHasPick}
              onPress={goNext}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>
                {groupHasPick
                  ? 'Next'
                  : `Pick at least one ${g.title.toLowerCase().replace(/s$/, '')}`}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ── Render: SECONDARY PREFS (optional depth, skippable) ─────────────────
  // The four questions carried over from the old wizard. Skippable as a whole:
  // cuisines/loves are light style cues and cook time is a soft preference, so
  // none of them are needed for a good shortlist — but avoid is a hard
  // constraint, which is why it's still offered here rather than dropped.
  if (step.kind === 'secondaryPrefs') {
    const qIdx = step.questionIdx;
    const isLast = qIdx === SECONDARY_TOTAL - 1;

    const goNext = () => {
      if (isLast) {
        // After the last question, route to the guide review page so the user
        // sees every answer before we spend an AI call.
        setStep({ kind: 'guide' });
      } else {
        setStep({ kind: 'secondaryPrefs', questionIdx: (qIdx + 1) as 0 | 1 | 2 | 3 });
      }
    };
    const goBack = () => {
      // Q1 back returns to the last macro picker screen (Fats); later questions
      // step back.
      if (qIdx === 0) setStep({ kind: 'macroPicker', group: 'fats' });
      else setStep({ kind: 'secondaryPrefs', questionIdx: (qIdx - 1) as 0 | 1 | 2 | 3 });
    };
    const skipAll = () => setStep({ kind: 'guide' });

    // Q1 helpers — "Mixed or Everything" is mutually exclusive with picks.
    const toggleCuisine = (c: string) => {
      setPrefs(p => {
        if (c === EVERYTHING_KEY) {
          return { ...p, cuisines: p.cuisines.includes(EVERYTHING_KEY) ? [] : [EVERYTHING_KEY] };
        }
        const without = p.cuisines.filter(x => x !== EVERYTHING_KEY);
        const has = without.includes(c);
        return { ...p, cuisines: has ? without.filter(x => x !== c) : [...without, c] };
      });
    };

    // Q3 / Q4 helpers
    const addLoveToken = (raw: string) => {
      const v = raw.trim();
      if (!v) return;
      if (prefs.avoid.some(a => a.toLowerCase() === v.toLowerCase())) {
        Alert.alert(
          `${v} is in foods to avoid`,
          'A food can only be loved or avoided. Pick one.',
        );
        return;
      }
      setPrefs(p => p.loves.some(l => l.toLowerCase() === v.toLowerCase()) ? p : { ...p, loves: [...p.loves, v] });
    };
    const removeLoveToken = (token: string) =>
      setPrefs(p => ({ ...p, loves: p.loves.filter(t => t !== token) }));
    const addAvoidToken = (raw: string) => {
      const v = raw.trim();
      if (!v) return;
      if (prefs.loves.some(a => a.toLowerCase() === v.toLowerCase())) {
        Alert.alert(
          `${v} is in foods you love`,
          'A food can only be loved or avoided. Pick one.',
        );
        return;
      }
      // Avoid is a hard constraint, so it can't contradict a primary pick —
      // otherwise the prompt would tell the model to both build around a food
      // and never use it.
      const macroGroup = MACRO_GROUPS.find(g =>
        prefs[g].some(x => x.toLowerCase() === v.toLowerCase()),
      );
      if (macroGroup) {
        Alert.alert(
          `${v} is one of your picked foods`,
          'Remove it from your foods first if you\u2019d rather avoid it.',
        );
        return;
      }
      setPrefs(p => p.avoid.some(l => l.toLowerCase() === v.toLowerCase()) ? p : { ...p, avoid: [...p.avoid, v] });
    };
    const removeAvoidToken = (token: string) =>
      setPrefs(p => ({ ...p, avoid: p.avoid.filter(t => t !== token) }));

    return (
      <Screen edges={['top', 'bottom']}>
        <StepProgressBar
          step={2}
          total={2}
          label={`Extra preferences · ${qIdx + 1} of ${SECONDARY_TOTAL}`}
        />
        <Header
          title="Optional — a few extras"
          onBack={goBack}
          rightAction={
            <TouchableOpacity onPress={skipAll} hitSlop={10}>
              <Text style={styles.headerRightMutedText}>Skip</Text>
            </TouchableOpacity>
          }
        />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.onbBody}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {qIdx === 0 && (
              <>
                <Text style={styles.onbQuestion}>What cuisines do you enjoy?</Text>
                <Text style={styles.onbHint}>Pick any that sound good. We&apos;ll bias suggestions toward them.</Text>
                <View style={styles.chipGrid}>
                  {CUISINE_OPTIONS.map(c => {
                    const active = prefs.cuisines.includes(c);
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => toggleCuisine(c)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {qIdx === 1 && (
              <>
                <Text style={styles.onbQuestion}>How much time do you have to cook?</Text>
                <Text style={styles.onbHint}>This biases suggestions toward recipes that fit your time budget.</Text>
                <View style={styles.radioGroup}>
                  {([
                    { key: 'quick' as const,    label: 'Quick',         meta: 'Under 15 minutes' },
                    { key: 'moderate' as const, label: 'Moderate',      meta: '15 to 30 minutes' },
                    { key: 'full' as const,     label: 'Full cooking',  meta: '30 minutes or more' },
                  ]).map(opt => {
                    const active = prefs.cookTime === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.radioRow, active && styles.radioRowActive]}
                        onPress={() => setPrefs(p => ({ ...p, cookTime: opt.key }))}
                        activeOpacity={0.85}
                      >
                        <View style={[styles.radioDot, active && styles.radioDotActive]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.radioLabel}>{opt.label}</Text>
                          <Text style={styles.radioMeta}>{opt.meta}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {qIdx === 2 && (
              <>
                <Text style={styles.onbQuestion}>Any foods you love?</Text>
                <Text style={styles.onbHint}>
                  Type or use your keyboard&apos;s mic. Tap suggestions to add them.
                </Text>
                <View style={styles.tokenInputRow}>
                  <TextInput
                    style={styles.tokenInput}
                    value={loveInput}
                    onChangeText={setLoveInput}
                    placeholder="e.g. salmon, mango, oats"
                    placeholderTextColor={COLORS.textMuted}
                    onSubmitEditing={() => { addLoveToken(loveInput); setLoveInput(''); }}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={[styles.tokenAddBtn, !loveInput.trim() && styles.disabledBtn]}
                    disabled={!loveInput.trim()}
                    onPress={() => { addLoveToken(loveInput); setLoveInput(''); }}
                  >
                    <Text style={styles.tokenAddBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.chipGrid}>
                  {LOVE_SUGGESTIONS.map(s => {
                    const active = prefs.loves.some(l => l.toLowerCase() === s.toLowerCase());
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => active ? removeLoveToken(prefs.loves.find(l => l.toLowerCase() === s.toLowerCase())!) : addLoveToken(s)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {prefs.loves.length > 0 && (
                  <View style={styles.tokenList}>
                    <Text style={styles.tokenListLabel}>Added</Text>
                    <View style={styles.chipGrid}>
                      {prefs.loves.map(t => (
                        <TouchableOpacity
                          key={t}
                          style={[styles.chip, styles.chipActive]}
                          onPress={() => removeLoveToken(t)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.chipText, styles.chipTextActive]}>{t}  ✕</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}

            {qIdx === 3 && (() => {
              const avoidQuery = avoidInput.trim().toLowerCase();
              const avoidPool = allFoodOptions ?? [];
              const filteredAvoid = avoidQuery
                ? avoidPool
                    .filter(o => o.toLowerCase().includes(avoidQuery))
                    .sort(
                      (a, b) =>
                        Number(!a.toLowerCase().startsWith(avoidQuery)) -
                        Number(!b.toLowerCase().startsWith(avoidQuery)),
                    )
                : avoidPool;
              const customAvoidTokens = prefs.avoid.filter(
                t => !avoidPool.some(o => o.toLowerCase() === t.toLowerCase()),
              );
              const queryExactMatch = avoidQuery && avoidPool.some(
                o => o.toLowerCase() === avoidQuery,
              );
              const queryAlreadyAdded = avoidQuery && prefs.avoid.some(
                a => a.toLowerCase() === avoidQuery,
              );
              const showAddCustom = avoidQuery && !queryExactMatch && !queryAlreadyAdded;

              const toggleAvoid = (item: string) => {
                if (prefs.avoid.some(a => a.toLowerCase() === item.toLowerCase())) {
                  removeAvoidToken(prefs.avoid.find(a => a.toLowerCase() === item.toLowerCase())!);
                } else {
                  addAvoidToken(item);
                }
              };

              return (
                <>
                  <Text style={styles.onbQuestion}>Any foods to avoid?</Text>
                  <Text style={styles.onbHint}>
                    This is for foods you don&apos;t enjoy — your allergies are already saved in your profile.
                  </Text>

                  <View style={styles.macroSearchWrap}>
                    <Ionicons name="search" size={18} color={COLORS.textMuted} />
                    <TextInput
                      style={styles.macroSearchInput}
                      value={avoidInput}
                      onChangeText={setAvoidInput}
                      placeholder="Search foods or type your own"
                      placeholderTextColor={COLORS.textMuted}
                      returnKeyType="search"
                      autoCorrect={false}
                    />
                    {avoidInput.length > 0 && (
                      <TouchableOpacity onPress={() => setAvoidInput('')} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={styles.macroListBody}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    {showAddCustom && (
                      <TouchableOpacity
                        style={styles.macroPickRow}
                        onPress={() => { addAvoidToken(avoidInput.trim()); setAvoidInput(''); }}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="add-circle" size={24} color={COLORS.green} />
                        <Text style={styles.macroPickRowName}>Add &ldquo;{avoidInput.trim()}&rdquo;</Text>
                      </TouchableOpacity>
                    )}
                    {customAvoidTokens.map((t, i) => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.macroPickRow, (i > 0 || showAddCustom) && styles.macroPickRowDivider]}
                        onPress={() => toggleAvoid(t)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="checkmark-circle" size={24} color={COLORS.green} />
                        <Text style={styles.macroPickRowName}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                    {filteredAvoid.map((opt, i) => {
                      const checked = prefs.avoid.some(a => a.toLowerCase() === opt.toLowerCase());
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.macroPickRow, (i > 0 || customAvoidTokens.length > 0 || showAddCustom) && styles.macroPickRowDivider]}
                          onPress={() => toggleAvoid(opt)}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                            size={24}
                            color={checked ? COLORS.green : COLORS.textMuted}
                          />
                          <Text style={[styles.macroPickRowName, !checked && styles.macroPickRowNameOff]}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    {filteredAvoid.length === 0 && customAvoidTokens.length === 0 && !showAddCustom && (
                      <Text style={styles.macroEmpty}>
                        {avoidQuery ? 'No matches.' : 'Loading foods…'}
                      </Text>
                    )}
                  </ScrollView>
                </>
              );
            })()}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.guideCta]}
              onPress={goNext}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{isLast ? 'Review' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ── Helpers wired to closure state ─────────────────────────────────────
  function mealsForSlot(slot: MealSlot): RecipeTemplate[] {
    return mealsBySlot[slot.id] ?? [];
  }

  function pagesForSlot(slot: MealSlot): Page[] {
    return distributeMealsIntoPages(mealsForSlot(slot));
  }

  function selectionsForSlot(slot: MealSlot): RecipeTemplate[] {
    return selectionsBySlot[slot.id] ?? [];
  }

  // ── Macro picker helpers ────────────────────────────────────────────────
  // A food can be a preference or on the avoid list, never both — the same
  // rule the loves/avoid questions already enforce between themselves.
  function addMacroToken(group: MacroGroup, raw: string) {
    const v = raw.trim();
    if (!v) return;
    if (prefs.avoid.some(a => a.toLowerCase() === v.toLowerCase())) {
      Alert.alert(
        `${v} is in foods to avoid`,
        'A food can only be a preference or avoided. Pick one.',
      );
      return;
    }
    setPrefs(p =>
      p[group].some(x => x.toLowerCase() === v.toLowerCase())
        ? p
        : { ...p, [group]: [...p[group], v] },
    );
  }

  function removeMacroToken(group: MacroGroup, token: string) {
    setPrefs(p => ({ ...p, [group]: p[group].filter(t => t !== token) }));
  }

  function toggleMacroOption(group: MacroGroup, value: string) {
    const existing = prefs[group].find(x => x.toLowerCase() === value.toLowerCase());
    if (existing) removeMacroToken(group, existing);
    else addMacroToken(group, value);
  }

  // ── AI shortlist helpers ────────────────────────────────────────────────
  // Shared request payload for both the full build and a per-type top-up, so
  // the two calls can never drift on which preferences they send.
  function shortlistPrefsPayload() {
    return {
      proteins: prefs.proteins,
      carbs: prefs.carbs,
      fats: prefs.fats,
      cuisines: prefs.cuisines,
      cookTime: prefs.cookTime,
      loves: prefs.loves,
      avoid: prefs.avoid,
    };
  }

  // Convert AI concepts into cards, dropping anything that trips the local
  // dietary filter. The server treats allergies/diet as hard constraints, but
  // this is a cheap second line of defence before a card reaches the user.
  function conceptsToSafeCards(concepts: RecipeConcept[], category: RecipeCategory): RecipeTemplate[] {
    return concepts
      .map(c => conceptToTemplate(c, category))
      .filter(card => applyDietaryFilter([card], profile).length > 0);
  }

  // The one AI call that powers the whole flow: one shortlist per active meal
  // type, one scan. Called from the guide CTA and after a Regenerate.
  async function runShortlistGeneration() {
    if (shortlistLoading || activeCategories.length === 0) return;
    setShortlistLoading(true);
    try {
      const result = await generatePlanShortlist({
        mealTypes: activeCategories,
        ...shortlistPrefsPayload(),
      });
      const next: Partial<Record<RecipeCategory, RecipeTemplate[]>> = {};
      let total = 0;
      activeCategories.forEach(cat => {
        const cards = conceptsToSafeCards(result[cat] ?? [], cat);
        next[cat] = cards;
        total += cards.length;
      });
      if (total === 0) {
        showToast("Couldn't build a shortlist that fits your profile — try adjusting your picks.");
        return;
      }
      setShortlistByType(next);
      setSelectedByType({});
      setStep({ kind: 'shortlist' });
    } catch (e) {
      handleAIError(e, () => void runShortlistGeneration());
    } finally {
      setShortlistLoading(false);
    }
  }

  // "More options" for a single meal type: appends a small fresh batch to that
  // section only. One scan per tap, so it stays an explicit user action.
  async function generateMoreForType(category: RecipeCategory) {
    if (generateMoreLoadingByType[category]) return;
    setGenerateMoreLoadingByType(prev => ({ ...prev, [category]: true }));
    try {
      const result = await generatePlanShortlist({
        mealTypes: [category],
        ...shortlistPrefsPayload(),
        countPerType: { [category]: GENERATE_MORE_COUNT },
      });
      // Drop repeats of what's already on screen — the model doesn't see the
      // existing shortlist, so near-duplicates are expected.
      const seen = new Set((shortlistByType[category] ?? []).map(c => c.name.toLowerCase()));
      const fresh = conceptsToSafeCards(result[category] ?? [], category)
        .filter(card => !seen.has(card.name.toLowerCase()));
      if (fresh.length === 0) {
        showToast('No new options this time — try again or tweak your preferences.');
        return;
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setShortlistByType(prev => ({ ...prev, [category]: [...(prev[category] ?? []), ...fresh] }));
    } catch (e) {
      handleAIError(e, () => void generateMoreForType(category));
    } finally {
      setGenerateMoreLoadingByType(prev => ({ ...prev, [category]: false }));
    }
  }

  function toggleShortlistPick(category: RecipeCategory, card: RecipeTemplate) {
    setSelectedByType(prev => {
      const list = prev[category] ?? [];
      const exists = list.some(r => r.id === card.id);
      return {
        ...prev,
        [category]: exists ? list.filter(r => r.id !== card.id) : [...list, card],
      };
    });
  }

  // Regenerate: back to the required picker so the user can change the inputs
  // that matter, then re-run the full call from the review page. Resetting
  // costs nothing — the scan is only spent when they tap Build again.
  function handleRegenerate() {
    Alert.alert(
      'Start over?',
      'This clears your current options and picks so you can change what you asked for.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start over',
          onPress: () => {
            setShortlistByType({});
            setSelectedByType({});
            setStep({ kind: 'macroPicker', group: 'proteins' });
          },
        },
      ],
    );
  }

  // Lands the user on the current last page after meals are added, then
  // increments the click counter and conditionally fires the popup.
  function appendMealsForSlot(
    slot: MealSlot,
    newCards: RecipeTemplate[],
    isSuggestMore: boolean,
  ) {
    if (newCards.length === 0) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMealsBySlot(prev => {
      const next = [...(prev[slot.id] ?? []), ...newCards];
      const pageCount = distributeMealsIntoPages(next).length;
      setPageIdxBySlot(idx => ({ ...idx, [slot.id]: pageCount - 1 }));
      return { ...prev, [slot.id]: next };
    });
    if (isSuggestMore) {
      const nextCount = (suggestClicksBySlot[slot.id] ?? 0) + 1;
      setSuggestClicksBySlot(prev => ({ ...prev, [slot.id]: nextCount }));
      // Fire the popup the first time we hit the threshold for this slot.
      if (nextCount === SUGGEST_POPUP_AT && !suggestPopupShownBySlot[slot.id]) {
        setSuggestPopupShownBySlot(prev => ({ ...prev, [slot.id]: true }));
        setSuggestPopupVisible(true);
      }
    }
  }

  // Shared AI failure handler for the free-scan-pool AI seams in this wizard
  // (shortlist build, per-type top-up, Describe). Premium gate opens the
  // shared paywall (matching What Can I Make / ScanTab) and retries the exact
  // same call on a successful purchase; everything else is a lightweight
  // toast. Suggest-more's own AI top-up is deliberately excluded — it already
  // degrades silently to a toast on any failure (see addAutoPage below).
  function handleAIError(e: unknown, retry?: () => void) {
    console.warn('Meal suggestion failed:', e);
    if (e instanceof AIError && e.code === 'not_premium') {
      openPaywall({ reason: 'scan_limit', onSuccess: retry });
      return;
    }
    if (
      e instanceof AIError &&
      (e.code === 'rate_limited' || e.code === 'ai_failed' || e.code === 'unauthorized')
    ) {
      showToast(e.message || 'Could not generate a suggestion right now. Please try again.');
      return;
    }
    showToast('Could not generate a suggestion. Try again.');
  }

  // "Suggest more": append a fresh batch of unseen catalogue meals. Suggest
  // more is always available; tracking is purely for the popup nudge. When the
  // static pool is exhausted, fall back to an AI-generated batch before giving
  // up — this is one of the two bounded seams where Build My Plan spends AI.
  async function addAutoPage(slot: MealSlot) {
    const pool = byCategory[categoryForSlot(slot.name)] ?? [];
    const shown = new Set<string>();
    mealsForSlot(slot).forEach(c => shown.add(c.id));
    const cards = buildAutoPage(pool, shown, SUGGEST_BATCH);
    if (cards.length > 0) {
      appendMealsForSlot(slot, cards, /* isSuggestMore */ true);
      return;
    }

    // Pool exhausted — try an AI top-up. On any failure or empty result we
    // degrade gracefully to the original Describe nudge rather than blocking
    // the flow mid-scroll.
    if (suggestMoreLoadingBySlot[slot.id]) return;
    setSuggestMoreLoadingBySlot(prev => ({ ...prev, [slot.id]: true }));
    try {
      const concepts = await generateMealSuggestions({
        mealType: categoryForSlot(slot.name),
        count: SUGGEST_BATCH,
        cuisines: prefs.cuisines,
        cookTime: prefs.cookTime,
        loves: prefs.loves,
        avoid: prefs.avoid,
      });
      const category = categoryForSlot(slot.name);
      const safe = concepts
        .map(c => conceptToTemplate(c, category))
        .filter(card => applyDietaryFilter([card], profile).length > 0);
      if (safe.length === 0) {
        showToast('No more options — try Describe for custom ideas');
        return;
      }
      appendMealsForSlot(slot, safe, /* isSuggestMore */ true);
    } catch (e) {
      console.warn('Suggest-more AI top-up failed:', e);
      showToast('No more options — try Describe for custom ideas');
    } finally {
      setSuggestMoreLoadingBySlot(prev => ({ ...prev, [slot.id]: false }));
    }
  }

  // Describe: generate a single custom meal from the user's prompt via AI and
  // append it. The modal stays open until this resolves so we can surface
  // errors and let the user retry without retyping.
  async function addDescribePage(slot: MealSlot, rawText: string) {
    const text = rawText.trim();
    if (!text || describeLoading) return;
    const category = categoryForSlot(slot.name);
    setDescribeLoading(true);
    try {
      const concepts = await generateMealSuggestions({
        mealType: category,
        count: 1,
        cuisines: prefs.cuisines,
        cookTime: prefs.cookTime,
        loves: prefs.loves,
        avoid: prefs.avoid,
        description: text,
      });
      const card = concepts[0] ? conceptToTemplate(concepts[0], category) : null;
      if (!card || applyDietaryFilter([card], profile).length === 0) {
        showToast("Couldn't generate a suggestion that fits your profile — try describing it differently.");
        return;
      }
      appendMealsForSlot(slot, [card], /* isSuggestMore */ false);
      showToast('Generated new option');
      setDescribeModalVisible(false);
      setDescribeModalText('');
    } catch (e) {
      handleAIError(e, () => void addDescribePage(slot, rawText));
    } finally {
      setDescribeLoading(false);
    }
  }

  // Resolve a recipe id to a card for calorie maths. Catalogue first, then any
  // card generated this session, then an explicit extra (a just-swapped card
  // whose state update hasn't landed yet).
  function resolveCard(id: string, extra?: RecipeTemplate): RecipeTemplate | undefined {
    if (extra && extra.id === id) return extra;
    return recipesById.get(id) ?? sessionCardById.get(id);
  }

  // Gentle nudge after a swap: recompute the day's calories and flag a big
  // miss against the daily target. Purely informational — the swap has already
  // been applied and is never blocked or reverted.
  function nudgeIfOffTarget(day: PlanDayMeal[], dayIdx: number, swappedIn: RecipeTemplate) {
    const target = goals.dailyCalories;
    if (!target || target <= 0) return;
    const total = day.reduce((sum, m) => sum + (resolveCard(m.recipeId, swappedIn)?.calories ?? 0), 0);
    if (total <= 0) return;
    const delta = (total - target) / target;
    if (Math.abs(delta) < SWAP_NUDGE_THRESHOLD) return;
    const pct = Math.round(Math.abs(delta) * 100);
    showToast(
      `Heads up — this swap puts ${WEEKDAY_LABELS[dayIdx]} about ${pct}% ` +
        `${delta > 0 ? 'over' : 'under'} your calorie target.`,
    );
  }

  // Apply a swap to one preview meal, then nudge if the day drifts far from
  // target. Shared by the browse-swap flow and the quick-swap sheet so both
  // paths behave identically.
  function applyPreviewSwap(dayIdx: number, mealIdx: number, recipe: RecipeTemplate) {
    const nextDay = (previewDays[dayIdx] ?? []).map((m, mi) =>
      mi === mealIdx ? { ...m, recipeId: recipe.id, recipeName: recipe.name } : m,
    );
    setPreviewDays(prev => prev.map((d, di) => (di === dayIdx ? nextDay : d)));
    nudgeIfOffTarget(nextDay, dayIdx, recipe);
  }

  function handleCardPress(slot: MealSlot, recipe: RecipeTemplate) {
    // Browsing only ever happens in swap mode now — the initial picks come from
    // the AI shortlist, so there's no selection toggling left on this screen.
    if (mode.kind !== 'preview-swap') return;
    const { dayIdx, mealIdx } = mode;
    applyPreviewSwap(dayIdx, mealIdx, recipe);
    // Keep the swapped-in card available as a future quick-swap candidate for
    // this slot (and in "Meals in this plan") instead of it vanishing from
    // everywhere but the one day it replaced.
    setSelectionsBySlot(prev => {
      const list = prev[slot.id] ?? [];
      return list.some(r => r.id === recipe.id)
        ? prev
        : { ...prev, [slot.id]: [...list, recipe] };
    });
    setMode({ kind: 'normal' });
    setStep({ kind: 'preview' });
  }

  // ── Build the week from the shortlist picks ──────────────────────────────
  // Plain logic, no AI: every slot inherits its meal type's picked favourites,
  // then buildPreviewDays' rotation spreads them across the 7 days. One
  // favourite repeats daily; several rotate — the emergent meal-prep-vs-variety
  // behaviour we want without asking the user another question.
  function handleBuildWeek() {
    const typesWithPicks = activeCategories.filter(c => (selectedByType[c] ?? []).length > 0);
    if (typesWithPicks.length === 0) {
      Alert.alert(
        'Pick at least one meal',
        'Choose at least one favourite from any meal type to build your week.',
      );
      return;
    }

    const proceed = () => {
      const bySlot: Record<string, RecipeTemplate[]> = {};
      activeSlots.forEach(slot => {
        bySlot[slot.id] = selectedByType[categoryForSlot(slot.name)] ?? [];
      });
      setSelectionsBySlot(bySlot);
      setPreviewDays(buildPreviewDays(activeSlots, bySlot));
      setExpandedDays(new Set([0]));
      setStep({ kind: 'preview' });
    };

    // A meal type with no picks is treated as skipped, matching the old
    // per-slot skip semantics — but confirm first so it's never a surprise.
    const skipped = activeCategories.filter(c => (selectedByType[c] ?? []).length === 0);
    if (skipped.length > 0) {
      Alert.alert(
        `Skip ${skipped.join(' and ')}?`,
        `You haven't picked anything for ${skipped.join(' or ')}, so ${
          skipped.length === 1 ? 'it' : 'they'
        } won't appear in your plan.`,
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Build anyway', onPress: proceed },
        ],
      );
      return;
    }
    proceed();
  }

  // ── Activate flow ──────────────────────────────────────────────────────
  function handleActivate() {
    // Client-only Pro gate: activating a built plan has no edge function of
    // its own to return a not_premium error, so this is checked directly
    // against the live RevenueCat entitlement. A successful purchase resumes
    // straight into activation rather than requiring a second tap.
    if (!isPro) {
      openPaywall({
        reason: 'premium_feature',
        headline: 'Activate your plan with Pro',
        onSuccess: handleActivate,
      });
      return;
    }

    const planName = autoPlanName();
    const plan: MealPlan = {
      // UUID so the local id doubles as the server plans.id primary key.
      id: newId(),
      name: planName,
      description: 'Custom plan built from your picks.',
      disclaimer: undefined,
      category: undefined,
      days: previewDays,
      targets: undefined,
      savedAt: new Date().toISOString(),
      source: 'user',
    };

    const finalize = () => {
      // Persist any AI/Describe-generated ("custom-") cards referenced by the
      // plan into savedRecipes (source 'ai') so buildTemplatesFromPlan can
      // resolve their real nutrition — both now and after restart via
      // hydrateActivePlanIfNeeded — instead of falling back to fabricated
      // values. Catalogue picks already resolve by id, so only custom cards
      // need saving. Keyed on recipeId = card.id so re-saves dedupe.
      const savedCustomIds = new Set<string>();
      previewDays.forEach(day =>
        day.forEach(meal => {
          if (!meal.recipeId.startsWith('custom-') || savedCustomIds.has(meal.recipeId)) return;
          const card = sessionCardById.get(meal.recipeId);
          if (!card) return;
          savedCustomIds.add(meal.recipeId);
          ensureRecipeSaved({
            recipeId: card.id,
            name: card.name,
            category: card.category,
            calories: card.calories,
            cookTimeMin: card.cookTimeMin,
            macros: card.macros,
            ingredients: card.ingredients,
            steps: card.steps,
            difficulty: card.difficulty,
            source: 'ai',
          });
        }),
      );

      // Auto-save to Saved Plans (matches spec: every Build My Plan run saves).
      useMealStore.setState(state => ({ savedPlans: [plan, ...state.savedPlans] }));
      activatePlan(plan);
      showToast(`${plan.name} activated`);
      router.dismissAll();
    };

    if (templates.length === 0) {
      finalize();
      return;
    }

    Alert.alert(
      'Replace your current plan?',
      'This will replace your current plan. Would you like to save your current plan first?',
      [
        {
          text: 'Save and replace',
          onPress: () => {
            const fallback = profile.activePlanName || `Plan saved ${new Date().toLocaleDateString()}`;
            saveCurrentPlanAs(fallback);
            finalize();
          },
        },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: finalize,
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // ── Render: PICK step (swap browsing only) ──────────────────────────────
  // Reached only from a preview swap. It's the catalogue-browse + Describe UI,
  // reused unchanged: tap any card to drop it into the meal being replaced.
  if (step.kind === 'pick') {
    const slot = activeSlots[step.slotIdx];

    // Defensive: pick has no meaning outside a swap, so offer a way back
    // rather than letting a tap silently do nothing.
    if (!slot || mode.kind !== 'preview-swap') {
      return (
        <Screen edges={['top', 'bottom']}>
          <Header title="Nothing to swap" onBack={() => setStep({ kind: 'preview' })} />
          <View style={styles.guardWrap}>
            <Text style={styles.guardBody}>
              Head back to your plan and tap Swap on the meal you want to change.
            </Text>
            <TouchableOpacity style={styles.guardCta} onPress={() => setStep({ kind: 'preview' })}>
              <Text style={styles.guardCtaText}>Back to plan</Text>
            </TouchableOpacity>
          </View>
        </Screen>
      );
    }

    const slotPages = pagesForSlot(slot);
    const currentPageIdx = pageIdxBySlot[slot.id] ?? 0;

    return (
      <Screen edges={['top', 'bottom']}>
        <Header
          title={slot.name}
          subtitle={`Swap meal · ${slot.name}`}
          onBack={() => {
            setMode({ kind: 'normal' });
            setStep({ kind: 'preview' });
          }}
        />

        {/* Elevated card wraps everything below the header. The card's
            internal layout is: intro (instruction + counter) → horizontal
            pager (flex:1) → page dots → locked bottom bar (Describe + skip). */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.cardContainer}>
            {/* Intro */}
            <View style={styles.cardIntro}>
              <Text style={styles.pickIntroText}>
                Tap a card to swap it into your plan.
              </Text>
            </View>

            {/* Horizontal pager — fills available card height. */}
            <View
              style={styles.cardPagerArea}
              onLayout={e => setPageWidth(e.nativeEvent.layout.width)}
            >
              {pageWidth > 0 && (
                <ScrollView
                  ref={pagerRef}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={e => {
                    const x = e.nativeEvent.contentOffset.x;
                    const newIdx = Math.round(x / pageWidth);
                    setPageIdxBySlot(prev => ({ ...prev, [slot.id]: newIdx }));
                  }}
                >
                  {slotPages.map((page, pageIdx) => (
                    <ScrollView
                      key={pageIdx}
                      style={{ width: pageWidth }}
                      contentContainerStyle={styles.pageBody}
                      showsVerticalScrollIndicator={false}
                    >
                      {page.cards.map(r => (
                        <PickCard
                          key={r.id}
                          recipe={r}
                          selected={false}
                          showCheck={false}
                          onPress={() => handleCardPress(slot, r)}
                        />
                      ))}
                      {/* Suggest more sits on the last page only and is
                          always visible — clicking it 5 times triggers the
                          Describe-suggestion popup once per slot. */}
                      {page.isLast && (
                        <TouchableOpacity
                          style={[
                            styles.findMoreCard,
                            suggestMoreLoadingBySlot[slot.id] && styles.disabledBtn,
                          ]}
                          onPress={() => addAutoPage(slot)}
                          disabled={!!suggestMoreLoadingBySlot[slot.id]}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.findMoreEmoji}>✨</Text>
                          <Text style={styles.findMoreText}>
                            {suggestMoreLoadingBySlot[slot.id] ? 'Finding more…' : 'Suggest more'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </ScrollView>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* iOS-16-style page indicator: round dots + elongated active pill. */}
            {slotPages.length > 1 && (
              <View style={styles.cardDots}>
                {slotPages.map((_, idx) => (
                  <View
                    key={idx}
                    style={[styles.dot, currentPageIdx === idx && styles.dotActive]}
                  />
                ))}
              </View>
            )}

            {/* Locked bottom bar: Describe + skip. Stays inside the card
                so the card visually frames the entire selection workflow. */}
            <View style={styles.cardLockedBottom}>
              <TouchableOpacity
                style={styles.describeOpenBtn}
                activeOpacity={0.85}
                onPress={() => {
                  setDescribeModalText('');
                  setDescribeModalVisible(true);
                }}
              >
                <Text style={styles.describeOpenIcon}>✎</Text>
                <Text style={styles.describeOpenBtnText}>Describe what you want</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* Describe popup overlay. Lives inside the pick render so we have
            `slot` in scope and can route the generated page to the right slot. */}
        <Modal
          transparent
          animationType="fade"
          visible={describeModalVisible}
          onRequestClose={() => setDescribeModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <Pressable style={styles.describeOverlay} onPress={() => setDescribeModalVisible(false)}>
              <Pressable style={styles.describeCard} onPress={e => e.stopPropagation?.()}>
                <View style={styles.describeCardHeader}>
                  <Text style={styles.describeCardTitle}>Describe what you want</Text>
                  <TouchableOpacity
                    onPress={() => setDescribeModalVisible(false)}
                    hitSlop={10}
                    style={styles.describeCloseBtn}
                  >
                    <Text style={styles.describeCloseText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.describeCardHint}>
                  Tell us what you&apos;re craving for {slot.name.toLowerCase()} and we&apos;ll generate options.
                </Text>
                <TextInput
                  style={styles.describeTextArea}
                  value={describeModalText}
                  onChangeText={setDescribeModalText}
                  placeholder="e.g. high-protein breakfast under 500 cal"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  autoFocus
                />
                <TouchableOpacity
                  style={[
                    styles.describeGenBtn,
                    (!describeModalText.trim() || describeLoading) && styles.disabledBtn,
                  ]}
                  disabled={!describeModalText.trim() || describeLoading}
                  onPress={() => {
                    const text = describeModalText.trim();
                    if (!text) return;
                    addDescribePage(slot, text);
                  }}
                >
                  <Text style={styles.describeGenBtnText}>
                    {describeLoading ? 'Generating…' : 'Generate'}
                  </Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>

        {/* Suggest more popup: fires once per slot at SUGGEST_POPUP_AT clicks.
            Two CTAs — open Describe or keep suggesting. Suggest more keeps
            working forever regardless of how the popup is dismissed. */}
        <Modal
          transparent
          animationType="fade"
          visible={suggestPopupVisible}
          onRequestClose={() => setSuggestPopupVisible(false)}
        >
          <Pressable
            style={styles.describeOverlay}
            onPress={() => setSuggestPopupVisible(false)}
          >
            <Pressable
              style={styles.describeCard}
              onPress={e => e.stopPropagation?.()}
            >
              <View style={styles.describeCardHeader}>
                <Text style={styles.describeCardTitle}>Try Describe?</Text>
                <TouchableOpacity
                  onPress={() => setSuggestPopupVisible(false)}
                  hitSlop={10}
                  style={styles.describeCloseBtn}
                >
                  <Text style={styles.describeCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.describeCardHint}>
                Not seeing what you&apos;re after? Describe what you want and we&apos;ll
                generate something tailored. Suggest more still works — this is
                just a tip.
              </Text>
              <View style={styles.suggestPopupRow}>
                <TouchableOpacity
                  style={styles.suggestPopupSecondary}
                  activeOpacity={0.85}
                  onPress={() => setSuggestPopupVisible(false)}
                >
                  <Text style={styles.suggestPopupSecondaryText}>Keep suggesting</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.suggestPopupPrimary}
                  activeOpacity={0.85}
                  onPress={() => {
                    setSuggestPopupVisible(false);
                    setDescribeModalText('');
                    setDescribeModalVisible(true);
                  }}
                >
                  <Text style={styles.suggestPopupPrimaryText}>Try Describe</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </Screen>
    );
  }

  // ── Render: SHORTLIST step ─────────────────────────────────────────────
  // One scrollable screen with a section per active meal type. Each section is
  // only a handful of cards, so there's no pagination — a deliberate
  // simplification over the old per-slot paginated catalogue walk.
  if (step.kind === 'shortlist') {
    const totalPicked = activeCategories.reduce(
      (sum, c) => sum + (selectedByType[c] ?? []).length,
      0,
    );

    return (
      <Screen edges={['top', 'bottom']}>
        <Header
          title="Pick your favourites"
          subtitle={`${totalPicked} selected`}
          onBack={() => setStep({ kind: 'guide' })}
          rightAction={
            <TouchableOpacity onPress={handleRegenerate} hitSlop={10}>
              <Text style={styles.headerRightMutedText}>Redo</Text>
            </TouchableOpacity>
          }
        />

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.onbHint}>
            Choose the ones you&apos;d actually eat. Pick one and it repeats daily; pick
            several and we&apos;ll rotate them through the week.
          </Text>

          {activeCategories.map(category => {
            const options = shortlistByType[category] ?? [];
            const picked = selectedByType[category] ?? [];
            const busy = !!generateMoreLoadingByType[category];
            return (
              <View key={category} style={styles.shortlistSection}>
                <Text style={styles.shortlistSectionTitle}>{category}</Text>
                <Text style={styles.shortlistSectionMeta}>
                  {picked.length === 0
                    ? 'Nothing picked yet — skip this meal by leaving it empty.'
                    : `${picked.length} picked`}
                </Text>

                {options.length === 0 ? (
                  <Text style={styles.shortlistEmpty}>No options for {category} this time.</Text>
                ) : (
                  options.map(card => (
                    <PickCard
                      key={card.id}
                      recipe={card}
                      selected={picked.some(r => r.id === card.id)}
                      showCheck
                      onPress={() => toggleShortlistPick(category, card)}
                    />
                  ))
                )}

                <TouchableOpacity
                  style={[styles.shortlistGenMore, busy && styles.disabledBtn]}
                  onPress={() => generateMoreForType(category)}
                  disabled={busy}
                  activeOpacity={0.85}
                >
                  <Text style={styles.shortlistGenMoreText}>
                    {busy ? 'Finding more…' : `✨ More ${category.toLowerCase()} options`}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
          <TouchableOpacity
            style={[styles.primaryBtn, styles.primaryBtnFull, totalPicked === 0 && styles.disabledBtn]}
            disabled={totalPicked === 0}
            onPress={handleBuildWeek}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>
              {totalPicked === 0 ? 'Pick at least one meal' : 'Build my week'}
            </Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  // ── Render: PREVIEW step ───────────────────────────────────────────────

  // Plan-wide totals + the unique meal list shown at the top of the preview.
  // Recipes are looked up by id so we can render calorie/macro details.
  // Catalogue items come from `recipes`; AI/Describe ("custom-") cards are
  // pulled from this session's cards so their real nutrition shows in the
  // preview totals (they aren't in the catalogue, and savedRecipes isn't
  // populated until activation).
  const recipeById = new Map<string, RecipeTemplate>();
  recipes.forEach(r => recipeById.set(r.id, r));
  sessionCardById.forEach((card, id) => {
    if (!recipeById.has(id)) recipeById.set(id, card);
  });
  // Walk every selection list — not previewDays — so meals the user picked
  // but happened to land on a non-rotation day still surface here.
  const distinctMeals: { recipe: RecipeTemplate | undefined; name: string; slotName: string }[] = [];
  const seenIds = new Set<string>();
  activeSlots.forEach(slot => {
    (selectionsBySlot[slot.id] ?? []).forEach(r => {
      if (seenIds.has(r.id)) return;
      seenIds.add(r.id);
      distinctMeals.push({ recipe: r, name: r.name, slotName: slot.name });
    });
  });

  const totalCalsAcrossWeek = previewDays.reduce(
    (sum, day) => sum + day.reduce((s, m) => s + (recipeById.get(m.recipeId)?.calories ?? 0), 0),
    0,
  );
  const avgDailyCal = Math.round(totalCalsAcrossWeek / 7);
  const avgDailyProtein = Math.round(
    previewDays.reduce(
      (sum, day) => sum + day.reduce((s, m) => s + (recipeById.get(m.recipeId)?.macros.protein ?? 0), 0),
      0,
    ) / 7,
  );
  const avgDailyCarbs = Math.round(
    previewDays.reduce(
      (sum, day) => sum + day.reduce((s, m) => s + (recipeById.get(m.recipeId)?.macros.carbs ?? 0), 0),
      0,
    ) / 7,
  );
  const avgDailyFats = Math.round(
    previewDays.reduce(
      (sum, day) => sum + day.reduce((s, m) => s + (recipeById.get(m.recipeId)?.macros.fats ?? 0), 0),
      0,
    ) / 7,
  );

  const visibleDistinct = previewMealsExpanded ? distinctMeals : distinctMeals.slice(0, 3);
  const collapsibleNeeded = distinctMeals.length > 3;

  return (
    <Screen edges={['top', 'bottom']}>
      <Header
        title="Preview your plan"
        subtitle="Tap any meal to swap it"
        onBack={() => setStep({ kind: 'shortlist' })}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Plan name + daily target — mirrors the plan detail page header. */}
        <View style={styles.planNameCard}>
          <Text style={styles.planNameLabel}>YOUR PLAN</Text>
          <Text style={styles.planNameText}>{autoPlanName()}</Text>
          <Text style={styles.planNameSub}>
            {activeSlots.length} meal {activeSlots.length === 1 ? 'type' : 'types'} · 7 days
          </Text>
        </View>

        <View style={styles.targetsCard}>
          <Text style={styles.targetsLabel}>Daily target</Text>
          <Text style={styles.targetsCalories}>{avgDailyCal} cal</Text>
          <View style={styles.targetsMacroRow}>
            <Text style={styles.targetsMacroPill}>P {avgDailyProtein}g</Text>
            <Text style={styles.targetsMacroPill}>C {avgDailyCarbs}g</Text>
            <Text style={styles.targetsMacroPill}>F {avgDailyFats}g</Text>
          </View>
        </View>

        <Text style={styles.previewSection}>Meals in this plan</Text>
        <View style={styles.previewMealList}>
          {visibleDistinct.map((m, idx) => (
            <View key={`${m.recipe?.id ?? m.name}-${idx}`} style={styles.previewMealListRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewMealListName} numberOfLines={1}>{m.name}</Text>
                <Text style={styles.previewMealListMeta}>
                  {m.recipe
                    ? `${m.recipe.calories} cal · ${m.recipe.cookTimeMin}m · ${m.slotName}`
                    : `Custom · ${m.slotName}`}
                </Text>
              </View>
            </View>
          ))}
          {collapsibleNeeded && (
            <TouchableOpacity
              style={styles.previewSeeMoreBtn}
              onPress={() => setPreviewMealsExpanded(prev => !prev)}
            >
              <Text style={styles.previewSeeMoreText}>
                {previewMealsExpanded ? 'See less' : `See more (${distinctMeals.length - 3})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.previewSection}>Weekly schedule</Text>
        {previewDays.map((day, dayIdx) => {
          const expanded = expandedDays.has(dayIdx);
          const totalCal = day.reduce((sum, m) => sum + (recipeById.get(m.recipeId)?.calories ?? 0), 0);
          return (
            <View key={dayIdx} style={styles.dayBlock}>
              <Pressable
                style={styles.dayHead}
                onPress={() => setExpandedDays(prev => {
                  const next = new Set(prev);
                  if (next.has(dayIdx)) next.delete(dayIdx); else next.add(dayIdx);
                  return next;
                })}
              >
                <View>
                  <Text style={styles.dayName}>{WEEKDAY_LABELS[dayIdx]}</Text>
                  <Text style={styles.dayCals}>
                    {day.length} meals · {totalCal} cal
                  </Text>
                </View>
                <Text style={styles.dayChevron}>{expanded ? '▾' : '▸'}</Text>
              </Pressable>
              {expanded && (
                <View style={styles.dayMeals}>
                  {day.length === 0 ? (
                    <Text style={styles.daySkip}>No meals scheduled</Text>
                  ) : (
                    day.map((meal, mealIdx) => {
                      const r = recipeById.get(meal.recipeId);
                      const cal = r?.calories;
                      return (
                        <View key={`${dayIdx}-${mealIdx}`} style={styles.previewMeal}>
                          <TouchableOpacity
                            style={{ flex: 1 }}
                            onPress={() => setQuickSwap({ dayIdx, mealIdx })}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.previewMealName}>{meal.recipeName}</Text>
                            <Text style={styles.previewMealMeta}>
                              {meal.slotName} · {meal.time}{cal != null ? ` · ${cal} cal` : ''}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.findDifferentBtn}
                            onPress={() => {
                              const slotIdx = activeSlots.findIndex(s => s.name === meal.slotName);
                              if (slotIdx === -1) return;
                              setMode({ kind: 'preview-swap', dayIdx, mealIdx });
                              setStep({ kind: 'pick', slotIdx });
                            }}
                          >
                            <Text style={styles.findDifferentText}>Swap</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Single Confirm Plan button — Back is the header arrow. */}
      <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
        <TouchableOpacity style={[styles.primaryBtn, styles.primaryBtnFull]} onPress={handleActivate}>
          <Text style={styles.primaryBtnText}>Confirm Plan</Text>
        </TouchableOpacity>
      </View>

      {/* Quick swap modal — show other selections for the targeted slot */}
      <Modal
        transparent
        visible={!!quickSwap}
        animationType="fade"
        onRequestClose={() => setQuickSwap(null)}
      >
        <Pressable style={styles.swapBackdrop} onPress={() => setQuickSwap(null)}>
          <Pressable style={styles.swapCard}>
            {quickSwap && (() => {
              const meal = previewDays[quickSwap.dayIdx]?.[quickSwap.mealIdx];
              if (!meal) return null;
              const slotIdx = activeSlots.findIndex(s => s.name === meal.slotName);
              if (slotIdx === -1) return null;
              const slot = activeSlots[slotIdx];
              const candidates = selectionsForSlot(slot).filter(r => r.id !== meal.recipeId);

              return (
                <>
                  <Text style={styles.swapTitle}>Swap {meal.slotName}</Text>
                  <Text style={styles.swapSubtitle}>From your selections</Text>
                  <ScrollView style={{ maxHeight: 360 }}>
                    {candidates.length === 0 ? (
                      <Text style={styles.swapEmpty}>
                        Only one {meal.slotName.toLowerCase()} selected. Use &ldquo;New&rdquo; to find a
                        different meal.
                      </Text>
                    ) : (
                      candidates.map(c => (
                        <TouchableOpacity
                          key={c.id}
                          style={styles.swapItem}
                          onPress={() => {
                            applyPreviewSwap(quickSwap.dayIdx, quickSwap.mealIdx, c);
                            setQuickSwap(null);
                          }}
                        >
                          <Text style={styles.swapItemName}>{c.name}</Text>
                          <Text style={styles.swapItemMeta}>{c.calories} cal · {c.cookTimeMin}m</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>
                  <TouchableOpacity style={styles.swapCancel} onPress={() => setQuickSwap(null)}>
                    <Text style={styles.swapCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StepProgressBar({ step, total, label }: { step: number; total: number; label: string }) {
  // Step number is 1-indexed and never exceeds `total`. Width is clamped so a
  // small rounding hiccup can't push the fill past the track.
  const pct = Math.max(0, Math.min(100, total > 0 ? (step / total) * 100 : 0));
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.progressLabel}>
        Step {step} of {total} — {label}
      </Text>
    </View>
  );
}

function Header({
  title,
  subtitle,
  onBack,
  rightAction,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}) {
  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
  };
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={handleBack} style={styles.headerBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.headerBackText}>←</Text>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.headerBack}>{rightAction}</View>
    </View>
  );
}

function PickCard({
  recipe,
  selected,
  showCheck,
  onPress,
}: {
  recipe: RecipeTemplate;
  selected: boolean;
  // When false (swap modes) we suppress the corner "Selected" badge since
  // selection state isn't meaningful in those flows — the user is replacing
  // a meal one-tap, not toggling.
  showCheck: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.pickCard, selected && styles.pickCardSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={
        selected ? `${recipe.name}, selected` : `${recipe.name}`
      }
    >
      <Text style={styles.pickName} numberOfLines={1}>{recipe.name}</Text>
      <Text style={styles.pickMeta}>{recipe.calories} cal · {recipe.cookTimeMin}m</Text>
      <View style={styles.macroRow}>
        <Text style={styles.macroPill}>P {recipe.macros.protein}g</Text>
        <Text style={styles.macroPill}>C {recipe.macros.carbs}g</Text>
        <Text style={styles.macroPill}>F {recipe.macros.fats}g</Text>
      </View>
      {showCheck && selected && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeIcon}>✓</Text>
          <Text style={styles.selectedBadgeText}>Selected</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerBack: { minWidth: 56, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  headerBackText: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  headerSubtitle: { color: COLORS.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 2 },
  headerRightText: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  headerRightMutedText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },

  // Step progress bar (above Header)
  progressWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 5,
  },
  progressTrack: {
    height: 4,
    backgroundColor: COLORS.elevated,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: COLORS.green,
    borderRadius: 2,
  },
  progressLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },

  // Pick page chrome — wrapped in an elevated card so the workflow feels
  // like a single sheet rather than a stack of unrelated rows.
  cardContainer: {
    flex: 1,
    marginHorizontal: 14,
    marginVertical: 12,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    paddingTop: 14,
    paddingBottom: 8,
    paddingHorizontal: 0,
    overflow: 'hidden',
    // Soft elevation. Shadow on iOS, elevation on Android.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 14,
    elevation: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  cardIntro: {
    paddingHorizontal: 14,
    paddingBottom: 8,
    gap: 4,
  },
  cardPagerArea: {
    flex: 1,
  },
  cardDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    paddingBottom: 4,
  },
  cardLockedBottom: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  // iOS-16-style dots: small circles with an elongated active pill.
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: {
    backgroundColor: COLORS.green,
    width: 18,
    height: 6,
    borderRadius: 3,
  },
  pickIntroText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  pickCounter: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },

  body: { padding: 16, paddingBottom: 40 },
  pageBody: { padding: 16, paddingBottom: 28 },

  pickCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
    // Reserve space for the corner Selected badge so card height is stable
    // whether the badge is visible or not.
    minHeight: 88,
    position: 'relative',
  },
  // Stronger selected state: thicker green border + tinted fill. Combined
  // with the corner "Selected" pill this provides redundant cues
  // (color + label + border) for accessibility.
  pickCardSelected: {
    borderColor: COLORS.green,
    borderWidth: 2,
    backgroundColor: COLORS.green + '1F',
  },
  pickName: { color: COLORS.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  pickMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  macroRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  macroPill: {
    color: COLORS.textSecondary,
    fontSize: 11,
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  // Corner "Selected" pill in the top-right of a selected card.
  selectedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.green,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  selectedBadgeIcon: { color: '#0E1A12', fontSize: 11, fontWeight: '900' },
  selectedBadgeText: { color: '#0E1A12', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  findMoreCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.green,
    padding: 16,
    marginTop: 4,
    alignItems: 'center',
  },
  findMoreEmoji: { fontSize: 22, marginBottom: 4 },
  findMoreText: { color: COLORS.green, fontSize: 14, fontWeight: '700' },

  // Bottom button that opens the Describe popup
  describeOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.green + '14',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.green,
    paddingVertical: 12,
  },
  describeOpenIcon: { color: COLORS.green, fontSize: 14 },
  describeOpenBtnText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  disabledBtn: { opacity: 0.4 },

  // Describe popup overlay
  describeOverlay: {
    flex: 1,
    backgroundColor: '#000B',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  describeCard: {
    backgroundColor: OPAQUE_SHEET_BG,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  describeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  describeCardTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  describeCloseBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.elevated,
    alignItems: 'center', justifyContent: 'center',
  },
  describeCloseText: { color: COLORS.text, fontSize: 14 },
  describeCardHint: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  describeTextArea: {
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 14,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  describeGenBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  describeGenBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },

  // Suggest more popup CTAs (matches Describe popup styling).
  suggestPopupRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  suggestPopupSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
  },
  suggestPopupSecondaryText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  suggestPopupPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.green,
    alignItems: 'center',
  },
  suggestPopupPrimaryText: {
    color: '#0E1A12',
    fontSize: 13,
    fontWeight: '700',
  },

  skipRow: { alignItems: 'center', paddingVertical: 8 },
  skipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },

  // Summary
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryCount: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  summaryAvg: { color: COLORS.textSecondary, fontSize: 12 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  summaryName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  summaryMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  swapBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.green,
  },
  swapBtnText: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
  addMoreBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  addMoreText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  // Preview
  dayBlock: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: 10,
  },
  dayHead: {
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  dayCals: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  dayChevron: { color: COLORS.textSecondary, fontSize: 16 },
  dayMeals: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  daySkip: { color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic', paddingVertical: 8 },
  previewMeal: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  previewMealName: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  previewMealMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  findDifferentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginLeft: 8,
  },
  findDifferentText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700' },

  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    // paddingBottom is applied inline via useSafeAreaInsets per render.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  primaryBtn: {
    flex: 1.4,
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
  // Used when primaryBtn is the only button in a footer (no secondary action).
  primaryBtnFull: { flex: 1 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },

  // Guide page
  guideBody: { padding: 16, paddingBottom: 40, gap: 16 },
  guideHero: { color: COLORS.text, fontSize: 24, fontWeight: '700', marginTop: 6 },
  guideHeroSub: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  guideCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 10,
  },
  guideRowLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingTop: 6,
    width: 80,
  },
  guideDivider: { height: 1, backgroundColor: COLORS.border, opacity: 0.6 },
  guidePillGroup: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
  },
  guidePill: {
    backgroundColor: COLORS.green + '22',
    borderColor: COLORS.green,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  guidePillText: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
  guidePillWarn: {
    backgroundColor: COLORS.orange + '22',
    borderColor: COLORS.orange,
  },
  guidePillTextWarn: { color: COLORS.orange },
  guideMuted: { color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic', paddingTop: 6 },
  guideHint: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: -4 },
  guideStepsCard: {
    backgroundColor: COLORS.elevated,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  guideStepsTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  guideStepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  guideStepBullet: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.green,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  guideStepBulletText: { color: '#0E1A12', fontSize: 12, fontWeight: '700' },
  guideStepText: { color: COLORS.text, fontSize: 13, lineHeight: 19, flex: 1 },
  guideCta: { flex: 1 },

  // Mini onboarding question pages
  onbBody: { padding: 16, gap: 16, paddingBottom: 24 },
  onbQuestion: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  onbHint: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: -6 },

  // Reusable chip grid (cuisines, suggestions, tokens)
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.green + '22',
    borderColor: COLORS.green,
  },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  // Cook-time radio rows
  radioGroup: { gap: 10 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
  },
  radioRowActive: { borderColor: COLORS.green, borderWidth: 2 },
  radioDot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
  },
  radioDotActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  radioLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  radioMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  // Token input (loves / avoid)
  tokenInputRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  tokenInput: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 14,
  },
  tokenAddBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenAddBtnText: { color: '#0E1A12', fontSize: 13, fontWeight: '700' },
  tokenList: { gap: 8, marginTop: 4 },
  tokenListLabel: { color: COLORS.textSecondary, fontSize: 11, letterSpacing: 1, fontWeight: '700' },

  // Macro picker (searchable checklist loaded from Supabase)
  macroLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  macroLoadingText: { color: COLORS.textSecondary, fontSize: 14 },
  macroHint: { paddingHorizontal: 16, marginTop: 8, marginBottom: 4 },
  macroSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
  },
  macroSearchInput: { flex: 1, color: COLORS.text, fontSize: 15 },
  macroListBody: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  macroPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  macroPickRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  macroPickRowName: { color: COLORS.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  macroPickRowNameOff: { color: COLORS.textSecondary, fontWeight: '500' },
  macroEmpty: { color: COLORS.textMuted, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  macroError: { gap: 12, paddingVertical: 16, alignItems: 'center' },
  macroErrorText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  macroRetryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.green,
  },
  macroRetryText: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  macroFallback: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  macroFallbackLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },

  // Preview header cards
  planNameCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.green + '55',
    padding: 14,
    marginBottom: 12,
  },
  planNameLabel: {
    color: COLORS.green,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700',
  },
  planNameText: { color: COLORS.text, fontSize: 22, fontWeight: '700', marginTop: 6 },
  planNameSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },

  targetsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 16,
  },
  targetsLabel: { color: COLORS.textSecondary, fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  targetsCalories: { color: COLORS.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  targetsMacroRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  targetsMacroPill: {
    color: COLORS.textSecondary,
    fontSize: 11,
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  previewSection: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  previewMealList: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  previewMealListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  previewMealListName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  previewMealListMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  previewSeeMoreBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  previewSeeMoreText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  // Guard
  guardWrap: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  guardEmoji: { fontSize: 48, marginBottom: 12 },
  guardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  guardBody: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 16, lineHeight: 19 },
  guardCta: { backgroundColor: COLORS.green, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  guardCtaText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
  guardSecondary: { paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  guardSecondaryText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },

  // Quick swap modal
  swapBackdrop: { flex: 1, backgroundColor: '#000B', justifyContent: 'flex-end' },
  swapCard: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
  },
  swapTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  swapSubtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2, marginBottom: 10 },
  swapEmpty: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 14 },
  swapItem: {
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  swapItemName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  swapItemMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  swapCancel: {
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    marginTop: 4,
  },
  swapCancelText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  // Macro picker section headings
  macroSectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: 8 },

  // Shortlist step
  shortlistSection: { marginBottom: 20 },
  shortlistSectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 2 },
  shortlistSectionMeta: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 10 },
  shortlistEmpty: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  shortlistGenMore: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  shortlistGenMoreText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  // Shortlist generation loading screen
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  loadingSub: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
});
