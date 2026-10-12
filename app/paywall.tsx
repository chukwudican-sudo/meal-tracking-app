// Route entry for the Pro paywall (registered as a slide-up modal in
// app/_layout.tsx). Open it only via lib/paywall.ts#openPaywall, which picks
// this route or the in-modal PaywallModalHost.

import { router } from 'expo-router';

import { PaywallContent } from '@/components/paywall/PaywallContent';

function leaveRoute() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)');
}

export default function PaywallScreen() {
  return <PaywallContent onExit={leaveRoute} />;
}
