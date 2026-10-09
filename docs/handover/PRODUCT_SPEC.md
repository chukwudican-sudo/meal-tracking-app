# Product spec — current behavior, screen by screen

What each part of the app is *supposed* to do, as decided with Alex (May → Aug 2026). "Superseded" notes record
earlier versions so nobody resurrects them. When the code and this file disagree, check `chat-history/` for the
latest message on that topic, then ask Alex.

Product principles that apply everywhere:
- Feels like a habit, not a clinical tool. Dark, minimal, fast. Polished, professional, **visually distinct from
  Cal AI** even when using it as a reference. No "card inside a card".
- Empty states are productive (offer the next action), never dead ends.
- Buttons must be visually distinct so they aren't mis-tapped.
- Follow standard modern iOS patterns when unsure (push navigation, flat list pages).
- Meals are always named by the actual food ("Overnight oats"), never "Breakfast".
- Meals always sort by time, everywhere.
- AI never changes anything on its own — the user reviews and confirms.

---

## 0. Navigation shell

- **Tabs (left → right): Home, Plan, Recipes, Progress**, then a larger green **"+"** circle on the far right
  (`components/CustomTabBar.tsx`, `TAB_ORDER`). "+" is an action, never shown as selected; it opens the full-screen
  Add Meal overlay and the tab bar hides beneath it. App always opens on Home.
- **Top-bar icons:** Home & Progress → Profile + Notifications bell (+ sync icon on Home); Plan & Recipes → Profile + Cart
  (cart badge = unbought items; empty cart tap → "Nothing to buy right now."). Profile is a full page (not a tab), back
  arrow returns to the previous tab. Bell → `notifications` stub page.
- **Transitions:** every full page slides in from the right (iOS push). Overlays (Add Meal, meal popup, Fix popup,
  scan sheet, toasts, alerts, paywall) keep their own animation.
- Superseded: Today/Plan/Grocery/Library tabs; Settings gear modal; Grocery tab; Library tab; Progress-first tab order;
  `fullScreenModal` bottom-up pages.

## 1. Home (formerly "Today")

- Header "HOME". Day navigation with arrows (no swipe); week strip anchored to the viewed date's week (Mon–Sun);
  dots mark logged days (green = completed meal, grey = planned). Today's label/number green.
- Weekday/Weekend plan tag is **orange** (blue was tried and reverted).
- Summary: big calories consumed ("of 2200 kcal"), % done, P/C/F with goals, water (8 circles, 250 ml each).
  Totals count **completed meals only**. Uses one Zustand selector per field (fixed a "rings don't update" bug).
- Meal cards: tap the **circle** to complete (strikethrough + rings update); tap anywhere else → **MealDetailModal**.
  Cards no longer expand inline. Missed = 3px red left bar + "missed" badge (auto-missed for *today only*, on foreground
  and date change); completed = 1.5px green border.
- **"Added" tag** (muted grey, permanent) on any meal added outside the plan (from "+", Day Detail add, etc.).
  Ad-hoc meals still count, sort by time, and are editable/removable.
- Meal completion happens **only on Home** (Day Detail shows a display-only check).
- Email verification banner → "Enter verification code" → `/auth/verify-code`. Dismissible per app session.
- Persistent "Build your first meal plan" nudge when onboarding chose "I'll do this later"; stays until a plan exists.
- Streak: consecutive days with ≥1 completed meal; before today's first completion it counts from yesterday.
- Ideas not built (from Alex, not orders): extra nutrient circles / "see more", streak badge, weight-check popups,
  random facts, suggested changes.

## 2. Add Meal ("+") — `components/addMeal/AddMealScreen.tsx`

Full-screen overlay with bottom tabs **Scan · AI · Manual · Search**. Logs to **today at the current time** and returns
Home (from Day Detail / Customize, meals go to that day/slot instead and you stay in context). Header: back arrow,
`APP_NAME` + logo placeholder, "…" → permanent Disclaimer page (placeholder text). Accent: light green.

