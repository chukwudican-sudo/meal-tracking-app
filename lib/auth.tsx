// Auth surface for the app: a lightweight context that tracks the Supabase
// session plus thin wrappers around the auth calls the UI needs. Only
// Email/Password is wired today; Apple/Google are scaffolded elsewhere and
// will call into this module once a native dev build exists.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthError, Session, User } from '@supabase/supabase-js';

import { allowPushRegistration, unregisterPushToken } from '@/lib/notifications/push';
import { clearMealPhotoCaches } from '@/lib/media/mealPhotos';
import { useRecipeChatStore } from '@/store/useRecipeChatStore';
import { SESSION_STORAGE_KEY, supabase } from './supabase';
import { LAST_USER_KEY } from './sync/engine';
import { useMealStore } from '@/store/useMealStore';
import { syncPurchasesIdentity } from './purchases';
import {
  clearPendingPassword,
  getPendingCredentials,
  savePendingPassword,
} from './pendingCredentials';
import { APP_NAME } from '@/constants/app';
import { reportError } from '@/lib/monitoring';
import { withTimeout } from '@/lib/timeoutSignal';

// Signup and password-reset emails carry a 6-digit code, never a link (the
// dev and prod templates were checked Nov 21, 2026), so no redirect deep link
// is sent: the old /auth/callback and /auth/reset pages were deleted then.

export interface AuthResult {
  error: string | null;
  // True when a sign-up succeeded but the user must verify their email before a
  // session is issued (email confirmation is enabled on the project).
  needsVerification?: boolean;
  // The signed-in user's id, when a session was actually created. Lets a caller
  // drive the sync engine's reconcile deterministically instead of waiting on
  // the AuthProvider/SyncProvider listener chain to notice the new session.
  userId?: string;
  // Set when a call was throttled by Supabase's email send rate limit, so the
  // UI can show a friendly "please wait" message and start a cooldown instead
  // of surfacing a raw error (or nothing at all).
  rateLimited?: boolean;
  // Seconds the caller should wait before retrying, when known.
  retryAfterSeconds?: number;
  // Sign-in only: the email/password pair was refused (not a network or
  // server problem), so a screen re-checking a password can say "incorrect".
  invalidCredentials?: boolean;
  // True when a sign-up targeted an email that already has an account. With
  // email confirmation on, Supabase hides this to prevent enumeration, so we
  // detect it ourselves — the caller should send the user to log in rather than
  // treat it as a new, unverified account.
  alreadyRegistered?: boolean;
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });
  if (error) return { error: error.message };

  // Enumeration protection: signing up with an already-registered email while
  // "Confirm email" is on returns a user with an empty `identities` array and no
  // session (rather than an error). Treat that as "already registered" and send
  // the user to log in — do NOT arm the verify banner, or a returning, already
  // confirmed account would be pushed back through onboarding + a spurious
  // "verify your email" prompt.
  const alreadyRegistered = !data.session && (data.user?.identities?.length ?? 0) === 0;
  if (alreadyRegistered) {
    return {
      error: 'An account with this email already exists. Please log in.',
      alreadyRegistered: true,
    };
  }

  // Capture the email locally unconditionally — not just in the
  // needsVerification branch below. The very first sync push for this account
  // (lib/sync/mappers.ts#profileToUsersRow) reads profile.email, and with
  // "Confirm email" off there's a session immediately and no other point in
  // this flow where the account's email gets mirrored into the store —
  // leaving it unset here means that first push silently sends email: null.
  useMealStore.getState().updateProfile({ email: email.trim() });

  // With "Confirm email" on, there's a user but no session until verification.
  const needsVerification = !data.session && !!data.user;
  if (needsVerification) {
    // Remember locally that an unverified account exists so the Home banner can
    // prompt the user to verify — there's no session yet to infer this from.
    useMealStore.getState().updateProfile({ pendingEmailVerification: true });
    // Keep the password briefly + securely so we can silently re-authenticate
    // (and clear the banner) once the user taps the emailed confirmation link.
    void savePendingPassword(email.trim(), password);
  }
  return { error: null, needsVerification };
}

const SIGN_IN_TIMEOUT_MS = 15_000;
const SIGN_IN_OFFLINE = "Couldn't reach the server. Check your connection and try again.";

