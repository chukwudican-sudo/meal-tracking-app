// Route entry for the Pro paywall (registered as a slide-up modal in
// app/_layout.tsx). Open it only via lib/paywall.ts#openPaywall, which picks
// this route or the in-modal PaywallModalHost.

import { router } from 'expo-router';

import { PaywallContent } from '@/components/paywall/PaywallContent';
import { runPendingSuccess } from '@/lib/paywall';

// After a purchase the held action (usePaywallStore.succeed) starts as we
// navigate back — the order this screen always had; it now also waits for the
// server to confirm Pro. A stack screen can't leave the stuck RN Modal layer
// behind, and a refused retry no longer reopens the paywall (lib/paywall.ts).
// After a plain close there is nothing held.
function leaveRoute() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)');
  void runPendingSuccess();
}

export default function PaywallScreen() {
  return <PaywallContent onExit={leaveRoute} />;
}
