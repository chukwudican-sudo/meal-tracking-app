// Shared premium-feature entitlement policy. `users.subscription_status` has
// no literal 'premium' value (see schema.sql) — this is the single source of
// truth for what counts as "premium" across every AI edge function, so it
// only ever needs to change in one place.

const ENTITLED_STATUSES = new Set(['active', 'trial']);

export function isEntitled(status: string | null | undefined): boolean {
  return !!status && ENTITLED_STATUSES.has(status);
}
