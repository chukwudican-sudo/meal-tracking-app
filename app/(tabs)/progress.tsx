import { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotificationIcon } from '@/components/NotificationIcon';
import { ProfileIcon } from '@/components/ProfileIcon';
import { COLORS } from '@/constants/theme';
import { toIsoDate, useMealStore } from '@/store/useMealStore';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// Heatmap fixed sizing — horizontal scroll, no shrink-to-fit needed
const H_CELL        = 11;
const H_COL_GAP     = 2;
const H_ROW_GAP     = 3;
const H_MONTH_DIV   = 3;
const H_LABEL_W     = 16;
const H_LABEL_GAP   = 5;
const H_MON_LABEL_H = 16;

function getIntensity(planned: number, completed: number): 0 | 1 | 2 | 3 {
  if (planned <= 0 || completed <= 0) return 0;
  const pct = Math.round((completed / planned) * 100);
  if (pct <= 33) return 1;
  if (pct <= 99) return 2;
  return 3;
}

export default function ProgressScreen() {
  const logs = useMealStore(s => s.logs);

  const todayIso = toIsoDate(new Date());

  const yearsWithCompletions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>();
    Object.keys(logs).forEach(iso => {
      if (logs[iso]?.meals.some(m => m.status === 'completed')) {
        years.add(Number(iso.slice(0, 4)));
      }
    });
    if (years.size === 0) years.add(currentYear);
    if (years.size === 1 && !years.has(currentYear)) years.add(currentYear);
    return Array.from(years).sort((a, b) => a - b);
  }, [logs]);
  const [selectedYear, setSelectedYear] = useState(
    () => yearsWithCompletions[yearsWithCompletions.length - 1]
  );

  const getDayProgress = useCallback(
    (iso: string) => {
      const dayMeals = logs[iso]?.meals ?? [];
      const planned = dayMeals.length;
      const completed = dayMeals.filter(m => m.status === 'completed').length;
      const pct = planned === 0 ? 0 : Math.round((completed / planned) * 100);
      return { planned, completed, pct };
    },
    [logs]
  );

  const heatmapColumns = useMemo(() => {
    const columns: {
      weekStartIso: string;
      isMonthStart: boolean;
      monthIdx: number;
      cells: { iso: string; isFiller: boolean; hidden: boolean; intensity: 0 | 1 | 2 | 3 }[];
    }[] = [];

    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(selectedYear, month, 1);
      const monthEnd   = new Date(selectedYear, month + 1, 0);

      const startDow   = monthStart.getDay();
      const firstSun   = new Date(monthStart);
      firstSun.setDate(monthStart.getDate() - startDow);

      const endDow     = monthEnd.getDay();
      const lastSat    = new Date(monthEnd);
      lastSat.setDate(monthEnd.getDate() + (6 - endDow));

      const totalDays = Math.round((lastSat.getTime() - firstSun.getTime()) / 86400000) + 1;
      const numCols   = totalDays / 7;

      for (let w = 0; w < numCols; w++) {
        const weekSun = new Date(firstSun);
        weekSun.setDate(firstSun.getDate() + w * 7);

        const cells: { iso: string; isFiller: boolean; hidden: boolean; intensity: 0 | 1 | 2 | 3 }[] = [];

        for (let d = 0; d < 7; d++) {
          const current = new Date(weekSun);
          current.setDate(weekSun.getDate() + d);
          const iso = toIsoDate(current);

          const isFiller = current.getMonth() !== month || current.getFullYear() !== selectedYear;
          const hidden = !isFiller && iso > todayIso;

          let intensity: 0 | 1 | 2 | 3 = 0;
          if (!isFiller && !hidden) {
            const { planned, completed } = getDayProgress(iso);
            intensity = getIntensity(planned, completed);
          }

          cells.push({ iso, isFiller, hidden, intensity });
        }

        columns.push({
          weekStartIso: toIsoDate(weekSun),
          isMonthStart: w === 0,
          monthIdx: month,
          cells,
        });
      }
    }

    return columns;
  }, [getDayProgress, selectedYear, todayIso]);

  const monthAnchors = useMemo(() => {
    const labels: { monthIdx: number; leftPx: number }[] = [];
    let leftPos = 0;
    heatmapColumns.forEach((col, idx) => {
      if (idx > 0 && col.isMonthStart) leftPos += H_MONTH_DIV;
      if (col.isMonthStart) labels.push({ monthIdx: col.monthIdx, leftPx: leftPos });
      leftPos += H_CELL + (idx < heatmapColumns.length - 1 ? H_COL_GAP : 0);
    });
    return labels;
  }, [heatmapColumns]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Progress</Text>
        <View style={styles.headerActions}>
          <ProfileIcon />
          <NotificationIcon />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Yearly heatmap</Text>
            <View style={styles.yearRow}>
              {yearsWithCompletions.length > 1 && (
                <TouchableOpacity
                  onPress={() => {
                    const idx = yearsWithCompletions.indexOf(selectedYear);
                    if (idx > 0) setSelectedYear(yearsWithCompletions[idx - 1]);
                  }}
                >
                  <Text style={styles.yearNav}>←</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.yearText}>{selectedYear}</Text>
              {yearsWithCompletions.length > 1 && (
                <TouchableOpacity
                  onPress={() => {
                    const idx = yearsWithCompletions.indexOf(selectedYear);
                    if (idx < yearsWithCompletions.length - 1) {
                      setSelectedYear(yearsWithCompletions[idx + 1]);
                    }
                  }}
                >
                  <Text style={styles.yearNav}>→</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Heatmap: fixed label column on left, horizontal-scrollable grid on right */}
          <View style={styles.heatmapOuter}>
            <View
              style={[
                styles.dayLegendCol,
                { width: H_LABEL_W, marginRight: H_LABEL_GAP, paddingTop: H_MON_LABEL_H + 4 },
              ]}
            >
              {(['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const).map((label, rowIdx) => (
                <View
                  key={`legend-${rowIdx}`}
                  style={{
                    height: H_CELL,
                    marginBottom: rowIdx === 6 ? 0 : H_ROW_GAP,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Text style={styles.dayLegendText}>{label}</Text>
                </View>
              ))}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              bounces={false}
              nestedScrollEnabled
              style={{ flex: 1 }}
            >
              <View>
                <View style={{ height: H_MON_LABEL_H, position: 'relative', marginBottom: 4 }}>
                  {monthAnchors.map(anchor => (
                    <Text
                      key={`month-${anchor.monthIdx}`}
                      style={[styles.monthLabelAbs, { left: anchor.leftPx }]}
                    >
                      {MONTHS[anchor.monthIdx]}
                    </Text>
                  ))}
                </View>

                {Array.from({ length: 7 }, (_, rowIdx) => (
                  <View
                    key={`row-${rowIdx}`}
                    style={{
                      flexDirection: 'row',
                      marginBottom: rowIdx === 6 ? 0 : H_ROW_GAP,
                    }}
                  >
                    {heatmapColumns.map((column, colIdx) => {
                      const cell = column.cells[rowIdx];
                      const isFirst = colIdx === 0;
                      const isLast = colIdx === heatmapColumns.length - 1;
                      return (
                        <View
                          key={`${column.weekStartIso}-${rowIdx}-${colIdx}`}
                          style={[
                            styles.heatCell,
                            {
                              width: H_CELL,
                              height: H_CELL,
                              marginLeft: !isFirst && column.isMonthStart ? H_MONTH_DIV : 0,
                              marginRight: isLast ? 0 : H_COL_GAP,
                            },
                            (cell.isFiller || cell.hidden) && styles.heatFuture,
                            !cell.isFiller && !cell.hidden && cell.intensity === 0 && styles.heat0,
                            !cell.isFiller && !cell.hidden && cell.intensity === 1 && styles.heat1,
                            !cell.isFiller && !cell.hidden && cell.intensity === 2 && styles.heat2,
                            !cell.isFiller && !cell.hidden && cell.intensity === 3 && styles.heat3,
                          ]}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.heatLegendRow}>
            <Text style={styles.heatLegendLabel}>Fewer</Text>
            {(
              [
                styles.heatFuture,
                styles.heat0,
                styles.heat1,
                styles.heat2,
                styles.heat3,
              ] as const
            ).map((s, i) => (
              <View key={`leg-${i}`} style={[styles.heatLegendCell, s]} />
            ))}
            <Text style={styles.heatLegendLabel}>More</Text>
          </View>
        </View>

        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderTitle}>More insights coming soon</Text>
          <Text style={styles.placeholderBody}>
            Streaks, weekly totals, and macro trends will live here.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },

  scroll: { padding: 14, paddingBottom: 34, gap: 12 },

  sectionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yearNav: { color: COLORS.text, fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
  yearText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  heatmapOuter: { flexDirection: 'row', alignItems: 'flex-start' },
  monthLabelAbs: {
    color: COLORS.textSecondary,
    fontSize: 10,
    position: 'absolute',
    top: 3,
  },
  dayLegendCol: { alignItems: 'center' },
  dayLegendText: { color: COLORS.textSecondary, fontSize: 8, fontWeight: '600' },

  heatCell: { borderRadius: 2 },
  heatFuture: { backgroundColor: '#212123' },
  heat0: { backgroundColor: COLORS.elevated },
  heat1: { backgroundColor: COLORS.green + '44' },
  heat2: { backgroundColor: COLORS.green + '88' },
  heat3: { backgroundColor: COLORS.green },

  heatLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 8,
  },
  heatLegendLabel: { color: COLORS.textSecondary, fontSize: 10 },
  heatLegendCell: { width: 10, height: 10, borderRadius: 2 },

  placeholderCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  placeholderTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  placeholderBody: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});
