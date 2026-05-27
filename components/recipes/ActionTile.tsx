import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';

interface Props {
  icon: string;
  title: string;
  subtitle: string;
  accent?: 'green' | 'blue' | 'purple';
  onPress: () => void;
}

export function ActionTile({ icon, title, subtitle, accent = 'green', onPress }: Props) {
  const accentColor =
    accent === 'green' ? COLORS.green :
    accent === 'blue' ? COLORS.blue :
    COLORS.purple;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.tile, { borderColor: accentColor + '55' }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: accentColor + '22' }]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    minHeight: 130,
    justifyContent: 'space-between',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 20 },
  title: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: 10 },
  subtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
});
