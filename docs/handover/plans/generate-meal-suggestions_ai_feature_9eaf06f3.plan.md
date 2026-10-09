---
name: generate-meal-suggestions AI feature
overview: "Build the generate-meal-suggestions Supabase Edge Function (6th AI feature, same shared-helper pattern) and wire it into Build My Plan at its two natural, quota-bounded seams: the \"Describe what you want\" flow (replacing the fake generateCustomCard stub) and as a fallback when \"Suggest more\" exhausts the static catalog pool. The static RECIPE_SEED catalog stays the default, free source for initial seed and normal browsing."
todos:
  - id: edge-function
    content: Create supabase/functions/generate-meal-suggestions/index.ts (auth, resolveEntitlement, independent rate-limit bucket, dynamic per-mealType schema, Gemini call)
    status: completed
  - id: config-docs
    content: Add generate-meal-suggestions to supabase/config.toml and supabase/README.md; deploy the function
    status: completed
  - id: client-wrapper
    content: Add ai/generateMealSuggestions.ts client wrapper mirroring suggestKitchenRecipes.ts
    status: completed
  - id: describe-flow
    content: "Replace generateCustomCard stub: make addDescribePage async, call AI with count=1+description, add loading state, paywall/error handling, safety filter"
    status: completed
  - id: suggest-more-fallback
    content: "Make addAutoPage async: on catalog pool exhaustion, call AI for a SUGGEST_BATCH top-up before falling back to the existing toast"
    status: completed
isProject: false
---

# generate-meal-suggestions — AI feature behind Build My Plan

## Decision (confirmed)

Integration scope = **Describe flow + pool-exhaustion fallback only**. The static `RECIPE_SEED` catalog remains the default candidate pool for every slot's initial seed and normal "Suggest more" clicks (no AI, no quota cost, unchanged behavior). AI is only invoked at two explicit, low-frequency seams:
1. **Describe what you want** — currently `generateCustomCard()` (`app/plan/build.tsx:204-216`) fabricates a fake card with hardcoded macros. This becomes a real 1-suggestion AI call built around the user's typed text.
2. **Suggest more, pool exhausted** — `addAutoPage()` (`app/plan/build.tsx:929-940`) currently shows a toast when `buildAutoPage` returns 0 unseen catalog cards. This becomes an AI top-up (batch of `SUGGEST_BATCH`) before falling back to the toast.

