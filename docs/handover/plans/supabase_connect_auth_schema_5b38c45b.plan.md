---
name: Supabase Connect Auth Schema
overview: Connect the Expo app to the Supabase dev project via env vars, wire full Email/Password auth (with verification + password reset) while scaffolding Apple/Google for a later dev build, and define all 17 tables with RLS and an admin role via in-repo Supabase CLI migrations. No Zustand sync, edge functions, or billing yet.
todos:
  - id: client-env
    content: Add @supabase/supabase-js + react-native-url-polyfill; put Supabase URL/publishable key in .env and .env.example; create lib/supabase.ts client (AsyncStorage, autoRefresh, AppState); add ios.bundleIdentifier/android.package to app.json.
    status: completed
  - id: auth-lib
    content: "Create auth helper/AuthProvider: signUp/signIn/signOut/sendPasswordReset/updatePassword + onAuthStateChange session tracking, with deep-link redirects."
    status: completed
  - id: auth-ui
    content: Wire AccountStep (create account + verify-email state) and LoginView (login) in onboarding; add forgot-password and reset routes; scaffold Apple/Google buttons as documented no-ops.
    status: completed
  - id: migration-schema
    content: supabase init; write 0001_schema.sql with all 17 tables (uuid PKs, timestamptz UTC, arrays, CHECK constraints, FKs w/ cascade, one-active-plan index, progress_daily unique, updated_at triggers, auth.users->public.users trigger, protected-columns trigger).
    status: completed
  - id: migration-rls
    content: "Write 0002_rls.sql: enable RLS on all tables, owner/child/premade/admin policies, is_admin() helper; provide link + db push instructions."
    status: completed
isProject: false
---

# Supabase: Connection, Auth (Email/Password), Schema + RLS

## Concerns, critique, and edge cases (read first)

These are things worth deciding on now, even though most are handled by the plan below.

