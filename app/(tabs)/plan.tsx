import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { router, useFocusEffect } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { isTemplateApplicableOnDate, toIsoDate, useMealStore } from '@/store/useMealStore';
import { CartIcon } from '@/components/CartIcon';
import { ProfileIcon } from '@/components/ProfileIcon';
import { ExplorePlansSection } from '@/components/plans/ExplorePlansSection';
import { SavedPlansSection } from '@/components/plans/SavedPlansSection';
import { ActionTile } from '@/components/recipes/ActionTile';

const WEEK_START_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toMidnight(iso: string): Date {
  return new Date(iso + 'T00:00:00');
}

// Returns 6 rows × 7 cols (Mon–Sun) for the month containing anchorIso.
function monthGridRows(anchorIso: string): (string | null)[][] {
  const d = toMidnight(anchorIso);
  d.setDate(1);
  const startDow = d.getDay();
  const monOffset = startDow === 0 ? 6 : startDow - 1;
  const start = new Date(d);
  start.setDate(d.getDate() - monOffset);

  return Array.from({ length: 6 }, (_, row) => {
    const monday = new Date(start);
    monday.setDate(start.getDate() + row * 7);
    return Array.from({ length: 7 }, (__, col) => {
      const cell = new Date(monday);
      cell.setDate(monday.getDate() + col);
      return cell.getMonth() === d.getMonth() ? toIsoDate(cell) : null;
    });
  });
}

// Friendly "started on" date for the Current Plan card.
function formatSavedDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Navigate by exactly one calendar month (handles month-length differences correctly)
function shiftMonth(iso: string, months: number): string {
  const d = toMidnight(iso);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return toIsoDate(d);
}