- **Scan:** sub-modes Scan / Upload / Barcode, corner-bracket viewfinder. Photo is compressed (1280px wide, JPEG 0.6)
  and sent to `scan-meal`. Result = photo background + opaque half-sheet (`#1C1C1C`): meal name, major ingredients
  summary, calories with servings ± (+ doubles, − halves), P/C/F, health rating badge (fit vs the user's targets,
  "unique and thoughtful"), bookmark top-right ("Added to Favourites/Saved" + undo), buttons **Fix · Retake · Log**.
  Fix opens a keyboard-safe text overlay with Re-evaluate (repeatable). Log adds to today now and closes to Home.
  Known gaps: re-evaluate, barcode and voice still run on the legacy client stub; scan returns no ingredients;
  photo isn't stored server-side (local URI only).
- **AI (Describe):** live nutrition card (starts at 0) + estimated ingredients + text/voice input. Loop: describe →
  submit (`estimate-nutrition`) → review → refine (`fix-meal`) → Log. Nutrition/ingredients are **not manually
  editable** here — corrections go through text/voice. Its spinner is tiny (open item).
- **Manual:** landing page (big "+", "Create a new meal", "Enter nutrition details manually") → `MealForm` (back arrow,
  name, iOS wheel time, calories, P/C/F, ingredients, meal-type chips Breakfast/Snacks/Lunch/Dinner) → big **"Log Meal"**.
  Zero AI. Auto-saves to Recent (`source:'manual'`, always free).
- **Search:** embeds the unified recipe page (`SavedRecipesView`, context `search-tab`): default tab **Recent**, cards have
  "+" (adds to Today, toast "Added to Today" + undo), screen stays open to add several.
- Superseded: Open Food Facts database search, Database|Library toggle, "Chef" assistant naming, star icon.

## 3. Meal detail popup — `components/MealDetailModal.tsx`

Centered popup (not full screen), stays in the stack; edit pages **push on top** of it (fast).
- Header "Nutrition", three-dots menu: Add/Change Photo (Take/Upload/Remove), Report Food (shell: text + Cancel/Report),
  **Delete Food** (red; Home = delete the log; Plan context = empties the slot and offers Swap).
- **Big square image tile** (contained rounded card, not full-bleed), bookmark, time, editable name, servings ±
  (scales macros + ingredient quantities), Good/Okay/Poor grade (`rateMealGrade`), "Added" tag (Home + ad-hoc only).
- Swipeable macro pager: page 1 = Calories big + P/C/F row; page 2 = secondary nutrients chosen in Nutrition Goals
  (fiber, sugar, sodium, potassium, cholesterol, saturated fat). Width measured via `onLayout`.
