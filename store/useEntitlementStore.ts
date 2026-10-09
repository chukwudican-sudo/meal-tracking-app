import { create } from 'zustand';
import type { CustomerInfo } from 'react-native-purchases';
import { PRO_ENTITLEMENT_ID } from '@/constants/entitlements';

// Re-exported so existing importers (e.g. app/paywall.tsx) keep working —
// constants/entitlements.ts is the canonical source, shared with the
// revenuecat-webhook edge function.
export { PRO_ENTITLEMENT_ID };

interface EntitlementStore {
  /** Whether the current user has an active 'MealApp Pro' RevenueCat entitlement. */
  isPro: boolean;
  /** Raw CustomerInfo from the last RevenueCat update, if any has arrived yet. */
  customerInfo: CustomerInfo | null;
  /** True once the SDK has reported at least one CustomerInfo (cached or fresh). */
  isReady: boolean;
  /**
   * Internal setter — only lib/purchases.ts should call this, driven by
   * RevenueCat's CustomerInfoUpdateListener and the result of every
   * configure/logIn/logOut/purchase/restore call.
   */
  _setFromCustomerInfo: (info: CustomerInfo) => void;
  _reset: () => void;
}

// Client-side mirror of RevenueCat's CustomerInfo, kept in sync via the
// listener wired up in lib/purchases.ts. This is a read model only — the
// source of truth for entitlement is RevenueCat (and, server-side, the
// `users.subscription_status` column kept current by the revenuecat-webhook
// function). Nothing here should be persisted to disk; RevenueCat already
// caches CustomerInfo on-device and re-delivers it on configure.
export const useEntitlementStore = create<EntitlementStore>((set) => ({
  isPro: false,
  customerInfo: null,
  isReady: false,

  _setFromCustomerInfo: (info) => {
    set({
      isPro: info.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined,
      customerInfo: info,
      isReady: true,
    });
  },

  _reset: () => {
    set({ isPro: false, customerInfo: null, isReady: false });
  },
}));
