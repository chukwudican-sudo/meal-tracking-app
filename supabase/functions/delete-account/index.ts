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
// ai_usage_log). Deleting the auth.users row removes all of it transitively
// — there is no per-table cleanup to do here, and adding any would just be
// redundant code that could silently drift from the real schema over time.
// The app also doesn't use Supabase Storage anywhere, so there are no
// orphaned files to worry about either.
//
// Deploy with:
//   supabase functions deploy delete-account

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse('invalid_input', 'Method not allowed', 405);

  const admin = createAdminClient();
  if (!admin) return errorResponse('server_error', 'Server not configured', 500);

  const user = await getAuthedUser(req, admin);
  if (!user) return errorResponse('unauthorized', 'Not signed in', 401);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('[delete-account] deleteUser failed:', error);
    return errorResponse('server_error', 'Could not delete your account. Please try again.', 500);
  }

  return jsonResponse({ success: true }, 200);
});
