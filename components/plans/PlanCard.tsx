import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import type { MealPlan } from '@/store/types';

export type PlanCardVariant = 'compact' | 'row';

interface Props {
  plan: MealPlan;
  variant?: PlanCardVariant;
  onPress?: () => void;
  onLongPress?: () => void;
}

function countDistinctMeals(plan: MealPlan): number {
  const ids = new Set<string>();
  plan.days.forEach(day => day.forEach(m => ids.add(m.recipeId)));
  return ids.size;
}

export function PlanCard({ plan, variant = 'compact', onPress, onLongPress }: Props) {
  const distinct = countDistinctMeals(plan);
  const cal = plan.targets?.calories;

  if (variant === 'row') {
    return (
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onLongPress}
        activeOpacity={0.7}
        style={styles.row}
      >
        <View style={styles.rowThumb}>
          <Text style={styles.rowThumbEmoji}>📋</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowName} numberOfLines={1}>{plan.name}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {cal != null ? `${cal} cal/day · ` : ''}{distinct} unique meals
            {plan.category ? ` · ${plan.category}` : ''}
          </Text>
        </View>
        <Text style={styles.rowChevron}>›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.85}
      style={styles.compact}
    >
      <View style={styles.compactThumb}>
        <Text style={styles.compactThumbEmoji}>📋</Text>
      </View>
      <Text style={styles.compactName} numberOfLines={2}>{plan.name}</Text>
      <Text style={styles.compactMeta}>
        {cal != null ? `${cal} cal/day` : `${distinct} meals`}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  compact: {
    width: 170,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    marginRight: 12,
  },
  compactThumb: {
    height: 86,
    borderRadius: 10,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  compactThumbEmoji: { fontSize: 34 },
  compactName: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  compactMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 10,
  },
  rowThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowThumbEmoji: { fontSize: 24 },
  rowBody: { flex: 1 },
  rowName: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rowChevron: { color: COLORS.textSecondary, fontSize: 22, paddingLeft: 8 },
});
