// sync-subscription — called by the app the moment a purchase or restore
// completes (Nov 12). The phone learns about a purchase at once; the server
// (users.subscription_status, which the AI functions check) normally hears via
// revenuecat-webhook a few seconds later. An AI request retried in that gap
// was refused as not Pro, which flashed the paywall again and froze the app.
// The standard fix (RevenueCat staff recommend it): right after the purchase,
// the server asks RevenueCat directly and saves the answer. The webhook still
// handles renewals and expirations.
//
// Only ever GRANTS Pro: RevenueCat can take a moment to show a brand-new
// purchase, so "not active yet" here must never revoke anything — expiry stays
// the webhook's job (EXPIRATION event).
//
// Answers { pro: true } (saved), { pro: false } (RevenueCat answered: not
// active) or an error (RevenueCat couldn't be asked) — the app tells the user
// "couldn't reach the server" apart from "no subscription found".
//
// No body. The user is the caller (bearer token); there is no user parameter.
// Needs the REVENUECAT_SECRET_API_KEY secret (RevenueCat → Project settings →
// API keys → secret key).
//
// Deploy with:
//   supabase functions deploy sync-subscription

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { isRateLimited, logAiUsage } from '../_shared/rateLimit.ts';
import { fetchRevenueCatPro, type RevenueCatPro } from '../_shared/subscription.ts';

const FUNCTION_NAME = 'sync-subscription';
const LOG_PREFIX = `[${FUNCTION_NAME}]`;
// Generous for a person (one call per purchase/restore), tight enough that a
// script can't burn the project's RevenueCat API quota.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
// Usually the first lookup already shows the purchase; a brand-new one can
// lag RevenueCat by a moment, so look twice more — all inside one overall
// deadline that stays well under the app's 10 s timeout.
const RETRY_DELAYS_MS = [700, 1500];
const DEADLINE_MS = 6500;
const MIN_ATTEMPT_MS = 800;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse('invalid_input', 'Method not allowed', 405);

  const admin = createAdminClient();
  const secretKey = Deno.env.get('REVENUECAT_SECRET_API_KEY');
  if (!admin || !secretKey) return errorResponse('server_error', 'Server not configured', 500);

  const user = await getAuthedUser(req, admin);
  if (!user) return errorResponse('unauthorized', 'Not signed in', 401);

  try {
    if (await isRateLimited(admin, user.id, FUNCTION_NAME, RATE_LIMIT, RATE_WINDOW_MS)) {
      return errorResponse('rate_limited', 'Too many requests. Please try again later.', 429);
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} rate limit check failed:`, e);
    return errorResponse('server_error', 'Something went wrong. Please try again.', 500);
  }
  await logAiUsage(admin, user.id, FUNCTION_NAME);

  const deadline = Date.now() + DEADLINE_MS;
  let pro: RevenueCatPro | null = null;
  let answered = false; // RevenueCat gave a real answer at least once
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const wait = RETRY_DELAYS_MS[attempt - 1];
      if (deadline - Date.now() < wait + MIN_ATTEMPT_MS) break;
      await sleep(wait);
    }
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS) break;
    try {
      pro = await fetchRevenueCatPro(user.id, secretKey, Math.min(3000, left));
      answered = true;
    } catch (e) {
      console.warn(`${LOG_PREFIX} RevenueCat lookup failed (attempt ${attempt + 1}):`, e);
      pro = null;
    }
    if (pro) break;
  }

  if (!pro) {
    if (!answered) {
      return errorResponse('server_error', "Couldn't confirm your subscription right now. Please try again.", 502);
    }
    console.log(`${LOG_PREFIX} no active Pro for ${user.id} — nothing changed`);
    return jsonResponse({ pro: false }, 200);
  }

  const { error } = await admin
    .from('users')
    .update({
      subscription_status: pro.status,
      subscription_provider: pro.provider,
      subscription_expiry_date: pro.expiryIso,
    })
    .eq('id', user.id);
  if (error) {
    console.error(`${LOG_PREFIX} failed to save Pro for ${user.id}:`, error);
    return errorResponse('server_error', 'Could not confirm your subscription. Please try again.', 500);
  }
  console.log(`${LOG_PREFIX} ${user.id} → ${pro.status}`);
  return jsonResponse({ pro: true }, 200);
});
