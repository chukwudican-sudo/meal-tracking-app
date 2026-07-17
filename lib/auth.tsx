// Auth surface for the app: a lightweight context that tracks the Supabase
// session plus thin wrappers around the auth calls the UI needs. Only
// Email/Password is wired today; Apple/Google are scaffolded elsewhere and
// will call into this module once a native dev build exists.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as Linking from 'expo-linking';
import type { Session, User } from '@supabase/supabase-js';

import { supabase } from './supabase';
import { useMealStore } from '@/store/useMealStore';

// Deep links Supabase sends the user back to. These must be added to the
// project's Auth "Redirect URLs" allow-list in the Supabase dashboard.
// Use the app's fixed custom scheme rather than Linking.createURL() so the
// redirect is deterministic (createURL yields an exp:// URL under Expo Go and
// must never override the intended production/standalone deep link).
export const EMAIL_CONFIRM_REDIRECT = 'mealapp://auth/callback';
export const PASSWORD_RESET_REDIRECT = Linking.createURL('auth/reset');

export interface AuthResult {
  error: string | null;
  // True when a sign-up succeeded but the user must verify their email before a
  // session is issued (email confirmation is enabled on the project).
  needsVerification?: boolean;
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    // Explicit deep link so the confirmation email points at the app rather
    // than the dashboard's default Site URL.
    options: { emailRedirectTo: 'mealapp://auth/callback' },
  });
  if (error) return { error: error.message };
  // With "Confirm email" on, there's a user but no session until verification.
  const needsVerification = !data.session && !!data.user;
  if (needsVerification) {
    // Remember locally that an unverified account exists so the Home banner can
    // prompt the user to verify — there's no session yet to infer this from.
    useMealStore.getState().updateProfile({
      email: email.trim(),
      pendingEmailVerification: true,
    });
  }
  return { error: null, needsVerification };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  return { error: error ? error.message : null };
}

export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut();
  return { error: error ? error.message : null };
}

export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: PASSWORD_RESET_REDIRECT,
  });
  return { error: error ? error.message : null };
}

export async function updatePassword(newPassword: string): Promise<AuthResult> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: error ? error.message : null };
}

// Re-send the signup confirmation email (used by the Home verify banner).
export async function resendVerificationEmail(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: EMAIL_CONFIRM_REDIRECT },
  });
  return { error: error ? error.message : null };
}

// Deep links from email confirmation / password reset arrive as
// `mealapp://auth/...?code=<pkce_code>`. Exchange that code for a session.
export async function exchangeCodeFromUrl(url: string): Promise<AuthResult> {
  const { queryParams } = Linking.parse(url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  if (!code) return { error: 'This link is missing its auth code or has expired.' };
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return { error: error ? error.message : null };
}

// ─── Session context ─────────────────────────────────────────────────────────

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  // True until the initial getSession() resolves, so gates can avoid flashing.
  initializing: boolean;
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
  showVerifyBanner: false,
  dismissVerifyBanner: () => {},
});

function isConfirmed(session: Session | null): boolean {
  return !!session?.user?.email_confirmed_at || !!session?.user?.confirmed_at;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  // Session-scoped dismissal — resets on every cold start (this provider
  // remounts), so a dismissed banner reappears next launch while unverified.
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const pendingEmailVerification = useMealStore(
    s => s.profile.pendingEmailVerification ?? false,
  );

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setInitializing(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Once we observe a confirmed session, the account is verified — clear the
  // pending flag permanently so the banner never returns.
  useEffect(() => {
    if (isConfirmed(session) && pendingEmailVerification) {
      useMealStore.getState().updateProfile({ pendingEmailVerification: false });
    }
  }, [session, pendingEmailVerification]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      showVerifyBanner: pendingEmailVerification && !isConfirmed(session) && !bannerDismissed,
      dismissVerifyBanner: () => setBannerDismissed(true),
    }),
    [session, initializing, pendingEmailVerification, bannerDismissed],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
