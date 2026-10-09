---
name: Fix profile wipe on relogin
overview: Force a full pull (instead of a delta pull) on the next sign-in after any sign-out, so resetUserData()'s local wipe is always correctly repopulated from the server, and tighten the onboarding login-complete gate so it can't mask an empty local cache.
todos:
  - id: fix-cursor-clear
    content: Clear the per-user delta cursor in engine.onSignOut() so the next sign-in forces a full pull
    status: completed
  - id: fix-login-complete
    content: Stop app/onboarding.tsx's loginComplete() from unconditionally forcing onboardingComplete:true
    status: completed
  - id: verify
    content: "Manually verify: onboard -> log meal/weight -> log out -> log back in -> confirm profile, meals, weight all restored"
    status: completed
isProject: false
---

## Root cause (confirmed)

`resetUserData()` (called on logout in [app/settings.tsx](app/settings.tsx)) wipes the local profile/goals/logs/weightLog to defaults, but neither it nor `engine.onSignOut()` in [lib/sync/engine.ts](lib/sync/engine.ts) clears the persisted delta cursor (`sync:lastPulledAt:${userId}`) or `sync:lastUserId`. So the next sign-in for the *same* account is classified `mode: 'same'` with an existing cursor, which forces a **delta** pull (`updated_at > cursor`) instead of a full pull. If nothing changed server-side since the last successful sync, the delta pull returns nothing, and the wiped local defaults are never restored — explaining both the "Add your name" regression and the empty Home/Plan/Progress tabs.

`onboardingComplete` is confirmed local-only (never round-tripped through `profileToUsersRow`/`usersRowToProfileGoals` in [lib/sync/mappers.ts](lib/sync/mappers.ts)), so it can only come back via this pull-and-merge path, never directly from the server row.

The `mode === 'claim'` guard is unrelated and working correctly — it only protects a brand-new account's first sync from an empty auto-created row.

## Fix 1 (primary): force a full pull after any sign-out

In `onSignOut()` in [lib/sync/engine.ts](lib/sync/engine.ts), before nulling `this.userId`, remove that user's cursor key:

```10:18:lib/sync/engine.ts
const cursorKey = (userId: string): string => `sync:lastPulledAt:${userId}`;
```

```72:84:lib/sync/engine.ts
async onSignOut(): Promise<void> {
    projector.stop();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    outbox.deactivate();
    this.userId = null;
    this.setStatus('idle');
}
```

Add `if (this.userId) await AsyncStorage.removeItem(cursorKey(this.userId));` before `this.userId = null`. This deliberately leaves `sync:lastUserId` untouched — clearing that too would flip mode to `'claim'` on the next sign-in, which protects (already-wiped) local data and re-uploads it over the good server copy, actively destroying the server's data. Only the cursor should be cleared so mode stays `'same'` (pull merges into local) but `fullPull` becomes `true` (cursor is null).

This covers every path that ends a session — explicit logout via Settings, and token-expiry-driven sign-outs picked up by `SyncProvider`'s auth listener — since all of them route through `engine.onSignOut()`.

## Fix 2 (hardening): don't let login mask an empty local cache

In [app/onboarding.tsx](app/onboarding.tsx), `loginComplete()` currently forces `onboardingComplete: true` unconditionally:

```208:211:app/onboarding.tsx
const loginComplete = () => {
    updateProfile({ onboardingComplete: true });
    router.replace('/(tabs)');
};
```

Change this to only set `onboardingComplete: true` when there's actually a first name locally after the sign-in triggers its reconcile (or, more simply, don't force it at all — let the tabs gate's existing `onboardingComplete` check make the call after the sync engine's pull has had a chance to run). Given the pull is async and login navigation is immediate, the simplest correct fix: remove the forced override and instead let `app/(tabs)/_layout.tsx`'s existing redirect-to-onboarding logic naturally handle a still-empty profile (it already redirects when `!onboardingComplete`). Need to confirm this doesn't regress a genuine returning user whose local cache was never wiped (their `onboardingComplete` should already be `true` from before) — it should be a no-op for that case.

## Notes / non-goals
- Not touching the onboarding-flow timing (account creation potentially happening before `finish()` populates the store) — Fix 1 makes this benign, since any subsequent sign-out will force a full re-pull that always converges to whatever was last successfully pushed, regardless of when the account was claimed.
- No schema/migration changes needed.
