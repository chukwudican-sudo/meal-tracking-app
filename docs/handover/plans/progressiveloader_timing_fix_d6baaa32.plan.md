---
name: ProgressiveLoader Timing Fix
overview: Fix ProgressiveLoader to cycle messages on a fixed, fast cadence for as long as it's mounted instead of pacing against an assumed total duration. Separately, fix generate-recipe-concept's system prompt, which currently invites Gemini to invent cuisine/flavor descriptors the user never typed (confirmed not caused by stored-preference leakage, which was ruled out).
todos:
  - id: fix-progressive-loader-cadence
    content: Rewrite ProgressiveLoader.tsx to cycle on a fixed ~1.2-1.5s interval with wraparound looping, removing cycleDurationMs pacing
    status: completed
  - id: fix-recipe-concept-embellishment
    content: Add an explicit anti-embellishment clause to generate-recipe-concept's system prompt so it stops inventing cuisines/flavor descriptors not present in the user's typed description
    status: completed
isProject: false
---

## 1. Fix: `ProgressiveLoader` timing

**Root cause confirmed** in [components/ProgressiveLoader.tsx](components/ProgressiveLoader.tsx): the interval is currently computed as `cycleDurationMs / messages.length` (default `12000 / 4 = 3000ms` per step). If the real network call finishes faster than one step (e.g. a 2s response), the `setInterval` never fires before the component unmounts, so the user only ever sees `messages[0]` — exactly the "freezing on message one" symptom. None of the 4 current call sites (`app/ai/custom.tsx` x2, `components/grocery/KitchenScanModal.tsx`, `app/ai/what-can-i-make.tsx`) pass `cycleDurationMs`, so it's safe to drop that prop entirely.

**Fix:**
- Replace the duration-paced `stepMs` calculation with a fixed cadence in the 1.2-1.5s range (pick `1350ms` as the default, exposed as an optional `intervalMs` prop for any future override).
- Change index advancement from clamped-at-last (`Math.min(prev + 1, messages.length - 1)` + `clearInterval`) to wraparound (`(prev + 1) % messages.length`), so the sequence keeps cycling continuously for as long as the component stays mounted — covering both very fast responses (now shows real movement instead of freezing on message one) and very slow ones (now keeps cycling instead of going static after the last message during a long tail wait).
- Keep the existing crossfade (`Animated.timing` opacity dip) and `mountedRef` unmount guard unchanged — only the cadence/looping logic changes.
- Remove the now-dead `DEFAULT_CYCLE_MS` constant and `cycleDurationMs` prop/doc comment.

No changes needed at any of the 4 call sites — they only pass `messages`.

## 2. Investigation findings: generate-recipe-concept — preference leakage ruled out, real prompt-wording bug found

Directly verified [supabase/functions/generate-recipe-concept/index.ts](supabase/functions/generate-recipe-concept/index.ts) and [supabase/functions/_shared/mealPromptHelpers.ts](supabase/functions/_shared/mealPromptHelpers.ts):

- `generate-recipe-concept`'s `buildPrompt` only calls `buildUserContext(p)` (goal + calorie target only) and `buildHardConstraints(p, [])` (allergies/dietary prefs; avoid list hardcoded empty). It never imports or calls `buildStyleCues`/`expandFamilyPicks`/`buildRatioInstruction`, and its request-body parsing never reads `cuisines`/`loves`/`avoid` at all. So the original hypothesis (stored cuisine/loved-food prefs leaking in) is **not** the cause — this function structurally cannot leak stored preferences into the prompt; it only ever sees the typed description + meal type + hard constraints.
- `mealType` is correctly user-derived and confirmed by the user to have been "Snacks" for both test generations — fully explaining the repeated "snack bowl" framing (that part is real, matching, user-driven input, not a bug).
- The literal string "snack bowl" does not exist anywhere in the codebase — it isn't a hardcoded example biasing Gemini.

**But the follow-up test cases exposed a real, separate bug:** two independent fresh Describe submissions — "rice and ground chicken" and "rice and beef" — came back as "Teriyaki Ground Chicken and Rice" and "Garlic Beef and Jasmine Rice." Neither flavor/cuisine descriptor ("teriyaki," "garlic," "jasmine") was typed by the user, and both are wholly unrelated to each other, ruling out a one-off. The root cause is in the `system` instruction itself (lines 76-84): it tells Gemini to produce "a short **appetising** recipe name" with no counterbalancing instruction anywhere restricting it to only what the user actually typed — unlike the allergy/avoid-list handling elsewhere in this prompt, which works precisely because it's stated as an explicit, absolute constraint. "Appetising" alone is an open invitation to embellish, and Gemini is doing exactly that, consistently.

**Fix:** add an explicit anti-embellishment clause to the `system` string in [supabase/functions/generate-recipe-concept/index.ts](supabase/functions/generate-recipe-concept/index.ts), and adjust "appetising" so it's no longer the sole/dominant naming directive. Proposed rewording (final copy can be refined at implementation time, but this is the shape):

```typescript
const system =
  'You are a recipe-concept assistant. Given a freeform description of a ' +
  'recipe the user wants, return a lightweight PREVIEW concept only: a clear, ' +
  'accurately-named recipe (based only on what the user actually described — ' +
  'do not invent a cuisine style, sauce, or flavor descriptor the user did not ' +
  'mention or clearly imply), a one- or two-sentence description, and a rough ' +
  'per-serving macro estimate (calories + protein/carbs/fats in grams). Do ' +
  'NOT return an ingredient list or cooking steps — those come later. Keep ' +
  'the estimate realistic for a single serving. Allergies and dietary ' +
  'preferences are HARD constraints you must never violate. Respond with JSON ' +
  'only, matching the provided schema.';
```

This keeps the response format and hard-constraint handling identical — only the naming/description guidance changes. No other function needs this treatment: `generate-meal-suggestions` and `generate-plan-shortlist` don't have this problem because their prompts explicitly frame cuisine/flavor words as deliberate, ratio-controlled style cues (`buildStyleCues`/`buildRatioInstruction`), never as unconstrained "make it sound appetising" free rein.
