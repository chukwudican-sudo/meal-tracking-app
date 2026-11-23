// Single entry point for triggering the Pro paywall from anywhere in the
// app — AI error handlers, client-only gates (Build My Plan activation, Start
// Plan / Customize on a premade plan, an AI recipe's full steps), and the
// plain "Upgrade to Pro" entry points in Settings /
// Profile. Callers never navigate to app/paywall.tsx directly.

import { router } from 'expo-router';
import { Alert } from 'react-native';

import { supabase } from '@/lib/supabase';
import { restorePurchases, syncPurchasesIdentity } from '@/lib/purchases';
import { syncInFlight, syncSubscriptionWithServer, type SyncResult } from '@/lib/subscriptionSync';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { usePaywallStore, type OpenPaywallOptions } from '@/store/usePaywallStore';
import { useToastStore } from '@/store/useToastStore';

export function openPaywall(opts: OpenPaywallOptions): void {
  // This phone already has Pro but the server refused. Never show the paywall
  // to someone who has Pro (pay twice?) — and opening it would only flash shut
  // again (the isPro effect), which froze the app over RN Modals (Nov 12).
  if (useEntitlementStore.getState().isPro) {
    // A post-purchase / restore sync is still running (the user tapped again
    // while it ran): that flow resumes the blocked action itself, or says why
    // not — so this tap only gets a note. Running it too would start the
    // action twice (past each screen's busy guard), and a false "not
    // confirmed" here would contradict the sync a moment later.
    if (syncInFlight()) {
      useToastStore.getState().showToast('Activating Pro…');
      return;
    }
    notConfirmed(opts.onSuccess);
    return;
  }
  const store = usePaywallStore.getState();
  // Inside an open RN Modal a pushed route renders BEHIND the modal, so the
  // modal's own PaywallModalHost shows it on top instead.
  if (store.inlineHosts > 0) {
    store.open({ ...opts, presentation: 'inline' });
    return;
  }
  store.open({ ...opts, presentation: 'route' });
  router.push('/paywall');
}

// The phone has Pro, the server doesn't: Pro bought on another account, a
// restore that hasn't reached the server, or RevenueCat unreachable. One clear
// message, with Restore as the way out.
function notConfirmed(resume?: () => void): void {
  Alert.alert(
    "Pro isn't confirmed for this account",
    "We couldn't confirm your Pro subscription on our server. If you bought Pro with this Apple ID, restore it.",
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Restore Purchases', onPress: () => void restoreAndResume(resume) },
    ],
  );
}

async function restoreAndResume(resume?: () => void): Promise<void> {
  const toast = useToastStore.getState().showToast;
  toast('Restoring…');
  try {
    // Make sure RevenueCat is signed in as THIS account first — otherwise the
    // restore could move the purchase to a stale RevenueCat user.
    const { data } = await supabase.auth.getSession();
    if (data.session) await syncPurchasesIdentity(data.session.user.id);
    await restorePurchases();
  } catch (e) {
    console.warn('[paywall] restore failed:', e);
    Alert.alert('Restore failed', 'Something went wrong restoring your purchases. Please try again.');
    return;
  }
  const result = await syncSubscriptionWithServer();
  if (result === 'pro') {
    toast('Pro restored');
    resume?.();
  } else if (result === 'not_pro') {
    Alert.alert(
      'No Pro subscription found',
      "We couldn't find an active Pro subscription for this account. If you think this is wrong, contact us from Settings → Help.",
    );
  } else {
    Alert.alert("Couldn't confirm Pro right now", 'Check your connection and try again in a few minutes.');
  }
}

// After a purchase/restore (usePaywallStore.succeed): runs the blocked action
// once — after the paywall has fully closed (caller's job) AND the server sync
// has finished. The sync started when Pro arrived, so it has usually finished
// during the close animation; only if it's slow does a note appear (kept up
// until it's done). If the sync failed, the action still runs: a refusal then
// lands in notConfirmed() above — never a paywall flash.
const SLOW_SYNC_NOTE_MS = 800;
const NOTE_REPEAT_MS = 2000; // toasts last 2.5 s
export async function runPendingSuccess(): Promise<void> {
  const pending = usePaywallStore.getState().takePendingSuccess();
  if (!pending) return;
  const note = () => useToastStore.getState().showToast('Activating Pro…');
  let repeat: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => { note(); repeat = setInterval(note, NOTE_REPEAT_MS); }, SLOW_SYNC_NOTE_MS);
  try {
    await (pending.serverSynced as Promise<SyncResult | unknown>);
  } finally {
    clearTimeout(first);
    if (repeat) clearInterval(repeat);
  }
  pending.run?.();
}
