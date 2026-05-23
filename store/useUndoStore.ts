import { create } from 'zustand';

const UNDO_WINDOW_MS = 5000;

type UndoEntry = {
  id: number;
  message: string;
  undo: () => void;
  expiresAt: number;
};

interface UndoStore {
  active: UndoEntry | null;
  showUndo: (payload: { message: string; undo: () => void }) => void;
  runUndo: () => void;
  dismissUndo: () => void;
}

let undoTimeout: ReturnType<typeof setTimeout> | null = null;
let undoSequence = 0;

function clearUndoTimeout() {
  if (undoTimeout) {
    clearTimeout(undoTimeout);
    undoTimeout = null;
  }
}

export const useUndoStore = create<UndoStore>((set, get) => ({
  active: null,

  showUndo: ({ message, undo }) => {
    const nextId = ++undoSequence;
    const expiresAt = Date.now() + UNDO_WINDOW_MS;

    clearUndoTimeout();
    set({
      active: {
        id: nextId,
        message,
        undo,
        expiresAt,
      },
    });

    undoTimeout = setTimeout(() => {
      const current = get().active;
      if (!current || current.id !== nextId) return;
      set({ active: null });
    }, UNDO_WINDOW_MS);
  },

  runUndo: () => {
    const current = get().active;
    if (!current) return;

    clearUndoTimeout();
    set({ active: null });
    current.undo();
  },

  dismissUndo: () => {
    clearUndoTimeout();
    set({ active: null });
  },
}));
