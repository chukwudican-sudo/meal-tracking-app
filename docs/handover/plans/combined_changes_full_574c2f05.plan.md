---
name: Combined Changes Full
overview: Restructure bottom nav (Progress/Home/Plan/Recipes + global + button), rename Today to Home, redesign the Scan result as a camera-background half-sheet, add a Current Plan card and Customize Plan flow to the Plan tab, auto-snap the heatmap, and remove the Duration field from Edit Meal.
todos:
  - id: nav-plus-button
    content: "Restructure bottom nav: custom tab bar (Progress/Home/Plan/Recipes + + button), lift AddMealScreen to _layout.tsx, rename Today to Home in index.tsx header, remove old + Add meal button from Home tab"
    status: completed
  - id: scan-halfsheet
    content: "Redesign ScanTab: camera-background half-sheet after scan with serving counter, health rating badge, bookmark, Fix/Retake/Log buttons. Log button adds meal to today and returns to Home tab"
    status: completed
  - id: plan-current-card
    content: Add Current Plan card at top of plan.tsx (above Build/Find tiles), default Planned Ingredients to collapsed
    status: completed
  - id: customize-plan
    content: "Add Customize Plan flow to plan/[id].tsx: local draft state, global meal removal with undo toast, day cards navigate to Day Detail, Save/Cancel with discard alert. Add updateSavedPlan store action"
    status: completed
  - id: heatmap-improvements
    content: "Progress heatmap: auto-snap to current month on load using ScrollView ref + scrollTo, useFocusEffect resets year to current on tab visit, year label becomes tappable dropdown when multiple years exist"
    status: completed
  - id: remove-duration
    content: Remove Duration field entirely from EditMealScreen (state, form rendering, template construction, picker branch)
    status: completed
  - id: lint-commit
    content: Run npm run lint, fix any errors, commit and push to GitHub
    status: completed
isProject: false
---

# Combined Changes — Full Implementation

## Phase 1 — Bottom nav + global + button

### [`app/(tabs)/_layout.tsx`](app/(tabs)/_layout.tsx)

Replace standard `Tabs` options with a `tabBar` prop pointing to a new `CustomTabBar` component. Tab order changes to: Progress → Home (index) → Plan → Recipes.

```tsx
<Tabs
  initialRouteName="index"
  tabBar={(props) => <CustomTabBar {...props} />}
  screenOptions={{ headerShown: false }}
>
  <Tabs.Screen name="progress" ... />
  <Tabs.Screen name="index"    ... />
  <Tabs.Screen name="plan"     ... />
  <Tabs.Screen name="recipes"  ... />
</Tabs>
```

The `AddMealScreen` (global) and its `addMealVisible` state are lifted here. A `useState<boolean>` lives in `_layout.tsx`; the custom tab bar receives `onPlusPress` and calls it.

```tsx
// inside TabLayout
const [addMealVisible, setAddMealVisible] = useState(false);
const todayIso = toIsoDate(new Date());
// ...
<CustomTabBar {...props} onPlusPress={() => setAddMealVisible(true)} />
<AddMealScreen
  visible={addMealVisible}
  date={todayIso}
  onClose={() => setAddMealVisible(false)}
/>
```

### New [`components/CustomTabBar.tsx`](components/CustomTabBar.tsx)

Renders inside a `SafeAreaView` (bottom edges). Left to right: Progress icon, Home icon, Plan icon, Recipes icon, then a larger green circle + button flush right. The four tab buttons behave like normal tabs (call `navigation.navigate`). The + button calls `onPlusPress`. The container uses a rounded card style consistent with `COLORS.card`.

### [`app/(tabs)/index.tsx`](app/(tabs)/index.tsx)

- Header title changes from "Today" to "Home"
- Remove `addingVisible` state and `AddMealScreen` usage (it moved to `_layout.tsx`)
- Remove the "+ Add meal" button rendered in the ScrollView
- `EditMealScreen` remains (still needed for editing existing meals)
- The `getDateTitle` helper that returns "Today" can stay — it is only used as a date label on the WeekStrip cards, not as the screen heading

## Phase 2 — Scan tab half-sheet redesign

### [`components/addMeal/ScanTab.tsx`](components/addMeal/ScanTab.tsx)

