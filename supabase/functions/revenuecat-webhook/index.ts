// revenuecat-webhook — keeps users.subscription_status (and friends) in sync
// with the real state of a subscriber's RevenueCat entitlement, server-side.
//
// Why this exists: lib/purchases.ts (client) updates useEntitlementStore the
// instant a purchase/restore completes, which is enough to unlock the two
// client-only gates (Build My Plan activation, View Full Recipe). But the
// subscription-mandatory edge functions (generate-recipe-steps,
// recipe-assistant) check `users.subscription_status` in Postgres, which the
// client can never write to directly (protect_user_columns trigger) — this
// webhook is the only thing that keeps that column truthful. Without it, a
// paying subscriber would be unlocked locally but still bounced by
// not_premium the first time they hit either of those two functions.
//
// Auth: RevenueCat does NOT send a Supabase JWT, so this function is
// registered with verify_jwt = false (see supabase/config.toml) and instead
// checks the dashboard-configured "Authorization header" value against the
// REVENUECAT_WEBHOOK_SECRET secret. Set that secret with:
//   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<a long random string>
// then paste the SAME string into the RevenueCat dashboard → Integrations →
// Webhooks → this integration's "Authorization header value" field. That
// dashboard step can't be done from inside this codebase.
//
// Idempotency: every handled event is a plain "set the row to reflect this
// state" UPDATE (not an increment/append), so processing the same event
// twice — RevenueCat only guarantees at-least-once delivery — is harmless.
//
// Deploy with:
//   supabase functions deploy revenuecat-webhook --no-verify-jwt

import { jsonResponse } from '../_shared/errors.ts';
import { createAdminClient } from '../_shared/auth.ts';
import { PRO_ENTITLEMENT_ID } from '../../../constants/entitlements.ts';

const FUNCTION_NAME = 'revenuecat-webhook';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;

// Event types that grant/renew Pro access. period_type on the event decides
// 'trial' vs 'active'.
const GRANT_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
]);

// Revokes access immediately — the subscription has actually ended.
const REVOKE_EVENT_TYPES = new Set(['EXPIRATION']);

// Recognized but deliberately a no-op: the user keeps access until the real
// expiration_at_ms, which arrives later as its own EXPIRATION event.
// CANCELLATION = auto-renew turned off (or a refund); BILLING_ISSUE = payment
// failed, RevenueCat/the store handles the grace period and eventually fires
// EXPIRATION if it's never resolved.
const NO_OP_EVENT_TYPES = new Set(['CANCELLATION', 'BILLING_ISSUE']);

type SubscriptionStatus = 'trial' | 'active' | 'expired';
type SubscriptionProvider = 'apple' | 'google' | 'stripe' | 'revenuecat';

interface RevenueCatEvent {
  type?: string;
  id?: string;
  app_user_id?: string;
  entitlement_ids?: string[] | null;
  period_type?: string;
  store?: string;
  expiration_at_ms?: number | null;
}

function mapProvider(store: string | undefined): SubscriptionProvider {
  switch (store) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'apple';
    case 'PLAY_STORE':
      return 'google';
    case 'STRIPE':
      return 'stripe';
    default:
      // PROMOTIONAL, RC_BILLING, AMAZON, ROKU, etc. — the schema's check
      // constraint only allows the four values above; 'revenuecat' is the
      // honest catch-all rather than guessing a wrong specific store.
      return 'revenuecat';
  }
}

// Only skip when the event explicitly lists entitlements and Pro isn't one
// of them — some event payloads omit entitlement_ids entirely, and with a
// single-entitlement project the safe default is to still process those.
function concernsProEntitlement(event: RevenueCatEvent): boolean {
  if (!event.entitlement_ids || event.entitlement_ids.length === 0) return true;
  return event.entitlement_ids.includes(PRO_ENTITLEMENT_ID);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'invalid_input', message: 'POST only' } }, 405);
  }

  const expectedSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  if (!expectedSecret) {
    console.error(`${LOG_PREFIX} REVENUECAT_WEBHOOK_SECRET is not set — rejecting all requests`);
    return jsonResponse({ error: { code: 'ai_failed', message: 'Server not configured' } }, 500);
  }

  const providedSecret = req.headers.get('Authorization') ?? '';
  if (providedSecret !== expectedSecret) {
    console.warn(`${LOG_PREFIX} rejected request with invalid Authorization header`);
    return jsonResponse({ error: { code: 'unauthorized', message: 'Invalid authorization' } }, 401);
  }

  let event: RevenueCatEvent;
  try {
    const body = await req.json();
    event = (body?.event ?? {}) as RevenueCatEvent;
  } catch {
    return jsonResponse({ error: { code: 'invalid_input', message: 'Invalid JSON body' } }, 400);
  }

  const eventType = event.type;
  const userId = event.app_user_id;

  if (!eventType || !userId) {
    console.warn(`${LOG_PREFIX} missing type/app_user_id — acking without action`, event.id);
    return jsonResponse({ received: true }, 200);
  }

  if (!concernsProEntitlement(event)) {
    console.log(`${LOG_PREFIX} ${eventType} for ${userId} doesn't concern '${PRO_ENTITLEMENT_ID}' — skipping`);
    return jsonResponse({ received: true }, 200);
  }

  const admin = createAdminClient();
  if (!admin) {
    console.error(`${LOG_PREFIX} could not create admin client`);
    return jsonResponse({ error: { code: 'ai_failed', message: 'Server not configured' } }, 500);
  }

  const expiryIso = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;

  if (GRANT_EVENT_TYPES.has(eventType)) {
    const status: SubscriptionStatus = event.period_type === 'TRIAL' ? 'trial' : 'active';
    const { error } = await admin
      .from('users')
      .update({
        subscription_status: status,
        subscription_provider: mapProvider(event.store),
        subscription_expiry_date: expiryIso,
      })
      .eq('id', userId);

    if (error) {
      console.error(`${LOG_PREFIX} failed to apply ${eventType} for ${userId}:`, error);
      // Non-2xx so RevenueCat retries — this is a real DB failure, not a
      // "nothing to do" case.
      return jsonResponse({ error: { code: 'ai_failed', message: 'Failed to update subscription' } }, 500);
    }
    console.log(`${LOG_PREFIX} ${eventType} → ${status} for ${userId}`);
  } else if (REVOKE_EVENT_TYPES.has(eventType)) {
    const { error } = await admin
      .from('users')
      .update({
        subscription_status: 'expired',
        subscription_expiry_date: expiryIso,
      })
      .eq('id', userId);

    if (error) {
      console.error(`${LOG_PREFIX} failed to apply ${eventType} for ${userId}:`, error);
      return jsonResponse({ error: { code: 'ai_failed', message: 'Failed to update subscription' } }, 500);
    }
    console.log(`${LOG_PREFIX} ${eventType} → expired for ${userId}`);
  } else if (NO_OP_EVENT_TYPES.has(eventType)) {
    console.log(`${LOG_PREFIX} ${eventType} for ${userId} — access unchanged, awaiting EXPIRATION`);
  } else {
    // TRANSFER, SUBSCRIBER_ALIAS, TEST, paywall UI events, and any future
    // event type we don't explicitly recognize. Ack and move on rather than
    // guessing at state changes — see "Future Proofing" in RevenueCat's docs.
    console.log(`${LOG_PREFIX} unhandled event type '${eventType}' for ${userId} — no action taken`);
  }

  return jsonResponse({ received: true }, 200);
});
