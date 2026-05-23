# Smart Meal Capture Spec (Hybrid)

## Goal
Help users log meals quickly when they do not know calories/macros, while preserving trust through explicit confirmation and edit controls.

## Non-Goals (Initial)
- Fully automatic "one-tap accurate nutrition" from a photo without user review.
- Building a custom nutrition database from scratch.
- Replacing the existing manual meal form in one release.

## Success Metrics
- Median time to log a meal under 25 seconds for repeat/common meals.
- At least 80% of AI-assisted entries are user-confirmed without full re-entry.
- Fewer than 5% of saved entries are later deleted as "wrong meal".

## Primary User Paths
1. **Fast path (recommended default):**
   - Search packaged/common food or scan barcode.
   - Pick serving size.
   - Confirm and save.
2. **Homemade path:**
   - Voice/text describe ingredients and rough quantities.
   - System creates ingredient chips and macro estimate.
   - User confirms/edits and saves.
3. **Photo assist path:**
   - User captures meal image.
   - System suggests likely dish/ingredients and estimated nutrition.
   - User must confirm/edit before save.

## UX Principles
- Suggest, do not auto-commit.
- Always show confidence and allow easy correction.
- Preserve speed: "good enough now, refine later".
- Keep one explicit "Confirm and save" step.

## UX Flow
1. User taps `+ Add meal`.
2. New "Capture method" step:
   - Search/Barcode
   - Describe by voice/text
   - Photo assist
   - Manual (existing fallback)
3. Capture-specific input.
4. Review screen:
   - Meal name
   - Serving/portion
   - Calories/macros
   - Ingredient list
   - Confidence label where applicable
5. Save to day log and library.

## Data Model Additions
Add to `MealEntry` in `store/types.ts`:
- `captureSource: 'manual' | 'search' | 'barcode' | 'voice_ai' | 'photo_ai'`
- `isEstimated: boolean`
- `confidence?: number` (0-1)
- `estimationNotes?: string[]`
- `originalInput?: { text?: string; imageUri?: string; barcode?: string }`

Add to `Ingredient`:
- `isEstimated?: boolean`
- `confidence?: number`

## System Components
- `MealCaptureStart` (method chooser)
- `MealCaptureReview` (final confirmation)
- Adapters:
  - Nutrition search adapter
  - Barcode lookup adapter
  - Voice/text parser adapter
  - Photo analysis adapter

## Integration Points in Current App
- Entry route: `app/meal/[id].tsx`
- Types: `store/types.ts`
- Save/update logic: `store/useMealStore.ts`
- Optional undo messaging stays in global snackbar path.

## Safety and Reliability
- AI outputs must be schema-validated before showing.
- If confidence is low, surface "Needs review" badge and highlight editable fields.
- Never overwrite user-edited fields when re-running suggestions.

## Offline and Failure Behavior
- If external service fails, fallback to manual flow with prefilled partial data.
- Save draft input locally when capture is interrupted.

## Technical Dependencies (Future)
- Nutrition data provider (search + barcode).
- Speech-to-text or LLM parsing endpoint.
- Vision model endpoint for photo assist.
- Basic analytics events for funnel and correction rates.

## Open Decisions to Confirm Before Build
- Preferred nutrition provider and cost limits.
- Whether photo capture is v1 of this feature or deferred to v2.
- Confidence threshold copy and UI treatment.
