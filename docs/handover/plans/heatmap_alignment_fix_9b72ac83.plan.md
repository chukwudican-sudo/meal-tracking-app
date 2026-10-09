---
name: Heatmap Alignment Fix
overview: Refactor Plan tab heatmap to a strict fixed matrix with 12px target cells and responsive shrink-to-fit sizing so alignment is consistent across months and years.
todos:
  - id: heatmap-matrix-refactor
    content: Refactor yearly heatmap from flex-wrap cells to strict row/column matrix
    status: completed
  - id: responsive-cell-sizing
    content: Implement 12px target cell size with shrink-to-fit sizing logic
    status: completed
  - id: label-alignment-and-verify
    content: Align month labels to week columns and verify behavior/lint
    status: completed
isProject: false
---

# Heatmap Alignment Fix Plan

## Goal
Make the Plan tab yearly heatmap visually aligned, easier to read, and slightly larger by default while preserving your existing progress rules.

## Locked Decisions
- Implementation path: **custom matrix** (no third-party heatmap library).
- Box target size: **12px**.
- Overflow behavior: **shrink-to-fit** (no horizontal scrolling).

## Why Current Layout Drifts
- The current heatmap uses wrapped flat cells (`flexWrap`) in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/plan.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/plan.tsx), which can cause subtle row/column drift and uneven month alignment.

## Implementation Approach
- Replace wrapped flat rendering with a true matrix model:
  - 7 fixed weekday rows (Mon-first)
  - N week columns for selected calendar year
- Compute responsive visual size from available card width:
  - Start from target 12px cell size + gap
  - Shrink uniformly if needed to fit all columns
  - Keep minimum readable threshold to avoid tiny cells
- Keep existing semantics intact:
  - Hidden future days
  - Intensity buckets (`0%`, `1-33%`, `34-99%`, `100%`)
  - Read-only cells
  - Conditional year navigation rules

## Files to Update
- [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/plan.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/plan.tsx)
  - Refactor heatmap data shape from flat list to matrix columns
  - Replace flex-wrap render with nested rows/columns
  - Add responsive cell sizing logic
  - Adjust month labels to align with corresponding week columns

## Verification Checklist
- Heatmap rows/columns remain visually aligned on all tested widths.
- Boxes are visibly larger than current version (target 12px when space allows).
- Shrink-to-fit keeps the whole year visible without horizontal scroll.
- Month labels remain logically aligned with week columns.
- Existing progress semantics (future hidden, intensity buckets, year behavior) remain unchanged.
- Lint/runtime checks pass.