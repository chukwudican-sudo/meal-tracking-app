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
  Postgres + RLS, email/password auth, 12 Deno edge functions. A separate *production* project is planned before launch.
- **AI:** Google Gemini **`gemini-3.6-flash`**, called only from edge functions (key is a Supabase secret).
  A legacy client-side OpenAI stub (`ai/aiClient.ts`) still backs a few un-migrated flows (see OPEN_ITEMS).
- **Payments:** RevenueCat (`react-native-purchases`) → **requires a dev build; Expo Go can no longer run this app.**
- Other: expo-camera, expo-image-picker, expo-image-manipulator, expo-av (deprecated, migrate later), expo-secure-store,
  expo-crypto, NetInfo, react-native-svg, datetimepicker, Ionicons/MaterialCommunityIcons via `@expo/vector-icons`.
- Bundle id / package: **`com.alex.mealapp`** (iOS + Android). URL scheme: `mealapp`. EAS project id in `app.json`.

## 3. Running it

```bash
cd /Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app   # the INNER meal-app folder (has package.json)
npx expo start --dev-client          # normal dev loop (dev build already installed on the iPhone)
npx expo start --dev-client --clear  # after changing .env (EXPO_PUBLIC_* is baked at bundle time) or weird cache issues
npx expo start --dev-client --tunnel # only when phone + Mac can't see each other (café Wi-Fi client isolation, hotspot)
```

- The repo root is **nested**: `MEALTRACKINGAPP/meal-app/meal-app`. Running Metro from the outer `meal-app` folder fails /
  serves a stale bundle — this has caused "my fix isn't showing" confusion before.
- New dev build: `npx eas build --profile development --platform ios` (or `npx expo run:ios` if Xcode is installed — it
  wasn't as of June). Needed whenever a native module/plugin/app.json native field changes.
- Checks before calling anything done: `npx tsc --noEmit` and `npm run lint`.
  **Known pre-existing tsc errors (3, ignore unless fixing them on purpose):** `app/profile.tsx:64` (Alert.prompt param
  implicit any) and `hooks/useRecipeActions.ts:100,119` (implicit any + `RecipeInput.source` possibly undefined).
  Don't trust editor lint panels alone — once they reported 0 errors on a file with 30 real type errors.
- Supabase CLI: `npx supabase ...` (already logged in + linked on this Mac). `supabase/functions` and `scripts/` are
  excluded from the app tsconfig (they're Deno / Node).

## 4. Repo map

```
app/                     expo-router routes
  (tabs)/                index (Home) · plan · recipes · progress   (+ custom tab bar with the "+" button)
  _layout.tsx            root Stack: providers + EVERY non-tab route registered here (see conventions)
  onboarding.tsx         full onboarding step machine (welcome → data → account → results → activation) + login
  auth/                  verify-code (6-digit signup OTP — the real signup path) · forgot-password · reset (password-reset deep link)
                         · callback (old signup-link handler, kept untouched for any link still tapped)
  plan/                  build.tsx (Build My Plan wizard, ~3250 lines) · find.tsx (Coming soon shell) · [id] (plan detail / Current Plan / Customize) · day/[date] (Day Detail) · category/[type]
  recipe/                [id] (preview) · detail/[id] (full recipe + AI assistant chat panel)
  recipes/               saved (unified recipe page) · category/[type]
  ai/                    custom.tsx (Custom Recipe: concept → steps) · what-can-i-make.tsx
  meal-edit/             macro/[key] · ingredient/[id]   (push routes on top of MealDetailModal, driven by mealEditSession)
  profile.tsx, profile/  edit-goal · personal-details · dietary · nutrition-goals
  settings.tsx, settings/ account · account-delete-confirm · notifications · help · feedback · coming-soon
  paywall.tsx            thin route for the one reusable Pro paywall (UI in components/paywall/; open ONLY via lib/paywall.ts#openPaywall)
  cart.tsx, kitchen.tsx, grocery/planned-ingredients.tsx, notifications.tsx
  meal/[id].tsx, modal.tsx   legacy (meal/[id] orphaned add/edit form)
components/              MealDetailModal, MealForm, MealCard, CustomTabBar, Screen, ProgressRing, ProgressiveLoader,
                         SyncStatusIcon, EmailVerificationBanner, Toast/Undo hosts, addMeal/* (Scan/AI/Manual/Search tabs),
                         recipes/* (SavedRecipesView, RecipeCard…), plans/*, grocery/KitchenScanModal, auth/EmailCodeVerification, onboarding/* pickers
store/                   useMealStore (everything), types.ts, useEntitlementStore, usePaywallStore, useToastStore, useUndoStore
lib/                     supabase.ts, auth.tsx, purchases.ts, paywall.ts, entitlements.ts (client Pro gates), deleteAccount.ts,
                         macroFoodOptions.ts, pendingCredentials.ts, media/compressPhoto.ts, sync/* (offline-first engine)
ai/                      aiEdgeClient.ts (shared invoke + AIError) + one wrapper per edge function; aiClient.ts = legacy OpenAI stub
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
  scan half-sheet, toasts, alerts, `paywall` + `auth/verify-code` (modal, slide_from_bottom).
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
- **`CameraView` must stay childless** — render overlays as absolutely-positioned siblings. Children inside it crashed the
  app on iOS (New Architecture) when the camera unmounted after a scan; expo-camera itself warns about it.
- **AI calls from the client:** always via an `ai/<function>.ts` wrapper on `invokeAIFunction` (35s client timeout).
  Error handling everywhere: `not_premium` → `openPaywall({ reason:'scan_limit' | 'premium_feature', onSuccess: retry })`;
  `rate_limited` / `ai_failed` / `unauthorized` → toast with the server message. Long waits → `ProgressiveLoader`.
- **Edge functions:** follow the shared skeleton in `supabase/functions/_shared/` (see BACKEND.md §4). Profile data is
  always read server-side, never trusted from the client. **Editing anything in `_shared/` means redeploying every
  function that imports it** (each bundles its own copy). `constants/entitlements.ts` is imported by the Deno
  `revenuecat-webhook` via relative path — keep it dependency-free and redeploy the webhook if it changes.
- **AI quality log (`ai_events`):** scan-meal and fix-meal record every outcome (input, before/after, prompt version,
  latency, error) via `_shared/aiEvents.ts#recordAiEvent` — private table (RLS, no policies), no photos, rows cascade
  on account delete. **Bump a function's `PROMPT_VERSION` on any prompt/schema change.** To analyse a test, read it
  with the service key from `.env` (read-only). Other AI functions can adopt it one at a time.
- **Gemini speed:** `callGeminiJSON({ thinkingLevel })` — scan-meal and fix-meal use `'low'` (scan 8.7s -> ~2.6s,
  fix 4.8s -> ~1.6s, accuracy held); unset = model default (medium). Gemini 3 uses `thinkingLevel`, not `thinkingBudget`.
- **"AI decides, code calculates":** fix-meal's model only labels each item (`unchanged` / `amount` / `replaced` /
  `added` + `source_index`); `applyEdits` copies unchanged items verbatim, scales amount-only changes proportionally,
  and totals = sum of items. Don't let the model do arithmetic the server can do.
- **Meal ownership & status (one rule each, in `store/useMealStore.ts`):** `initialMealStatus(date, time)` — a meal the
  user adds for now/earlier/a past day is `completed` (counts at once), later/future is `pending` (planned).
  `isAdHoc` = the user's own meal (never auto-"missed", kept by plan changes, excluded from the heatmap's plan score).
  `isPlanTemplate(t)` (`tpl-plan-…` or the seed ids) tells plan templates from the user's own (scheduled recipes,
  draft-card repeating meals `tpl-${Date.now()}` — never match seeds by pattern). `isUserOwnedMeal` = what plan
  activation / End plan keep. Groceries (Planned Ingredients) only come from **planned** meals + the plan.
