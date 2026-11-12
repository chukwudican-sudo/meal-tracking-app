import { StyleSheet, Text, View } from 'react-native';

import { Slider } from '@/components/onboarding/Slider';
import { PACE_STEP, clampPace, formatPace, paceRange } from '@/constants/goalCalc';
import { COLORS } from '@/constants/theme';
import type { GoalType } from '@/store/types';

// The pace picker (lb/week). Onboarding and Edit Goal share it, so both offer
// the same range and steps the calculator uses. Renders nothing for maintain.
export function PaceSlider({
  goalType, value, imperial, onChange,
}: {
  goalType: GoalType;
  value: number | null | undefined;
  imperial: boolean;
  onChange: (lbsPerWeek: number) => void;
}) {
  const range = paceRange(goalType);
  const pace = clampPace(goalType, value);
  if (!range || pace == null) return null;

  const t = (pace - range.min) / (range.max - range.min);
  const mood = t < 0.34 ? 'Gentle and sustainable' : t < 0.67 ? 'Steady momentum' : 'Ambitious pace';

  return (
    <View>
      <Text style={styles.rate}>{formatPace(pace, imperial)}</Text>
      <View style={styles.sliderWrap}>
        <Slider min={range.min} max={range.max} step={PACE_STEP} value={pace} onChange={onChange} />
      </View>
      <Text style={styles.mood}>{mood}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rate: { color: COLORS.text, fontSize: 28, fontWeight: '700', textAlign: 'center', marginTop: 24 },
  sliderWrap: { paddingHorizontal: 4, marginTop: 20 },
  mood: { color: COLORS.green, fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 18 },
});
