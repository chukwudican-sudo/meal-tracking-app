import { create } from 'zustand';

// Tracks which tab the user came from when they navigated into the Library
// tab via a "Go to Kitchen" link. The Library tab uses this to optionally
// render a back arrow that returns to the source tab. Cart navigation does
// NOT use this — Cart is a modal stack screen, so router.back() handles it.

export type SourceTab = '/(tabs)' | '/(tabs)/plan' | '/(tabs)/library' | '/(tabs)/profile' | '/cart';

interface NavSourceStore {
  kitchenSource: SourceTab | null;
  setKitchenSource: (source: SourceTab | null) => void;
}

export const useNavSourceStore = create<NavSourceStore>(set => ({
  kitchenSource: null,
  setKitchenSource: (source) => set({ kitchenSource: source }),
}));
