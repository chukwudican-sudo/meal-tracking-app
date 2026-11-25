// "You will reach your goal by …" — the goal line graph, the goal weight and
// the date. Shared by onboarding's results and Edit Goal (Nov 25: Edit Goal
// never showed it), so both always look the same. Content only: each flow
// adds its own button.

import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle as SvgCircle, Line, Polyline } from 'react-native-svg';

import { COLORS } from '@/constants/theme';

export function GoalTimeline({
  name, currentLabel, goalLabel, goalDate, losing,
}: {
  name: string;
  currentLabel: string;
  goalLabel: string;
  /** YYYY-MM-DD, or null when there's no meaningful date. */
  goalDate: string | null;
  losing: boolean;
}) {
  // The graph fills whatever width the screen gives it.
  const [w, setW] = useState(0);
  const h = 140;
  const y1 = losing ? 30 : h - 30;
  const y2 = losing ? h - 30 : 30;
  const dateText = goalDate
    ? new Date(goalDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'your target date';
  const months = useMemo(() => {
    const arr: string[] = [];
    const d = new Date();
    for (let i = 0; i < 4; i++) { arr.push(d.toLocaleDateString('en-US', { month: 'short' })); d.setMonth(d.getMonth() + 1); }
    return arr;
  }, []);
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={h}>
          <Line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke={COLORS.border} strokeWidth={1} />
          <Polyline points={`0,${y1} ${w},${y2}`} fill="none" stroke={COLORS.green} strokeWidth={3} strokeLinecap="round" />
          <SvgCircle cx={0} cy={y1} r={5} fill={COLORS.green} />
          <SvgCircle cx={w} cy={y2} r={6} fill={COLORS.green} />
        </Svg>
      )}
      <View style={[styles.monthRow, w === 0 && { marginTop: h + 6 }]}>
        {months.map((m, i) => <Text key={i} style={styles.monthLabel}>{m}</Text>)}
      </View>

      <Text style={styles.resultLabel}>Your goal weight</Text>
      <Text style={styles.resultBig}>{goalLabel}</Text>
      <View style={styles.motivTag}><Text style={styles.motivTagText}>You can do it!</Text></View>

      <Text style={[styles.resultLabel, { marginTop: 24 }]}>Your personalized plan</Text>
      <Text style={styles.resultPlan}>
        {name || 'You'}, you will reach your goal by {dateText}.
      </Text>
      <Text style={styles.resultSub}>From {currentLabel} → {goalLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  monthLabel: { color: COLORS.textMuted, fontSize: 11 },
  resultLabel: { color: COLORS.textSecondary, fontSize: 13, marginTop: 20 },
  resultBig: { color: COLORS.text, fontSize: 34, fontWeight: '800', marginTop: 4 },
  motivTag: { alignSelf: 'flex-start', backgroundColor: COLORS.green + '22', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10 },
  motivTagText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  resultPlan: { color: COLORS.text, fontSize: 17, fontWeight: '600', marginTop: 6, lineHeight: 24 },
  resultSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 8 },
});
