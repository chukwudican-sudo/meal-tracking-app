// Gate for every AI request (Apple guideline 5.1.2(i), Nov 2025): personal
// data may only go to a third-party AI (Google Gemini) after the user has
// been told what's sent and said yes. invokeAIFunction awaits this before any
// call, so every AI feature is covered in one place. The AI functions check
// the same answer on the server (users.ai_consent, Nov 19).

import { Keyboard } from 'react-native';

import { supabase } from '@/lib/supabase';
import { timeoutSignal } from '@/lib/timeoutSignal';
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
  if (allowed) await setAIConsent(true);
  return allowed;
}

const SAVE_TIMEOUT_MS = 6_000;

// Every change of the answer (sheet, Settings → Privacy & AI): saved here and
// on the account at once. The AI functions refuse unless users.ai_consent is
// true, and the routine sync could land after the first AI request; consent is
// recorded when it's given. Sync still carries the same value (and sends it
// later if this write didn't go through — offline, no session).
export async function setAIConsent(allowed: boolean): Promise<boolean> {
  useMealStore.getState().setAiConsent(allowed);
  return saveAIConsentToServer();
}

// Writes this phone's answer to the account. True when the row was updated.
// Only over an older answer (or none): a phone that hasn't heard yet that AI
// was turned off on another phone must not switch it back on (its retry in
// invokeAIFunction would otherwise do exactly that).
export async function saveAIConsentToServer(): Promise<boolean> {
  const { aiConsent, aiConsentAt } = useMealStore.getState().profile;
  if (typeof aiConsent !== 'boolean' || !aiConsentAt) return false;
  const t = timeoutSignal(SAVE_TIMEOUT_MS);
  try {
    const { data: auth } = await supabase.auth.getSession();
    const uid = auth.session?.user?.id;
    if (!uid) return false;
    const { data, error } = await supabase
      .from('users')
      .update({ ai_consent: aiConsent, ai_consent_at: aiConsentAt })
      .eq('id', uid)
      .or(`ai_consent_at.is.null,ai_consent_at.lte."${aiConsentAt}"`)
      .select('id')
      .abortSignal(t.signal);
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  } finally {
    t.done();
  }
}

// "Not now": every AI caller returns quietly on this (no error toast).
export function isAIConsentDeclined(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === AI_CONSENT_DECLINED;
}
