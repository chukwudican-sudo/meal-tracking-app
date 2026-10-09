---
name: Unified Recipe Page and UI Updates
overview: Rewrite SavedRecipesView as a 4-tab unified page (All / Saved / Recent / Recipes) with context-dependent behavior, filter popup, and inline search bar; rename Favourites/Recently Added terminology; add Planned Ingredients full page; flatten the Kitchen page; and change all full-page transitions from bottom-up to right-to-left.
todos:
  - id: rename-strings
    content: Rename 'Favourites'→'Saved' and 'Recently Added'→'Recent' in SavedRecipesView tab labels and empty messages; update ScanTab favourite toast strings
    status: completed
  - id: unified-page
    content: "Rewrite SavedRecipesView: 4 tabs (All/Saved/Recent/Recipes), inline search bar, filter popup icon replacing chips, context-aware behavior (saved-recipes/swap/search-tab), premade templates in All+Recipes tabs, Create new recipe bottom button"
    status: completed
  - id: unified-consumers
    content: Update app/recipes/saved.tsx and SearchTab.tsx to pass the new context prop
    status: completed
  - id: preview-button-swap
    content: "Swap + and bookmark order in app/recipe/[id].tsx header: + on left, bookmark on right"
    status: completed
  - id: addtoday-toast
    content: Capitalize 'Added to Today' in useRecipeActions showUndo message
    status: completed
  - id: planned-ingredients-page
    content: Create app/grocery/planned-ingredients.tsx full page with search, counter, category-grouped ingredient rows, toast actions, empty state; replace PlannedIngredientsSection on Plan tab with a tappable button; register route in _layout.tsx
    status: completed
  - id: kitchen-flat
    content: Remove card wrapper from KitchenSection.tsx so My Kitchen renders as a flat page
    status: completed
  - id: global-animation
    content: Change fullScreenSlide animation from slide_from_bottom to slide_from_right in app/_layout.tsx; add same to meal/[id] entry
    status: completed
isProject: false
---

# Unified Recipe Page, Navigation, and UI Updates

## Files touched at a glance

- [meal-app/components/recipes/SavedRecipesView.tsx](meal-app/components/recipes/SavedRecipesView.tsx) — full rewrite (unified 4-tab page)
- [meal-app/app/recipes/saved.tsx](meal-app/app/recipes/saved.tsx) — pass new `context` prop
- [meal-app/components/addMeal/SearchTab.tsx](meal-app/components/addMeal/SearchTab.tsx) — pass new `context` prop
- [meal-app/hooks/useRecipeActions.ts](meal-app/hooks/useRecipeActions.ts) — capitalize "Added to Today"
- [meal-app/components/addMeal/ScanTab.tsx](meal-app/components/addMeal/ScanTab.tsx) — rename favourite toasts
- [meal-app/app/recipe/[id].tsx](meal-app/app/recipe/[id].tsx) — swap + and bookmark button order
- [meal-app/app/(tabs)/plan.tsx](meal-app/app/(tabs)/plan.tsx) — replace `PlannedIngredientsSection` with a button
- [meal-app/components/grocery/PlannedIngredientsSection.tsx](meal-app/components/grocery/PlannedIngredientsSection.tsx) — convert to full-page component
- New file: [meal-app/app/grocery/planned-ingredients.tsx](meal-app/app/grocery/planned-ingredients.tsx) — new route
- [meal-app/app/_layout.tsx](meal-app/app/_layout.tsx) — register new route; change `slide_from_bottom` → `slide_from_right`
- [meal-app/components/grocery/KitchenSection.tsx](meal-app/components/grocery/KitchenSection.tsx) — remove card wrapper, flatten layout
- [meal-app/app/kitchen.tsx](meal-app/app/kitchen.tsx) — minor style cleanup after KitchenSection flattening

---

## 1. Rename "Favourites" → "Saved", "Recently Added" → "Recent"

