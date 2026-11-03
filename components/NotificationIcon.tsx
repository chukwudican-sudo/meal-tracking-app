import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import { selectUnreadCount, useInboxStore } from '@/store/useInboxStore';

interface Props {
  color?: string;
  // Overrides the inbox's own unread count (tests / previews). Hidden at 0.
  unreadCount?: number;
}

export function NotificationIcon({ color = COLORS.textSecondary, unreadCount }: Props) {
  const inboxUnread = useInboxStore(selectUnreadCount);
  const count = unreadCount ?? inboxUnread;
  const showBadge = count > 0;
  return (
    <TouchableOpacity
      onPress={() => router.push('/notifications')}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.wrap}
      activeOpacity={0.7}
    >
      <Ionicons name="notifications-outline" size={20} color={color} />
      {showBadge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {count > 9 ? '9+' : count}
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
