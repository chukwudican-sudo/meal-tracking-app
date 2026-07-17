// Durable, per-user write queue. Kept in memory for the active user and
// mirrored to AsyncStorage (debounced) so pending writes survive app restarts
// and offline periods. Ops coalesce by entityKey so rapid edits to the same
// record collapse to a single pending write. A retry limit moves permanently
// failing ("poison") items to a dead-letter state so they never block the head
// of the queue.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isUuid, newId } from './uuid';
import type { OutboxItem, OutboxOp, SyncTable } from './types';

const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

function storageKey(userId: string) {
  return `sync:outbox:${userId}`;
}

function backoffFor(attempts: number): number {
  return Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
}

export interface EnqueueInput {
  table: SyncTable;
  op: OutboxOp;
  entityKey: string;
  payload: unknown;
}

class Outbox {
  private userId: string | null = null;
  private items: OutboxItem[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  get isActive(): boolean {
    return this.userId != null;
  }

  async activate(userId: string): Promise<void> {
    this.userId = userId;
    try {
      const raw = await AsyncStorage.getItem(storageKey(userId));
      this.items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    } catch {
      this.items = [];
    }
    this.purgeUnsyncable();
  }

  // Drop meal_logs ops whose target id isn't a UUID. These are legacy artifacts
  // from an earlier build that generated `meal-<ts>` ids: meal_logs.id is a uuid
  // column, so they can never succeed. The corresponding local records are healed
  // to UUIDs by the store migration and re-enqueued by the engine's reconcile.
  private purgeUnsyncable(): void {
    const before = this.items.length;
    this.items = this.items.filter(it => {
      if (it.table !== 'meal_logs') return true;
      const p = it.payload as any;
      const id: unknown = it.op === 'delete' ? p?.mealId : p?.entry?.id;
      return typeof id !== 'string' || isUuid(id);
    });
    if (this.items.length !== before) this.schedulePersist();
  }

  deactivate(): void {
    this.flushPersist();
    this.userId = null;
    this.items = [];
  }

  enqueue(input: EnqueueInput): void {
    if (!this.userId) return; // pre-auth writes are captured by initial reconcile
    // Coalesce: drop any pending (non-dead-letter) op for the same record.
    this.items = this.items.filter(
      it => !(it.entityKey === input.entityKey && !it.deadLetter),
    );
    this.items.push({
      id: newId(),
      table: input.table,
      op: input.op,
      entityKey: input.entityKey,
      payload: input.payload,
      attempts: 0,
      nextAttemptAt: Date.now(),
    });
    this.schedulePersist();
  }

  // Items eligible to send right now (not dead-lettered, backoff elapsed).
  ready(): OutboxItem[] {
    const now = Date.now();
    return this.items.filter(it => !it.deadLetter && it.nextAttemptAt <= now);
  }

  dirtyKeys(): Set<string> {
    return new Set(this.items.filter(it => !it.deadLetter).map(it => it.entityKey));
  }

  markSuccess(id: string): void {
    this.items = this.items.filter(it => it.id !== id);
    this.schedulePersist();
  }

  // Returns true if this failure pushed the item into the dead-letter state.
  markFailure(id: string): boolean {
    const it = this.items.find(x => x.id === id);
    if (!it) return false;
    it.attempts += 1;
    if (it.attempts >= MAX_ATTEMPTS) {
      it.deadLetter = true;
    } else {
      it.nextAttemptAt = Date.now() + backoffFor(it.attempts);
    }
    this.schedulePersist();
    return it.deadLetter === true;
  }

  // Give dead-lettered items another chance — e.g. on app launch/login, after a
  // backend fix (a missing constraint, a not-yet-applied migration) that had
  // been making them fail. Without this, a transient-but-now-resolved failure
  // would keep an item parked forever. Returns how many were requeued.
  requeueDeadLetters(): number {
    const now = Date.now();
    let n = 0;
    for (const it of this.items) {
      if (it.deadLetter) {
        it.deadLetter = false;
        it.attempts = 0;
        it.nextAttemptAt = now;
        n += 1;
      }
    }
    if (n > 0) this.schedulePersist();
    return n;
  }

  // Snapshot of what's queued — for diagnostics / logging.
  describe(): { table: SyncTable; op: OutboxOp; entityKey: string; attempts: number; deadLetter: boolean }[] {
    return this.items.map(it => ({
      table: it.table,
      op: it.op,
      entityKey: it.entityKey,
      attempts: it.attempts,
      deadLetter: it.deadLetter === true,
    }));
  }

  counts(): { pending: number; deadLetter: number } {
    let pending = 0;
    let deadLetter = 0;
    for (const it of this.items) {
      if (it.deadLetter) deadLetter += 1;
      else pending += 1;
    }
    return { pending, deadLetter };
  }

  async clear(userId: string): Promise<void> {
    if (this.userId === userId) this.items = [];
    try {
      await AsyncStorage.removeItem(storageKey(userId));
    } catch {
      // ignore
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.flushPersist(), 400);
  }

  private flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.userId) return;
    const key = storageKey(this.userId);
    const value = JSON.stringify(this.items);
    AsyncStorage.setItem(key, value).catch(() => {
      // best-effort; will retry on next mutation
    });
  }
}

export const outbox = new Outbox();
