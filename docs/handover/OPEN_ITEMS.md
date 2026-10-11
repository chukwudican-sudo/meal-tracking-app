# Open items — everything known to be unfinished (as of Oct 11, 2026)

Grouped by urgency. "Manual" = Alex must do it in a dashboard/device; Claude can only give exact steps.
Nothing here is approved for building yet — per the working rules, discuss and agree first.

## A. Do first (risk of losing work / blocking tests)

**Done Oct 9–11, 2026** (kept short for the record):
- ~~Commit + push~~ — pushed as `bdf879c` (backend), `dafd090` (app), `6f4ec0c` (handover docs). The repo is
  **public** (Alex chose to keep it public for his resume), so scan for secrets before every commit.
  `docs/handover/chat-history/` is gitignored and exists only on this laptop.
- ~~Confirm signup template~~ — contains `{{ .Token }}` (checked in the dashboard).
- ~~6-digit signup test~~ — passed on the iPhone with `chukwudi.can+test1@gmail.com`. "I'll verify later" path not
  re-tested.
- ~~Delete-account test~~ — passed. The account was removed from both Authentication → Users and `public.users`.
- **Signup 500 (Aug 18): not reproduced.** Signup works now, and Redirect URLs contains `mealapp://auth/callback`
  and `mealapp://auth/reset`. Most likely the redirect URL was added after Aug 18. Site URL is still
  `http://localhost:3000` (harmless for the code flows; set a real value before launch).
- **Password reset rebuilt as a 6-digit code** (`/auth/forgot-password`: email → code → new password → safe sign-out →
  log in). Two bugs found on the way: (1) the tabs login gate bounced every `/auth/*` route back to `/onboarding`, so
  Forgot password was unreachable while logged out (fixed in `app/(tabs)/_layout.tsx`); (2) the old reset link spun
  forever (it can't be opened on another device because of PKCE, and `useURL()` misses it) — `/auth/reset` is kept
  only for old link emails, now with a `getInitialURL` fallback and a 15s timeout. Tested end-to-end.
  **Dashboard requirement:** the *Reset password* email template must contain `{{ .Token }}` (done for the dev project).

Still open:
1. **OTP expiry value** (Authentication → Providers → Email; default 3600s) — never read from the dashboard.
   Local `config.toml` is NOT the live setting.
2. **Custom SMTP appears to be configured** — the reset email came from `Macrotri <hello@macrotri.com>`, not
   Supabase's default sender. Confirm in Authentication → Emails → SMTP Settings, then close item 15 below.
3. **The recipe list saved on the phone always overrides `RECIPE_SEED`** (`store/useMealStore.ts` merge:
   `recipes: p.recipes ?? current.recipes`). Effects: seed updates (20 → 60 recipes, `isFree` flags) never reach
   existing installs, and Alex's phone shows a duplicate-key warning for `rcp-dn-beef-tacos` (the seed itself has no
   duplicates in any commit, so the stored list came from an older dev build). The fix touches persisted-store
   loading — plan it with Alex first.
4. **Delete `/auth/reset` before launch** (old link emails only; its "done" state routes to `/(tabs)`, which the gate
   bounces to onboarding while logged out).
5. Worth checking: the sync engine's `claim` mode (device with no `sync:lastUserId`) uploads local profile/goals over
   the server copy. A normal login on a fresh install hits this too — confirm a fresh-install login can't overwrite a
   real profile with defaults.

## B. Paywall / RevenueCat

6. **Manual — RevenueCat webhook** configured in RevenueCat dashboard → Integrations → Webhooks pointing at
   `https://kpmxjufzggcapljhxutv.supabase.co/functions/v1/revenuecat-webhook` with the Authorization header matching the
   `REVENUECAT_WEBHOOK_SECRET` Supabase secret. Then test: purchase in Test Store → `public.users.subscription_status`
   flips to `active`; cancel/expire → `expired`. Never verified end-to-end.
7. Restore Purchases flow test; re-signup after delete gets a new user id → old subscription needs Restore (understood
   and accepted by Alex, no code change).
8. Remove debug `console.info/log` before release: `app/paywall.tsx` (10), `lib/purchases.ts` (6),
   `app/auth/callback.tsx` (3), `lib/auth.tsx` (3), `lib/sync/engine.ts` (2), `ai/aiEdgeClient.ts` (1),
   `lib/sync/repository.ts` (1). Some were added on purpose for the purchase-chain and deep-link debugging.
