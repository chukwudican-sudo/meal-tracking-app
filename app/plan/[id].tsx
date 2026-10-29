import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { MealPlan, MealSlot, PlanDayMeal, RecipeTemplate } from '@/store/types';
import { slotNameToCategory } from '@/utils/mealSlots';
import { confirmCustomizeSave, confirmPlanActivation } from '@/lib/planActivation';
import { EMPTY_SLOT, REMOVED_SLOT } from '@/constants/planSlots';


const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function PlanDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  // Direct safe-area math: a fixed inset value collapses to 0 on
  // non-notched devices once SafeAreaView eats it. Re-floor here so the
  // footer never feels glued to the edge.
  const insets = useSafeAreaInsets();
  const footerBottomPad = Math.max(insets.bottom, 16) + 16;

  const plans = useMealStore(s => s.plans);
  const savedPlans = useMealStore(s => s.savedPlans);
  const recipes = useMealStore(s => s.recipes);
  const profile = useMealStore(s => s.profile);
  const activatePlan = useMealStore(s => s.activatePlan);
  const endPlan = useMealStore(s => s.endPlan);
  const saveCurrentPlanAs = useMealStore(s => s.saveCurrentPlanAs);
  const saveCustomizedPlan = useMealStore(s => s.saveCustomizedPlan);
  const setCustomizeDraft = useMealStore(s => s.setCustomizeDraft);
  const clearCustomizeDraft = useMealStore(s => s.clearCustomizeDraft);
  const setPendingSwap = useMealStore(s => s.setPendingSwap);
  const showToast = useToastStore(s => s.showToast);
  const showUndo = useUndoStore(s => s.showUndo);

  const storedPlan: MealPlan | undefined = useMemo(
    () => plans.find(p => p.id === id) ?? savedPlans.find(p => p.id === id),
    [plans, savedPlans, id],
  );

  // ── Customize Plan state ────────────────────────────────────────────
  // We deep-clone the stored plan when entering customize mode so the user
  // can freely edit until they hit Save (commits via saveCustomizedPlan) or
  // discard via the back arrow.
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [draftPlan, setDraftPlan] = useState<MealPlan | null>(null);
  // Whether the "Meals in this plan" list is collapsed (default) or expanded.
  // Matches the same See more / See less pattern used on the Build My Plan
  // preview screen.
  const [mealsExpanded, setMealsExpanded] = useState(false);

  // ── Day-editor modal state (only used in customize mode) ───────────────
  // Hooks must run on every render, so they live above the `if (!plan)`
  // early-return below. State is only meaningfully populated while the
  // user is inside the customize flow.
  const [editingDayIdx, setEditingDayIdx] = useState<number | null>(null);
  // Day index awaiting the "Add meal slot" popup (null = popup closed).
  const [addSlotDayIdx, setAddSlotDayIdx] = useState<number | null>(null);

  // Follow the store draft while customizing: a swap Undo restores it while
  // this page is already open (no focus event to re-read it).
  const storeDraft = useMealStore(s => s.customizeDraft);
  useEffect(() => {
    if (isCustomizing && storeDraft && storeDraft.planId === id) setDraftPlan(storeDraft.draftPlan);
  }, [storeDraft, isCustomizing, id]);

  // Reset the draft if the underlying plan id changes while mounted.
  useEffect(() => {
    if (!isCustomizing) setDraftPlan(null);
  }, [isCustomizing, id]);

  // When returning from the Saved Recipes swap page, pull the updated draft
  // from the store so the swap shows up in the day editor / weekly schedule.
  useFocusEffect(
    useCallback(() => {
      if (!isCustomizing) return;
      // Read the store directly: a closure value is from before the swap
      // round-trip, so the picked recipe was silently discarded (Oct 28 bug).
      const latest = useMealStore.getState().customizeDraft;
      if (latest && latest.planId === id) {
        setDraftPlan(latest.draftPlan);
      }
    }, [isCustomizing, id]),
  );

  // The plan we render — draft when customizing, otherwise the stored copy.
  const plan: MealPlan | undefined = isCustomizing && draftPlan ? draftPlan : storedPlan;

  const recipeById = useMemo(() => {
    const m = new Map<string, RecipeTemplate>();
    recipes.forEach(r => m.set(r.id, r));
    return m;
  }, [recipes]);

  // Non-skipped meal slots from the user's profile, sorted by time.
  // Used by the customize-day Add-meal flow to populate the slot chips.
  // Hook is hoisted above the `if (!plan)` early-return below so it runs
  // on every render.
  const slotOptions = useMemo<MealSlot[]>(
    () =>
      (profile.mealSlots ?? [])
        .filter(s => !s.skipped)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [profile.mealSlots],
  );

  // Build distinct recipe list for the "Meals in this plan" section.
  const distinctMeals = useMemo(() => {
    if (!plan) return [] as { recipeId: string; recipeName: string }[];
    const seen = new Map<string, { recipeId: string; recipeName: string }>();
    plan.days.forEach(day =>
      day.forEach(m => {
        // Older plans stored a shared placeholder id ('custom') for every meal,
        // which collapsed the whole list into one row. Fall back to the meal
        // name as the dedupe key so all unique meals surface.
        const key = m.recipeId && m.recipeId !== 'custom' ? m.recipeId : m.recipeName;
        if (!seen.has(key)) {
          seen.set(key, { recipeId: m.recipeId, recipeName: m.recipeName });
        }
      }),
    );
    return Array.from(seen.values());
  }, [plan]);

  if (!plan) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.headerBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Plan not found</Text>
          <View style={styles.headerBack} />
        </View>
      </Screen>
    );
  }

  // A plan is "current" when its name matches the user's activePlanName.
  // Only current plans get the Customize Plan flow.
  const isCurrent = !!profile.activePlanName && plan.name === profile.activePlanName;

  // ── Customize handlers ──────────────────────────────────────────────

  const handleStartCustomize = () => {
    if (!storedPlan) return;
    // Deep clone via JSON to ensure nested arrays are independent from the
    // store snapshot. The plan is small (≤7 days × ~5 meals) so this is fine.
    const clone: MealPlan = JSON.parse(JSON.stringify(storedPlan));
    setDraftPlan(clone);
    setIsCustomizing(true);
    // Mirror into the store so a Swap round-trip to Saved Recipes can read it.
    setCustomizeDraft({ planId: storedPlan.id, draftPlan: clone });
  };

  const handleSaveCustomize = () => {
    if (!draftPlan || !storedPlan) return;
    const draft = draftPlan;
    const source = storedPlan;
    confirmCustomizeSave(() => {
      const applied = saveCustomizedPlan(source.id, draft);
      setIsCustomizing(false);
      setDraftPlan(null);
      clearCustomizeDraft();
      if (applied.id !== source.id) {
        // Explore plan -> the user's own copy; show that (it's the current one).
        showToast(`Saved as ${applied.name}`);
        router.replace({ pathname: '/plan/[id]', params: { id: applied.id } });
      } else if (applied !== source) {
        showToast('Plan updated');
      }
    });
  };

  const handleCancelCustomize = () => {
    Alert.alert(
      'Discard changes?',
      'All unsaved changes will be lost.',
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            setIsCustomizing(false);
            setDraftPlan(null);
            clearCustomizeDraft();
          },
        },
      ],
    );
  };

  const handleBackPress = () => {
    if (isCustomizing) {
      handleCancelCustomize();
      return;
    }
    router.back();
  };

  // Globally remove every occurrence of a recipe across all 7 days.
  // Days that lose a meal show a "Removed" placeholder so the user can see
  // exactly where the gaps are and decide what to swap in.
  const handleGlobalRemove = (recipeId: string, recipeName: string) => {
    if (!draftPlan) return;
    // Snapshot for the 5-second undo.
    const snapshot: MealPlan = JSON.parse(JSON.stringify(draftPlan));
    setDraftPlan({
      ...draftPlan,
      days: draftPlan.days.map(day =>
        day.map(m =>
          m.recipeId === recipeId
            ? { ...m, recipeName: 'Removed', recipeId: REMOVED_SLOT }
            : m,
        ),
      ),
    });
    showUndo({
      message: `Removed ${recipeName} from plan`,
      undo: () => setDraftPlan(snapshot),
    });
  };

  // Swap (or fill) a slot for one day. Mirrors the current draft into the
  // store and navigates to the Saved Recipes page in swap mode. On return,
  // useFocusEffect pulls the updated draft back in.
  const handlePlanSwap = (dayIdx: number, slotName: string, time: string) => {
    if (!draftPlan || !storedPlan) return;
    setCustomizeDraft({ planId: storedPlan.id, draftPlan });
    const cat = slotNameToCategory(slotName);
    setPendingSwap({ type: 'plan', dayIdx, slotName, time, category: cat });
    router.push({
      pathname: '/recipes/saved',
      params: { swapMode: 'true', ...(cat ? { swapFilter: cat } : {}) },
    });
  };

  // Add a new empty meal slot to a day. It appears as an empty section ready
  // for the user to swap a recipe into.
  const handleAddSlot = (dayIdx: number, name: string, time: string) => {
    if (!draftPlan) return;
    const entry: PlanDayMeal = {
      slotName: name,
      time,
      recipeId: EMPTY_SLOT,
      recipeName: 'Add a meal',
    };
    const next: MealPlan = {
      ...draftPlan,
      days: draftPlan.days.map((day, i) =>
        i === dayIdx ? [...day, entry].sort((a, b) => a.time.localeCompare(b.time)) : day,
      ),
    };
    setDraftPlan(next);
    if (storedPlan) setCustomizeDraft({ planId: storedPlan.id, draftPlan: next });
  };

  const handleEndPlan = () => {
    Alert.alert(
      'End your plan?',
      'Upcoming plan meals will be removed. Meals you\'ve eaten or added yourself stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End plan',
          style: 'destructive',
          onPress: () => {
            endPlan();
            showToast(`${plan.name} ended`);
            router.dismissAll();
          },
        },
      ],
    );
  };

  const handleStartPlan = () => {
    const start = () => {
      activatePlan(plan);
      showToast(`${plan.name} activated`);
      router.dismissAll();
    };
    confirmPlanActivation({
      hasCurrentPlan: !!profile.activePlanName,
      onActivate: start,
      onSaveAndActivate: () => {
        const fallback = profile.activePlanName || `Plan saved ${new Date().toLocaleDateString()}`;
        saveCurrentPlanAs(fallback);
        start();
      },
    });
  };

  return (
    <View style={{ flex: 1 }}>
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBackPress}
          style={styles.headerBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.headerBackText}>{isCustomizing ? '✕' : '←'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {isCustomizing ? 'Customize Plan' : plan.name}
        </Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {plan.description ? (
          <Text style={styles.description}>{plan.description}</Text>
        ) : null}

        {plan.disclaimer ? (
          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerText}>{plan.disclaimer}</Text>
          </View>
        ) : null}

        {plan.targets ? (
          <View style={styles.targetsCard}>
            <Text style={styles.targetsLabel}>Daily target</Text>
            <Text style={styles.targetsCalories}>{plan.targets.calories} cal</Text>
            <View style={styles.macroRow}>
              <Text style={styles.macroPill}>P {plan.targets.protein}g</Text>
              <Text style={styles.macroPill}>C {plan.targets.carbs}g</Text>
              <Text style={styles.macroPill}>F {plan.targets.fats}g</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Meals in this plan</Text>
        {(() => {
          // Hide globally-removed and empty-slot placeholders — they only
          // surface in the day-by-day weekly schedule below.
          const visibleMeals = distinctMeals.filter(
            m => m.recipeId !== REMOVED_SLOT && m.recipeId !== EMPTY_SLOT,
          );
          const COLLAPSED_LIMIT = 4;
          const shown = mealsExpanded ? visibleMeals : visibleMeals.slice(0, COLLAPSED_LIMIT);
          const canToggle = visibleMeals.length > COLLAPSED_LIMIT;
          return (
            <>
              <View style={styles.mealList}>
                {shown.map((m, idx) => {
                  const r = recipeById.get(m.recipeId);
                  return (
                    <View key={`${m.recipeId}-${idx}`} style={styles.mealRow}>
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        activeOpacity={0.7}
                        onPress={() => {
                          if (isCustomizing) return;
                          if (r) router.push({ pathname: '/recipe/[id]', params: { id: r.id } });
                        }}
                        disabled={!r || isCustomizing}
                      >
                        <Text style={styles.mealName} numberOfLines={1}>{m.recipeName}</Text>
                        {r ? (
                          <Text style={styles.mealMeta}>
                            {r.calories} cal · {r.cookTimeMin}m · {r.category}
                          </Text>
                        ) : (
                          <Text style={styles.mealMeta}>Custom recipe</Text>
                        )}
                      </TouchableOpacity>
                      {isCustomizing ? (
                        <TouchableOpacity
                          onPress={() => handleGlobalRemove(m.recipeId, m.recipeName)}
                          hitSlop={10}
                          style={styles.removeBtn}
                        >
                          <Text style={styles.removeBtnText}>✕</Text>
                        </TouchableOpacity>
                      ) : r ? (
                        <Text style={styles.chevron}>›</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              {canToggle ? (
                <TouchableOpacity
                  style={styles.seeMoreBtn}
                  onPress={() => setMealsExpanded(v => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.seeMoreText}>
                    {mealsExpanded
                      ? 'See less'
                      : `See more (${visibleMeals.length - COLLAPSED_LIMIT})`}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          );
        })()}

        <Text style={styles.sectionTitle}>Weekly schedule</Text>
        {plan.days.map((day, dayIdx) => {
          const dayCard = (
            <>
              <View style={styles.dayHeaderRow}>
                <Text style={styles.dayName}>{WEEKDAY_LABELS[dayIdx]}</Text>
                {isCustomizing && <Text style={styles.dayChevron}>›</Text>}
              </View>
              {day.length === 0 ? (
                <Text style={styles.daySkip}>Rest day</Text>
              ) : (
                day.map((m, mi) => {
                  const removed = m.recipeId === REMOVED_SLOT;
                  const empty = m.recipeId === EMPTY_SLOT;
                  return (
                    <View key={mi} style={styles.dayMealRow}>
                      <Text style={styles.dayMealTime}>{m.time}</Text>
                      <Text
                        style={[styles.dayMealName, (removed || empty) && styles.dayMealRemoved]}
                        numberOfLines={1}
                      >
                        {empty ? `${m.slotName} · empty` : m.recipeName}
                      </Text>
                      {removed && <View style={styles.removedTag}><Text style={styles.removedTagText}>Removed</Text></View>}
                    </View>
                  );
                })
              )}
            </>
          );

          if (isCustomizing) {
            return (
              <TouchableOpacity
                key={dayIdx}
                style={[styles.dayBlock, styles.dayBlockCustomizing]}
                activeOpacity={0.7}
                onPress={() => setEditingDayIdx(dayIdx)}
              >
                {dayCard}
              </TouchableOpacity>
            );
          }
          return (
            <View key={dayIdx} style={styles.dayBlock}>{dayCard}</View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
        {isCustomizing ? (
          <TouchableOpacity style={styles.startBtn} onPress={handleSaveCustomize} activeOpacity={0.85}>
            <Text style={styles.startBtnText}>Save</Text>
          </TouchableOpacity>
        ) : isCurrent ? (
          <>
            <TouchableOpacity
              style={styles.startBtn}
              onPress={handleStartCustomize}
              activeOpacity={0.85}
            >
              <Text style={styles.startBtnText}>Customize Plan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.endBtn} onPress={handleEndPlan} activeOpacity={0.7}>
              <Text style={styles.endBtnText}>End plan</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.startBtn} onPress={handleStartPlan} activeOpacity={0.85}>
            <Text style={styles.startBtnText}>Start Plan</Text>
          </TouchableOpacity>
        )}
      </View>
    </Screen>

      {/* Customize-day editor — an in-tree overlay (NOT a RN Modal) so it
          survives the navigation round-trip to the Saved Recipes swap page.
          Reads/writes the plan's draft, NOT logs. Lives outside <Screen> so it
          covers the full window and manages its own safe-area insets. */}
      {editingDayIdx !== null && draftPlan ? (
        <CustomizeDayOverlay
          dayName={WEEKDAY_LABELS[editingDayIdx]}
          meals={draftPlan.days[editingDayIdx] ?? []}
          recipeById={recipeById}
          profileSlots={slotOptions}
          onClose={() => setEditingDayIdx(null)}
          onSwap={(slotName, time) => handlePlanSwap(editingDayIdx, slotName, time)}
          onAddSlot={() => setAddSlotDayIdx(editingDayIdx)}
        />
      ) : null}

      {/* Add-meal-slot popup. */}
      {addSlotDayIdx !== null ? (
        <AddSlotPopup
          onCancel={() => setAddSlotDayIdx(null)}
          onConfirm={(name, time) => {
            handleAddSlot(addSlotDayIdx, name, time);
            setAddSlotDayIdx(null);
          }}
        />
      ) : null}
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface CustomizeDayOverlayProps {
  dayName: string;
  meals: PlanDayMeal[];
  recipeById: Map<string, RecipeTemplate>;
  profileSlots: MealSlot[];
  onClose: () => void;
  onSwap: (slotName: string, time: string) => void;
  onAddSlot: () => void;
}

interface DaySection {
  slotName: string;
  time: string;
  meal?: PlanDayMeal;
}

/**
 * Day-detail-styled editor for one day of a saved plan. Visually mirrors
 * `app/plan/day/[date].tsx` (slot sections, swap-only) but operates on plan
 * template data instead of the daily log. Rendered as an in-tree overlay so
 * it survives the navigation round-trip to the Saved Recipes swap page.
 */
function CustomizeDayOverlay({
  dayName,
  meals,
  recipeById,
  profileSlots,
  onClose,
  onSwap,
  onAddSlot,
}: CustomizeDayOverlayProps) {
  const insets = useSafeAreaInsets();
  const footerBottomPad = Math.max(insets.bottom, 16) + 16;

  // Sections = the fixed profile slots (Breakfast, Lunch, …), plus any genuine
  // custom slot added via "Add meal slot". Each meal drops into its matching
  // slot by name, or — for legacy data that wrongly stored the meal name as the
  // slot name — into the nearest fixed slot by time. Meals must never spawn a
  // slot titled after the meal itself.
  const sections = useMemo<DaySection[]>(() => {
    const byName = new Map<string, DaySection>();
    profileSlots.forEach(s => {
      byName.set(s.name, { slotName: s.name, time: s.time });
    });

    const toMin = (t: string): number => {
      const [h, mm] = t.split(':').map(n => parseInt(n, 10));
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
    };
    const nearestSlotName = (time: string): string | undefined => {
      if (profileSlots.length === 0) return undefined;
      const tm = toMin(time);
      let best = profileSlots[0];
      let bestDiff = Infinity;
      for (const s of profileSlots) {
        const d = Math.abs(toMin(s.time) - tm);
        if (d < bestDiff) { bestDiff = d; best = s; }
      }
      return best.name;
    };

    meals.forEach(m => {
      const isFilled = m.recipeId !== EMPTY_SLOT && m.recipeId !== REMOVED_SLOT;
      // Legacy bug: slotName === recipeName means the slot was never a real
      // slot. Re-home it into a fixed slot by time.
      let targetName = m.slotName;
      if (!byName.has(m.slotName) && m.slotName === m.recipeName) {
        targetName = nearestSlotName(m.time) ?? m.slotName;
      }
      const existing = byName.get(targetName);
      if (existing) {
        existing.time = m.time;
        if (isFilled || !existing.meal) existing.meal = m;
      } else {
        byName.set(targetName, { slotName: targetName, time: m.time, meal: m });
      }
    });
    return Array.from(byName.values()).sort((a, b) => a.time.localeCompare(b.time));
  }, [profileSlots, meals]);

  return (
    <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: 0 }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.headerBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.headerBackText}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{fullWeekdayName(dayName)}</Text>
          <Text style={styles.dayEditorSubtitle}>Swap meals for this day</Text>
        </View>
        <View style={styles.headerBack} />
      </View>

      <ScrollView contentContainerStyle={styles.dayEditorBody} showsVerticalScrollIndicator={false}>
        {sections.map(sec => {
          const filled = sec.meal && sec.meal.recipeId !== EMPTY_SLOT && sec.meal.recipeId !== REMOVED_SLOT;
          const recipe = filled ? recipeById.get(sec.meal!.recipeId) : undefined;
          return (
            <View key={sec.slotName} style={styles.slotBlock}>
              <View style={styles.slotHeaderRow}>
                <Text style={styles.slotName}>{sec.slotName}</Text>
                <Text style={styles.slotTime}>{sec.time}</Text>
              </View>
              {filled ? (
                <View style={styles.dayEditorRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dayEditorName} numberOfLines={1}>{sec.meal!.recipeName}</Text>
                    {recipe ? (
                      <Text style={styles.dayEditorMeta} numberOfLines={1}>
                        {recipe.calories} cal · P {recipe.macros.protein}g · C {recipe.macros.carbs}g · F {recipe.macros.fats}g
                      </Text>
                    ) : (
                      <Text style={styles.dayEditorMeta}>Custom recipe</Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => onSwap(sec.slotName, sec.time)} style={styles.swapBtn} hitSlop={6}>
                    <Text style={styles.swapBtnText}>Swap</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.emptySlotCard}
                  onPress={() => onSwap(sec.slotName, sec.time)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.emptySlotText}>No meal yet</Text>
                  <Text style={styles.emptySlotAdd}>+ Add {sec.slotName.toLowerCase()}</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
        <TouchableOpacity style={styles.startBtn} onPress={onAddSlot} activeOpacity={0.85}>
          <Text style={styles.startBtnText}>+  Add meal slot</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface AddSlotPopupProps {
  onCancel: () => void;
  onConfirm: (name: string, time: string) => void;
}

/** Small popup to create a plan-specific custom meal slot (name + time). */
function AddSlotPopup({ onCancel, onConfirm }: AddSlotPopupProps) {
  const [name, setName] = useState('');
  const [time, setTime] = useState<Date>(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  });

  const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const canAdd = name.trim().length > 0;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.pickerBackdrop} onPress={onCancel}>
        <Pressable style={styles.addSlotCard} onPress={e => e.stopPropagation?.()}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Add meal slot</Text>
            <TouchableOpacity onPress={onCancel} hitSlop={10}>
              <Text style={styles.pickerClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.pickerSectionLabel}>Slot name</Text>
          <TextInput
            style={styles.addSlotInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Pre-workout"
            placeholderTextColor={COLORS.textMuted}
          />

          <Text style={styles.pickerSectionLabel}>Time · {timeStr}</Text>
          <View style={styles.addSlotTimeWrap}>
            <DateTimePicker
              value={time}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, d) => d && setTime(d)}
              themeVariant="dark"
            />
          </View>

          <TouchableOpacity
            style={[styles.pickerPrimary, !canAdd && styles.pickerPrimaryDisabled]}
            disabled={!canAdd}
            onPress={() => onConfirm(name.trim(), timeStr)}
            activeOpacity={0.85}
          >
            <Text style={styles.pickerPrimaryText}>Add</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// "Mon" → "Monday", "Tue" → "Tuesday", etc. Used for the day-editor header.
function fullWeekdayName(short: string): string {
  switch (short) {
    case 'Mon': return 'Monday';
    case 'Tue': return 'Tuesday';
    case 'Wed': return 'Wednesday';
    case 'Thu': return 'Thursday';
    case 'Fri': return 'Friday';
    case 'Sat': return 'Saturday';
    case 'Sun': return 'Sunday';
    default: return short;
  }
}

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
  headerBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerBackText: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  headerTitle: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  body: { padding: 16, paddingBottom: 40 },

  description: { color: COLORS.text, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  disclaimer: {
    backgroundColor: COLORS.orange + '22',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  disclaimerText: { color: COLORS.orange, fontSize: 12, lineHeight: 17 },

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
  macroRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  macroPill: {
    color: COLORS.textSecondary,
    fontSize: 11,
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  sectionTitle: {
    color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 8,
  },
  mealList: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  mealName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  mealMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  chevron: { color: COLORS.textSecondary, fontSize: 20 },
  removeBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.elevated,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 8,
  },
  removeBtnText: { color: COLORS.orange, fontSize: 14, fontWeight: '700' },

  dayBlock: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  dayBlockCustomizing: { borderColor: COLORS.green + '66' },
  dayHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dayName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  dayChevron: { color: COLORS.green, fontSize: 18, fontWeight: '700' },
  daySkip: { color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic' },
  dayMealRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 10 },
  dayMealTime: { color: COLORS.textSecondary, fontSize: 12, width: 56 },
  dayMealName: { color: COLORS.text, fontSize: 13, flex: 1 },
  dayMealRemoved: { color: COLORS.textMuted, fontStyle: 'italic' },
  removedTag: {
    backgroundColor: COLORS.orange + '22',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },
  removedTagText: { color: COLORS.orange, fontSize: 10, fontWeight: '700' },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    // paddingBottom is applied inline via useSafeAreaInsets so it floors to
    // 32 on non-notched and ~50 on notched devices regardless of screen.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  // The footer is a default column container (no flexDirection: 'row')
  // and there's only one button, so the button must NOT use `flex: 1`.
  // In a column parent, `flex: 1` collapses the button to ~0 height
  // (flexBasis 0 + flexGrow 1 with no available main-axis space), which
  // squashes the label. Letting it size to its intrinsic content height
  // and stretch full-width on the cross axis is the correct pattern.
  startBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
  endBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  endBtnText: { color: COLORS.red, fontSize: 14, fontWeight: '600' },

  seeMoreBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  seeMoreText: { color: COLORS.green, fontSize: 13, fontWeight: '600' },

  // ── Customize Day editor ────────────────────────────────────────────────
  dayEditorSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  dayEditorBody: { padding: 14, paddingBottom: 40, gap: 12 },
  dayEditorEmpty: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 22,
    alignItems: 'center',
  },
  dayEditorEmptyTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  dayEditorEmptyBody: { color: COLORS.textSecondary, fontSize: 12 },
  dayEditorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  dayEditorTimeCol: { width: 64 },
  dayEditorTime: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  dayEditorSlot: { color: COLORS.textSecondary, fontSize: 10, marginTop: 2 },
  dayEditorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayEditorName: { color: COLORS.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  dayEditorNameRemoved: { color: COLORS.textMuted, fontStyle: 'italic' },
  dayEditorMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  dayEditorActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swapBtn: {
    backgroundColor: COLORS.elevated,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  swapBtnText: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
  dayEditorRemoveBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayEditorRemoveText: { color: COLORS.textSecondary, fontSize: 12 },

  // ── Customize day overlay (in-tree, survives navigation) ─────────────────
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.bg,
    zIndex: 20,
  },
  slotBlock: { gap: 8, marginBottom: 14 },
  slotHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  slotName: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  slotTime: { color: COLORS.textSecondary, fontSize: 13 },
  emptySlotCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 4,
  },
  emptySlotText: { color: COLORS.textSecondary, fontSize: 13 },
  emptySlotAdd: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  addSlotCard: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  addSlotInput: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 15,
    marginBottom: 6,
  },
  addSlotTimeWrap: { alignItems: 'center', marginBottom: 8 },

  // ── Recipe / slot picker modal ──────────────────────────────────────────
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    maxHeight: '85%',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  pickerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  pickerClose: { color: COLORS.textSecondary, fontSize: 18, fontWeight: '600' },
  pickerSectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: 6,
  },
  pickerSlotSection: { marginBottom: 4 },
  pickerSlotRow: { gap: 8, paddingVertical: 2, paddingRight: 4 },
  slotChip: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  slotChipActive: {
    backgroundColor: COLORS.green + '22',
    borderColor: COLORS.green,
  },
  slotChipText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  slotChipTextActive: { color: COLORS.green },
  pickerRecipeList: { maxHeight: 380, marginBottom: 10 },
  pickerRecipeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  pickerRecipeItemActive: { backgroundColor: COLORS.green + '14', borderRadius: 8 },
  pickerRecipeName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  pickerRecipeMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  pickerCheck: { color: COLORS.green, fontSize: 16, fontWeight: '700' },
  pickerEmpty: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  pickerPrimary: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  pickerPrimaryDisabled: { opacity: 0.5 },
  pickerPrimaryText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
});
