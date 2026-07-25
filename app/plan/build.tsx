import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { Screen } from '@/components/Screen';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { newId } from '@/lib/sync/uuid';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import type {
  MealPlan,
  MealSlot,
  PlanDayMeal,
  RecipeCategory,
  RecipeTemplate,
  UserProfile,
} from '@/store/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// PAGE_SIZE counts items per page (meals + Suggest more). Non-last pages
// hold 5 meal cards. The last page holds 1–4 meal cards plus Suggest more
// for a total of 5 items.
const PAGE_SIZE = 5;
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

function generateCustomCard(text: string, category: RecipeCategory): RecipeTemplate {
  const trimmed = text.trim().slice(0, 60) || 'Custom recipe';
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    category,
    calories: 450,
    cookTimeMin: 20,
    macros: { protein: 25, carbs: 45, fats: 15 },
    ingredients: [],
    steps: [`Prepare: ${trimmed}`, 'Plate and enjoy.'],
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
  | { kind: 'preview-swap'; dayIdx: number; mealIdx: number }
  | { kind: 'summary-swap'; slotIdx: number; oldRecipeId: string };

type Step =
  | { kind: 'guide' }
  | { kind: 'onboarding'; questionIdx: 0 | 1 | 2 | 3 }
  | { kind: 'pick'; slotIdx: number }
  | { kind: 'summary'; slotIdx: number }
  | { kind: 'preview' };

// ─── Mini onboarding ─────────────────────────────────────────────────────────
// 4 short questions asked fresh every Build My Plan run. Answers live only
// in component state — they're never persisted to profile (people's mood
// changes day to day) — though we keep the previous session in a module-
// level cache so the user can one-tap reuse last time's answers.

type CookTime = 'quick' | 'moderate' | 'full';

interface WizardPrefs {
  cuisines: string[];          // multi-select; "Everything" is mutually exclusive
  cookTime: CookTime | null;   // single select
  loves: string[];             // chips + free text combined
  avoid: string[];             // chips + free text combined
}

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
const AVOID_SUGGESTIONS = ['Mushrooms', 'Olives', 'Tomato', 'Cilantro', 'Liver', 'Tuna', 'Spicy'];

const ONBOARDING_TOTAL = 4;

const EMPTY_PREFS: WizardPrefs = {
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
  const showToast = useToastStore(s => s.showToast);
  const insets = useSafeAreaInsets();
  const footerBottomPad = Math.max(insets.bottom, 16) + 16;

  // Active slots: only those not skipped, sorted by time so the wizard walks
  // them in the canonical order Breakfast → Mid-morning → Lunch → ... → Dinner.
  const activeSlots = useMemo<MealSlot[]>(
    () => profile.mealSlots.filter(s => !s.skipped).sort((a, b) => a.time.localeCompare(b.time)),
    [profile.mealSlots],
  );

  const dietaryFiltered = useMemo(() => applyDietaryFilter(recipes, profile), [recipes, profile]);

  // ── Wizard state ────────────────────────────────────────────────────────
  // Flow: onboarding (4 quick questions, fresh every run) → guide (review)
  // → pick → summary → preview. Onboarding-first lets the guide act as a
  // confirmation screen showing both profile data and the user's answers
  // before committing them to meal selection.
  const [step, setStep] = useState<Step>({ kind: 'onboarding', questionIdx: 0 });
  const [mode, setMode] = useState<Mode>({ kind: 'normal' });
  // Mini onboarding answers, gathered fresh each run. Used to bias meal
  // suggestions in `byCategory`/`rankForGoal`.
  const [prefs, setPrefs] = useState<WizardPrefs>(EMPTY_PREFS);
  // Free-text input boxes for love/avoid questions.
  const [loveInput, setLoveInput] = useState('');
  const [avoidInput, setAvoidInput] = useState('');

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
  // Preview "Meals in this plan" collapse state.
  const [previewMealsExpanded, setPreviewMealsExpanded] = useState(false);
  // Per-slot: a flat array of meal cards. Keyed by slot.id so it survives
  // even if active slots are recomputed (e.g. user toggles a slot mid-
  // session). Pages are derived from this list on every render via
  // `distributeMealsIntoPages`.
  const [mealsBySlot, setMealsBySlot] = useState<Record<string, RecipeTemplate[]>>({});
  // Per-slot selected recipes preserved in user-pick order.
  const [selectionsBySlot, setSelectionsBySlot] = useState<Record<string, RecipeTemplate[]>>({});
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

  // ── Guide preview (review step) ─────────────────────────────────────────
  // Sits *after* the 4 onboarding questions so the user can review both
  // their fresh answers and their saved profile before meal selection
  // begins. Read-only — to change an onboarding answer, the user goes back.
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
          onBack={() => setStep({ kind: 'onboarding', questionIdx: 3 })}
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

          {/* Onboarding answers — fresh-this-session */}
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
                We&apos;ll walk you through your {slotCount} meal {slotCount === 1 ? 'slot' : 'slots'} for the day.
              </Text>
            </View>
            <View style={styles.guideStepRow}>
              <View style={styles.guideStepBullet}><Text style={styles.guideStepBulletText}>2</Text></View>
              <Text style={styles.guideStepText}>
                Pick your favourites — Suggest more or describe what you want any time.
              </Text>
            </View>
            <View style={styles.guideStepRow}>
              <View style={styles.guideStepBullet}><Text style={styles.guideStepBulletText}>3</Text></View>
              <Text style={styles.guideStepText}>
                We&apos;ll rotate them through the week into a balanced plan.
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
          <TouchableOpacity
            style={[styles.primaryBtn, styles.guideCta]}
            onPress={() => setStep({ kind: 'pick', slotIdx: 0 })}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Let&apos;s go</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  // ── Render: ONBOARDING (4 quick questions) ─────────────────────────────
  if (step.kind === 'onboarding') {
    const qIdx = step.questionIdx;
    const isLast = qIdx === 3;

    const goNext = () => {
      if (isLast) {
        // After Q4, route to the guide review page so the user can see all
        // their answers + profile data before committing.
        setStep({ kind: 'guide' });
      } else {
        setStep({ kind: 'onboarding', questionIdx: (qIdx + 1) as 0 | 1 | 2 | 3 });
      }
    };
    const goBack = () => {
      // Q1 back returns to the modal; subsequent questions step backwards.
      if (qIdx === 0) router.back();
      else setStep({ kind: 'onboarding', questionIdx: (qIdx - 1) as 0 | 1 | 2 | 3 });
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
      setPrefs(p => p.avoid.some(l => l.toLowerCase() === v.toLowerCase()) ? p : { ...p, avoid: [...p.avoid, v] });
    };
    const removeAvoidToken = (token: string) =>
      setPrefs(p => ({ ...p, avoid: p.avoid.filter(t => t !== token) }));

    return (
      <Screen edges={['top', 'bottom']}>
        <StepProgressBar
          step={qIdx + 1}
          total={ONBOARDING_TOTAL}
          label="Quick setup"
        />
        <Header
          title="A few quick questions"
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

            {qIdx === 3 && (
              <>
                <Text style={styles.onbQuestion}>Any foods to avoid?</Text>
                <Text style={styles.onbHint}>
                  This is for foods you don&apos;t enjoy — your allergies are already saved in your profile.
                </Text>
                <View style={styles.tokenInputRow}>
                  <TextInput
                    style={styles.tokenInput}
                    value={avoidInput}
                    onChangeText={setAvoidInput}
                    placeholder="e.g. cilantro, liver"
                    placeholderTextColor={COLORS.textMuted}
                    onSubmitEditing={() => { addAvoidToken(avoidInput); setAvoidInput(''); }}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={[styles.tokenAddBtn, !avoidInput.trim() && styles.disabledBtn]}
                    disabled={!avoidInput.trim()}
                    onPress={() => { addAvoidToken(avoidInput); setAvoidInput(''); }}
                  >
                    <Text style={styles.tokenAddBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.chipGrid}>
                  {AVOID_SUGGESTIONS.map(s => {
                    const active = prefs.avoid.some(l => l.toLowerCase() === s.toLowerCase());
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => active ? removeAvoidToken(prefs.avoid.find(l => l.toLowerCase() === s.toLowerCase())!) : addAvoidToken(s)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {prefs.avoid.length > 0 && (
                  <View style={styles.tokenList}>
                    <Text style={styles.tokenListLabel}>Added</Text>
                    <View style={styles.chipGrid}>
                      {prefs.avoid.map(t => (
                        <TouchableOpacity
                          key={t}
                          style={[styles.chip, styles.chipActive]}
                          onPress={() => removeAvoidToken(t)}
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
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.guideCta]}
              onPress={goNext}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{isLast ? 'Start picking meals' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ── All-slots-skipped guard ─────────────────────────────────────────────
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

  function isSelected(slot: MealSlot, recipeId: string): boolean {
    return selectionsForSlot(slot).some(r => r.id === recipeId);
  }

  function toggleSelection(slot: MealSlot, recipe: RecipeTemplate) {
    setSelectionsBySlot(prev => {
      const list = prev[slot.id] ?? [];
      const exists = list.some(r => r.id === recipe.id);
      const next = exists
        ? list.filter(r => r.id !== recipe.id)
        : [...list, recipe];
      return { ...prev, [slot.id]: next };
    });
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

  // "Suggest more": fetch a fresh batch of unseen meals and append. Suggest
  // more is always available; tracking is purely for the popup nudge.
  function addAutoPage(slot: MealSlot) {
    const pool = byCategory[categoryForSlot(slot.name)] ?? [];
    const shown = new Set<string>();
    mealsForSlot(slot).forEach(c => shown.add(c.id));
    const cards = buildAutoPage(pool, shown, SUGGEST_BATCH);
    if (cards.length === 0) {
      // Pool exhausted — silently fall back to nudging Describe.
      showToast('No more options — try Describe for custom ideas');
      return;
    }
    appendMealsForSlot(slot, cards, /* isSuggestMore */ true);
  }

  // Describe: generate a single custom card from the user's prompt and append.
  function addDescribePage(slot: MealSlot, rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    const card = generateCustomCard(text, categoryForSlot(slot.name));
    appendMealsForSlot(slot, [card], /* isSuggestMore */ false);
    showToast('Generated new option');
  }

  function handleCardPress(slot: MealSlot, recipe: RecipeTemplate) {
    // In normal mode, tap toggles selection.
    if (mode.kind === 'normal') {
      toggleSelection(slot, recipe);
      return;
    }
    // In preview-swap mode, swap the chosen recipe into the targeted preview meal.
    if (mode.kind === 'preview-swap') {
      const { dayIdx, mealIdx } = mode;
      setPreviewDays(prev => prev.map((day, di) =>
        di === dayIdx
          ? day.map((m, mi) => mi === mealIdx ? { ...m, recipeId: recipe.id, recipeName: recipe.name } : m)
          : day,
      ));
      setMode({ kind: 'normal' });
      setStep({ kind: 'preview' });
      return;
    }
    // In summary-swap mode, replace the targeted recipe in selections for that slot.
    if (mode.kind === 'summary-swap') {
      const targetSlot = activeSlots[mode.slotIdx];
      if (!targetSlot) return;
      setSelectionsBySlot(prev => {
        const list = prev[targetSlot.id] ?? [];
        const next = list.map(r => r.id === mode.oldRecipeId ? recipe : r);
        return { ...prev, [targetSlot.id]: next };
      });
      setMode({ kind: 'normal' });
      setStep({ kind: 'summary', slotIdx: mode.slotIdx });
    }
  }

  function handleContinueFromPick(slot: MealSlot, slotIdx: number) {
    const sel = selectionsForSlot(slot);
    if (sel.length === 0) {
      Alert.alert(
        'Pick at least one meal',
        `Select at least one ${slot.name.toLowerCase()} or skip this slot.`,
      );
      return;
    }
    if (sel.length === 1) {
      Alert.alert(
        `You've selected 1 ${slot.name.toLowerCase()}`,
        `Your plan will have the same ${slot.name.toLowerCase()} every day.`,
        [
          { text: 'Select more', style: 'cancel' },
          { text: 'Continue anyway', onPress: () => setStep({ kind: 'summary', slotIdx }) },
        ],
      );
      return;
    }
    setStep({ kind: 'summary', slotIdx });
  }

  function handleSkipSlot(slot: MealSlot, slotIdx: number) {
    Alert.alert(
      `No ${slot.name}?`,
      `${slot.name} will be removed from your plan entirely.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: () => {
            // Clear selections for this slot, then advance.
            setSelectionsBySlot(prev => ({ ...prev, [slot.id]: [] }));
            advanceFromSlot(slotIdx, /* skipped */ true);
          },
        },
      ],
    );
  }

  function advanceFromSlot(slotIdx: number, _skipped: boolean) {
    if (slotIdx >= activeSlots.length - 1) {
      // Build the preview and head there.
      const days = buildPreviewDays(activeSlots, selectionsBySlot);
      setPreviewDays(days);
      setExpandedDays(new Set([0]));
      setStep({ kind: 'preview' });
      return;
    }
    // Forward navigation: if the next slot is already completed (has selections),
    // show its summary instead of forcing the user back through the pick page.
    // Otherwise show the pick page so the user can choose meals for that slot.
    const nextIdx = slotIdx + 1;
    const nextSlot = activeSlots[nextIdx];
    const nextHasSelections = (selectionsBySlot[nextSlot.id] ?? []).length > 0;
    setStep(
      nextHasSelections
        ? { kind: 'summary', slotIdx: nextIdx }
        : { kind: 'pick', slotIdx: nextIdx },
    );
  }

  function handleBackFromPick(slotIdx: number) {
    if (slotIdx === 0) {
      // First slot's pick → return to the guide page.
      setStep({ kind: 'guide' });
      return;
    }
    // Go back to the previous slot's summary.
    setStep({ kind: 'summary', slotIdx: slotIdx - 1 });
  }

  function handleBackFromSummary(slotIdx: number) {
    // Per spec: from first slot's summary, back returns to that slot's pick step.
    if (slotIdx === 0) {
      setStep({ kind: 'pick', slotIdx: 0 });
      return;
    }
    setStep({ kind: 'summary', slotIdx: slotIdx - 1 });
  }

  // ── Activate flow ──────────────────────────────────────────────────────
  function handleActivate() {
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

  // ── Render: PICK step ───────────────────────────────────────────────────
  if (step.kind === 'pick') {
    const slot = activeSlots[step.slotIdx];
    const slotPages = pagesForSlot(slot);
    const sel = selectionsForSlot(slot);
    const currentPageIdx = pageIdxBySlot[slot.id] ?? 0;

    const headerTitle = slot.name;
    const headerSubtitle = mode.kind === 'preview-swap'
      ? `Swap meal · ${slot.name}`
      : mode.kind === 'summary-swap'
      ? `Swap meal · ${slot.name}`
      : undefined;

    return (
      <Screen edges={['top', 'bottom']}>
        {/* Progress bar — only in normal flow. Suppressed in swap modes. */}
        {mode.kind === 'normal' && (
          <StepProgressBar
            step={step.slotIdx + 1}
            total={activeSlots.length}
            label={slot.name}
          />
        )}

        <Header
          title={headerTitle}
          subtitle={headerSubtitle}
          onBack={() => {
            if (mode.kind !== 'normal') {
              setMode({ kind: 'normal' });
              setStep(mode.kind === 'preview-swap' ? { kind: 'preview' } : { kind: 'summary', slotIdx: mode.slotIdx });
              return;
            }
            handleBackFromPick(step.slotIdx);
          }}
          rightAction={
            mode.kind === 'normal' ? (
              <TouchableOpacity onPress={() => handleContinueFromPick(slot, step.slotIdx)} hitSlop={10}>
                <Text style={styles.headerRightText}>Continue</Text>
              </TouchableOpacity>
            ) : null
          }
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
                {mode.kind === 'normal'
                  ? `Pick your favourites. We'll rotate them through the week.`
                  : `Tap a card to swap.`}
              </Text>
              {mode.kind === 'normal' && (
                <Text style={styles.pickCounter}>{sel.length} selected</Text>
              )}
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
                          selected={isSelected(slot, r.id)}
                          showCheck={mode.kind === 'normal'}
                          onPress={() => handleCardPress(slot, r)}
                        />
                      ))}
                      {/* Suggest more sits on the last page only and is
                          always visible — clicking it 5 times triggers the
                          Describe-suggestion popup once per slot. */}
                      {page.isLast && (
                        <TouchableOpacity
                          style={styles.findMoreCard}
                          onPress={() => addAutoPage(slot)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.findMoreEmoji}>✨</Text>
                          <Text style={styles.findMoreText}>Suggest more</Text>
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
              {mode.kind === 'normal' && (
                <TouchableOpacity
                  style={styles.skipRow}
                  onPress={() => handleSkipSlot(slot, step.slotIdx)}
                >
                  <Text style={styles.skipText}>No {slot.name}</Text>
                </TouchableOpacity>
              )}
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
                  style={[styles.describeGenBtn, !describeModalText.trim() && styles.disabledBtn]}
                  disabled={!describeModalText.trim()}
                  onPress={() => {
                    const text = describeModalText.trim();
                    if (!text) return;
                    addDescribePage(slot, text);
                    setDescribeModalVisible(false);
                    setDescribeModalText('');
                  }}
                >
                  <Text style={styles.describeGenBtnText}>Generate</Text>
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

  // ── Render: SUMMARY step ───────────────────────────────────────────────
  if (step.kind === 'summary') {
    const slot = activeSlots[step.slotIdx];
    const sel = selectionsForSlot(slot);
    const avgCalories = sel.length === 0 ? 0 : Math.round(sel.reduce((s, r) => s + r.calories, 0) / sel.length);
    const avgProtein = sel.length === 0 ? 0 : Math.round(sel.reduce((s, r) => s + r.macros.protein, 0) / sel.length);

    return (
      <Screen edges={['top', 'bottom']}>
        {/* Progress bar — same step number as the corresponding pick page,
            since the summary belongs to that meal type. */}
        <StepProgressBar
          step={step.slotIdx + 1}
          total={activeSlots.length}
          label={`${slot.name} · Summary`}
        />

        <Header
          title={slot.name}
          subtitle="Summary"
          onBack={() => handleBackFromSummary(step.slotIdx)}
          rightAction={
            <TouchableOpacity
              onPress={() => advanceFromSlot(step.slotIdx, false)}
              hitSlop={10}
            >
              <Text style={styles.headerRightText}>Continue</Text>
            </TouchableOpacity>
          }
        />

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryCount}>{sel.length} selected</Text>
            <Text style={styles.summaryAvg}>
              avg {avgCalories} cal · {avgProtein}g protein
            </Text>
          </View>

          {sel.map(r => (
            <View key={r.id} style={styles.summaryRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.summaryMeta}>{r.calories} cal · P {r.macros.protein}g</Text>
              </View>
              <TouchableOpacity
                style={styles.swapBtn}
                onPress={() => {
                  setMode({ kind: 'summary-swap', slotIdx: step.slotIdx, oldRecipeId: r.id });
                  setStep({ kind: 'pick', slotIdx: step.slotIdx });
                }}
              >
                <Text style={styles.swapBtnText}>Swap</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            style={styles.addMoreBtn}
            onPress={() => setStep({ kind: 'pick', slotIdx: step.slotIdx })}
          >
            <Text style={styles.addMoreText}>+ Add more</Text>
          </TouchableOpacity>
        </ScrollView>
      </Screen>
    );
  }

  // ── Render: PREVIEW step ───────────────────────────────────────────────

  // Plan-wide totals + the unique meal list shown at the top of the preview.
  // Recipes are looked up by id so we can render calorie/macro details for
  // catalogue items; custom (Describe-generated) picks fall back to the
  // PlanDayMeal name only.
  const recipeById = new Map<string, RecipeTemplate>();
  recipes.forEach(r => recipeById.set(r.id, r));
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
        onBack={() => setStep({ kind: 'summary', slotIdx: activeSlots.length - 1 })}
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
                            setPreviewDays(prev => prev.map((d, di) =>
                              di === quickSwap.dayIdx
                                ? d.map((m, mi) => mi === quickSwap.mealIdx
                                    ? { ...m, recipeId: c.id, recipeName: c.name }
                                    : m)
                                : d,
                            ));
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
    backgroundColor: COLORS.card,
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
});
