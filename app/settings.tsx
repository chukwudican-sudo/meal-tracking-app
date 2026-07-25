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
import { signOut, useAuth } from '@/lib/auth';
import { clearPendingPassword } from '@/lib/pendingCredentials';
import { engine } from '@/lib/sync/engine';
import { useMealStore } from '@/store/useMealStore';

export default function SettingsScreen() {
  const resetUserData = useMealStore(s => s.resetUserData);
  const { session } = useAuth();

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
    void clearPendingPassword();
    resetUserData();
    router.replace('/onboarding');
  };

  // Logout while still pending email verification: no confirmed session ever
  // existed on this device, so NOTHING was pushed to the cloud. Wiping local
  // data here is permanent and unrecoverable — hence the separate hard warning.
  // signOut() may report "session missing" (there's no session); that's fine —
  // we only need to clear local state, so don't block on its result.
  const finishUnverifiedLogout = async () => {
    await signOut();
    void clearPendingPassword();
    resetUserData();
    router.replace('/onboarding');
  };

  const performLogout = async () => {
    // Offline-first: logout is instant. Stop capturing + attempt a best-effort
    // flush while the token is still valid, but never block on the result —
    // anything not yet pushed stays durably queued on-device and finishes
    // syncing automatically the next time this account signs in here.
    await engine.prepareSignOut();
    await finishLogout();
  };

  const handleLogout = () => {
    // No confirmed session means the account is still unverified: its data was
    // never backed up to Supabase, so logging out permanently deletes it. Warn
    // clearly and distinctly rather than silently wiping (the normal flow below
    // assumes a real session whose data is already/​flushable to the cloud).
    if (!session) {
      Alert.alert(
        'Log out and erase your data?',
        "Your email isn't verified yet, so your profile, meals, weight, and plans have never been backed up to the cloud. " +
          "Logging out will permanently erase them from this device and they can't be recovered.\n\n" +
          'Verify your email first to save your data.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'Log out & erase',
            style: 'destructive',
            onPress: () => { void finishUnverifiedLogout(); },
          },
        ],
      );
      return;
    }

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
