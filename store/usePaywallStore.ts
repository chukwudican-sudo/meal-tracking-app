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

interface PaywallStore {
  visible: boolean;
  reason: PaywallReason;
  headline?: string;
  onSuccess?: () => void;
  open: (opts: OpenPaywallOptions) => void;
  close: () => void;
}

// Backs app/paywall.tsx. Kept separate from the route/params system because
// onSuccess is a live closure — it can't survive serialization through
// expo-router params, so the screen reads it straight out of this store
// instead of its own route params.
export const usePaywallStore = create<PaywallStore>((set) => ({
  visible: false,
  reason: 'premium_feature',
  headline: undefined,
  onSuccess: undefined,

  open: ({ reason, headline, onSuccess }) => {
    set({ visible: true, reason, headline, onSuccess });
  },

  close: () => {
    set({ visible: false, onSuccess: undefined });
  },
}));
