import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import { useMealStore, toIsoDate } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import { CartIcon } from '@/components/CartIcon';
import { MealCard } from '@/components/MealCard';
import { WeekStrip } from '@/components/WeekStrip';
import { EditMealScreen } from '@/components/EditMealScreen';
import { AddMealScreen } from '@/components/addMeal/AddMealScreen';
import type { MealEntry } from '@/store/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateTitle(isoDate: string): string {
  const todayIso     = toIsoDate(new Date());
  const tomorrowIso  = toIsoDate(new Date(Date.now() + 86400000));
  const yesterdayIso = toIsoDate(new Date(Date.now() - 86400000));
  if (isoDate === todayIso)     return 'Today';
  if (isoDate === tomorrowIso)  return 'Tomorrow';
  if (isoDate === yesterdayIso) return 'Yesterday';
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function getDateSubtitle(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

const WATER_GOAL_CUPS = 8;
const ML_PER_CUP      = 250;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [viewingDate, setViewingDate] = useState(toIsoDate(new Date()));
  const [editingEntry, setEditingEntry] = useState<MealEntry | null>(null);
  const [addingVisible, setAddingVisible] = useState(false);

  const {
    logs,
    goals,
    streak,
    toggleMealStatus,
    removeMealFromDay,
    restoreMealToDay,
    markPastDueMealsAsMissed,
    logWater,
    resolveDayFromTemplates,
    recalcStreak,
  } = useMealStore();
  const showUndo = useUndoStore(s => s.showUndo);

  const currentLog    = logs[viewingDate];
  const meals         = currentLog?.meals ?? [];
  const sortedMeals   = [...meals].sort((a, b) => a.time.localeCompare(b.time));
  const completedMeals = meals.filter((m: MealEntry) => m.status === 'completed');

  const totals = completedMeals.reduce(
    (acc: { calories: number; protein: number; carbs: number; fats: number }, m: MealEntry) => ({
      calories: acc.calories + m.calories,
      protein:  acc.protein  + m.macros.protein,
      carbs:    acc.carbs    + m.macros.carbs,
      fats:     acc.fats     + m.macros.fats,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  const caloriePct  = Math.min((totals.calories / goals.dailyCalories) * 100, 100);
  const pctDoneText = `${Math.round(caloriePct)}% done`;

  const waterMl   = currentLog?.waterMl ?? 0;
  const waterCups = Math.min(Math.floor(waterMl / ML_PER_CUP), WATER_GOAL_CUPS);

  const handleWaterTap = (cupIndex: number) => {
    const tappedCup = cupIndex + 1;
    const newCups   = tappedCup === waterCups ? waterCups - 1 : tappedCup;
    const deltaMl   = (newCups - waterCups) * ML_PER_CUP;
    logWater(viewingDate, deltaMl);
  };

  // Populate today's meals and recalculate streak on first mount
  useEffect(() => {
    const todayIso = toIsoDate(new Date());
    resolveDayFromTemplates(todayIso);
    markPastDueMealsAsMissed(todayIso);
    recalcStreak();
  }, [markPastDueMealsAsMissed, recalcStreak, resolveDayFromTemplates]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const todayIso = toIsoDate(new Date());
        markPastDueMealsAsMissed(todayIso);
      }
    });
    return () => sub.remove();
  }, [markPastDueMealsAsMissed]);

  const navigateTo = (date: string) => {
    setViewingDate(date);
    resolveDayFromTemplates(date);
    markPastDueMealsAsMissed(date);
  };

  const handleRemoveMeal = (mealId: string) => {
    const originalMeals = currentLog?.meals ?? [];
    const originalIndex = originalMeals.findIndex((m: MealEntry) => m.id === mealId);
    if (originalIndex < 0) return;

    const removedEntry = originalMeals[originalIndex];
    removeMealFromDay(viewingDate, mealId);

    showUndo({
      message: 'Meal removed',
      undo: () => restoreMealToDay(viewingDate, removedEntry, originalIndex),
    });
  };

  // Plan tag — weekday vs weekend based on the date being viewed
  const viewingDayOfWeek = new Date(viewingDate + 'T00:00:00').getDay(); // 0=Sun, 6=Sat
  const isWeekend        = viewingDayOfWeek === 0 || viewingDayOfWeek === 6;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.appTitle}>MEAL PLAN</Text>
          <View style={styles.headerRight}>
            {streak > 0 && (
              <View style={styles.streakBadge}>
                <View style={styles.streakDot} />
                <Text style={styles.streakText}>{streak} day streak</Text>
              </View>
            )}
            <CartIcon />
          </View>
        </View>

        {/* ── Week Strip ──────────────────────────────────────────────── */}
        <WeekStrip
          selectedDate={viewingDate}
          onSelectDate={navigateTo}
        />

        {/* ── Date Row ────────────────────────────────────────────────── */}
        <View style={styles.dateRow}>
          <TouchableOpacity
            style={styles.arrowBtn}
            onPress={() => navigateTo(shiftDate(viewingDate, -1))}
            activeOpacity={0.7}
          >
            <Text style={styles.arrowText}>←</Text>
          </TouchableOpacity>

          <View style={styles.dateCenter}>
            <Text style={styles.dateTitle}>{getDateTitle(viewingDate)}</Text>
            <Text style={styles.dateSub}>{getDateSubtitle(viewingDate)}</Text>
          </View>

          <TouchableOpacity
            style={styles.arrowBtn}
            onPress={() => navigateTo(shiftDate(viewingDate, 1))}
            activeOpacity={0.7}
          >
            <Text style={styles.arrowText}>→</Text>
          </TouchableOpacity>
        </View>

        {/* ── Plan Tag ────────────────────────────────────────────────── */}
        <View style={styles.planTagRow}>
          <View style={styles.planTag}>
            <Text style={styles.planTagText}>
              {isWeekend ? 'Weekend plan' : 'Weekday plan'}
            </Text>
          </View>
        </View>

        {/* ── Summary Card ────────────────────────────────────────────── */}
        <View style={styles.summaryCard}>

          {/* Top row: calories (left) + % done (right) */}
          <View style={styles.summaryTopRow}>
            <View>
              <Text style={styles.calorieNumber}>{totals.calories}</Text>
              <Text style={styles.calorieGoal}>of {goals.dailyCalories} kcal</Text>
            </View>
            <Text style={styles.pctDone}>{pctDoneText}</Text>
          </View>

          {/* Progress bar */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${caloriePct}%` as any }]} />
          </View>

          {/* Macro row */}
          <View style={styles.macroRow}>
            {[
              { label: 'Protein', value: totals.protein, goal: goals.protein  },
              { label: 'Carbs',   value: totals.carbs,   goal: goals.carbs    },
              { label: 'Fats',    value: totals.fats,    goal: goals.fats     },
              { label: 'Water',   value: waterCups,      goal: WATER_GOAL_CUPS },
            ].map((m: { label: string; value: number; goal: number }) => (
              <View key={m.label} style={styles.macroItem}>
                <Text style={styles.macroValue}>
                  {m.value}{m.label === 'Water' ? '' : 'g'}
                </Text>
                <Text style={styles.macroLabel}>{m.label}</Text>
                <Text style={styles.macroGoalText}>
                  /{m.goal}{m.label === 'Water' ? ' cups' : 'g'}
                </Text>
              </View>
            ))}
          </View>

          {/* Water intake circles */}
          <View style={styles.waterRow}>
            <Text style={styles.waterLabel}>Water intake</Text>
            <View style={styles.waterCircles}>
              {Array.from({ length: WATER_GOAL_CUPS }, (_, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => handleWaterTap(i)}
                  style={[
                    styles.waterCircle,
                    i < waterCups && styles.waterCircleFilled,
                  ]}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                />
              ))}
            </View>
          </View>
        </View>

        {/* ── Meals Section ───────────────────────────────────────────── */}
        <View style={styles.mealsSectionHeader}>
          <Text style={styles.mealsSectionTitle}>MEALS</Text>
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.7}
            onPress={() => setAddingVisible(true)}
          >
            <Text style={styles.addBtnText}>+ Add meal</Text>
          </TouchableOpacity>
        </View>

        {/* Meal list */}
        {sortedMeals.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🍽️</Text>
            <Text style={styles.emptyText}>No meals for this day</Text>
            <Text style={styles.emptySubtext}>Tap + Add meal to get started</Text>
          </View>
        ) : (
          sortedMeals.map(entry => (
            <MealCard
              key={entry.id}
              entry={entry}
              onToggle={() => toggleMealStatus(viewingDate, entry.id)}
              onRemove={() => handleRemoveMeal(entry.id)}
              onEdit={() => setEditingEntry(entry)}
            />
          ))
        )}
      </ScrollView>

      <EditMealScreen
        visible={!!editingEntry}
        date={viewingDate}
        entry={editingEntry}
        onClose={() => setEditingEntry(null)}
      />

      <AddMealScreen
        visible={addingVisible}
        date={viewingDate}
        onClose={() => setAddingVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 12,
  },
  appTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 1.2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.green + '22',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.green + '55',
  },
  streakDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.green,
  },
  streakText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  // ── Date row ────────────────────────────────────────────────────────────────
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 10,
  },
  arrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '400',
  },
  dateCenter: {
    alignItems: 'center',
    flex: 1,
  },
  dateTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  dateSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 1,
  },

  // ── Plan tag ─────────────────────────────────────────────────────────────────
  planTagRow: {
    marginBottom: 14,
  },
  planTag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: COLORS.orange + '80',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: COLORS.orange + '12',
  },
  planTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.orange,
  },

  // ── Summary card ─────────────────────────────────────────────────────────────
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  calorieNumber: {
    fontSize: 38,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 40,
  },
  calorieGoal: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  pctDone: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.green,
    marginTop: 6,
  },
  progressTrack: {
    height: 4,
    backgroundColor: COLORS.elevated,
    borderRadius: 2,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.green,
    borderRadius: 2,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  macroItem: {
    flex: 1,
    alignItems: 'flex-start',
  },
  macroValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  macroLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  macroGoalText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  waterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  waterLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  waterCircles: {
    flexDirection: 'row',
    gap: 6,
  },
  waterCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.textMuted,
  },
  waterCircleFilled: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },

  // ── Meals section ─────────────────────────────────────────────────────────────
  mealsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  mealsSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 1,
  },
  addBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },

  // ── Empty state ────────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    backgroundColor: COLORS.card,
    borderRadius: 12,
  },
  emptyIcon: {
    fontSize: 34,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
});
