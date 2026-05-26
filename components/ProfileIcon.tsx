import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { COLORS } from '@/constants/theme';

interface Props {
  color?: string;
}

export function ProfileIcon({ color = COLORS.textSecondary }: Props) {
  return (
    <TouchableOpacity
      onPress={() => router.push('/profile')}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.wrap}
      activeOpacity={0.7}
    >
      <Text style={[styles.icon, { color }]}>👤</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 18,
    lineHeight: 22,
  },
});
