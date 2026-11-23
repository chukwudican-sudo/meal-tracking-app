// Sends Feedback (Settings → Help) and Report Food (meal details) to the
// user_feedback table. Returns a plain error message, never throws; 15s cap.

import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';
import { timeoutSignal } from '@/lib/timeoutSignal';
import { useMealStore } from '@/store/useMealStore';

export type FeedbackKind = 'feedback' | 'food_report';
export const FEEDBACK_MAX_LEN = 2000;

export async function submitFeedback(
  kind: FeedbackKind,
  message: string,
  context?: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const text = message.trim().slice(0, FEEDBACK_MAX_LEN);
  if (!text) return { error: 'Please type a message first.' };
  // Only signed-in users can send. No session: a "verify later" account, or
  // offline with an hour-old login (saved on the phone, not refreshed yet).
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    return {
      error: useMealStore.getState().profile.pendingEmailVerification
        ? 'Verify your email first, then you can send this.'
        : "Couldn't reach the server. Check your connection and try again.",
    };
  }
  const t = timeoutSignal(15_000);
  try {
    const { error } = await supabase
      .from('user_feedback')
      .insert({
        kind,
        message: text,
        context: context ?? null,
        app_version: Constants.expoConfig?.version ?? null,
      })
      .abortSignal(t.signal);
    if (error) {
      console.warn('[feedback] insert failed:', error.message);
      return { error: "Couldn't send that. Check your connection and try again." };
    }
    return { error: null };
  } catch (e) {
    console.warn('[feedback] insert failed:', e);
    return { error: "Couldn't send that. Check your connection and try again." };
  } finally {
    t.done();
  }
}
