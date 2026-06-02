import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
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
const PAGE_SIZE = 5;
const AUTO_PAGE_CAP = 3;
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

// Rank recipes by goal-aware score (higher = better fit).
function rankForGoal(recipes: RecipeTemplate[], profile: UserProfile): RecipeTemplate[] {
  const goal = profile.goalType;
  const scored = recipes.map(r => {
    let score = 0;
    if (goal === 'gain_muscle' || goal === 'lean_bulk') score += r.macros.protein * 1.2;
    if (goal === 'lose_weight') score -= r.calories * 0.5;
    if (goal === 'maintain') score += r.macros.protein * 0.5;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.r);
}

interface Page {
  kind: 'auto' | 'describe';
  cards: RecipeTemplate[];
}

function buildAutoPage(
  pool: RecipeTemplate[],
  alreadyShownIds: Set<string>,
): RecipeTemplate[] {
  return pool.filter(r => !alreadyShownIds.has(r.id)).slice(0, PAGE_SIZE);
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

function autoPageCount(pages: Page[]): number {
  return pages.filter(p => p.kind === 'auto').length;
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
  | { kind: 'pick'; slotIdx: number }
  | { kind: 'summary'; slotIdx: number }
  | { kind: 'preview' };

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function BuildPlanScreen() {
  const profile = useMealStore(s => s.profile);
  const recipes = useMealStore(s => s.recipes);
  const templates = useMealStore(s => s.templates);
  const activatePlan = useMealStore(s => s.activatePlan);
  const saveCurrentPlanAs = useMealStore(s => s.saveCurrentPlanAs);
  const showToast = useToastStore(s => s.showToast);

  // Active slots: only those not skipped, sorted by time so the wizard walks
  // them in the canonical order Breakfast → Mid-morning → Lunch → ... → Dinner.
  const activeSlots = useMemo<MealSlot[]>(
    () => profile.mealSlots.filter(s => !s.skipped).sort((a, b) => a.time.localeCompare(b.time)),
    [profile.mealSlots],
  );

  const dietaryFiltered = useMemo(() => applyDietaryFilter(recipes, profile), [recipes, profile]);
  const byCategory = useMemo<Record<RecipeCategory, RecipeTemplate[]>>(() => {
    const map: Record<RecipeCategory, RecipeTemplate[]> = {
      Breakfast: [], Lunch: [], Dinner: [], Snacks: [],
    };
    rankForGoal(dietaryFiltered, profile).forEach(r => { map[r.category].push(r); });
    return map;
  }, [dietaryFiltered, profile]);

  // ── Wizard state ────────────────────────────────────────────────────────
  // The wizard always opens on the guide page so the user knows what's
  // about to happen before being dropped into meal selection.
  const [step, setStep] = useState<Step>({ kind: 'guide' });
  const [mode, setMode] = useState<Mode>({ kind: 'normal' });
  // Describe popup state — opened from the bottom button on each pick page.
  const [describeModalVisible, setDescribeModalVisible] = useState(false);
  const [describeModalText, setDescribeModalText] = useState('');
  // Preview "Meals in this plan" collapse state.
  const [previewMealsExpanded, setPreviewMealsExpanded] = useState(false);
  // Per-slot: pages of recipe cards. Keyed by slot.id so it survives even if
  // active slots are recomputed (e.g. user toggles a slot mid-session).
  const [pagesBySlot, setPagesBySlot] = useState<Record<string, Page[]>>({});
  // Per-slot selected recipes preserved in user-pick order.
  const [selectionsBySlot, setSelectionsBySlot] = useState<Record<string, RecipeTemplate[]>>({});
  // Per-slot active page index in the horizontal pager.
  const [pageIdxBySlot, setPageIdxBySlot] = useState<Record<string, number>>({});
  // Preview state
  const [previewDays, setPreviewDays] = useState<PlanDayMeal[][]>([]);
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set([0]));
  const [quickSwap, setQuickSwap] = useState<{ dayIdx: number; mealIdx: number } | null>(null);

  // Pager geometry
  const [pageWidth, setPageWidth] = useState(0);
  const pagerRef = useRef<ScrollView | null>(null);

  // ── Initialisation: seed first auto-page for the current pick slot ─────
  useEffect(() => {
    if (step.kind !== 'pick') return;
    const slot = activeSlots[step.slotIdx];
    if (!slot) return;
    if (pagesBySlot[slot.id]) return;
    const pool = byCategory[categoryForSlot(slot.name)] ?? [];
    const initial: Page = { kind: 'auto', cards: buildAutoPage(pool, new Set()) };
    setPagesBySlot(prev => ({ ...prev, [slot.id]: [initial] }));
    setPageIdxBySlot(prev => ({ ...prev, [slot.id]: prev[slot.id] ?? 0 }));
  }, [step, activeSlots, byCategory, pagesBySlot]);

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

  // ── Guide preview (initial step) ────────────────────────────────────────
  // Sits in front of the meal selection wizard so the user has a moment to
  // see their goal/preferences and understand what's about to happen.
  if (step.kind === 'guide') {
    const dietary = profile.dietaryRestrictions ?? [];
    const allergies = profile.allergies ?? [];
    const hasPrefs = dietary.length > 0 || allergies.length > 0;
    const slotCount = activeSlots.length;

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title="Build My Plan" onBack={() => router.back()} />

        <ScrollView contentContainerStyle={styles.guideBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.guideHero}>Let&apos;s build your week</Text>
          <Text style={styles.guideHeroSub}>
            Based on your goal{profile.firstName ? `, ${profile.firstName}` : ''}, we&apos;ll suggest meals tailored just for you.
          </Text>

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

          {!hasPrefs && (
            <Text style={styles.guideHint}>
              You can update your dietary preferences or allergies any time in your Profile.
            </Text>
          )}

          <View style={styles.guideStepsCard}>
            <Text style={styles.guideStepsTitle}>How it works</Text>
            <View style={styles.guideStepRow}>
              <View style={styles.guideStepBullet}><Text style={styles.guideStepBulletText}>1</Text></View>
              <Text style={styles.guideStepText}>
                We&apos;ll walk you through your {slotCount} meal {slotCount === 1 ? 'slot' : 'slots'} for the day.
              </Text>
            </View>
            <View style={styles.guideStepRow}>
              <View style={styles.guideStepBullet}><Text style={styles.guideStepBulletText}>2</Text></View>
              <Text style={styles.guideStepText}>
                Pick your favourites from the suggestions, or describe what you want.
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

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.primaryBtn, styles.guideCta]}
            onPress={() => setStep({ kind: 'pick', slotIdx: 0 })}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Let&apos;s go</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── All-slots-skipped guard ─────────────────────────────────────────────
  if (activeSlots.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
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
      </SafeAreaView>
    );
  }

  // ── Helpers wired to closure state ─────────────────────────────────────
  function pagesForSlot(slot: MealSlot): Page[] {
    return pagesBySlot[slot.id] ?? [];
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

  function addAutoPage(slot: MealSlot) {
    const pool = byCategory[categoryForSlot(slot.name)] ?? [];
    const shown = new Set<string>();
    pagesForSlot(slot).forEach(p => p.cards.forEach(c => shown.add(c.id)));
    const cards = buildAutoPage(pool, shown);
    if (cards.length === 0) return;
    setPagesBySlot(prev => {
      const next = [...(prev[slot.id] ?? []), { kind: 'auto' as const, cards }];
      return { ...prev, [slot.id]: next };
    });
    setPageIdxBySlot(prev => ({
      ...prev,
      [slot.id]: (prev[slot.id] ?? 0) + 1,
    }));
  }

  // Append a Describe-generated page using the user's free-form text.
  function addDescribePage(slot: MealSlot, rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    const cards = [generateCustomCard(text, categoryForSlot(slot.name))];
    setPagesBySlot(prev => {
      const next = [...(prev[slot.id] ?? []), { kind: 'describe' as const, cards }];
      return { ...prev, [slot.id]: next };
    });
    setPageIdxBySlot(prev => {
      const current = prev[slot.id] ?? 0;
      const newPageIdx = (pagesBySlot[slot.id] ?? []).length; // index of the page we just appended
      return { ...prev, [slot.id]: Math.max(current, newPageIdx) };
    });
    showToast('Generated new options');
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

  function advanceFromSlot(slotIdx: number, skipped: boolean) {
    if (slotIdx >= activeSlots.length - 1) {
      // Build the preview and head there.
      const days = buildPreviewDays(activeSlots, selectionsBySlot);
      setPreviewDays(days);
      setExpandedDays(new Set([0]));
      setStep({ kind: 'preview' });
      return;
    }
    if (skipped) {
      // Skipped slots jump to the next slot's pick step (no summary for this one).
      setStep({ kind: 'pick', slotIdx: slotIdx + 1 });
    } else {
      // Normal continue jumps to summary first, but in this helper we only advance
      // to the next slot's pick. Summary→continue calls this directly.
      setStep({ kind: 'pick', slotIdx: slotIdx + 1 });
    }
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
      id: `plan-built-${Date.now()}`,
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
    const autoCount = autoPageCount(slotPages);
    const findMoreLocked = autoCount >= AUTO_PAGE_CAP + 1; // initial page counts as 1 auto, cap is +3 more
    const currentPageIdx = pageIdxBySlot[slot.id] ?? 0;

    const headerTitle = slot.name;
    const headerSubtitle = mode.kind === 'preview-swap'
      ? `Swap meal · ${slot.name}`
      : mode.kind === 'summary-swap'
      ? `Swap meal · ${slot.name}`
      : undefined;

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
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

        {/* Dots — centered, just below the header. */}
        {slotPages.length > 1 && (
          <View style={styles.dotsCenterRow}>
            {slotPages.map((_, idx) => (
              <View
                key={idx}
                style={[styles.dot, currentPageIdx === idx && styles.dotActive]}
              />
            ))}
          </View>
        )}

        {/* Explanatory copy + selection counter. */}
        <View style={styles.pickIntro}>
          <Text style={styles.pickIntroText}>
            {mode.kind === 'normal'
              ? `Pick your favourites. We'll rotate them through the week.`
              : `Tap a card to swap.`}
          </Text>
          {mode.kind === 'normal' && (
            <Text style={styles.pickCounter}>{sel.length} selected</Text>
          )}
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={{ flex: 1 }}
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
                    {page.kind === 'describe' && (
                      <View style={styles.describeBadge}>
                        <Text style={styles.describeBadgeText}>From your description</Text>
                      </View>
                    )}
                    {page.cards.map(r => (
                      <PickCard
                        key={r.id}
                        recipe={r}
                        selected={isSelected(slot, r.id)}
                        showCheck={mode.kind === 'normal'}
                        onPress={() => handleCardPress(slot, r)}
                      />
                    ))}
                    {/* "Suggest more" card or replacement message at the bottom of each page. */}
                    {pageIdx === slotPages.length - 1 && (
                      findMoreLocked ? (
                        <View style={styles.findMoreLocked}>
                          <Text style={styles.findMoreLockedText}>
                            That&apos;s all for auto-suggestions. Use &ldquo;Describe what you want&rdquo;
                            below for unlimited options.
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.findMoreCard}
                          onPress={() => addAutoPage(slot)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.findMoreEmoji}>✨</Text>
                          <Text style={styles.findMoreText}>Suggest more</Text>
                        </TouchableOpacity>
                      )
                    )}
                  </ScrollView>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Bottom bar: Describe button + skip link. */}
          <View style={styles.bottomBar}>
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
      </SafeAreaView>
    );
  }

  // ── Render: SUMMARY step ───────────────────────────────────────────────
  if (step.kind === 'summary') {
    const slot = activeSlots[step.slotIdx];
    const sel = selectionsForSlot(slot);
    const avgCalories = sel.length === 0 ? 0 : Math.round(sel.reduce((s, r) => s + r.calories, 0) / sel.length);
    const avgProtein = sel.length === 0 ? 0 : Math.round(sel.reduce((s, r) => s + r.macros.protein, 0) / sel.length);

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
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
      </SafeAreaView>
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
    <SafeAreaView style={styles.safe} edges={['top']}>
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
                            <Text style={styles.findDifferentText}>Find different meal</Text>
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
      <View style={styles.footer}>
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
    </SafeAreaView>
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
  showCheck: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.pickCard, selected && styles.pickCardSelected]}
    >
      <View style={styles.pickHead}>
        <Text style={styles.pickName} numberOfLines={1}>{recipe.name}</Text>
        {showCheck && (
          <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
            {selected ? <Text style={styles.checkMark}>✓</Text> : null}
          </View>
        )}
      </View>
      <Text style={styles.pickMeta}>{recipe.calories} cal · {recipe.cookTimeMin}m</Text>
      <View style={styles.macroRow}>
        <Text style={styles.macroPill}>P {recipe.macros.protein}g</Text>
        <Text style={styles.macroPill}>C {recipe.macros.carbs}g</Text>
        <Text style={styles.macroPill}>F {recipe.macros.fats}g</Text>
      </View>
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

  // Pick page chrome
  dotsCenterRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
    paddingBottom: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.green, width: 14 },
  pickIntro: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 4,
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
  pageBody: { padding: 16, paddingBottom: 16 },

  describeBadge: {
    backgroundColor: COLORS.purple + '22',
    borderColor: COLORS.purple,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  describeBadgeText: { color: COLORS.purple, fontSize: 11, fontWeight: '700' },

  pickCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  pickCardSelected: { borderColor: COLORS.green, backgroundColor: COLORS.green + '14' },
  pickHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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

  checkCircle: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.textSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  checkCircleSelected: { borderColor: COLORS.green, backgroundColor: COLORS.green },
  checkMark: { color: '#0E1A12', fontSize: 14, fontWeight: '900' },

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

  findMoreLocked: {
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  findMoreLockedText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },

  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
    gap: 4,
  },
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
    paddingBottom: 14,
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
  guideBody: { padding: 16, paddingBottom: 24, gap: 16 },
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
