# Open items — everything known to be unfinished (as of Oct 9, 2026)

Grouped by urgency. "Manual" = Alex must do it in a dashboard/device; Claude can only give exact steps.
Nothing here is approved for building yet — per the working rules, discuss and agree first.

## A. Do first (risk of losing work / blocking tests)

1. **Commit + push.** Last commit `08add76` (Jul 24, "Add AI features (estimate-nutrition, fix-meal, scan-meal) via
   Edge Functions"; before it `27a74ea` Jul 18 and `15a0ccb` Jul 17).
   Everything after — paywall, RevenueCat, 9 edge functions, migrations 7–9, Build My Plan redesign, delete account,
   OTP verification, macro-food scripts, this handover — exists only on this laptop. `.env` is gitignored (good).
   Before pushing, decide whether `docs/handover/chat-history/` should be committed (contains his personal email and
   5 months of raw messages; keys are redacted). Run `git status` first and review untracked files.
2. **Manual — Supabase Auth email template.** Dashboard → Authentication → Email Templates → **Confirm signup** must
   contain `{{ .Token }}` (the 6-digit code). Without it the code screen can never succeed. Note the OTP expiry
   (Authentication → Providers → Email; default 3600s) — Alex asked for the value on Aug 23 and it was never confirmed
   from the dashboard. Local `config.toml` (`enable_confirmations=false`, `otp_expiry=3600`) is NOT the live setting.
3. **Manual — end-to-end test of the 6-digit signup** on the iPhone with a fresh email: sign up → code arrives →
   enter → session + sync → onboarding continues. Also "I'll verify later" → Home banner → `/auth/verify-code`.
   Resend cooldown is 60s client-side (`RESEND_COOLDOWN_SECONDS`), server limit is the dashboard rate limit.
4. **Manual — delete-account test** (Alex's 6-step script, Aug 23 #440 in chat-history; never completed because Metro
   was down). Wrong password rejected → correct password → warning → deleted → back to onboarding start → row gone from
   both `auth.users` and `public.users`.
5. **Signup 500 (`unexpected_failure` from `/auth/v1/signup`, Aug 18)** —    root cause never confirmed. Already ruled out:
   the `handle_new_user` trigger (tested in a rolled-back transaction; every NOT NULL column has a default). Leading
   suspect: `redirect_to=mealapp://auth/callback` missing from Authentication → URL Configuration → Redirect URLs.
   Other candidate: the built-in mailer failing to send. The OTP switch still sends `emailRedirectTo`, so this matters. Check Supabase Auth logs for request id `01a01610-cb6a-7667-ba93-cf02db634d11` if still
   retained; otherwise reproduce and read the logs. Confirm signup now works before anything else auth-related.

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
