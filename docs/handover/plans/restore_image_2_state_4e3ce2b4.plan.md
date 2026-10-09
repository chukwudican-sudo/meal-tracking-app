---
name: Restore Image 2 State
overview: "Five fixes to restore image 2: delete explore.tsx, auto-load today's meals on mount, overhaul seed templates (add Pre-workout, fix Lunch/Dinner, seed past logs, streak), update WeekStrip dot logic."
todos:
  - id: delete-explore
    content: Delete app/(tabs)/explore.tsx entirely + hide in _layout.tsx
    status: completed
  - id: auto-load-today
    content: "app/(tabs)/index.tsx: useEffect to call resolveDayFromTemplates on mount"
    status: completed
  - id: seed-data
    content: "store/useMealStore.ts: add Pre-workout, fix Lunch/Dinner calories+time, seed past 2 days logs, streak=5, bump storage key to v2"
    status: completed
  - id: dot-logic
    content: "WeekStrip.tsx: gray dot = has applicable templates, green dot = has completed meals; day label+number green = today only"
    status: completed
isProject: false
---

# Restore to Image 2 State

## What is wrong right now (image 1 vs image 2)

- **Extra "explore" tab** — `explore.tsx` still exists; Expo Router auto-creates it as a 5th tab
- **Empty meal list** — `resolveDayFromTemplates` is never called on initial mount, so today's meals never appear
- **Streak = 0, no dots** — no logs exist in the store, so streak is 0 and week strip shows no dots
- **Wrong seed templates** — Lunch is 620 kcal (should be 520), Dinner is 580 kcal at 19:00 (should be 480 at 19:30), Pre-workout is missing (16:30, 200 kcal)

---

## Fix 1 — Delete explore tab

**Files:** `app/(tabs)/explore.tsx` (delete) + [`app/(tabs)/_layout.tsx`](meal-app/app/(tabs)/_layout.tsx)

Delete `explore.tsx` entirely. Also add a hidden screen entry in `_layout.tsx` as a safety net in case Expo Router caches the old route:

```typescript
<Tabs.Screen name="explore" options={{ href: null }} />
```

---

## Fix 2 — Auto-load today's meals on mount

**File:** [`app/(tabs)/index.tsx`](meal-app/app/(tabs)/index.tsx)

Add `useEffect` after the store destructure in `HomeScreen`:

```typescript
useEffect(() => {
  resolveDayFromTemplates(toIsoDate(new Date()));
}, []);
```

---

## Fix 3 — Seed data overhaul

**File:** [`store/useMealStore.ts`](meal-app/store/useMealStore.ts)

**a) Update/add templates to match image 2:**
- Lunch: 620 → 520 kcal, macros adjusted
- Add Pre-workout: `id: 'tpl-5'`, weekdays only `[1,2,3,4,5]`, `time: '16:30'`, 200 kcal
- Dinner: 580 → 480 kcal, `19:00` → `19:30`, macros `42P / 38C / 16F`

**b) Pre-seed 2 past days' logs dynamically at module load** (so green dots appear on strip immediately):

```typescript
function buildSeedLog(daysAgo: number): [string, DailyLog] {
  // computes date relative to today at module-load time
  // all meals set to 'completed'
}
const SEED_LOGS = Object.fromEntries([buildSeedLog(2), buildSeedLog(1)]);
// initial state: logs: SEED_LOGS, streak: 5
```

**c) Change AsyncStorage key** `'meal-app-store'` → `'meal-app-store-v2'` to force a fresh read of the new seed.

---

## Fix 4 — Week strip dot logic

**File:** [`components/WeekStrip.tsx`](meal-app/components/WeekStrip.tsx)

Read `templates` in addition to `logs` from the store. Per cell:

- Day label + date number: **green if `isToday`** (current real date), gray otherwise — independent of dot
- `hasCompleted(iso)` = `logs[iso]?.meals.some(m => m.status === 'completed')` → **green dot**
- `hasTemplates(iso)` = any template recurrence applies to that day-of-week → **gray dot**
- Neither → no dot

---

## Files changing

- `app/(tabs)/explore.tsx` — deleted
- [`app/(tabs)/_layout.tsx`](meal-app/app/(tabs)/_layout.tsx) — hide explore, safety net
- [`app/(tabs)/index.tsx`](meal-app/app/(tabs)/index.tsx) — useEffect auto-load
- [`store/useMealStore.ts`](meal-app/store/useMealStore.ts) — templates, seed logs, streak, storage key
- [`components/WeekStrip.tsx`](meal-app/components/WeekStrip.tsx) — two-color dot logic
