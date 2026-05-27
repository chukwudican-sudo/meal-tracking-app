import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';

interface Props {
  icon: string;
  title: string;
  count: number;
  onPress: () => void;
}

export function NavTile({ icon, title, count, onPress }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.tile}
    >
      <Text style={styles.icon}>{icon}</Text>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.count}>{count} {count === 1 ? 'item' : 'items'}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 10,
  },
  icon: { fontSize: 22 },
  body: { flex: 1 },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  count: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  chevron: { color: COLORS.textSecondary, fontSize: 22, fontWeight: '300' },
});
