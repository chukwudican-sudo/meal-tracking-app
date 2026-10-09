---
name: build my plan rework
overview: Reorder bottom tabs, rework Build My Plan with onboarding-then-guide flow, elevated card layout, new page logic (PAGE_SIZE = 5 items where Suggest more counts as 1), reset today calendar indicator to green text + dot, harden bottom padding on plan detail page, and drop the "Use last time's answers" feature.
todos: []
isProject: false
---


## Spec → file map

Items 6, 7, 9, 10, 11, 12 are already implemented from earlier sprints. I'll verify each and note status. The substantive new work is items 1, 2, 3, 4, 5, 8, 13.

## 1. Tab order rearrangement

[components/CustomTabBar.tsx](components/CustomTabBar.tsx): change

```tsx
const TAB_ORDER: string[] = ['progress', 'index', 'plan', 'recipes'];
```

to

```tsx
const TAB_ORDER: string[] = ['index', 'plan', 'recipes', 'progress'];
```

App already opens to Home by default (Expo Router `index` is the initial route). No other changes needed; the plus button stays flush right.

## 2 + 3 + 4. Build My Plan elevated card + new page logic + page indicator

All in [app/plan/build.tsx](app/plan/build.tsx). Five sub-changes:

**a. PAGE_SIZE constant + helpers**

```tsx
const PAGE_SIZE = 5;          // total items per page (meals + Suggest more)
const INITIAL_SEED = 9;       // initial meal count for a new slot
const SUGGEST_BATCH = 5;      // meals generated per Suggest more click
const SUGGEST_POPUP_AT = 5;   // click count that triggers the popup
```

**b. Replace `fillPagesWithCards` with a redistribution algorithm.** Pages no longer have a stable identity — instead, every change recomputes the full page list from a flat `meals[]`:

```tsx
function distributeMealsIntoPages(meals: RecipeTemplate[]): Page[] {
  const total = meals.length;
  if (total === 0) return [{ cards: [] }]; // last page is just Suggest more

  // Pages of 5 meals each, last page gets remainder + Suggest more (rendered separately).
  const pages: Page[] = [];
  let i = 0;
  while (total - i > 5) {
    pages.push({ cards: meals.slice(i, i + 5) });
    i += 5;
  }
  // Edge case: if remainder would be 0, demote one meal from previous full page
  // so the last page is "1 meal + Suggest more" instead of "Suggest more alone".
  let remainder = meals.slice(i);
  if (remainder.length === 0 && pages.length > 0) {
    const lastFull = pages[pages.length - 1];
    remainder = [lastFull.cards.pop()!];
  }
  pages.push({ cards: remainder });
  return pages;
}
```

A flat `mealsBySlot: Record<string, RecipeTemplate[]>` becomes the source of truth instead of `pagesBySlot`. Pages are derived. This avoids the "last page kind" ambiguity entirely.

**c. Initial seed is 9, not 4.** Update the seed effect to `buildAutoPage(pool, new Set(), INITIAL_SEED)`.

**d. Suggest more never disappears + 5-click popup.** Drop `AUTO_PAGE_CAP` and `findMoreLocked`. Instead, track `suggestClicksBySlot: Record<string, number>` and a separate `suggestPopupShownBySlot: Record<string, boolean>`. When clicks hit 5 the first time per slot, show a polished popup `<Modal>` styled like the existing Describe popup with two CTAs:
- "Try Describe" → opens the existing Describe modal
- "Keep suggesting" → dismisses

After dismissal, popup never re-shows for that slot but Suggest more keeps working forever.

**e. Elevated card layout.** Restructure the pick render so everything below the title bar lives inside an outer `cardContainer` View with rounded corners, padding, and bottom margin. Outer scaffold:

```tsx
<SafeAreaView edges={['top','bottom']}>
  <StepProgressBar />
  <Header />                                    {/* outside card */}
  <View style={styles.cardContainer}>           {/* the elevated card */}
    <View style={styles.cardIntro}>             {/* instruction + counter */}
    <View style={styles.cardPagerArea}>         {/* horizontal pager, flex:1 */}
    <View style={styles.cardDots}>              {/* page indicator */}
    <View style={styles.cardLockedBottom}>      {/* Describe + skip */}
  </View>
</SafeAreaView>
```

`cardContainer` uses `flex: 1`, `marginHorizontal: 14`, `marginVertical: 12`, `borderRadius: 18`, `backgroundColor: COLORS.card`, `padding: 14`, plus the existing soft shadow tokens. The horizontal pager inside takes `flex: 1` so it fills available height between intro and dots.

**f. Page indicator (iOS-16-style elongated active dot).**

```tsx
{pages.map((_, i) => (
  <View
    key={i}
    style={[
      styles.dot,
      currentPageIdx === i && styles.dotActive,  // wider pill
    ]}
  />
))}
```

