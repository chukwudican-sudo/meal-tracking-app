import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore, toIsoDate } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { MealPlan, RecipeTemplate } from '@/store/types';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function PlanDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';

  const plans = useMealStore(s => s.plans);
  const savedPlans = useMealStore(s => s.savedPlans);
  const templates = useMealStore(s => s.templates);
  const recipes = useMealStore(s => s.recipes);
  const profile = useMealStore(s => s.profile);
  const activatePlan = useMealStore(s => s.activatePlan);
  const saveCurrentPlanAs = useMealStore(s => s.saveCurrentPlanAs);
  const updateSavedPlan = useMealStore(s => s.updateSavedPlan);
  const showToast = useToastStore(s => s.showToast);
  const showUndo = useUndoStore(s => s.showUndo);

  const storedPlan: MealPlan | undefined = useMemo(
    () => plans.find(p => p.id === id) ?? savedPlans.find(p => p.id === id),
    [plans, savedPlans, id],
  );

  // ── Customize Plan state ────────────────────────────────────────────
  // We deep-clone the stored plan when entering customize mode so the user
  // can freely edit until they hit Save (commits via updateSavedPlan) or
  // discard via the back arrow.
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [draftPlan, setDraftPlan] = useState<MealPlan | null>(null);

  // Reset the draft if the underlying plan id changes while mounted.
  useEffect(() => {
    if (!isCustomizing) setDraftPlan(null);
  }, [isCustomizing, id]);

  // The plan we render — draft when customizing, otherwise the stored copy.
  const plan: MealPlan | undefined = isCustomizing && draftPlan ? draftPlan : storedPlan;

  const recipeById = useMemo(() => {
    const m = new Map<string, RecipeTemplate>();
    recipes.forEach(r => m.set(r.id, r));
    return m;
  }, [recipes]);

  // Build distinct recipe list for the "Meals in this plan" section.
  const distinctMeals = useMemo(() => {
    if (!plan) return [] as { recipeId: string; recipeName: string }[];
    const seen = new Map<string, { recipeId: string; recipeName: string }>();
    plan.days.forEach(day =>
      day.forEach(m => {
        if (!seen.has(m.recipeId)) {
          seen.set(m.recipeId, { recipeId: m.recipeId, recipeName: m.recipeName });
        }
      }),
    );
    return Array.from(seen.values());
  }, [plan]);

  if (!plan) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.headerBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Plan not found</Text>
          <View style={styles.headerBack} />
        </View>
      </SafeAreaView>
    );
  }

  // A plan is "current" when its name matches the user's activePlanName.
  // Only current plans get the Customize Plan flow.
  const isCurrent = !!profile.activePlanName && plan.name === profile.activePlanName;

  // ── Customize handlers ──────────────────────────────────────────────

  const handleStartCustomize = () => {
    // Deep clone via JSON to ensure nested arrays are independent from the
    // store snapshot. The plan is small (≤7 days × ~5 meals) so this is fine.
    const clone: MealPlan = JSON.parse(JSON.stringify(storedPlan));
    setDraftPlan(clone);
    setIsCustomizing(true);
  };

  const handleSaveCustomize = () => {
    if (!draftPlan || !storedPlan) return;
    updateSavedPlan(storedPlan.id, draftPlan);
    setIsCustomizing(false);
    setDraftPlan(null);
    showToast('Plan updated');
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
            ? { ...m, recipeName: 'Removed', recipeId: '__removed__' }
            : m,
        ),
      ),
    });
    showUndo({
      message: `Removed ${recipeName} from plan`,
      undo: () => setDraftPlan(snapshot),
    });
  };

  // Map weekday index (Mon=0..Sun=6) to the next ISO date for that weekday.
  // This lets day cards in customize mode jump to the existing Day Detail
  // page (which keys off real ISO dates).
  const isoForDay = (dayIdx: number): string => {
    const today = new Date();
    const todayDow = today.getDay();              // Sun=0..Sat=6
    const todayMon = todayDow === 0 ? 6 : todayDow - 1; // Mon=0..Sun=6
    const diff = ((dayIdx - todayMon) + 7) % 7;
    const target = new Date(today);
    target.setDate(today.getDate() + diff);
    return toIsoDate(target);
  };

  const handleViewInSchedule = () => {
    router.dismissAll();
  };

  const handleStartPlan = () => {
    if (templates.length === 0) {
      activatePlan(plan);
      showToast(`${plan.name} activated`);
      router.dismissAll();
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
            activatePlan(plan);
            showToast(`${plan.name} activated`);
            router.dismissAll();
          },
        },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            activatePlan(plan);
            showToast(`${plan.name} activated`);
            router.dismissAll();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
        <View style={styles.mealList}>
          {distinctMeals
            // Hide globally-removed placeholders from this list (they only
            // surface in the day-by-day weekly schedule below).
            .filter(m => m.recipeId !== '__removed__')
            .map((m, idx) => {
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
                  const removed = m.recipeId === '__removed__';
                  return (
                    <View key={mi} style={styles.dayMealRow}>
                      <Text style={styles.dayMealTime}>{m.time}</Text>
                      <Text
                        style={[styles.dayMealName, removed && styles.dayMealRemoved]}
                        numberOfLines={1}
                      >
                        {m.recipeName}
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
                onPress={() =>
                  router.push({ pathname: '/plan/day/[date]', params: { date: isoForDay(dayIdx) } })
                }
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

      <View style={styles.footer}>
        {isCustomizing ? (
          <TouchableOpacity style={styles.startBtn} onPress={handleSaveCustomize} activeOpacity={0.85}>
            <Text style={styles.startBtnText}>Save</Text>
          </TouchableOpacity>
        ) : isCurrent ? (
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={styles.viewBtn}
              onPress={handleViewInSchedule}
              activeOpacity={0.85}
            >
              <Text style={styles.viewBtnText}>View in Schedule</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.startBtn}
              onPress={handleStartCustomize}
              activeOpacity={0.85}
            >
              <Text style={styles.startBtnText}>Customize Plan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.startBtn} onPress={handleStartPlan} activeOpacity={0.85}>
            <Text style={styles.startBtnText}>Start Plan</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
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
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  startBtn: {
    flex: 1,
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
  footerRow: { flexDirection: 'row', gap: 8 },
  viewBtn: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  viewBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
});
