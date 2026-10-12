// Shows the paywall on top of an RN Modal. Mount one inside each modal that
// can hit an AI quota (AddMealScreen, KitchenScanModal) with active = the
// modal's visibility: while active, openPaywall renders here instead of
// pushing /paywall, which would land behind the modal (a real past bug — the
// scan-limit paywall was invisible until the user closed Add Meal).

import { useEffect } from 'react';
import { Modal } from 'react-native';

import { usePaywallStore } from '@/store/usePaywallStore';
import { PaywallContent } from './PaywallContent';

// The store's close() already hides this modal; nothing else to unwind.
const noop = () => {};

export function PaywallModalHost({ active }: { active: boolean }) {
  const show = usePaywallStore(s => s.visible && s.presentation === 'inline');
  const close = usePaywallStore(s => s.close);

  useEffect(() => {
    if (!active) return;
    const { addInlineHost, removeInlineHost } = usePaywallStore.getState();
    addInlineHost();
    return removeInlineHost;
  }, [active]);

  return (
    <Modal
      visible={active && show}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <PaywallContent onExit={noop} />
    </Modal>
  );
}
