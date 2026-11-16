// Shared auth/admin-client setup for AI edge functions. Every function needs
// a service-role client (subscription_status etc. are trigger-protected, so a
// normal user JWT can't be trusted to read them authoritatively) and needs to
// identify the caller from their bearer token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type AdminClient = ReturnType<typeof createClient>;

// The admin client uses the project's new secret key (sb_secret_…), which the
// platform injects as SUPABASE_SECRET_KEYS (JSON, { name: key }). It acts as the
// service_role Postgres role (bypasses RLS). The legacy SUPABASE_SERVICE_ROLE_KEY
// (a JWT) is deprecated by Supabase by the end of 2026 — never fall back to it,
// or a function would silently keep depending on a key that is going away.
const SECRET_KEY_NAME = 'default';

function secretKey(): string | null {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!raw) return null;
  try {
    const key = (JSON.parse(raw) as Record<string, unknown>)[SECRET_KEY_NAME];
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

export function createAdminClient(): AdminClient | null {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = secretKey();
  if (!supabaseUrl || !key) {
    console.error(`[auth] SUPABASE_URL or the "${SECRET_KEY_NAME}" secret key (SUPABASE_SECRET_KEYS) is missing`);
    return null;
  }
  return createClient(supabaseUrl, key, { auth: { persistSession: false } });
}

// verify_jwt (config.toml, default true) already rejects unauthenticated
// calls at the gateway before this runs. This just identifies who the caller
// is so we can look up their profile / rate-limit history.
export async function getAuthedUser(req: Request, admin: AdminClient) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
