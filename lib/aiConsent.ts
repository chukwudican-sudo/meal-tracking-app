// Gate for every AI request (Apple guideline 5.1.2(i), Nov 2025): personal
// data may only go to a third-party AI (Google Gemini) after the user has
// been told what's sent and said yes. invokeAIFunction awaits this before any
// call, so every AI feature is covered in one place.

import { Keyboard } from 'react-native';

import { useAIConsentStore } from '@/store/useAIConsentStore';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

export const AI_CONSENT_DECLINED = 'consent_declined';

export async function ensureAIConsent(): Promise<boolean> {
  if (useMealStore.getState().profile.aiConsent === true) return true;
  const store = useAIConsentStore.getState();
  if (store.hosts.length === 0) {
    // Never silent (rule 9): only possible before the app has finished loading.
    console.warn('[aiConsent] no sheet host mounted');
    useToastStore.getState().showToast("Couldn't open the AI permission. Please try again.");
    return false;
  }
  // Most AI requests start from a text box: the keyboard would cover the
  // sheet's buttons.
  Keyboard.dismiss();
  // Unanswered for 3 minutes → "Not now" (timer lives in the store).
  const allowed = await store.ask();
  if (allowed) useMealStore.getState().setAiConsent(true);
  return allowed;
}

// "Not now": every AI caller returns quietly on this (no error toast).
export function isAIConsentDeclined(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === AI_CONSENT_DECLINED;
}
