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
const PAGE_SIZE = 4;
const AUTO_PAGE_CAP = 3;

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
  const [step, setStep] = useState<Step>({ kind: 'pick', slotIdx: 0 });
  const [mode, setMode] = useState<Mode>({ kind: 'normal' });
  // Per-slot: pages of recipe cards. Keyed by slot.id so it survives even if
  // active slots are recomputed (e.g. user toggles a slot mid-session).
  const [pagesBySlot, setPagesBySlot] = useState<Record<string, Page[]>>({});
  // Per-slot selected recipes preserved in user-pick order.
  const [selectionsBySlot, setSelectionsBySlot] = useState<Record<string, RecipeTemplate[]>>({});
  // Per-slot describe input current value (preserved when paging).
  const [describeBySlot, setDescribeBySlot] = useState<Record<string, string>>({});
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

  function addDescribePage(slot: MealSlot) {
    const text = (describeBySlot[slot.id] ?? '').trim();
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
    setDescribeBySlot(prev => ({ ...prev, [slot.id]: '' }));
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
      router.back();
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
      : `Step ${step.slotIdx + 1} of ${activeSlots.length}`;
    const counterText = mode.kind === 'normal'
      ? `${sel.length} selected`
      : 'Tap a card to swap';

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
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

        <View style={styles.subHeaderRow}>
          <Text style={styles.subHeaderCounter}>{counterText}</Text>
          {slotPages.length > 1 && (
            <View style={styles.dotsRow}>
              {slotPages.map((_, idx) => (
                <View
                  key={idx}
                  style={[styles.dot, currentPageIdx === idx && styles.dotActive]}
                />
              ))}
            </View>
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
                    {/* "Find more" card or replacement message at the bottom of each page. */}
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
                          <Text style={styles.findMoreText}>Find more</Text>
                        </TouchableOpacity>
                      )
                    )}
                  </ScrollView>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Always-on Describe input + skip row */}
          <View style={styles.bottomBar}>
            <View style={styles.describeBox}>
              <TextInput
                style={styles.describeInput}
                value={describeBySlot[slot.id] ?? ''}
                onChangeText={text => setDescribeBySlot(prev => ({ ...prev, [slot.id]: text }))}
                placeholder={`Describe what you want for ${slot.name.toLowerCase()}`}
                placeholderTextColor={COLORS.textMuted}
                multiline
              />
              <TouchableOpacity
                style={[styles.describeBtn, !(describeBySlot[slot.id] ?? '').trim() && styles.disabledBtn]}
                disabled={!(describeBySlot[slot.id] ?? '').trim()}
                onPress={() => addDescribePage(slot)}
              >
                <Text style={styles.describeBtnText}>Generate</Text>
              </TouchableOpacity>
            </View>
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
        <Header
          title={slot.name}
          subtitle={`Step ${step.slotIdx + 1} of ${activeSlots.length} · Summary`}
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
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header
        title="Preview your plan"
        subtitle="Tap any meal to swap it"
        onBack={() => setStep({ kind: 'summary', slotIdx: activeSlots.length - 1 })}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {previewDays.map((day, dayIdx) => {
          const expanded = expandedDays.has(dayIdx);
          const recipeById = new Map<string, RecipeTemplate>();
          recipes.forEach(r => recipeById.set(r.id, r));
          // Custom cards aren't in `recipes` — fall back to PlanDayMeal for display only.
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
                              // Open the slot's pick step in preview-swap mode.
                              const slotIdx = activeSlots.findIndex(s => s.name === meal.slotName);
                              if (slotIdx === -1) return;
                              setMode({ kind: 'preview-swap', dayIdx, mealIdx });
                              setStep({ kind: 'pick', slotIdx });
                            }}
                          >
                            <Text style={styles.findDifferentText}>New</Text>
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

      <View style={styles.footer}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep({ kind: 'summary', slotIdx: activeSlots.length - 1 })}>
          <Text style={styles.secondaryBtnText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleActivate}>
          <Text style={styles.primaryBtnText}>Activate Plan</Text>
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

  subHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  subHeaderCounter: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  dotsRow: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.green, width: 14 },

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
  },
  describeBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  describeInput: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 13,
    minHeight: 42,
    maxHeight: 96,
    textAlignVertical: 'top',
  },
  describeBtn: {
    backgroundColor: COLORS.green + '22',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: COLORS.green,
  },
  describeBtnText: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
  disabledBtn: { opacity: 0.4 },

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
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },

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
