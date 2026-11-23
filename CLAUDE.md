# CLAUDE.md — Macrotri (meal app)

This file is loaded automatically at the start of every Claude Code session. It is the
single handover document for this project. It was written on **Oct 9, 2026** when the
project moved from Cursor to Claude Code, from: the full codebase, all 64 saved Cursor
plan files, and every message Alex sent across ~5 months of Cursor chats (May 6 → Aug 23, 2026).

Deeper material lives in `docs/handover/` — read the relevant file before touching an area:

| File | Read it when |
| --- | --- |
| `docs/handover/PRODUCT_SPEC.md` | Changing any screen / UX / copy. Feature-by-feature current spec + what was superseded. |
| `docs/handover/BACKEND.md` | Touching Supabase, sync, auth, edge functions, AI prompts, RevenueCat/paywall. |
| `docs/handover/OPEN_ITEMS.md` | Planning what to do next. Every known TODO, deferred item, risk, and manual step. |
| `docs/handover/HISTORY.md` | Debugging something that "was already fixed", or wondering *why* something is the way it is. Bugs + root causes, decision log. |
| `docs/handover/plans/*.plan.md` | The original 64 Cursor plan files (verbatim). Grep them for a feature name. |
| `docs/handover/chat-history/*.md` | Alex's verbatim messages from every Cursor chat. Grep when you need his exact words/spec. Later messages supersede earlier ones. |

---

## 1. Who / what

- **Developer:** Alex (GitHub `chukwudican-sudo`, test account `chukwudi.can@gmail.com`). Solo, non-expert on tooling,
  strong product opinions. Tests on a **physical iPhone** (dev build). Goal: ship to the App Store, later Google Play,
  scale multi-user.
- **App:** a dark-themed meal-planning + nutrition-tracking app. Core loop: open the app → see today's planned meals →
  tick them off → macros/rings update → streak/heatmap. Around that: weekly meal plans (Build My Plan / premade plans),
  recipes, a Kitchen inventory + Cart, AI meal scanning/estimation, AI recipe generation, and a Pro subscription.
- **Monetization:** 5 free AI "scans" (shared pool across AI features), then Pro via RevenueCat
  (Monthly $14.99 / Yearly $49.99, Test Store right now). Principle: **gate cost, not arbitrary features.**

## 2. Stack

- **Expo SDK 54**, React Native 0.81.5, React 19.1, **expo-router 6** (file-based routes in `app/`), TypeScript strict,
  New Architecture on, React Compiler on, typed routes on. Path alias `@/*` → project root.
- **State:** Zustand 5 + `persist` (AsyncStorage, **pinned `^2.2.0` — v3 breaks on Expo 54**). Main store
  `store/useMealStore.ts` (~1950 lines), persist key `meal-app-store-v2`, **version 6**.
- **Backend:** Supabase (dev project ref **`kpmxjufzggcapljhxutv`**, `https://kpmxjufzggcapljhxutv.supabase.co`).
  Postgres + RLS, email/password auth, 12 Deno edge functions. **Production** project **Macrotri-Prod** (ref
  `tmsydkqpskwcsrrbuqst`, same MealApp Pro org, West US Oregon, Micro) created Nov 12: all migrations applied and
  schema verified identical to dev; secrets, functions, auth settings, SMTP and the food tables are still TODO (see
  the roadmap). The repo stays **linked to dev**; target prod per command with `--remote=tmsydkqpskwcsrrbuqst`
  (`db push`, `functions deploy`, `secrets set`, read-only `db query --read-only`). **This CLI targets the LOCAL
  database unless told otherwise:** dev = `db push --remote`; always add `--skip-vault` (config.toml is stale) and
  `--dry-run` first.
- **AI:** Google Gemini **`gemini-3.6-flash`**, called only from edge functions (key is a Supabase secret).
  No client-side AI remains (the legacy OpenAI client was deleted Oct 28). Voice = the keyboard's own dictation;
  a dedicated on-device voice button is planned after launch.
- **Payments:** RevenueCat (`react-native-purchases`) → **requires a dev build; Expo Go can no longer run this app.**
- Other: expo-camera, expo-image-picker, expo-image-manipulator, expo-secure-store,
  expo-crypto, NetInfo, react-native-svg, datetimepicker, Ionicons/MaterialCommunityIcons via `@expo/vector-icons`.
- Bundle id / package: **`com.alex.mealapp`** (iOS + Android). URL scheme: `mealapp`. EAS project id in `app.json`.
  **App variants (Nov 14, `app.config.js`):** the dev build is a separate app, **"Macrotri Dev"** —
  `com.alex.mealapp.dev`, scheme `mealapp-dev`, own storage — when `APP_VARIANT=development` (set by the eas.json
  development profile and by `npm run dev`). Unset = the real app (preview/TestFlight/App Store). Both apps can be
  installed side by side; no deleting to switch.

