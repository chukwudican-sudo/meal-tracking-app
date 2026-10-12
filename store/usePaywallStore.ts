import { create } from 'zustand';

export type PaywallReason = 'scan_limit' | 'premium_feature';

export interface OpenPaywallOptions {
  reason: PaywallReason;
  // Feature-specific headline for reason === 'premium_feature' (e.g. "Unlock
  // the full recipe with Pro"). Ignored for 'scan_limit', which always uses
  // its own fixed headline. Falls back to a generic "Pro" headline if omitted.
  headline?: string;
  // Called once, right after a purchase/restore leaves the user entitled —
  // before the screen closes. Lets the original blocked action (viewing the
  // recipe, opening the chat, generating the plan, activating the plan)
  // continue automatically instead of requiring a second tap.
  onSuccess?: () => void;
}

// 'route' = the /paywall screen; 'inline' = PaywallModalHost inside an open RN
// Modal (AddMealScreen, KitchenScanModal), where a pushed route would render
// behind the modal and the user would see nothing.
export type PaywallPresentation = 'route' | 'inline';

interface PaywallStore {
  visible: boolean;
  presentation: PaywallPresentation;
  // How many PaywallModalHosts are currently mounted inside a visible modal.
  inlineHosts: number;
  reason: PaywallReason;
  headline?: string;
  onSuccess?: () => void;
  open: (opts: OpenPaywallOptions & { presentation: PaywallPresentation }) => void;
  close: () => void;
  addInlineHost: () => void;
  removeInlineHost: () => void;
}

// Backs app/paywall.tsx. Kept separate from the route/params system because
// onSuccess is a live closure — it can't survive serialization through
// expo-router params, so the screen reads it straight out of this store
// instead of its own route params.
export const usePaywallStore = create<PaywallStore>((set) => ({
  visible: false,
  presentation: 'route',
  inlineHosts: 0,
  reason: 'premium_feature',
  headline: undefined,
  onSuccess: undefined,

  open: ({ reason, headline, onSuccess, presentation }) => {
    set({ visible: true, reason, headline, onSuccess, presentation });
  },

  close: () => {
    set({ visible: false, onSuccess: undefined });
  },

  addInlineHost: () => set(s => ({ inlineHosts: s.inlineHosts + 1 })),
  removeInlineHost: () => set(s => ({ inlineHosts: Math.max(0, s.inlineHosts - 1) })),
}));
