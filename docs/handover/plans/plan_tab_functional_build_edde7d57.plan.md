---
name: Plan Tab Functional Build
overview: Implement a progress-first Plan tab with a full-year heatmap, mini-month day jump, robust recurrence rules, strict template validation, and calendar-style edit/delete scope controls with Undo.
todos:
  - id: plan-progress-and-heatmap
    content: Implement progress-first top section with calendar-year heatmap and agreed intensity/visibility rules
    status: completed
  - id: plan-mini-month-and-week-editor
    content: Implement mini-month jump-day behavior and Monday-first week schedule editor
    status: completed
  - id: plan-template-crud-recurrence
    content: Implement strict template add/edit/delete flows with recurrence options and scope prompts
    status: completed
  - id: plan-reorder-time-and-undo
    content: Implement drag override with forced time picker and wire Undo for edit/delete/reorder
    status: completed
  - id: plan-year-logic-and-validation
    content: Implement conditional multi-year browsing and complete manual/lint verification
    status: completed
isProject: false
---

# Plan Tab Functional Build

## Locked Product Decisions
- Primary focus is **progress-first**.
- Top section is a **full-year heatmap (calendar year)**.
- Heatmap is **read-only** (no tap action).
- Heatmap metric is **% planned meals completed per day** with coarse buckets:
  - `0%`
  - `1-33%`
  - `34-99%`
  - `100%`
- `0%` and no-plan days use the same lowest-intensity state (per your choice).
- Future days are hidden from progress visuals.
- Progress data is derived virtually (no eager log creation for metrics).
- Year behavior:
  - If only current year has logs, show only current year.
  - When other years gain logs, enable year browsing for those years.
- Layout order: **Progress -> Mini month -> Week schedule editor**.
- Week starts on **Monday**.
- Mini month date selection performs **jump-day** behavior.
- Recurrence v1 includes:
  - once-date
  - daily
  - weekly-selected-days
  - every-x-days
  - every-x-weeks
  - monthly
- Add-template entry points: **header + button** and **per-day + button**.
- Template edit scope prompt: **This one / This+future (default) / All**.
- Delete scope prompt: **This one / This+future / All** + Undo support.
- Undo in Plan tab v1 for:
  - template delete
  - template edit
  - drag reorder
- Default day list sorting: time ascending.
- Reorder model: hybrid; drag override requires **time picker confirmation**.
- Template validation is strict: require name, time, calories, macros, ingredients, recurrence.

## Implementation Scope
- Build Plan tab from placeholder to functional editor in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/plan.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/plan.tsx).
- Extend template recurrence/data handling in:
  - [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/types.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/types.ts)
  - [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts)
- Reuse existing global undo system for Plan actions:
  - [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useUndoStore.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useUndoStore.ts)

## Build Sequence
1. Add recurrence model support and strict validation contracts in store/types.
2. Implement progress derivation helpers (calendar year heatmap, hidden future days, intensity buckets).
3. Build Progress block + mini-month + Monday-first week schedule UI.
4. Implement add/edit/delete template flows with scope prompts and strict validation.
5. Implement drag reorder with mandatory post-drag time picker.
6. Wire Undo for edit/delete/reorder in Plan actions.
7. Add year visibility logic (current-year-only unless additional years have logs).
8. Verify lint + runtime and manual scenario checks.

## Verification Checklist
- Heatmap renders current year correctly with chosen bucket intensities and hidden future days.
- Mini month jump-day updates selected day/week context correctly.
- Recurrence rules save and render correctly for all selected modes.
- Strict validation blocks incomplete template saves.
- Edit and delete prompts show 3 scope options with This+future default on edit.
- Undo works for edit/delete/reorder actions.
- Drag reorder always requests new time confirmation.
- Year selector appears only when more than one year has completion logs.
- Lint and runtime checks pass.