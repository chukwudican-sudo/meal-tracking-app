import { useCallback, useState } from 'react';
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
import { DayDetailModal } from '@/components/DayDetailModal';
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

function shiftIso(iso: string, offsetDays: number): string {
  const d = toMidnight(iso);
  d.setDate(d.getDate() + offsetDays);
  return toIsoDate(d);
}

function mondayOfWeek(iso: string): string {
  const d = toMidnight(iso);
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return toIsoDate(d);
}

// Returns 6 rows × 7 cols (Mon–Sun) for the month containing anchorIso.
// Each row also carries its Monday ISO so we can match it to the selected week.
function monthGridRows(anchorIso: string): { weekStartIso: string; cells: (string | null)[] }[] {
  const d = toMidnight(anchorIso);
  d.setDate(1);
  const startDow = d.getDay();
  const monOffset = startDow === 0 ? 6 : startDow - 1;
  const start = new Date(d);
  start.setDate(d.getDate() - monOffset);

  return Array.from({ length: 6 }, (_, row) => {
    const monday = new Date(start);
    monday.setDate(start.getDate() + row * 7);
    const cells: (string | null)[] = Array.from({ length: 7 }, (__, col) => {
      const cell = new Date(monday);
      cell.setDate(monday.getDate() + col);
      return cell.getMonth() === d.getMonth() ? toIsoDate(cell) : null;
    });
    return { weekStartIso: toIsoDate(monday), cells };
  });
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

  const todayIso = toIsoDate(new Date());
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [miniMonthAnchor, setMiniMonthAnchor] = useState(todayIso);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);
  const [weekExpanded, setWeekExpanded] = useState(true);

  const weekStartIso = mondayOfWeek(selectedDate);
  const weekDates = Array.from({ length: 7 }, (_, i) => shiftIso(weekStartIso, i));

  const getDayProgress = useCallback((iso: string) => {
    const dayMeals = logs[iso]?.meals ?? [];
    const planned = dayMeals.length;
    const completed = dayMeals.filter(m => m.status === 'completed').length;
    const pct = planned === 0 ? 0 : Math.round((completed / planned) * 100);
    return { planned, completed, pct };
  }, [logs]);

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
            <Text style={styles.muted}>{toMidnight(miniMonthAnchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
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
            {monthGridRows(miniMonthAnchor).map((row, rowIdx) => {
              const rowIsSelectedWeek = row.weekStartIso === weekStartIso;
              return (
                <View key={rowIdx} style={[styles.miniRow, rowIsSelectedWeek && styles.miniRowWeek]}>
                  {row.cells.map((iso, colIdx) => (
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
              );
            })}
          </View>
        </View>

        {/* Week schedule — collapsible, mirrors PlannedIngredientsSection layout. */}
        <View style={styles.weekWrap}>
          <Pressable
            style={styles.weekHeaderRow}
            onPress={() => setWeekExpanded(v => !v)}
            hitSlop={6}
          >
            <Text style={styles.weekTitle}>Week schedule</Text>
            <Text style={styles.weekChevron}>{weekExpanded ? '▾' : '▸'}</Text>
          </Pressable>

          {!weekExpanded && (
            <Text style={styles.collapsedHint}>
              {weekDates.length} days in current week
            </Text>
          )}

          {weekExpanded && (
            <View style={styles.weekBody}>
              {weekDates.map(iso => {
                const progress = getDayProgress(iso);
                return (
                  <View key={iso} style={styles.dayCard}>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedDate(iso);
                        setDayDetailDate(iso);
                      }}
                      style={styles.dayHeader}
                      activeOpacity={0.8}
                    >
                      <View>
                        <Text style={styles.dayTitle}>
                          {toMidnight(iso).toLocaleDateString('en-US', { weekday: 'short' })} {toMidnight(iso).getDate()}
                        </Text>
                        <Text style={styles.dayMeta}>{progress.planned} planned</Text>
                      </View>
                      <Text style={styles.dayPct}>{progress.pct}%</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <PlannedIngredientsSection />

        <ExplorePlansSection />

        <SavedPlansSection />
      </ScrollView>

      <DayDetailModal date={dayDetailDate} onClose={() => setDayDetailDate(null)} />
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
  miniRow: { flexDirection: 'row', borderRadius: 13, overflow: 'hidden' },
  miniRowWeek: { backgroundColor: COLORS.green + '20' },
  monthCell: { flex: 1, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  monthCellSelected: { backgroundColor: COLORS.green + '44' },
  monthCellHiddenText: { color: 'transparent' },
  monthCellText: { color: COLORS.textSecondary, fontSize: 12 },
  monthCellTextSelected: { color: COLORS.green, fontWeight: '700' },

  // Week schedule — matches PlannedIngredientsSection wrapper exactly
  weekWrap: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  weekHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', flex: 1 },
  weekChevron: { color: COLORS.textSecondary, fontSize: 16, paddingHorizontal: 6 },
  collapsedHint: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },
  weekBody: { marginTop: 10 },
  dayCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
  dayHeader: { padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayTitle: { color: COLORS.text, fontWeight: '600', fontSize: 13 },
  dayMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  dayPct: { color: COLORS.green, fontWeight: '700', fontSize: 13 },
});
