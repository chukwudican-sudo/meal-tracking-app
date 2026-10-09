---
name: AI latency and loading UX
overview: Parallelize pre-Gemini DB checks across all 10 AI edge functions, make logAiUsage fire-and-forget (keeping consumeFreeScan blocking), and introduce a shared progressive-loading component with cycling status messages to the four longest-running AI screens.
todos:
  - id: parallelize-prechecks
    content: Parallelize profile-fetch + rate-limit-check via Promise.all in all 10 AI edge functions (after getAuthedUser resolves)
    status: completed
  - id: fire-and-forget-log
    content: Remove await from logAiUsage in all 10 AI edge functions (keep consumeFreeScan fully awaited)
    status: completed
  - id: progressive-loader-component
    content: Create components/ProgressiveLoader.tsx — reusable timer-based cycling-message loader (ActivityIndicator + rotating text)
    status: completed
  - id: wire-progressive-custom-concept
    content: Replace LoadingScreen in app/ai/custom.tsx (stage=creating) with ProgressiveLoader
    status: completed
  - id: wire-progressive-custom-steps
    content: Replace LoadingScreen in app/ai/custom.tsx (stage=building) with ProgressiveLoader
    status: completed
  - id: wire-progressive-kitchen-scan
    content: Replace static spinner in KitchenScanModal.tsx (step=scanning) with ProgressiveLoader
    status: completed
  - id: wire-progressive-what-can-i-make
    content: Replace static spinner in what-can-i-make.tsx (phase=loading) with ProgressiveLoader
    status: completed
isProject: false
---

# AI Latency Reduction and Progressive Loading UX

## 1. Backend: Parallelize pre-Gemini checks (all 10 functions)

Currently every function runs this chain sequentially:

```
await getAuthedUser(req, admin)      // ~30-80ms
await admin.from('users').select(…)  // ~30-80ms   ← independent
await isRateLimited(admin, user.id…) // ~30-80ms   ← independent
```

Profile fetch and rate-limit check both only need `user.id` — they can run in parallel once auth resolves. The pattern to apply in each function:

```typescript
// Before (sequential):
const { data: profileRow, error: profileErr } = await admin
  .from('users').select(…).eq('id', user.id).single();
if (profileErr || !profileRow) { … }

const entitlement = resolveEntitlement(…);
if (!entitlement.allowed) { … }

let limited: boolean;
try {
  limited = await isRateLimited(admin, user.id, FUNCTION_NAME, RATE_LIMIT, RATE_WINDOW_MS);
} catch (e) { … }

// After (parallel):
const [profileResult, rateLimitResult] = await Promise.all([
  admin.from('users').select(…).eq('id', user.id).single(),
  isRateLimited(admin, user.id, FUNCTION_NAME, RATE_LIMIT, RATE_WINDOW_MS)
    .catch((e) => { console.error(…); return null; }),
]);

const { data: profileRow, error: profileErr } = profileResult;
if (profileErr || !profileRow) { … }

const entitlement = resolveEntitlement(…);
if (!entitlement.allowed) { … }

if (rateLimitResult === null) return errorResponse('ai_failed', 'Could not check usage', 500);
if (rateLimitResult) return errorResponse('rate_limited', …, 429);
```

**Applies to all 10 functions:** estimate-nutrition, fix-meal, scan-meal, scan-kitchen, suggest-kitchen-recipes, generate-meal-suggestions, generate-plan-shortlist, generate-recipe-concept, generate-recipe-steps, recipe-assistant.

Note: `recipe-assistant` uses `isEntitled()` directly (no free-scan resolution), but the profile fetch and rate-limit check are still independent and parallelizable the same way.

**Expected savings:** ~30-80ms per request (one fewer sequential DB round-trip).

## 2. Backend: Fire-and-forget logAiUsage (all 10 functions)

Currently (e.g., [estimate-nutrition/index.ts](supabase/functions/estimate-nutrition/index.ts) lines 213-220):

```typescript
await logAiUsage(admin, user.id, FUNCTION_NAME);
if (!entitlement.isSubscriber) {
  await consumeFreeScan(admin, user.id);
}
return jsonResponse(estimate, 200);
```

Change to:

```typescript
// Fire-and-forget: usage logging is bookkeeping, not correctness-critical.
void logAiUsage(admin, user.id, FUNCTION_NAME);

// consumeFreeScan stays blocking — atomic enforcement of the 5-scan limit.
if (!entitlement.isSubscriber) {
  await consumeFreeScan(admin, user.id);
}
return jsonResponse(estimate, 200);
```

For the two subscription-only functions (`generate-recipe-steps`, `recipe-assistant`) that never call `consumeFreeScan`, the response now returns immediately after Gemini with zero post-call DB blocking.

**Expected savings:** ~30-80ms per request (one fewer awaited DB write before response).

## 3. UX: Shared progressive-loading component

Extract the timer-based cycling-message pattern from [app/onboarding.tsx](app/onboarding.tsx) (lines 737-759, `ProcessingStep`) into a new shared component at `components/ProgressiveLoader.tsx`.

### Component design

```typescript
// components/ProgressiveLoader.tsx
interface ProgressiveLoaderProps {
  messages: string[];       // e.g. ["Scanning your kitchen…", "Identifying items…", "Almost done…"]
  cycleDurationMs?: number; // total estimated wait time (default ~12000, used to pace messages)
}
```

Behavior:
- Shows `ActivityIndicator` (large, green) + a `Text` that cycles through `messages` on a timer.
- Timer divides `cycleDurationMs` evenly across `messages.length` intervals (e.g., 3 messages over 12s = message change every 4s).
- After the last message is reached, it stays there until the parent unmounts the component (the real async call finished). No ProgressRing/percentage (that's onboarding-specific and would feel out of place for an indeterminate wait).
- Style matches the existing static-spinner pattern already in use (centered, same font/colors).

### Where to apply it

| Screen | Current component/location | Messages (examples) |
|--------|--------------------------|-------------------|
| Custom Recipe concept | [app/ai/custom.tsx](app/ai/custom.tsx) `LoadingScreen` (line 590) | "Designing your recipe...", "Matching your preferences...", "Almost ready..." |
| Custom Recipe steps | Same `LoadingScreen`, `stage === 'building'` | "Generating ingredients...", "Writing step-by-step instructions...", "Finalizing..." |
| Kitchen scan | [components/grocery/KitchenScanModal.tsx](components/grocery/KitchenScanModal.tsx) line 192 | "Scanning your photos...", "Identifying ingredients...", "Organizing results..." |
| What Can I Make | [app/ai/what-can-i-make.tsx](app/ai/what-can-i-make.tsx) line 296 | "Checking your kitchen inventory...", "Finding matching recipes...", "Building suggestions..." |

Each screen replaces its current `ActivityIndicator + static Text` with `<ProgressiveLoader messages={[…]} />`.

Build My Plan's shortlist screen (already the best loading state in the app with its dynamic sub-message) is left unchanged — its loading is already contextual and informative.

## 4. Lower priority: AI Describe visibility (noted, not in this pass)

[components/addMeal/AITab.tsx](components/addMeal/AITab.tsx) line 243 — the only loading indicator is a spinner inside the 34x34 send button. This isn't a duration issue (AI Describe typically responds in 2-5s), just a discoverability one. A lightweight enhancement (e.g., a subtle pulsing border or a small status line below the input: "Estimating...") could be added separately without the progressive-loader pattern, since the wait is short enough that cycling messages would feel excessive. Noted for a future pass.
