import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';

export type RecipeCardVariant = 'compact' | 'row' | 'ai';

export interface RecipeCardProps {
  name: string;
  calories: number;
  cookTimeMin?: number;
  category?: string;
  favourited?: boolean;
  variant?: RecipeCardVariant;
  onPress?: () => void;
  onToggleFavourite?: () => void;
  // When provided, the card shows a plus "add to today" button instead of the
  // favourite heart (Recipes tab premade cards + Saved Recipes cards).
  onAdd?: () => void;
  // Shows a small green "NEW" pill next to the name (recently added recipes).
  isNew?: boolean;
  // For variant === 'ai' — show a small "Missing: X" line beneath name.
  missingNote?: string;
}

export function RecipeCard({
  name,
  calories,
  cookTimeMin,
  category,
  favourited,
  variant = 'compact',
  onPress,
  onToggleFavourite,
  onAdd,
  isNew,
  missingNote,
}: RecipeCardProps) {
  const heart = (
    onToggleFavourite ? (
      <TouchableOpacity
        onPress={onToggleFavourite}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.heartBtn}
        activeOpacity={0.6}
      >
        <Text style={[styles.heart, favourited && styles.heartActive]}>
          {favourited ? '♥' : '♡'}
        </Text>
      </TouchableOpacity>
    ) : null
  );

  const plus = (
    onAdd ? (
      <TouchableOpacity
        onPress={onAdd}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.plusBtn}
        activeOpacity={0.7}
      >
        <Text style={styles.plusText}>＋</Text>
      </TouchableOpacity>
    ) : null
  );

  const newPill = isNew ? (
    <View style={styles.newPill}>
      <Text style={styles.newPillText}>NEW</Text>
    </View>
  ) : null;

  if (variant === 'row') {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={styles.row}
      >
        <View style={styles.rowThumb}>
          <Text style={styles.rowThumbEmoji}>🍽️</Text>
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowNameLine}>
            <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
            {newPill}
            {category ? (
              <View style={styles.tagPill}>
                <Text style={styles.tagPillText}>{category}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.rowMeta}>
            {calories} cal{cookTimeMin != null ? ` · ${cookTimeMin}m` : ''}
          </Text>
        </View>
        {plus ?? heart}
      </TouchableOpacity>
    );
  }

  if (variant === 'ai') {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={styles.ai}
      >
        <View style={styles.aiHeader}>
          <Text style={styles.aiName} numberOfLines={1}>{name}</Text>
          {heart}
        </View>
        <Text style={styles.aiMeta}>
          {calories} cal{cookTimeMin != null ? ` · ${cookTimeMin}m` : ''}
        </Text>
        {missingNote ? <Text style={styles.aiMissing}>{missingNote}</Text> : null}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.compact}
    >
      <View style={styles.compactThumb}>
        <Text style={styles.compactThumbEmoji}>🍽️</Text>
        {plus
          ? <View style={styles.compactActionWrap}>{plus}</View>
          : heart
            ? <View style={styles.compactHeartWrap}>{heart}</View>
            : null}
      </View>
      <View style={styles.compactNameLine}>
        <Text style={styles.compactName} numberOfLines={2}>{name}</Text>
        {newPill}
      </View>
      {category ? (
        <View style={styles.tagPillCompact}>
          <Text style={styles.tagPillText}>{category}</Text>
        </View>
      ) : null}
      <Text style={styles.compactMeta}>
        {calories} cal{cookTimeMin != null ? ` · ${cookTimeMin}m` : ''}
      </Text>
    </TouchableOpacity>
  );
}

const HEART_SIZE = 20;

const styles = StyleSheet.create({
  // ─── Compact (horizontal row card) ───────────────────────────────────────
  compact: {
    width: 160,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    marginRight: 12,
  },
  compactThumb: {
    height: 96,
    borderRadius: 10,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  compactThumbEmoji: { fontSize: 36 },
  compactHeartWrap: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 14,
    paddingHorizontal: 4,
  },
  compactActionWrap: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  compactNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactName: { color: COLORS.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  compactMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  // Category tag pill (shared)
  tagPill: {
    backgroundColor: COLORS.green + '22',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagPillCompact: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.green + '22',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  tagPillText: { color: COLORS.green, fontSize: 10, fontWeight: '700' },

  // ─── Row (full-width list row) ───────────────────────────────────────────
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
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { color: COLORS.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  rowMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  // ─── AI bubble card ──────────────────────────────────────────────────────
  ai: {
    backgroundColor: COLORS.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiName: { color: COLORS.text, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  aiMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  aiMissing: { color: COLORS.orange, fontSize: 11, marginTop: 6 },

  // Heart button common
  heartBtn: { padding: 2 },
  heart: { fontSize: HEART_SIZE, color: COLORS.textSecondary },
  heartActive: { color: COLORS.red },

  // Plus "add to today" button
  plusBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: { color: '#0E1A12', fontSize: 18, fontWeight: '800', lineHeight: 20 },

  // "NEW" pill
  newPill: {
    backgroundColor: COLORS.green,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  newPillText: { color: '#0E1A12', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