// Sign-in failures in plain words. Wrong email and wrong password get the same
// message on purpose (Supabase doesn't tell them apart either, so nobody can
// use the login screen to find out which emails have accounts).
function signInFailure(error: AuthError): AuthResult {
  const code = (error as { code?: string }).code;
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) {
    return { error: 'Incorrect email or password.', invalidCredentials: true };
  }
  if (code === 'email_not_confirmed') {
    return { error: `This email isn't verified yet. Check your inbox for the email from ${APP_NAME}.` };
  }
  if (error.status === 429 || code === 'over_request_rate_limit') {
    return { error: 'Too many attempts. Please wait a minute and try again.' };
  }
  // Status 0 = no HTTP answer (offline / dropped connection). Supabase uses the
  // same error type for 5xx server failures; those are reported, not blamed on
  // the user's connection.
  if (error.name === 'AuthRetryableFetchError' && !error.status) return { error: SIGN_IN_OFFLINE };
  reportError(error, 'auth.signIn');
  return { error: 'Could not sign in right now. Please try again in a moment.' };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  try {
    const { data, error } = await withTimeout(
      supabase.auth.signInWithPassword({ email: email.trim(), password }),
      SIGN_IN_TIMEOUT_MS,
      'timeout',
    );
    if (error) return signInFailure(error);
    return { error: null, userId: data.user?.id };
  } catch {
    // Timed out (no answer in 15 s) or the request itself threw: never leave
    // the button spinning. A very late success still signs in; the user can
    // simply tap Log in again.
    return { error: SIGN_IN_OFFLINE };
  }
}

// Verify the 6-digit signup code from the confirmation email. On success this
// creates a confirmed session (same as the old tap-the-link flow did via
// exchangeCodeForSession) — the AuthProvider effect below then clears
// pendingEmailVerification + the stored signup password, and SyncProvider
// reconciles. The email template must render {{ .Token }} for this to work.
export async function verifySignupOtp(email: string, token: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'signup',
  });
  if (error) return { error: error.message };
  return { error: null, userId: data.user?.id };
}

export async function signOut(): Promise<AuthResult> {
  // While the session is still valid: stop pushes to this phone (best effort).
  await unregisterPushToken();
  const { error } = await supabase.auth.signOut();
  // Still signed in after all: let this phone register for pushes again.
  if (error) allowPushRegistration();
  // Don't leave this account's meal photos or Recipe Assistant chats on the phone.
  else {
    clearMealPhotoCaches();
    useRecipeChatStore.getState().clearAll();
  }
  return { error: error ? error.message : null };
}

// Sends the password-reset email. The *Reset password* email template must
// render {{ .Token }} (6-digit code, verified by verifyRecoveryOtp) — a tapped
// link breaks when opened on another device (PKCE verifier lives on this phone)
// or gets burned by email-scanner prefetch, the same failures that moved signup
// to a code.
export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
  return toEmailSendResult(error, 'Could not send the reset email. Please try again.');
}

// Verify the 6-digit code from the reset email. On success this creates a
// short-lived recovery session that updatePassword() runs under. SyncProvider
// treats it like any login (same reconcile as the login screen), so callers must
// end it with the safe sign-out ordering once the password is saved.
export async function verifyRecoveryOtp(email: string, token: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'recovery',
  });
  if (error) return { error: error.message };
  return { error: null, userId: data.user?.id };
}

// Settings → Account → Password: confirm the current password first (so
// someone holding an unlocked phone can't change it), then set the new one.
// Every failure comes back as a plain message; capped at 15s per step.
export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResult> {
  try {
    // The stored session (no network): "verify later" users have none yet.
    const { data } = await supabase.auth.getSession();
    const email = data.session?.user.email;
    if (!email) {
      // No session: a "verify later" account, or offline with an hour-old
      // login (saved on the phone, Supabase can't refresh it yet).
      return {
        error: useMealStore.getState().profile.pendingEmailVerification
          ? 'Verify your email first, then you can change your password.'
          : "Couldn't reach the server. Check your connection and try again.",
      };
    }

    const check = await withTimeout(
      supabase.auth.signInWithPassword({ email, password: currentPassword }),
      15_000,
      'timeout',
    );
    if (check.error) {
      const code = (check.error as { code?: string }).code;
      if (code === 'email_not_confirmed') {
        return { error: 'Verify your email first, then you can change your password.' };
      }
      if (code === 'invalid_credentials' || check.error.status === 400) {
        return { error: 'Your current password is incorrect.' };
      }
      return { error: 'Could not check your current password. Please try again.' };
    }

    const { error } = await withTimeout(
      supabase.auth.updateUser({ password: newPassword }),
      15_000,
      'timeout',
    );
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === 'same_password') return { error: 'Your new password must be different from the current one.' };
      if (code === 'weak_password') return { error: 'That password is too weak. Try a longer one.' };
      return { error: error.message || 'Could not change your password. Please try again.' };
    }
    return { error: null };
  } catch {
    return { error: 'The connection timed out. Check your internet and try again.' };
  }
}

