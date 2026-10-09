---
name: Build My Plan + UI Fix
overview: "Rebuild `app/plan/build.tsx` with a guide preview page, a progress bar, redesigned selection/summary/preview screens, and fix the full-screen modal gap across the entire app by changing all `presentation: 'modal'` routes to `presentation: 'fullScreenModal'` in `app/_layout.tsx`."
todos:
  - id: modal-gap-fix
    content: "Change all full-screen routes in app/_layout.tsx from presentation: 'modal' to presentation: 'fullScreenModal'"
    status: completed
  - id: guide-page
    content: "Add guide preview page step to build.tsx: Step type 'guide', initial state, render with profile context card and Let's go button"
    status: completed
  - id: progress-bar
    content: Add StepProgressBar component and render it at the top of every pick and summary step in build.tsx
    status: completed
  - id: selection-layout
    content: "Redesign selection page: PAGE_SIZE 4→5, dots centered, explanatory text, counter below text, 'Suggest more' rename, describe button opens popup overlay, remove inline describe input"
    status: completed
  - id: preview-redesign
    content: "Redesign preview screen to match plan detail page layout: plan name card, distinct meals collapsible section, weekly schedule, Confirm Plan footer button"
    status: completed
isProject: false
---

# Build My Plan Adjustments + Global UI Fix

## Root cause of modal gap

Every "full-screen" route in [`app/_layout.tsx`](app/_layout.tsx) uses `presentation: 'modal'`. On iOS this renders as a card-sheet with rounded corners and a visible gap at the top. The fix is `presentation: 'fullScreenModal'` which fills the entire screen while keeping the `slide_from_bottom` animation.

## Phase 1 — Global UI Fix (`app/_layout.tsx`)

Change every route that is a full-screen page from `presentation: 'modal'` to `presentation: 'fullScreenModal'`. Keep `animation: 'slide_from_bottom'` on each one. The only route left as `modal` is the fallback `modal` named screen.

Routes to change:
- `settings`, `cart`, `profile`, `notifications`, `kitchen`
- `recipes/saved`, `recipes/category/[type]`, `recipe/[id]`
- `ai/what-can-i-make`, `ai/custom`
- `profile/edit-goal`, `profile/personal-details`, `profile/dietary`, `profile/nutrition-goals`
- `settings/account`, `settings/account-delete-confirm`, `settings/notifications`, `settings/help`, `settings/feedback`, `settings/coming-soon`
- `plan/build`, `plan/find`, `plan/category/[type]`, `plan/[id]`, `plan/day/[date]`
- `meal/[id]`

Leave unchanged: the `modal` named screen (it is an actual overlay).

## Phase 2 — Build My Plan (`app/plan/build.tsx`)

### 2.1 Step type — add `'guide'`

```ts
type Step =
  | { kind: 'guide' }
  | { kind: 'pick'; slotIdx: number }
  | { kind: 'summary'; slotIdx: number }
  | { kind: 'preview' };
```

Initial state: `useState<Step>({ kind: 'guide' })`.

### 2.2 New Guide page (renders when `step.kind === 'guide'`)

- `Header` with back arrow (`router.back()`) and no right action, title "Build My Plan"
- A profile context card showing goal, dietary restrictions, and allergies pulled from `profile`
- Brief flow explanation copy: *"We'll walk you through each meal of your day. Pick your favourites and we'll build your weekly plan."*
- `SafeAreaView` footer with a single full-width "Let's go" green button that calls `setStep({ kind: 'pick', slotIdx: 0 })`

Helper needed:

```ts
function goalTypeLabel(goalType: string | undefined): string {
  const map: Record<string, string> = {
    lose_weight: 'Lose Weight',
    maintain: 'Maintain',
    gain_muscle: 'Gain Muscle',
    lean_bulk: 'Lean Bulk',
  };
  return map[goalType ?? ''] ?? 'Not set';
}
```

### 2.3 Progress bar component (`StepProgressBar`)