**New state:**
```ts
type ScanState = 'camera' | 'result' | 'fix';
const [scanState, setScanState] = useState<ScanState>('camera');
const [capturedUri, setCapturedUri] = useState<string | null>(null);
const [draft, setDraft] = useState<MealDraft | null>(null);
const [servings, setServings] = useState(1);
const [fixText, setFixText] = useState('');
const [bookmarked, setBookmarked] = useState(false);
```

After a successful capture/upload, instead of calling `onDraftReady` immediately, the component:
1. Sets `capturedUri` to the photo URI
2. Sets `draft` to the parsed meal
3. Switches `scanState` to `'result'`

**Result state layout:**
- Background: `Image` of `capturedUri` fills the screen (or last camera frame approximation using a dark overlay)
- Bottom half-sheet (`position: absolute`, `bottom: 0`, `height: '55%'`, `borderTopLeftRadius: 20`, `backgroundColor: COLORS.card`):
  - Bookmark icon top-right of the sheet; tapping saves to Saved Recipes + shows brief "Added to Favourites" with undo
  - Meal name (large, editable Text)
  - Ingredients summary: top 3–4 ingredient names joined by ", "
  - Calorie row: big calorie number + serving counter (`-` / `1` / `+`). Tapping `+` multiplies all macros × (servings+1)/servings; tapping `-` divides similarly. Values floor at 1 serving.
  - Three macro pills: P / C / F in grams
  - Health rating badge: a single row that shows a contextual label like "Over your carb goal" or "Great protein hit" derived from comparing draft macros to `context.goals`
  - Three action buttons row: **Fix Results** | **Retake** | **Log**

**Fix state:** An overlay View (not a separate Modal) inside the same screen:
- Text area for corrections, `Re-evaluate` button
- Re-evaluate calls `aiClient.parseMeal` again with the correction in the prompt, updates `draft`
- X closes the fix overlay, returns to result view

**Retake:** `setScanState('camera')`, `setCapturedUri(null)`, `setDraft(null)`, `setServings(1)`.

**Log button:**
```ts
// Uses the parent-provided callback but with a flag telling AddMealScreen
// to log immediately and close:
onDraftReady(scaledDraft, { photoUri: capturedUri, logImmediately: true });
```

The `onDraftReady` prop signature gains an optional `logImmediately` flag so `AddMealScreen` can add the meal directly and close without showing `MealDraftCard`.

In `AddMealScreen`, when `logImmediately` is truthy:
```ts
useMealStore.getState().addMealToDay(date, {
  id: `${date}-scan-${Date.now()}`,
  name: draft.name, time: nowHHMM(), calories: draft.calories,
  ingredients: [], macros: draft.macros, status: 'pending', isAdHoc: true,
});
onClose(); // closes AddMealScreen
// navigate to Home tab
router.navigate('/(tabs)/');
```

The health rating is computed as a helper:
```ts
function rateForGoals(draft: MealDraft, goals: UserGoals): { label: string; color: string }
```
It checks if calories/protein/carbs/fats would push the day over or under target and returns a concise label (e.g. "High protein — on track", "Carb-heavy — watch out") with an associated `COLORS` value.

## Phase 3 — Plan tab — Current Plan card + Planned Ingredients default

### [`app/(tabs)/plan.tsx`](app/(tabs)/plan.tsx)

**Current Plan card** at the very top (above Build/Find tiles). Reads `profile.activePlanName` and finds the plan from `savedPlans`:

```tsx
const activePlan = savedPlans.find(p => p.name === profile.activePlanName);
// Only render when a plan is active
{activePlan && (
  <TouchableOpacity
    style={styles.currentPlanCard}
    onPress={() => router.push({ pathname: '/plan/[id]', params: { id: activePlan.id } })}
    activeOpacity={0.85}
  >
    <View style={styles.currentPlanBadge}><Text style={styles.currentPlanBadgeText}>Current</Text></View>
    <Text style={styles.currentPlanName}>{activePlan.name}</Text>
    <Text style={styles.currentPlanMeta}>Started {formatSavedDate(activePlan.savedAt)}</Text>
  </TouchableOpacity>
)}
```

**Planned Ingredients collapsed by default:** In [`components/grocery/PlannedIngredientsSection.tsx`](components/grocery/PlannedIngredientsSection.tsx), change the `expanded` initial state from `true` to `false`.

## Phase 4 — Current Plan page + Customize Plan

### [`app/plan/[id].tsx`](app/plan/[id].tsx)

When `isCurrent`, replace "View in Schedule" footer with "Customize Plan". Add local state:

