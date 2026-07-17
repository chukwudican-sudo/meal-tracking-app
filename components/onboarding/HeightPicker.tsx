import { StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import { WheelPicker, type WheelItem } from './WheelPicker';

export type HeightUnit = 'metric' | 'imperial';

interface HeightPickerProps {
  heightCm: number;
  unit: HeightUnit;
  onChange: (cm: number) => void;
  onUnitChange: (unit: HeightUnit) => void;
}

const CM_MIN = 120;
const CM_MAX = 220;
const FT_MIN = 3;
const FT_MAX = 7;

const CM_ITEMS: WheelItem<number>[] = Array.from(
  { length: CM_MAX - CM_MIN + 1 },
  (_, i) => ({ label: `${CM_MIN + i} cm`, value: CM_MIN + i }),
);
const FT_ITEMS: WheelItem<number>[] = Array.from(
  { length: FT_MAX - FT_MIN + 1 },
  (_, i) => ({ label: `${FT_MIN + i} ft`, value: FT_MIN + i }),
);
const IN_ITEMS: WheelItem<number>[] = Array.from(
  { length: 12 },
  (_, i) => ({ label: `${i} in`, value: i }),
);
const UNIT_ITEMS: WheelItem<HeightUnit>[] = [
  { label: 'ft/in', value: 'imperial' },
  { label: 'cm', value: 'metric' },
];

export function HeightPicker({ heightCm, unit, onChange, onUnitChange }: HeightPickerProps) {
  const totalIn = heightCm / 2.54;
  const ft = Math.max(FT_MIN, Math.min(FT_MAX, Math.floor(totalIn / 12)));
  const inch = Math.max(0, Math.min(11, Math.round(totalIn - ft * 12)));
  const cmIdx = Math.max(0, Math.min(CM_ITEMS.length - 1, Math.round(heightCm) - CM_MIN));

  return (
    <View style={styles.row}>
      {unit === 'metric' ? (
        <WheelPicker
          items={CM_ITEMS}
          selectedIndex={cmIdx}
          onIndexChange={(i) => onChange(CM_ITEMS[i].value)}
          width={110}
        />
      ) : (
        <>
          <WheelPicker
            items={FT_ITEMS}
            selectedIndex={ft - FT_MIN}
            onIndexChange={(i) => onChange((FT_ITEMS[i].value * 12 + inch) * 2.54)}
            width={80}
          />
          <WheelPicker
            items={IN_ITEMS}
            selectedIndex={inch}
            onIndexChange={(i) => onChange((ft * 12 + IN_ITEMS[i].value) * 2.54)}
            width={80}
          />
        </>
      )}
      <View style={styles.divider} />
      <WheelPicker
        items={UNIT_ITEMS}
        selectedIndex={UNIT_ITEMS.findIndex(u => u.value === unit)}
        onIndexChange={(i) => onUnitChange(UNIT_ITEMS[i].value)}
        width={70}
      />
      <Text style={styles.hint}>scroll unit →</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  divider: { width: 1, height: 120, backgroundColor: COLORS.border, marginHorizontal: 4 },
  hint: { position: 'absolute', bottom: -4, right: 0, color: COLORS.textMuted, fontSize: 10 },
});
