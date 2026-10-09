---
name: Rewrite meal-suggestion prompt personalization
overview: Rewrite buildPrompt() in generate-meal-suggestions/index.ts so avoid is a hard constraint like allergies, cuisines/loves are explicit light-variety cues capped by a computed ratio, and a Describe description dominates (dropping conflicting cuisine/loved-food cues) while avoid/allergies still always apply.
todos: []
isProject: false
---


## Scope

Single-file change: [supabase/functions/generate-meal-suggestions/index.ts](supabase/functions/generate-meal-suggestions/index.ts), only the `buildPrompt()` function (lines 150-200). No changes to the request/response schema, sanitization, rate limiting, entitlement, or client wrapper — this is purely a prompt-text rewrite.

## New `system` text

Replace the single classification sentence with three explicit tiers instead of a binary hard/soft split:

```
You are a meal-planning assistant. Generate exactly {count} distinct, practical {mealType} idea(s) personalised to the user. Allergies, the user's avoid list, and dietary preferences are HARD constraints you must never violate — never include allergens, never include anything on the avoid list, and always respect dietary restrictions, no exceptions. Cuisines and loved foods are light flavor cues for variety only, not requirements — most suggestions should be genuinely varied, general, traditional dishes across different culinary styles rather than repeatedly leaning into the same cuisine or loved foods. Cook time is a soft preference: honour it when possible. Each suggestion needs a short name, a calorie estimate for one serving, cookTimeMin, difficulty (Easy/Medium/Hard), macros (protein/carbs/fats in grams), an ingredients list with quantity and unit, and clear numbered cooking steps. Vary the suggestions so they are meaningfully different from one another. Respond with JSON only, matching the provided schema.
```

## New `userText` structure

Restructure into four labeled blocks instead of the current `context`/`biases` pair, so the model sees an unambiguous hard/soft split:

1. **Informational context** (goal, calorie target only — not a constraint):
   `User context: Goal: {goal_type}. Daily calorie target: {n} kcal.`

2. **Hard constraints** (dietary preferences + allergies + avoid, all in one block, worded identically in strength):
   `Hard constraints (must always respect, no exceptions): Dietary preferences: {...}. Allergies: {...}. Foods to avoid (same weight as allergies): {...}.`

3. **Style cues** (cuisines + loves + cook time, explicitly labeled as non-binding):
   `Style cues (light variety flavor only, not requirements): Cuisines: {...}. Loved foods: {...}. Prefer {cookTime label}.`

4. **Ratio instruction** — only added when there's no `description` and at least one of cuisines/loves is present, computed server-side (no model-judged ratio):
   ```
   function buildRatioInstruction(count: number): string {
     const low = Math.max(1, Math.floor(count / 4));
     const high = Math.max(low, Math.round(count / 3));
     const range = low === high ? `${low}` : `${low}-${high}`;
     return `Exactly ${range} of these ${count} suggestions should lean into the style cues above; the rest must be genuinely varied, general, traditional dishes across different culinary styles — not thematically repetitive.`;
   }
   ```
   For the current batch size (`SUGGEST_BATCH = 5`), this yields "Exactly 1-2 of these 5 suggestions...". Same formula every call — no escalating/session-tracked logic, matching your requirement.

5. **Description-dominance instruction** — only added when `description` is present, replacing today's "prioritise over soft preferences" line:
   ```
   The user specifically described what they want: "{description}". Follow this description closely — it is the dominant instruction. The style cues above (cuisines, loved foods) only apply if they don't conflict with the description; drop them entirely if they would. The hard constraints above (allergies, avoid list, dietary preferences) still always apply, no matter what the description says.
   ```
   Since Describe always sends `count: 1`, the ratio instruction (4) is naturally skipped whenever a description is present — no explicit mutual-exclusion flag needed, just the existing `if (prefs.description)` branch.

6. Closing line unchanged: `Generate {count} {mealType} suggestion(s).`

## Verification

- Read back the generated `system`/`userText` for both the batch case (cuisines/loves/avoid set, no description) and the Describe case (description set) to confirm wording matches the three requirements before deploying.
- Deploy via `supabase functions deploy generate-meal-suggestions` (same as the original build).
- No client-side (`app/plan/build.tsx`, `ai/generateMealSuggestions.ts`) changes needed — the request shape is unchanged.
