---
name: Expo Stability Patch
overview: Stabilize runtime before further feature work by fixing AsyncStorage compatibility in Expo Go, clearing stale route warnings, and validating on-device behavior.
todos:
  - id: align-asyncstorage-version
    content: Set Expo-compatible AsyncStorage dependency and refresh install state
    status: completed
  - id: remove-extraneous-explore-route
    content: Clean tabs layout to remove explore warning
    status: completed
  - id: device-restart-and-validate
    content: Restart with clean cache and verify runtime logs/persistence on phone
    status: completed
isProject: false
---

# Expo Stability Patch

## Why This First
- Current on-device logs show `AsyncStorageError: Native module is null`, which can break persistence behavior and make feature testing unreliable.
- Current tab warning (`Route "explore" is extraneous`) is non-fatal but noisy and should be removed for cleaner signal.

## Scope (Low-Risk, Isolated)
- Align AsyncStorage dependency/runtime for Expo Go in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/package.json`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/package.json).
- Keep existing storage fallback logic in [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/store/useMealStore.ts), but ensure native path works as intended.
- Remove extraneous tab route declaration from [`/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/_layout.tsx`](/Users/alex/Documents/MEALTRACKINGAPP/meal-app/meal-app/app/(tabs)/_layout.tsx) so warning disappears.

## Execution Steps
- Verify Expo-compatible AsyncStorage version and update dependency using Expo-managed install flow.
- Restart Metro with clean cache and re-open on device to force native module reload path.
- Confirm `resolveDayFromTemplates` navigation no longer throws AsyncStorage runtime errors.
- Confirm persistence still works for recent flows (add/edit/remove + undo behavior).
- Confirm terminal no longer shows the `explore` extraneous route warning.

## Verification Checklist
- No `AsyncStorageError: Native module is null` while navigating days.
- No extraneous `explore` route warning at startup.
- Data persists across app restart on device.
- Lint remains clean after patch.