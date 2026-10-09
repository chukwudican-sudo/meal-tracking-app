---
name: Edit Meal Flow
overview: Build a single full-screen EditMealScreen modal used everywhere. Replaces the legacy meal/[id].tsx edit path from Home and the current MealDraftCard popup from DayDetailModal. Adds native time picker, recurrence save dialog, AI Adjust shell, and undo on every save.
todos:
  - id: install-picker
    content: Install @react-native-community/datetimepicker via expo install
    status: completed
  - id: build-edit-screen
    content: Build components/EditMealScreen.tsx — two tabs (Edit / AI Adjust), native time picker, recurrence toggle, ingredients list, save logic with recurrence Alert and undo
    status: completed
  - id: wire-day-detail
    content: Update DayDetailModal.tsx — replace MealDraftCard edit popup with EditMealScreen
    status: completed
  - id: wire-home
    content: Update app/(tabs)/index.tsx — replace router.push('/meal/[id]') in onEdit with EditMealScreen modal
    status: completed
isProject: false
---

# Edit Meal Flow — Full Implementation

## Architecture decision
One `EditMealScreen` component (React Native `Modal`, full-screen, slides up). Opened from both Home and Plan/DayDetailModal. No actual tab switching — the modal overlays wherever the user is, then closes back to it.

## Files to create
- `components/EditMealScreen.tsx` — the new single edit screen

## Files to modify
- `components/DayDetailModal.tsx` — replace `MealDraftCard` edit popup with `EditMealScreen`
- `app/(tabs)/index.tsx` — replace `router.push('/meal/[id]')` in `onEdit` with `EditMealScreen`
- `components/MealCard.tsx` — no change needed (already calls `onEdit` prop)

## Install
```
npx expo install @react-native-community/datetimepicker
```
Required for native iOS scroll-wheel time picker.

---

## EditMealScreen — structure

### Props
```ts
interface Props {
  date: string;           // YYYY-MM-DD
  entry: MealEntry | null;
  visible: boolean;
  onClose: () => void;
}
```

### Two-tab layout (top of screen)
`[ Edit ]  [ AI Adjust ]` segmented control.
- **Edit tab** — the full form (see fields below)
- **AI Adjust tab** — shell chatbox (placeholder, no real AI wiring yet)

### Edit tab fields
- **Name** — TextInput
- **Time** — `DateTimePickerIOS` (mode=`'time'`, display=`'spinner'`, inline scroll wheel)
- **Calories** — number-pad TextInput
- **Protein / Carbs / Fats (g)** — 3 side-by-side number-pad TextInputs
- **Ingredients** — list of rows (name, qty, unit, Remove button) + `+ Add ingredient`
- **Recurrence toggle** — `Switch` labeled "Repeat this meal"
  - When ON: segmented control appears below → `Daily` | `Weekly` | `Every __` (number input + `days`/`weeks` picker)

### AI Adjust tab (shell only)
Placeholder chatbox UI:
- Chat message list (empty state: "Describe your changes...")
- Bottom input bar: TextInput + mic icon + camera icon + send button
- Send → appends user message + hardcoded placeholder response ("AI adjustment coming soon")
- No real AI calls wired yet

---

## Recurrence detection
Meals from templates have IDs matching `${date}-${templateId}`. Use this to look up the template in the store:
```ts
const templateId = entry.id.replace(`${date}-`, '');
const template = templates.find(t => t.id === templateId);
```
If `template` found → recurring save dialog. If not found → direct save.

---

## Save logic

**Non-recurring meal** (no template found):
- `editMealOnDay(date, updatedEntry)`
- No dialog
- `showUndo({ message: 'Meal updated', undo: () => editMealOnDay(date, original) })`

**Recurring meal** (template found):
- Show `Alert` with 3 options (Google Calendar style):
  1. **This meal** → add `date` to `template.recurrence.excludeDates`, create one-off `MealTemplate` + update `MealEntry`
  2. **This and future meals** → `updateTemplate` with `startDate = date`, create new template for new values from `date` onward + update `MealEntry`
  3. **All recurring meals** → `updateTemplate` with new values + `editMealOnDay`
- After any selection → `showUndo` that fully reverses the chosen scope

---

## Wiring changes

**`DayDetailModal.tsx`** — replace this block:
```ts
{editing && date && (
  <Modal visible transparent ...>
    <MealDraftCard mode="edit" ... />
  </Modal>
)}
```
With:
```ts
<EditMealScreen
  visible={!!editing}
  date={date}
  entry={editing}
  onClose={() => setEditing(null)}
/>
```

**`index.tsx`** — replace:
```ts
onEdit={() => router.push({ pathname: '/meal/[id]', params: { id: entry.id, date: viewingDate } })}
```
With:
```ts
onEdit={() => setEditingEntry(entry)}
```
Add `editingEntry` state + mount `<EditMealScreen>` at bottom of JSX.

---

## Notes / flags
- `meal/[id].tsx` is kept as-is — still used for `+ Add meal` from Home (add new, not edit)
- The undo for "This and future meals" scope is complex — carefully snapshot previous template state before any mutations
- `@react-native-community/datetimepicker` renders differently on Android (clock UI vs scroll wheel on iOS) — wrap in `Platform.OS === 'ios'` check and fall back to TextInput on Android for now
