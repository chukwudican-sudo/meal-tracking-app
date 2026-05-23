# Smart Meal Capture Implementation Slices

## Slice 0 - Foundation (No User-Facing Change)
**Objective:** Prepare schema and plumbing safely.

### Deliverables
- Extend `MealEntry`/`Ingredient` with capture metadata fields.
- Add typed adapters interface for future capture providers.
- Keep current add/edit UI unchanged.

### Exit Criteria
- Existing add/edit/remove flows behave exactly as before.
- Lint and runtime checks pass.

---

## Slice 1 - Fast Path (Non-AI, Highest ROI)
**Objective:** Ship reliable fast logging first.

### Deliverables
- Add "Search/Barcode/Manual" entry chooser in meal flow.
- Implement search + barcode lookup integration.
- Add review-and-confirm screen before save.
- Save `captureSource`, serving, and confirmed macros.

### Exit Criteria
- User can log common packaged meals faster than manual entry.
- No required AI services.

---

## Slice 2 - Voice/Text Assisted Ingredients
**Objective:** Improve homemade meal logging speed.

### Deliverables
- "Describe meal" input (voice and typed text).
- Parse into ingredient chips with estimated quantities.
- Pre-calc estimated macros and mark `isEstimated`.
- Review step requires explicit user confirmation.

### Exit Criteria
- At least one successful end-to-end homemade flow with correction.
- Low-confidence outputs are clearly flagged.

---

## Slice 3 - Photo Assist
**Objective:** Add image-based suggestion path.

### Deliverables
- Capture/select image.
- Analyze and suggest dish/ingredients/macros.
- Confidence + "needs review" messaging.
- Editable review screen and save.

### Exit Criteria
- No auto-save from photo path.
- User can correct and finalize in same flow.

---

## Slice 4 - Quality and Trust Layer
**Objective:** Improve confidence and correctness over time.

### Deliverables
- Save correction history for analytics only (no PII in prompts).
- Reuse corrected entries for future suggestions.
- Add "Used estimate" and "Confirmed" badges in meal detail.

### Exit Criteria
- Measurable reduction in full re-entry after AI suggestions.

---

## Rollout Guardrails
- Behind feature flags per slice.
- Keep manual path always available.
- If provider fails, fallback to manual with preserved input.
- Do not block current roadmap work on unresolved provider choices.

## Recommended Sequence with Current Roadmap
1. Complete remaining core Phase 2/3 roadmap items.
2. Build Slice 0 and Slice 1.
3. Ship Slice 2.
4. Ship Slice 3 only after Slice 2 quality is stable.
