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
| `functions/scan-kitchen` | AI kitchen/pantry scan backend (multi-image vision). Takes 1–4 fridge/pantry photos as inline base64 (`images: [{ base64, mimeType }]`, no Supabase Storage) and returns the distinct ingredients visible (`ingredients: [{ name, category }]`), each `category` constrained to the app's 8 `IngredientCategory` values. Sends all images inline to Gemini (`gemini-3.6-flash`, multimodal) per request. Same session/entitlement/rate-limit plumbing, on its own independent 30-calls/hour bucket (`function_name = 'scan-kitchen'`). Wired to `KitchenScanModal`'s capture → review flow. |
| `functions/suggest-kitchen-recipes` | AI "What Can I Make" backend (text-only). Takes `kitchenItems: string[]` (My Kitchen ingredient names) and returns a batch of ~10 full recipe suggestions (`suggestions: [{ name, category, calories, cookTimeMin, difficulty, protein, carbs, fats, ingredients[], steps[] }]`). Profile context (diet, allergies, goals) is loaded server-side from the `users` row — never trusted from the client. Same session/entitlement (including free scans)/rate-limit plumbing, on its own independent 30-calls/hour bucket (`function_name = 'suggest-kitchen-recipes'`). Wired to the What Can I Make screen. |
| `functions/generate-meal-suggestions` | AI "Build My Plan" backend (text-only). Takes `mealType` (Breakfast/Lunch/Dinner/Snacks), `count` (1–8), and the Build My Plan onboarding answers (`cuisines[]`, `cookTime`, `loves[]`, `avoid[]`, optional `description`), and returns that many meal suggestions in the same suggestion shape as `suggest-kitchen-recipes` (`category` locked to the requested `mealType`). Profile context (diet, allergies, goals) is loaded server-side from the `users` row — never trusted from the client. Same session/entitlement (including free scans)/rate-limit plumbing, on its own independent 30-calls/hour bucket (`function_name = 'generate-meal-suggestions'`). Wired to Build My Plan's post-build "Describe what you want" swap flow and the Suggest-more pool-exhaustion fallback. Shares its prompt/sanitization helpers with `generate-plan-shortlist` via `_shared/mealPromptHelpers.ts`. |
| `functions/generate-plan-shortlist` | AI "Build My Plan" shortlist backend (text-only). Takes `mealTypes: string[]` (any subset of Breakfast/Lunch/Dinner/Snacks), the user's picked `proteins[]`/`carbs[]`/`fats[]` (primary personalisation signal), the optional secondary prefs (`cuisines[]`, `cookTime`, `loves[]`, `avoid[]`), and an optional `countPerType` override, and returns `shortlist: { [mealType]: [ suggestion, … ] }` — one array of options per requested type (defaults: mains 4, snacks 2) in the same per-item shape as `generate-meal-suggestions` minus `category`. One Gemini round-trip per call. Profile context (diet, allergies, goals) is loaded server-side from the `users` row — never trusted from the client. Same session/entitlement (including free scans)/rate-limit plumbing, on its own independent 30-calls/hour bucket (`function_name = 'generate-plan-shortlist'`). Wired to Build My Plan's initial shortlist generation and the per-meal-type "Generate more" top-up. |
| `functions/generate-recipe-concept` | AI Custom Recipe concept backend (text-only, cheap first stage). Takes a freeform `description` (+ optional `mealType`) and returns a lightweight preview concept: `{ name, description, calories, protein, carbs, fats }` — no ingredients/steps. Profile context (diet, allergies, goals) is loaded server-side. **Free-scan-pool gated** like the scan features (same session/entitlement-including-free-scans/rate-limit plumbing, own independent 30-calls/hour bucket `function_name = 'generate-recipe-concept'`), so it's freely triable within the free allowance. Wired to the Custom Recipe screen's Describe → concept + Fix/refine flow. |
| `functions/generate-recipe-steps` | AI Custom Recipe "unlock full recipe" backend (text-only, second stage). Takes the concept the user already saw (`{ name, description, calories, protein, carbs, fats, mealType? }`) and returns `{ ingredients: [{ name, quantity, unit }], steps: string[] }`, kept consistent with the shown macros. Profile context (diet, allergies) is loaded server-side. **Subscription-only gated** — `isEntitled(subscription_status)` with NO free-scan fallback (non-subscribers always get `not_premium`/402, and this function never consumes a free scan). Still rate-limited on its own 30-calls/hour bucket (`function_name = 'generate-recipe-steps'`). Wired to the Custom Recipe screen's Generate CTA. |
| `functions/recipe-assistant` | AI in-recipe chat backend (text-only). Takes `{ recipeName, recipeSource: 'ai'\|'premade', ingredients[], steps[], messages: [{ role, text }] }` (full chat history, last entry the new user message) and returns `{ reply }`. Profile context (diet, allergies) is loaded server-side for substitution-safety. **Two entitlement gates, both `not_premium`/402:** (1) active subscription, unconditional (premium-only, no free tier); (2) for `recipeSource === 'ai'` only, a non-empty `steps` array (sequencing proof that `generate-recipe-steps` already ran). **Unlimited/unmetered as a product feature** — never `consumeFreeScan`s and never presented to the user as having any limit. It does still carry the same technical `isRateLimited`/`logAiUsage` backstop as every other function, just on a deliberately generous bucket (60 calls/minute, `function_name = 'recipe-assistant'`) meant only to catch a runaway client bug or scripted abuse — if it ever fires the error message is the same generic wording as any other transient failure. Wired to the Recipe Assistant panel on the recipe detail screen. |
| `functions/revenuecat-webhook` | **Not an AI function** — keeps `users.subscription_status`/`subscription_provider`/`subscription_expiry_date` in sync with RevenueCat so the two subscription-only gates above (`generate-recipe-steps`, `recipe-assistant`) see the same entitlement the client already unlocked via `lib/purchases.ts`. Grants Pro (`'trial'` or `'active'`, from `period_type`) on `INITIAL_PURCHASE`/`RENEWAL`/`UNCANCELLATION`/`PRODUCT_CHANGE`/`SUBSCRIPTION_EXTENDED`; revokes it (`'expired'`) on `EXPIRATION`; deliberately no-ops on `CANCELLATION`/`BILLING_ISSUE` (access continues until the real `EXPIRATION` event); acks-and-ignores anything else (`TRANSFER`, paywall UI events, future event types). Auth is a **shared secret**, not a Supabase JWT — see "RevenueCat webhook setup" below. `verify_jwt = false` (config.toml). |

