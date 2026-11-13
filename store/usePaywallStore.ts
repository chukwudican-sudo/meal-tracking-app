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

export interface PendingSuccess {
  run?: () => void;              // the blocked action (may be none, e.g. plain "Upgrade")
  serverSynced: Promise<unknown>; // sync-subscription, started the moment Pro arrived
}

interface PaywallStore {
  visible: boolean;
  presentation: PaywallPresentation;
  // How many PaywallModalHosts are currently mounted inside a visible modal.
  inlineHosts: number;
  reason: PaywallReason;
  headline?: string;
  onSuccess?: () => void;
  // Set by succeed(): the resume action and the server sync it waits for,
  // held until the paywall has fully closed (see succeed / takePendingSuccess).
  pendingSuccess?: PendingSuccess;
  open: (opts: OpenPaywallOptions & { presentation: PaywallPresentation }) => void;
  close: () => void;
  succeed: (serverSynced: Promise<unknown>) => void;
  takePendingSuccess: () => PendingSuccess | undefined;
  addInlineHost: () => void;
  removeInlineHost: () => void;
}

// Backs app/paywall.tsx. Kept separate from the route/params system because
// onSuccess is a live closure — it can't survive serialization through
// expo-router params, so the screen reads it straight out of this store
// instead of its own route params.
export const usePaywallStore = create<PaywallStore>((set, get) => ({
  visible: false,
  presentation: 'route',
  inlineHosts: 0,
  reason: 'premium_feature',
  headline: undefined,
  onSuccess: undefined,
  pendingSuccess: undefined,

  open: ({ reason, headline, onSuccess, presentation }) => {
    set({ visible: true, reason, headline, onSuccess, presentation, pendingSuccess: undefined });
  },

  close: () => {
    set({ visible: false, onSuccess: undefined, pendingSuccess: undefined });
  },

  // A purchase/restore made the user Pro: hide the paywall but hold the resume
  // action until (1) it is fully gone — starting the next action while an iOS
  // RN Modal is still animating shut could leave an invisible layer
  // swallowing every tap, the Nov 12 "app froze after buying Pro" bug — and
  // (2) the server has confirmed Pro (otherwise the retried AI call is
  // refused). The sync runs during the close animation, so it normally adds
  // no wait. Run via lib/paywall.ts#runPendingSuccess: from the in-modal
  // host's onDismiss, or by the /paywall route after navigating back.
  succeed: (serverSynced) => {
    set(s => ({
      visible: false,
      onSuccess: undefined,
      pendingSuccess: { run: s.onSuccess, serverSynced },
    }));
  },

  takePendingSuccess: () => {
    const pending = get().pendingSuccess;
    if (pending) set({ pendingSuccess: undefined });
    return pending;
  },

  addInlineHost: () => set(s => ({ inlineHosts: s.inlineHosts + 1 })),
  removeInlineHost: () => set(s => ({ inlineHosts: Math.max(0, s.inlineHosts - 1) })),
}));
