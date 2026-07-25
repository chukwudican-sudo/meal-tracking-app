// Orchestrates offline-first sync: reconcile on login/launch, drain the outbox
// when online, and expose a status snapshot. Conflict resolution is
// last-write-wins guarded by the outbox "dirty" set (a locally-pending record
// is never overwritten by a pull). One primary account per install is assumed;
// signing in as a different user resets local data and pulls the new account's.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMealStore } from '@/store/useMealStore';
import { supabase } from '@/lib/supabase';
import { outbox } from './outbox';
import { projector } from './projector';
import { pullSince, pushItem, serverNow } from './repository';
import type { SyncTable } from './types';

const LAST_USER_KEY = 'sync:lastUserId';
// Upper bound on how long we'll wait before re-draining while writes are still
// pending. The actual delay tracks the soonest item's backoff (see
// scheduleRetryIfNeeded) so a transient failure retries in ~1s, not a flat 30s.
const RETRY_DELAY_MS = 30_000;
const RETRY_MIN_DELAY_MS = 1_000;
// How long a write may sit pending before the UI surfaces it as "stuck". Chosen
// comfortably above a normal round-trip so a healthy fast sync never trips it.
const STUCK_THRESHOLD_MS = 15_000;

// Drain priority: lower goes first. `saved_recipes` writes the shared `recipes`
// row (inline) that `plan_day_meals.recipe_id` points at, so it must drain
// before `plans` or the plan insert can FK-fail when both are queued together.
// Everything else is independent and keeps its FIFO position (stable sort).
const TABLE_DRAIN_PRIORITY: Record<SyncTable, number> = {
  saved_recipes: 0,
  users: 1,
  meal_logs: 1,
  weight_logs: 1,
  kitchen_items: 1,
  cart_items: 1,
  planned_ingredients: 1,
  plans: 2,
};

// Per-user delta high-water-mark: the server timestamp captured before the last
// successful pull. Next launch/login only fetches rows changed after it.
const cursorKey = (userId: string): string => `sync:lastPulledAt:${userId}`;

export type SyncStatusValue = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  status: SyncStatusValue;
  pending: number;
  deadLetter: number;
  lastError: string | null;
  // True when a write has been pending longer than STUCK_THRESHOLD_MS, or when
  // something has dead-lettered — i.e. worth showing the user. A normal fast
  // sync leaves this false and the indicator stays hidden.
  stuck: boolean;
}

type Mode = 'claim' | 'same' | 'switch';

class SyncEngine {
  private userId: string | null = null;
  private online = true;
  private syncing = false;
  private baseStatus: SyncStatusValue = 'idle';
  private lastError: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // One-shot timer that re-evaluates the "stuck" flag when the oldest pending
  // item is due to cross STUCK_THRESHOLD_MS, so the indicator can appear on its
  // own without any store change.
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  // The currently running reconcile (if any). Tracked so a second onSignIn()
  // for the same user (e.g. the LoginView gate racing SyncProvider's auth
  // listener) awaits the in-flight pull instead of returning before it finishes.
  private reconcilePromise: Promise<void> | null = null;

  private listeners = new Set<() => void>();
  private snapshot: SyncStatus = { status: 'idle', pending: 0, deadLetter: 0, lastError: null, stuck: false };

  constructor() {
    // A live edit enqueues outside any flush cycle; react promptly so normal
    // writes drain within ~1s (not on the next foreground/heartbeat) and the
    // status snapshot reflects the new pending item right away.
    outbox.setChangeListener(() => this.onOutboxEnqueue());
  }

