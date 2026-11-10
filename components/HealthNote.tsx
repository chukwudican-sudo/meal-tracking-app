// "Estimate, not medical advice" — shown next to every calculated calorie /
// macro target (Apple 1.4.1: apps giving health guidance need a clear
// disclaimer). One component so the wording is the same everywhere.

import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { COLORS } from '@/constants/theme';

export function HealthNote({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      <Ionicons name="information-circle-outline" size={15} color={COLORS.textMuted} />
      <Text style={styles.text}>
        These targets are estimates, not medical advice. Talk to a doctor or dietitian before big changes,
        especially if you&apos;re pregnant or have a health condition.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  text: { flex: 1, color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
});
