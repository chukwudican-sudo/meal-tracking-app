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
- ~~OTP expiry~~ — 3600s (1 hour), read from the dashboard Oct 11. Local `config.toml` is NOT the live setting.
- ~~Stored catalogs overrode the seed~~ — fixed Oct 12: `recipes`/`plans` are excluded from persistence
  (`partialize`) and always loaded from `RECIPE_SEED`/`PLAN_SEED`. Root cause of the `rcp-dn-beef-tacos`
  duplicate-key warning: the Aug 17 bundle-id change gave a fresh install whose first launch saved the seed while it
  still had the duplicate (fixed in the seed Aug 19, but the saved copy always won). Verified on the iPhone: warning
  gone, 15 recipes per category.
- ~~Scan screen rebuilt (Oct 12)~~ — full-bleed camera per Alex's reference: X / ? (tips sheet), Scan Food · Barcode ·
  Food label tiles, .5x/1x (iOS ultra-wide lens when present), flash, shutter, photo-library button (Upload mode and
  flip-camera removed). Freezes on the tapped frame (`pausePreview`) and shows the still photo while analysing.
  Fixed a native crash after every successful scan (children inside `CameraView`).
- ~~Food label~~ — `scan-meal` accepts `mode: 'label'` (reads per-serving label values; no readable label → clear
  `invalid_input` message, no free scan charged). **Deployed to dev Oct 12** (`npx supabase functions deploy scan-meal`).
- ~~Fix had no memory (Oct 20–22)~~ — "it's just 150g of rice" wiped a chicken-and-rice scan down to rice. Now scan-meal
  also returns the items it saw (grams; never shown on the scan card), Fix sends them plus every earlier correction,
  and logging saves them as the meal's ingredients so a Fix from the meal popup later keeps context. fix-meal is
  "AI decides, code calculates" (see CLAUDE.md). All three Fix buttons use the real `fix-meal` (old stub gone).
  Toasts inside Add Meal / Kitchen scan / meal popup were rendering behind the modal — fixed (ToastHost in each).
- ~~AI speed~~ — scan-meal/fix-meal on Gemini thinking `low`: scan ~2.6–3s, fix ~1.6s (competitors 2–5s).
- ~~Meals added never counted (Oct 22–28)~~ — eaten/planned rule, groceries only from planned meals, heatmap scores the
  plan only, plan activation no longer deletes the user's eaten/own meals, Cart no longer wipes their planned
  ingredients, adding to an unopened future day keeps its plan meals, swaps never overwrite the user's meals.
- ~~No way to stop a plan~~ — End plan (+ goals restore). Plans start on activation day (past days used to fill).
  Already back-filled test meals aren't auto-removed: sync drops the meal→template link, so they're indistinguishable
  from real history.
- ~~Customize broken~~ — swaps were discarded (stale draft read); Save didn't apply / didn't save Explore plans. Fixed,
  plus Undo on every swap.
- ~~Barcode logged per-100g as one serving~~ — now per serving (or labelled 100 g/ml), kJ fallback, 10s timeout,
  untrusted-data validation, product saved as the meal's item.
- ~~AI history~~ — `ai_events` table (migration `20261022010000`, pushed to dev) records every scan/fix for analysis.
- ~~Paywall hidden behind modals~~ — scan-limit paywall from Scan / AI describe / Kitchen scan opened behind the RN
  Modal. Fixed with `PaywallModalHost`; after purchase the scan retries on the same photo. Verified on the iPhone.
- ~~Custom SMTP (dev)~~ — on; emails are sent as `Macrotri <hello@macrotri.com>`. The production project needs the same.

Still open:
1. **Delete `/auth/reset` before launch** (old link emails only; its "done" state routes to `/(tabs)`, which the gate
   bounces to onboarding while logged out).
2. Worth checking: the sync engine's `claim` mode (device with no `sync:lastUserId`) uploads local profile/goals over
   the server copy. A normal login on a fresh install hits this too — confirm a fresh-install login can't overwrite a
   real profile with defaults.

## B. Paywall / RevenueCat

6. **Manual — RevenueCat webhook** configured in RevenueCat dashboard → Integrations → Webhooks pointing at
   `https://kpmxjufzggcapljhxutv.supabase.co/functions/v1/revenuecat-webhook` with the Authorization header matching the
   `REVENUECAT_WEBHOOK_SECRET` Supabase secret. Then test: purchase in Test Store → `public.users.subscription_status`
   flips to `active`; cancel/expire → `expired`. **Verified end-to-end Oct 11** with `+test2`: the RevenueCat test
   event returned 200 (Authorization matches), the purchase flipped the row to `active`, renewals advanced
   `subscription_expiry_date`, and the final expiry flipped it to `expired` about a minute later. Test Store
   subscriptions renew every 5 min (monthly) up to 5 times, then expire on their own — there is no way to cancel early.
