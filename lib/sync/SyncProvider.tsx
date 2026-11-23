// Wires the sync engine into the app lifecycle. It has no UI of its own; it
// starts a reconcile once the store has hydrated and a session exists (launch /
// login), flushes the outbox when the app returns to the foreground, and tracks
// connectivity so writes drain automatically when the network comes back.

import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useMealStore } from '@/store/useMealStore';
import { engine, type SyncStatus } from './engine';

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session, initializing, savedUserId } = useAuth();
  const onboarded = useMealStore(s => s.profile.onboardingComplete);
  const [hydrated, setHydrated] = useState(() => useMealStore.persist.hasHydrated());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Wait for the persisted store to hydrate before reconciling, so a pull
  // doesn't merge into (and then get overwritten by) pre-hydration defaults.
  useEffect(() => {
    if (hydrated) return;
    const unsub = useMealStore.persist.onFinishHydration(() => setHydrated(true));
    // Hydration may have finished between render and this effect (the
    // listener would never fire, and nothing would sync that launch).
    if (useMealStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);

  // Connectivity — drives offline queueing + reconnect flush.
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      engine.setOnline(state.isConnected !== false);
    });
    return () => unsub();
  }, []);

  // Saved login -> start recording at once (engine.startCapture), so edits
  // made on Home before Supabase confirms the login (offline: possibly for a
  // long time) still upload. Only for an account set up on this phone, and
  // after hydration (an earlier baseline would see hydration as edits).
  useEffect(() => {
    if (!hydrated) return;
    if (savedUserId && onboarded) void engine.startCapture(savedUserId);
    else engine.stopCapture();
  }, [hydrated, savedUserId, onboarded]);

  // Auth session -> engine (launch + login + logout).
  useEffect(() => {
    if (initializing || !hydrated) return;
    const userId = session?.user?.id ?? null;
    if (userId && userId !== currentUserId) {
      setCurrentUserId(userId);
      void engine.onSignIn(userId);
    } else if (!userId && currentUserId) {
      setCurrentUserId(null);
      fillTimedOutFor = null; // a later sign-in waits for its own download
      void engine.onSignOut();
    }
  }, [session, initializing, hydrated, currentUserId]);

  // Flush the queue whenever the app returns to the foreground. This also
  // requeues any dead-lettered writes so a transient/now-resolved backend error
  // can recover on the next foreground rather than staying parked forever.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void engine.retryFailedWrites();
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}

// Subscribe to live sync status (state, pending/dead-letter counts, last error).
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}

const DAY_FILL_WAIT_MS = 5_000;
// The account the 5s wait already ran out for: later screens don't wait again.
let fillTimedOutFor: string | null = null;
const readyUserIdSnapshot = () => engine.getSnapshot().readyUserId;

// When a screen may fill a day from the plan (resolveDayFromTemplates): once
// the signed-in account's download has finished. Sync is then watching, so the
// new meals upload, and a day another phone already filled has arrived instead
// of being built twice — pull first, then make changes (the WatermelonDB
// order). Home filled today at mount before, while sync wasn't watching yet:
// those meals counted as uploaded and never were (Nov 19). No session = no
// sync to wait for. Gives up after 5s so a slow network never leaves the day
// empty (sync is watching by then; only the pull is late).
export function useDayFillReady(): boolean {
  // The saved login counts: sync records for it from launch (startCapture).
  const { userId } = useAuth();
  // Only this field: the whole status changes on every queued write.
  const readyUserId = useSyncExternalStore(engine.subscribe, readyUserIdSnapshot, readyUserIdSnapshot);
  const synced = !userId || readyUserId === userId;
  const [, setTimedOut] = useState(false);
  useEffect(() => {
    if (synced || !userId || fillTimedOutFor === userId) return;
    const t = setTimeout(() => {
      fillTimedOutFor = userId;
      setTimedOut(true);
    }, DAY_FILL_WAIT_MS);
    return () => clearTimeout(t);
  }, [synced, userId]);
  return synced || fillTimedOutFor === userId;
}