- `SavedRecipesView.tsx`: `TAB_DEFS` labels, empty messages ("No favourites yet" → "Nothing saved yet").
- `ScanTab.tsx` lines 214/227: `'Removed from Favourites'` → `'Removed from Saved Recipes'`, `'Added to Favourites'` → `'Added to Saved Recipes'`.
- All comment strings can stay unchanged (internal docs).

---

## 2. Unified 4-tab recipe page — rewrite `SavedRecipesView`

### New props interface
```ts
interface Props {
  mode: 'full' | 'embedded';
  context: 'saved-recipes' | 'swap' | 'search-tab';
  swapFilter?: RecipeCategory | 'All'; // only used when context='swap'
}
```

### Tabs (4)
| idx | key | label | Data source |
|-----|-----|-------|-------------|
| 0 | `all` | All | All `savedRecipes` + premade `recipes` not already in `savedRecipes` (deduped by `recipeId`). Saved entries sorted newest-first; premade templates appended sorted by category/name. |
| 1 | `saved` | Saved | `savedRecipes.filter(r => r.favourited)` sorted newest-first. |
| 2 | `recent` | Recent | `savedRecipes.filter(r => r.source !== 'premade')` sorted newest-first. |
| 3 | `recipes` | Recipes | `recipes` (premade `RecipeTemplate[]`) sorted by category/name. |

### Default tab by context
- `saved-recipes` → index 1 (Saved)
- `swap` → index 0 (All)
- `search-tab` → index 2 (Recent)

### Title by context
- `saved-recipes` → "Saved Recipes"
- `swap` → "Swap Meal"
- `search-tab` → no title (embedded, back arrow hidden via `mode='embedded'`)

### Search bar (inline, always visible)
Replace the 🔍 icon-that-opens-overlay approach with a permanent `TextInput` in the header row. Searching filters the currently active tab's list client-side.

```
[← back]  [🔍 Search recipes…──────────────]  [filter icon]
```

### Filter popup (replaces filter chips row)
Remove the horizontal `ScrollView` of filter chips entirely. Add an `Ionicons "options-outline"` filter icon at the right of the search bar. Tapping opens a small centered `Modal` (or inline anchored popover) showing the 5 options (All / Breakfast / Snacks / Lunch / Dinner). Selecting one sets `filter` state and closes the popup. Show a colored dot badge on the icon when a non-All filter is active.

### Animated underline
Extend the existing `Animated.Value` approach to 4 tabs. `inputRange: [0, 1, 2, 3]`, `outputRange` maps each tab position using measured `tabsWidth`.

### Card behavior by context
| context | onAdd | onPress (non-swap) | onPress (swap) |
|---------|-------|-------------------|----------------|
| `saved-recipes` | `addToToday` (stays on page) | open preview | — |
| `swap` | none (no + shown) | select + executeSwap + back | select + executeSwap + back |
| `search-tab` | `addToToday` (stays on page) | open preview (onBeforeNavigate first) | — |

For premade templates in swap mode: call `ensureRecipeSaved` before `executeSwap` (mirrors existing plan-swap logic).

### "Add to today" for premade templates
Use `addToToday(toRecipeInputFromTemplate(template), { save: false })` — same as the existing Recipes tab behavior.

### Create new recipe button (bottom, always visible)
Fixed `View` below the pager → green outlined button "＋ Create new recipe" → `router.push('/ai/custom')`.

### Consumer updates
- `app/recipes/saved.tsx`: pass `context={swapMode ? 'swap' : 'saved-recipes'}`.
- `components/addMeal/SearchTab.tsx`: pass `context="search-tab"`.

---

## 3. Recipe preview — swap button order (spec item 4)

In `app/recipe/[id].tsx` `Header`, move the green + circle to the **left** side of the `headerActions` row and the bookmark to the **right**. Currently the order is `[bookmark, +]`; change to `[+, bookmark]`.

