---
name: Fix Global Right-to-Left Page Transition
overview: Fix the global page transition so full-page navigations slide in from the right (iOS push) instead of bottom-up, by switching the shared stack option from fullScreenModal presentation to card presentation.
todos: []
isProject: false
---

## Fix Global Right-to-Left Page Transition

### Root cause
In [meal-app/app/_layout.tsx](meal-app/app/_layout.tsx), the shared `fullScreenSlide` option uses `presentation: 'fullScreenModal'`. On the iOS native stack, `fullScreenModal` is a vertical modal presentation that animates bottom-up and **ignores** the `animation: 'slide_from_right'` prop. The `animation` option only takes effect with `presentation: 'card'` (the default push presentation), which is what produces the standard iOS right-to-left push (and slide-out-to-right on back).

### Change 1 — `fullScreenSlide` constant
Switch presentation to `card`:

```ts
const fullScreenSlide = {
  presentation: 'card',
  headerShown: false,
  animation: 'slide_from_right',
} as const;
```

This propagates to every `Stack.Screen` using `fullScreenSlide` (settings, cart, profile, notifications, kitchen, grocery/planned-ingredients, recipes/*, recipe/*, ai/*, profile/*, settings/*, plan/*, meal-edit/*). Cards still cover the full screen and the tab bar, since these routes are siblings of `(tabs)` at the root stack level.

### Change 2 — `meal/[id]` screen
It has its own inline options with `presentation: 'fullScreenModal'`. Change to match:

```tsx
<Stack.Screen name="meal/[id]" options={{ presentation: 'card', headerShown: false, animation: 'slide_from_right' }} />
```

### Untouched (intentional overlays — verified not stack routes)
- Add Meal `+` screen: RN `<Modal animationType="slide" presentationStyle="fullScreen">` in [meal-app/components/addMeal/AddMealScreen.tsx](meal-app/components/addMeal/AddMealScreen.tsx) — stays bottom-up.
- Scan result half-sheet, `MealDetailModal`, Fix Issue popup, toast/undo hosts, `Alert` dialogs — all in-component React Native overlays, unaffected by stack options.
- The generic `modal` route keeps `presentation: 'modal'`.

### Verification after change
- Tap into Saved Recipes, Recipe preview, Plan sub-pages, Kitchen, Planned Ingredients, Settings/Profile pages: each should slide in from the right and back out to the right.
- Confirm the `+` Add Meal screen still slides up from the bottom.
- Confirm meal detail popup / Fix Issue / toasts still appear as centered/overlay elements (no slide-from-right).