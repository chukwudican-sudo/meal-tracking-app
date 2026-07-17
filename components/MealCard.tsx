import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '@/constants/theme';
import type { MealEntry } from '@/store/types';

interface MealCardProps {
  entry: MealEntry;
  onToggle: () => void;
  onOpenDetail: () => void;
}

export function MealCard({ entry, onToggle, onOpenDetail }: MealCardProps) {
  const isCompleted = entry.status === 'completed';
  const isMissed    = entry.status === 'missed';

  // Completed: thin green border all around. Missed: red left bar only. Pending: none.
  const borderStyle = isCompleted
    ? { borderWidth: 1.5, borderColor: COLORS.green }
    : isMissed
    ? { borderLeftWidth: 3, borderTopWidth: 0, borderRightWidth: 0,
        borderBottomWidth: 0, borderColor: COLORS.red }
    : { borderWidth: 0 };

  return (
    <View style={[styles.container, borderStyle]}>
      <TouchableOpacity activeOpacity={0.75} onPress={onOpenDetail} style={styles.row}>
        {/* Completion circle — only this toggles status */}
        <TouchableOpacity
          onPress={onToggle}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[styles.circle, isCompleted && styles.circleDone]}
        >
          {isCompleted && <Text style={styles.checkmark}>✓</Text>}
        </TouchableOpacity>

        {/* Name + time + badges */}
        <View style={styles.nameBlock}>
          <Text style={[styles.mealName, isCompleted && styles.mealNameDone]} numberOfLines={1}>
            {entry.name}
          </Text>
          <View style={styles.timeRow}>
            <Text style={styles.mealTime}>{entry.time}</Text>
            {isMissed && (
              <View style={styles.missedBadge}>
                <Text style={styles.missedText}>missed</Text>
              </View>
            )}
            {entry.isAdHoc && (
              <View style={styles.addedBadge}>
                <Text style={styles.addedText}>Added</Text>
              </View>
            )}
          </View>
        </View>

        {/* Calories */}
        <Text style={[styles.calories, isCompleted && styles.caloriesCompleted]}>
          {entry.calories} kcal
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  circleDone: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },
  checkmark: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  nameBlock: { flex: 1 },
  mealName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  mealNameDone: {
    color: COLORS.textSecondary,
    textDecorationLine: 'line-through',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  mealTime: { fontSize: 12, color: COLORS.textSecondary },
  missedBadge: {
    backgroundColor: COLORS.red + '20',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: COLORS.red + '60',
  },
  missedText: { fontSize: 10, fontWeight: '600', color: COLORS.red },
  addedBadge: {
    backgroundColor: COLORS.elevated,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  addedText: { fontSize: 10, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 0.4 },
  calories: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    flexShrink: 0,
  },
  caloriesCompleted: { color: COLORS.green },
});
