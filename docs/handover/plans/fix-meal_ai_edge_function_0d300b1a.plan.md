---
name: fix-meal AI edge function
overview: Build a second AI edge function, `fix-meal`, that takes a text correction plus the current meal draft (name, macros, ingredients) and returns the corrected meal, reusing all the shared auth/entitlement/rate-limit/Gemini helpers built for `estimate-nutrition`; wire it into AITab's correction flow only.
todos:
  - id: shared-client-helper
    content: Create ai/aiEdgeClient.ts (shared AIError base + invoke/timeout/error-parsing helpers) and refactor ai/estimateNutrition.ts to use it
    status: completed
  - id: fix-meal-function
    content: Build supabase/functions/fix-meal/index.ts using the existing _shared helpers, plus config.toml entry
    status: completed
  - id: fix-meal-client
    content: Create ai/fixMeal.ts client wrapper (FixError, FixMealResult, invoke with timeout)
    status: completed
  - id: wire-aitab
    content: Wire AITab.tsx's correction branch to the new fixMeal client, update ingredients on success, generalize error handling, remove dead historyRef
    status: completed
  - id: docs
    content: Update supabase/README.md with the fix-meal function row
    status: completed
  - id: deploy-test
    content: Deploy fix-meal and do a manual end-to-end test (estimate -> correction)
    status: completed
isProject: false
---

## Scope (per your decisions)

- Only `AITab`'s text-only correction flow gets rewired. `MealDetailModal`, `ScanTab`, and `FixResultScreen` (all image-capable) keep using the legacy `aiClient.fixMeal` (OpenAI/stub) for now — separate future pilot.
- Single-shot correction: each fix call sends the full current draft + ingredients + the new correction text, no conversation history. `_shared/gemini.ts` stays untouched (single system+user turn, as `estimate-nutrition` already uses it).
- New dedicated types for the new flow (not touching the legacy `MealDraft`/`FixInput` shared types used by the other 3 call sites).
- `fix-meal` gets its own independent 30-calls/hour bucket (`function_name = 'fix-meal'` in `ai_usage_log`), separate from `estimate-nutrition`'s.

## 1. New edge function: `supabase/functions/fix-meal/index.ts`

Composes the exact same shared helpers as `estimate-nutrition` (per `supabase/README.md`'s guidance):

- `handlePreflight`, `errorResponse`/`jsonResponse` from `_shared/cors.ts` / `_shared/errors.ts`
- `createAdminClient`, `getAuthedUser` from `_shared/auth.ts`
- `isEntitled` from `_shared/entitlement.ts` (re-checked on every call — a fix call is a separate request from the initial estimate, so subscription state is re-verified)
- `isRateLimited`, `logAiUsage` from `_shared/rateLimit.ts`, with `FUNCTION_NAME = 'fix-meal'`, `RATE_LIMIT = 30`, `RATE_WINDOW_MS = 1 hour` (independent bucket)
- `callGeminiJSON`, `GeminiTimeoutError` from `_shared/gemini.ts`, same `GEMINI_MODEL = 'gemini-3.6-flash'` constant/comment as `estimate-nutrition`

Request body: `{ fixText: string, currentDraft: { meal_name, calories, protein, carbs, fats, ingredients: [{name, quantity, unit, calories, protein, carbs, fats}] } }` — same field names/shapes as `estimate-nutrition`'s response, for symmetry.

Response schema (Gemini structured output): `meal_name, calories, protein, carbs, fats, ingredients[]` — same shape as `estimate-nutrition` minus `description`/`meal_type`/`health_rating` (out of scope per your field list; category is never touched by a fix).

Prompt: system instruction tells Gemini it's correcting a previous estimate based on user feedback — preserve everything already correct, only change what the correction addresses, and return the **complete** corrected meal (not a diff). User text = JSON of `currentDraft` + the correction text. Reuses the same profile-context fetch (dietary preferences/allergies) as `estimate-nutrition` in case a correction implies an ingredient swap.

Validation: `fixText` required/non-empty/length-capped; `currentDraft` required with numeric calories/macros and an `ingredients` array (can be empty).

Error handling: same contract as `estimate-nutrition` — `GeminiTimeoutError` → "The AI corrector took too long to respond. Please try again."; other Gemini failures → "Could not update this meal. Please try again."; usage logged only after a successful Gemini call.

Add `[functions.fix-meal]` block to `supabase/config.toml` (`enabled = true`, `verify_jwt = true`), matching `estimate-nutrition`'s.

## 2. Client-side helpers

- New `ai/fixMeal.ts` (parallels `ai/estimateNutrition.ts`): `fixMeal(fixText, currentDraft, ingredients)` invoking `supabase.functions.invoke('fix-meal', ...)` with the same `INVOKE_TIMEOUT_MS = 20000` backstop, returning a new `FixMealResult { draft: MealDraft, ingredients: Ingredient[] }`.
- Extract the small duplicated bits (`toInt`, `nowHHMM`, ingredient mapping, error-body-parsing) that currently live inside `ai/estimateNutrition.ts` into a tiny shared `ai/aiEdgeClient.ts`, and have both `estimateNutrition.ts` and the new `fixMeal.ts` use it — same "don't duplicate for the next N features" reasoning already applied server-side, now applied client-side. Introduces one shared `AIError` base class (with `code`); `EstimateError`/`FixError` as thin subclasses so `AITab`'s error handling can branch on `instanceof AIError` generically.

## 3. Wire into `components/addMeal/AITab.tsx`

- Replace `aiClient.fixMeal(...)` in the `if (draft)` branch with the new `fixMeal(...)` client helper, passing `input`, `draft`, and current `ingredients` state.
- On success: `setDraft(next.draft)` **and** `setIngredients(next.ingredients)` (today's legacy path never touched ingredients — this fixes that gap per your ask that ingredients be correctable too).
- Generalize `handleEstimateError` → `handleAIError` so it handles both `EstimateError` and the new `FixError` via the shared `AIError` base (same `not_premium`/`rate_limited`/`ai_failed`/`unauthorized` branches, reused message copy).
- Remove `historyRef` entirely — it was only feeding the legacy multi-turn OpenAI path; nothing in the new single-shot design consumes it (dead code cleanup).

## 4. Docs

- Add `fix-meal` row to the Edge Functions table in `supabase/README.md`, matching `estimate-nutrition`'s doc style.

## 5. Deploy & verify

- Deploy `fix-meal` via `supabase functions deploy fix-meal`.
- Manual test pass: initial AI Describe estimate, then a text correction (e.g. quantity/cooking-method change), confirm the updated draft + ingredients render and the "Log" action still works.

## Files touched

- New: `supabase/functions/fix-meal/index.ts`, `ai/fixMeal.ts`, `ai/aiEdgeClient.ts`
- Edited: `supabase/config.toml`, `supabase/README.md`, `components/addMeal/AITab.tsx`, `ai/estimateNutrition.ts` (refactored to use the new shared client helper)