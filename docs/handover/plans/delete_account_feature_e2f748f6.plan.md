---
name: Delete Account Feature
overview: "Add a real account-deletion path: a new `delete-account` Supabase edge function (following the existing `_shared/` auth pattern) that deletes the Supabase auth user — which cascades to every owned row — plus a real client screen that gates deletion behind a password re-check, warns about Apple subscriptions, and cleans up local state."
todos:
  - id: backend-fn
    content: Create supabase/functions/delete-account/index.ts following the _shared/ auth pattern, calling admin.auth.admin.deleteUser(user.id)
    status: completed
  - id: errors-code
    content: Add 'server_error' to AIErrorCode union in _shared/errors.ts
    status: completed
  - id: config-toml
    content: Register delete-account in supabase/config.toml with verify_jwt = true, and deploy it
    status: completed
  - id: client-helper
    content: Add lib/deleteAccount.ts with deleteAccountRequest() invoking the new edge function
    status: completed
  - id: wire-entry
    content: Replace the disabled View in app/settings/account.tsx with a working NavRow to the confirm screen
    status: completed
  - id: rewrite-confirm-screen
    content: "Rewrite app/settings/account-delete-confirm.tsx: password re-entry gate, subscription warning + Manage Subscription button, confirm alert, delete call, and full cleanup/redirect sequence"
    status: completed
isProject: false
---

## Key finding from research: no manual per-table deletion needed

Queried the live linked DB's foreign keys pointing at `auth.users(id)` — **every single one already has `ON DELETE CASCADE`**, including transitively (`plans -> plan_slots -> plan_day_meals`, `recipes -> recipe_ingredients/recipe_steps`, `meal_logs -> meal_log_ingredients`, `saved_recipes`, `kitchen_items`, `cart_items`, `planned_ingredients`, `weight_logs`, `progress_daily`, `ai_usage_log`, and `public.users` itself). The `macro_proteins`/`macro_carbs`/`macro_fats` tables are shared reference data with no `user_id` at all. There's no Supabase Storage usage anywhere in the app either.

This means a single `admin.auth.admin.deleteUser(user.id)` call (service-role Admin API) is sufficient to wipe all of a user's data — no explicit per-table deletes required. The edge function will document this conclusion in a comment so it's not mysterious later.

## Backend: `supabase/functions/delete-account/index.ts` (new)

Follows the exact auth pattern from [generate-recipe-concept/index.ts](supabase/functions/generate-recipe-concept/index.ts) / [recipe-assistant/index.ts](supabase/functions/recipe-assistant/index.ts), composed from `_shared/`:

```ts
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { createAdminClient, getAuthedUser } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse('invalid_input', 'Method not allowed', 405);

  const admin = createAdminClient();
  if (!admin) return errorResponse('server_error', 'Server not configured', 500);

  const user = await getAuthedUser(req, admin);
  if (!user) return errorResponse('unauthorized', 'Not signed in', 401);

  // Every FK chain down to auth.users(id) already cascades (verified against
  // the live schema) — deleting the auth user removes public.users, plans,
  // recipes, saved_recipes, meal_logs, kitchen_items, cart_items,
  // planned_ingredients, weight_logs, progress_daily, ai_usage_log, and every
  // child row transitively. No per-table cleanup needed.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return errorResponse('server_error', 'Could not delete your account. Please try again.', 500);

  return jsonResponse({ success: true }, 200);
});
```

- There's no target-user param — the caller can only ever delete themselves (`user.id` from their own verified JWT), which satisfies "verify the request is from the authenticated user themselves."
- [_shared/errors.ts](supabase/functions/_shared/errors.ts)'s `AIErrorCode` union gets one additive value, `'server_error'`, since this isn't an AI-specific failure.
- Register in [supabase/config.toml](supabase/config.toml):
  ```toml
  [functions.delete-account]
  enabled = true
  verify_jwt = true
  ```
- Deploy with `supabase functions deploy delete-account`.

## Client: new request helper

Small dedicated file (not `ai/aiEdgeClient.ts`, which is explicitly scoped to AI features) — `lib/deleteAccount.ts`:
- `deleteAccountRequest(): Promise<{ error: string | null }>` wrapping `supabase.functions.invoke('delete-account', { timeout: ... })`, parsing the same `{ error: { code, message } }` shape.

## Client: wire the entry point — `app/settings/account.tsx`

Currently a disabled, non-interactive `View` (lines 114-120). Replace with a real destructive `TouchableOpacity`/`NavRow` that navigates to `router.push('/settings/account-delete-confirm')`.

## Client: rewrite `app/settings/account-delete-confirm.tsx`

Replaces the "coming soon" placeholder. Using the existing `FormPage` wrapper:

- Password `TextInput` (`secureTextEntry`), using `useAuth().user?.email` for the account email.
- Delete button disabled until the password field is non-empty.
- Clear warning text block: deleting the account does **not** cancel any active Apple subscription — it must be cancelled separately in device subscription settings — plus a secondary button that calls the already-existing `showManageSubscriptions()` ([lib/purchases.ts](lib/purchases.ts)) for one-tap access to that settings screen.
- On Delete tap:
  1. Native destructive confirm `Alert` ("Delete your account permanently? This can't be undone.") — mirrors the logout screen's confirm pattern in [app/settings.tsx](app/settings.tsx).
  2. Verify the typed password via `signInWithEmail(user.email, password)` from [lib/auth.tsx](lib/auth.tsx) (there's no separate "verify password" endpoint in this codebase — signing in again with the same credentials is the existing idiom). Wrong password -> alert, stop, nothing destructive has happened.
  3. Call `deleteAccountRequest()`. On failure, alert and stop (account is still intact).
  4. On success, mirror `finishLogout`'s cleanup from [app/settings.tsx](app/settings.tsx) but skip the outbox flush (nothing left server-side to flush to):
     ```ts
     await signOut();
     void clearPendingPassword();
     useEntitlementStore.getState()._reset(); // instant local clear (currently-unused action)
     resetUserData();
     router.replace('/onboarding');
     ```
  `router.replace('/onboarding')` always mounts fresh at the `'welcome'` step (confirmed — there's no resumable-step mechanism), so this is already "the very start of onboarding."

## Todos
