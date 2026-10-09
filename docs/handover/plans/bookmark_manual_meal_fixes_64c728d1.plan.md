---
name: Bookmark Manual Meal Fixes
overview: Refine recipe-card add/bookmark behavior (no + on front-page browse cards, bookmark+add side by side on the preview, global bookmark + standardized toasts), give the Manual add-meal tab a landing page plus a redesigned form (back arrow header, meal-type chips, bottom "Log Meal" button) that returns to Home, and make the meal-detail popup image a large square.
todos:
  - id: bookmark-toast
    content: Standardize favourite toast wording in useRecipeActions; add Added/Removed from Saved Recipes toast to MealDetailModal toggleBookmark
    status: completed
  - id: frontpage-cards
    content: Remove + from Recipes-tab front-page browse cards (CategoryRow) and show the meal-type tag; tap opens preview. Keep + on all other card instances.
    status: completed
  - id: preview-plus
    content: Add a + (add-to-today) icon beside the bookmark on the recipe preview header, visually distinct; wire to addToToday with the Added to today toast.
    status: completed
  - id: mealform-redesign
    content: "Redesign MealForm: back-arrow header, meal-type chips, bottom primary button, add category to MealFormValues; update EditMealScreen call site"
    status: completed
  - id: manual-landing
    content: Add landing page (plus icon + text) to ManualTab and wire form with Log Meal, category tagging, and navigate to Home on submit
    status: completed
  - id: popup-square-image
    content: Make MealDetailModal image/placeholder a full-width square (aspectRatio 1)
    status: completed
isProject: false
---

## Item 1 — clarified behavior (locked by user)
- Recipes-tab front-page browse cards (premade "Explore"/category rows): NO + icon. Show thumbnail, name, calories, meal-type tag only. Tap opens the recipe preview.
- All other recipe card instances keep the + (add-to-today) button unchanged: Saved Recipes page, the + button Search tab (stays open after +), the recipes-tab inline search results, and the category See-all page.
- Recipe preview page: bookmark AND + side by side at top-right, visually distinct. Bookmark toggles global saved state + "Added/Removed from Saved Recipes" toast; + adds to today + "Added to today" toast.
- Global bookmark state unchanged: a favourited meal shows filled wherever a bookmark icon appears (meal-detail popup, recipe preview, full recipe detail). This already derives from `savedRecipes[].favourited` in the store.

Decision note: the no-+ rule targets the front-page compact browse cards specifically (they currently also lack the meal-type tag). The category See-all route and the recipes-tab inline search keep their existing + per "keep + everywhere else".

## 1a. Bookmark — global toast wording
- [meal-app/hooks/useRecipeActions.ts](meal-app/hooks/useRecipeActions.ts): in `favourite`, change toast strings from `'Saved to recipes'` / `'Removed from favourites'` to `'Added to Saved Recipes'` / `'Removed from Saved Recipes'`. This already drives recipe preview/detail toggles.
- [meal-app/components/MealDetailModal.tsx](meal-app/components/MealDetailModal.tsx): `toggleBookmark` currently calls `toggleFavouriteRecipe(...)` with no toast. Capture its return and call `useToastStore.showToast(updated.favourited ? 'Added to Saved Recipes' : 'Removed from Saved Recipes')`. (`showToast` is already imported.) State stays global since the popup derives `favourited` from `savedRecipes` and the store matches by recipeId/name.

## 1b. Front-page browse cards — remove +, add meal-type tag
- [meal-app/components/recipes/CategoryRow.tsx](meal-app/components/recipes/CategoryRow.tsx): drop the `onAdd` prop and stop passing `onAdd` to `RecipeCard`; pass `category={r.category}` so the compact card renders its meal-type tag (the compact `RecipeCard` already shows a tag when `category` is set and renders no + when `onAdd` is absent).
- [meal-app/app/(tabs)/recipes.tsx](meal-app/app/(tabs)/recipes.tsx): stop passing `onAdd` to `CategoryRow` (the front-page category rows). Leave the inline `SearchResults` cards' `onAdd={handleAdd}` as-is. `handleAdd` stays (still used by inline search).

## 1c. Recipe preview — bookmark + add side by side
- [meal-app/app/recipe/[id].tsx](meal-app/app/recipe/[id].tsx): bring in `addToToday` from `useRecipeActions`. In `Header`, render the + button next to the bookmark (right side), with clear separation/styling so they are not easily mis-tapped: bookmark = plain `Ionicons` bookmark/bookmark-outline; + = small filled green circle (mirror the `RecipeCard` plus button). Wire + to `addToToday(recipeInput, { save: false })` (its undo toast already reads "Added to today"); keep bookmark on `favourite(recipeInput)`.

## 2 + 3. Manual tab — landing page + redesigned form
Add `category` support to the shared form, then give the Manual tab a landing → form flow.

- [meal-app/components/MealForm.tsx](meal-app/components/MealForm.tsx):
  - Add `category?: RecipeCategory` to `MealFormValues`; track `const [category, setCategory] = useState(initial?.category)`.
  - Replace the Cancel/title/Save header with a single left-aligned back arrow (`Ionicons "chevron-back"`) calling a new `onBack` prop. Remove `title`/`submitLabel`/`onCancel`-based header.
  - Add a "Meal type" chip row (Breakfast / Snacks / Lunch / Dinner from `RecipeCategory`) between Time and Calories; tapping sets `category` (single-select, reuses chip styling like [SavedRecipesView.tsx](meal-app/components/recipes/SavedRecipesView.tsx) `filterChip`).
  - Move submit to a bottom full-width primary button with a configurable `primaryLabel` (default "Save"); include `category` in the emitted values.
- [meal-app/components/addMeal/ManualTab.tsx](meal-app/components/addMeal/ManualTab.tsx):
  - Add local `mode: 'landing' | 'form'` state. Landing = centered large plus icon + "Create a new meal" + subtitle "Enter nutrition details manually"; tapping enters `'form'`.
  - Render `MealForm` with `primaryLabel="Log Meal"`, `showMealType`, `onBack={() => setMode('landing')}`.
  - In `handleSubmit`, set `category: values.category` on the logged `MealEntry` and pass `category` to `ensureRecipeSaved` so Recently Added is tagged. After logging, navigate to the Home tab (`router.navigate('/(tabs)')` via `expo-router`) then call `onCreated()` so the modal closes onto Home.
- [meal-app/components/EditMealScreen.tsx](meal-app/components/EditMealScreen.tsx) (currently dead code but still compiled): update its `MealForm` usage to the new props (`onBack={onClose}`, `primaryLabel="Save"`) so the project keeps compiling.

## 4. Meal-detail popup — large square image
- [meal-app/components/MealDetailModal.tsx](meal-app/components/MealDetailModal.tsx): change `styles.image` and `styles.imagePlaceholder` from fixed `height: 150/130` to `aspectRatio: 1` (full-width square). The card already uses `maxHeight: '88%'` with an inner `ScrollView`, so the taller content grows then scrolls; everything below shifts down naturally.

## Notes
- AI/Report remain shells; no store schema changes needed (`MealEntry.category`, `ensureRecipeSaved` category, and `savedRecipes.favourited` already exist).
- Chip labels use the existing `RecipeCategory` values (note: "Snacks", not "Snack") so tagging matches the Saved Recipes filters.