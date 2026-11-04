// Full-screen RN Modals (Add Meal, Kitchen scan) sit above the whole router,
// so a page pushed while one is open lands behind it. Anything that navigates
// from outside them (a tapped notification) calls closeOverlays() first; each
// open modal registers its close via useCloseOnOverlayReset.
// (MealDetailModal already hides itself when its screen loses focus.)

import { useEffect, useRef } from 'react';

const closers = new Set<() => void>();

export function closeOverlays(): void {
  closers.forEach(close => {
    try {
      close();
    } catch (e) {
      console.warn('[overlays] close failed:', e);
    }
  });
}

export function useCloseOnOverlayReset(visible: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!visible) return;
    const fn = () => latest.current();
    closers.add(fn);
    return () => { closers.delete(fn); };
  }, [visible]);
}
