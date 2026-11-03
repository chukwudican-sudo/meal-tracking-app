// Bell inbox: Alex's announcements (fun facts, feature updates) read from the
// `announcements` table. Not persisted and not synced — it's server content,
// fetched on launch, on foreground and when a push arrives. "Seen" is per
// phone (AsyncStorage), by design for v1.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';
import { timeoutSignal } from '@/lib/timeoutSignal';

const SEEN_KEY = 'inbox:lastSeenAt';
const FETCH_TIMEOUT_MS = 10_000;
const PAGE = 50;

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string; // ISO
}

interface InboxStore {
  items: Announcement[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  lastSeenAt: string | null;
  seenReady: boolean; // lastSeenAt has been read from storage
  refresh: () => Promise<void>;
  markAllSeen: () => void;
  clear: () => void;
}

// Bumped by clear(): a refresh still running for the previous session must
// not refill the inbox after sign-out.
let generation = 0;

export const useInboxStore = create<InboxStore>((set, get) => ({
  items: [],
  loaded: false,
  loading: false,
  error: null,
  lastSeenAt: null,
  seenReady: false,

  refresh: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    const gen = generation;
    const t = timeoutSignal(FETCH_TIMEOUT_MS);
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, body, created_at')
        .order('created_at', { ascending: false })
        .limit(PAGE)
        .abortSignal(t.signal);
      if (error) throw new Error(error.message);
      if (gen !== generation) return;
      set({
        items: (data ?? []).map(r => ({
          id: r.id as string,
          title: String(r.title ?? ''),
          body: String(r.body ?? ''),
          createdAt: r.created_at as string,
        })),
        loaded: true,
        loading: false,
      });
    } catch (e) {
      if (gen !== generation) return;
      console.warn('[inbox] refresh failed:', e);
      set({
        loading: false,
        error: "Couldn't load messages. Check your connection and try again.",
      });
    } finally {
      t.done();
    }
  },

  markAllSeen: () => {
    if (!get().seenReady) return; // don't overwrite a value not read yet
    const newest = get().items[0]?.createdAt;
    if (!newest || newest === get().lastSeenAt) return;
    set({ lastSeenAt: newest });
    void AsyncStorage.setItem(SEEN_KEY, newest).catch(() => {});
  },

  // Sign-out: the next account starts from an empty inbox (and re-reads it).
  clear: () => {
    generation++;
    set({ items: [], loaded: false, loading: false, error: null });
  },
}));

// Read "seen" once at startup, before anything can show unread counts.
AsyncStorage.getItem(SEEN_KEY)
  .then(seen => useInboxStore.setState({ lastSeenAt: seen ?? null, seenReady: true }))
  .catch(() => useInboxStore.setState({ seenReady: true }));

// Messages newer than the last one opened in the inbox (all of them on a
// phone that has never opened it).
export function selectUnreadCount(s: Pick<InboxStore, 'items' | 'lastSeenAt' | 'seenReady'>): number {
  if (!s.seenReady) return 0;
  if (!s.lastSeenAt) return s.items.length;
  const seen = s.lastSeenAt;
  return s.items.filter(a => a.createdAt > seen).length;
}
