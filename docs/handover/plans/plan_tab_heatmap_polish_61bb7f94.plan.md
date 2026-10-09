---
name: Plan Tab Heatmap Polish
overview: "Three targeted heatmap improvements in plan.tsx: switch to Sunday-first row order with all 7 day labels, scale cells from 12px to 14px, and add a small visual gap between months with correct label alignment."
todos:
  - id: heatmap-sunday-first-labels
    content: Switch heatmap to Sunday-first row order and show all 7 day labels (S M T W T F S)
    status: pending
  - id: heatmap-cell-scale
    content: Scale heatmap cells from 12px to 14px target size
    status: pending
  - id: heatmap-month-gaps
    content: Add month gap dividers with corrected month label alignment and sizing formula
    status: pending
isProject: false
---

# Plan Tab Heatmap Polish

All changes are isolated to [`app/(tabs)/plan.tsx`](app/(tabs)/plan.tsx).

## Change 1 — Sunday-first rows + all 7 day labels

**Why:** The current heatmap starts on Monday (GitHub-style Mon-first), but the user explicitly requested `S M T W T F S` top-to-bottom, which means Sunday at the top.

**`heatmapColumns` useMemo — offset line:**
```typescript
// Current (Monday-first):
const offset = startDow === 0 ? -6 : 1 - startDow;

// New (Sunday-first):
const offset = -startDow;
// startDow=0 (Sun) → offset=0; startDow=3 (Wed) → offset=-3, lands on previous Sunday
```

Row 0 now = Sunday, Row 1 = Monday, ..., Row 6 = Saturday.

**Day legend labels — replace the `['M', '', 'W', '', 'F', '', '']` array:**
```typescript
['S', 'M', 'T', 'W', 'T', 'F', 'S']
```
All 7 labels rendered, each with the same `height: heatmapLayout.cell` + `marginBottom` spacing. This makes the vertical spacing visually uniform.

## Change 2 — Scale cells to 14px

In `heatmapLayout` useMemo, change `targetCell` from `12` to `14`. The shrink-to-fit logic already handles overflow automatically, so this is a one-line change:
```typescript
const targetCell = 14; // was 12
```

## Change 3 — Month gap dividers

**Step A — Add `isMonthStart` to each column in `heatmapColumns`:**
```typescript
// After building colCells, before columns.push():
const isMonthStart =
  w > 0 &&  // never on the very first column
  colCells.some(c => !c.hidden && c.iso.endsWith('-01'));
columns.push({ weekStartIso: toIsoDate(weekStart), isMonthStart, cells: colCells });
```

**Step B — Account for 11 month gaps in `heatmapLayout` sizing** (11 separators = between each of the 12 months):
```typescript
const monthGap = 4;       // px of extra space at each month boundary
const numMonthGaps = 11;
// use (usableWidth - numMonthGaps * monthGap) for cell/gap calculation
// return { ..., monthGap } so render and labels can use it
```

**Step C — Apply extra `marginRight` on the column before each month boundary:**
```typescript
marginRight:
  colIdx === heatmapColumns.length - 1 ? 0 :
  heatmapColumns[colIdx + 1]?.isMonthStart
    ? heatmapLayout.gap + heatmapLayout.monthGap
    : heatmapLayout.gap
```

**Step D — Fix month label `left` position** to account for accumulated gaps:
```typescript
// anchor.monthIdx tells us how many month gaps have appeared before this label
// (Jan=0 gaps before it, Feb=1, Mar=2, ...)
left: anchor.colIdx * heatmapLayout.step + anchor.monthIdx * heatmapLayout.monthGap
```

## TypeScript shape update
`heatmapColumns` column type gains `isMonthStart: boolean`.
`heatmapLayout` return type gains `monthGap: number`.

## No other files change
`store/`, `components/`, and all other screens are untouched.
