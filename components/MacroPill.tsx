import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '@/constants/theme';

interface MacroPillProps {
  label: string;
  value: number;
  unit: string;
  color: string;
  muted?: boolean;
}

export function MacroPill({ label, value, unit, color, muted = false }: MacroPillProps) {
  const displayColor = muted ? COLORS.textMuted : color;
  return (
    <View style={[styles.pill, { borderColor: displayColor + '33' }]}>
      <Text style={[styles.value, { color: displayColor }]}>
        {value}{unit}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: COLORS.elevated,
  },
  value: {
    fontSize: 13,
    fontWeight: '700',
  },
  label: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
});