## 3. Running it

```bash
cd /Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app   # the INNER meal-app folder (has package.json)
npm run dev                 # normal dev loop (= APP_VARIANT=development expo start --dev-client --scheme mealapp-dev; "Macrotri Dev" on the iPhone)
npm run dev -- --clear      # after changing .env (EXPO_PUBLIC_* is baked at bundle time) or weird cache issues
npm run dev -- --tunnel     # only when phone + Mac can't see each other (café Wi-Fi client isolation, hotspot)
```

- The repo root is **nested**: `MEALTRACKINGAPP/meal-app/meal-app`. Running Metro from the outer `meal-app` folder fails /
  serves a stale bundle — this has caused "my fix isn't showing" confusion before.
- **Which server a build talks to (Nov 13):** the dev client loads JS from Metro, so it uses the local `.env` (dev
  project). EAS builds can't see `.env` (gitignored) — they get `EXPO_PUBLIC_*` values from **EAS Environment
  variables** (expo.dev → project → Environment variables) for the profile's `environment` in `eas.json`:
  `development` → development, **`preview` → production** (installable release build for testing against prod before
  TestFlight), `production` → production. Without them `lib/supabase.ts` throws at launch.
  **RevenueCat key per build type:** the Test Store key (`test_…`) is ONLY for the dev client (`.env`). RevenueCat
  deliberately crashes any Release build (preview/TestFlight/App Store) configured with a Test Store key — the first
  preview build did exactly that (Nov 13). EAS production env uses the App Store key (`appl_…`, RevenueCat app
  "Macrotri (App Store)", In-App Purchase key GL2K58CPK4). Until the App Store subscriptions exist, release builds
  can't load plans (the paywall says so) — expected.