9. Choose the 8 free premade recipes (`isFree` on 8 of 60 in `constants/recipeSeed.ts` — current picks were the agent's).
10. Android: no Play Console yet; `Purchases.showManageSubscriptions()` is iOS-only (Android needs the Play URL).

## C. Launch blockers (App Store)

11. **App name** — one decision, then sweep: `constants/app.ts` `APP_NAME='AppName'` / `APP_LOGO='🌱'`,
    `app/onboarding.tsx` local `APP_NAME='NutriTrack'`, paywall "Macrotri Pro", `app.json` name/slug `meal-app`.
12. Real **Terms / Privacy URLs** (`app/paywall.tsx` `TERMS_URL`/`PRIVACY_URL` = `https://example.com/...`) + the Settings
    Help shells. Apple requires both on the paywall.
13. **Production RevenueCat**: App Store Connect subscription products under `com.alex.mealapp` (monthly $14.99, yearly
    $49.99), attach to the `Default` offering + `MealApp Pro` entitlement, swap `EXPO_PUBLIC_REVENUECAT_API_KEY` from the
    Test Store key to the `appl_` key.
14. **Production Supabase project** (separate from dev `kpmxjufzggcapljhxutv`): run the 9 migrations, set secrets
    (Gemini, RevenueCat webhook, USDA if scripts run there), deploy 12 functions, seed `macro_*` tables, copy Auth
    settings (template with `{{ .Token }}`, redirect URLs, rate limits).
15. **Custom SMTP** (Supabase's built-in mailer is rate-limited and lands in spam).
16. **Sign in with Apple** (required if Google sign-in ships) + Google sign-in (onboarding buttons say "coming soon").
    Before this, do item 17.
17. **`hasProfile()` widening** (deferred by Alex Aug 18: "Hold … for a separate pass, not tonight"). Currently the
    login gate checks `!!profile.firstName` after the pull (`app/onboarding.tsx`, `lib/sync/repository.ts`); should check
    that a `public.users` row exists. Ask before doing it.
18. App icon, splash, screenshots, App Store listing, privacy nutrition labels (camera, photos, mic, health-ish data).
19. **Rotate the Gemini API key** (it was handled in plaintext during setup). Manual + `npx supabase secrets set`.
20. `expo-av` (~16.0.8) is deprecated → migrate the voice recording to `expo-audio` before SDK 55.
21. Expo dependency drift — run `npx expo install --check` and review (with approval) before the production build.

## D. Unfinished features / known bugs

22. **Legacy OpenAI client** (`ai/aiClient.ts`, no key, effectively broken) still backs:
    `components/addMeal/ScanTab.tsx` re-evaluate (also has a `file://` URI bug — must send base64 like `scan-meal`),
    barcode lookup, voice/Whisper transcription (`AITab.tsx`), `components/MealDetailModal.tsx` Fix,
    `components/addMeal/FixResultScreen.tsx`. Migrate each to an edge function (`fix-meal` already exists for text fixes).
23. `scan-meal` returns no ingredients list; scanned photo is stored only as a local URI (no Supabase Storage).
24. AI Describe tab spinner is tiny/barely visible.
25. Cold start feels slow (never profiled).
26. `compressPhoto` resizes by width (1280) — tall photos stay huge; should resize the long edge.
27. Build My Plan macro-picker defaults (min picks, "Step 1 of 2" label) were agent choices Alex never confirmed.
28. `cleanList` in `ai/generatePlanShortlist.ts` (client) silently caps proteins/carbs/fats picks at 15 each (cuisines
    20) before calling `generate-plan-shortlist` — a user who picks more loses the extras without being told.
29. Re-test `generate-recipe-concept` anti-embellishment (it used to add ingredients the user never mentioned).
30. `public.users.email` doesn't follow an email change in Auth.
31. Sync limits: no tombstones for some deletes (deleted on one device can reappear from another), premade active plan
    doesn't roam between devices, renaming the active plan doesn't update `activePlanName` everywhere,
    `progress_daily` / water totals aren't synced.
32. `supabase/config.toml` has drifted from the live dashboard (auth block) — either update it or note it's unused.
33. 3 pre-existing tsc errors (`app/profile.tsx:63`, `hooks/useRecipeActions.ts:100,119`).
34. Dead code to delete (confirm first): `components/EditMealScreen.tsx`, `components/DayDetailModal.tsx`,
    `components/grocery/PlannedIngredientsSection.tsx` (none are imported anywhere — only mentioned in comments),
    `app/meal/[id].tsx`, `app/modal.tsx`, `app/auth/callback.tsx` once no old signup links can be outstanding
    (password reset uses `app/auth/reset.tsx`, not callback — re-check before deleting).

## E. Deferred product features (ideas Alex has mentioned; not specced enough to build)

Cook Mode (guided cooking, timers, chef avatar) · meal reminder notifications (`expo-notifications` not installed;
settings UI exists, default 15 min before) · Find Your Plan guided questions + "Try Build My Plan instead" bridge ·
post-onboarding "build your plan" popup polish · onboarding visual design pass · Report Food backend · Feedback backend ·
Export Data · Language · Data Consent · calorie filter in recipe lists · juicing / more meal categories · budget and
regional grocery pricing · cart history · configurable grocery refresh day · kitchen search + quantities · seasoning
check · social sharing · streak badge / extra nutrient circles on Home · weight-check reminders · random facts ·
profile photo · premade plans managed from the backend instead of `constants/planSeed.ts`.
