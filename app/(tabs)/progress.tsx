import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';

import { NotificationIcon } from '@/components/NotificationIcon';
import { ProfileIcon } from '@/components/ProfileIcon';
import { COLORS } from '@/constants/theme';
import { kgToLbs, lbsToKg } from '@/constants/goalCalc';
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

// `logged` = no plan score, but the user ate meals they added themselves:
// shown at the lightest level so logging still visibly counts.
function getIntensity(planned: number, completed: number, logged = false): 0 | 1 | 2 | 3 {
  if (planned <= 0 || completed <= 0) return logged ? 1 : 0;
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

  // Horizontal scroll ref + per-month x-offsets, used to auto-snap the
  // heatmap to the current month on first load and on every tab visit.
  const heatmapScrollRef = useRef<ScrollView>(null);

  // Reset to current year + re-snap the scroll position on every focus.
  // The heatmap should always feel "fresh" when the user comes back here.
  useFocusEffect(
    useCallback(() => {
      const currentYear = new Date().getFullYear();
      setSelectedYear(prev => (prev === currentYear ? prev : currentYear));
    }, []),
  );

  const getDayProgress = useCallback(
    (iso: string) => {
      // Plan score counts PLANNED meals only — meals the user added themselves
      // (isAdHoc) still count toward calories/rings, but mustn't inflate or
      // drag down how well the plan was followed. `logged` marks a day with
      // only the user's own eaten meals.
      const dayMeals = logs[iso]?.meals ?? [];
      const planMeals = dayMeals.filter(m => !m.isAdHoc);
      const planned = planMeals.length;
      const completed = planMeals.filter(m => m.status === 'completed').length;
      const pct = planned === 0 ? 0 : Math.round((completed / planned) * 100);
      const logged = dayMeals.some(m => m.isAdHoc && m.status === 'completed');
      return { planned, completed, pct, logged };
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
            const { planned, completed, logged } = getDayProgress(iso);
            intensity = getIntensity(planned, completed, logged);
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

  // Auto-snap the horizontal heatmap scroll to today's month when the
  // selected year is the current year. We center the month on screen as
  // best we can without knowing the viewport width — `scrollTo` clamps
  // automatically if the offset overshoots the content.
  useEffect(() => {
    const now = new Date();
    if (selectedYear !== now.getFullYear()) return;
    const anchor = monthAnchors.find(a => a.monthIdx === now.getMonth());
    if (!anchor) return;
    // Defer so the ScrollView has measured its content.
    const t = setTimeout(() => {
      heatmapScrollRef.current?.scrollTo({ x: Math.max(0, anchor.leftPx - 12), animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [monthAnchors, selectedYear]);

  // Year picker — iOS gets a native action sheet, Android falls back to Alert.
  const openYearPicker = useCallback(() => {
    if (yearsWithCompletions.length <= 1) return;
    if (Platform.OS === 'ios') {
      const options = [...yearsWithCompletions.map(String), 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          title: 'Select year',
        },
        idx => {
          if (idx === options.length - 1) return;
          setSelectedYear(yearsWithCompletions[idx]);
        },
      );
    } else {
      Alert.alert(
        'Select year',
        undefined,
        [
          ...yearsWithCompletions.map(y => ({
            text: String(y),
            onPress: () => setSelectedYear(y),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    }
  }, [yearsWithCompletions]);

  return (
    <Screen edges={['top']}>
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
            {/* Year is a dropdown only when there's more than one year of data;
                otherwise it's a plain static label. */}
            {yearsWithCompletions.length > 1 ? (
              <TouchableOpacity onPress={openYearPicker} hitSlop={8} style={styles.yearChip}>
                <Text style={styles.yearText}>{selectedYear}</Text>
                <Text style={styles.yearChipChevron}>▾</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.yearText}>{selectedYear}</Text>
            )}
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
              ref={heatmapScrollRef}
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

        <WeightSection />

        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderTitle}>More insights coming soon</Text>
          <Text style={styles.placeholderBody}>
            Streaks, weekly totals, and macro trends will live here.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── Weight logging ─────────────────────────────────────────────────────────

function WeightSection() {
  const weightLog = useMealStore(s => s.weightLog);
  const profile   = useMealStore(s => s.profile);
  const logWeight = useMealStore(s => s.logWeight);

  const isImperial = (profile.weightUnit ?? 'lbs') === 'lbs';
  const unit = isImperial ? 'lbs' : 'kg';

  const [logging, setLogging] = useState(false);
  const [input, setInput] = useState('');
  const [chartWidth, setChartWidth] = useState(0);

  const displayWeight = (kg: number) =>
    Math.round(isImperial ? kgToLbs(kg) : kg);

  const currentWeight = profile.weightKg != null ? displayWeight(profile.weightKg) : null;

  const handleSave = () => {
    const n = Number(input);
    if (!Number.isFinite(n) || n <= 0) return;
    const kg = isImperial ? lbsToKg(n) : n;
    logWeight(kg);
    setInput('');
    setLogging(false);
  };

  const recent = weightLog.slice(-30);

  // Chart geometry
  const CHART_H = 120;
  const PAD = 10;
  const points = useMemo(() => {
    if (recent.length === 0 || chartWidth === 0) return [];
    const values = recent.map(e => (isImperial ? kgToLbs(e.weightKg) : e.weightKg));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const innerW = chartWidth - PAD * 2;
    const innerH = CHART_H - PAD * 2;
    return values.map((v, i) => {
      const x = recent.length === 1
        ? chartWidth / 2
        : PAD + (i / (recent.length - 1)) * innerW;
      const y = PAD + (1 - (v - min) / span) * innerH;
      return { x, y };
    });
  }, [recent, chartWidth, isImperial]);

  const minMax = useMemo(() => {
    if (recent.length === 0) return null;
    const values = recent.map(e => displayWeight(e.weightKg));
    return { min: Math.min(...values), max: Math.max(...values) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, isImperial]);

  const firstDate = recent[0]?.date;
  const lastDate = recent[recent.length - 1]?.date;
  const fmtDate = (iso?: string) =>
    iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Weight</Text>
        <TouchableOpacity
          style={styles.logWeightBtn}
          onPress={() => setLogging(v => !v)}
          activeOpacity={0.8}
        >
          <Text style={styles.logWeightBtnText}>{logging ? 'Cancel' : '+ Log Weight'}</Text>
        </TouchableOpacity>
      </View>

      {currentWeight != null && !logging ? (
        <Text style={styles.currentWeight}>{currentWeight} {unit}</Text>
      ) : null}

      {logging ? (
        <View style={styles.logRow}>
          <TextInput
            style={styles.weightInput}
            value={input}
            onChangeText={setInput}
            keyboardType="decimal-pad"
            placeholder={isImperial ? '170' : '77'}
            placeholderTextColor={COLORS.textMuted}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />
          <Text style={styles.weightInputUnit}>{unit}</Text>
          <TouchableOpacity
            style={[styles.saveWeightBtn, !input.trim() && styles.saveWeightBtnDisabled]}
            onPress={handleSave}
            disabled={!input.trim()}
            activeOpacity={0.85}
          >
            <Text style={styles.saveWeightBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {recent.length === 0 ? (
        <Text style={styles.weightEmpty}>Log your first weight to start tracking.</Text>
      ) : (
        <View style={styles.chartWrap}>
          <View style={styles.chartYAxis}>
            <Text style={styles.chartAxisLabel}>{minMax?.max}</Text>
            <Text style={styles.chartAxisLabel}>{minMax?.min}</Text>
          </View>
          <View
            style={styles.chartArea}
            onLayout={e => setChartWidth(e.nativeEvent.layout.width)}
          >
            {chartWidth > 0 ? (
              <Svg width={chartWidth} height={CHART_H}>
                {points.length > 1 ? (
                  <Polyline
                    points={points.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={COLORS.green}
                    strokeWidth={2}
                  />
                ) : null}
                {points.map((p, i) => (
                  <Circle key={i} cx={p.x} cy={p.y} r={3} fill={COLORS.green} />
                ))}
              </Svg>
            ) : null}
            <View style={styles.chartXAxis}>
              <Text style={styles.chartAxisLabel}>{fmtDate(firstDate)}</Text>
              {recent.length > 1 ? <Text style={styles.chartAxisLabel}>{fmtDate(lastDate)}</Text> : null}
            </View>
          </View>
        </View>
      )}
    </View>
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

  scroll: { padding: 14, paddingBottom: 96, gap: 12 },

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
  yearText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  yearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  yearChipChevron: { color: COLORS.textSecondary, fontSize: 10 },

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

  // ── Weight section ──
  logWeightBtn: {
    backgroundColor: COLORS.green,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  logWeightBtnText: { color: '#0E1A12', fontSize: 12, fontWeight: '700' },
  currentWeight: { color: COLORS.text, fontSize: 24, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 4 },
  weightInput: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    color: COLORS.text,
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  weightInputUnit: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  saveWeightBtn: {
    backgroundColor: COLORS.green,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
  },
  saveWeightBtnDisabled: { opacity: 0.45 },
  saveWeightBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
  weightEmpty: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 10,
    textAlign: 'center',
  },
  chartWrap: { flexDirection: 'row', marginTop: 12, alignItems: 'stretch' },
  chartYAxis: { justifyContent: 'space-between', paddingVertical: 6, marginRight: 6, height: 120 },
  chartArea: { flex: 1 },
  chartXAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chartAxisLabel: { color: COLORS.textSecondary, fontSize: 10 },

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
