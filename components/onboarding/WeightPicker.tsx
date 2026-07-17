import { StyleSheet, Text, View } from 'react-native';

import { KG_PER_LB, LBS_PER_KG } from '@/constants/onboardingCalc';
import { COLORS } from '@/constants/theme';
import { WheelPicker, type WheelItem } from './WheelPicker';

export type WeightUnitChoice = 'lbs' | 'kg' | 'st';

interface WeightPickerProps {
  weightKg: number;
  unit: WeightUnitChoice;
  onChange: (kg: number) => void;
  onUnitChange: (unit: WeightUnitChoice) => void;
}

const LBS_ITEMS: WheelItem<number>[] = range(60, 500).map(n => ({ label: `${n}`, value: n }));
const KG_ITEMS: WheelItem<number>[] = range(27, 250).map(n => ({ label: `${n}`, value: n }));
const TENTHS: WheelItem<number>[] = range(0, 9).map(n => ({ label: `.${n}`, value: n }));
const STONE_ITEMS: WheelItem<number>[] = range(4, 35).map(n => ({ label: `${n} st`, value: n }));
const ST_LBS_ITEMS: WheelItem<number>[] = range(0, 13).map(n => ({ label: `${n} lb`, value: n }));
const UNIT_ITEMS: WheelItem<WeightUnitChoice>[] = [
  { label: 'lbs', value: 'lbs' },
  { label: 'kg', value: 'kg' },
  { label: 'st/lbs', value: 'st' },
];

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

export function WeightPicker({ weightKg, unit, onChange, onUnitChange }: WeightPickerProps) {
  const unitIdx = UNIT_ITEMS.findIndex(u => u.value === unit);

  let columns: React.ReactNode;

  if (unit === 'kg') {
    const whole = Math.max(27, Math.min(250, Math.floor(weightKg)));
    const tenth = Math.max(0, Math.min(9, Math.round((weightKg - Math.floor(weightKg)) * 10)));
    columns = (
      <>
        <WheelPicker
          items={KG_ITEMS}
          selectedIndex={whole - 27}
          onIndexChange={(i) => onChange(KG_ITEMS[i].value + tenth / 10)}
          width={80}
        />
        <WheelPicker
          items={TENTHS}
          selectedIndex={tenth}
          onIndexChange={(i) => onChange(whole + TENTHS[i].value / 10)}
          width={56}
        />
      </>
    );
  } else if (unit === 'lbs') {
    const totalLbs = weightKg * LBS_PER_KG;
    const whole = Math.max(60, Math.min(500, Math.floor(totalLbs)));
    const tenth = Math.max(0, Math.min(9, Math.round((totalLbs - Math.floor(totalLbs)) * 10)));
    columns = (
      <>
        <WheelPicker
          items={LBS_ITEMS}
          selectedIndex={whole - 60}
          onIndexChange={(i) => onChange((LBS_ITEMS[i].value + tenth / 10) * KG_PER_LB)}
          width={80}
        />
        <WheelPicker
          items={TENTHS}
          selectedIndex={tenth}
          onIndexChange={(i) => onChange((whole + TENTHS[i].value / 10) * KG_PER_LB)}
          width={56}
        />
      </>
    );
  } else {
    // stone / lbs
    const totalLbs = weightKg * LBS_PER_KG;
    const stone = Math.max(4, Math.min(35, Math.floor(totalLbs / 14)));
    const lbsRem = Math.max(0, Math.min(13, Math.round(totalLbs - stone * 14)));
    columns = (
      <>
        <WheelPicker
          items={STONE_ITEMS}
          selectedIndex={stone - 4}
          onIndexChange={(i) => onChange((STONE_ITEMS[i].value * 14 + lbsRem) * KG_PER_LB)}
          width={80}
        />
        <WheelPicker
          items={ST_LBS_ITEMS}
          selectedIndex={lbsRem}
          onIndexChange={(i) => onChange((stone * 14 + ST_LBS_ITEMS[i].value) * KG_PER_LB)}
          width={70}
        />
      </>
    );
  }

  return (
    <View style={styles.row}>
      {columns}
      <View style={styles.divider} />
      <WheelPicker
        items={UNIT_ITEMS}
        selectedIndex={unitIdx}
        onIndexChange={(i) => onUnitChange(UNIT_ITEMS[i].value)}
        width={80}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  divider: { width: 1, height: 120, backgroundColor: COLORS.border, marginHorizontal: 4 },
});
