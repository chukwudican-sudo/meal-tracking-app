# History — timeline, bugs with root causes, decisions

Read this before "fixing" something that looks odd: most odd-looking code here exists because of a bug below.
Message numbers (`msg N`) roughly match the `## #N` headings in `chat-history/main-chat-may-oct-2026.md` (they can be
off by a few for May–June) — use the date and grep for a keyword to find the exact message.

## 1. Timeline

| When | What happened |
| --- | --- |
| May 4–9 | First chat: dashboard skeleton, product interview → 6-phase master plan (`plans/meal_app_product_plan_*`). Phase 1 UI copied a reference image (dark, green, "MEAL PLAN"). Global undo system. Tabs then: Today/Plan/Grocery/Library. |
| May 9–13 | Settings pass, Plan tab v1, heatmap ("perfect now", msg 45), Day Detail modal, Library chat → no Library tab, Database/Library toggle in Search. |
| May 19–25 | One unified Edit Meal screen; Grocery tab full build (Planned → Kitchen/Cart), then relocated off the tab bar (msg 106). |
| May 27–Jun 3 | Recipes tab (replaces Library), Profile & Settings, Plan tab full rebuild, Day Detail **page**, Build My Plan v1 → rework (msg 139 spec). |
| Jun 11–Jul 3 | Recipe preview → full detail redesign, Customize Plan, unified recipe page, meal detail popup v1 → v2, safe-area global fix, right-to-left transitions. |
| Jul 13 | What Can I Make design authority, onboarding spec (msg 213), plan activation data-flow bug. |
| Jul 14–20 | **Supabase Phase 1** (schema, RLS, auth) → **Phase 2 offline-first sync** (msgs 222–291). Commits `15a0ccb` (Jul 17), `27a74ea` (Jul 18). |
| Jul 20–24 | **Phase 3 AI**: `estimate-nutrition` pilot, shared `_shared/` helpers, `fix-meal`, `scan-meal`. Commit `08add76` (Jul 24) — **last commit**. |
| Jul 26–28 | Free-scan funnel fix, photo compression, `scan-kitchen`, `suggest-kitchen-recipes`, `generate-meal-suggestions`, prompt personalization rules, catalog to 60 recipes. |
| Jul 29–Aug 5 | Build My Plan redesign (macro picker → AI shortlist), USDA macro-food tables, two cleanup passes, familiarity score, curated lists, umbrella families, Foods to Avoid. |
| Aug 5–15 | `generate-recipe-concept`, `generate-recipe-steps`, `recipe-assistant`; latency pass; `ProgressiveLoader`; anti-embellishment prompt fix. |
| Aug 12–22 | Paywall + RevenueCat (Test Store), webhook, bundle id → `com.alex.mealapp` (Aug 17), entitlement id fix + shared constant. |
| Aug 18–23 | Signup 500, login-gate null name, delete account, deep-link failures → **6-digit OTP signup**. Last active work. |
| Oct 9 | Back after ~6 weeks; moving from Cursor to Claude Code (cost). This handover written; all 12 functions verified deployed. |

## 2. Bugs, root causes, fixes (grouped by area)

### UI / layout
- **Toasts pushed the whole screen down** and the tab bar off-screen (msg 101) → overlays must float: root `View flex:1`,
  snackbar absolutely positioned at `64 + safeAreaBottom`, `zIndex 9999`.
- **Titles rendering above the notch** on many pages (msgs 145–146). Alex: "a global fix, not a page-by-page fix."
  Adding `SafeAreaProvider` alone made it worse → added `initialMetrics={initialWindowMetrics}` + `components/Screen.tsx`
  (`useSafeAreaInsets`), replacing `SafeAreaView` everywhere. **New pages use `Screen`.**
- **Buttons jammed against the bottom edge** (Start Plan, Customize, Build preview…) → `Math.max(insets.bottom,16)+16`,
  tab pages `paddingBottom: 96`.
