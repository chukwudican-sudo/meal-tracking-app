import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { COLORS } from '@/constants/theme';
import type { MealDraft } from '@/ai/types';

interface Props {
  onDraftReady: (draft: MealDraft) => void;
}

const EMPTY_DRAFT: MealDraft = {
  name: '',
  time: nowHHMM(),
  calories: 0,
  macros: { protein: 0, carbs: 0, fats: 0 },
};

export function ManualTab({ onDraftReady }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Manual entry</Text>
      <Text style={styles.subtitle}>Type in the details yourself — name, time, calories, and macros.</Text>

      <TouchableOpacity style={styles.bigBtn} onPress={() => onDraftReady({ ...EMPTY_DRAFT, time: nowHHMM() })}>
        <Text style={styles.bigBtnPlus}>+</Text>
        <Text style={styles.bigBtnLabel}>New meal</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>You can also pick a saved meal from the Search tab.</Text>
    </View>
  );
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 14,
  },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
  bigBtn: {
    marginTop: 18,
    width: 200,
    height: 200,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: COLORS.green,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  bigBtnPlus: { color: COLORS.green, fontSize: 56, fontWeight: '300', lineHeight: 60 },
  bigBtnLabel: { color: COLORS.green, fontSize: 16, fontWeight: '600' },
  hint: {
    marginTop: 14,
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
});
