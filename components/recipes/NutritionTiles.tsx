// Big calorie tile + Protein / Carbs / Fats tiles. The one nutrition design
// for every recipe page (recipe page, full recipe page), taken from the
// Custom Recipe concept page Alex liked.

import { StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import type { Macros } from '@/store/types';

const TILE_GAP = 10;

export function NutritionTiles({ calories, macros }: { calories: number; macros: Macros }) {
  return (
    <View>
      <View style={[styles.tile, styles.tileBig]}>
        <Text style={[styles.value, styles.valueBig]}>{calories}</Text>
        <Text style={styles.label}>Calories</Text>
      </View>
      <View style={styles.row}>
        {([
          ['Protein', macros.protein],
          ['Carbs', macros.carbs],
          ['Fats', macros.fats],
        ] as const).map(([label, value]) => (
          <View key={label} style={[styles.tile, styles.third]}>
            <Text style={styles.value}>{value}g</Text>
            <Text style={styles.label}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  tileBig: { backgroundColor: COLORS.elevated, width: '100%' },
  row: { flexDirection: 'row', gap: TILE_GAP, marginTop: TILE_GAP },
  third: { flex: 1 },
  value: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  valueBig: { fontSize: 30 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
});
