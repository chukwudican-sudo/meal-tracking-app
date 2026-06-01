import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { toIsoDate, useMealStore } from '@/store/useMealStore';
import { CartIcon } from '@/components/CartIcon';
import { ProfileIcon } from '@/components/ProfileIcon';
import { PlannedIngredientsSection } from '@/components/grocery/PlannedIngredientsSection';
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
  const savedPlans = useMealStore(s => s.savedPlans);

  const todayIso = toIsoDate(new Date());
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [miniMonthAnchor, setMiniMonthAnchor] = useState(todayIso);

  // Active plan card — only renders when a plan is active.
  const activePlan = profile.activePlanName
    ? savedPlans.find(p => p.name === profile.activePlanName)
    : undefined;

  // Day Detail button summary: derive directly from today's logs so the
  // preview reflects every meal (planned + ad-hoc) on the selected day.
  const dayMeals = logs[selectedDate]?.meals ?? [];
  const dayCal = dayMeals.reduce((s, m) => s + (m.calories ?? 0), 0);
  const dayLabel = toMidnight(selectedDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
              Started {formatSavedDate(activePlan.savedAt)}
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
                {row.map((iso, colIdx) => (
                  <Pressable
                    key={`${iso ?? 'nil'}-${rowIdx}-${colIdx}`}
                    onPress={() => {
                      if (!iso) return;
                      setSelectedDate(iso);
                    }}
                    style={[
                      styles.monthCell,
                      iso === selectedDate && styles.monthCellSelected,
                    ]}
                  >
                    <Text style={[
                      styles.monthCellText,
                      !iso && styles.monthCellHiddenText,
                      iso === selectedDate && styles.monthCellTextSelected,
                    ]}>
                      {iso ? toMidnight(iso).getDate() : ''}
                    </Text>
                  </Pressable>
                ))}
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
              {dayMeals.length} {dayMeals.length === 1 ? 'meal' : 'meals'} · {dayCal.toLocaleString()} cal
            </Text>
          </View>
          <Text style={styles.dayDetailChevron}>›</Text>
        </TouchableOpacity>

        <PlannedIngredientsSection />

        <ExplorePlansSection />

        <SavedPlansSection />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 14, paddingBottom: 40, gap: 12 },

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
  monthCellTextSelected: { color: COLORS.green, fontWeight: '700' },

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
});