7. Restore Purchases flow test; re-signup after delete gets a new user id → old subscription needs Restore (understood
   and accepted by Alex, no code change).
8. Remove debug `console.info/log` before release: `app/paywall.tsx` (10), `lib/purchases.ts` (6),
   `app/auth/callback.tsx` (3), `lib/auth.tsx` (3), `lib/sync/engine.ts` (2), `ai/aiEdgeClient.ts` (1),
   `lib/sync/repository.ts` (1). Some were added on purpose for the purchase-chain and deep-link debugging.
9. Choose the free premade recipes — currently 12 of 60 (3 per category) have `isFree` in `constants/recipeSeed.ts`; the
   picks were the agent's, not Alex's.
10. Android: no Play Console yet; `Purchases.showManageSubscriptions()` is iOS-only (Android needs the Play URL).

## C. Launch blockers (App Store)

11. ~~App name~~ — **Macrotri** (Oct 12). All UI reads `APP_NAME` from `constants/app.ts`; `app.json` name updated
    (home-screen name needs a new dev build). Still a placeholder: `APP_LOGO='🌱'` (replace with the real icon).
12. Real **Terms / Privacy URLs** (`app/paywall.tsx` `TERMS_URL`/`PRIVACY_URL` = `https://example.com/...`) + the Settings
    Help shells. Apple requires both on the paywall.
13. **Production RevenueCat**: App Store Connect subscription products under `com.alex.mealapp` (monthly $14.99, yearly
    $49.99), attach to the `Default` offering + `MealApp Pro` entitlement, swap `EXPO_PUBLIC_REVENUECAT_API_KEY` from the
    Test Store key to the `appl_` key.
14. **Production Supabase project** (separate from dev `kpmxjufzggcapljhxutv`): run the 9 migrations, set secrets
    (Gemini, RevenueCat webhook, USDA if scripts run there), deploy 12 functions, seed `macro_*` tables, copy Auth
    settings (template with `{{ .Token }}`, redirect URLs, rate limits). Both email templates (*Confirm signup*,
    *Reset password*) must contain `{{ .Token }}`.
15. **Custom SMTP** — done on dev (`hello@macrotri.com`); set it up again on the production project.
16. **Sign in with Apple** (required if Google sign-in ships) + Google sign-in (onboarding buttons say "coming soon").
    Before this, do item 17.
17. **`hasProfile()` widening** (deferred by Alex Aug 18: "Hold … for a separate pass, not tonight"). Currently the
    login gate checks `!!profile.firstName` after the pull (`app/onboarding.tsx`, `lib/sync/repository.ts`); should check
    that a `public.users` row exists. Ask before doing it.
18. App icon, splash, screenshots, App Store listing, privacy nutrition labels (camera, photos, mic, health-ish data,
    **and "user content used for analytics"** — the `ai_events` log).
18b. **AI history privacy** (before launch): privacy-policy line ("we use your AI inputs to improve accuracy"), and a
    scheduled clean-up deleting `ai_events` rows older than 90 days (pg_cron).
18c. **Active plan is identified by name** (`activePlanName`) — two plans with the same name confuse isCurrent /
    login restore. Store an id instead (touches sync: `plans.is_active`).
18d. **"Missed" doesn't sync** (server only stores is_completed) — on another device/reinstall past missed meals show
    as not eaten. Needs a status column.
18e. Single-device assumption: ending a plan on one phone doesn't remove it on another (pull ignores a null pointer).
18f. **Barcode coverage (launch):** Open Food Facts misses many North American products (e.g. Diet Coke
    067000014451, verified Oct 28). Add the USDA FoodData Central branded-foods database as a fallback via an edge
    function (keeps the USDA key server-side). Lookup order: OFF → USDA → "try Food label" message.
19. **Rotate the Gemini API key** (it was handled in plaintext during setup). Manual + `npx supabase secrets set`.
20. `expo-av` (~16.0.8) is deprecated → migrate the voice recording to `expo-audio` before SDK 55.
21. Expo dependency drift — run `npx expo install --check` and review (with approval) before the production build.

## D. Unfinished features / known bugs

22. **Legacy OpenAI client** (`ai/aiClient.ts`, no key, effectively broken) still backs:
    `components/addMeal/ScanTab.tsx` re-evaluate (also has a `file://` URI bug — must send base64 like `scan-meal`),
    voice/Whisper transcription (`AITab.tsx`), `components/MealDetailModal.tsx` Fix,
    `components/addMeal/FixResultScreen.tsx`. Migrate each to an edge function (`fix-meal` already exists for text fixes).
23. Scanned photo is stored only as a local URI (no Supabase Storage). (Ingredient list: done Oct 22.)
23b. Small AI test set: turn real corrections from `ai_events` into cases re-run after every prompt change.
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
33. 3 pre-existing tsc errors (`app/profile.tsx:64`, `hooks/useRecipeActions.ts:100,119`).
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
