// Shared premium-feature entitlement policy. `users.subscription_status` has
// no literal 'premium' value (see schema.sql) — this is the single source of
// truth for what counts as "premium" across every AI edge function, so it
// only ever needs to change in one place.

import type { AdminClient } from './auth.ts';
import { fetchRevenueCatPro } from './subscription.ts';

const ENTITLED_STATUSES = new Set(['active', 'trial']);
// A renewal's webhook can land a little after the saved expiry date: only past
// this slack is the saved Pro status doubted.
const RENEWAL_SLACK_MS = 3 * 24 * 60 * 60 * 1000;
// Short: it runs before the AI call, inside the app's 35s budget.
const LIVE_CHECK_TIMEOUT_MS = 3000;

// The users columns every AI function selects for the Pro check.
export interface SubscriptionFields {
  subscription_status: string | null;
  subscription_expiry_date: string | null;
}

// Pro = an active/trial status whose saved expiry hasn't passed (no date =
// never expires: lifetime / promotional). The users row is RevenueCat's
// webhook kept in a cache: if a message were lost (an EXPIRATION, say) the
// status alone would leave Pro on forever (Nov 12 review, fu3). So once the
// saved expiry is more than RENEWAL_SLACK_MS old, RevenueCat itself is asked
// and its answer saved. If it can't be reached, the saved status stands this
// time: a payer is never refused for an outage, and the next call asks again.
export async function hasPro(admin: AdminClient, userId: string, row: SubscriptionFields): Promise<boolean> {
  if (!row.subscription_status || !ENTITLED_STATUSES.has(row.subscription_status)) return false;
  const expiry = row.subscription_expiry_date ? Date.parse(row.subscription_expiry_date) : NaN;
  if (!Number.isFinite(expiry) || expiry + RENEWAL_SLACK_MS > Date.now()) return true;
  return await confirmWithRevenueCat(admin, userId, row.subscription_status, row.subscription_expiry_date!);
}

async function confirmWithRevenueCat(
  admin: AdminClient,
  userId: string,
  savedStatus: string,
  savedExpiry: string,
): Promise<boolean> {
  const secretKey = Deno.env.get('REVENUECAT_SECRET_API_KEY');
  if (!secretKey) {
    console.error('[entitlement] REVENUECAT_SECRET_API_KEY missing: keeping the saved Pro status');
    return true;
  }
  let pro;
  try {
    pro = await fetchRevenueCatPro(userId, secretKey, LIVE_CHECK_TIMEOUT_MS);
  } catch (e) {
    console.warn('[entitlement] RevenueCat check failed, keeping the saved Pro status this time:', e);
    return true;
  }
  // Same values as the webhook / sync-subscription write. Only if the row is
  // still the one read: a webhook that landed meanwhile (a renewal) wins.
  const { error } = await admin
    .from('users')
    .update(
      pro
        ? { subscription_status: pro.status, subscription_provider: pro.provider, subscription_expiry_date: pro.expiryIso }
        : { subscription_status: 'expired' },
    )
    .eq('id', userId)
    .eq('subscription_status', savedStatus)
    .eq('subscription_expiry_date', savedExpiry);
  if (error) console.error('[entitlement] could not save the RevenueCat answer:', error);
  else console.log(`[entitlement] saved Pro was past its expiry; RevenueCat says ${pro ? pro.status : 'not active'} for ${userId}`);
  return !!pro;
}

export interface Entitlement {
  // Whether the caller may run the AI feature right now.
  allowed: boolean;
  // True for paid/trial subscribers (unlimited); false when the caller is
  // instead spending one of their free scans. Determines whether the caller
  // should consume a free scan after a successful call.
  isSubscriber: boolean;
}

// Gate a call: subscribers (active/trial) are always allowed; everyone else is
// allowed only while they have free scans left. Read-only on purpose — the free
// scan is NOT consumed here, so a later Gemini failure/timeout doesn't burn it
// (mirrors logAiUsage being success-only). Consume happens post-success via
// consumeFreeScan.
export async function resolveEntitlement(
  admin: AdminClient,
  userId: string,
  row: SubscriptionFields & { free_scans_remaining: number | null },
): Promise<Entitlement> {
  if (await hasPro(admin, userId, row)) return { allowed: true, isSubscriber: true };
  const remaining = typeof row.free_scans_remaining === 'number' ? row.free_scans_remaining : 0;
  return { allowed: remaining > 0, isSubscriber: false };
}

// Atomically consume one free scan (see the consume_free_scan migration). Call
// only after a successful AI call and only for non-subscribers. Best-effort: a
// failure here must never fail an otherwise-successful request.
export async function consumeFreeScan(admin: AdminClient, userId: string): Promise<void> {
  const { error } = await admin.rpc('consume_free_scan', { p_user_id: userId });
  if (error) console.error('[entitlement] consume_free_scan failed:', error);
}
