---
name: Global Undo System
overview: Add a reusable global undo framework with a 5-second bottom snackbar, latest-action-only behavior, and initial support for meal removal and saved meal edits.
todos:
  - id: add-global-undo-host
    content: Create undo store and global snackbar host mounted in root layout
    status: completed
  - id: wire-remove-meal-undo
    content: Capture remove snapshot and restore via undo on Today screen
    status: completed
  - id: wire-edit-meal-undo
    content: Capture pre-edit snapshot and restore via undo in meal modal save flow
    status: completed
  - id: add-restore-helper-and-verify
    content: Add deterministic restore helper in meal store; run lint and manual behavior checks
    status: completed
isProject: false
---

# Global Undo System Plan

## Confirmed Product Decisions
- Undoable actions in v1: **Remove meal** and **Edit meal (on Save only)**.
- UI pattern: **bottom snackbar** with action text + `UNDO`.
- Undo window: **5 seconds**.
- Conflict model: **latest action only** (new action replaces previous undo).
- Scope across navigation: **global** (undo remains available if user switches screen/date/tab).

## Implementation Approach
- Add a global undo controller at app root in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/_layout.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/_layout.tsx):
  - Mount one global `UndoSnackbarHost` so undo works across all routes.
- Create reusable undo state + API in a new store utility (e.g. `store/useUndoStore.ts`):
  - `showUndo({ message, undo, expiresAt })`
  - `runUndo()`
  - `dismissUndo()`
  - Internal timer handling for 5s expiry.
  - Latest-only semantics (replace any active undo item).
- Wire **remove meal** flow in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/index.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/index.tsx):
  - On remove, capture removed meal snapshot and its original index.
  - Delete immediately from day log.
  - Show snackbar: `Meal removed` + `UNDO`.
  - If undone within 5s, restore meal at original position using store action(s).
- Wire **edit meal (on save)** flow in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/meal/[id].tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/meal/[id].tsx):
  - On save while editing, capture pre-edit snapshot.
  - Apply edit immediately.
  - Show snackbar: `Meal updated` + `UNDO`.
  - If undone within 5s, restore previous meal snapshot.
- Add/adjust a precise restore helper in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts):
  - Prefer explicit `restoreMealToDay(date, entry, index)` to preserve ordering and keep restore logic deterministic.

## UX/Behavior Notes
- New undo event always replaces the old one (latest-only).
- Global snackbar remains visible through route changes until expiry or undo.
- Undo action must be idempotent-safe (ignore if source day/meal no longer valid).

## Verification Plan
- Remove meal on Today: meal disappears, snackbar appears, UNDO restores same meal and position.
- Edit meal and save: values update, snackbar appears, UNDO restores previous values.
- Trigger two undoable actions quickly: only latest action is undoable.
- Navigate to another tab while snackbar visible: snackbar persists and UNDO still works.
- Run lint and check no new diagnostics on touched files.