import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '@/constants/theme';
import { MacroPill } from './MacroPill';
import type { MealEntry } from '@/store/types';

interface MealCardProps {
  entry: MealEntry;
  onToggle: () => void;
  onRemove: () => void;
  onEdit: () => void;
}

export function MealCard({ entry, onToggle, onRemove, onEdit }: MealCardProps) {
  const [expanded, setExpanded] = useState(false);

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

      {/* ── Collapsed row (always visible) — tapping body expands ── */}
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => setExpanded(e => !e)}
        style={styles.collapsedRow}
      >
        {/* Completion circle — only this toggles status */}
        <TouchableOpacity
          onPress={onToggle}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[
            styles.circle,
            isCompleted && styles.circleDone,
          ]}
        >
          {isCompleted && <Text style={styles.checkmark}>✓</Text>}
        </TouchableOpacity>

        {/* Name + time + missed badge */}
        <View style={styles.nameBlock}>
          <Text
            style={[
              styles.mealName,
              isCompleted && styles.mealNameDone,
            ]}
            numberOfLines={1}
          >
            {entry.name}
          </Text>
          <View style={styles.timeRow}>
            <Text style={styles.mealTime}>{entry.time}</Text>
            {isMissed && (
              <View style={styles.missedBadge}>
                <Text style={styles.missedText}>missed</Text>
              </View>
            )}
          </View>
        </View>

        {/* Calories */}
        <Text style={[styles.calories, isCompleted && styles.caloriesCompleted]}>
          {entry.calories} kcal
        </Text>
      </TouchableOpacity>

      {/* ── Expanded section ── */}
      {expanded && (
        <View style={styles.expandedSection}>
          {/* Separator */}
          <View style={styles.separator} />

          {/* Ingredients */}
          {entry.ingredients.map(ing => (
            <Text key={ing.id} style={styles.ingredient}>
              {'• '}{ing.name} {ing.quantity}{ing.unit}
            </Text>
          ))}

          {/* Macro pills */}
          <View style={styles.pillRow}>
            <MacroPill label="Protein" value={entry.macros.protein} unit="g" color={COLORS.text} />
            <MacroPill label="Carbs"   value={entry.macros.carbs}   unit="g" color={COLORS.text} />
            <MacroPill label="Fats"    value={entry.macros.fats}    unit="g" color={COLORS.text} />
          </View>

          {/* Action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={onEdit}
              activeOpacity={0.7}
            >
              <Text style={styles.editBtnText}>Edit meal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={onRemove}
              activeOpacity={0.7}
            >
              <Text style={styles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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

  // ── Collapsed row ──────────────────────────────────────────────────────────
  collapsedRow: {
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
  nameBlock: {
    flex: 1,
  },
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
  mealTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  missedBadge: {
    backgroundColor: COLORS.red + '20',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: COLORS.red + '60',
  },
  missedText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.red,
  },
  calories: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    flexShrink: 0,
  },
  caloriesCompleted: {
    color: COLORS.green,
  },

  // ── Expanded section ───────────────────────────────────────────────────────
  expandedSection: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 4,
  },
  ingredient: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  editBtn: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  editBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  removeBtn: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  removeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.red,
  },
});
