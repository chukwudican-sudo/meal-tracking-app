// Remote push for the bell inbox: register this phone's Expo push token with
// the signed-in account (send-announcement sends to every registered token),
// and remove it again on sign-out so a logged-out phone stops getting pushes.

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { timeoutSignal, withTimeout } from '@/lib/timeoutSignal';
import { getNotifications } from './reminders';

export const ANNOUNCEMENT_TYPE = 'announcement';

// Re-confirm the server row now and then: it can disappear (send-announcement
// drops tokens Expo reports as gone) or move to another account.
const REREGISTER_MS = 10 * 60_000;

let registered: { token: string; userId: string; at: number } | null = null;
// Set while signing out, so a foreground refresh can't re-register the
// account that is leaving. Cleared by allowPushRegistration().
let blocked = false;
// Bumped on every sign-out so a register already in flight can't record a
// token the sign-out just removed.
let generation = 0;
let inFlight: Promise<void> | null = null;

export function allowPushRegistration(): void {
  blocked = false;
}

// This install's Expo push token, or null without permission / support.
// The token call goes to Expo's servers, so it's time-limited.
async function currentToken(): Promise<string | null> {
  const N = getNotifications();
  if (!N) return null;
  if (!(await N.getPermissionsAsync()).granted) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    console.warn('[push] no EAS projectId in app config');
    return null;
  }
  const res = await withTimeout(N.getExpoPushTokenAsync({ projectId }), 10_000, 'push token timed out');
  return res.data;
}

// Needs notification permission (asked by onboarding / Settings / the one-time
// ask). Safe to call often: skips when this user's token was saved recently.
export function registerPushToken(userId: string): Promise<void> {
  if (blocked) return Promise.resolve();
  if (registered?.userId === userId && Date.now() - registered.at < REREGISTER_MS) return Promise.resolve();
  // Launch, foreground and a permission change can all ask at once: share one.
  inFlight ??= doRegister(userId).finally(() => { inFlight = null; });
  return inFlight;
}

async function doRegister(userId: string): Promise<void> {
  const gen = generation;
  const token = await currentToken();
  if (!token || blocked || gen !== generation) return;
  const t = timeoutSignal(10_000);
  try {
    const { error } = await supabase
      .rpc('register_push_token', {
        p_token: token,
        p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      })
      .abortSignal(t.signal);
    if (error) throw new Error(error.message);
  } finally {
    t.done();
  }
  if (blocked || gen !== generation) return;
  registered = { token, userId, at: Date.now() };
}

// Best effort, while the session is still valid: called from signOut() before
// the session ends. Capped at 3s in total so logout never hangs; a miss only
// means this phone may still get the broadcast announcements until the token
// is reassigned or Expo reports it gone.
export async function unregisterPushToken(): Promise<void> {
  blocked = true;
  generation++;
  const known = registered?.token;
  registered = null;
  try {
    await withTimeout((async () => {
      // After an app restart this session never registered; the token itself
      // is stable per install, so ask for it again.
      const token = known ?? (await currentToken());
      if (!token) return;
      const { error } = await supabase.rpc('unregister_push_token', { p_token: token });
      if (error) console.warn('[push] unregister failed:', error.message);
    })(), 3_000, 'unregister timed out');
  } catch (e) {
    console.warn('[push] unregister failed:', e);
  }
}