```tsx
function StepProgressBar({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step / total) * 100}%` }]} />
      </View>
      <Text style={styles.progressLabel}>Step {step} of {total} — {label}</Text>
    </View>
  );
}
```

Add to the styles object:
- `progressWrap`: `paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 5`
- `progressTrack`: `height: 4, backgroundColor: COLORS.elevated, borderRadius: 2`
- `progressFill`: `height: 4, backgroundColor: COLORS.green, borderRadius: 2`
- `progressLabel`: `color: COLORS.textSecondary, fontSize: 11, fontWeight: '600'`

**Placement**: rendered at the very top of `SafeAreaView`, above `<Header>`, on every pick and summary step.

**Step number = slotIdx + 1, total = activeSlots.length** (only non-skipped slots count since `activeSlots` already filters them).

### 2.4 Selection page layout changes

**PAGE_SIZE**: change constant from `4` to `5`.

**Layout from top to bottom:**
1. `StepProgressBar` (step = slotIdx + 1, total = activeSlots.length, label = slot.name)
2. `Header` (back + Continue on right)
3. Dots row centered — move from inside `subHeaderRow` to a dedicated `dotsRow` View centered with `alignItems: 'center'`
4. Explanatory text: `"Pick your favourites. We'll rotate them through the week."` — small muted paragraph below dots
5. Selection counter `"N selected"` — below the explanatory text
6. Meal cards (horizontal pager, max 5 per page)
7. "Suggest more" card (renamed from "Find more")
8. "Describe what you want" **button** (not inline input — see §2.5)
9. Dynamic skip link `"No {slot.name}"`

Remove the old `describeBox` (inline `TextInput` + Generate button) from `bottomBar`. The `bottomBar` now only contains the "Describe what you want" button and the skip link.

### 2.5 Describe popup overlay

Add state:
```ts
const [describeModalVisible, setDescribeModalVisible] = useState(false);
const [describeModalText, setDescribeModalText] = useState('');
```

"Describe what you want" bottom button (styled, green-outlined):
```tsx
<TouchableOpacity
  style={styles.describeOpenBtn}
  onPress={() => { setDescribeModalText(''); setDescribeModalVisible(true); }}
>
  <Text style={styles.describeOpenBtnText}>Describe what you want</Text>
</TouchableOpacity>
```

Popup using RN `<Modal transparent animationType="fade">`:
```tsx
<Modal transparent animationType="fade" visible={describeModalVisible} onRequestClose={...}>
  <Pressable style={styles.describeOverlay} onPress={() => setDescribeModalVisible(false)}>
    <Pressable style={styles.describeCard}>
      {/* X close button top-right */}
      <TextInput multiline style={styles.describeTextArea} value={describeModalText} onChangeText={setDescribeModalText} />
      <TouchableOpacity style={styles.describeGenBtn} onPress={() => {
        // Run addDescribePage using describeModalText, then close modal.
        addDescribePageFromModal(slot, describeModalText);
        setDescribeModalVisible(false);
      }}>
        <Text>Generate</Text>
      </TouchableOpacity>
    </Pressable>
  </Pressable>
</Modal>
```

Add `addDescribePageFromModal(slot, text)` helper that takes text as a param (same logic as existing `addDescribePage` but uses passed text instead of `describeBySlot[slot.id]`).

### 2.6 Preview screen redesign

Restructure the preview to match the plan detail page (`app/plan/[id].tsx`) layout:

**Top section — plan name card:**
```tsx
<View style={styles.planNameCard}>
  <Text style={styles.planNameLabel}>YOUR PLAN</Text>
  <Text style={styles.planNameText}>{autoPlanName()}</Text>
  <Text style={styles.planNameSub}>{activeSlots.length} meal types · {previewDays.length} days</Text>
</View>
```

**Unique meals section** (collapsible, "See more / See less"):
- Compute `distinctMeals` from `previewDays` (same pattern as `plan/[id].tsx` but using local `selections` + `recipes` map)
- Show meal name, calories, cook time
- Collapsed by default showing first 3, expand with "See more" toggle

**Weekly schedule section** (keep existing 7 day cards structure but rename "New" button to "Find different meal").

**Footer:** Single full-width "Confirm Plan" green button (rename from "Activate Plan"). Remove the Back secondary button from the footer — user uses the header back arrow instead.

### 2.7 Summary screen — no structural changes needed

Progress bar already planned (§2.3). The existing summary layout (swap, add more, averages) is otherwise correct per spec. Just add `StepProgressBar` at the top.

## Files changed

- [`app/_layout.tsx`](app/_layout.tsx) — change ~25 routes to `fullScreenModal`
- [`app/plan/build.tsx`](app/plan/build.tsx) — guide page, progress bar, page layout, describe popup, preview redesign
