// Shared RevenueCat → users-row mapping, used by revenuecat-webhook (events)
// and sync-subscription (direct REST lookup right after a purchase), so both
// write the same values. Not imported by the AI functions.

import { PRO_ENTITLEMENT_ID } from '../../../constants/entitlements.ts';

export type SubscriptionProvider = 'apple' | 'google' | 'stripe' | 'revenuecat';

// RevenueCat store id → users.subscription_provider. Webhook events send
// 'APP_STORE'; the REST API sends 'app_store' — compared case-insensitively.
export function mapProvider(store: string | undefined | null): SubscriptionProvider {
  switch ((store ?? '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'apple';
    case 'PLAY_STORE':
      return 'google';
    case 'STRIPE':
      return 'stripe';
    default:
      // PROMOTIONAL, RC_BILLING, TEST_STORE, AMAZON, ROKU, etc. — the schema's
      // check constraint only allows the four values above; 'revenuecat' is
      // the honest catch-all rather than guessing a wrong specific store.
      return 'revenuecat';
  }
}

// period_type 'TRIAL' (event) / 'trial' (REST) → 'trial'; anything else → 'active'.
export function grantedStatus(periodType: string | undefined | null): 'trial' | 'active' {
  return (periodType ?? '').toUpperCase() === 'TRIAL' ? 'trial' : 'active';
}

export interface RevenueCatPro {
  status: 'trial' | 'active';
  provider: SubscriptionProvider;
  expiryIso: string | null; // null = never expires (lifetime/promotional)
}

const REVENUECAT_TIMEOUT_MS = 3000;

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Our RevenueCat app user ids are Supabase user ids; anonymous ones
// ($RCAnonymousID:…) never map to a users row.
export function isAppUserId(id: unknown): id is string {
  return typeof id === 'string' && isUuid(id);
}

// Asks RevenueCat's REST API (GET /v1/subscribers/{app_user_id}; the app logs
// in to RevenueCat with the Supabase user id) whether this user has the Pro
// entitlement right now. Returns the row values when active, null when not
// active, and throws when RevenueCat can't be reached or answers badly.
export async function fetchRevenueCatPro(
  userId: string,
  secretKey: string,
  timeoutMs = REVENUECAT_TIMEOUT_MS,
): Promise<RevenueCatPro | null> {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`RevenueCat ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const body: any = await res.json();
  // A 200 without a subscriber is not an answer — never read it as "not Pro"
  // (the TRANSFER handler would expire someone on it).
  if (!body?.subscriber || typeof body.subscriber !== 'object') throw new Error('RevenueCat: no subscriber in response');
  const ent = body.subscriber.entitlements?.[PRO_ENTITLEMENT_ID];
  if (!ent) return null;

  const now = Date.now();
  const expires = typeof ent.expires_date === 'string' ? Date.parse(ent.expires_date) : NaN;
  const grace = typeof ent.grace_period_expires_date === 'string' ? Date.parse(ent.grace_period_expires_date) : NaN;
  const active = ent.expires_date == null || (Number.isFinite(expires) && expires > now) ||
    (Number.isFinite(grace) && grace > now);
  if (!active) return null;

  const sub = typeof ent.product_identifier === 'string'
    ? body?.subscriber?.subscriptions?.[ent.product_identifier]
    : undefined;
  return {
    status: grantedStatus(sub?.period_type),
    provider: mapProvider(sub?.store),
    expiryIso: Number.isFinite(expires) ? new Date(expires).toISOString() : null,
  };
}

// Account deletion (Nov 16): removes the customer RevenueCat keeps for this
// user (app user id = Supabase user id, purchase history; no name or email),
// as the Privacy Policy promises. DELETE /v1/subscribers/{app_user_id}.
// 'deleted' or 'not_found' (never bought/opened the paywall) both mean done;
// anything else throws so the caller can log it. Apple keeps its own records.
export async function deleteRevenueCatCustomer(
  userId: string,
  secretKey: string,
  timeoutMs = REVENUECAT_TIMEOUT_MS,
): Promise<'deleted' | 'not_found'> {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    // Content-Type too: RevenueCat has refused a bare DELETE with code 7227.
    headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return 'not_found';
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`RevenueCat delete ${res.status}: ${detail.slice(0, 200)}`);
  }
  return 'deleted';
}
