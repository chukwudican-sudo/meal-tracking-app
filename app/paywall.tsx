// Single reusable Pro paywall — every trigger point (scan-limit exhaustion,
// the four subscription-mandatory features, and the plain "Upgrade to Pro"
// entries in Settings/Profile) opens this same screen via
// lib/paywall.ts#openPaywall, only varying `reason`/`headline`. Not a hard
// paywall: the X always returns the user to wherever they were, unlocking
// nothing they weren't already entitled to.
//
// Prices are never hardcoded — both plan cards render live PurchasesPackage
// data from RevenueCat (lib/purchases.ts#fetchProPackages), so pricing and
// localized currency stay correct automatically.

import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import {
  fetchProPackages,
  isPurchasesConfigured,
  purchasePackage,
  PurchaseCancelledError,
  restorePurchases,
  type ProPackages,
} from '@/lib/purchases';
import { PRO_ENTITLEMENT_ID, useEntitlementStore } from '@/store/useEntitlementStore';
import { usePaywallStore } from '@/store/usePaywallStore';
import type { PurchasesPackage } from 'react-native-purchases';

// Placeholder legal URLs — swap these two lines for the real pages once they
// exist. Nothing else about the fine print needs to change.
const TERMS_URL = 'https://example.com/terms';
const PRIVACY_URL = 'https://example.com/privacy';

const BENEFITS = [
  'Unlimited AI scans',
  'Full recipes, not just previews',
  'Custom Recipe generation',
  'Unlimited Recipe Assistant chat',
  'AI-personalized Build My Plan',
];

