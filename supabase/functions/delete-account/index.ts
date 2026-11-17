// delete-account — permanently deletes the calling user's Supabase auth
// account (and, transitively, all of their app data).
//
// There is no target-user parameter: the only account this function can ever
// delete is the one identified by the caller's own bearer token
// (getAuthedUser), which is exactly what "verify the request is from the
// authenticated user themselves" requires — there's no other account id to
// even mistakenly act on.
//
// Why a single deleteUser() call is enough: every foreign key chain from
// every app table down to auth.users(id) already has ON DELETE CASCADE
// (verified directly against the live schema — public.users, plans ->
// plan_slots -> plan_day_meals, recipes -> recipe_ingredients/recipe_steps,
// saved_recipes, meal_logs -> meal_log_ingredients, kitchen_items,
// cart_items, planned_ingredients, weight_logs, progress_daily,
// ai_usage_log, ai_events, push_tokens, sync_deletions, meal_templates,
// user_feedback). Deleting the auth.users row removes all of it transitively
// — there is no per-table cleanup to do here, and adding any would just be
// redundant code that could silently drift from the real schema over time.
// Two things live outside the database and are removed here first: the
// user's meal photos (Supabase Storage, meal-photos/<user id>/) and their
// customer record at RevenueCat (Nov 16, promised by the Privacy Policy).
//
// Deploy with:
//   supabase functions deploy delete-account

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';
import { deleteRevenueCatCustomer } from '../_shared/subscription.ts';

// The client waits 15 s (lib/deleteAccount.ts): two RevenueCat tries fit.
const RC_DELETE_TIMEOUT_MS = 5000;

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse('invalid_input', 'Method not allowed', 405);

  const admin = createAdminClient();
  if (!admin) return errorResponse('server_error', 'Server not configured', 500);

  const user = await getAuthedUser(req, admin);
  if (!user) return errorResponse('unauthorized', 'Not signed in', 401);

  // Meal photos first (Storage files don't cascade with the user, and a user
  // who still owns files can't be deleted). Fail loudly so the user retries
  // rather than leaving photos behind.
  const photosGone = await deleteMealPhotos(admin, user.id);
  if (!photosGone) {
    return errorResponse('server_error', 'Could not delete your account. Please try again.', 500);
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('[delete-account] deleteUser failed:', error);
    return errorResponse('server_error', 'Could not delete your account. Please try again.', 500);
  }

  // RevenueCat's copy (purchase history under this account id), only once the
  // account is really gone: deleting it first and then failing deleteUser
  // would leave a live account whose phone shows no Pro. Best effort with one
  // retry: the deletion has succeeded, so a RevenueCat outage is logged (for a
  // manual clean-up) and never shown to the user.
  const rcKey = Deno.env.get('REVENUECAT_SECRET_API_KEY');
  if (!rcKey) {
    console.error('[delete-account] REVENUECAT_SECRET_API_KEY missing — RevenueCat customer not deleted');
  } else {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const outcome = await deleteRevenueCatCustomer(user.id, rcKey, RC_DELETE_TIMEOUT_MS);
        console.info(`[delete-account] RevenueCat customer ${outcome}`);
        break;
      } catch (e) {
        if (attempt === 2) {
          console.error(`[delete-account] RevenueCat delete failed for ${user.id} — remove it by hand:`, e);
        }
      }
    }
  }

  return jsonResponse({ success: true }, 200);
});

// Every object under meal-photos/<user id>/ (flat folder), a page at a time.
// deno-lint-ignore no-explicit-any
async function deleteMealPhotos(admin: any, userId: string): Promise<boolean> {
  const bucket = admin.storage.from('meal-photos');
  for (let round = 0; round < 100; round++) {
    const { data, error } = await bucket.list(userId, { limit: 1000 });
    if (error) {
      console.error('[delete-account] list photos failed:', error);
      return false;
    }
    const names = (data ?? []).map((f: { name: string }) => `${userId}/${f.name}`);
    if (names.length === 0) return true;
    const { error: rmErr } = await bucket.remove(names);
    if (rmErr) {
      console.error('[delete-account] remove photos failed:', rmErr);
      return false;
    }
  }
  return false;
}