- **Customize Plan button squashed, text invisible** (msg 147): `flex: 1` on a button inside a column parent. Same style
  was shared by Start Plan / Confirm Plan — check shared styles when fixing one.
- **Filter chips ballooned into tall pills** (msg 170): horizontal `ScrollView` stretched vertically → `flexGrow: 0`.
- **Saved tab underline flicker** (msg 179): single sliding `Animated.Value`, `activeIndex` only on tap / momentum end.
- **"Weird signs"** (msg 41): unicode glyphs → use Ionicons.
- **Pages still sliding bottom-up** (Jul 1): `slide_from_right` is ignored under `presentation:'fullScreenModal'` →
  `presentation:'card'` (`fullScreenSlide` in `app/_layout.tsx`).
- **See-through modals** (Describe modal, scan result): `COLORS.card` is `rgba(255,255,255,0.04)` →
  `OPAQUE_SHEET_BG = '#1C1C1C'`.
- **AddMeal header too high inside RN `Modal`**: `useSafeAreaInsets` inside the modal.

### State / store
- **Infinite render loop** (May): selector returned `?? []` (new array each render) → return `undefined`, fall back to a
  module-level `EMPTY_*` constant.
- **Profile crash for old persisted profiles** (msg 112, `dietaryRestrictions` undefined) → deep-merge `persist.merge`.
  Every new persisted field needs a default there.
- **Rings didn't update on completion** (msg 203, re-flagged as "specified previously but not implemented"): per-field
  selectors + null-safe totals + a stale bundle from Metro run in the wrong folder; the *actual* cause (msg 212) was that
  all seed meals had 0 macros → deterministic name-derived macro backfill on rehydrate for all-zero meals.
- **Recurring-scope popup shown on first making a meal recurring** → `wasAlreadyRecurring` snapshot on open.

### Plans
- **"Meals in this plan" showed one meal** (Jul 3): `saveCurrentPlanAs` wrote `recipeId: 'custom'` for every meal →
  unique ids + dedupe by name for already-broken plans.
- **Meals created slots named after themselves**: `slotName: t.name` → derive slot from the meal time against profile
  slots; legacy meal-named slots re-homed; new slots only via "Add meal slot".
- **Customize day showed "no meals scheduled"** (msgs 148–149): routed to Day Detail (reads `logs`) while the draft lives
  in `draftPlan.days` → in-page day view that reads/writes the draft.
- **Confirmed plan appeared nowhere** (msg 214, Jul 13): Day Detail never built meals from templates
  (`resolveDayFromTemplates`), calendar had no marking, `activatePlan` didn't refresh days with logs, Planned Ingredients
  appended instead of replaced (`refreshGroceryWeek`), and the **weekday off-by-one** (plan Mon=0 vs JS Sun=0 →
  `(d+1)%7` / `(d+6)%7`).
- **AI/Describe meals showed 0 calories in Build My Plan** (Jul 26): `PlanDayMeal` stores only id + name; `custom-` ids
  missing from the catalog → `ensureRecipeSaved` on activation + seed preview from `sessionCardById`. Rejected adding
  nutrition to `PlanDayMeal` ("avoids touching the sync layer we spent significant effort hardening").
- **"Suggest more" went straight to AI** (Jul 28): catalog had 5/category but `INITIAL_SEED = 9` → catalog 15/category
  (60 total); comment records the sizing.
- **"AI meal planning is not available yet"** (Aug 4): gateway 404 = `generate-plan-shortlist` wasn't deployed.
- **Build My Plan half-migrated with 30 TS errors** (msg 362) after Cursor fell back to a weaker model mid-run. Alex:
  usage running out should stop, not downgrade the model.
- Duplicate seed recipe id `rcp-dn-beef-tacos` → second became `rcp-dn-beef-tacos-salsa`.

### Sync (Jul 15–20) — the most hardened area; don't change casually
- **Sign out → sign in lost a meal + weight** (msg 232): Log Out was a stub calling `resetUserData()` without
  `signOut()`; the running projector saw the wipe as deletes and pushed them; `onSignOut` cleared the outbox. Fix:
  never clear the outbox on sign-out; order = stop projector → flush → `signOut` → reset local cache.
