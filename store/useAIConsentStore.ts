import { create } from 'zustand';

// The AI permission sheet (Apple 5.1.2). Not persisted: the answer itself
// lives on the profile (useMealStore setAiConsent). Hosts: one in the root
// layout plus one inside every RN Modal an AI request can start from — on iOS
// a modal opened from underneath would be hidden — and the most recently
// shown host (the top layer) renders the sheet.

interface AIConsentStore {
  hosts: string[];
  // A request waiting for Allow / Not now (shared by concurrent asks).
  pending: {
    promise: Promise<boolean>;
    resolve: (allowed: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null;
  addHost: (id: string) => void;
  removeHost: (id: string) => void;
  ask: () => Promise<boolean>;
  answer: (allowed: boolean) => void;
}

const ANSWER_TIMEOUT_MS = 3 * 60_000;

export const useAIConsentStore = create<AIConsentStore>((set, get) => ({
  hosts: [],
  pending: null,
  addHost: id => set(s => ({ hosts: [...s.hosts.filter(h => h !== id), id] })),
  removeHost: id => set(s => ({ hosts: s.hosts.filter(h => h !== id) })),
  ask: () => {
    const existing = get().pending;
    if (existing) return existing.promise;
    let resolve!: (allowed: boolean) => void;
    const promise = new Promise<boolean>(r => { resolve = r; });
    // One timer per question (not per waiting request): an unanswered sheet
    // must not leave spinners running forever — treat it as "Not now".
    const timer = setTimeout(() => get().answer(false), ANSWER_TIMEOUT_MS);
    set({ pending: { promise, resolve, timer } });
    return promise;
  },
  answer: allowed => {
    const p = get().pending;
    if (!p) return;
    clearTimeout(p.timer);
    set({ pending: null });
    p.resolve(allowed);
  },
}));
