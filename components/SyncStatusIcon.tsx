import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import { useSyncStatus } from '@/lib/sync/SyncProvider';

// Subtle, non-blocking indicator that only appears when cloud sync is worth the
// user's attention — a write has failed (dead-lettered) or has been stuck
// pending unusually long. A normal fast, successful sync stays fully invisible
// (matching how most apps behave); it never interrupts anything.
export function SyncStatusIcon() {
  const { status, pending, deadLetter, stuck } = useSyncStatus();

  // Hidden unless something is genuinely off. `stuck` is already true when
  // anything has dead-lettered, but check deadLetter explicitly for clarity.
  if (!stuck && deadLetter <= 0) return null;

  const failed = deadLetter > 0;
  const iconName = failed
    ? 'cloud-offline-outline'
    : status === 'syncing'
      ? 'cloud-upload-outline'
      : 'cloud-outline';
  const unsynced = pending + deadLetter;

  return (
    <View style={styles.wrap}>
      <Ionicons name={iconName} size={18} color={COLORS.orange} />
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{unsynced > 99 ? '99+' : unsynced}</Text>
      </View>
    </View>
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
    backgroundColor: COLORS.orange,
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
