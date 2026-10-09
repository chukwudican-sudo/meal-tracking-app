# Backend & infrastructure

Supabase (Postgres + RLS + Auth + Deno edge functions), the offline-first sync engine,
the AI layer (Gemini), RevenueCat/paywall, and environment/deploy. Companion to `supabase/README.md`,
which has the copy-paste deploy commands and the dashboard checklist.

---

## 1. Environment & secrets

`.env` (gitignored; template in `.env.example`):

| Var | Where used | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | app | `https://kpmxjufzggcapljhxutv.supabase.co` (dev project) |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app | public by design; RLS is the only protection |
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | app | **Test Store** key, shared iOS+Android. Ends in letter **O** (`…NXO`); an older plan file has a typo ending in zero → that caused a 401 "Invalid API Key". |
| `EXPO_PUBLIC_OPENAI_API_KEY` | legacy `ai/aiClient.ts` | empty → legacy flows run in stub mode. Never ship a real key in the bundle. |
| `USDA_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` | `scripts/*.ts` only | local one-off tooling; never bundled |

Supabase **function secrets** (set with `npx supabase secrets set`): `GEMINI_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`.
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform. The Gemini key was once pasted into a chat —
rotating it was recommended.

After changing any `EXPO_PUBLIC_*` value: restart Metro with `--clear` (values are baked into the bundle).

## 2. Database

Migrations (`supabase/migrations/`, applied with `npx supabase db push` — Alex runs/approves it):

| Migration | Contents |
| --- | --- |
| `20260714010000_schema.sql` | 17 tables, helpers, `updated_at` triggers, `handle_new_user` (auth insert → minimal `public.users` row: id + email), `protect_user_columns` trigger |
| `20260714010100_rls.sql` | RLS on every table |
| `20260714010200_sync_constraints.sql` | natural keys: `(user_id, ingredient_name)` on kitchen/cart/planned; unique weight per user per day |
| `20260714010300_seed_premade_recipes.sql` | 6 placeholder premade recipes with fixed UUIDs (`constants/premadeRecipes.ts`), 5 marked free in `premade_recipe_access` |
| `20260717010000_delta_sync.sql` | `updated_at` + triggers on weight/saved/kitchen/cart, `(user_id, updated_at)` indexes, `server_now()` RPC |
| `20260718010000_plan_sync.sql` | `plan_day_meals.recipe_name` + `recipe_ref`, `plan_slots.updated_at`, delta indexes |
| `20260726010000_consume_free_scan.sql` | `consume_free_scan(p_user_id)` security-definer RPC, atomic `UPDATE … WHERE free_scans_remaining > 0` |
| `20260731230000_macro_food_options.sql` | `macro_proteins`, `macro_carbs`, `macro_fats` (unique `lower(name)`; authenticated read, admin write) |
| `20260802010000_macro_food_familiarity_score.sql` | `familiarity_score smallint` 0–100 on the three macro tables |

**Tables (17 core):** `users` (profile; `free_scans_remaining` default 5; `subscription_status` ∈
`free|trial|active|expired|cancelled` default `free`; `subscription_provider`, `subscription_expiry_date`), `plans`
(partial unique index: one active per user), `plan_slots`, `plan_day_meals` (`day_of_week` 0–6 **Mon=0**, nullable
`recipe_id`, `is_day_override`), `recipes` (`user_id` null = premade; `is_premade`, `source`, `has_full_recipe`),
`recipe_ingredients`, `recipe_steps`, `saved_recipes` (`is_bookmarked`), `meal_logs` (`servings`, `is_completed`,
`is_ad_hoc`, `health_rating`, `image_url`), `meal_log_ingredients`, `kitchen_items`, `cart_items`,
`planned_ingredients`, `weight_logs`, `progress_daily` (unique user+date; not synced yet), `premade_recipe_access`
(`is_free`), `ai_usage_log`. Plus the 3 macro tables.

