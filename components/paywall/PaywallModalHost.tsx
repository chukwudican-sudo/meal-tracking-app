// Shows the paywall on top of an RN Modal. Mount one inside each modal that
// can hit an AI quota (AddMealScreen, KitchenScanModal) with active = the
// modal's visibility: while active, openPaywall renders here instead of
// pushing /paywall, which would land behind the modal (a real past bug — the
// scan-limit paywall was invisible until the user closed Add Meal).

import { useEffect, useRef } from 'react';
import { Modal, Platform } from 'react-native';

import { runPendingSuccess } from '@/lib/paywall';
import { usePaywallStore } from '@/store/usePaywallStore';
import { PaywallContent } from './PaywallContent';

// The store's close()/succeed() already hide this modal; nothing else to unwind.
const noop = () => {};

// After a purchase, resume the blocked action only once this modal has fully
// closed: iOS reports it via onDismiss (~0.4 s slide). The timer is a safety
// net in case onDismiss never fires — and the only path on Android, where
// onDismiss doesn't exist and the modal is gone at once. The action is handed
// out once (takePendingSuccess), so it can't run twice.
const RESUME_FALLBACK_MS = Platform.OS === 'ios' ? 2000 : 300;

export function PaywallModalHost({ active }: { active: boolean }) {
  const show = usePaywallStore(s => s.visible && s.presentation === 'inline');
  const close = usePaywallStore(s => s.close);
  const visible = active && show;
  const wasVisible = useRef(false);

  useEffect(() => {
    if (!active) return;
    const { addInlineHost, removeInlineHost } = usePaywallStore.getState();
    addInlineHost();
    return removeInlineHost;
  }, [active]);

  useEffect(() => {
    if (visible) { wasVisible.current = true; return; }
    if (!wasVisible.current) return;
    wasVisible.current = false;
    const t = setTimeout(runPendingSuccess, RESUME_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
      onDismiss={runPendingSuccess}
    >
      <PaywallContent onExit={noop} />
    </Modal>
  );
}
