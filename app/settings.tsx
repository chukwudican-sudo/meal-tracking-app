import { router } from 'expo-router';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';

import { APP_NAME } from '@/constants/app';
import { COLORS } from '@/constants/theme';
import { signOut, useAuth } from '@/lib/auth';
import { clearPendingPassword } from '@/lib/pendingCredentials';
import { openPaywall } from '@/lib/paywall';
import { showManageSubscriptions } from '@/lib/purchases';
import { engine } from '@/lib/sync/engine';
import { useEntitlementStore } from '@/store/useEntitlementStore';

export default function SettingsScreen() {
  // userId: confirmed, or the saved login while Supabase can't confirm it
  // (offline). Only no account at all means "never verified" below.
  const { session, userId } = useAuth();
  const isPro = useEntitlementStore(s => s.isPro);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile');
  };

  // Hands off to the App Store / Play Store's native subscription management
  // UI directly — no custom in-app screen for this.
  const handleManageSubscription = async () => {
    const ok = await showManageSubscriptions();
    if (!ok) {
      Alert.alert(
        'Unable to open subscription settings',
        'Please manage your subscription from your device\'s App Store settings.'
      );
    }
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
    engine.clearLocalData();
    router.replace('/onboarding');
  };

  // Logout while still pending email verification: no confirmed session ever
  // existed on this device, so NOTHING was pushed to the cloud. Wiping local
  // data here is permanent and unrecoverable — hence the separate hard warning.
  // signOut() may report "session missing" (there's no session); that's fine —
  // we only need to clear local state, so don't block on its result.
  const finishUnverifiedLogout = async () => {
    // Stop recording before the wipe whatever the state, so it can never be
    // queued as deletes (nothing is flushed: there's no confirmed account).
    await engine.prepareSignOut();
    await signOut();
    void clearPendingPassword();
    engine.clearLocalData();
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
    // Signed in from the login saved on this phone, not yet confirmed by
    // Supabase (offline with an hour-old login, or up to ~90s after the
    // connection returns while its refresh catches up): logging out needs the
    // server, and trying would hang on Supabase's ~25s of retries, then fail.
    if (!session && userId) {
      Alert.alert(
        "Can't log out yet",
        'Your login is still reconnecting. Check your internet connection and try again in a minute. Your data is safe on this phone.',
      );
      return;
    }
    // No account on this phone (no confirmed session, no saved login) means it
    // is still unverified: its data was never backed up to Supabase, so
    // logging out permanently deletes it. Warn
    // clearly and distinctly rather than silently wiping (the normal flow below
    // assumes a real session whose data is already/​flushable to the cloud).
    if (!userId) {
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
      <PageHeader title="Settings" onBack={handleBack} style={styles.header} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>MEMBERSHIP</Text>
        <View style={styles.section}>
          <NavRow
            label={isPro ? 'Manage Subscription' : 'Upgrade to Pro'}
            onPress={() =>
              isPro
                ? void handleManageSubscription()
                // Plain browsing entry point, not tied to any blocked action —
                // general framing rather than a specific-feature headline.
                : openPaywall({ reason: 'premium_feature', headline: `Upgrade to ${APP_NAME} Pro` })
            }
          />
        </View>

        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.section}>
          <NavRow label="Account Settings" onPress={() => router.push('/settings/account')} />
        </View>

        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
        <View style={styles.section}>
          <NavRow label="Notifications" onPress={() => router.push('/settings/notifications')} />
        </View>

        <Text style={styles.sectionLabel}>PRIVACY</Text>
        <View style={styles.section}>
          <NavRow label="Privacy & AI" onPress={() => router.push('/settings/privacy')} />
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

  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },

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
