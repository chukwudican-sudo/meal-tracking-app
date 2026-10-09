---
name: Requirements Batch 2
overview: "Four improvements: dynamic streak calculation, completed-card full green border vs missed red left border, unified blue plan tag, and week strip that follows the viewed date with a selected-date indicator."
todos:
  - id: streak-dynamic
    content: "store/useMealStore.ts: smart recalcStreak (yesterday fallback) + auto-call on toggleMealStatus; index.tsx: call recalcStreak in useEffect"
    status: completed
  - id: card-borders
    content: "MealCard.tsx: completed = full 1.5px green border all sides, missed = left-only red bar, pending = no border"
    status: completed
  - id: plan-tag-blue
    content: "index.tsx: both Weekday/Weekend plan tags use COLORS.blue — remove orange branching"
    status: completed
  - id: week-strip-nav
    content: "WeekStrip.tsx: anchor strip to selectedDate week, add faint green pill behind selected non-today date number"
    status: completed
isProject: false
---

# Requirements Batch 2

## Files changing

- [`store/useMealStore.ts`](meal-app/store/useMealStore.ts) — streak logic + auto-recalc on toggle
- [`app/(tabs)/index.tsx`](meal-app/app/(tabs)/index.tsx) — call recalcStreak on mount, plan tag color
- [`components/MealCard.tsx`](meal-app/components/MealCard.tsx) — full green border for completed, left-only red border for missed
- [`components/WeekStrip.tsx`](meal-app/components/WeekStrip.tsx) — anchor to viewingDate, selected-date indicator

---

## Change 1 — Dynamic streak

**Problem:** streak is hardcoded to `5` in the initial store state and never recalculated.

**`store/useMealStore.ts`** — update `recalcStreak` logic:
- If today has at least one completed meal → count from today backwards
- If today has no completions yet → count from yesterday backwards (streak persists until you've done something today, then climbs by 1)

```typescript
recalcStreak: () => {
  set(state => {
    const today    = new Date();
    const todayIso = toIsoDate(today);
    const todayHasCompletion = state.logs[todayIso]?.meals.some(
      m => m.status === 'completed'
    );
    const startOffset = todayHasCompletion ? 0 : 1;
    let streak = 0;
    for (let i = startOffset; i < 365; i++) {
      const d   = new Date(today);
      d.setDate(today.getDate() - i);
      const log = state.logs[toIsoDate(d)];
      if (!log?.meals.some(m => m.status === 'completed')) break;
      streak++;
    }
    return { streak };
  });
},
```

Also: at the end of `toggleMealStatus`, call `get().recalcStreak()` so the badge updates the moment a meal is tapped.

**`app/(tabs)/index.tsx`** — call `recalcStreak()` inside the existing `useEffect` (after `resolveDayFromTemplates`) so the badge is accurate on first open.

---

## Change 2 — MealCard border styles

**Current:** both completed and missed only use `borderLeftWidth: 3`.

**Reference image:**
- Missed → red left bar only (keep current left-border approach)
- Completed → thin green border around the **entire** card (all 4 sides, rounded)
- Pending → no border

**`components/MealCard.tsx`** — make the border dynamic:

```typescript
// pending
{ borderWidth: 0 }

// missed
{ borderLeftWidth: 3, borderTopWidth: 0, borderRightWidth: 0,
  borderBottomWidth: 0, borderColor: COLORS.red }

// completed — full thin rounded border
{ borderWidth: 1.5, borderColor: COLORS.green }
```

Remove the static `borderLeftWidth: 3` and `borderLeftColor: 'transparent'` from the `container` style, and apply all border styling inline based on state.

---

## Change 3 — Unified plan tag (blue for both)

**Current:** "Weekday plan" = neutral gray border / "Weekend plan" = orange accent (different colors).

**Change:** both use `COLORS.blue` — same border, same background tint, same text color. Remove the `isWeekend` color branching entirely and apply a single style to both:

```typescript
// same style regardless of weekday/weekend
borderColor: COLORS.blue + '80',
backgroundColor: COLORS.blue + '12',
text color: COLORS.blue,
```

The text still switches between `"Weekday plan"` and `"Weekend plan"` — only the color becomes uniform.

---

## Change 4 — Week strip follows viewed date + selected indicator

**Current:** strip is always anchored to today's week (`getWeekDays(todayIso)`), so navigating to next week doesn't move the strip.

**`components/WeekStrip.tsx`:**

- Anchor the week window to `selectedDate` (the viewed date) instead of `todayIso`:
  ```typescript
  const weekDays = getWeekDays(selectedDate);  // was getWeekDays(todayIso)
  ```
- Today's green label/number and dot logic stay exactly the same — still based on `todayIso`, even if today is off-screen in a different week
- **Selected-date indicator:** when the viewed date is in the strip but is NOT today, show a faint green rounded background behind that cell's date number:
  ```typescript
  const isSelected = iso === selectedDate && iso !== todayIso;
  // dateNum gets a subtle pill background when isSelected
  ```

This means: navigating to Mon May 11 moves the strip to show Mon 11–Sun 17. Today (Thu May 7) is no longer in the strip, but that's expected — the date row center text and the plain "Today" label already communicate context. When viewing a date within the current week, both the green today text and the selected pill can show simultaneously.
