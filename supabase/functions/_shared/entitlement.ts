// Shared premium-feature entitlement policy. `users.subscription_status` has
// no literal 'premium' value (see schema.sql) — this is the single source of
// truth for what counts as "premium" across every AI edge function, so it
// only ever needs to change in one place.

import type { AdminClient } from './auth.ts';

const ENTITLED_STATUSES = new Set(['active', 'trial']);

export function isEntitled(status: string | null | undefined): boolean {
  return !!status && ENTITLED_STATUSES.has(status);
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
export function resolveEntitlement(
  status: string | null | undefined,
  freeScansRemaining: number | null | undefined,
): Entitlement {
  if (isEntitled(status)) return { allowed: true, isSubscriber: true };
  const remaining = typeof freeScansRemaining === 'number' ? freeScansRemaining : 0;
  return { allowed: remaining > 0, isSubscriber: false };
}

// Atomically consume one free scan (see the consume_free_scan migration). Call
// only after a successful AI call and only for non-subscribers. Best-effort: a
// failure here must never fail an otherwise-successful request.
export async function consumeFreeScan(admin: AdminClient, userId: string): Promise<void> {
  const { error } = await admin.rpc('consume_free_scan', { p_user_id: userId });
  if (error) console.error('[entitlement] consume_free_scan failed:', error);
}