- **Plans:** start date = activation day (never fill past days). Activate = today keeps eaten/own meals, future days
  belong to the new plan (warns first, `lib/planActivation.ts`). `endPlan` clears plan templates + pointer (synced
  is_active=false) and restores `goalsBeforePlan` (saved when a premade plan's targets overwrote goals). Customize
  Save = `saveCustomizedPlan`: premade → user's own copy "My <name>" (UUID, unique name), then re-applies from today.
  Placeholder slots `EMPTY_SLOT`/`REMOVED_SLOT` (`constants/planSlots.ts`) are never meals. The active plan is still
  matched **by name** (`activePlanName`) — known limitation.
- **External data is untrusted** (Open Food Facts barcode lookups, AI output): validate numbers (finite, ≥0, capped),
  cap string lengths, timeouts on every network call.
- Comments: match the surrounding density; the codebase explains *why* (constraints, past bugs), not *what*.

## 7. Current state (as of Oct 28, 2026)

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
3. Launch blockers: real Terms/Privacy URLs (placeholders `example.com`), production RevenueCat key + App Store Connect
   products under `com.alex.mealapp`, production Supabase project (+ its SMTP), Apple Sign-In (required by App Store
   when offering other social logins), remove debug `console.info` logs (paywall, purchases, auth/callback, auth).

## 8. Claude Code quick reference (for Alex)

- **Plan mode** (discuss without editing): press **Shift+Tab** to cycle modes (normal → auto-accept edits → plan).
  Or just say "don't change anything yet, let's discuss."
- **Switch model:** `/model`. **Undo/rewind** to an earlier point: press **Esc twice** (or `/rewind`).
- **New topic / save context:** `/clear` starts fresh (this file reloads automatically). `/compact` summarizes a long session.
- **Two sessions** (one planning, one building) can run in two VS Code terminals in this folder at once — just don't let
  both edit the same files simultaneously.
- **Usage:** `/usage` (or `/status`) shows how much of the Max plan window is left.