export async function updatePassword(newPassword: string): Promise<AuthResult> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: error ? error.message : null };
}

// Re-send the signup confirmation email (used by the Home verify banner).
// Supabase throttles resends (a per-email cooldown, ~60s by default, plus a
// global hourly cap). When that trips, translate the raw error into a friendly
// "please wait" message and report how long to wait so the UI can surface it.
export async function resendVerificationEmail(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
  });
  return toEmailSendResult(error, 'Could not resend the email. Please try again.');
}

// Shared by every call that sends an auth email, so signup resends and reset
// emails report Supabase's send throttle identically.
function toEmailSendResult(error: AuthError | null, fallback: string): AuthResult {
  if (!error) return { error: null };

  const status = (error as { status?: number }).status;
  const code = (error as { code?: string }).code;
  const message = error.message ?? '';
  const isRateLimited =
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    /rate limit|for security purposes|after \d+\s*seconds?/i.test(message);

  if (isRateLimited) {
    const seconds = parseRetryAfterSeconds(message);
    return {
      error: seconds
        ? `Please wait ${seconds}s before requesting another email.`
        : 'Please wait before requesting another email.',
      rateLimited: true,
      retryAfterSeconds: seconds ?? 60,
    };
  }
  return { error: message || fallback };
}

// Supabase's throttle message looks like "... you can only request this after
// 47 seconds." Pull that number out when present.
function parseRetryAfterSeconds(message: string): number | null {
  const match = message.match(/after (\d+)\s*seconds?/i);
  return match ? Number(match[1]) : null;
}

// ─── Session context ─────────────────────────────────────────────────────────

interface AuthContextValue {
  // Confirmed by Supabase. Network calls and uploads need this.
  session: Session | null;
  user: User | null;
  // True until the initial getSession() resolves, so gates can avoid flashing.
  initializing: boolean;
  // The login saved on this phone, read from storage at launch (no network),
  // for the account sync last ran for here. Kept while Supabase can't confirm
  // it for lack of network; cleared when Supabase signs out (login invalid).
  savedUserId: string | null;
  // The account signed in on this phone: the confirmed session's, else the
  // saved login's. What screens use to decide "signed in".
  userId: string | null;
  // The signed-in decision can be made: at once with a saved login, otherwise
  // once Supabase's first check is done.
  authReady: boolean;
  // Whether the Home "verify your email" banner should be shown right now
  // (unverified account exists AND not dismissed this session).
  showVerifyBanner: boolean;
  // Dismiss the banner for this app session only (reappears on next launch).
  dismissVerifyBanner: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  initializing: true,
  savedUserId: null,
  userId: null,
  authReady: false,
  showVerifyBanner: false,
  dismissVerifyBanner: () => {},
});

// The account whose login is saved on this phone, straight from storage: no
// refresh, no network. Supabase's own first check refreshes an expired token
// (~0.5 s online; offline it retries ~25 s, then reports no session even though
// the login is still saved). Trusted only for the account sync last ran for
// here (LAST_USER_KEY), the one case sync can record for at once.
async function readSavedLogin(): Promise<string | null> {
  try {
    const [raw, lastUserId] = await Promise.all([
      AsyncStorage.getItem(SESSION_STORAGE_KEY),
      AsyncStorage.getItem(LAST_USER_KEY),
    ]);
    if (!raw || !lastUserId) return null;
    const saved = JSON.parse(raw) as { refresh_token?: unknown; user?: { id?: unknown } } | null;
    const id = saved?.user?.id;
    return typeof id === 'string' && typeof saved?.refresh_token === 'string' && id === lastUserId
      ? id
      : null;
  } catch {
    return null;
  }
}

