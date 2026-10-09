// Thin wrapper around the RevenueCat SDK (react-native-purchases). Centralizes
// SDK configuration, identity sync with the Supabase session, offering
// fetch, and purchase/restore — no other file should import
// `react-native-purchases` directly.
//
// Entitlement identifier: 'MealApp Pro' (configured in the RevenueCat
// dashboard, kept in sync with store/useEntitlementStore.ts's PRO_ENTITLEMENT_ID).
// Offering identifier: 'Default', with packages identified as 'monthly' /
// 'yearly' (also dashboard-configured, custom identifiers — not RevenueCat's
// predefined package types, so packages are matched by `identifier` rather
// than the `.monthly`/`.annual` convenience getters).
//
// react-native-purchases is a native module: this file (and anything that
// imports it) will throw immediately in Expo Go. It only works in a real dev
// build — see the README's "Testing in-app purchases" section.

import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
import { useEntitlementStore } from '@/store/useEntitlementStore';

const OFFERING_ID = 'Default';
const MONTHLY_PACKAGE_ID = 'monthly';
const YEARLY_PACKAGE_ID = 'yearly';

let configured = false;

function apiKey(): string | undefined {
  return process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
}

/**
 * Configure the RevenueCat SDK once at app startup (called from
 * app/_layout.tsx, before any screen mounts). Safe to call more than once —
 * guarded so Fast Refresh / re-renders don't re-configure.
 */
export function configurePurchases(): void {
  if (configured) return;
  const key = apiKey();
  if (!key) {
    console.warn('[purchases] EXPO_PUBLIC_REVENUECAT_API_KEY is not set — Pro purchases are disabled.');
    return;
  }

  configured = true;
  Purchases.configure({ apiKey: key });

  Purchases.addCustomerInfoUpdateListener((info) => {
    useEntitlementStore.getState()._setFromCustomerInfo(info);
  });

  // Prime the store from whatever RevenueCat has cached on-device, without
  // blocking startup on a network round-trip.
  void refreshEntitlement();
}

export function isPurchasesConfigured(): boolean {
  return configured;
}

/**
 * Keep RevenueCat's app_user_id in lockstep with the Supabase auth session,
 * so the revenuecat-webhook function (which only ever sees app_user_id) can
 * always resolve the right `users` row server-side. Call with the Supabase
 * user id on sign-in, and with `null` on sign-out.
 */
export async function syncPurchasesIdentity(userId: string | null): Promise<void> {
  if (!configured) return;
  try {
    if (userId) {
      const { customerInfo } = await Purchases.logIn(userId);
      useEntitlementStore.getState()._setFromCustomerInfo(customerInfo);
    } else {
      // Only log out if there's actually an identified RevenueCat user to log
      // out of. Without this, the very first sync on a fresh app launch (no
      // Supabase session yet, so userId is null) calls logOut() on an
      // already-anonymous RevenueCat id, which is a harmless no-op but logs
      // RevenueCat's "LogOut was called but the current user is anonymous"
      // warning every time. isAnonymous() reflects the SDK's real persisted
      // state (not just in-memory), so this stays correct across restarts too.
      const alreadyAnonymous = await Purchases.isAnonymous();
      if (alreadyAnonymous) return;
      const customerInfo = await Purchases.logOut();
      useEntitlementStore.getState()._setFromCustomerInfo(customerInfo);
    }
  } catch (e) {
    console.warn('[purchases] identity sync failed:', e);
  }
}

/** Re-fetch CustomerInfo and push it into useEntitlementStore. */
export async function refreshEntitlement(): Promise<void> {
  if (!configured) return;
  try {
    const info = await Purchases.getCustomerInfo();
    useEntitlementStore.getState()._setFromCustomerInfo(info);
  } catch (e) {
    console.warn('[purchases] could not refresh entitlement:', e);
  }
}

export interface ProPackages {
  monthly: PurchasesPackage | null;
  yearly: PurchasesPackage | null;
}

/** Fetch the live Monthly/Yearly packages for the paywall's plan cards. */
export async function fetchProPackages(): Promise<ProPackages> {
  const offerings = await Purchases.getOfferings();
  const offering = offerings.all[OFFERING_ID] ?? offerings.current;
  const packages = offering?.availablePackages ?? [];
  return {
    monthly: packages.find((p) => p.identifier === MONTHLY_PACKAGE_ID) ?? offering?.monthly ?? null,
    yearly: packages.find((p) => p.identifier === YEARLY_PACKAGE_ID) ?? offering?.annual ?? null,
  };
}

// Distinguishable from a real failure so callers (the paywall screen) can
// silently reset UI state instead of showing an error toast when someone
// simply dismisses the store sheet.
export class PurchaseCancelledError extends Error {
  constructor() {
    super('Purchase cancelled');
    this.name = 'PurchaseCancelledError';
  }
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  try {
    console.info('[purchases] purchasePackage: calling Purchases.purchasePackage...');
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    console.info('[purchases] purchasePackage: SDK returned customerInfo');
    console.info('[purchases]   active entitlements:', Object.keys(customerInfo.entitlements.active));
    console.info('[purchases]   pushing to entitlement store...');
    useEntitlementStore.getState()._setFromCustomerInfo(customerInfo);
    console.info('[purchases]   store isPro now:', useEntitlementStore.getState().isPro);
    return customerInfo;
  } catch (e) {
    console.info('[purchases] purchasePackage: caught error:', e);
    if ((e as { userCancelled?: boolean } | null)?.userCancelled) {
      throw new PurchaseCancelledError();
    }
    throw e;
  }
}

export async function restorePurchases(): Promise<CustomerInfo> {
  const customerInfo = await Purchases.restorePurchases();
  useEntitlementStore.getState()._setFromCustomerInfo(customerInfo);
  return customerInfo;
}

/**
 * Hands off to the platform's native subscription management UI (the App
 * Store's "Manage Subscription" sheet on iOS, Play Store subscription
 * settings on Android) — no custom in-app screen. Returns false if the SDK
 * isn't configured or the platform call fails, so callers can fall back to
 * something sensible (e.g. an alert).
 */
export async function showManageSubscriptions(): Promise<boolean> {
  if (!configured) return false;
  try {
    await Purchases.showManageSubscriptions();
    return true;
  } catch (e) {
    console.warn('[purchases] showManageSubscriptions failed:', e);
    return false;
  }
}
