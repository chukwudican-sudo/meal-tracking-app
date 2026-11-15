// Right after a purchase/restore, ask the server to confirm Pro with RevenueCat
// directly (edge function sync-subscription) instead of waiting for the
// webhook — see that function for why. Not an AI call: no consent sheet.
// Never throws.

import { reportError } from '@/lib/monitoring';
import { supabase } from '@/lib/supabase';

// 'pro' = the server now has Pro for this account; 'not_pro' = RevenueCat
// answered and this account has no active Pro; 'error' = couldn't find out
// (offline, timeout, server or RevenueCat trouble) — say "try again", never
// "no subscription".
export type SyncResult = 'pro' | 'not_pro' | 'error';

const SYNC_TIMEOUT_MS = 10_000; // the server gives up by ~6.5 s; margin for the network

// The sync currently running, so a refused AI call made meanwhile waits for it
// instead of telling a paying user their Pro isn't confirmed (lib/paywall.ts).
let inFlight: Promise<SyncResult> | null = null;

export function syncInFlight(): Promise<SyncResult> | null {
  return inFlight;
}

export function syncSubscriptionWithServer(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  const run = (async (): Promise<SyncResult> => {
    try {
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session) return 'error';
      const startedAt = Date.now();
      const { data, error } = await supabase.functions.invoke('sync-subscription', {
        body: {},
        timeout: SYNC_TIMEOUT_MS,
      });
      if (__DEV__) console.info(`[subscriptionSync] took ${Date.now() - startedAt}ms (error=${!!error})`);
      if (error) {
        console.warn('[subscriptionSync] failed:', error);
        reportError(error, 'subscription.sync');
        return 'error';
      }
      const pro = (data as { pro?: unknown } | null)?.pro;
      return pro === true ? 'pro' : pro === false ? 'not_pro' : 'error';
    } catch (e) {
      console.warn('[subscriptionSync] failed:', e);
      reportError(e, 'subscription.sync');
      return 'error';
    }
  })();
  inFlight = run;
  void run.finally(() => { if (inFlight === run) inFlight = null; });
  return run;
}