### `_shared/` — reuse this for every future AI function

`functions/_shared/` holds the boilerplate common to AI features (not deployed
as its own function — Supabase bundles it into whichever function imports it).
New AI edge functions should compose these instead of hand-rolling their own:

| File | Provides |
| --- | --- |
| `_shared/cors.ts` | `corsHeaders`, `handlePreflight(req)` for the `OPTIONS` request. |
| `_shared/errors.ts` | `AIErrorCode` (`invalid_input \| unauthorized \| not_premium \| rate_limited \| ai_failed`), `jsonResponse()`, `errorResponse()`. Keep the client-consumed error contract identical across functions. |
| `_shared/auth.ts` | `createAdminClient()` (service-role client — needed since `subscription_status` is trigger-protected) and `getAuthedUser(req, admin)`. |
| `_shared/entitlement.ts` | `isEntitled(status)` — single source of truth for what counts as "premium" (`active`/`trial`). `resolveEntitlement(status, freeScansRemaining)` gates a call: subscribers are unlimited, everyone else is allowed while `free_scans_remaining > 0` (read-only; doesn't consume). `consumeFreeScan(admin, userId)` atomically spends one free scan via the `consume_free_scan` RPC — call it (like `logAiUsage`) only after a successful call, and only for non-subscribers. |
| `_shared/rateLimit.ts` | `isRateLimited(admin, userId, functionName, limit, windowMs)` + `logAiUsage(...)` against `ai_usage_log`. Log usage only after a successful AI call so failures don't burn quota. |
| `_shared/gemini.ts` | `callGeminiJSON({ apiKey, model, systemInstruction, userText, responseSchema, logPrefix })` — structured-output Gemini call with a 15s timeout (`GeminiTimeoutError`) and **one** automatic retry after a 500ms delay, scoped to transient upstream rejections only (`GeminiHttpError` with status 429/503). Never retries after a timeout (would double the worst-case wait) or on other status codes (retrying an ambiguous server error risks masking a real request bug). Logs duration on every attempt. Optionally accepts `images: [{ base64, mimeType }]` for vision requests — one or more images, each sent as its own inline part before the text prompt (image-first). |

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
npx supabase functions deploy scan-kitchen
npx supabase functions deploy suggest-kitchen-recipes
npx supabase functions deploy generate-meal-suggestions
npx supabase functions deploy generate-plan-shortlist
npx supabase functions deploy generate-recipe-concept
npx supabase functions deploy generate-recipe-steps
npx supabase functions deploy recipe-assistant

# Redeploy any function whose shared code changed (they bundle their own copy of
# `_shared/`): e.g. after the multi-image `_shared/gemini.ts` or free-scan
# `_shared/entitlement.ts` changes, redeploy all of the above.

# revenuecat-webhook is unrelated to the AI functions/GEMINI_API_KEY above —
# see "RevenueCat webhook setup" below for its own secret + deploy command.

# 3. Push new migrations (e.g. the consume_free_scan RPC)
npx supabase db push
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

### RevenueCat webhook setup

`functions/revenuecat-webhook` needs its own secret (separate from
`GEMINI_API_KEY`) and one manual RevenueCat-dashboard step that can't be done
from inside this codebase:

```bash
# 1. Generate a long random string and store it as a function secret. Any
#    generator works, e.g.:
openssl rand -hex 32

npx supabase secrets set REVENUECAT_WEBHOOK_SECRET=<the-random-string>

# 2. Deploy (note --no-verify-jwt: RevenueCat sends its own shared secret in
#    the Authorization header, not a Supabase JWT, so the platform-level JWT
#    check must be off for this one function — see config.toml).
npx supabase functions deploy revenuecat-webhook --no-verify-jwt
```

Then, in the RevenueCat dashboard: **Project settings → Integrations →
Webhooks → Add new configuration**. Enter:
- **URL**: `https://<your-project-ref>.supabase.co/functions/v1/revenuecat-webhook`
- **Authorization header value**: the exact same random string from step 1
  above (RevenueCat sends this back verbatim in every request's
  `Authorization` header; the function 401s anything that doesn't match).
- Leave event filtering unset (the function safely acks-and-ignores any event
  type it doesn't act on) unless you want to reduce noise.

Without this dashboard step, purchases still work locally (RevenueCat →
`useEntitlementStore` unlocks the two client-only gates immediately) but
`users.subscription_status` never updates, so `generate-recipe-steps` and
`recipe-assistant` will keep rejecting a paying subscriber with `not_premium`
the first time they're used after a fresh purchase.

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
