import * as Crypto from 'expo-crypto';

// Stable UUID v4 generation for offline-first records. Every syncable entity
// gets a UUID client-side so its local id doubles as the Supabase primary key
// (server PKs are all `uuid`), which lets us upsert without a round-trip.
export function newId(): string {
  return Crypto.randomUUID();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
