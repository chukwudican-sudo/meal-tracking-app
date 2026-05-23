import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { COLORS } from '@/constants/theme';
import { EditMealScreen } from '@/components/EditMealScreen';

interface Props {
  date: string;
  onCreated: () => void;
}

export function ManualTab({ date, onCreated }: Props) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Manual entry</Text>
      <Text style={styles.subtitle}>Type in the details yourself — name, time, calories, macros, and ingredients.</Text>

      <TouchableOpacity style={styles.bigBtn} onPress={() => setShowCreate(true)}>
        <Text style={styles.bigBtnPlus}>+</Text>
        <Text style={styles.bigBtnLabel}>New meal</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>You can also pick a saved meal from the Search tab.</Text>

      <EditMealScreen
        mode="create"
        visible={showCreate}
        date={date}
        entry={null}
        onClose={() => setShowCreate(false)}
        onSaved={onCreated}
      />
    </View>
  );
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
