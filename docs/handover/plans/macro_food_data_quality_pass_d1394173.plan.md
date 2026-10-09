---
name: Macro Food Data Quality Pass
overview: Fix remaining data-quality issues in the macro_proteins/carbs/fats tables (whitespace near-duplicates, composite entries, leftover prep-state duplicates), add a one-time Gemini familiarity score per food, and switch both default and search ordering in the Build My Plan macro picker to sort by that score.
todos:
  - id: cleanup-pass2-dryrun
    content: Extend cleanup-macro-food-names.ts with whitespace-dedup, composite-removal, and expanded prep-suffix-dedup logic; run --dry-run and review
    status: completed
  - id: cleanup-pass2-apply
    content: Apply cleanup pass 2 for real against the three Supabase tables
    status: completed
  - id: familiarity-migration
    content: Write and apply migration adding familiarity_score column to macro_proteins/carbs/fats
    status: completed
  - id: familiarity-script
    content: Write scripts/score-macro-familiarity.ts (batched Gemini calls) and add npm script + GEMINI_API_KEY to .env.example
    status: completed
  - id: familiarity-run
    content: Run the familiarity scoring script once GEMINI_API_KEY is available locally
    status: completed
  - id: sort-and-search
    content: Update lib/macroFoodOptions.ts to sort by familiarity_score and update build.tsx search ranking to bias startsWith matches
    status: completed
isProject: false
---

## Investigation findings (against live data, 728/711/413 rows)