- **Native Apple/Google need a dev build.** Per your choice, we wire Email/Password fully now and leave the Apple/Google buttons as scaffolds. Before launch you'll need an Apple Developer account ($99/yr) + `expo-apple-authentication`, a Google Cloud OAuth client, and an EAS Dev Client (they don't run in Expo Go). Also: `app.json` has no `ios.bundleIdentifier` or `android.package` yet — both are required for native auth, deep links, and EAS builds, so we'll add them now.
- **Publishable key is public by design — RLS is the ONLY thing protecting data.** The `sb_publishable_...` key ships in the JS bundle (that's expected). This means **any table without RLS enabled is fully readable/writable by anyone with the key.** Every table must have RLS ON with explicit policies. We enable RLS on all 17 tables.
- **Server-authoritative fields are tamperable under the spec's RLS.** The spec says users can `UPDATE` their own row. That lets a malicious client set `free_scans_remaining = 9999`, `subscription_status = 'active'`, `subscription_expiry_date`, etc. directly. Recommendation: block client writes to these columns (a `BEFORE UPDATE` trigger that reverts changes to protected columns unless `is_admin()`), and mutate them only server-side later (edge function / RevenueCat webhook). Flagging now; I'll include the trigger unless you object.
- **Email verification vs. writing the profile row.** When email confirmation is on, `signUp` returns a user but **no session until the email is verified** — so the client can't `INSERT` into `users` yet (RLS needs `auth.uid()`). Fix: a DB trigger `on auth.users insert` auto-creates a minimal `public.users` row (`id`, `email`). Fully populating it from onboarding answers is the later Zustand-sync task (out of scope now); for now onboarding answers stay in local Zustand and we flush them after first verified login.
- **Onboarding ordering.** All profile data is collected before account creation (`AccountStep` is near the end). With verification required, that data lives only locally until the user verifies and logs in. Acceptable for now; the sync task handles the flush.
- **Password reset needs a completion screen, not just a request screen.** The reset email opens the app via deep link and fires a `PASSWORD_RECOVERY` auth event; we need a small "set new password" screen in addition to the "enter email" screen you described.
- **Child tables have no `user_id`.** `plan_slots`, `plan_day_meals`, `recipe_ingredients`, `recipe_steps`, `meal_log_ingredients` can't use `user_id = auth.uid()` directly — their RLS must join to the parent (`plans`, `recipes`, `meal_logs`). Premade recipes' ingredients/steps must be world-readable to authenticated users (or premade recipes render with no ingredients).
- **Admin role.** Supabase has no built-in per-user "admin". We'll use an `app_metadata` claim + a `public.is_admin()` SQL helper used in policies. Note the Supabase **dashboard already uses the service role and bypasses RLS**, so you can manage premade content from the dashboard regardless; the admin role only matters for admin actions performed through the app. You'll set `{"is_admin": true}` on your account in Auth → Users.
- **Enums vs text.** Many constrained strings (`gender`, `goal_type`, `activity_level`, `difficulty`, `meal_type`, `source`, `subscription_status`, `subscription_provider`, `weight_unit`, `height_unit`, `planned_ingredients.status`, `health_rating`, ingredient `category`). Plan uses `text` + `CHECK` constraints (easier to evolve than Postgres enums). Value sets are drawn from the current app model (e.g. weight units include `st`); confirm if you want stricter enums.
- **Dev email deliverability.** Supabase's built-in email sender is heavily rate-limited (~a few/hour) and not for production. Fine for dev; you'll need custom SMTP before launch.
- **Model mismatches to reconcile at sync time (not now).** App stores `heightCm`/`weightKg` canonically; schema stores value+unit. `age` is derivable from `birthday`. These are reconciled in the sync task.

## Part A — Client connection + env

- Add deps: `@supabase/supabase-js`, `react-native-url-polyfill` (AsyncStorage already installed).
- Env (never hard-coded), following the existing `EXPO_PUBLIC_` pattern in [meal-app/ai/aiClient.ts](meal-app/ai/aiClient.ts):
  - `.env` (gitignored): `EXPO_PUBLIC_SUPABASE_URL=https://kpmxjufzggcapljhxutv.supabase.co` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`.
  - Mirror keys (empty) in [meal-app/.env.example](meal-app/.env.example).
- New `meal-app/lib/supabase.ts`: create client with `AsyncStorage`, `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`; import `react-native-url-polyfill/auto`; wire `AppState` to `startAutoRefresh`/`stopAutoRefresh`. Throw a clear error if env vars are missing.
- `app.json`: add `ios.bundleIdentifier` and `android.package` (e.g. `com.<you>.mealapp`), and Supabase auth redirect URLs use the existing `scheme: "mealapp"`.

## Part B — Auth (Email/Password now; Apple/Google scaffolded)

- New `meal-app/lib/auth.ts` (or a small `AuthProvider` context): `signUpWithEmail`, `signInWithEmail`, `signOut`, `sendPasswordReset(email)`, `updatePassword(newPw)`, and a session/user subscription via `supabase.auth.onAuthStateChange`. `signUp` uses `emailRedirectTo` = `mealapp://auth/callback`; reset uses `redirectTo` = `mealapp://auth/reset`.
- Wire existing UI (currently placeholders in [meal-app/app/onboarding.tsx](meal-app/app/onboarding.tsx)):
  - `AccountStep` "Create Account" → `signUpWithEmail` → show a "Verify your email" state.
  - `LoginView` "Log In" → `signInWithEmail`; add a "Forgot password?" link → new reset-request screen.
  - Apple/Google `AuthButton`s: keep visible but route to a "coming soon" no-op (documented TODO) so nothing breaks in Expo Go.
- New routes: `app/auth/forgot-password.tsx` (email + "Reset password" button → `sendPasswordReset`) and `app/auth/reset.tsx` (handles `PASSWORD_RECOVERY` deep link → new-password form → `updatePassword`).
- Deep links handled via `expo-linking`; add the two redirect URLs to the Supabase dashboard allow-list (manual step).

## Part C — Database schema + RLS (Supabase CLI migrations)

- `supabase init` → creates `supabase/config.toml` + `supabase/migrations/`.
- `supabase/migrations/0001_schema.sql`: all 17 tables exactly per your spec, using `uuid` PKs (`gen_random_uuid()`), `timestamptz` for timestamps (UTC), `date` for dates, `text[]` for array fields, `text` + `CHECK` for constrained strings, FKs `... references auth.users(id) on delete cascade` (or parent tables), and:
  - `users.id` = PK referencing `auth.users(id)`; `free_scans_remaining int default 5`.
  - Partial unique index `plans (user_id) where is_active` (one active plan/user).
  - Unique `progress_daily (user_id, date)`.
  - `updated_at` maintained by a shared `moddatetime`/trigger on tables that have it.
  - Trigger `on auth.users insert` → insert minimal `public.users` row.
  - Optional protected-columns trigger on `users` (subscription/scan fields) per the security note above.
- `supabase/migrations/0002_rls.sql`: `alter table ... enable row level security` on all 17 tables + policies:
  - Owner tables (`users` via `id`, `plans`, `saved_recipes`, `meal_logs`, `kitchen_items`, `cart_items`, `planned_ingredients`, `weight_logs`, `progress_daily`): SELECT/INSERT/UPDATE/DELETE where `user_id = auth.uid()` (WITH CHECK on writes).
  - Child tables (`plan_slots`, `plan_day_meals`, `recipe_ingredients`, `recipe_steps`, `meal_log_ingredients`): policies join to parent ownership; premade recipe ingredients/steps readable by all authenticated users.
  - `recipes`: SELECT for `(is_premade and user_id is null)` OR `user_id = auth.uid()`; user recipes writable by owner; premade rows writable only by `is_admin()`.
  - `premade_recipe_access`: SELECT to all authenticated; write only `is_admin()`.
  - `ai_usage_log`: INSERT/SELECT own rows only.
  - `public.is_admin()` helper reading the `app_metadata` claim.
- Apply: `supabase link --project-ref kpmxjufzggcapljhxutv` then `supabase db push` (you run these — they need your Supabase login/access token + DB password).

## Manual dashboard steps (you do these)

- Enable the **Email** auth provider and turn on **"Confirm email"**.
- Add redirect URLs `mealapp://auth/callback` and `mealapp://auth/reset` to the Auth URL allow-list.
- Set your account's `app_metadata` to `{"is_admin": true}` (Auth → Users → your user).
- Seed the 5 free premade recipes' `premade_recipe_access.is_free = true` later when premade content is loaded.

## Out of scope (per your message)
Zustand↔Supabase sync, AI edge functions, RevenueCat, notifications, analytics, and any data migration/backfill.