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

import { APP_NAME } from '@/constants/app';
import { COLORS } from '@/constants/theme';
import { GOAL_LABEL, kgToLbs, lbsToKg } from '@/constants/goalCalc';
import { openPaywall } from '@/lib/paywall';
import { showManageSubscriptions } from '@/lib/purchases';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { useMealStore } from '@/store/useMealStore';

export default function ProfileScreen() {
  const profile      = useMealStore(s => s.profile);
  const updateProfile = useMealStore(s => s.updateProfile);
  const logWeight    = useMealStore(s => s.logWeight);
  // profile.subscription is a legacy shell field that's never actually kept
  // in sync (see store/types.ts) — the live RevenueCat entitlement is the
  // real source of truth for what to show here.
  const isPro = useEntitlementStore(s => s.isPro);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
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

  const unit = profile.weightUnit ?? 'lbs';
  const weightDisplay = profile.weightKg != null
    ? unit === 'lbs'
      ? `${Math.round(kgToLbs(profile.weightKg))} lbs`
      : `${Math.round(profile.weightKg)} kg`
    : 'Not set';

  const goalDisplay = profile.goalType ? GOAL_LABEL[profile.goalType] : 'Not set';
  const displayName = profile.firstName || profile.name || 'Add your name';

  const promptUpdateWeight = () => {
    Alert.prompt(
      'Update weight',
      `Current: ${weightDisplay}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (input) => {
            const raw = (input ?? '').trim();
            const value = Number(raw);
            if (!Number.isFinite(value) || value <= 0) return;
            const kg = unit === 'lbs' ? lbsToKg(value) : value;
            logWeight(kg);
          },
        },
      ],
      'plain-text',
      profile.weightKg != null
        ? unit === 'lbs'
          ? Math.round(kgToLbs(profile.weightKg)).toString()
          : Math.round(profile.weightKg).toString()
        : '',
      'numeric'
    );
  };

  const setUnit = (next: 'lbs' | 'kg') => {
    if (unit === next) return;
    updateProfile({ weightUnit: next });
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.iconBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity
          onPress={() => router.push('/settings')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.iconBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.gearIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* User info card */}
        <View style={styles.userCard}>
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarEmoji}>👤</Text>
          </View>
          <View style={styles.nameRow}>
            <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
            <View style={[styles.subPill, isPro ? styles.subPillPremium : styles.subPillFree]}>
              <Text style={[styles.subPillText, isPro ? styles.subPillTextPremium : styles.subPillTextFree]}>
                {isPro ? 'Pro' : 'Free'}
              </Text>
            </View>
          </View>
          {profile.age != null ? <Text style={styles.userMeta}>Age {profile.age}</Text> : null}

          <View style={styles.userGrid}>
            <TouchableOpacity style={styles.userGridCell} onPress={promptUpdateWeight} activeOpacity={0.7}>
              <Text style={styles.userGridLabel}>Weight</Text>
              <Text style={styles.userGridValue}>{weightDisplay}</Text>
            </TouchableOpacity>
            <View style={styles.userGridDivider} />
            <TouchableOpacity
              style={styles.userGridCell}
              onPress={() => router.push('/profile/edit-goal')}
              activeOpacity={0.7}
            >
              <Text style={styles.userGridLabel}>Goal</Text>
              <Text style={styles.userGridValue}>{goalDisplay}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.subscriptionBtn}
            onPress={() =>
              isPro
                ? void handleManageSubscription()
                : openPaywall({ reason: 'premium_feature', headline: `Upgrade to ${APP_NAME} Pro` })
            }
            activeOpacity={0.85}
          >
            <Text style={styles.subscriptionBtnText}>
              {isPro ? 'Manage Subscription' : 'Upgrade to Pro'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Body & goals */}
        <Text style={styles.sectionLabel}>BODY & GOALS</Text>
        <View style={styles.section}>
          <NavRow label="Edit Goal" onPress={() => router.push('/profile/edit-goal')} />
          <NavRow label="Personal Details" onPress={() => router.push('/profile/personal-details')} />
        </View>

        {/* Nutrition */}
        <Text style={styles.sectionLabel}>NUTRITION</Text>
        <View style={styles.section}>
          <NavRow label="Dietary Needs & Allergies" onPress={() => router.push('/profile/dietary')} />
          <NavRow label="Nutrition Goals" onPress={() => router.push('/profile/nutrition-goals')} />
        </View>

        {/* Preferences */}
        <Text style={styles.sectionLabel}>PREFERENCES</Text>
        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>Weight Unit</Text>
              <Text style={styles.rowSub}>Affects weight display app-wide.</Text>
            </View>
            <View style={styles.unitToggle}>
              <TouchableOpacity
                style={[styles.unitBtn, unit === 'lbs' && styles.unitBtnActive]}
                onPress={() => setUnit('lbs')}
                activeOpacity={0.8}
              >
                <Text style={[styles.unitBtnText, unit === 'lbs' && styles.unitBtnTextActive]}>lbs</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitBtn, unit === 'kg' && styles.unitBtnActive]}
                onPress={() => setUnit('kg')}
                activeOpacity={0.8}
              >
                <Text style={[styles.unitBtnText, unit === 'kg' && styles.unitBtnTextActive]}>kg</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
  gearIcon: { color: COLORS.text, fontSize: 20 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text },

  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, gap: 12 },

  // User info card
  userCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    alignItems: 'center',
    gap: 6,
  },
  avatarWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarEmoji: { fontSize: 36 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userName: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  userMeta: { color: COLORS.textSecondary, fontSize: 13 },
  subPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  subPillFree:    { backgroundColor: COLORS.elevated },
  subPillPremium: { backgroundColor: COLORS.green + '33' },
  subPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  subPillTextFree:    { color: COLORS.textSecondary },
  subPillTextPremium: { color: COLORS.green },

  userGrid: {
    marginTop: 12,
    flexDirection: 'row',
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    overflow: 'hidden',
    width: '100%',
  },
  userGridCell: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  userGridDivider: { width: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  userGridLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  userGridValue: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginTop: 4 },

  subscriptionBtn: {
    marginTop: 12,
    width: '100%',
    paddingVertical: 11,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.green,
  },
  subscriptionBtnText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  rowBody: { flex: 1 },
  rowText: { color: COLORS.text, fontSize: 15 },
  rowSub:  { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rowArrow: { color: COLORS.textSecondary, fontSize: 22, fontWeight: '300' },

  unitToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.elevated,
    borderRadius: 8,
    overflow: 'hidden',
  },
  unitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  unitBtnActive: { backgroundColor: COLORS.green },
  unitBtnText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  unitBtnTextActive: { color: '#fff' },
});