function isConfirmed(session: Session | null): boolean {
  return !!session?.user?.email_confirmed_at || !!session?.user?.confirmed_at;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [savedUserId, setSavedUserId] = useState<string | null>(null);
  const [savedChecked, setSavedChecked] = useState(false);
  // Supabase signed out (login invalid, or a logout): a saved-login read that
  // finishes later must not bring it back.
  const signedOutRef = useRef(false);
  // Session-scoped dismissal — resets on every cold start (this provider
  // remounts), so a dismissed banner reappears next launch while unverified.
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const pendingEmailVerification = useMealStore(
    s => s.profile.pendingEmailVerification ?? false,
  );

  useEffect(() => {
    let mounted = true;

    void readSavedLogin().then(id => {
      if (!mounted) return;
      if (id && !signedOutRef.current) setSavedUserId(id);
      setSavedChecked(true);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Only a real sign-out ends the saved login. A refresh that failed for
      // lack of network reports no session but leaves the login saved, and
      // Supabase's background refresh picks it up once back online.
      if (event === 'SIGNED_OUT') {
        signedOutRef.current = true;
        setSavedUserId(null);
      }
      setSession(nextSession);
      setInitializing(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Keep RevenueCat's identity in lockstep with the Supabase session: log in
  // with the Supabase user id on sign-in so the revenuecat-webhook function
  // can resolve the right `users` row, and log out (back to an anonymous
  // RevenueCat id) on sign-out. Guarded against re-firing on token refreshes
  // (onAuthStateChange fires repeatedly for the same user) and against
  // running before the signed-in decision (authReady). Follows the saved login
  // too: offline with an hour-old login Supabase reports no session, and
  // logging RevenueCat out then would hide Pro.
  const userId = session?.user?.id ?? savedUserId;
  const authReady = savedChecked && (savedUserId !== null || !initializing);
  const lastSyncedUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!authReady) return;
    if (lastSyncedUserIdRef.current === userId) return;
    lastSyncedUserIdRef.current = userId;
    void syncPurchasesIdentity(userId);
  }, [userId, authReady]);

  // Once we observe a confirmed session, the account is verified — clear the
  // pending flag permanently so the banner never returns, and drop the stored
  // signup password (it exists only to bridge the pre-verification window).
  useEffect(() => {
    if (isConfirmed(session) && pendingEmailVerification) {
      useMealStore.getState().updateProfile({ pendingEmailVerification: false });
      void clearPendingPassword();
    }
  }, [session, pendingEmailVerification]);

  // Silent re-auth on foreground: while the verify banner is showing, the user
  // may have just tapped the emailed confirmation link in their browser. Expo Go
  // can't reliably deep-link back into an exact auth state, so when the app
  // returns to the foreground we quietly retry sign-in with the stored signup
  // credentials. If the email is now confirmed a session is issued (which flips
  // isConfirmed -> clears the banner + password above); if not, sign-in fails
  // with "Email not confirmed" and we simply leave the banner as-is.
  const lastSilentAttemptRef = useRef(0);
  useEffect(() => {
    const trySilentReauth = async () => {
      if (!pendingEmailVerification || isConfirmed(session)) return;
      const now = Date.now();
      if (now - lastSilentAttemptRef.current < 15_000) return; // throttle
      lastSilentAttemptRef.current = now;
      const creds = await getPendingCredentials();
      if (!creds) return;
      // On success, onAuthStateChange updates `session`; failures (email still
      // unconfirmed) are expected and intentionally swallowed.
      await supabase.auth.signInWithPassword({ email: creds.email, password: creds.password });
    };

    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void trySilentReauth();
    });
    // Also attempt once now (covers the app already being foregrounded).
    void trySilentReauth();
    return () => sub.remove();
  }, [session, pendingEmailVerification]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      savedUserId,
      userId,
      authReady,
      showVerifyBanner: pendingEmailVerification && !isConfirmed(session) && !bannerDismissed,
      dismissVerifyBanner: () => setBannerDismissed(true),
    }),
    [session, initializing, savedUserId, userId, authReady, pendingEmailVerification, bannerDismissed],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
