import { router } from 'expo-router';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';

export default function SettingsScreen() {
  const resetUserData = useMealStore(s => s.resetUserData);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile');
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
          onPress: () => {
            // For MVP, log out clears the in-memory profile + returns to root.
            // Real auth wiring will replace this when the auth flow exists.
            resetUserData();
            router.replace('/(tabs)');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
    </SafeAreaView>
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