Conventions: UUID PKs, `timestamptz` UTC, text + CHECK instead of enums, **every FK to `auth.users` cascades on delete**
(verified Aug 23 — that's why `delete-account` only needs `auth.admin.deleteUser`). No Supabase Storage is used.

**RLS:** owner tables `user_id = auth.uid()`; child tables check via parent; premade recipes readable by all, writable
by admin only; `ai_usage_log` insert/select own rows only; `users` select/update own row (`id = auth.uid()`).
Admin = `public.is_admin()` reading `app_metadata.is_admin` (Alex's account is admin).
**`protect_user_columns`** reverts client writes to `free_scans_remaining` and `subscription_*` unless admin/service role.
To test the paywall/free tier, edit your own `users` row in the Table Editor (service role bypasses the trigger):
`subscription_status='free'` + `free_scans_remaining=0` → paywall; `'active'` → Pro on the server side.

Users: delete test accounts from **Authentication → Users** (cascades), not from the Table Editor.
Known gap: `public.users.email` is set only at signup; there's no trigger syncing later auth email changes.

**Macro food data** (Build My Plan picker + Foods to Avoid): curated lists in the live tables —
103 proteins, 78 carbs, 37 fats (Aug 5), each with a Gemini-scored `familiarity_score` (global, not US-centric).
Scripts: `npm run import:macro-foods` (USDA FDC SR Legacy + Foundation, historical), `npm run cleanup:macro-foods`
(name cleanup; run `--dry-run` first), `npm run score:macro-familiarity`. Rules: meat/poultry/fish/eggs/dairy
(incl. cheese) are always **Proteins**; Fats = oils, butter, margarine, lard, ghee, nuts, nut butters, seeds, avocado,
coconut; no prepared dishes/desserts/baked goods/baking ingredients; don't pad lists; counts via `.length`, never by hand.
**Never write to these live tables without Alex reviewing the list first.**

## 3. Offline-first sync (`lib/sync/`)

The Zustand store is the source of truth on device. A **projector** subscribes to store changes, diffs synced slices by
content hash, and enqueues writes into a durable **per-user outbox**; the **engine** drains it to Supabase only when
there's a session, network, and a hydrated store. UI never waits on sync.

- Files: `uuid.ts` (`newId`, `isUuid`), `units.ts` (store is metric; DB stores value+unit), `types.ts`, `mappers.ts`
  (store ↔ rows; protected columns never pushed), `repository.ts` (`pushItem`, `pullSince`), `outbox.ts`
  (coalesces by `entityKey` — including replacing dead-lettered duplicates; exponential backoff; dead-letter after
  `MAX_ATTEMPTS = 5`; `resetBackoff()` on reconnect), `projector.ts`, `engine.ts` (`TABLE_DRAIN_PRIORITY` drains
  `saved_recipes` before `plans` because of the `plan_day_meals.recipe_id` FK; retries scheduled at the soonest backoff
  clamped 1–30s; an enqueue listener drains within ~1s), `SyncProvider.tsx` + `useSyncStatus()`.
- **Reconcile modes:** `claim` (new account on this device → `enqueueAll`), `switch` (different user → full pull,
  `enqueueMissing`), `same` (delta pull from cursor). Cursor key `sync:lastPulledAt:${userId}`, captured via
  `server_now()` *before* pulling. `sync:lastUserId` is kept across logout on purpose (clearing it would flip to `claim`
  and upload a wiped store over the server copy).
- **Conflicts:** last-write-wins with a dirty guard (local wins while a write for that entity is pending);
  `applyServerSnapshot` union-merges and never clears. **Cache-first:** the app renders local data immediately; the gate
  depends only on hydration + auth, never on the network.
- **Sign-out order:** stop projector → best-effort flush → `signOut()` → clear delta cursor → `resetUserData()`.
  The outbox is **never** cleared on sign-out (pending writes sync on next login). Verified sessions log out instantly;
  never-verified accounts get a hard warning ("…never been backed up… Log out & erase").
- `flush()` captures `uid` once, verifies the session matches via `getSession()`, and stops if the user changes mid-loop
  (fixed a mass-RLS-violation bug during rapid logout/login).
- **What syncs:** profile → `users`, meals → `meal_logs`(+ingredients), weight, saved recipes (+ingredients/steps),
  grocery items by section, user plans (`savedPlans` with `source:'user'`) → plans/slots/day_meals with `is_active`.
  **Local-only:** water, streak, `templates[]` (runtime copy of the active plan), grocery extras (`struckThrough`,
  `mealNames`, `weekStart`, `hasSeenTip`, `cartOldWeekItems`), `onboardingComplete`, seed/demo data (`seed:true`).
- **Known limits:** single-device model — hard deletes don't propagate across devices (needs `deleted_at` tombstones);
  premade plan's active state doesn't roam (fix idea: `users.active_plan_name`); active plan pointer is name-based
  (`profile.activePlanName`) and `renameSavedPlan`/`removeSavedPlan` don't update it.
- Sync status icon (`components/SyncStatusIcon.tsx`, Home header): invisible during normal fast syncs; shows only when
  a write is pending > 15s (`STUCK_THRESHOLD_MS`) or dead-lettered; hidden while offline.
- Debug helpers: `[sync] push failed — <table>.<op>` logs, `retryFailedWrites()`, `debugOutbox()`,
  `[sync:pull] full|delta … total=…ms hasProfile=…` timing logs.

## 4. Auth

- `lib/supabase.ts`: AsyncStorage session, PKCE, `detectSessionInUrl:false`, auto-refresh tied to AppState.
- `lib/auth.tsx`: `signUpWithEmail` (detects "already registered" via empty `identities` → "Log in instead"; always
  saves `profile.email` locally; when verification is needed sets `pendingEmailVerification` and stores the password in
  `expo-secure-store` via `lib/pendingCredentials.ts`), `signInWithEmail`, **`verifySignupOtp(email, code)`**
  (`verifyOtp` type `signup`), `resendVerificationEmail` (friendly rate-limit message + retry seconds), `signOut`,
  `sendPasswordReset` (→ `mealapp://auth/reset`), `updatePassword`, `exchangeCodeFromUrl` (deep-link PKCE code; has
  debug logs). `AuthProvider` also: syncs RevenueCat identity to the Supabase uid; clears pending verification +
  stored password once a confirmed session appears; silent re-auth on foreground while unverified (15s throttle).
- **Signup confirmation = 6-digit code** (`components/auth/EmailCodeVerification.tsx`, `textContentType='oneTimeCode'`,
  60s resend cooldown). Shown inline after signup in onboarding ("I'll verify later" allowed — local-first) and at
  `/auth/verify-code` from the Home banner. Switched from tap-the-link because email providers prefetch and burn the
  one-time link, and `Linking.useURL()` missed URLs during foreground transitions.
  **Dashboard requirement:** the *Confirm signup* template must include `{{ .Token }}`. OTP expiry lives in the
  dashboard (default 3600s); `supabase/config.toml` auth settings have drifted from the hosted project
  (it says `enable_confirmations=false`) — the dashboard is authoritative.
- **Gate** (`app/(tabs)/_layout.tsx`): enter tabs only when store hydrated + auth resolved + `onboardingComplete` +
  (session or `pendingEmailVerification`); otherwise `router.replace('/onboarding')` (skipped while already on onboarding,
  which prevented a Welcome-screen flash during login).
- **Login flow:** full-screen "Signing you in…", `await engine.onSignIn(userId)` directly, `confirmLoginData` watches for
  the profile to land (`restored|empty|timeout`, ~20s bound). `onboardingComplete` is set only when real profile data
  exists — `hasProfile()` currently means `!!profile.firstName` (**deferred fix:** widen to "users row exists"; affected
  `chukwudi.can@gmail.com` whose row had null first_name/email — patched to `first_name='Friend'`).
- **Apple / Google sign-in:** buttons scaffolded, show "coming soon". Need dev build + Apple Developer + Google OAuth client.
- **Delete account:** `app/settings/account-delete-confirm.tsx` → password re-check via `signInWithEmail` (verified to
  have no side effects) → `lib/deleteAccount.ts` → `delete-account` function (`auth.admin.deleteUser`, cascades) →
  `signOut`, `clearPendingPassword`, `useEntitlementStore._reset()`, `resetUserData()`, `router.replace('/onboarding')`.
  Warns that it does **not** cancel an Apple subscription (button → Manage Subscription). Re-signing up with the same
  email creates a new uid → Pro must be reclaimed via Restore Purchases.
- Redirect URLs that must be allow-listed in the dashboard: `mealapp://auth/callback`, `mealapp://auth/reset`.
  A signup 500 `unexpected_failure` on Aug 18 was never root-caused (DB trigger ruled out; suspect: redirect allow-list).

## 5. Edge functions

All in `supabase/functions/`, all **deployed** (Oct 9 check). `verify_jwt=true` except `revenuecat-webhook`.

### Shared skeleton (`_shared/`)
`cors.ts` (`handlePreflight`), `errors.ts` (`errorResponse`, `jsonResponse`, body `{ error: { code, message } }`, codes
`invalid_input | unauthorized | not_premium (402) | rate_limited (429) | ai_failed | server_error`), `auth.ts`
(`createAdminClient`, `getAuthedUser`), `entitlement.ts` (`isEntitled` = status `active|trial`;
`resolveEntitlement(status, freeScansRemaining)`; `consumeFreeScan` RPC), `rateLimit.ts` (`isRateLimited`,
`logAiUsage` on `ai_usage_log` keyed by user + function name), `gemini.ts` (`callGeminiJSON`: structured JSON schema,
optional `images[]` placed before the text part, timeout via AbortController, **one retry after 500ms only on 429/503**,
never on timeout), `mealPromptHelpers.ts` (`buildUserContext`, `buildHardConstraints`, `buildStyleCues`,
`buildRatioInstruction`, `expandFamilyPicks`, `PROTEIN_FAMILIES`, `CARB_FAMILIES`).
The model is **not** shared: each of the 10 AI functions has its own `const GEMINI_MODEL = 'gemini-3.6-flash'`.

Order inside every AI function: preflight → POST only → `GEMINI_API_KEY` present → admin client → authed user →
sanitize/cap body → **in parallel:** load `users` row + rate-limit check → entitlement gate → rate-limit gate → Gemini →
on success only: `void logAiUsage(...)` (fire-and-forget) and **awaited** `consumeFreeScan` for non-subscribers
(kept blocking on purpose so two fast requests can't both slip past the last free scan) → `jsonResponse`.

### Functions

| Function | Gate | Limit | In → Out (summary) | Client wrapper / caller |
| --- | --- | --- | --- | --- |
| `estimate-nutrition` | free-scan pool | 30/h | text description → `meal_name, description, calories, protein, carbs, fats, meal_type, health_rating, ingredients[]` | `ai/estimateNutrition.ts` → AI tab (Describe) |
| `fix-meal` | free-scan pool | 30/h | `{fixText, currentDraft}` → full corrected meal (keeps correct values) | `ai/fixMeal.ts` → AI tab refine |
| `scan-meal` | free-scan pool | 30/h | `{imageBase64, mimeType}` (~10MB cap) → `meal_name, calories, protein, carbs, fats` (no ingredients) | `ai/scanMeal.ts` → ScanTab capture/upload |
| `scan-kitchen` | free-scan pool | 30/h | 1–4 images (~16MB total) → `ingredients[{name, category}]` (8 fixed categories) | `ai/scanKitchen.ts` → KitchenScanModal |
| `suggest-kitchen-recipes` | free-scan pool | 30/h | `kitchenItems[]` (≤60) → ~10 full recipes (incl. ingredients + steps) in ONE call; "Suggest More" reveals locally | `ai/suggestKitchenRecipes.ts` → What Can I Make |
| `generate-meal-suggestions` | free-scan pool | 30/h | `{mealType, count 1–8, cuisines, cookTime, loves, avoid, description}` → suggestions, category locked to mealType | `ai/generateMealSuggestions.ts` → Build My Plan Describe / swap top-up |
| `generate-plan-shortlist` | free-scan pool | 30/h | `{mealTypes[], proteins[], carbs[], fats[], cuisines, loves, avoid, cookTime, countPerType}` → `{[mealType]: suggestions[]}` (defaults 4 per main, 2 snacks). One call = one scan. | `ai/generatePlanShortlist.ts` → Build My Plan |
| `generate-recipe-concept` | free-scan pool | 30/h | `{description, mealType?}` → `name, description, calories, protein, carbs, fats` (no ingredients/steps) | `ai/generateRecipeConcept.ts` → Custom Recipe stage 1 + Fix |
| `generate-recipe-steps` | **subscription only** (`isEntitled`) | 30/h | concept (resent by client) → `ingredients[], steps[]` consistent with shown macros | `ai/generateRecipeSteps.ts` → Custom Recipe "Generate" |
| `recipe-assistant` | **subscription only**; AI recipes must already have steps | 60/min backstop (hidden) | `{recipeName, recipeSource, ingredients, steps, messages[]}` → `{reply}`; never consumes scans | `ai/recipeAssistant.ts` → recipe detail chat |
| `revenuecat-webhook` | shared secret in `Authorization` (raw, no "Bearer") | — | sets `subscription_status` | RevenueCat dashboard |
| `delete-account` | authed user (deletes self only) | — | `{success:true}` | `lib/deleteAccount.ts` |

Timeouts are ~15–25s server-side; client `INVOKE_TIMEOUT_MS = 35000` (must stay above server timeouts). A gateway 404
surfaces as "This AI feature is not available yet" = function not deployed.

**Deploy** (only with Alex's OK): `npx supabase functions deploy <name>`; webhook with `--no-verify-jwt`.
Changing `_shared/*` → redeploy every importer. Changing `constants/entitlements.ts` → redeploy `revenuecat-webhook`.

### Prompt rules (decided with Alex — keep them)
- **Tiers:** hard constraints (allergies, dietary preference, the **avoid list — same weight as allergies**) always
  apply; style cues (cuisines, loved foods) are *light flavor only* — `buildRatioInstruction` makes only ~1 in 3–4
  suggestions lean on them (e.g. "Exactly 1-2 of these 5"), constant ratio, no escalation; cook time is a barely
  perceptible tie-breaker; a user description is the dominant instruction (drops conflicting style cues, never hard constraints).
- **Build My Plan:** protein/carb/fat picks are the dominant signal. Umbrella expansion (`expandFamilyPicks`):
  Chicken/Beef/Pork/Turkey (hardcoded member arrays — never string-matched, Pork includes Bacon/Ham) and Potato
  (Russet/Red/Golden). Umbrella only → expand, favour high-familiarity members; umbrella + specific cut → lean to the cut;
  specific cut only → locked to it. Meal names must use the actual cut. **Sweet Potato is never grouped with/substituted for Potato.**
- **Custom Recipe (`generate-recipe-concept`):** the typed description is the complete, exact request. Name it
  "based only on what the user actually described — do not invent a cuisine style, sauce, or flavor descriptor".
  No stored preferences (cuisines/loves) are injected. (Bug history: "rice and ground chicken" → "Teriyaki…" was caused
  by the word "appetising" in the prompt.) "Snack bowl" outputs came from `mealType=Snacks`.
- Server reads profile (diet, allergies, goal, calorie target) itself; clients also re-apply allergy/vegetarian filters
  as defense in depth.

## 6. Entitlements, paywall, RevenueCat

- **Entitlement id:** `'MealApp Pro'` — only in `constants/entitlements.ts` (`PRO_ENTITLEMENT_ID`), imported by
  `store/useEntitlementStore.ts` and the Deno webhook. (It was `'Pro'` in two hardcoded places → purchases "did nothing".)
- **Offering** `Default`, packages `monthly` ($14.99) and `yearly` ($49.99). Prices are always read live from the
  offering (never hardcoded).
- `lib/purchases.ts`: `configurePurchases()` (module load in `_layout`), `syncPurchasesIdentity(userId)` (`logIn` with
  Supabase uid; `logOut` guarded by `isAnonymous()`), `fetchProPackages`, `purchasePackage` (throws
  `PurchaseCancelledError` on cancel), `restorePurchases`, `showManageSubscriptions()` (Apple's native sheet; returns
  false on failure → alert fallback; unsupported on Android), CustomerInfo listener → `useEntitlementStore` (not persisted).
- **Paywall** `app/paywall.tsx`, opened only via `openPaywall({ reason, headline?, onSuccess? })` (`lib/paywall.ts`):
  `scan_limit` headline "You've used all 5 free AI scans."; `premium_feature` uses the trigger's headline
  ("Unlock the full recipe with Pro", "Chat with the Recipe Assistant is a Pro feature", "Unlock Build My Plan with Pro",
  "Upgrade to Macrotri Pro" from Settings/Profile). Benefits list, Yearly selected by default with a computed "% off"
  badge; **Yearly's biggest text must be "$49.99 billed annually"** with the per-month equivalent visibly smaller
  (App Store compliance — a competitor was removed for the reverse). Monthly plain. Button "Get Macrotri Pro",
  Restore Purchases (Apple requirement), auto-renew fine print, Terms/Privacy links (placeholders), X to close —
  **never a hard paywall**. On success: refresh entitlement → close → run `pendingResume` (the original action continues).
- **Server status via webhook:** INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, PRODUCT_CHANGE, NON_RENEWING_PURCHASE,
  TRANSFER → `active` (+ provider, expiry). EXPIRATION → `expired`. CANCELLATION / BILLING_ISSUE → no change
  (access lasts until expiry). Always 200, idempotent. Accepted race: briefly after purchase the server may still say `free`.
- **Client-only Pro gates** (`lib/entitlements.ts`): Build My Plan **activation**, and **View Full Recipe**
  (`recipeRequiresPro`: `ai` → Pro; `manual` → free; `premade` → Pro unless `isFree`; first 2 per category are free =
  8 of 60 — Alex should pick these deliberately). Locked recipe view still shows calories/macros as a teaser.
  Note: DB `premade_recipe_access.is_free` (5 of 6 placeholders) is not what the client uses.
- **Free tier:** core tracking free forever; 5 free AI scans total, shared by all "free-scan pool" functions, consumed
  only on success; recipe steps + assistant are Pro-only.

## 7. Builds & releases

- Dev build required (RevenueCat, dev client). `eas.json` profiles: `development` (dev client, internal), `preview`,
  `production` (autoIncrement, remote app version). EAS project id `ce4ad983-d675-482b-83d6-9eccb1288a16`.
- Before App Store: production Supabase project, production RevenueCat key + App Store Connect products under
  `com.alex.mealapp`, real Terms/Privacy, custom SMTP for auth emails (built-in sender is heavily rate-limited), Apple
  Sign-In if any social login ships, account deletion (done), Export My Data (Settings shell), app name/icon.