Where `dot` is 6×6 round and `dotActive` is `width: 18, height: 6, borderRadius: 3` with the green fill. Smooth `LayoutAnimation.configureNext(easeInEaseOut)` on page change makes the resize feel native.

**g. Selection circle stays removed.** Already done last sprint (corner "Selected" pill).

## 5. Onboarding-before-guide flow

Currently: `guide → onboarding (4q) → pick`. Spec wants: `onboarding (4q) → guide (review) → pick`.

In [app/plan/build.tsx](app/plan/build.tsx):

- Initial step changes from `{ kind: 'guide' }` to `{ kind: 'onboarding', questionIdx: 0 }`.
- Q4's "Next" button now routes to `{ kind: 'guide' }` instead of jumping straight to pick.
- Guide's "Let's go" button now routes to `{ kind: 'pick', slotIdx: 0 }` (already does).
- Guide page content changes: replaces "Here's your existing profile" cards with a combined review showing both profile data (goal, dietary, allergies) AND onboarding answers (cuisines, cook time, loves, avoid). All read-only; no inline edit. Header back arrow returns to Q4.
- **Drop "Use last time's answers"** — remove `lastWizardPrefs`, `PREFS_RECALL_WINDOW_MS`, the recall button on the guide page, and the cache write in Q4's "next". Cleanup also kills the `guideRecallBtn` / `guideRecallBtnText` styles.
- **Keep the "Skip" right-action** in the onboarding header for now per modern UX, **unless you tell me to remove it.** It just sets step to `{ kind: 'guide' }` (i.e., skip directly to review with empty `prefs`).
- Q1 gets a one-line warm-up subhead: "A few quick questions — these are just for this plan, nothing's saved."

## 6. Forward navigation fix — already done

`advanceFromSlot` in [app/plan/build.tsx](app/plan/build.tsx) already checks `nextHasSelections` and routes to summary or pick. No change.

## 7. Rename Swap — already done

Last sprint renamed "Find different meal" → "Swap" in the preview. No change.

## 8. Calendar today indicator (revised)

In [app/(tabs)/plan.tsx](app/\(tabs\)/plan.tsx):

- Drop `monthCellToday` (the green ring border).
- Today (not selected): green text color, with a 4×4 green dot rendered absolutely below the number.
- Selected (not today): keep the filled green tint background (current behavior, no change).
- Today + selected: filled green tint background **plus** the green dot (combine).

```tsx
<Pressable style={[styles.monthCell, isSelected && styles.monthCellSelected]}>
  <Text style={[
    styles.monthCellText,
    !iso && styles.monthCellHiddenText,
    isToday && styles.monthCellTextToday,    // green text
    isSelected && styles.monthCellTextSelected,
  ]}>{iso ? toMidnight(iso).getDate() : ''}</Text>
  {isToday && <View style={styles.monthCellTodayDot} />}
</Pressable>
```

Drop the conditional ring style. The dot now renders for today regardless of selection state.

## 9 + 10. Calendar reset / Planned Ingredients reset — already done

Verified `useFocusEffect` in [app/(tabs)/plan.tsx](app/\(tabs\)/plan.tsx) and [components/grocery/PlannedIngredientsSection.tsx](components/grocery/PlannedIngredientsSection.tsx). No change.

## 11. Bookmark icon — already done

[components/addMeal/ScanTab.tsx](components/addMeal/ScanTab.tsx) uses `Ionicons` `bookmark` / `bookmark-outline`. No change.

## 12. Fix Result keyboard — already done

[components/addMeal/ScanTab.tsx](components/addMeal/ScanTab.tsx) wraps `FixOverlay` in a real `<Modal>` with `KeyboardAvoidingView` at root. No change.

## 13. Bottom padding on premade plan detail (still broken)

In [app/plan/[id].tsx](app/plan/[id].tsx) the footer currently uses `paddingBottom: SCREEN_BOTTOM_INSET` (24) and `SafeAreaView edges={['top','bottom']}`. On non-notched devices this collapses to 24, which is too tight. Switch to direct safe-area math:

```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// in component:
const insets = useSafeAreaInsets();
// in JSX:
<View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
```

Floor: 32 on non-notched, ~50 on notched. Apply the same pattern to other footer-bearing pages I already updated:

- [app/recipe/[id].tsx](app/recipe/\[id\].tsx) (footer)
- [app/plan/day/[date].tsx](app/plan/day/\[date\].tsx) (footer)
- [app/plan/build.tsx](app/plan/build.tsx) (`bottomBar` and `footer` styles)

`SCREEN_BOTTOM_INSET` is no longer needed once we use `useSafeAreaInsets`; I'll keep it exported for any pages I haven't touched but stop importing it in the four files above.

## Diff size estimate

Build file is ~2100 lines; net diff probably ~250 lines (a lot of replacement, not addition). All other files are localized one-screen edits.
