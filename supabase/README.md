# Supabase (development project)

This folder holds the database schema and Row Level Security policies as
version-controlled migrations. The app connects with the **publishable** key
from `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).

## Migrations

| File | What it does |
| --- | --- |
| `migrations/20260714010000_schema.sql` | All 17 tables, helper functions, `updated_at` triggers, auth→profile trigger, protected-columns trigger. |
| `migrations/20260714010100_rls.sql` | Enables RLS on every table + owner / child / premade / admin policies. |
| `migrations/20260714010200_sync_constraints.sql` | Natural-key unique indexes for offline-first upserts: `(user_id, ingredient_name)` on the grocery tables and `(user_id, logged_at)` on `weight_logs`. |
| `migrations/20260714010300_seed_premade_recipes.sql` | Seeds 6 placeholder premade recipes (+ ingredients, steps) with fixed UUIDs matching `constants/premadeRecipes.ts`, and marks exactly 5 free in `premade_recipe_access`. |
| `migrations/20260717010000_delta_sync.sql` | Delta-pull support: adds `updated_at` (+ `set_updated_at` trigger) to `weight_logs`, `saved_recipes`, `kitchen_items`, `cart_items`; `(user_id, updated_at)` indexes on the delta tables (+ `(updated_at)` on `recipes`); and a `server_now()` RPC (granted to `authenticated`) for skew-free cursors. |

## Apply to the hosted project

Run these once, from the `meal-app` directory. They need your Supabase login
and the project's database password (Dashboard → Settings → Database):

```bash
# 1. Authenticate the CLI (opens a browser)
npx supabase login

# 2. Link this repo to the dev project
npx supabase link --project-ref kpmxjufzggcapljhxutv

# 3. Push the migrations
npx supabase db push
```

## Manual dashboard steps (not code)

1. **Auth → Providers → Email**: enable it and turn on **"Confirm email"**.
2. **Auth → URL Configuration → Redirect URLs**: add
   - `mealapp://auth/callback`
   - `mealapp://auth/reset`
   - (While testing in Expo Go the app also opens on an `exp://…/--/auth/*`
     URL; add that host too, or use a dev build so the `mealapp://` scheme is used.)
3. **Make yourself an admin**: Auth → Users → your user → edit
   **app_metadata** to include `{"is_admin": true}`. `public.is_admin()` reads
   this claim, so premade content + `premade_recipe_access` become writable
   from the app for your account. (The dashboard itself uses the service role
   and bypasses RLS regardless.)
4. Free premade recipes are now seeded automatically (5 of the 6 placeholders
   are `is_free = true`). Adjust in `premade_recipe_access` only if you change
   the seeded set.

## Sync model (login pull)

- **Cache-first**: the app renders the persisted local store immediately on
  launch; the pull runs in the background and union-merges results in.
- **Incremental (delta) pull**: after the first successful sync the client
  stores a per-user high-water-mark (`server_now()` captured *before* the pull)
  and, on later launches/logins for the *same* account, only fetches rows with
  `updated_at > cursor`. Full pulls still happen on first claim, account switch,
  and when no cursor exists yet (fresh install / first launch after this
  upgrade).
- **Single-device model**: this is last-write-wins with no tombstones.
  Cross-device **hard deletes are not propagated** — deleting a row on device A
  won't remove it on device B via the delta (a delete has no `updated_at` row to
  return). Supporting that later would need soft-delete `deleted_at` tombstones
  in the delta feed. Edits and inserts do propagate normally.
- Requires the `20260717010000_delta_sync.sql` migration to be pushed: the
  client's `updated_at` filters and `server_now()` RPC assume those exist.
  Until pushed, `server_now()` falls back to device time and the `updated_at`
  filters would error — **push this migration before shipping delta sync.**

## Notes / gotchas

- **RLS is the only data protection** because the publishable key is public.
  Never disable RLS on a table.
- `free_scans_remaining`, `subscription_status`, `subscription_provider`, and
  `subscription_expiry_date` on `users` are protected by a trigger: normal
  authenticated users cannot change them (only admins / server-side).
- A new auth signup auto-creates a minimal `public.users` row (id + email); the
  rest of the profile is filled in by the offline-first sync layer
  (`lib/sync/*`) on first reconcile after login.
- Apple/Google sign-in is scaffolded in the app but not wired — it needs a
  native dev build and provider config in the dashboard before launch.
