// send-announcement — Alex's channel to every user: saves a message to the
// bell inbox (announcements) and sends it as a phone notification to every
// registered device via Expo's push service.
//
// Auth: not a user call, so verify_jwt = false (supabase/config.toml) and the
// Authorization header must be `Bearer <ANNOUNCE_SECRET>`. Set the secret with:
//   npx supabase secrets set ANNOUNCE_SECRET=<a long random string>
// and keep the same value in the local .env (scripts/send-announcement.mjs
// reads it from there).
//
// Body: { title, body, dry_run?, force? }. dry_run counts the devices and
// validates the text without saving or sending anything. The same title+body
// within 30 minutes is refused (a re-run after a timeout must not double-send)
// unless force is true.
//
// Deploy with:
//   npx supabase functions deploy send-announcement --no-verify-jwt

import { createAdminClient } from '../_shared/auth.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';

const LOG_PREFIX = '[send-announcement]';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100; // Expo's per-request limit
const PUSH_TIMEOUT_MS = 15_000;
const PARALLEL_BATCHES = 6;
const DUPLICATE_WINDOW_MS = 30 * 60_000;

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorResponse('invalid_input', 'POST only', 405);

  const secret = Deno.env.get('ANNOUNCE_SECRET');
  if (!secret || secret.length < 20) {
    console.error(`${LOG_PREFIX} ANNOUNCE_SECRET is not set`);
    return errorResponse('server_error', 'Not configured', 500);
  }
  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(auth, secret)) return errorResponse('unauthorized', 'Unauthorized', 401);

  let input: { title?: unknown; body?: unknown; dry_run?: unknown; force?: unknown };
  try {
    input = await req.json();
  } catch {
    return errorResponse('invalid_input', 'Body must be JSON', 400);
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (title.length < 1 || title.length > 80) {
    return errorResponse('invalid_input', 'Title must be 1–80 characters', 400);
  }
  if (body.length < 1 || body.length > 1000) {
    return errorResponse('invalid_input', 'Message must be 1–1000 characters', 400);
  }
  const dryRun = input.dry_run === true;

  const admin = createAdminClient();
  if (!admin) return errorResponse('server_error', 'Not configured', 500);

  // Every device token, paged (PostgREST returns at most 1000 rows per call).
  const tokens: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('push_tokens').select('token').order('token').range(from, from + 999);
    if (error) {
      console.error(`${LOG_PREFIX} token read failed:`, error.message);
      return errorResponse('server_error', 'Could not read devices', 500);
    }
    tokens.push(...(data ?? []).map((r: { token: string }) => r.token));
    if (!data || data.length < 1000) break;
  }

  if (input.force !== true) {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const { data: dupes, error: dupeError } = await admin
      .from('announcements').select('id, created_at')
      .eq('title', title).eq('body', body).gte('created_at', since).limit(1);
    if (dupeError) {
      console.error(`${LOG_PREFIX} duplicate check failed:`, dupeError.message);
      return errorResponse('server_error', 'Could not check for duplicates', 500);
    }
    if (dupes && dupes.length > 0) {
      return errorResponse(
        'invalid_input',
        `This exact message was already sent at ${dupes[0].created_at}. Send again with force to repeat it.`,
        409,
      );
    }
  }

  // After the duplicate check, so a dry run also warns about a repeat.
  if (dryRun) return jsonResponse({ dry_run: true, devices: tokens.length, title, body }, 200);

  const { data: row, error: insertError } = await admin
    .from('announcements').insert({ title, body }).select('id, created_at').single();
  if (insertError || !row) {
    console.error(`${LOG_PREFIX} insert failed:`, insertError?.message);
    return errorResponse('server_error', 'Could not save the message', 500);
  }

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  const sendBatch = async (batch: string[]) => {
    const messages = batch.map(to => ({
      to,
      title,
      body,
      sound: 'default',
      data: { type: 'announcement', id: row.id },
    }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => null);
      const tickets: { status?: string; details?: { error?: string } }[] =
        Array.isArray(json?.data) ? json.data : [];
      if (!res.ok || tickets.length !== batch.length) {
        console.error(`${LOG_PREFIX} push batch failed: HTTP ${res.status}`, JSON.stringify(json)?.slice(0, 500));
        failed += batch.length;
        return;
      }
      tickets.forEach((t, j) => {
        if (t.status === 'ok') sent++;
        else {
          failed++;
          // The app was deleted or notifications revoked: stop sending there.
          if (t.details?.error === 'DeviceNotRegistered') dead.push(batch[j]);
        }
      });
    } catch (e) {
      console.error(`${LOG_PREFIX} push batch error:`, e instanceof Error ? e.message : e);
      failed += batch.length;
    }
  };

  // A few batches at a time keeps a large send well inside the caller's wait.
  const batches: string[][] = [];
  for (let i = 0; i < tokens.length; i += EXPO_BATCH) batches.push(tokens.slice(i, i + EXPO_BATCH));
  for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
    await Promise.all(batches.slice(i, i + PARALLEL_BATCHES).map(sendBatch));
  }

  // In chunks: the token list goes in the request URL.
  for (let i = 0; i < dead.length; i += 100) {
    const { error } = await admin.from('push_tokens').delete().in('token', dead.slice(i, i + 100));
    if (error) console.error(`${LOG_PREFIX} dead-token cleanup failed:`, error.message);
  }

  console.info(`${LOG_PREFIX} id=${row.id} devices=${tokens.length} sent=${sent} failed=${failed} removed=${dead.length}`);
  return jsonResponse({ id: row.id, devices: tokens.length, sent, failed, removed: dead.length }, 200);
});