- **4 writes stuck while online** (msgs 234–235): empty `catch` swallowed errors; dead letters never retried; real errors
  were `invalid input syntax for type uuid: "meal-1784…"` (ManualTab/AITab/EditMealScreen ids) and a `saved_recipes_pkey`
  duplicate (`onConflict:'id'`). Added `[sync] push failed` logging, `retryFailedWrites()`, `debugOutbox()`, dead-letter
  requeue on launch/login/foreground, `enqueueMissing`.
- **"Add your name" / empty screens after re-login** (msg 244): logout wiped data but kept the delta cursor → empty delta
  pull. Fix: clear the cursor on sign-out (keep `sync:lastUserId`); login gate requires real profile data.
- **"We couldn't load your account data" while online** (msg 249): gate waited for a sync transition that had already
  happened → login awaits `engine.onSignIn(userId)` directly; real error messages.
- **Bounced back through onboarding** (msg 263): `onSignIn` dedup race (await in-flight `reconcilePromise`) and re-signup
  with an existing email returning `identities: []` ("already exists" + "Log in instead"). Alex's ghost-account theory
  was wrong.
- **Welcome screen flashed after login** (msg 267): `(tabs)` gate redirected while onboarding was active →
  `useSegments` guard.
- **Stale error after a successful pull** (msg 277): `confirmLoginData` watches the store (`restored`/`empty`/`timeout`).
- **Mass RLS violations, `plans.clear_active: invalid uuid "null"`** (msgs 281–283): `flush()` re-read `this.userId`
  during logout/login cycling → capture uid once, verify session, abort if the user changes mid-loop.
- **~60s to sync after airplane mode** (msg 288) → `outbox.resetBackoff()` on reconnect.
- **One item stuck 30–45s** (msgs 289–290): plans depend on recipes (FK) → `TABLE_DRAIN_PRIORITY`, soonest-backoff
  scheduling (1–30s), drain on enqueue; sync icon only after 15s stuck or a dead letter, hidden offline.
- Persist versions: v3 UUID backfill → v4 heal meal ids → v5 heal plan ids → v6.
- Scan logs used `${date}-scan-${Date.now()}` ids (msg 317) → `newId()`.

### AI
- **"Stub mode — add an OpenAI key" after a 503** (msg 294): leftover `isStubAI` notice remounted by `Modal` → removed.
- **~60s hang before failing** (msg 296): no timeout → server `AbortController` + client backstop (now 35s client,
  because the client timeout was shorter than the 25s server Gemini timeout).
- **Zero free scans ever granted** (Jul 26): `free_scans_remaining` was never read; functions gated only on
  `isEntitled` → atomic `consume_free_scan` RPC (migration `20260726010000`), consumed only after Gemini succeeds.
  `consumeFreeScan` stays awaited even after the latency pass ("Speed isn't worth reopening that risk").
- **Photos never compressed** → `lib/media/compressPhoto.ts` (1280 wide, JPEG 0.6).
- **Custom Recipe embellishing** ("rice and beef" → "Garlic Beef and Jasmine Rice", Aug 14–15): the word "appetising" in
  the system prompt → prompt now says name it "based only on what the user actually described". Preference leakage was
  ruled out. Alex had to ask twice for the verbatim prompt.
