---
name: Macro Picker Split
overview: Split the single-screen macro picker into three separate one-question-per-screen steps (Proteins → Carbs → Fats), update the option lists to the finalized spec, and leave the secondary-preferences screen's `LOVE_SUGGESTIONS` list untouched.
todos:
  - id: split-step-union
    content: "Update Step union: replace single macroPicker with { kind: 'macroPicker'; group: 'proteins'|'carbs'|'fats' }, update initial state and all navigation targets (Regenerate reset, secondaryPrefs back from Q0)"
    status: completed
  - id: update-option-lists
    content: Replace PROTEIN_OPTIONS, CARB_OPTIONS, FAT_OPTIONS constants with the finalized lists in the spec
    status: completed
  - id: rewrite-picker-render
    content: Rewrite the macroPicker render block to show one group at a time (title, chips, free-text, back/next navigation) based on step.group
    status: completed
isProject: false
---

# Macro Picker Split

## What changes

**Only [`app/plan/build.tsx`](app/plan/build.tsx)**. Backend, client wrapper, and secondary-prefs screen are untouched.

## No conflicts found

- `LOVE_SUGGESTIONS` (line 330) is its own constant used only in the `qIdx === 2` secondary-prefs block — it will not be touched.
- `AVOID_SUGGESTIONS` (line 331) likewise untouched.
- The `MacroGroup` type, `addMacroToken`/`removeMacroToken`/`toggleMacroOption` helpers, and `macroPickCount` derived value all work per-group already, so splitting into three screens reuses everything without changes to logic.

## Step 1 — Update the `Step` union

Current `macroPicker` is a single kind. Replace it with three:

```typescript
| { kind: 'macroPicker'; group: 'proteins' }
| { kind: 'macroPicker'; group: 'carbs' }
| { kind: 'macroPicker'; group: 'fats' }
```

Initial state becomes `{ kind: 'macroPicker', group: 'proteins' }`.

## Step 2 — Replace option constants

```typescript
const PROTEIN_OPTIONS = [
  'Chicken breast', 'Chicken thighs', 'Steak', 'Ground beef',
  'Turkey breast', 'Ground turkey', 'Eggs', 'Salmon', 'Tilapia',
  'Tuna', 'Tofu', 'Black beans', 'Lentils', 'Greek yogurt', 'Prawns',
];
const CARB_OPTIONS = [
  'White rice', 'Brown rice', 'Pasta', 'Whole wheat pasta', 'Potatoes',
  'White bread', 'Whole wheat bread', 'Oats', 'Quinoa', 'Noodles',
  'Sweet potato', 'Couscous', 'Tortilla',
];
const FAT_OPTIONS = [
  'Avocado', 'Olive oil', 'Almonds', 'Walnuts', 'Cheese',
  'Peanut butter', 'Chia seeds', 'Flax seeds', 'Butter', 'Coconut',
];
```

## Step 3 — Rewrite the `macroPicker` render block

The current block (lines 795–910) renders all three groups in one scroll. Replace with a single-group render driven by `step.group`:

- **Title/hint** per group: "What proteins do you like?" / "What carbs?" / "What fats?"
- **Progress**: `StepProgressBar step={groupIdx + 1} total={5} label={groupTitle}` — where groups are steps 1/2/3 of the overall 5-step wizard (macro×3 + secondary + guide), or keep `total={2}` and show sub-label "Proteins · 1 of 3" to stay consistent with the current 2-step bar.

  The simplest approach that matches the existing secondary-prefs pattern: keep `total={2}` for the outer wizard steps but show a sub-label like `"Proteins · 1 of 3"`, so the overall bar fills at step 1. Alternatively bump `total` to 5. Either is easy to tune — flag it as a quick decision.

- **Back navigation**:
  - Proteins back → `router.back()`
  - Carbs back → `{ kind: 'macroPicker', group: 'proteins' }`
  - Fats back → `{ kind: 'macroPicker', group: 'carbs' }`

- **Next/CTA**:
  - Proteins: "Next" → `{ kind: 'macroPicker', group: 'carbs' }`
  - Carbs: "Next" → `{ kind: 'macroPicker', group: 'fats' }`
  - Fats: "Next" (or "Done") → `{ kind: 'secondaryPrefs', questionIdx: 0 }`
  - Gate: the CTA is only enabled if at least one pick exists **in the current group** (rather than globally across all three). This mirrors the per-screen pattern of the secondary-prefs questions — each question is self-contained. Alternatively, keep the global `macroPickCount > 0` gate but only enforce it on the Fats screen. Your call — I'll default to per-screen.

- **Regenerate** reset: currently goes to `{ kind: 'macroPicker' }` — update to `{ kind: 'macroPicker', group: 'proteins' }`.

- **Guide back**: currently `{ kind: 'secondaryPrefs', questionIdx: 3 }` — unchanged (guide still sits after secondary prefs).

## Step 4 — Update `secondaryPrefs` back from Q0

Currently `if (qIdx === 0) setStep({ kind: 'macroPicker' })`. Update to `{ kind: 'macroPicker', group: 'fats' }` so back from secondary-prefs Q1 correctly returns to the last macro screen.

## Files touched

- [`app/plan/build.tsx`](app/plan/build.tsx) only — option constants, `Step` union, one render block, two navigation targets.
