import { router } from 'expo-router';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '@/components/Screen';

import { COLORS } from '@/constants/theme';
import { signOut } from '@/lib/auth';
import { engine } from '@/lib/sync/engine';
import { useMealStore } from '@/store/useMealStore';

export default function SettingsScreen() {
  const resetUserData = useMealStore(s => s.resetUserData);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile');
  };

  // Safe ordering: the projector was already stopped in prepareSignOut(), so
  // clearing the local cache now can't be replicated to the server as deletes.
  // End the session, wipe the cache so the UI actually clears, then hand the
  // user to onboarding/login (the tabs gate also enforces this once signed out).
  const finishLogout = async () => {
    const { error } = await signOut();
    if (error) {
      // Session still alive — resume capturing so nothing is missed.
      engine.resumeAfterCancelledSignOut();
      Alert.alert('Log out failed', error);
      return;
    }
    resetUserData();
    router.replace('/onboarding');
  };

  const performLogout = async () => {
    // Stop capturing + flush queued writes while the token is still valid.
    const { pending, deadLetter } = await engine.prepareSignOut();
    const unsynced = pending + deadLetter;
    if (unsynced > 0) {
      Alert.alert(
        'Unsynced changes',
        `${unsynced} change${unsynced === 1 ? '' : 's'} haven't been saved to the cloud yet — you may be offline. ` +
          `They'll stay on this device and finish syncing the next time you sign in here. Log out anyway?`,
        [
          { text: 'Stay', style: 'cancel', onPress: () => engine.resumeAfterCancelledSignOut() },
          { text: 'Log out anyway', style: 'destructive', onPress: () => { void finishLogout(); } },
        ],
      );
      return;
    }
    await finishLogout();
  };

  const handleLogout = () => {
    Alert.alert(
      'Log out?',
      'You can sign back in anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: () => { void performLogout(); },
        },
      ]
    );
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.iconBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.section}>
          <NavRow label="Account Settings" onPress={() => router.push('/settings/account')} />
        </View>

        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
        <View style={styles.section}>
          <NavRow label="Notifications" onPress={() => router.push('/settings/notifications')} />
        </View>

        <Text style={styles.sectionLabel}>HELP</Text>
        <View style={styles.section}>
          <NavRow label="Help" onPress={() => router.push('/settings/help')} />
        </View>

        <TouchableOpacity onPress={handleLogout} style={styles.logoutRow} activeOpacity={0.6}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.rowText}>{label}</Text>
      <Text style={styles.rowArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text },

  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, gap: 12 },

  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  section: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: { color: COLORS.text, fontSize: 15 },
  rowArrow: { color: COLORS.textSecondary, fontSize: 22, fontWeight: '300' },

  logoutRow: {
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 24,
  },
  logoutText: { color: COLORS.text, fontSize: 14, fontWeight: '500' },
});
