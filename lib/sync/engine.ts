// Orchestrates offline-first sync: reconcile on login/launch, drain the outbox
// when online, and expose a status snapshot. Conflict resolution is
// last-write-wins guarded by the outbox "dirty" set (a locally-pending record
// is never overwritten by a pull). One primary account per install is assumed;
// signing in as a different user resets local data and pulls the new account's.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMealStore } from '@/store/useMealStore';
import { outbox } from './outbox';
import { projector } from './projector';
import { pullSince, pushItem, serverNow } from './repository';

const LAST_USER_KEY = 'sync:lastUserId';
const RETRY_DELAY_MS = 30_000;

// Per-user delta high-water-mark: the server timestamp captured before the last
// successful pull. Next launch/login only fetches rows changed after it.
const cursorKey = (userId: string): string => `sync:lastPulledAt:${userId}`;

export type SyncStatusValue = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  status: SyncStatusValue;
  pending: number;
  deadLetter: number;
  lastError: string | null;
}

type Mode = 'claim' | 'same' | 'switch';

class SyncEngine {
  private userId: string | null = null;
  private online = true;
  private syncing = false;
  private baseStatus: SyncStatusValue = 'idle';
  private lastError: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private listeners = new Set<() => void>();
  private snapshot: SyncStatus = { status: 'idle', pending: 0, deadLetter: 0, lastError: null };

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async onSignIn(userId: string): Promise<void> {
    if (this.userId === userId) {
      // Same user (e.g. token refresh) — just make sure the queue is moving.
      void this.flush();
      return;
    }
    this.userId = userId;
    await this.reconcile(userId);
  }

  // First half of a safe sign-out. Stop capturing FIRST so that resetting the
  // local cache after sign-out can't be observed as a wave of deletes and
  // replicated to the server. Then push everything still queued while the auth
  // token is valid, and report whatever couldn't be sent (pending/dead-lettered)
  // so the caller can warn before ending the session. If the user cancels, call
  // resumeAfterCancelledSignOut() to start capturing again.
  async prepareSignOut(): Promise<{ pending: number; deadLetter: number }> {
    projector.stop();
    if (this.userId && this.online) await this.flush();
    return outbox.counts();
  }

  // Undo prepareSignOut() when the user backs out of logging out: resume change
  // capture from the current state so subsequent edits are still synced.
  resumeAfterCancelledSignOut(): void {
    if (this.userId) projector.start();
  }

  async onSignOut(): Promise<void> {
    projector.stop();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // Do NOT clear the outbox: any still-pending writes must survive sign-out so
    // they can be flushed the next time this account signs in on this device.
    // deactivate() persists them to storage and drops the in-memory copy.
    outbox.deactivate();

    // The local cache is about to be wiped by resetUserData() on logout. Drop
    // this account's delta cursor — but NOT sync:lastUserId — so the next
    // sign-in for the SAME account still resolves to mode 'same' (a pull merges
    // into the empty local cache) yet, with cursor === null, is forced to do a
    // FULL pull rather than an incremental one. A delta pull can legitimately
    // return nothing when the server hasn't changed since the last sync, which
    // would otherwise leave the wiped cache empty forever (missing profile +
    // blank tabs). Clearing sync:lastUserId instead would flip mode to 'claim',
    // which protects the (now-empty) local data and re-uploads it over the good
    // server copy — the opposite of what we want.
    if (this.userId) {
      try {
        await AsyncStorage.removeItem(cursorKey(this.userId));
      } catch {
        // best-effort; worst case is one extra delta pull on next sign-in
      }
    }

    this.userId = null;
    this.setStatus('idle');
  }

  setOnline(online: boolean): void {
    const was = this.online;
    this.online = online;
    this.setStatus(this.baseStatus);
    if (!was && online) void this.flush(); // reconnected — drain queue
  }

  // ── reconcile ───────────────────────────────────────────────────────────────