- Ingredients section (name left, measurement right, dividers) — rows push the ingredient edit page.
- **Fix** (renamed from "Fix Issue" everywhere) + **Done**. Done/backdrop commits; discard guard if changed.
  Editing P/C/F offers "sync calories to macros?" (Sync / Don't sync).
- Push pages: `meal-edit/macro/[key]` ("Edit Calories", ring "569 out of 1500 left today", auto keyboard, Revert/Done;
  no ring without a target), `meal-edit/ingredient/[id]` (measurement chips Portion/G/Cup/Serving/Tbsp/Oz, **no unit
  auto-conversion**, servings with pencil, macro tiles, trash, Done).
- Fix inside this popup still uses the legacy client (open item).

## 4. Plan tab — `app/(tabs)/plan.tsx`

Top → bottom:
1. **Current Plan card** (name, "Current", start date; hidden without an active plan).
2. **Build My Plan** and **Find Your Plan** tiles side by side.
3. **Mini month calendar:** real dates under day letters, Monday start, no dots/colour coding. Today = green number +
   small dot under it (no ring). Selected = filled background; both combine. Returning to the tab resets to the
   current month with today selected (`useFocusEffect`).
4. **Day Detail button** ("Monday 25 May — 5 meals · 2,400 cal", includes ad-hoc meals) → `/plan/day/[date]`.
5. **Planned Ingredients** button with count badge → full page.
6. **Explore Plans** (premade, horizontal category rows Balanced / High Protein / Low Carb / High Fiber / Keto /
   Mediterranean, "See all") — seeded in `constants/planSeed.ts`, backend-managed later.
7. **Saved Plans** ("My Plan — May 29", "Current" tag; rename any, delete only user-built, with confirm).

**Day Detail page** (`app/plan/day/[date].tsx`): date + day name, macro summary, sections per non-skipped meal slot
(Breakfast, Mid-morning Snack, Lunch, Afternoon Snack, Dinner; custom slots sorted in by time). Filled slot → meal card
with **Swap** and **X**; card body → meal popup. Empty slot → add option. X on a recurring meal → 3-option scope popup
(This meal / This and future / All); otherwise "Are you sure?". Swap → unified page in **Swap Meal** mode (default tab All,
filter pre-set to the slot), pick replaces for **that day only**. Past days editable. No completion controls.

**Plan detail / Current Plan** (`app/plan/[id].tsx`): same layout for premade and current plans — name, description,
disclaimer, daily calorie target, macro breakdown, "Meals in this plan" collapsible (See more/less, 4 shown) with
calories, prep time, type label, weekly schedule day cards. Premade → **Start Plan**; current → **Customize Plan** only.
Starting a plan when one is active → "This will replace your current plan. Would you like to save your current plan
first?" **Save and replace / Replace / Cancel** (used everywhere a plan starts). Replacing resets today + future logs,
keeps the past. Plans repeat weekly. Recipes from a premade plan are **not** auto-saved.

**Customize Plan:** works on a draft (`customizeDraft` in the store, read by `app/plan/[id].tsx`, `SavedRecipesView`
and `app/ai/custom.tsx`). Global removal via X in "Meals in this plan" → "Removed" placeholder (swap or
remove). Day cards → day view inside `app/plan/[id].tsx` (reads/writes the draft): **Swap only, no X**, plus
"Add meal slot" (name + wheel time; plan-level only, doesn't touch Profile slots). Button becomes **Save** (warns about
empty removed slots). Back = Cancel ("All unsaved changes will be lost. Are you sure?"). Every action gets a 5s undo.

**Find Your Plan:** "Coming soon" shell; must end with a designed bridge "None of these fit? Try Build My Plan instead"
("designed and intentional, not an afterthought"). Guided ~5-question flow is deferred.

**Superseded on this tab:** week schedule + DayDetailModal popup, header "+Add"/"+Day meal", drag reorder, heatmap here,
"View in Schedule", auto-expanding Planned Ingredients section, today ring.

## 5. Build My Plan — `app/plan/build.tsx` (current flow, Jul 29 redesign + Aug updates)

1. **Guide** page: pulls goal/diet/allergies from Profile ("Based on your goal (Lose Weight)…"), "Let's go".
   If all meal slots are skipped → dismissible popup linking to Personal Details.
2. **Macro picker — three screens: Proteins → Carbs → Fats** (required). Each is a **vertical searchable list**
   (Cal AI style) from the live `macro_*` tables, sorted by familiarity; search ranks "starts with" above "contains";
   checkmark/highlight selection. Umbrella items (Chicken, Beef, Pork, Turkey, Potato) expand server-side.
   Agent-chosen defaults Alex never confirmed: ≥1 pick per screen; progress shows "Step 1 of 2" with a sublabel.
3. **Secondary preferences** (optional, skippable, asked fresh every time, not saved — "use last time" was removed):
   cuisines (Nigerian, Mediterranean, Asian, American, Mexican, Indian, Mixed/Everything), cook time (Quick <15 /
   Moderate 15–30 / Full 30+ — tie-breaker only), **loved foods** (keeps its own short `LOVE_SUGGESTIONS` chip list —
   "do not replace it"), **Foods to Avoid** (same searchable list over proteins+carbs+fats combined; can add exactly
   what you typed as a custom entry, e.g. "shellfish"; **persisted** in `planAvoidFoods` and pre-filled next time; hard
   constraint like allergies).
4. **AI shortlist** (`generate-plan-shortlist`, one call, 1 scan): sections per active meal type (4 per main, 2 snacks),
   pick favourites; **Generate More** per type (≈3 more, 1 scan); **Regenerate** returns to the picker (1 scan).
5. **Build my week:** rotate the user's own picks across 7 days (`day % picks.length`) — no AI-generated variations.
6. **Preview:** looks exactly like the plan detail pages; quick **Swap** (catalog browse free, Describe = 1 scan via
   `generate-meal-suggestions`); non-blocking toast if a swap moves a day ±15% off the calorie target.
7. **Confirm Plan** → Pro gate ("Unlock Build My Plan with Pro") → `ensureRecipeSaved` for AI meals (`source:'ai'`; they
   appear in Saved Recipes — accepted) → `activatePlan`; auto-named "My Plan — <date>", tagged Current; ingredients
   flow into Planned Ingredients.

Older constants still in the file: `PAGE_SIZE=5`, `INITIAL_SEED=9`, `SUGGEST_BATCH=5`, catalog 15 recipes per category.
Superseded: single-pick per slot; AI variations; 4-question onboarding before the guide; per-slot pick pages with
"Suggest more" paging and the 5-click Describe nudge; summary step; three 15/13/10 chip screens; full USDA lists.

## 6. Grocery — Planned Ingredients · Kitchen · Cart

Shared ingredient model keyed by normalized lowercase name, one section at a time (planned | kitchen | cart | none),
categories from a keyword map (`constants/ingredientCategories.ts`, 8 categories + dot colours `CATEGORY_DOT`).
- **Planned Ingredients** (`app/grocery/planned-ingredients.tsx`, full page from Plan tab): inbox of the plan's
  ingredients. Monday refresh (hardcoded) clears/repopulates only Planned, skipping items already in Kitchen/Cart;
  mid-week meal additions ingest new ingredients. Search, "12 ingredients to sort", grouped by category. Row actions:
  **In stock** (solid green → Kitchen, toast "Moved to Kitchen"), **Need it** (outlined green → Cart, "Added to Cart"),
  **Skip** (plain grey; warns "This ingredient is used in [Meal]. Skip anyway?"; not permanent). Empty: "All done! Your
  ingredients are sorted." Toasts auto-dismiss 2–3s, no undo, one at a time.
- **My Kitchen** (`app/kitchen.tsx`, from Recipes tile; rebuilt from scratch Jul 13): header back / "My kitchen" / cart
  with red badge; "Add an item..." row + square camera button → **KitchenScanModal** (1–4 photos → `scan-kitchen` →
  review checklist grouped by category, all checked, "Add N items", dedupes against existing); hint "Scan your fridge or
  pantry to add items quickly."; "12 items"; uppercase category labels with coloured dots (red Proteins, yellow Carbs &
  Grains, green Fruits & Veg, blue Dairy, orange Oils & Fats, purple Spices, teal Condiments, grey Other); rows with a
  green "Cart" pill and muted X; "Go to cart →". Empty state: prominent camera "Scan your kitchen to get started".
  No quantities, no search (MVP). Kitchen is the data source for What Can I Make.
