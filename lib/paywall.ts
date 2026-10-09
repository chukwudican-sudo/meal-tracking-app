// Single entry point for triggering the Pro paywall from anywhere in the
// app — AI error handlers, client-only gates (Build My Plan activation, View
// Full Recipe), and the plain "Upgrade to Pro" entry points in Settings /
// Profile. Callers never navigate to app/paywall.tsx directly.

import { router } from 'expo-router';
import { usePaywallStore, type OpenPaywallOptions } from '@/store/usePaywallStore';

export function openPaywall(opts: OpenPaywallOptions): void {
  usePaywallStore.getState().open(opts);
  router.push('/paywall');
}
