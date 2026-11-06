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

// The same UUID-shaped id for the same seed on every phone. A meal built from
// the user's own repeating template on a given day gets this, so two phones
// that both open that day write ONE row instead of two copies. (Not random,
// so never use it for anything else.)
export function stableId(seed: string): string {
  let hex = '';
  for (let salt = 0; hex.length < 32; salt++) {
    let h = 0x811c9dc5 ^ salt; // FNV-1a, 32-bit, salted per block
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    hex += (h >>> 0).toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
