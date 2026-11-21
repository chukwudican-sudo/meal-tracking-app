import { create } from 'zustand';

// Recipe Assistant conversations, one per recipe, kept in memory while the
// app runs: closing the chat page and opening it again keeps the
// conversation (and anything typed but not sent). Never persisted or synced;
// cleared on sign-out (lib/auth.tsx) so the next account never sees them.

export interface RecipeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface RecipeChatStore {
  chats: Record<string, RecipeChatMessage[]>;
  // Recipes with a request in flight (survives leaving and reopening the page).
  busy: Record<string, boolean>;
  // The text box per recipe; a failed send puts its question back here even
  // if the page was closed meanwhile.
  drafts: Record<string, string>;
  // Bumped by clearAll: a reply that arrives after a sign-out is dropped.
  epoch: number;
  append: (recipeId: string, message: RecipeChatMessage, epoch: number) => void;
  remove: (recipeId: string, messageId: string, epoch: number) => void;
  setBusy: (recipeId: string, busy: boolean) => void;
  setDraft: (recipeId: string, text: string) => void;
  clearAll: () => void;
}

export const useRecipeChatStore = create<RecipeChatStore>((set, get) => ({
  chats: {},
  busy: {},
  drafts: {},
  epoch: 0,

  append: (recipeId, message, epoch) => {
    if (epoch !== get().epoch) return;
    set(s => ({ chats: { ...s.chats, [recipeId]: [...(s.chats[recipeId] ?? []), message] } }));
  },

  remove: (recipeId, messageId, epoch) => {
    if (epoch !== get().epoch) return;
    set(s => ({
      chats: { ...s.chats, [recipeId]: (s.chats[recipeId] ?? []).filter(m => m.id !== messageId) },
    }));
  },

  setBusy: (recipeId, busy) => set(s => ({ busy: { ...s.busy, [recipeId]: busy } })),

  setDraft: (recipeId, text) => set(s => ({ drafts: { ...s.drafts, [recipeId]: text } })),

  clearAll: () => set(s => ({ chats: {}, busy: {}, drafts: {}, epoch: s.epoch + 1 })),
}));