- **Gemini model history:** `gemini-3.5-flash` (503 high demand) → `gemini-2.5-flash` ("no longer available to new
  users") → **`gemini-3.6-flash`**. Each of the 10 AI functions declares its own `const GEMINI_MODEL` in its
  `index.ts` — changing the model means editing all 10 and redeploying them.
- Macro-food data: Alex caught hand-typed counts that didn't add up → always count programmatically.

### Payments
- **"Pricing not available right now"** (msg 429): 401 Invalid API Key — the RevenueCat key in `.env` ended in zero
  instead of the letter O (the paywall plan file had the typo). Restart Metro after changing `EXPO_PUBLIC_*`.
- **"Test valid purchase" did nothing** (msgs 431–432): entitlement checked `'Pro'`, real id is `'MealApp Pro'`; webhook
  had the same mismatch → one constant in `constants/entitlements.ts` imported by both client and Deno.
- `Purchases.logOut()` fired on first launch for anonymous users → guarded with `isAnonymous()`.

### Auth
- **Blank page after tapping the verification link in Expo Go** — expected; needed a dev build.
- **Login gate: "pull completed, but no profile came back"** (msg 426): ids matched, RLS fine, but `first_name` and
  `email` were null → patched `first_name='Friend'`; `signUpWithEmail` now always stores the email locally. Widening
  `hasProfile()` deferred.
- **Signup 500 `unexpected_failure`** (msg 425): trigger ruled out; redirect allow-list suspected; unconfirmed.
- **"Verification failed, link missing its auth code"** + 2-minute stall (msgs 441–445): email providers prefetching and
  burning the one-time link, plus `Linking.useURL()` missing the URL during the foreground transition (added a
  `getInitialURL` fallback). Resolution: **6-digit code** (`verifyOtp` type `signup`) instead of links (msg 446).

## 3. Decision log (what was chosen, and what it replaced)

- Offline-first, last-write-wins, sync on launch/login only, no realtime, one device per user; metric internally.
- Local-first email verification: never hard-block entry; unverified users get a hard warning on logout only
  ("never been backed up… Log out & erase"). Verified users log out instantly (blocking warning was removed after
  research, msg 285).
- Seed/demo data never syncs (`seed:true`).
- Images go to Gemini as inline base64; no Supabase Storage (photo persistence deferred).
- One shared free-scan pool across scan-type features; Pro = `active`/`trial`. Gate cost, not features.
- Build My Plan: user picks real foods, AI shortlists, user's own picks rotate across the week — no AI variations,
  no meal-prep-vs-variety question.
- Cuisines/loved foods are light flavour (≈1 in 3–4 suggestions); avoid list = allergies; the typed description wins.
- Premade recipes: 8 of 60 free; AI recipes always Pro; manual recipes always free.
- Paywall: soft (X to close), live prices, yearly total biggest, resume the original action after purchase.
- Bundle id `com.mealapp.app` → `com.alex.mealapp` (Aug 17).
- Signup verification: link → 6-digit code; password reset still uses the `mealapp://auth/reset` link.
- Model fallback in Cursor was disabled at Alex's request; equivalent in Claude Code: just stop when usage runs out.

## 4. How Alex works (quotes worth remembering)

- "do not implement anything unless decision made, thats a rule from now on"
- "please always remember for us to agree on a conclusion before Implementation"
- "sometimes here and there ill drop rough ideas like these it doesnt mean implement imediately."
- "I want to know the cause before any fix is attempted." / "I want the real error message, not a guess."
- "Confirm the new logging code is actually running (not just written)"
- "copy-paste it, don't summarize it. This needs to actually happen this time."
- "output the count programmatically (literal .length …) rather than trust a written summary."
- "Don't write anything to the live tables yet. Show me … so I can review and strike anything out."
- "a global fix, not a page-by-page fix." / "This was specified previously but was not implemented"
- "reusing a proven, low-risk pattern is better than introducing schema/sync changes."
- "gated cost, not arbitrary features." / "free users get genuine, meaningful access … not a locked shell."
- "Hold … for a separate pass, not tonight." / "Not urgent, doesn't block anything — just worth fixing eventually."
- "wait i didnt say remind me that soon, i said when a major change." (commit reminders)
- "Do not run sudo. Do not install GitHub CLI. Do not run brew. Do not overdo it. Use normal git commands only. Before
  running commands, show me what you're about to run and wait for my approval."
- "its ios, just tell me what to do" — give exact commands and click paths.
- "I should start thinking before I prompt… discuss the requirements before building." (Oct 9)
