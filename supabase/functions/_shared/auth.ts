// Shared auth/admin-client setup for AI edge functions. Every function needs
// a service-role client (subscription_status etc. are trigger-protected, so a
// normal user JWT can't be trusted to read them authoritatively) and needs to
// identify the caller from their bearer token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type AdminClient = ReturnType<typeof createClient>;

export function createAdminClient(): AdminClient | null {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
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