- **Cart** (`app/cart.tsx`, from top-bar icon): tap to strike through; **Done shopping** ("Tap when you're back from the
  store") moves struck items to Kitchen; custom items ("Add custom item", e.g. paper towels) just clear. Nothing goes to
  Cart automatically. Removing a meal asks whether to remove its Cart ingredients (excluding ones other meals need).
  Weekly refresh asks keep/remove for last week's unbought items. "View Kitchen" link.
- Future: seasoning check, regional pricing/budget, cart history, configurable refresh day, kitchen search, quantities.

## 7. Recipes tab — `app/(tabs)/recipes.tsx`

Top → bottom: **search bar** ("Search recipes…", templates + saved; no results → "want me to create this recipe for
you?" → Custom Recipe pre-filled), two tall action cards **"What can I make?"** ("Based on your kitchen.") and
**"Custom Recipe"** ("Describe anything."), two folder tiles **Saved Recipes** and **My Kitchen** with counts, then
category rows Breakfast / Lunch / Dinner / Snacks with "See all" (first row visible without scrolling).
Front-page cards have **no "+"** (thumbnail, name, calories, meal-type tag only). The Recipes tab is for discovery —
there are **no Add to Plan / Add to Today buttons** on recipe pages (add via "+" or Day Detail / Customize swap).

- **Recipe preview** (`app/recipe/[id].tsx`): image/placeholder, name, calories, P/C/F, cook time, meal-type tag, 3–4 key
  ingredients; top-right **"+" (small filled green circle, left) and bookmark (right)**; one "View Full Recipe" button
  (Pro-gated for non-free content; locked view still shows calories/macros).
- **Full detail** (`app/recipe/detail/[id].tsx`): name, image, bookmark, tag, info bar (calories, macros, cook time,
  difficulty Easy/Medium/Hard), ingredients with measurements, numbered steps, floating AI assistant button → half-height
  chat panel with recipe context (`recipe-assistant`, Pro). Conversation lasts until you leave the recipe.
- **Unified recipe page** (`components/recipes/SavedRecipesView.tsx`, contexts `saved-recipes | swap | search-tab`):
  tabs **All / Saved / Recent / Recipes(premade)**; inline search of the active tab; filter icon → popup
  All/Breakfast/Snacks/Lunch/Dinner (dot when active); newest first (no sort options); green **NEW** pill for
  non-premade recipes added in the last 3 days until first viewed; floating circular **Create Recipe** button
  (54×54 green) → Custom Recipe. Recent = user-created only (scan/AI/manual); "+" on a premade recipe adds to today
  without saving it. Renames: "Favourites" → "Saved", "Recently Added" → "Recent". Global bookmark state.
- **What Can I Make** (`app/ai/what-can-i-make.tsx`, design authority mockup from Jul 13 — exact tokens in
  `chat-history`/HISTORY): kitchen overview card ("N items available", nudge if ≤3 items), quick add (saves to real
  Kitchen), camera, grouped pills, **Find recipes** → ProgressiveLoader → one `suggest-kitchen-recipes` call (~10).
  Results: perfect matches, then "You're close — missing 1-2 items" (tap a missing ingredient → Cart). "Suggest More"
  reveals more of the same batch (no extra AI call, doesn't wrap). Card → Custom Recipe concept page; these concepts
  already include steps (free flow). Empty kitchen hides everything except the add/scan affordances.
- **Custom Recipe** (`app/ai/custom.tsx`): screen 1 "What meal is this for?" (vertical option list — designed to grow to
  juicing etc.), screen 2 "What are you craving?" / "We'll factor in your goals, targets, and dietary preferences
  automatically." / placeholder "Describe the recipe you want..." / example card / **Create Recipe** (no mic, no
  disclaimer). Stage 1 = nutrition **concept** (`generate-recipe-concept`, free-scan pool) shown like the meal popup with
  three-dots menu, **Fix** (left, repeatable) and **Generate** (right). Generate → `generate-recipe-steps` (Pro) →
  saved to Recent as `source:'ai'` → recipe preview. From a swap, auto-assigns to the slot. Leaving unsaved → "Save this
  recipe before leaving?". Never embellish the user's description.
- Deferred: Cook Mode (guided step-by-step cooking with timers, chef avatar), calorie filter, more categories.

## 8. Progress tab — `app/(tabs)/progress.tsx`

- **Heatmap** ("perfect now", custom matrix): rows Sunday → Saturday with all 7 letters, horizontal scroll, ~11px cells,
  each month its own block with dark filler squares (`#212123`) for non-existent days and future days, small month gaps,
  legend "Fewer ■■■■■ More". Intensity = completed ÷ total meals that day (includes ad-hoc meals): 0 / 1–33 / 34–99 / 100%.
  Auto-snaps to the current month, resets to current year/month on revisit, year label is a dropdown only with ≥2 years.
- **Weight:** "+ Log" → number saved for today; SVG line chart of the last 30 entries. Weight changes in Profile also
  create log entries. "Simple, quick, no complexity."

## 9. Onboarding — `app/onboarding.tsx` (functional; **design polish deferred**)

Five phases with a global progress bar; Back keeps answers. Welcome (Get Started + Log In) → carousel → name → goal
(lose weight / eat healthier / build muscle; auto-advance) → gender ("What gender were you born with?") → birthday wheel
→ height wheel (ft/in ↔ cm) → weight (lbs/kg/st-lbs) → motivational pause → target weight (validation copy per goal; eat
healthier = current) → activity (4 friendly phrasings) → pace slider (lose 0.5–2.0 lb/wk, build 0.25–1.0) → diet → allergies →
secondary nutrients (skippable) → processing 0→100% (ProgressiveLoader-style) → "Your personalized plan is ready" with
Apple/Google (coming soon)/Email → email + password + confirm → **6-digit code screen ("I'll verify later" allowed)** →
setup → goal timeline ("[Name], you will reach your goal by [date]") → calorie ring → notifications ask → "Ready to build
your first meal plan?" (Build My Plan / "I'll do this later" → Home nudge).
Math (`constants/onboardingCalc.ts`): Mifflin-St Jeor; activity 1.2/1.375/1.55/1.725; −500 kcal per lb/wk lost, +250
per 0.5 lb/wk gained; floor 1200 kcal female / 1500 male; macros 30% P / 40% C / 30% F; water kg × 0.033 L.
Exact screen copy is in `chat-history/main-chat-may-oct-2026.md` (message around Jul 13, "Onboarding").

## 10. Profile & Settings

- **Profile** (`app/profile.tsx`): silhouette (no photo upload), name, age, weight (tap → update + weight log entry),
  goal (→ Edit Goal), active plan, Free/Pro status with **Upgrade** (paywall) or **Manage Subscription** (Apple sheet).
  Sections: Body & Goals (Edit Goal, Personal Details), Nutrition (Dietary & Allergies, Nutrition Goals), Preferences
  (lbs/kg, app-wide, default lbs). Gear → Settings.
- **Edit Goal:** goal tiles → confirm weight → activity → pace → old vs new targets side by side (manual tweaks) →
  "Update your meal plan to match?" Yes → auto-save current plan as "Auto-saved Plan – {date}" (if one exists) and
  `router.replace('/plan/build')`; No → targets only.
- **Personal Details:** name, age, height, weight, gender, activity, and **Meal Time Slots** (5 fixed, wheel times + skip
  toggles; defaults Breakfast 07:30, Mid-morning Snack 10:30, Lunch 13:00, Afternoon Snack 15:30, Dinner 19:00).
- **Dietary & Allergies:** preference (None/Vegetarian/Vegan/Pescetarian…) + allergy toggles; with an active plan warns
  "Changing your food or allergy preferences may affect your current plan." All AI reads this server-side.
- **Nutrition Goals:** calories, P/C/F grams, water cups, secondary nutrient targets; override note if auto-calculated.
- **Settings** (`app/settings.tsx`): Account (email, names, change password, units, Language/Data Consent/Export
  shells, **Delete Account** red → real deletion flow), Upgrade to Pro / Manage Subscription row, Notifications (meal
  reminders on by default, "remind me before" 5/10/15/30, default 15 — **not implemented**, `expo-notifications` not
  installed), Help (FAQ/About/Contact/ToS/Privacy shells; Feedback has a text box but no backend), **Log Out** plain
  text at the very bottom (not red, not a button).

## 11. Paywall — see BACKEND.md §6 for the full spec (copy, price hierarchy, gates, resume-after-purchase).

## 12. Brand

No final name. Placeholders: `constants/app.ts` `APP_NAME='AppName'`, `APP_LOGO='🌱'`; onboarding uses `'NutriTrack'`;
paywall says **"Macrotri Pro"**; `app.json` name/slug `meal-app`. Needs one decision and a sweep.
