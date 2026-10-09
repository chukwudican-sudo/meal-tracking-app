---
name: Day Detail Modal
overview: "Replace the inline week-schedule day expansion with a bottom-anchored popup modal that shows a full day command center: macro progress bars, logged meal cards with done/skip toggles, and multiple ways to add meals."
todos:
  - id: modal-component
    content: Create DayDetailModal.tsx with header, macro bars, meal list, empty state, and expandable add section
    status: pending
  - id: add-quick
    content: Wire up Quick Add flow inside the modal (inline form → addMealToDay)
    status: pending
  - id: add-templates
    content: Wire up From Templates flow (scrollable template list → addMealToDay)
    status: pending
  - id: add-copy
    content: Wire up Copy From Day flow (date input → copy MealEntry[] → addMealToDay each)
    status: pending
  - id: plan-integration
    content: "Update plan.tsx: add dayModalDate state, change day card onPress, remove inline expand block"
    status: pending
isProject: false
---

# Day Detail Modal

## What's changing

The current "tap a day card → inline expand showing templates" gets replaced by a popup modal. The 7 day cards in the Week Schedule keep their summary row (day name, % progress) but tapping them now opens `DayDetailModal` instead of expanding inline.

## Data model clarification

There are two separate concepts in the store:
- **Templates** (`templates[]`) — recurring meal blueprints, managed by the existing `modalVisible` form
- **Logs** (`logs[date].meals: MealEntry[]`) — actual meals scheduled/eaten for a specific date

The day modal works entirely with **logged meals** (`MealEntry`), not templates. Adding "from templates" means creating a `MealEntry` from a template's data via the existing `addMealToDay(date, entry)` store action.

```
MealEntry { id, name, time, calories, macros: {protein,carbs,fats}, status }
UserGoals { dailyCalories, protein, carbs, fats }   ← for progress bars
```

## Files

- **New file**: `meal-app/components/DayDetailModal.tsx`
- **Modified**: `meal-app/app/(tabs)/plan.tsx` — add `dayModalDate` state, change day card `onPress`

## Modal appearance

React Native `Modal` with `transparent={true}` + semi-opaque backdrop. Content card anchored to the bottom, ~83% of screen height, `borderTopLeftRadius/borderTopRightRadius: 20`, `animationType="slide"`. Drag indicator at top. Scrollable body inside.

```
┌──────────────────────────────┐  ← backdrop (tap to close)
│                              │
│  ╔════════════════════════╗  │
│  ║  ─── (drag handle)     ║  │  ← 83% of screen height
│  ║  Mon 12 · May 2026  ✕  ║  │
│  ║  ────────────────────  ║  │
│  ║  Calories  ████░░  820 ║  │  ← macro bars
│  ║  Protein   ███░░░   62g ║  │
│  ║  Carbs     ██░░░░   45g ║  │
│  ║  Fats      █░░░░░   18g ║  │
│  ║  ────────────────────  ║  │
│  ║  [Grilled Chicken]     ║  │  ← MealEntry cards
│  ║  [Protein Shake]       ║  │
│  ║  (empty state if none) ║  │
│  ║  ────────────────────  ║  │
│  ║  [+ Add meal ▾]        ║  │  ← expandable add section
│  ╚════════════════════════╝  │
└──────────────────────────────┘
```

## DayDetailModal sections

### 1. Header
- Formatted date (e.g. "Monday, May 12")
- X close button

### 2. Macro progress bars
- Pull `logs[date].meals` → sum `calories`, `macros.protein`, `macros.carbs`, `macros.fats`
- Pull `goals` from store for targets
- 4 thin progress bars (cal / protein / carbs / fats), each showing `actual / goal`

### 3. Meal list
- Renders `logs[date].meals` sorted by `time`
- Each card: **food name** (large), time (small), macros row (`cal · Pg · Cg · Fg`), status toggle (`✓ Done` / `✗ Skip` / `⏱ Pending`)
- Tapping status cycles through or shows a small 3-option picker
- Empty state: centered icon + "No meals added yet"

### 4. Add meal section (expandable at bottom)
Three options shown as pill buttons when expanded:

| Button | Behavior |
|---|---|
| Quick add | Inline form: name TextInput + time TextInput + calories + macros + confirm → `addMealToDay` |
| From templates | Inline scrollable list of all `templates[]` → tap one → creates MealEntry from its data → `addMealToDay` |
| Copy from day | Date input (simple text field `YYYY-MM-DD` or scrollable past dates) → copies `logs[pickedDate].meals` each with new `uuid()` id → `addMealToDay` for each |

## Plan.tsx changes

- Add state: `const [dayModalDate, setDayModalDate] = useState<string | null>(null)`
- Day card `onPress`: replace `setExpandedDay(active ? '' : iso)` with `setDayModalDate(iso)`
- Remove inline `{active && <View style={styles.dayList}>...}` block from the day card (replaced by modal)
- Keep `expandedDay` / `dayTemplates` only if the existing template-edit modal still needs it; otherwise remove

## Key store actions used by the modal
- `addMealToDay(date, entry)` — all three add flows
- `toggleMealStatus(date, mealId)` — done/skip toggle
- `removeMealFromDay(date, mealId)` — swipe-to-delete or delete button on card
- `logs[date]`, `goals` — read for display
- `templates` — read for "from templates" list