type PlanKey = 'monthly' | 'yearly';

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const reason = usePaywallStore(s => s.reason);
  const customHeadline = usePaywallStore(s => s.headline);
  const onSuccess = usePaywallStore(s => s.onSuccess);
  const close = usePaywallStore(s => s.close);
  const isPro = useEntitlementStore(s => s.isPro);

  const [packages, setPackages] = useState<ProPackages>({ monthly: null, yearly: null });
  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<PlanKey>('yearly');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!isPurchasesConfigured()) {
      setLoadingOfferings(false);
      setLoadFailed(true);
      return;
    }
    (async () => {
      try {
        const pkgs = await fetchProPackages();
        if (!mounted) return;
        setPackages(pkgs);
        setLoadFailed(!pkgs.monthly && !pkgs.yearly);
      } catch (e) {
        console.warn('[paywall] could not load offerings:', e);
        if (mounted) setLoadFailed(true);
      } finally {
        if (mounted) setLoadingOfferings(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const dismiss = () => {
    close();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  // The moment RevenueCat reports an active 'MealApp Pro' entitlement — whether from
  // a purchase or restore completed right here — close and resume whatever
  // the caller was trying to do, without a second tap.
  useEffect(() => {
    console.info('[paywall] isPro effect fired, isPro =', isPro);
    if (!isPro) return;
    console.info('[paywall] isPro is true — closing paywall and calling onSuccess');
    const cb = onSuccess;
    close();
    console.info('[paywall]   close() done, attempting router.back()');
    if (router.canGoBack()) router.back();
    else console.warn('[paywall]   router.canGoBack() was false, did not navigate');
    console.info('[paywall]   calling onSuccess callback:', cb ? 'exists' : 'none');
    cb?.();
  }, [isPro]);

  const headline = reason === 'scan_limit'
    ? "You've used all 5 free AI scans"
    : (customHeadline?.trim() || 'Unlock this with Pro');

  const subheadline = reason === 'scan_limit'
    ? "You've gotten real value out of your free scans — go unlimited to keep the momentum going."
    : 'Here’s everything Pro unlocks:';

  const savingsPct = useMemo(() => {
    const m = packages.monthly?.product.price;
    const y = packages.yearly?.product.price;
    if (!m || !y) return null;
    const fullYearAtMonthly = m * 12;
    if (fullYearAtMonthly <= 0) return null;
    const pct = Math.round((1 - y / fullYearAtMonthly) * 100);
    return pct > 0 ? pct : null;
  }, [packages]);

  const handlePurchase = async () => {
    const pkg = selected === 'yearly' ? packages.yearly : packages.monthly;
    if (!pkg || purchasing) return;
    console.info('[paywall] handlePurchase: starting, pkg =', pkg.identifier);
    setPurchasing(true);
    try {
      const info = await purchasePackage(pkg);
      console.info('[paywall] handlePurchase: purchasePackage resolved');
      console.info('[paywall]   entitlements.active keys:', Object.keys(info.entitlements.active));
      console.info('[paywall]   isPro in store now:', useEntitlementStore.getState().isPro);
    } catch (e) {
      if (!(e instanceof PurchaseCancelledError)) {
        console.warn('[paywall] purchase failed:', e);
        Alert.alert('Purchase failed', 'Something went wrong completing this purchase. Please try again.');
      } else {
        console.info('[paywall] handlePurchase: user cancelled');
      }
    } finally {
      setPurchasing(false);
      console.info('[paywall] handlePurchase: finally, purchasing=false');
    }
  };

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const info = await restorePurchases();
      const hasPro = info.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
      if (!hasPro) {
        Alert.alert('No purchase found', "We couldn't find an active Pro subscription for this account.");
      }
      // If hasPro, the isPro effect above handles close + resume.
    } catch (e) {
      console.warn('[paywall] restore failed:', e);
      Alert.alert('Restore failed', 'Something went wrong restoring your purchases. Please try again.');
    } finally {
      setRestoring(false);
    }
  };

  const selectedPkg = selected === 'yearly' ? packages.yearly : packages.monthly;
  const canPurchase = !!selectedPkg && !purchasing && !restoring;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <TouchableOpacity
          onPress={dismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.closeBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={22} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.badgeWrap}>
          <Ionicons name="sparkles" size={26} color={COLORS.green} />
        </View>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.subheadline}>{subheadline}</Text>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.green} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        {loadingOfferings ? (
          <View style={styles.plansLoading}>
            <ActivityIndicator color={COLORS.green} />
          </View>
        ) : loadFailed ? (
          <View style={styles.plansError}>
            <Text style={styles.plansErrorText}>
              Pricing isn’t available right now. Please try again in a moment.
            </Text>
          </View>
        ) : (
          <View style={styles.plansRow}>
            <PlanCard
              plan="yearly"
              pkg={packages.yearly}
              selected={selected === 'yearly'}
              onPress={() => setSelected('yearly')}
              savingsPct={savingsPct}
            />
            <PlanCard
              plan="monthly"
              pkg={packages.monthly}
              selected={selected === 'monthly'}
              onPress={() => setSelected('monthly')}
              savingsPct={null}
            />
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, !canPurchase && styles.primaryBtnDisabled]}
          onPress={handlePurchase}
          disabled={!canPurchase}
          activeOpacity={0.85}
        >
          {purchasing ? (
            <ActivityIndicator color="#0E1A12" />
          ) : (
            <Text style={styles.primaryBtnText}>Get Pro</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleRestore}
          disabled={restoring}
          style={styles.restoreBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.restoreText}>
            {restoring ? 'Restoring…' : 'Restore Purchases'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.finePrint}>
          Subscriptions auto-renew unless cancelled at least 24 hours before the end
          of the current period. Manage or cancel anytime in your device's App
          Store account settings.
        </Text>
        <View style={styles.legalRow}>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
            Terms of Use
          </Text>
          <Text style={styles.legalDot}>·</Text>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
            Privacy Policy
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function PlanCard({
  plan,
  pkg,
  selected,
  onPress,
  savingsPct,
}: {
  plan: PlanKey;
  pkg: PurchasesPackage | null;
  selected: boolean;
  onPress: () => void;
  savingsPct: number | null;
}) {
  const isYearly = plan === 'yearly';
  const disabled = !pkg;

  return (
    <TouchableOpacity
      style={[
        styles.planCard,
        isYearly && styles.planCardYearly,
        selected && styles.planCardSelected,
        disabled && styles.planCardDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      {isYearly && savingsPct != null ? (
        <View style={styles.savingsBadge}>
          <Text style={styles.savingsBadgeText}>SAVE {savingsPct}%</Text>
        </View>
      ) : null}

      <View style={styles.planCardTop}>
        <Text style={styles.planLabel}>{isYearly ? 'Yearly' : 'Monthly'}</Text>
        <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
          {selected ? <Ionicons name="checkmark" size={13} color="#0E1A12" /> : null}
        </View>
      </View>

      {pkg ? (
        isYearly ? (
          <>
            <Text style={styles.planPriceDominant}>{pkg.product.priceString}</Text>
            <Text style={styles.planPriceCaption}>billed annually</Text>
            {pkg.product.pricePerMonthString ? (
              <Text style={styles.planPriceSecondary}>
                {pkg.product.pricePerMonthString} / mo equivalent
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.planPriceDominant}>{pkg.product.priceString}</Text>
            <Text style={styles.planPriceCaption}>per month</Text>
          </>
        )
      ) : (
        <Text style={styles.planPriceUnavailable}>Unavailable</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  headerSpacer: { width: 40, height: 40 },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 20, paddingTop: 8, alignItems: 'stretch' },

  badgeWrap: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.green + '22',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  headline: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 28,
  },
  subheadline: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 18,
    lineHeight: 20,
  },

  benefits: {
    gap: 10,
    marginBottom: 22,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  benefitText: { color: COLORS.text, fontSize: 14, flex: 1 },

  plansLoading: { paddingVertical: 40, alignItems: 'center' },
  plansError: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 8,
  },
  plansErrorText: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },

  plansRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  planCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    padding: 14,
    minHeight: 128,
  },
  planCardYearly: {
    borderColor: COLORS.green + '55',
  },
  planCardSelected: {
    borderColor: COLORS.green,
  },
  planCardDisabled: { opacity: 0.5 },
  savingsBadge: {
    position: 'absolute',
    top: -10,
    left: 12,
    backgroundColor: COLORS.green,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  savingsBadgeText: { color: '#0E1A12', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  planCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 12,
  },
  planLabel: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },

  planPriceDominant: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  planPriceCaption: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  planPriceSecondary: { color: COLORS.textMuted, fontSize: 11, marginTop: 8 },
  planPriceUnavailable: { color: COLORS.textMuted, fontSize: 13, marginTop: 8 },

  primaryBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#0E1A12', fontSize: 16, fontWeight: '800' },

  restoreBtn: { alignItems: 'center', paddingVertical: 14 },
  restoreText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },

  finePrint: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 4,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  legalLink: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  legalDot: { color: COLORS.textMuted, fontSize: 12 },
});