  private onOutboxEnqueue(): void {
    this.setStatus(this.baseStatus);
    this.scheduleRetryIfNeeded();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async onSignIn(userId: string): Promise<void> {
    if (this.userId === userId) {
      // Same user. If a reconcile is still in flight (a concurrent caller kicked
      // it off first), await it so callers that depend on the pulled data —
      // e.g. the login gate checking profile.firstName — don't observe a
      // half-populated store. Otherwise just keep the queue moving.
      if (this.reconcilePromise) {
        await this.reconcilePromise;
        return;
      }
      void this.flush();
      return;
    }
    this.userId = userId;
    this.reconcilePromise = this.reconcile(userId).finally(() => {
      this.reconcilePromise = null;
    });
    await this.reconcilePromise;
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
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
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
    if (!was && online) {
      // Reconnected — drain the queue right away. Also clear any backoff that
      // built up while offline/flaky so the first retry fires immediately
      // instead of waiting out a stale exponential-backoff timer.
      outbox.resetBackoff();
      void this.flush();
    }
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
        const pullStart = Date.now();
        const snap = await pullSince(userId, since);
        // eslint-disable-next-line no-console
        console.info(
          `[sync] reconcile pull done mode=${mode} ${fullPull ? 'full' : 'delta'} ` +
            `took=${Date.now() - pullStart}ms user=${userId.slice(0, 8)}`,
        );

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

      // Re-materialize the active plan's future days on a fresh/wiped device.
      // Runs only when an active-plan pointer exists but templates[] is empty,
      // and AFTER the pull merged today's already-logged meals — so future days
      // repopulate without duplicating or clobbering synced history. The
      // projector is live, so any today meals this fills in are captured + synced
      // just like an in-app activation.
      useMealStore.getState().hydrateActivePlanIfNeeded();

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
    // Capture the flushing user once; use `uid` (never the mutable this.userId)
    // for the whole drain. A sign-out/switch can null or flip this.userId
    // mid-loop, and `.eq('user_id', null)` serializes to user_id=eq.null →
    // Postgres 'null'::uuid → "invalid input syntax for type uuid".
    const uid = this.userId;
    if (!uid || !this.online || this.syncing) return;
    // Only push while the live auth session still belongs to this user. During
    // rapid logout→login the Supabase session can drop (or flip to another
    // account) before this.userId is cleared; pushing then hits RLS because
    // auth.uid() no longer matches the rows' user_id. Leave items queued for the
    // next stable flush instead of burning retry attempts / dead-lettering them.
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id !== uid) return;
    this.syncing = true;
    this.setStatus('syncing');
    let hadFailure = false;
    try {
      // Stable-sort by table priority so dependencies drain before dependents
      // (saved_recipes -> its recipes row -> plans that reference it),
      // regardless of FIFO/coalescing order. Array.sort is stable, so items
      // within the same priority keep their queue order.
      const ready = outbox
        .ready()
        .sort((a, b) => TABLE_DRAIN_PRIORITY[a.table] - TABLE_DRAIN_PRIORITY[b.table]);
      for (const item of ready) {
        // Signed out / switched accounts mid-drain — stop immediately so we
        // don't push with a stale auth context.
        if (this.userId !== uid) break;
        try {
          await pushItem(uid, item);
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
    if (this.retryTimer || !this.online) return;
    const earliest = outbox.earliestNextAttempt();
    if (earliest === null) return; // nothing pending
    // Wake exactly when the soonest item's backoff elapses (clamped to a small
    // floor so bursts batch, and capped so we never wait longer than the old
    // heartbeat). A dependency/transient failure with a ~2s backoff now retries
    // in ~2s instead of waiting a flat 30s.
    const delay = Math.min(RETRY_DELAY_MS, Math.max(RETRY_MIN_DELAY_MS, earliest - Date.now()));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
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
    const { stuck: pendingStuck, nextCrossAt } = outbox.stuckState(Date.now(), STUCK_THRESHOLD_MS);
    // Only surface "stuck" while online: sitting unsynced because the device is
    // offline is expected, not a problem, so the indicator stays hidden until
    // connectivity is back and something still genuinely isn't syncing.
    const stuck = this.online && (deadLetter > 0 || pendingStuck);
    this.snapshot = { status, pending, deadLetter, lastError: this.lastError, stuck };
    this.listeners.forEach(f => f());
    // If an item will cross the "stuck" threshold later, schedule a single
    // re-eval at that moment so the indicator flips on its own. Skip while
    // offline — nothing can change until we reconnect (which re-runs setStatus).
    this.scheduleStuckCheck(this.online ? nextCrossAt : null);
  }

  private scheduleStuckCheck(nextCrossAt: number | null): void {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
    if (nextCrossAt === null) return;
    const delay = Math.max(0, nextCrossAt - Date.now());
    this.stuckTimer = setTimeout(() => {
      this.stuckTimer = null;
      this.setStatus(this.baseStatus);
    }, delay);
  }
}

export const engine = new SyncEngine();
