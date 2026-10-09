---
name: Settings Functional Pass
overview: Implement a high-impact, low-risk next step by making Settings update nutrition goals with persistence and immediate reflection in Today summary.
todos:
  - id: settings-form-ui
    content: Build Settings form inputs prefilled from current goals
    status: completed
  - id: settings-save-logic
    content: Validate and persist goals via updateGoals
    status: completed
  - id: settings-verification
    content: Verify immediate dashboard updates and persistence after restart
    status: completed
isProject: false
---

# Settings Functional Pass

## Why This Is Best Next
- High user impact: goals directly drive dashboard numbers users see daily.
- Low architectural risk: uses existing store/action (`updateGoals`) and current screens.
- Keeps roadmap momentum while Smart Capture remains in spec mode.

## Scope
- Make `Settings` editable and persistent for:
  - Daily calories
  - Protein
  - Carbs
  - Fats
- Wire save action to store and close modal on success.
- Ensure `Today` summary reflects updated goals immediately.

## Files to Update
- [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/settings.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/settings.tsx)
- [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts) (only if minor helper needed)
- [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/index.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/index.tsx) (verify bindings already react to goals)

## Acceptance Criteria
- User can edit all four goal fields in Settings.
- Tapping Save persists values across app restart.
- Dashboard goal values and percentages update correctly.
- Input validation prevents invalid/negative values.
- Lint and runtime remain clean.