---
name: Phase 1 UI Replication
overview: Replicate the reference images exactly across index.tsx, MealCard.tsx, and WeekStrip.tsx. No new features — purely layout, structure, and visual corrections.
todos:
  - id: header-fix
    content: "index.tsx: MEAL PLAN static title, green streak badge, gear icon"
    status: completed
  - id: week-strip-fix
    content: "WeekStrip.tsx: 3-letter labels, today-anchored, green accents, no filled circle"
    status: completed
  - id: date-row-fix
    content: "index.tsx: square outlined arrow buttons, large Today/Tomorrow title, date subtitle"
    status: completed
  - id: plan-tag
    content: "index.tsx: add Weekday plan outlined pill tag below date row"
    status: completed
  - id: summary-card-fix
    content: "index.tsx: restructure summary card — stacked calories, % done, green bar, macro 3-row layout, water circles"
    status: completed
  - id: add-meal-btn-fix
    content: "index.tsx: make + Add meal button outlined (no fill)"
    status: completed
  - id: meal-card-collapsed
    content: "MealCard.tsx: collapsed shows only circle + name + time + badge + calories"
    status: completed
  - id: meal-card-tap
    content: "MealCard.tsx: circle tap = toggle, body tap = expand/collapse"
    status: completed
  - id: meal-card-expanded
    content: "MealCard.tsx: expanded shows ingredients bullet list + macro pills + Edit/Remove buttons"
    status: completed
  - id: colour-fixes
    content: Progress bar green, streak green, completed calorie green, % done green
    status: completed
isProject: false
---

# Phase 1 UI — Reference Image Replication

## Files changing

- [`app/(tabs)/index.tsx`](meal-app/app/(tabs)/index.tsx) — header, week strip, date row, summary card, water circles, meals section
- [`components/MealCard.tsx`](meal-app/components/MealCard.tsx) — collapse/expand behavior, collapsed/expanded layouts
- [`components/WeekStrip.tsx`](meal-app/components/WeekStrip.tsx) — 3-letter day labels, today-anchored window, green accents

---

## Change 1 — Header (`index.tsx`)

**Current:** Dynamic `[Name]'s [Day] Plan` title + orange fire streak badge + gear button

**Reference:**
- Left: `"MEAL PLAN"` — static uppercase app-name placeholder (small, gray/white, bold)
- Right: Green pill badge — green dot `•` + `"5 day streak"` white text. No fire emoji.
- Gear icon stays but moves to sit beside the streak badge on the right

---

## Change 2 — Week Strip (`WeekStrip.tsx`)

**Current:** Single-letter labels `M T W T F S S`, blue selected highlight, dot below number

**Reference layout per cell (top → bottom):**
1. 3-letter day label — `Sat` `Sun` `Mon` `Tue` `Wed` `Thu` `Fri` (gray, green when selected)
2. Small dot — visible green only when it is **today** (not just selected)
3. Date number — gray by default, **green text** when selected

**Behaviour:** Strip always shows the week containing **today** (Mon–Sun window anchored to real-world today, not the viewed date). When you navigate to tomorrow, today's dot stays on Tuesday; Wednesday's number turns green. Both can be green simultaneously.

No filled circle around the date number — just colour change.

---

## Change 3 — Date Row (`index.tsx`)

**Current:** Plain `←` / `→` text arrows, single-line `"Today, May 6"` label

**Reference:**
- Arrow buttons are **square outlined boxes** (`[ ← ]` `[ → ]`), not bare text
- Center: large `"Today"` / `"Tomorrow"` / day name on one line (big, bold white)
- Smaller `"May 5"` date sub-label on the line below, centered

---

## Change 4 — Weekday Plan Tag (`index.tsx`)

**Current:** Not present

**Reference:** Small **outlined pill tag** below the date row, left-aligned. Text: `"Weekday plan"` — later becomes dynamic plan name from Settings.

---

## Change 5 — Summary Card (`index.tsx`)

**Current:** `"TODAY'S SUMMARY"` label, calorie on one line with goal, blue progress bar, macro items centered with no context

**Reference (exact structure):**
- Remove `"TODAY'S SUMMARY"` label entirely
- **Top-left:** Large `520` calorie number; `"of 2200 kcal"` on the line below it (stacked, smaller gray)
- **Top-right:** `"24% done"` in green (computed as `Math.round(completedCals / goal * 100)`)
- **Progress bar:** `green` fill (not blue), thin, full width
- **Macro row:** Each item stacks vertically — `"52g"` bold white on top, `"Protein"` gray below, `"/165g"` gray below that. Same for Carbs, Fats, Water (Water shows `"/8 cups"`)
- **Water intake row** below macros: label `"Water intake"` on the left + 8 tappable circle buttons on the right. Tapping each circle fills it to track cup count. Store tracks `waterMl` internally; display converts: 1 circle = 250ml, goal = 8 circles (2000ml).

---

## Change 6 — Meals Section Header (`index.tsx`)

**Current:** Filled dark background `"+ Add meal"` button

**Reference:** `"+ Add meal"` is an **outlined border button** (no fill, just a border with white text), rounded rectangle

---

## Change 7 — MealCard collapsed state (`MealCard.tsx`)

**Current:** Always shows ingredient preview + macro pills

**Reference collapsed:** Shows **only**:
- Circle (left)
- Meal name (bold) + time below + `missed` badge if applicable
- `"X kcal"` on the right

No ingredient text. No macro pills. Nothing else.

---

## Change 8 — MealCard tap behaviour (`MealCard.tsx`)

**Current:** Full card tap = toggle completion

**Reference:**
- **Circle tap only** → toggles `pending ↔ completed`
- **Card body tap** → expands / collapses detail section inline

---

## Change 9 — MealCard expanded state (`MealCard.tsx`)

**Reference expanded (image 2):**
- All collapsed content stays visible
- Ingredient list as bullet points: `• Oats 80g`, `• Protein powder 30g`, `• Banana`
- Macro pills row: `"35g Protein"`, `"55g Carbs"`, `"8g Fats"` — dark filled pill background
- Two buttons full-width: `"Edit meal"` (left, neutral dark) + `"Remove"` (right, red text)

---

## Change 10 — Colour corrections

| Element | Old | New |
|---|---|---|
| Progress bar | `COLORS.blue` | `COLORS.green` |
| Week strip selected | blue | green |
| Streak badge | orange text, dark bg | white text, green pill |
| Completed meal calorie | white | green |
| `"X% done"` label | absent | green |
