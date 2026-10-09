---
name: Phase 2 Next Slice
overview: "Execute the first Phase 2 vertical slice: make meal actions on Today fully functional with an Add/Edit modal flow, while keeping current orange plan-tag styling unchanged."
todos:
  - id: wire-today-actions
    content: Connect + Add meal and MealCard edit/remove handlers on Today screen
    status: completed
  - id: build-meal-modal
    content: Implement Add/Edit modal screen with form + save/update behavior
    status: completed
  - id: verify-persistence
    content: Run manual flow checks and confirm AsyncStorage persistence
    status: completed
isProject: false
---

# Phase 2 Next Slice

## Decision Locked
- Keep `Weekday plan` / `Weekend plan` tag styling orange in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/index.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/index.tsx).

## What We’re Doing Next
- Build **Phase 2 first**, starting with the highest-impact user loop: add a meal, edit a meal, remove a meal from the Today screen.
- Keep scope tight to one vertical path before moving to Plan/Grocery/Library feature tabs.

## Implementation Plan
- Wire the Today actions in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/index.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/index.tsx):
  - `+ Add meal` opens meal modal.
  - `MealCard` edit/remove buttons call concrete handlers.
- Create/finish modal route [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/meal/[id].tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/meal/[id].tsx) for Add/Edit:
  - Form fields: name, time, calories, protein, carbs, fats, ingredients list.
  - Save path updates `addMealToDay` or `editMealOnDay` in store.
- Ensure store usage is complete in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts):
  - Reuse existing CRUD actions.
  - Keep IDs and date scoping deterministic for day logs.
- Update card interaction contract in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/components/MealCard.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/components/MealCard.tsx):
  - Ensure `onEdit` and `onRemove` always invoke real handlers from Today screen.
- Validate by manual run on existing Expo session:
  - Add meal appears immediately in the selected day.
  - Edit updates same meal entry.
  - Remove deletes only that day’s entry.
  - Persist survives app restart (AsyncStorage).

## After This Slice
- Move to the next Phase 2 items: water UX refinements and missed-meal auto-detection.
- Then begin Phase 3 tabs functionality (Plan, Settings, Grocery, Library).