export default function PlanScreen() {
  const logs = useMealStore(s => s.logs);
  const profile = useMealStore(s => s.profile);
  const plans = useMealStore(s => s.plans);
  const savedPlans = useMealStore(s => s.savedPlans);
  const templates = useMealStore(s => s.templates);
  const groceryItems = useMealStore(s => s.grocery.items);

  // A day's meals come from its materialized log if it exists, otherwise from
  // the active plan's recurring templates. This lets the calendar mark days
  // and the Day Detail summary show counts without needing to visit each day.
  const mealsForDate = useCallback(
    (iso: string): { count: number; calories: number } => {
      const log = logs[iso];
      if (log) {
        return {
          count: log.meals.length,
          calories: log.meals.reduce((s, m) => s + (m.calories ?? 0), 0),
        };
      }
      const applicable = templates.filter(t => isTemplateApplicableOnDate(t, iso));
      return {
        count: applicable.length,
        calories: applicable.reduce((s, t) => s + (t.calories ?? 0), 0),
      };
    },
    [logs, templates],
  );

  const plannedCount = useMemo(
    () => Object.values(groceryItems).filter(i => i.section === 'planned').length,
    [groceryItems]
  );

  const todayIso = toIsoDate(new Date());
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [miniMonthAnchor, setMiniMonthAnchor] = useState(todayIso);

  // Reset calendar to the present every time the Plan tab is focused.
  // Modern apps (Apple Calendar, Google Calendar) snap back to today on
  // re-entry so the user always starts from the current day.
  useFocusEffect(
    useCallback(() => {
      const t = toIsoDate(new Date());
      setSelectedDate(t);
      setMiniMonthAnchor(t);
    }, []),
  );

  // Active plan card — only renders when a plan is active. Plans started from
  // Explore are premade (not in savedPlans), so look there too.
  const activePlan = profile.activePlanName
    ? savedPlans.find(p => p.name === profile.activePlanName) ??
      plans.find(p => p.name === profile.activePlanName)
    : undefined;

  // Day Detail button summary: reflect the meals scheduled on the selected day
  // (from the log if visited, otherwise resolved from the active plan).
  const daySummary = mealsForDate(selectedDate);
  const dayCal = daySummary.calories;
  const dayMealCount = daySummary.count;
  const dayLabel = toMidnight(selectedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Plan</Text>
          <View style={styles.headerActions}>
            <ProfileIcon />
            <CartIcon />
          </View>
        </View>

        {/* Current Plan card — sits above Build/Find when a plan is active. */}
        {activePlan && (
          <TouchableOpacity
            style={styles.currentPlanCard}
            onPress={() => router.push({ pathname: '/plan/[id]', params: { id: activePlan.id } })}
            activeOpacity={0.85}
          >
            <View style={styles.currentPlanBadge}>
              <Text style={styles.currentPlanBadgeText}>Current</Text>
            </View>
            <Text style={styles.currentPlanName} numberOfLines={1}>{activePlan.name}</Text>
            <Text style={styles.currentPlanMeta}>
              {activePlan.source === 'premade' ? 'Tap to customize or end' : `Started ${formatSavedDate(activePlan.savedAt)}`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Build / Find tiles — top of the tab, always visible. */}
        <View style={styles.tilesRow}>
          <ActionTile
            icon="✨"
            title="Build My Plan"
            subtitle="Build a custom weekly plan tailored to your goals."
            accent="green"
            onPress={() => router.push('/plan/build')}
          />
          <ActionTile
            icon="📋"
            title="Find Your Plan"
            subtitle="Answer a few questions and get matched to a plan."
            accent="purple"
            onPress={() => router.push('/plan/find')}
          />
        </View>

        {/* Mini month calendar — unchanged */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Mini month</Text>
            <Text style={styles.muted}>
              {toMidnight(miniMonthAnchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </Text>
          </View>
          <View style={styles.monthNavRow}>
            <TouchableOpacity onPress={() => setMiniMonthAnchor(shiftMonth(miniMonthAnchor, -1))}>
              <Text style={styles.yearNav}>←</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMiniMonthAnchor(shiftMonth(miniMonthAnchor, 1))}>
              <Text style={styles.yearNav}>→</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.miniWeekLabels}>
            {WEEK_START_MON.map(d => (
              <Text key={d} style={styles.miniWeekLabel}>{d[0]}</Text>
            ))}
          </View>
          <View style={styles.monthGrid}>
            {monthGridRows(miniMonthAnchor).map((row, rowIdx) => (
              <View key={rowIdx} style={styles.miniRow}>
                {row.map((iso, colIdx) => {
                  // "Today" is signalled with green text + a small dot
                  // beneath the number. "Selected" is the filled green
                  // tint. They stack: today + selected = filled tint AND
                  // green dot below.
                  const isToday = iso === todayIso;
                  const isSelected = iso === selectedDate;
                  const hasMeals = iso ? mealsForDate(iso).count > 0 : false;
                  return (
                    <Pressable
                      key={`${iso ?? 'nil'}-${rowIdx}-${colIdx}`}
                      onPress={() => {
                        if (!iso) return;
                        setSelectedDate(iso);
                      }}
                      style={[
                        styles.monthCell,
                        isSelected && styles.monthCellSelected,
                      ]}
                    >
                      <Text style={[
                        styles.monthCellText,
                        !iso && styles.monthCellHiddenText,
                        isToday && styles.monthCellTextToday,
                        isSelected && styles.monthCellTextSelected,
                      ]}>
                        {iso ? toMidnight(iso).getDate() : ''}
                      </Text>
                      {hasMeals && (
                        <View style={[styles.monthCellMealDot, isToday && styles.monthCellMealDotToday]} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        {/* Day Detail button — opens the full day detail page for selectedDate. */}
        <TouchableOpacity
          style={styles.dayDetailBtn}
          onPress={() => router.push({ pathname: '/plan/day/[date]', params: { date: selectedDate } })}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.dayDetailLabel} numberOfLines={1}>{dayLabel}</Text>
            <Text style={styles.dayDetailMeta}>
              {dayMealCount} {dayMealCount === 1 ? 'meal' : 'meals'} · {Math.round(dayCal).toLocaleString()} cal
            </Text>
          </View>
          <Text style={styles.dayDetailChevron}>›</Text>
        </TouchableOpacity>

        {/* Planned Ingredients — opens the full sorting page. */}
        <TouchableOpacity
          style={styles.plannedBtn}
          onPress={() => router.push('/grocery/planned-ingredients')}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.plannedLabel}>Planned Ingredients</Text>
            <Text style={styles.plannedMeta}>
              {plannedCount > 0
                ? `${plannedCount} ${plannedCount === 1 ? 'item' : 'items'} to sort`
                : 'All sorted'}
            </Text>
          </View>
          {plannedCount > 0 ? (
            <View style={styles.plannedBadge}>
              <Text style={styles.plannedBadgeText}>{plannedCount}</Text>
            </View>
          ) : null}
          <Text style={styles.dayDetailChevron}>›</Text>
        </TouchableOpacity>

        <ExplorePlansSection />

        <SavedPlansSection />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 14, paddingBottom: 96, gap: 12 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },

  tilesRow: { flexDirection: 'row', gap: 10 },

  // Mini month / generic section card
  sectionCard: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  muted: { color: COLORS.textSecondary, fontSize: 12 },
  yearNav: { color: COLORS.text, fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
  monthNavRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginBottom: 8 },
  miniWeekLabels: { flexDirection: 'row', marginBottom: 4 },
  miniWeekLabel: { flex: 1, color: COLORS.textSecondary, fontSize: 10, textAlign: 'center' },
  monthGrid: { gap: 2 },
  miniRow: { flexDirection: 'row' },
  monthCell: { flex: 1, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  monthCellSelected: { backgroundColor: COLORS.green + '44' },
  monthCellHiddenText: { color: 'transparent' },
  monthCellText: { color: COLORS.textSecondary, fontSize: 12 },
  monthCellTextToday: { color: COLORS.green, fontWeight: '700' },
  monthCellTextSelected: { color: COLORS.green, fontWeight: '700' },
  monthCellTodayDot: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.green,
  },
  // Small dot under any day that has meals scheduled. Green on today,
  // muted on other days (today is also emphasized via green bold text).
  monthCellMealDot: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.textMuted,
  },
  monthCellMealDotToday: { backgroundColor: COLORS.green },

  // Current Plan card
  currentPlanCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.green + '55',
    padding: 14,
    gap: 4,
  },
  currentPlanBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.green + '22',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  currentPlanBadgeText: { color: COLORS.green, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  currentPlanName: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  currentPlanMeta: { color: COLORS.textSecondary, fontSize: 12 },

  // Day Detail button
  dayDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  dayDetailLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  dayDetailMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  dayDetailChevron: { color: COLORS.textSecondary, fontSize: 22, paddingLeft: 8 },

  plannedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  plannedLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  plannedMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  plannedBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF9F0A',
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plannedBadgeText: { color: '#1A1207', fontSize: 11, fontWeight: '800' },
});