- New dev build: `npx eas-cli@latest build --profile development --platform ios` (plain `npx eas` fetches an
  unrelated npm package and fails; Alex runs it in his own terminal — it asks for Apple login/2FA) (or `npx expo run:ios` if Xcode is installed — it
  wasn't as of June). Needed whenever a native module/plugin/app.json native field changes.
- Checks before calling anything done: `npx tsc --noEmit` and `npm run lint`.
  **Both are clean (0 errors, 0 warnings) since Nov 14** — keep them that way; any new error is yours.
  Debug logging: no step-by-step `console.info` traces; timing logs only under `if (__DEV__)`.
  Don't trust editor lint panels alone — once they reported 0 errors on a file with 30 real type errors.
- Supabase CLI: `npx supabase ...` (already logged in + linked on this Mac). `supabase/config.toml`: only its `[functions.*]`
  blocks are live (deploy reads verify_jwt); the rest is local-stack defaults — **never `supabase config push`** (it would
  turn email confirmation off and drop the redirect URLs on a live project). Compare with `config diff`. `supabase/functions` and `scripts/` are
  excluded from the app tsconfig (they're Deno / Node).

## 4. Repo map

```
app/                     expo-router routes
  (tabs)/                index (Home) · plan · recipes · progress   (+ custom tab bar with the "+" button)
  _layout.tsx            root Stack: providers + EVERY non-tab route registered here (see conventions)
  onboarding.tsx         full onboarding step machine (welcome → data → account → results → activation) + login
  auth/                  verify-code (6-digit signup OTP — the real signup path) · forgot-password (6-digit reset code).
                         The old link pages (reset, callback) were deleted Nov 21: all four auth emails are code-only.
  plan/                  build.tsx (Build My Plan wizard, ~3250 lines) · find.tsx (Find Your Plan: 5 questions → matching premade plans) · [id] (plan detail / Current Plan / Customize) · day/[date] (Day Detail) · category/[type]
  recipe/                [id] (preview) · detail/[id] (full recipe) · assistant/[id] (Recipe Assistant chat, slides up)
  recipes/               saved (unified recipe page) · category/[type]
  ai/                    custom.tsx (Custom Recipe: concept → steps) · what-can-i-make.tsx
  meal-edit/             macro/[key] · ingredient/[id]   (push routes on top of MealDetailModal, driven by mealEditSession)
  profile.tsx, profile/  edit-goal · personal-details · dietary · nutrition-goals
  settings.tsx, settings/ account · account-delete-confirm · notifications · help · feedback · coming-soon
  paywall.tsx            thin route for the one reusable Pro paywall (UI in components/paywall/; open ONLY via lib/paywall.ts#openPaywall)
  cart.tsx, kitchen.tsx, grocery/planned-ingredients.tsx, notifications.tsx
components/              MealDetailModal, MealForm, MealCard, CustomTabBar, Screen, ProgressRing, ProgressiveLoader,
                         SyncStatusIcon, EmailVerificationBanner, Toast/Undo hosts, addMeal/* (Scan/AI/Manual/Search tabs),
                         recipes/* (SavedRecipesView, RecipeCard…), plans/*, grocery/KitchenScanModal, auth/EmailCodeVerification, onboarding/* pickers
store/                   useMealStore (everything), types.ts, useEntitlementStore, usePaywallStore, useToastStore, useUndoStore
lib/                     supabase.ts, auth.tsx, purchases.ts, paywall.ts, entitlements.ts (client Pro gates), deleteAccount.ts,
                         macroFoodOptions.ts, pendingCredentials.ts, media/compressPhoto.ts, sync/* (offline-first engine)
ai/                      aiEdgeClient.ts (shared invoke + AIError) + one wrapper per edge function
constants/               theme.ts (COLORS), entitlements.ts (PRO_ENTITLEMENT_ID — shared with Deno!), recipeSeed (60 recipes),
                         planSeed, premadeRecipes (seeded UUIDs), goalCalc, onboardingCalc, ingredientCategories, nutrients, app.ts
supabase/                migrations/ (9), functions/ (12 + _shared/), config.toml, README.md (deploy + dashboard steps)
scripts/                 one-off Node/tsx scripts for the macro-food tables (USDA import, name cleanup, Gemini familiarity scoring)
utils/                   mealRating.ts (Good/Okay/Poor), mealSlots.ts
docs/                    smart-meal-capture spec/slices (May), handover/ (this migration)
```

## 5. Hard rules — how Alex wants to work (read twice)

These come straight from months of his feedback. Violating them is the #1 thing that frustrates him.

1. **Agree before building.** "Do not implement anything unless decision made, that's a rule." For anything beyond a
   trivial fix: investigate → explain → propose a plan with the decisions he needs to make → wait for "go". Use Plan
   mode for big work. He often sends long numbered specs; restate your understanding with a concrete example if
   anything is ambiguous, and **ask questions** ("ask me questions if anything is unclear"). If he says "do whatever
   modern apps do" / "your call", decide — and say what you chose.
2. **Rough ideas are not orders.** He drops ideas mid-message; don't build them unless asked.
3. **Root cause first, with evidence.** "I want to know the cause before any fix is attempted." Show the *real* error /
   log / query result, not a guess or the UI fallback message. Confirm logging code is actually running. When he asks
   for literal text (a prompt, a config), **paste it verbatim — never summarize.** Count things programmatically
   (`.length`), never by hand. Verify his hypotheses honestly; say plainly if he's wrong.
4. **Never touch live/external state without explicit approval:** no `supabase functions deploy`, `db push`, writes to
   live tables, secrets changes, git commit/push, EAS builds, or package installs until he says so. Show the exact
   command first. Never `sudo`, `brew`, or install global tools (e.g. `gh`) on your own.
5. **Data safety is sacred.** "Signing out should never discard unsynced data." Prefer low-risk, proven patterns over
   schema/sync changes ("avoids touching the sync layer we spent significant effort hardening").
6. **Scope discipline.** When he says "hold that for a separate pass", "not tonight", "don't touch X", respect it.
   When a fix touches an area he didn't mention (login gate, sync, entitlement), flag it first.
7. **Single source of truth.** Duplicated constants caused real bugs (entitlement id drift). Extract shared values.
8. **Fixes must be global and stick.** He hates page-by-page patches for app-wide issues, and hates when a previously
   specced thing silently wasn't implemented. When you finish a spec, check every item was actually done.
9. **No silent failures, no infinite spinners.** Every failure path gets a clear message; long waits get a timeout.
10. **Commit reminders:** remind him to commit + push only at *major* milestones (full feature, finished multi-step plan,
    schema/migration change, big refactor) — not after routine fixes. He usually pushes from his own terminal.
11. **Ops instructions must be exact and simple.** Give the literal command / exact dashboard click path. He'll often say
    "just do it for me" for safe local things (starting Metro, reading logs) — fine to do those.
12. Don't create new markdown/README files unless asked (this handover was explicitly requested).
13. He will paste the same spec twice sometimes — check whether it's already built before redoing it.

## 6. Code conventions (match these)

- **New full-screen page:** add the file under `app/` AND register it in `app/_layout.tsx` with `fullScreenSlide`
  (`presentation:'card'`, `animation:'slide_from_right'`, no header). Every page slides in from the right. Intentional
  overlays keep their own animation: the "+" Add Meal screen (RN `Modal`, slides up), MealDetailModal, Fix popups,
  scan half-sheet, toasts, alerts, `paywall` + `auth/verify-code` (modal, slide_from_bottom), the Recipe Assistant
  (card + slide_from_bottom: a native modal would cover the root toast/AI-consent hosts).
- **Safe areas:** wrap pages in `components/Screen.tsx` (uses `useSafeAreaInsets`), not `SafeAreaView`. Footers use
  `Math.max(insets.bottom, 16) + 16`; tab pages leave ~96px bottom padding for the tab bar. Nothing may be jammed
  against the bottom edge or render above the notch.
- **Theme:** use `COLORS` from `constants/theme.ts` — bg `#0F0F0F`, card `rgba(255,255,255,0.04)`, elevated/border
  `0.08`, textSecondary `0.5`, textMuted `0.3`, green `#4ade80` (primary/success), red `#f87171`, blue `#60a5fa`,
  orange `#fb923c`, purple `#a78bfa`. **Modal sheets/popups must be opaque**: use `#1C1C1C` (`OPAQUE_SHEET_BG`), never
  `COLORS.card` (it's see-through). Icons: Ionicons (bookmark = `bookmark`/`bookmark-outline`); no unicode glyphs.
- **Zustand:** select one field per hook (`useMealStore(s => s.logs)`), never the whole store; never return a fresh
  `[]`/`{}` from a selector (infinite render loop) — return `undefined` and fall back to a module-level constant.
- **Persisted store changes:** every new field needs a default in `persist.merge` (deep-merge pattern already there);
  structural changes need a `version` bump + `migrate`. Old persisted profiles crashing on missing fields is a real past bug.
  Read-only app content (`recipes`, `plans` catalogs) is excluded via `partialize` and always comes from the seed files —
  never persist bundled content, or installs freeze on their first-launch copy (a real past bug, fixed Oct 12).
- **IDs:** anything that syncs uses `newId()` (UUID, `lib/sync/uuid.ts`). Non-UUID ids like `meal-123` or
  `${date}-scan-${ts}` broke sync before (Postgres `invalid input syntax for type uuid`).
- **Dates** `YYYY-MM-DD` local (parse with `'T00:00:00'`), times `HH:mm` 24h. Plan days are **Mon=0**; JS `getDay()`
  is Sun=0 — convert with `(d+6)%7` / `(d+1)%7` (a past off-by-one bug).
- **Navigation from inside an RN `Modal`** (AddMealScreen, MealDetailModal): close/hide the modal before `router.push`,
  or the pushed route renders behind it. Large data (base64 photos) can't go through router params — keep it in
  component state or a transient store slot (`pendingRecipeConcept`, `pendingSwap`, `customizeDraft`, `mealEditSession`,
  `usePaywallStore.pendingResume` — all reset on launch, never synced).
- **Undo/toasts:** destructive actions → `useUndoStore.showUndo` (5s, latest only, global). Plain info → `useToastStore`.
  Standard copy: "Added to Today", "Added to Saved Recipes" / "Removed from Saved Recipes", "Added to Cart", "Moved to Kitchen".
- **Paywall from inside an RN `Modal`:** mount `<PaywallModalHost active={visible} />` inside the modal (done for AddMealScreen,
  KitchenScanModal). While a host is active, `openPaywall` shows the paywall on top of the modal instead of pushing
  `/paywall`, which would land behind it (a real past bug: the scan-limit paywall was invisible).
  **After a purchase/restore (Nov 12):** the paywall calls `usePaywallStore.succeed(syncSubscriptionWithServer())`
  — the `sync-subscription` edge function asks RevenueCat's REST API directly and saves Pro, so the retried AI call
  isn't refused while the webhook is still on its way — and the blocked action runs once, via
  `lib/paywall.ts#runPendingSuccess`, after the paywall has fully closed AND the sync finished. `openPaywall` never
  shows the paywall on a phone that already has Pro (Alert + Restore instead). Rapidly re-presenting/dismissing the
  paywall RN Modal left an invisible layer that froze the app. The webhook handles TRANSFER (restores move Pro).
- **Logo screen (Nov 22):** `app/_layout.tsx` keeps the native splash up (`preventAutoHideAsync`) until the first real
  screen can show: the tabs gate hides it, onboarding hides it on mount (a logged-out cold start unmounts the tabs),
  CrashScreen hides it, and a 5s timer caps it. A new first screen outside these must hide it too.
- **`CameraView` must stay childless** — render overlays as absolutely-positioned siblings. Children inside it crashed the
  app on iOS (New Architecture) when the camera unmounted after a scan; expo-camera itself warns about it.
- **AI calls from the client:** always via an `ai/<function>.ts` wrapper on `invokeAIFunction` (35s client timeout).
  **AI permission (Apple 5.1.2, Nov 10):** `invokeAIFunction` first awaits `lib/aiConsent.ts#ensureAIConsent` (sheet
  `components/AIConsentHost`, answer on `profile.aiConsent`/`aiConsentAt`, synced as users.ai_consent/_at; Settings →
  Privacy & AI). "Not now" throws code `consent_declined`: every catch returns early on `isAIConsentDeclined(e)`.
  **The server checks it too (Nov 19):** all 11 AI functions select `ai_consent` and return `consent_required` (403)
  unless it's true (`_shared/aiConsent.ts`) — a new AI function must do the same. So the answer is written to the
  account the moment it's given (`setAIConsent` → `saveAIConsentToServer`, used by the sheet and Settings), and
  `invokeAIFunction` re-saves + retries once on `consent_required` when this phone says yes.
  **Any new RN Modal that can start an AI request must mount `<AIConsentHost active={visible} />` inside it** (like
  PaywallModalHost), or the sheet would open hidden behind the modal.
  Error handling everywhere: `not_premium` → `openPaywall({ reason:'scan_limit' | 'premium_feature', onSuccess: retry })`;
  `rate_limited` / `ai_failed` / `unauthorized` → toast with the server message. Long waits → `ProgressiveLoader`.
- **Edge functions:** follow the shared skeleton in `supabase/functions/_shared/` (see BACKEND.md §4). The admin
  client uses the new **secret key named `default`** (`SUPABASE_SECRET_KEYS`, Nov 15) — never the legacy
  `SUPABASE_SERVICE_ROLE_KEY` (Supabase retires legacy keys ~early 2027). Never delete or rename the `default` secret
  key on either project: every function would return 500 "Server not configured". Profile data is
  always read server-side, never trusted from the client. **Editing anything in `_shared/` means redeploying every
  function that imports it** (each bundles its own copy). `constants/entitlements.ts` is imported by the Deno
  `revenuecat-webhook` via relative path (and, through `_shared/subscription.ts`, by sync-subscription and
  delete-account) — keep it dependency-free and redeploy those three if it changes.
- **Database grants — locked unless granted (Nov 12, migration `20261112010000_explicit_grants_auto_rls`):** new
  tables get NO automatic grants (Supabase's current default) and RLS is switched on automatically (`ensure_rls` event
  trigger). Every migration that creates a table must, in the same file: enable RLS, write its policies, and
  `grant` exactly the commands those policies allow to `authenticated` plus `select, insert, update, delete` to
  `service_role`. Nothing is granted to `anon`: any app read that can run without a session ("verify later"
  users) must check `supabase.auth.getSession()` first and return empty (done in `useInboxStore`,
  `lib/macroFoodOptions`). Every new function: `revoke all … from public, anon, authenticated`, then grant `execute`
  to the roles that need it (server-only RPCs: `service_role` only). Otherwise the app gets "permission denied".
- **AI quality log (`ai_events`):** six functions record every outcome (input, before/after, prompt version,
  latency, error) — scan-meal, fix-meal, fix-recipe, generate-recipe-concept, generate-recipe-steps and
  estimate-nutrition (Nov 15); the other five AI functions don't — via `_shared/aiEvents.ts#recordAiEvent` — private table (RLS, no policies), no photos, rows cascade
  on account delete and are **deleted after 90 days** by the nightly pg_cron job `ai-data-retention` (migration
  `20261115010000`, which also prunes `ai_usage_log` after 30 days). **Bump a function's `PROMPT_VERSION` on any prompt/schema change.** To analyse a test, read it
  with the secret key (`SUPABASE_SECRET_KEY`) from `.env` (read-only). Other AI functions can adopt it one at a time.
- **Gemini speed:** `callGeminiJSON({ thinkingLevel })` — scan-meal and fix-meal use `'low'` (scan 8.7s -> ~2.6s,
  fix 4.8s -> ~1.6s, accuracy held); unset = model default (medium). Gemini 3 uses `thinkingLevel`, not `thinkingBudget`.
  **estimate-nutrition stays on the default on purpose** (tested Nov 15, 12 meals x 3 rounds: 'low' was ~3x faster
  but counted mixed/larger plates 10-25% lower; a grams-first prompt didn't fix it). It records to `ai_events` now
  (`PROMPT_VERSION estimate-2026-11-15`), totals = sum of ingredients in code, and "small/large" = 0.75x/1.5x.
- **"AI decides, code calculates":** fix-meal's model only labels each item (`unchanged` / `amount` / `replaced` /
  `added` + `source_index`); `applyEdits` copies unchanged items verbatim, scales amount-only changes proportionally,
  and totals = sum of items. Don't let the model do arithmetic the server can do.
- **Meal ownership & status (one rule each, in `store/useMealStore.ts`):** `initialMealStatus(date, time)` — a meal the
  user adds for now/earlier/a past day is `completed` (counts at once), later/future is `pending` (planned).
  `isAdHoc` = the user's own meal (never auto-"missed", kept by plan changes, excluded from the heatmap's plan score).
  "Missed" is shown via `displayMealStatus(meal, date)` (planned + unticked + time passed), never saved: the server
  keeps only eaten / not eaten, so a saved 'missed' came back as planned and was re-uploaded on every open (removed
  Nov 22; Home redraws the cards with a fresh `now`). Stats only ever count `completed`.
  `isPlanTemplate(t)` (`tpl-plan-…` or the seed ids) tells plan templates from the user's own (scheduled recipes,
  draft-card repeating meals `tpl-${Date.now()}` — never match seeds by pattern). `isUserOwnedMeal` = what plan
  activation / End plan keep. Groceries (Planned Ingredients) only come from **planned** meals + the plan.
- **Plans:** start date = activation day (never fill past days). Activate = today keeps eaten/own meals, future days
  belong to the new plan (warns first, `lib/planActivation.ts`). `endPlan` clears plan templates + pointer (synced
  is_active=false) and restores `goalsBeforePlan` (saved when a plan's numbers overwrote goals).
  **Plan numbers (Nov 10): a plan is a fixed product you pick.** Its calories/macros are never typed — they're worked
  out from its meals × portions (`lib/planNutrition.ts#planNutrition`, store `planNutritionOf`, same resolver that builds
  the meals). Premade plans reach their calories with `servings` set per recipe in `constants/planSeed.ts` (quarter
  steps, 0.5–2×, next to each recipe; retuned Nov 18 so every day lands within ~±80 kcal of the plan's number; levels
  1,700–2,600 kcal; Keto days < 40 g carbs, Low Carb < 100 g — the check script enforces the range and carb limits).
  Sizing plans to the user's own calories is parked until
  after launch (work saved in `reports/Plan sizing WIP (parked Nov 18).patch`, local only). A plan
  with a `category` (premade, or a customized copy of one) sets the goals to those real numbers while running; built
  plans keep the user's goals. Plan meals/templates carry `servings`. A swap of a plan meal (Day Detail, or a slot in
  Customize) keeps the slot's CALORIES — the new recipe's portion = old kcal ÷ new kcal, quarter steps, 0.5–2×
  (`lib/planNutrition.ts#swapPortion`, Nov 18, Eat This Much-style); the user's own meals keep their multiplier. A day's swap replaces exactly the meal it was
  started on (`PendingSwap.mealId`; plan meals have no slotId); a recipe put into an empty slot is the user's own (`isAdHoc`). Customize
  Save = `saveCustomizedPlan`: premade → user's own copy "My <name>" (UUID, unique name), then re-applies from today.
  Placeholder slots `EMPTY_SLOT`/`REMOVED_SLOT` (`constants/planSlots.ts`) are never meals. The active plan is still
  matched **by name** (`activePlanName`) — known limitation.
- **Built-in recipe numbers (Nov 18):** each recipe in `constants/recipeSeed.ts` is ONE serving; its calories/macros
  are the sum of its ingredients from USDA FoodData Central (`scripts/recipe-nutrition/ingredients.json`: SR Legacy,
  in the form the recipe measures — raw, or canned/cooked where it says so; the stir-fry vegetable blend is FNDDS;
  curry paste has no USDA entry, label estimate). Never type them by hand: change an ingredient, then
  `npm run check:recipe-nutrition` (exits 1 on any mismatch; `-- --json` prints the computed values). The 6
  server-seeded premade recipe rows (`constants/premadeRecipes.ts`) got the new numbers by migration `20261119010000`
  (dev + prod, Nov 19) — a bookmarked one restored from the server reads them; change a recipe's numbers there too.
  Copies made before Nov 18 keep the old numbers: bookmarked built-in recipes (`savedRecipes`), an already-running
  premade plan's meals and goals, and "My <plan>" copies — pre-launch these exist only on test accounts.
- **Recipes:** one recipe page (`app/recipe/[id]`) for every recipe — `NutritionTiles` (big calorie tile + macro
  tiles, also on the full page), key ingredients (main foods first), footer Fix | View Full Recipe (Fix only on the
  user's own recipes, `isOwnRecipe`; built-in ones are reference content). Custom Recipe goes straight there: the idea
  call (`generate-recipe-concept`, free scans) returns ingredients, `addCustomRecipe` saves it to Recent (never merged by
  name). View Full Recipe writes steps from exactly those ingredients (`generate-recipe-steps`, Pro; server overwrites
  the returned list with the input). Fix = `useRecipeFix` → `fix-recipe` (free scans; no steps yet → ingredients/macros
  only; never renames). Fix memory is `recipeFixHistory` (local, not synced). Free users see ingredients + step 1.
  Swaps (picker + "Use this recipe") go through `lib/recipeSwap.ts#applyRecipeSwap`, which returns its Undo.
- **No demo content (Nov 13):** a new install starts like a clean account (`resetUserData`): no demo meals,
  history, library or streak. The old first-launch demo templates (`DEMO_TEMPLATE_IDS` tpl-1..5) made a new account
  upload 75 fake meals on the first production sign-up; persist v8 removes leftovers, and the projector never uploads a
  meal generated from them. Don't add sample data to the initial store — a new account uploads whatever is local.
- **Sync, first login on an install (`claim`):** if the server already has real profile data (`profileHasData`: name
  or any onboarding answer) and the phone has none, it RESTORES (local leftovers cleared, server wins, nothing local
  uploaded over it); otherwise (new account) local data is uploaded as before. Decided by server data, not onboarding timing (signup gets a session before answers are saved).
  Never upload local defaults over a server profile — that wiped real profiles before Oct 30.
- **Pull first, then fill days (Nov 19):** sync only sees changes made after its sign-in reconcile starts capturing,
  so anything that fills a day from the plan automatically (`resolveDayFromTemplates` on Home / Day Detail) waits for
  `useDayFillReady()` (lib/sync/SyncProvider: this account's download done, no session, or 5s). Filled at Home's
  mount before, launch-day plan meals were baselined as uploaded and never sent. Any new automatic store change at
  launch must wait the same way. Known gap (post-launch): plan meals get random ids per phone, so two phones filling
  the same day before either syncs make duplicates — fix with calendar-style ids (series + date).
- **Sync modules reload the whole app in dev (Nov 21):** a Fast Refresh of `lib/sync/*` left an orphan projector
  that turned a logout into server deletes (dev account wiped, restored from backup) — `engine.ts`/`projector.ts`
  now `DevSettings.reload()` on hot swap. Any new module-level singleton that subscribes to the store needs the same
  `module.hot.dispose`. Login does a full pull when the phone has no profile (a stale cursor can't rebuild it).
- **Settings/profile forms (`components/profile/FormPage`):** switches and choices save on tap (no button); typed
  forms pass `dirty` (`useIsDirty`) → green **Save** top-right, grey until changed, "Discard changes?" on leaving
  unsaved. `onSave` returns `false` when validation refuses. Only Feedback keeps a bottom button (Submit).
- **Notifications (`lib/notifications/`):** two features. *Meal reminders* = local notifications rebuilt from the store
  (`reminders.ts#computeReminders`: pending planned meals, rolling 7 days, cap 60 for iOS's 64 limit;
  diff-scheduled by `ReminderSync`, cancelled on logout). *Bell inbox* = `announcements` table (read-only to users)
  + Expo push to `push_tokens` (written only via `register_push_token`/`unregister_push_token` RPCs) by the
  `send-announcement` function (ANNOUNCE_SECRET, `scripts/send-announcement.mjs`; default = dev, `--prod` = production
  with `.env` PROD_ANNOUNCE_SECRET, dry-runs then asks for a typed "yes"); `PushSync` + `useInboxStore`
  (unread = newer than this phone's lastSeenAt). The inbox shows past announcements to every user, new ones included:
  delete a test announcement from production after testing. expo-notifications is loaded only via `getNotifications()` (older dev
  builds lack it and crash on import). RN has no `AbortSignal.timeout`: use `lib/timeoutSignal.ts`.
- **18+ and health-data consent (Nov 16, legal research in `reports/`, local only):** minimum age 18. The onboarding
  birthday wheel stops at 18 years ago (`lib/ageSignal.ts#latestAllowedBirthday`; profile age edit refuses <18). US
  law (Texas, California AB 1043 from Jan 1 2027) also requires asking Apple's age signal: `components/AgeGate.tsx`
  runs `checkAgeSignal()` once per install at launch — only when Apple says it's required (iOS 26.2+) or, if that
  can't be told, the App Store account is US; under 18 = the whole app is covered by an "adults only" screen
  (no exit button: App Review treats self-exit as a crash). Declined = not asked again on that install.
  Native code: the local Expo module `modules/age-signal` (DeclaredAgeRange + StoreKit storefront; entitlement
  `com.apple.developer.declared-age-range` in app.json — EAS can't enable it: tick "Declared Age Range" on BOTH App
  IDs at developer.apple.com). Builds are pinned to EAS image `macos-sequoia-15.6-xcode-26.2` (eas.json): the
  "is age assurance required here?" API needs the iOS 26.2 SDK; on Xcode 26.0 it compiles out and the app falls back
  to "App Store country = USA" — and dev/TestFlight builds report the sandbox storefront USA even for Canadians. No age is sent anywhere; only the install's outcome (`ageSignal:v1` = checked|minor)
  stays on the phone. Health-data consent: onboarding step `consent` (before the first health question, one
  "I agree" button; Lifesum/BetterMe pattern), saved as
  `profile.healthConsentAt/Version` → users.health_consent_at/_version; bump `HEALTH_CONSENT_VERSION`
  (constants/legal.ts) when that text changes.
- **Crash reporting (Sentry, Nov 14):** `lib/monitoring.ts` (imported FIRST in `app/_layout.tsx`) — errors only (no
  tracing, sessions, replay), no user id/email, console breadcrumbs dropped, URLs scrubbed of queries and UUIDs, device
  name dropped; org has IP storage off + default scrubbers + `email` as a sensitive field. App Store label: "Crash
  Data, not linked to you" — keep it true: never `Sentry.setUser`, never put ids/emails in `reportError(…, extra)`.
  Report unexpected failures with `reportError(error, 'where')` (network errors skipped, max 3 per kind per launch).
  `app/_layout.tsx` exports `ErrorBoundary = CrashScreen` ("Something went wrong — Try again"): React 19 render errors
  bypass Sentry's global handler, so this is what catches + reports them. Dev doesn't report unless
  `EXPO_PUBLIC_SENTRY_DEV=1`. EAS env: production has `EXPO_PUBLIC_SENTRY_DSN` + `SENTRY_AUTH_TOKEN` (secret, source
  maps); development has `SENTRY_DISABLE_AUTO_UPLOAD=true` (else the dev build fails). Sentry org `macrotri`, project
  `react-native` (US).
- **External data is untrusted** (Open Food Facts barcode lookups, AI output): validate numbers (finite, ≥0, capped),
  cap string lengths, timeouts on every network call.
- Comments: match the surrounding density; the codebase explains *why* (constraints, past bugs), not *what*.

## 7. Current state (as of Oct 30, 2026)

**Built and working (dev):** onboarding + email/password auth (6-digit code verification, "verify later" allowed),
offline-first sync of profile/meals/weight/recipes/grocery/plans, Home (rings, tick-off, Added tags, sync icon, verify
banner), Plan tab (calendar, Day Detail, Current Plan / Customize, Explore + Saved plans, Build My Plan AI wizard),
Recipes (search, What Can I Make (AI), Custom Recipe (AI concept → AI steps), unified Saved/Recent/Recipes page,
preview + full detail + AI recipe assistant), Progress (heatmap + weight chart), Kitchen (+ AI fridge scan), Cart,
Planned Ingredients, Profile/Settings (goal calculator, dietary, nutrition goals, meal slots, delete account),
Pro paywall + RevenueCat Test Store purchases + webhook, 5-free-scan funnel.

**All 12 edge functions are deployed and match local code** (verified Oct 9 via `npx supabase functions list`):
estimate-nutrition, fix-meal, scan-meal, scan-kitchen, suggest-kitchen-recipes, generate-meal-suggestions,
generate-plan-shortlist, generate-recipe-concept, generate-recipe-steps, recipe-assistant, revenuecat-webhook, delete-account.

**Git:** everything is committed and pushed (Oct 9–11). Remote: `origin` = `github.com/chukwudican-sudo/meal-tracking-app`,
branch `main`. **The repo is PUBLIC** (Alex keeps it public for his resume): scan for secrets before every commit, and
never commit `.env` or `docs/handover/chat-history/` (gitignored, local only).

**App name: Macrotri** (confirmed Oct 12). Single source `constants/app.ts` `APP_NAME`; `app.json` name = Macrotri (home-screen
name shows after the next dev build). Slug `meal-app`, scheme `mealapp`, bundle id `com.alex.mealapp` intentionally unchanged.

**Verified on device Oct 22–28:** meals count when added (eaten vs planned), End plan, plan start dates, goals
restore, Customize (swaps stick, Save applies, own copy of Explore plans), Undo on swaps.

**Verified on device Oct 12–22:** new Scan screen (Food label, tips, .5x, freeze-on-shot), paywall + toasts on top of
modals, Fix with memory (scan items -> logged meal's ingredients -> later Fix), exact fix maths, AI history log.

**Verified on device Oct 10–11:** 6-digit signup, password reset (now code-based, see OPEN_ITEMS §A), delete account,
RevenueCat webhook full lifecycle (purchase → `active`, renewals, expiry → `expired`). OTP expiry 3600s; custom SMTP on.

**Top open items** (full list in `docs/handover/OPEN_ITEMS.md`):
1. Both *Confirm signup* and *Reset password* email templates must contain `{{ .Token }}` (dev: done; prod: TODO).
2. Deferred by Alex: widen `hasProfile()` login gate from `!!profile.firstName` to "users row exists" (Apple/Google
   sign-in won't always give a name). He said "separate pass" — ask before doing it.
3. Launch blockers: publish the Terms/Privacy pages at the macrotri.com paths in `constants/legal.ts` (support@macrotri.com
   is live: Zoho Mail, Canada data center, Nov 17), production RevenueCat key + App Store Connect
   products under `com.alex.mealapp`, production Supabase project (+ its SMTP), Apple Sign-In (required by App Store
   when offering other social logins).

## 8. Claude Code quick reference (for Alex)

- **Plan mode** (discuss without editing): press **Shift+Tab** to cycle modes (normal → auto-accept edits → plan).
  Or just say "don't change anything yet, let's discuss."
- **Switch model:** `/model`. **Undo/rewind** to an earlier point: press **Esc twice** (or `/rewind`).
- **New topic / save context:** `/clear` starts fresh (this file reloads automatically). `/compact` summarizes a long session.
- **Two sessions** (one planning, one building) can run in two VS Code terminals in this folder at once — just don't let
  both edit the same files simultaneously.
- **Usage:** `/usage` (or `/status`) shows how much of the Max plan window is left.