  private async reconcile(userId: string): Promise<void> {
    try {
      this.setStatus('syncing');
      const lastUserId = await AsyncStorage.getItem(LAST_USER_KEY);
      const mode: Mode = !lastUserId ? 'claim' : lastUserId === userId ? 'same' : 'switch';

      // A different account on this install must not push the previous user's
      // local cache; wipe local user data and pull the new account fresh.
      if (mode === 'switch') {
        useMealStore.getState().resetUserData();
      }

      await outbox.activate(userId);

      // Retry anything that dead-lettered in a previous session. Items that
      // failed against a not-yet-migrated backend (missing constraint/seed) would
      // otherwise stay parked forever even after the schema is fixed. Launch/login
      // is the natural point to give them a fresh set of attempts.
      const requeued = outbox.requeueDeadLetters();
      if (requeued > 0) {
        // eslint-disable-next-line no-console
        console.info(`[sync] requeued ${requeued} dead-lettered write(s) for retry`);
      }

      projector.start(); // baseline = current (post-reset) state, begin capturing

      if (this.online) {
        // A full pull is required whenever we can't trust an incremental cursor:
        // first claim, account switch, or a returning account with no cursor yet
        // (fresh install / pre-delta upgrade). Otherwise pull only what changed.
        const cursor = await AsyncStorage.getItem(cursorKey(userId));
        const fullPull = mode !== 'same' || cursor === null;
        const since = fullPull ? null : cursor;

        // Capture server time BEFORE the pull so rows written concurrently (or by
        // this very reconcile) still fall after the cursor and are caught next time.
        const stamp = await serverNow();
        const snap = await pullSince(userId, since);

        if (mode === 'claim') {
          // The account's users row was just auto-created (near-empty); local
          // profile/goals are authoritative, so don't let the empty server row
          // clobber them — they get uploaded by enqueueAll below.
          delete snap.profile;
          delete snap.goals;
        }
        useMealStore.getState().applyServerSnapshot(snap, outbox.dirtyKeys());
        projector.rebaseline(); // applied server data must not echo back

        if (mode === 'claim') {
          // First time this device's local data is tied to the account: upload it.
          projector.enqueueAll();
        } else if (fullPull) {
          // Returning/switched account with a full snapshot: upload any local
          // records the server is missing (offline creates, or ids healed by the
          // store migration) so nothing stays stranded on-device. Gated to full
          // pulls only — running this against a partial delta would re-upload
          // everything the delta didn't include.
          projector.enqueueMissing(snap);
        }
        // Delta pulls re-enqueue nothing: local edits are already captured live.

        // Advance the cursor only after a successful pull + apply.
        await AsyncStorage.setItem(cursorKey(userId), stamp);
      }

      await AsyncStorage.setItem(LAST_USER_KEY, userId);
      await this.flush();
      this.setStatus(this.online ? 'idle' : 'offline');
    } catch (e: any) {
      this.lastError = e?.message ?? 'Sync failed';
      // Surface the real reason the pull/reconcile failed (network, RLS, schema
      // mismatch, …) — silent here previously meant a login-time failure had no
      // visible trace in the console at all.
      // eslint-disable-next-line no-console
      console.warn(`[sync] reconcile failed for ${userId}: ${this.lastError}`);
      this.setStatus('error');
    }
  }

  // ── outbox drain ────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (!this.userId || !this.online || this.syncing) return;
    this.syncing = true;
    this.setStatus('syncing');
    let hadFailure = false;
    try {
      const ready = outbox.ready();
      for (const item of ready) {
        try {
          await pushItem(this.userId, item);
          outbox.markSuccess(item.id);
        } catch (e: any) {
          hadFailure = true;
          const msg = e?.message ?? String(e);
          this.lastError = `${item.table}.${item.op}: ${msg}`;
          const deadLettered = outbox.markFailure(item.id);
          // Surface the real reason a write isn't reaching Supabase (RLS denial,
          // missing constraint/migration, FK violation, schema mismatch, …).
          // eslint-disable-next-line no-console
          console.warn(
            `[sync] push failed — ${item.table}.${item.op} (${item.entityKey})` +
              `${deadLettered ? ' [DEAD-LETTERED after max attempts]' : ''}: ${msg}`,
          );
        }
      }
    } finally {
      this.syncing = false;
      this.setStatus(hadFailure ? 'error' : this.online ? 'idle' : 'offline');
      this.scheduleRetryIfNeeded();
    }
  }

  // Manually give dead-lettered writes another chance and drain the queue.
  // Used on app foreground so a user who hit a transient/now-fixed backend error
  // can recover without reinstalling or logging out.
  async retryFailedWrites(): Promise<void> {
    if (!this.userId) return;
    outbox.requeueDeadLetters();
    await this.flush();
  }

  // Diagnostics: what's currently queued and why it's stuck.
  debugOutbox(): { table: string; op: string; entityKey: string; attempts: number; deadLetter: boolean }[] {
    return outbox.describe();
  }

  private scheduleRetryIfNeeded(): void {
    if (this.retryTimer) return;
    const { pending } = outbox.counts();
    if (pending <= 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, RETRY_DELAY_MS);
  }

  // ── status pub/sub (for useSyncExternalStore) ────────────────────────────────

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): SyncStatus => this.snapshot;

  private setStatus(base: SyncStatusValue): void {
    this.baseStatus = base;
    const status: SyncStatusValue = !this.online && base !== 'error' ? 'offline' : base;
    const { pending, deadLetter } = outbox.counts();
    this.snapshot = { status, pending, deadLetter, lastError: this.lastError };
    this.listeners.forEach(f => f());
  }
}

export const engine = new SyncEngine();