```ts
const [isCustomizing, setIsCustomizing] = useState(false);
// Local draft of the plan being edited (deep-cloned on customize activation)
const [draftPlan, setDraftPlan] = useState<MealPlan | null>(null);
```

**On "Customize Plan" tap:** `setDraftPlan(JSON.parse(JSON.stringify(plan)))`, `setIsCustomizing(true)`.

**While customizing — Meals in this plan:**
- Show an X beside each meal item
- Tapping X globally removes that meal from all 7 days of `draftPlan.days`
- Shows a 5-second undo toast via `useToastStore`

**While customizing — Weekly schedule:**
- Day cards get a visual highlight (border color = `COLORS.green + '44'`)
- Tapping a day navigates to the Day Detail page: `router.push({ pathname: '/plan/day/[date]', params: { date: isoForDay(dayIdx) } })`
- `isoForDay(dayIdx)` maps Monday=0..Sunday=6 to the upcoming instance of that weekday

**Footer changes in customize mode:**
- Button label: "Save"
- On Save: call `useMealStore.getState().updateSavedPlan(draftPlan.id, draftPlan)`, then `setIsCustomizing(false)`

**Back arrow in customize mode:** `Alert.alert("Discard changes?", "All unsaved changes will be lost.", [{ text: "Go back" }, { text: "Discard", onPress: () => setIsCustomizing(false) }])`

### [`store/types.ts`](store/types.ts) + [`store/useMealStore.ts`](store/useMealStore.ts)

Add `updateSavedPlan(id: string, plan: MealPlan) => void` to `AppStore` and implement it.

## Phase 5 — Progress heatmap improvements

### [`app/(tabs)/progress.tsx`](app/(tabs)/progress.tsx)

**Auto-snap to current month:**
- Add `heatmapScrollRef = useRef<ScrollView>(null)`
- In a `useEffect` (runs after `heatmapColumns` is computed), calculate the x-offset of the current month column and call `heatmapScrollRef.current?.scrollTo({ x: offset, animated: false })`
- Use `useFocusEffect` to reset `selectedYear` to current year and re-snap on every tab visit

**Year dropdown when multiple years:**
- Replace the `←` / `→` year nav buttons with a single tappable `Text` when `yearsWithCompletions.length > 1`
- Tapping shows an `ActionSheetIOS` (iOS) or `Alert` with all years as options
- When only one year, the year label is plain `Text` (non-interactive)

## Phase 6 — Remove Duration from Edit Meal

### [`components/EditMealScreen.tsx`](components/EditMealScreen.tsx)

- Remove `duration` state, all `duration` usages in form initialization, `buildNextEntry`, `handleCreate`, template construction, and the `openPicker === 'duration'` branch
- Remove the "Duration" pill from the "When" row in the rendered JSX
- The `duration?: number` field in `MealTemplate` and `MealEntry` remains for backward compatibility with persisted data

## Files changed

**Modified:**
- [`app/(tabs)/_layout.tsx`](app/(tabs)/_layout.tsx) — custom tab bar, lifted AddMealScreen + plus button
- [`app/(tabs)/index.tsx`](app/(tabs)/index.tsx) — Home rename, remove add button
- [`app/(tabs)/plan.tsx`](app/(tabs)/plan.tsx) — Current Plan card, Planned Ingredients default collapsed
- [`app/(tabs)/progress.tsx`](app/(tabs)/progress.tsx) — heatmap auto-snap, year dropdown
- [`app/plan/[id].tsx`](app/plan/[id].tsx) — Customize Plan flow
- [`components/addMeal/ScanTab.tsx`](components/addMeal/ScanTab.tsx) — half-sheet result UI
- [`components/addMeal/AddMealScreen.tsx`](components/addMeal/AddMealScreen.tsx) — logImmediately path
- [`components/EditMealScreen.tsx`](components/EditMealScreen.tsx) — remove Duration field
- [`components/grocery/PlannedIngredientsSection.tsx`](components/grocery/PlannedIngredientsSection.tsx) — default collapsed
- [`store/types.ts`](store/types.ts) — `updateSavedPlan` in AppStore
- [`store/useMealStore.ts`](store/useMealStore.ts) — `updateSavedPlan` action

**New:**
- [`components/CustomTabBar.tsx`](components/CustomTabBar.tsx) — Progress/Home/Plan/Recipes + + button
