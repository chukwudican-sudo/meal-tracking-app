---
name: Home Progress, Weight Chart, Recipe FAB, Edit Goal
overview: "Four changes: replace the Create Recipe bottom bar with a floating action button in SavedRecipesView; fix the home tab macro totals reactivity; add a weight log input and line chart to the Progress tab; and wire the Edit Goal \"Yes, update plan\" path to auto-save the current plan and navigate to Build My Plan."
todos:
  - id: fab-create-recipe
    content: Replace CreateBar bottom bar with FAB in SavedRecipesView.tsx
    status: completed
  - id: home-macro-fix
    content: Fix home tab macro totals reactivity by switching to per-field Zustand selectors in app/(tabs)/index.tsx
    status: completed
  - id: weight-chart
    content: Add weight log input and SVG line chart to Progress tab
    status: completed
  - id: edit-goal-plan
    content: Wire edit-goal persist() to auto-save plan and navigate to Build My Plan when user chooses Yes
    status: completed
isProject: false
---

# Home Progress, Weight Chart, Recipe FAB, Edit Goal

## 1. Floating Create Recipe Button — `SavedRecipesView.tsx`

Remove the `createBar` + `createBtn` block at the bottom.  
Add a FAB anchored `position: absolute, right: 18, bottom: 18 + bottomInset` (via `useSafeAreaInsets`).

```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// ...
const insets = useSafeAreaInsets();

// JSX (inside the container View):
<TouchableOpacity
  style={[styles.fab, { bottom: Math.max(insets.bottom, 12) + 12 }]}
  onPress={handleCreateNew}
  activeOpacity={0.85}
>
  <Text style={styles.fabText}>＋</Text>
</TouchableOpacity>
```

Style matches the recipe detail page FAB:
```ts
fab: {
  position: 'absolute',
  right: 18,
  width: 54,
  height: 54,
  borderRadius: 27,
  backgroundColor: COLORS.green,
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: '#000',
  shadowOpacity: 0.3,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
},
fabText: { color: '#0E1A12', fontSize: 26, fontWeight: '800', lineHeight: 28 },
```

Remove the now-unused `createBar`, `createBtn`, `createBtnText` styles.  
Also remove the `onCreateNew` prop from `SavedList` and any empty-state create-new buttons inside the list — the FAB is the sole entry point.

---

## 2. Home Tab Macro Progress Bug — `app/(tabs)/index.tsx`

The home screen calls `useMealStore()` without a selector, destructuring `logs` from the full state object. Switching to per-field selectors is the reliable Zustand pattern and removes any ambiguity about when equality checks fire.

Replace the single `useMealStore()` call with individual selectors:

```ts
const logs               = useMealStore(s => s.logs);
const goals              = useMealStore(s => s.goals);
const streak             = useMealStore(s => s.streak);
const toggleMealStatus   = useMealStore(s => s.toggleMealStatus);
const markPastDueMeals   = useMealStore(s => s.markPastDueMealsAsMissed);
const logWater           = useMealStore(s => s.logWater);
const resolveDayFromTemplates = useMealStore(s => s.resolveDayFromTemplates);
const recalcStreak       = useMealStore(s => s.recalcStreak);
const openMealEditSession = useMealStore(s => s.openMealEditSession);
```

The derived `completedMeals` → `totals` → `caloriePct` chain already runs at render time, so once `logs` is reactive, the progress bar and macro numbers will update immediately on each toggle.

---

## 3. Weight Logging on Progress Tab — `app/(tabs)/progress.tsx`

The store already has `WeightLogEntry[]`, `weightLog` state, and `logWeight(weightKg)` action. Only the UI is missing.

### Input
Add a "Log Weight" section above the placeholder card:

```tsx
<WeightSection />
```

`WeightSection` is an inline component in `progress.tsx`:
- A row: "Weight" label on left, current value (from `profile.weightKg`) on right, and a "+ Log" button.
- Tapping "+ Log" opens a small inline input that appears below (no modal needed — just `useState`). User types a number, taps "Save", which calls `logWeight(value)` and collapses the input.
- Below that input: a simple line chart of `weightLog` entries over time.

### Chart
No third-party charting library is needed. Render as a plain SVG polyline using `react-native-svg` (already installed). X-axis = dates, Y-axis = weight values. Show last 30 entries max.

Key logic:
```ts
const weightLog = useMealStore(s => s.weightLog);
const profile   = useMealStore(s => s.profile);
const logWeight = useMealStore(s => s.logWeight);
// Last 30 entries, already sorted chronologically.
const recent = weightLog.slice(-30);
// Normalize: map each entry to (x%, y%) inside a fixed SVG viewBox.
```

SVG chart dimensions: 300 × 120 in a responsive container (measured via `onLayout`).  
Plot dots + polyline. Show first/last date labels on x-axis, min/max weight on y-axis.  
Empty state: "Log your first weight to start tracking."

---

## 4. Edit Goal → Update Plan — `app/profile/edit-goal.tsx`

The `persist()` function already receives `_alsoUpdatePlan` (boolean) but ignores it. Wire it up:

```ts
const templates        = useMealStore(s => s.templates);
const saveCurrentPlanAs = useMealStore(s => s.saveCurrentPlanAs);

const persist = (t: GoalTargets, updatePlan: boolean) => {
  // Save profile + goals (unchanged)
  updateProfile({ goalType, activityLevel: activity });
  if (weightKg != null && weightKg !== profile.weightKg) logWeight(weightKg);
  updateGoals(next);

  if (updatePlan) {
    // Auto-save current plan only if it has meals
    if (templates.length > 0) {
      const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      saveCurrentPlanAs(`Auto-saved Plan – ${today}`);
    }
    // Replace the current route (edit-goal) so back from Build My Plan
    // goes to Profile, not back into the stale edit-goal screen.
    router.replace('/plan/build');
  } else {
    router.back();
  }
};
```

Also update the `Alert` button labels for clarity:
- "No, keep current plan" (was "No, just save targets")
- "Yes, build new plan" (was "Yes, update plan")

No other files change for item 4.

---

## Files changed
- [meal-app/components/recipes/SavedRecipesView.tsx](meal-app/components/recipes/SavedRecipesView.tsx)
- [meal-app/app/(tabs)/index.tsx](meal-app/app/(tabs)/index.tsx)
- [meal-app/app/(tabs)/progress.tsx](meal-app/app/(tabs)/progress.tsx)
- [meal-app/app/profile/edit-goal.tsx](meal-app/app/profile/edit-goal.tsx)
