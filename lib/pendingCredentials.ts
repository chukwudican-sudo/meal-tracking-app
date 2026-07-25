// Short-lived secure storage for the just-signed-up credentials, used only to
// silently re-authenticate once the user taps the emailed confirmation link
// (Expo Go can't reliably deep-link back into an exact auth state). Backed by
// the device Keychain/Keystore via expo-secure-store, and cleared the moment
// verification succeeds (or on logout) so the password never lingers.

import * as SecureStore from 'expo-secure-store';

const EMAIL_KEY = 'pendingVerify.email';
const PASSWORD_KEY = 'pendingVerify.password';

export interface PendingCredentials {
  email: string;
  password: string;
}

export async function savePendingPassword(email: string, password: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(EMAIL_KEY, email);
    await SecureStore.setItemAsync(PASSWORD_KEY, password);
  } catch {
    // Best-effort: if the secure store is unavailable the only cost is that the
    // banner won't auto-clear; the user can still resend / verify manually.
  }
}

export async function getPendingCredentials(): Promise<PendingCredentials | null> {
  try {
    const email = await SecureStore.getItemAsync(EMAIL_KEY);
    const password = await SecureStore.getItemAsync(PASSWORD_KEY);
    if (!email || !password) return null;
    return { email, password };
  } catch {
    return null;
  }
}

export async function clearPendingPassword(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(EMAIL_KEY);
    await SecureStore.deleteItemAsync(PASSWORD_KEY);
  } catch {
    // ignore
  }
}
