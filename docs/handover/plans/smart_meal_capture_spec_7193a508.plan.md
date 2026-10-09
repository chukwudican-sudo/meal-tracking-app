---
name: Smart Meal Capture Spec
overview: "Define a high-confidence Smart Meal Capture feature without disrupting current build flow: spec now, implement later in phased slices."
todos:
  - id: keep-roadmap-moving
    content: Continue next planned core feature without introducing Smart Capture implementation risk
    status: completed
  - id: draft-smart-capture-spec
    content: Write detailed UX + technical spec for hybrid meal capture
    status: completed
  - id: define-phased-build-slices
    content: Break Smart Capture into low-risk incremental implementation slices
    status: completed
isProject: false
---

# Smart Meal Capture — Recommended Next Plan

## Decision (Default)
- Do **not** implement full photo/voice AI capture right now.
- Continue roadmap execution, and run a focused **spec/design pass** for this key feature first.
- Use a **hybrid input strategy** as the target direction: text search + barcode + optional photo/voice assist.

## Why This Order
- Full implementation now would add major scope (nutrition APIs, AI parsing, confidence UX, correction flows) and can destabilize current momentum.
- A spec-first pass prevents rework and keeps current phases clean.

## Proposed Feature Architecture (Later Build)
- Primary paths:
  - Quick add via food search or barcode (fastest, most reliable)
  - Photo/voice as assistive capture that outputs editable suggestions
  - Final user confirmation/edit before save
- Data model additions:
  - `source` (`manual` | `search` | `barcode` | `photo_ai` | `voice_ai`)
  - `confidence` score for AI-assisted entries
  - `isEstimated` flag until user confirms

## Where It Fits in Current Code
- Entry UX evolves from [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/meal/[id].tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/meal/[id].tsx)
- Model/store extension points:
  - [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/types.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/types.ts)
  - [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts)

## Phase-Compatible Rollout
- Slice 1 (non-AI): search + barcode + confirm/edit
- Slice 2 (assistive): voice-to-ingredients with confirmation chips
- Slice 3 (assistive): photo-to-estimate with mandatory user confirmation

## Immediate Next Move
- Continue current planned implementation track, while I prepare this Smart Meal Capture spec in detail (UX flow, API options, schema changes, and phased technical milestones) before coding it.