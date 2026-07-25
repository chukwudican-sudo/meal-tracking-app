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
| `migrations/20260718010000_plan_sync.sql` | Plan syncing: adds `recipe_name` + `recipe_ref` to `plan_day_meals` (preserve the local recipe reference + name when `recipe_id` can't resolve to a real recipe UUID), `updated_at` (+ trigger) on `plan_slots` so it can drive delta pulls, and `(user_id/plan_id, updated_at)` indexes on `plans` / `plan_slots` / `plan_day_meals`. |

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

## Edge Functions

| Function | What it does |
| --- | --- |
| `functions/estimate-nutrition` | AI Describe backend. Verifies the caller's session, checks `subscription_status in ('active','trial')` (returns `not_premium` otherwise so the app can trigger the paywall), enforces a 30-calls/hour per-user limit via `ai_usage_log`, then calls Gemini (`gemini-3.6-flash`, held server-side) and returns structured JSON (`meal_name`, `description`, `calories`, `protein`, `carbs`, `fats`, `meal_type`, `health_rating`, `ingredients[]`). |
| `functions/fix-meal` | AI correction backend. Takes the current meal estimate (`currentDraft`: `meal_name`, `calories`, `protein`, `carbs`, `fats`, `ingredients[]`) plus a free-text `fixText` correction, and returns the fully corrected meal in the same shape — preserving what was already right and only changing what the correction addresses. Same session/premium/rate-limit plumbing as `estimate-nutrition`, on its own independent 30-calls/hour bucket (`function_name = 'fix-meal'`). Text-only for now; the image-capable fix flows (ScanTab, FixResultScreen, MealDetailModal) still use the legacy client. |
| `functions/scan-meal` | AI photo-scan backend (vision). Takes a meal photo as inline base64 (`imageBase64` + optional `mimeType`, no Supabase Storage) and returns a minimal estimate (`meal_name`, `calories`, `protein`, `carbs`, `fats` — no ingredients). Sends the image inline to Gemini (`gemini-3.6-flash`, multimodal) per request. Same session/premium/rate-limit plumbing, on its own independent 30-calls/hour bucket (`function_name = 'scan-meal'`). Wired to ScanTab's Scan/Upload capture; the image-based re-evaluate flow still uses the legacy client. |

### `_shared/` — reuse this for every future AI function

`functions/_shared/` holds the boilerplate common to AI features (not deployed
as its own function — Supabase bundles it into whichever function imports it).
New AI edge functions should compose these instead of hand-rolling their own:

| File | Provides |
| --- | --- |
| `_shared/cors.ts` | `corsHeaders`, `handlePreflight(req)` for the `OPTIONS` request. |
| `_shared/errors.ts` | `AIErrorCode` (`invalid_input \| unauthorized \| not_premium \| rate_limited \| ai_failed`), `jsonResponse()`, `errorResponse()`. Keep the client-consumed error contract identical across functions. |
| `_shared/auth.ts` | `createAdminClient()` (service-role client — needed since `subscription_status` is trigger-protected) and `getAuthedUser(req, admin)`. |
| `_shared/entitlement.ts` | `isEntitled(status)` — the single source of truth for what counts as "premium" (`active`/`trial`). Change the policy once here, not per function. |
| `_shared/rateLimit.ts` | `isRateLimited(admin, userId, functionName, limit, windowMs)` + `logAiUsage(...)` against `ai_usage_log`. Log usage only after a successful AI call so failures don't burn quota. |
| `_shared/gemini.ts` | `callGeminiJSON({ apiKey, model, systemInstruction, userText, responseSchema, logPrefix })` — structured-output Gemini call with a 15s timeout (`GeminiTimeoutError`) and **one** automatic retry after a 500ms delay, scoped to transient upstream rejections only (`GeminiHttpError` with status 429/503). Never retries after a timeout (would double the worst-case wait) or on other status codes (retrying an ambiguous server error risks masking a real request bug). Logs duration on every attempt. Optionally accepts `imageBase64` + `imageMimeType` for vision requests (sent as an inline image part, image-first). |

Each function still owns its own prompt/schema/response-mapping and whatever
extra profile context it needs (dietary prefs, goals, kitchen items, etc.) —
only the auth/entitlement/rate-limit/Gemini-call plumbing is shared. See
`functions/estimate-nutrition/index.ts` for the reference composition.

### Deploy + secret

Run from the `meal-app` directory (needs `npx supabase login` + link first, as above):

```bash
# 1. Store the Gemini API key as a function secret (NEVER in .env / the bundle).
#    Rotate the key first if it has ever been shared in plaintext.
npx supabase secrets set GEMINI_API_KEY=<your-gemini-key>

# 2. Deploy the function(s) — all AI functions share the same GEMINI_API_KEY secret
npx supabase functions deploy estimate-nutrition
npx supabase functions deploy fix-meal
npx supabase functions deploy scan-meal
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform —
the function uses the service role to read the trigger-protected
`subscription_status` and to write `ai_usage_log`. `verify_jwt = true`
(config.toml) rejects unauthenticated calls at the gateway.

### Testing note (important)

`subscription_status` defaults to `'free'` and is trigger-protected, and there
is no IAP/paywall flow yet — so **every account is `'free'` and the gate will
reject everyone** until you flip a test account. To test AI Describe, set your
own row to entitled in the dashboard: Table editor → `users` → your row →
`subscription_status = 'active'` (the dashboard uses the service role and
bypasses the protect-columns trigger). The client model (`profile.subscription`)
is cosmetic only and unrelated to this gate.

The error contract the client consumes is `{ error: { code, message } }` with
`code` in `invalid_input | unauthorized | not_premium | rate_limited | ai_failed`.

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
- **Plans**: user plans (`savedPlans`, `source === 'user'`) sync into
  `plans` / `plan_slots` / `plan_day_meals`; the premade catalog is not synced.
  A plan meal keeps its local reference in `recipe_ref` + name in `recipe_name`;
  `recipe_id` is set only when it resolves to a real recipe UUID (a seeded
  premade or a synced saved recipe). The active plan uses `plans.is_active`
  (one active per user). Requires `20260718010000_plan_sync.sql` — **push it
  before shipping plan sync**, otherwise `plan_slots` delta pulls and the new
  columns error.

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
