import { create } from 'zustand';

const TOAST_DURATION_MS = 2500;

type ToastEntry = {
  id: number;
  message: string;
};

interface ToastStore {
  active: ToastEntry | null;
  showToast: (message: string) => void;
  dismissToast: () => void;
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let toastSequence = 0;

function clearToastTimeout() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
}

// Lightweight toast for non-undoable notifications. Only one is ever active;
// calling showToast again replaces the current toast and resets the timer.
export const useToastStore = create<ToastStore>((set, get) => ({
  active: null,

  showToast: (message) => {
    const nextId = ++toastSequence;
    clearToastTimeout();
    set({ active: { id: nextId, message } });
    toastTimeout = setTimeout(() => {
      const current = get().active;
      if (!current || current.id !== nextId) return;
      set({ active: null });
    }, TOAST_DURATION_MS);
  },

  dismissToast: () => {
    clearToastTimeout();
    set({ active: null });
  },
}));
