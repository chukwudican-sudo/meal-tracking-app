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
  const { session, initializing } = useAuth();
  const [hydrated, setHydrated] = useState(() => useMealStore.persist.hasHydrated());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Wait for the persisted store to hydrate before reconciling, so a pull
  // doesn't merge into (and then get overwritten by) pre-hydration defaults.
  useEffect(() => {
    if (hydrated) return;
    const unsub = useMealStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, [hydrated]);

  // Connectivity — drives offline queueing + reconnect flush.
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      engine.setOnline(state.isConnected !== false);
    });
    return () => unsub();
  }, []);

  // Auth session -> engine (launch + login + logout).
  useEffect(() => {
    if (initializing || !hydrated) return;
    const userId = session?.user?.id ?? null;
    if (userId && userId !== currentUserId) {
      setCurrentUserId(userId);
      void engine.onSignIn(userId);
    } else if (!userId && currentUserId) {
      setCurrentUserId(null);
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