**1. "Broken fragment" entries (e.g. standalone "Flats", "Half")** — could not reproduce. Scanned all three tables for single-word entries, two-word generic-qualifier combos, and any row that is literally a bare fragment word (`half`, `flat`, `point`, `whole`, `side`, `tip`, etc.) — zero matches. The old hardcoded fallback option arrays were fully removed (confirmed at [app/plan/build.tsx](app/plan/build.tsx) line 319), so that's not a source either. The closest real entries are legitimate compounds like `"Beef Brisket Flat Half"`, which could visually wrap onto two lines on a narrow phone ("Flat" / "Half" as separate-looking lines) and read as a broken fragment without being one in the data. I'll add a defensive check to the cleanup script (reject/flag, don't silently write, any canonicalized name that is 1-2 words and entirely made of known qualifier words with no recognizable base) as a safety net for future runs, but there's nothing currently in the DB to delete for this specific complaint.

**2. Whitespace/casing near-duplicates** — the exact "Egg large" example doesn't exist, but the underlying pattern does: 3 pairs found that differ only by a stray space/hyphen, invisible at a glance:
- proteins: `"Bass Freshwater"` / `"Bass Fresh Water"`
- carbs: `"Plain Waffles Ready -To-Heat"` / `"Plain Waffles Ready-To-Heat"`
- fats: `"Beef Ribeye Steak"` / `"Beef Rib Eye Steak"`

These survived the original cleanup because its dedup key only lowercased + collapsed repeated whitespace, not stripped it entirely.

**3. Search matching** — [lib/macroFoodOptions.ts](lib/macroFoodOptions.ts) and the filter in [app/plan/build.tsx](app/plan/build.tsx) line 862 already use `.includes()`, not a prefix match, so "beef" already technically matches "Ground Beef" anywhere in the string. The real problem is ordering: results currently come back alphabetical, so a relevant hit like "Ground Beef" can be buried under dozens of alphabetically-earlier "Beef, ..." entries. This is really the same fix as item 5 (sorting) — no separate matching-logic bug to fix, but I'll fold in a small ranking tweak (below) so the fix actually feels like "beef finds Ground Beef prominently."

**4. Familiarity scoring** — no existing column; needs a new one-time Gemini pass.

**5/6. Redundant variations** — found two genuinely distinct patterns to trim:
- **Composite "join several parts" entries** (2+ literal " and " joins) — 8 total: `"Chicken Meat And Skin And Giblets And Neck"`, `"Chicken And Giblets And Neck"`, `"Chicken Capons Meat And Skin And Giblets And Neck"`, `"Soymilk Original And Vanilla Vitamins A And D"` (proteins); `"Creamy Dressing Made With Sour Cream And/or Buttermilk And Oil Reduced Calorie"` (carbs); `"Margarine Stick Includes Regular And Hydrogenated Corn And Soybean Oils"`, `"Chicken And Giblets And Neck"`, `"Creamy Dressing..."` (fats). (Note: a broader "5+ words" heuristic was also tried and rejected — it flags ~500 rows, nearly all legitimate specific cuts/brand names like `"Beef Loin Top Sirloin Cap Steak"`; the "and...and" pattern is the precise, safe signal for genuine multi-part joins.)
- **Leftover prep-state duplicates** — the original cleanup's noise-word list missed a few cooking-state words (`poached`, `hard-boiled`, `omelet`, `scrambled`, `cooked` as a bare trailing word in a couple of cases). Expanding that list and re-running a suffix-based check (does `"<name> <known-prep-word>"` also exist as a `<name>`-only row?) finds 5 real cases, all with a raw form already present:
  - `"Whole Egg Hard-Boiled"` → base `"Whole Egg"` exists
  - `"Whole Egg Poached"` → base `"Whole Egg"` exists
  - `"Whole Egg Omelet"` → base `"Whole Egg"` exists
  - `"Whole Egg Scrambled"` → base `"Whole Egg"` exists
  - `"Ground Beef Patty Cooked"` → base `"Ground Beef Patty"` exists
  A handful of other suffix hits (e.g. `"Almonds Honey Roasted"`, `"Turkey Sticks Battered"`, `"Soybeans Mature Cooked"`) have **no** raw-form counterpart, so per your stated fallback they're left untouched.

## Implementation

**A. Extend [scripts/cleanup-macro-food-names.ts](scripts/cleanup-macro-food-names.ts) with a second pass** (runs after the existing canonicalize-merge, on the already-cleaned rows, still behind `--dry-run`):
1. Group by a fully whitespace-stripped + lowercased key (not just collapsed) to catch #2; survivor = lowest id, loser deleted.
2. Delete any row whose name contains 2+ occurrences of the word "and" (composite join entries, item 5).
3. Expand the prep-state word list (add `poached`, `hard-boiled`, `hard boiled`, `omelet`, `scrambled`, plus the other cooking-method words already used) and add a suffix-strip check: if `name` ends in a known prep word/phrase and the name with that suffix removed already exists as its own row, delete the suffixed row; otherwise leave it.

**B. Familiarity scoring**
- New migration `supabase/migrations/20260802010000_macro_food_familiarity_score.sql` adding `familiarity_score smallint` (0-100, nullable) to `macro_proteins`, `macro_carbs`, `macro_fats`.
- New one-time script `scripts/score-macro-familiarity.ts`: fetches all rows per table, batches ~40 names per Gemini call (structured JSON response: `[{name, score}]`), using the same model (`gemini-3.6-flash`) and request shape as [supabase/functions/_shared/gemini.ts](supabase/functions/_shared/gemini.ts) (called directly via `fetch`, since this is a one-off admin script, not a user-facing edge function — no need to burn a rate-limit bucket). Prompt explicitly frames the score as *global, everyday familiarity* ("how commonly known and eaten by ordinary people across diverse diets worldwide, based on your general knowledge — not literal statistics"), 0 = obscure/niche, 100 = near-universally recognized (rice, eggs, chicken breast, milk). Writes scores back via `upsert` on `id`.
- **You'll need to add a `GEMINI_API_KEY` value to your local `.env`** for this script to call Gemini directly (currently the key only exists as a Supabase Edge Function secret, not available to local scripts) — same pattern as `USDA_API_KEY` for the import script. I'll add the placeholder to `.env.example`.
- New `package.json` script: `"score:macro-familiarity": "tsx scripts/score-macro-familiarity.ts"`.

**C. Sorting**
- [lib/macroFoodOptions.ts](lib/macroFoodOptions.ts): change `.order('name')` to `.order('familiarity_score', { ascending: false, nullsFirst: false })` for all three tables. No grouping existed in the UI already (it's a flat checklist), so nothing to remove there.

**D. Search ranking**
- [app/plan/build.tsx](app/plan/build.tsx) `filteredOptions`: keep the existing `.includes()` substring filter, then apply a stable sort keyed on "starts with the query" (0/1). Since the underlying `options` array is already familiarity-ordered, a stable sort preserves familiarity order within each bucket — so results are: all matches that *start with* the typed term (best familiarity first), then all matches that merely *contain* it (best familiarity first). E.g. searching "beef" surfaces "Beef" before "Ground Beef"/"Corned Beef", but all of them appear near the top instead of scattered alphabetically.

## Files touched
- [scripts/cleanup-macro-food-names.ts](scripts/cleanup-macro-food-names.ts) — extend with pass 2 (whitespace dedup, composite removal, expanded prep-suffix dedup)
- [supabase/migrations/20260802010000_macro_food_familiarity_score.sql](supabase/migrations/20260802010000_macro_food_familiarity_score.sql) — new column (new file)
- [scripts/score-macro-familiarity.ts](scripts/score-macro-familiarity.ts) — new one-time Gemini scoring script (new file)
- [lib/macroFoodOptions.ts](lib/macroFoodOptions.ts) — sort by familiarity_score
- [app/plan/build.tsx](app/plan/build.tsx) — search result ranking
- `package.json`, `.env.example` — new script entry + `GEMINI_API_KEY` placeholder/docs

## Sequencing
1. Run cleanup pass 2 in `--dry-run` first, review output, then apply for real (same workflow as before).
2. Apply the migration.
3. Add `GEMINI_API_KEY` to `.env` (you), then run the scoring script once.
4. Ship the sort/search code changes.