This avoids the funnel-protection regression flagged earlier (every slot firing AI on every plan build could exhaust a new user's 5 free scans in one session).

## 1. Edge function — `supabase/functions/generate-meal-suggestions/index.ts` (new)

Mirrors `supabase/functions/suggest-kitchen-recipes/index.ts` exactly in structure (imports from `_shared/cors.ts`, `_shared/errors.ts`, `_shared/auth.ts`, `_shared/entitlement.ts`, `_shared/rateLimit.ts`, `_shared/gemini.ts`).

**Request body:**
```
{
  mealType: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks',
  count: number,             // clamped 1-8 server-side
  cuisines?: string[],       // wizard prefs, all optional/soft biases
  cookTime?: 'quick' | 'moderate' | 'full' | null,
  loves?: string[],
  avoid?: string[],
  description?: string,      // only set by the Describe flow; capped ~200 chars
}
```

**Server behavior (same skeleton as `suggest-kitchen-recipes`):**
- Preflight, method check, `GEMINI_API_KEY` presence, admin client, `getAuthedUser`.
- Validate `mealType` against the 4-value enum (reject otherwise); clamp `count` to `[1, 8]`; sanitize `cuisines`/`loves`/`avoid` (cap array length + string length, trim); validate `cookTime` enum or null; trim/cap `description`.
- Load authoritative profile row from `users` (`subscription_status, free_scans_remaining, dietary_preferences, allergies, goal_type, daily_calorie_target`) — never trust client-sent profile data.
- `resolveEntitlement` gate (`not_premium` on exhaustion), then `isRateLimited` against an **independent bucket** (`FUNCTION_NAME = 'generate-meal-suggestions'`, 30/hour).
- Build prompt (`buildPrompt`): system instructions describe the assistant's role, requested `count` + `mealType`, hard constraints (dietary/allergies — "never include allergens"), soft biases (cuisine name-match, cook-time ceiling, loves/avoid) worded the same way as `rankForGoal`'s comments in `build.tsx:93-99`, and — when `description` is present — an explicit instruction that the description takes priority over soft biases but never overrides allergies/dietary restrictions.
- **Response schema**: dynamically built per-request with `category` constrained to a single-value enum equal to the requested `mealType` (guarantees consistency without extra client-side mapping), plus `name, calories, cookTimeMin, difficulty, protein, carbs, fats, ingredients:[{name,quantity,unit}], steps:[string]` — same field set as `suggest-kitchen-recipes`'s suggestion schema. Ingredients/steps aren't currently displayed in Build My Plan's UI, but are needed so client-side defense-in-depth filtering (`applyDietaryFilter`) and the `RecipeTemplate`/`RecipeConcept` type shape both work unchanged.
- `callGeminiJSON` with `GEMINI_MODEL = 'gemini-3.6-flash'` (pinned constant, matches other functions) and `GEMINI_TIMEOUT_MS = 20000` (lighter payload than `suggest-kitchen-recipes`'s 10-recipe/25s case).
- On success only: `logAiUsage` + `consumeFreeScan` (if not subscriber). On Gemini failure: `ai_failed` with a friendly message, `GeminiTimeoutError` gets its own message.

## 2. Config + docs

- Add `[functions.generate-meal-suggestions]` block to [supabase/config.toml](supabase/config.toml) (mirrors the `suggest-kitchen-recipes` block).
- Add a row + `_shared/` notes update to [supabase/README.md](supabase/README.md), and deploy the function.

## 3. Client wrapper — `ai/generateMealSuggestions.ts` (new)

Mirrors [ai/suggestKitchenRecipes.ts](ai/suggestKitchenRecipes.ts) closely:
- `GenerateMealSuggestionsError extends AIError`.
- `mapIngredients`/`mapSteps`/`toDifficulty` copied/adapted; category is stamped to the requested `mealType` directly (server already guarantees it, this is just defensive).
- `generateMealSuggestions({ mealType, count, prefs, description }): Promise<RecipeConcept[]>` calling `invokeAIFunction('generate-meal-suggestions', {...}, { logPrefix: '[generateMealSuggestions]', makeError, timeoutMessage, notAvailableMessage })`.

## 4. Wire into `app/plan/build.tsx`

**Describe flow** — `addDescribePage(slot, text)` (`app/plan/build.tsx:943-949`) becomes async:
- New state: `describeLoading` (boolean). Generate button (`app/plan/build.tsx:1308-1320`) disables and shows a "Generating…" label while loading; modal stays open until the call resolves.
- Calls `generateMealSuggestions({ mealType: categoryForSlot(slot.name), count: 1, prefs, description: text })`.
- Maps the first result to a `RecipeTemplate` (assign a `custom-${Date.now()}-...`-style id, same convention as today's stub), then runs it through `applyDietaryFilter([card], profile)` as a defense-in-depth safety check before appending.
- On success: `appendMealsForSlot(slot, [card], false)`, toast "Generated new option", close + clear the modal.
- On failure: reuse the exact `handleSuggestError`-style branching from [app/ai/what-can-i-make.tsx:97-122](app/ai/what-can-i-make.tsx) (`not_premium` → paywall `Alert` with Upgrade CTA; `rate_limited`/`ai_failed`/`unauthorized` → toast with `e.message`; anything else → generic toast). Modal stays open on failure so the user can retry without retyping.

**Suggest-more exhaustion fallback** — `addAutoPage(slot)` (`app/plan/build.tsx:929-940`) becomes async:
- Fast path unchanged: if the static pool still has unseen cards, append immediately, no AI, no loading state.
- Exhaustion path (0 cards): set a per-slot `suggestMoreLoadingBySlot[slot.id]` flag (button shows "Finding more…"/disabled), call `generateMealSuggestions({ mealType: categoryForSlot(slot.name), count: SUGGEST_BATCH, prefs })` (no `description`), filter results through `applyDietaryFilter` for safety, then `appendMealsForSlot(slot, cards, true)` (still counts toward the existing Describe-nudge-popup counter).
- On AI failure or an empty filtered result: fall through to today's exact behavior — `showToast('No more options — try Describe for custom ideas')`. This keeps the flow non-blocking; a transient AI failure here degrades gracefully rather than surfacing a paywall/error mid-scroll.

No changes needed to `buildPreviewDays`, `handleActivate`, or `activatePlan` — both new code paths just produce ordinary `RecipeTemplate` objects that flow through the existing `mealsBySlot` → `selectionsBySlot` → preview → plan-save pipeline unchanged.

## Files touched

- `supabase/functions/generate-meal-suggestions/index.ts` (new)
- `supabase/config.toml`, `supabase/README.md`
- `ai/generateMealSuggestions.ts` (new)
- `app/plan/build.tsx` (`addDescribePage`, `addAutoPage`, Describe modal button/loading state, Suggest-more button/loading state)
