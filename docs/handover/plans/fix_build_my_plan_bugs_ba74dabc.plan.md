---
name: Fix Build My Plan bugs
overview: Fix the catalog-exhaustion bug by expanding the static recipe catalog and documenting the seed/suggest-more/AI-fallback balance, and fix the Describe modal transparency bug using the same opaque-background pattern already used in ScanTab.
todos:
  - id: expand-catalog
    content: Add 10 new recipes each to Breakfast/Lunch/Dinner/Snacks in constants/recipeSeed.ts (5 -> 15 per category)
    status: completed
  - id: document-balance
    content: Add comment near INITIAL_SEED/SUGGEST_BATCH in app/plan/build.tsx documenting the catalog-size relationship
    status: completed
  - id: fix-describe-transparency
    content: Add OPAQUE_SHEET_BG constant and apply to describeCard style in app/plan/build.tsx
    status: completed
isProject: false
---

## Confirmed findings (no action needed for these)

- **Question 2 answered**: `rankForGoal` is genuinely wired into the initial seed — `byCategory` (`app/plan/build.tsx:339-345`) calls `rankForGoal(dietaryFiltered, profile, prefs)` and the mount effect seeds directly from that ranked pool. No code change needed here; this was purely a question.

## Fix 1: Catalog exhaustion (expand catalog + document the balance)

**Root cause**: [constants/recipeSeed.ts](constants/recipeSeed.ts) has exactly 5 recipes per category, but `INITIAL_SEED = 9` (`app/plan/build.tsx:42`). Since 9 > 5, the initial seed always consumes the *entire* category catalog on first render, so the very first "Suggest more" tap on any slot immediately hits the exhaustion branch (and now the AI top-up, which can itself fail and show the toast). This affects all 4 categories equally.

**Fix**:
1. Expand [constants/recipeSeed.ts](constants/recipeSeed.ts) from 5 to 15 recipes per category (+10 each: Breakfast, Lunch, Dinner, Snacks — 40 new recipes, 60 total), following the existing `RecipeTemplate` shape (`name`, `category`, `calories`, `cookTimeMin`, `macros`, `ingredients` with `id`/`name`/`quantity`/`unit`, `steps`, `difficulty`). New recipes will vary in cook time, macros, and difficulty so `rankForGoal` ranking has real signal to work with (currently moot since the whole category fits in one seed).
2. With 15/category: `INITIAL_SEED` (9) leaves 6 unseen, so the first "Suggest more" tap now genuinely returns 5 fresh catalog cards, and a second tap returns the last 1, before the AI top-up kicks in on a third tap — versus 0 rounds today.
3. Add a short comment near `INITIAL_SEED`/`SUGGEST_BATCH` (`app/plan/build.tsx:41-44`) documenting that these are sized against the ~15-recipe-per-category catalog, so the relationship is intentional and future catalog/constant changes stay in sync (per your request to make this deliberate rather than accidental).

No changes needed to `buildAutoPage`, `distributeMealsIntoPages`, or the AI fallback logic — this is purely a content + documentation fix.

## Fix 2: Describe modal transparency

**Root cause**: `styles.describeCard` (`app/plan/build.tsx:2117-2122`) uses `backgroundColor: COLORS.card`, which is `'rgba(255,255,255,0.04)'` (`constants/theme.ts:10`) — a translucent white meant to sit on the opaque app background. Inside a `Modal transparent`, this is see-through, exactly like the earlier ScanTab bug. `describeCard` is shared by both the "Describe what you want" modal (`app/plan/build.tsx:1427`) and the "Try Describe?" nudge popup (`app/plan/build.tsx:1485`), so one fix covers both.

**Fix**: Add the same opaque background constant used in [components/addMeal/ScanTab.tsx:629](components/addMeal/ScanTab.tsx) (`OPAQUE_SHEET_BG = '#1C1C1C'`) to `app/plan/build.tsx`, and set it as `describeCard`'s `backgroundColor` in place of `COLORS.card`.

## Files touched

- `constants/recipeSeed.ts` (40 new recipes)
- `app/plan/build.tsx` (documentation comment near `INITIAL_SEED`/`SUGGEST_BATCH`; `OPAQUE_SHEET_BG` constant + `describeCard` style fix)
