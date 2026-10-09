---
name: Sync logout warning and status indicator
overview: Remove the blocking "unsynced changes" logout warning for verified sessions (keep it only for the genuinely unrecoverable unverified case), add a small non-blocking sync status icon to the Home tab, and report on / harden against the outbox growth found during testing.
todos:
  - id: logout-warning
    content: Remove blocking 'Unsynced changes' Alert from performLogout() in app/settings.tsx for verified sessions; keep the unverified hard-warning path untouched
    status: completed
  - id: sync-icon-component
    content: Create components/SyncStatusIcon.tsx using useSyncStatus(), hidden when no pending/deadLetter items
    status: completed
  - id: sync-icon-wireup
    content: Render SyncStatusIcon in Home tab's headerRight row in app/(tabs)/index.tsx
    status: completed
  - id: outbox-dedup-fix
    content: Fix enqueue() coalescing in lib/sync/outbox.ts to drop stale dead-lettered items sharing an entityKey, preventing duplicate accumulation
    status: completed
isProject: false
---

## 1. Remove blocking logout warning for verified sessions

File: [app/settings.tsx](app/settings.tsx)

Today `performLogout()` (lines 56-73) calls `engine.prepareSignOut()`, and if `pending + deadLetter > 0` it shows a blocking "Unsynced changes" `Alert` with "Stay" / "Log out anyway" — this is the part to remove for the verified-session path.

Change:
- Collapse `performLogout()` into a single fire-and-forget flow: still call `engine.prepareSignOut()` (stops the projector and attempts a best-effort flush while the token is valid — keep this, it's genuinely useful and non-blocking), but drop the `Alert.alert('Unsynced changes', ...)` branch entirely. Proceed straight to `finishLogout()` regardless of the returned `{pending, deadLetter}` counts.
- The verified-session `Alert.alert('Log out?', 'You can sign back in anytime.', ...)` confirmation in `handleLogout()` stays as-is (that's just the normal "are you sure" prompt, not the unsynced-data warning).
- Leave the unverified branch (`!session` → "Log out and erase your data?" hard warning in `finishUnverifiedLogout`) completely untouched — that's the genuinely unrecoverable case per the user's request.

Net effect: tapping "Log out" on a verified account is now Confirm → instant logout, with syncing continuing to happen safely in the background/on next login for anything not yet flushed.

## 2. Non-blocking sync status indicator on Home

New file: `components/SyncStatusIcon.tsx`
- Uses the existing `useSyncStatus()` hook from [lib/sync/SyncProvider.tsx](lib/sync/SyncProvider.tsx) (already wired to `engine.subscribe`/`getSnapshot`, returns `{status, pending, deadLetter, lastError}` — currently unused anywhere in the UI).
- Returns `null` when `pending === 0 && deadLetter === 0` — fully invisible during normal operation, so it never distracts.
- When there are unsynced items, renders a small `Ionicons` cloud icon (matching the icon convention already used in `EmailVerificationBanner.tsx`) with a tiny count badge (reusing the badge pattern from [components/NotificationIcon.tsx](components/NotificationIcon.tsx)):
  - `status === 'syncing'`: `cloud-upload-outline`, `COLORS.textSecondary` (actively draining).
  - `deadLetter > 0` (retries exhausted, needs a foreground/login to retry): `cloud-offline-outline`, `COLORS.orange`.
  - Otherwise (`pending > 0`, idle/waiting on backoff or offline): `cloud-outline`, `COLORS.textSecondary`.
- Purely informational — no press handler required (matches "subtle... without ever blocking anything"); can be a plain `View`, not `TouchableOpacity`.

Wire-up in [app/(tabs)/index.tsx](app/(tabs)/index.tsx):
- Import and render `<SyncStatusIcon />` inside the existing `headerRight` row (lines ~140-152), alongside `ProfileIcon`/`NotificationIcon` — no layout restructuring needed, it slots into the existing `gap: 8` row.

## 3. Outbox growth investigation (79 pending items)

Findings (no code changes required to explain this, but see hardening fix below):

- `refreshGroceryWeek()` in [store/useMealStore.ts](store/useMealStore.ts) regenerates the whole week's `planned_ingredients` from templates in one call. `hydrateActivePlanIfNeeded()` calls this every login where local `templates[]` is empty — so a single restore can enqueue 30+ distinct `planned_ingredients` entityKeys at once (this matches the earlier observed `planned_ingredients.upsert (...) ×34` RLS errors from the same test session).
- The heavy rapid logout/login cycling done today repeatedly hit the exact pre-fix race condition (session dropping mid-flush) we just patched in `engine.flush()` — each cycle could genuinely fail a fresh batch of pushes.
- Real bug found in [lib/sync/outbox.ts](lib/sync/outbox.ts) `enqueue()` (lines 71-87): the coalescing filter only drops existing *pending* items sharing an `entityKey` — `!(it.entityKey === input.entityKey && !it.deadLetter)` explicitly skips dead-lettered items. So once an entity's write is dead-lettered, a later edit to that same entity adds a new pending item alongside the old dead-lettered one instead of replacing it. Across several failing cycles, this compounds: duplicate rows for the same logical record pile up instead of collapsing to one.
- Conclusion: 79 is consistent with (a) today's heavy testing/cycling, (b) the grocery-week regeneration burst on each restore, and (c) the dead-letter/coalescing gap above — not a sign that draining is broken going forward, especially now that the flush race is fixed. But the coalescing gap is worth closing so it can't recur.

Hardening fix (recommended, small): in `outbox.enqueue()`, change the coalescing filter to drop **any** existing item for the same `entityKey` regardless of `deadLetter` status, so a fresh edit to a still-failing entity fully replaces the stale attempt (fresh `attempts: 0`) rather than leaving a permanent duplicate parked next to it.

```71:76:lib/sync/outbox.ts
  enqueue(input: EnqueueInput): void {
    if (!this.userId) return; // pre-auth writes are captured by initial reconcile
    // Coalesce: drop any pending (non-dead-letter) op for the same record.
    this.items = this.items.filter(
      it => !(it.entityKey === input.entityKey && !it.deadLetter),
    );
```
becomes a filter that drops *all* items (dead-lettered or not) matching `entityKey`.

## Todos
