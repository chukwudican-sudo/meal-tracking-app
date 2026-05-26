import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';

interface Props {
  color?: string;
  // Optional unread badge count. Hidden when 0/undefined.
  unreadCount?: number;
}

export function NotificationIcon({ color = COLORS.textSecondary, unreadCount }: Props) {
  const showBadge = !!unreadCount && unreadCount > 0;
  return (
    <TouchableOpacity
      onPress={() => router.push('/notifications')}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.wrap}
      activeOpacity={0.7}
    >
      <Text style={[styles.icon, { color }]}>🔔</Text>
      {showBadge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount! > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
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
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: COLORS.red,
    borderWidth: 1.5,
    borderColor: COLORS.bg,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
});