---

## 4. Standardize "Added to Today" text (spec item 5)

In `hooks/useRecipeActions.ts`, change `showUndo({ message: 'Added to today', ... })` to `'Added to Today'` (capital T) to match the spec wording everywhere.

---

## 5. Planned Ingredients — full page (spec item 9)

### Plan tab change (`app/(tabs)/plan.tsx`)
Replace `<PlannedIngredientsSection />` with a tappable button card:
```tsx
<TouchableOpacity onPress={() => router.push('/grocery/planned-ingredients')} ...>
  <Text>Planned Ingredients</Text>
  {count > 0 && <Badge>{count}</Badge>}
  <Chevron />
</TouchableOpacity>
```

### New route `app/grocery/planned-ingredients.tsx`
Register in `app/_layout.tsx` as `<Stack.Screen name="grocery/planned-ingredients" options={fullScreenSlide} />` (now `slide_from_right`).

The page contains:
- Back arrow + "Planned Ingredients" title header.
- Inline search `TextInput` to filter by name.
- Counter subheading: `"{count} ingredients to sort"`.
- Ingredients grouped under `IngredientCategory` headers (using existing `item.category`). Reuse the `sortIngredient` / `skipIngredient` / `showToast` logic already in `PlannedIngredientsSection`.
- Each row: ingredient name + meal tag (left), then `[In stock]` `[Need it]` `[Skip]` buttons (right) — same toasts as existing ("Moved to Kitchen" / "Added to Cart").
- When `planned.length === 0`: empty state "All done! Your ingredients are sorted."
- No collapse/reset behavior (that's gone with the full-page approach).

`PlannedIngredientsSection.tsx` can be kept as-is (other callers may exist) or stripped to just a small button. Since the Plan tab is the only importer, it will simply be replaced by the inline button.

---

## 6. My Kitchen — flatten layout (spec item 10)

### `components/grocery/KitchenSection.tsx`
Remove the outer `<View style={styles.wrap}>` card container (the one with `backgroundColor`, `borderRadius`, `borderWidth`). The content (add-input bar, categorized items, Go to Cart link) renders directly on the page background. Remove the `wrap` style entry.

### `app/kitchen.tsx`
Already has the correct flat-page structure (back arrow, centered title, CartIcon). Minor: remove extra `paddingTop/bottom` from `scroll` style if it creates double-spacing after removing the card, to keep the layout clean and tight.

---

## 7. Global transition: right-to-left (spec item 11)

In `app/_layout.tsx`, change the `fullScreenSlide` constant:
```ts
const fullScreenSlide = {
  presentation: 'fullScreenModal',
  headerShown: false,
  animation: 'slide_from_right',   // was 'slide_from_bottom'
} as const;
```

This change propagates to every `Stack.Screen` that uses `fullScreenSlide`. The `modal` route (`presentation: 'modal'`) is unaffected. `MealDetailModal`, Fix Issue popup, toast overlays, confirmation `Alert`s are React Native components — not stack routes — and are completely unaffected.

`meal/[id]` currently uses `{ presentation: 'fullScreenModal', headerShown: false }` with no explicit animation. Add `animation: 'slide_from_right'` to that entry as well so it matches.

---

## Notes
- `executeSwap` already calls `ensureRecipeSaved` for the plan-swap case. The unified page's All/Recipes tab swap path needs the same call for premade templates before invoking the swap.
- The `newRecipeIds` "NEW" pill logic is preserved on Saved/Recent tabs (only applies to user-created content).
- Existing `swapMode` route params (`/recipes/saved?swapMode=true&swapFilter=Dinner`) are mapped inside `app/recipes/saved.tsx` to the new `context` prop — no changes to callers (Day Detail, Customize Plan, MealDetailModal).
- Items 6 (Recipes tab front-page cards — no +) and 8 (sort options removed) are already implemented from the previous session.
