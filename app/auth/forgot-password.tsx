import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { EmailCodeVerification } from '@/components/auth/EmailCodeVerification';
import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { sendPasswordReset, signOut, updatePassword } from '@/lib/auth';
import { engine } from '@/lib/sync/engine';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

type Step = 'email' | 'code' | 'password';

// Password reset by 6-digit code: email → code → new password. Codes replaced
// the emailed link because a link only works on the phone that requested it
// (PKCE) and email scanners can burn it before the user taps it.
//
// Verifying the code signs the user in with a recovery session, which the sync
// engine treats like any login. Once the new password is saved (or the user
// backs out) we end that session with the same safe ordering as Settings → Log
// out, then send them to log in normally with the new password.
export default function ForgotPasswordScreen() {
  const resetUserData = useMealStore(s => s.resetUserData);
  const showToast = useToastStore(s => s.showToast);

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [recoveryUserId, setRecoveryUserId] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Password already changed server-side; only ending the session is left.
  const [passwordSaved, setPasswordSaved] = useState(false);

  const emailValid = email.includes('@');
  const pwValid = pw.length >= 6 && pw === pw2;

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/onboarding'));

  const handleSend = async () => {
    if (!emailValid || sending) return;
    setSending(true);
    setSendError(null);
    const { error } = await sendPasswordReset(email);
    setSending(false);
    if (error) {
      setSendError(error);
      return;
    }
    setStep('code');
  };

  // Mirrors settings.tsx finishLogout: let any in-flight login reconcile finish,
  // stop change capture + flush BEFORE wiping the local cache (so the wipe can't
  // replicate to the server as deletes), then end the session and clear.
  const endRecoverySession = async (): Promise<string | null> => {
    if (recoveryUserId) await engine.onSignIn(recoveryUserId).catch(() => {});
    await engine.prepareSignOut();
    const { error } = await signOut();
    if (error) {
      engine.resumeAfterCancelledSignOut();
      return error;
    }
    resetUserData();
    return null;
  };

  const handleSave = async () => {
    if (saving || (!passwordSaved && !pwValid)) return;
    setSaving(true);
    setSaveError(null);
    if (!passwordSaved) {
      const { error } = await updatePassword(pw);
      if (error) {
        setSaving(false);
        setSaveError(error);
        return;
      }
      setPasswordSaved(true);
    }
    const signOutError = await endRecoverySession();
    setSaving(false);
    if (signOutError) {
      setSaveError(`Your password was changed, but we couldn't finish signing you out (${signOutError}). Tap to try again.`);
      return;
    }
    showToast('Password updated. Log in with your new password.');
    leave();
  };

  const handleBack = async () => {
    if (saving) return;
    if (step === 'code') {
      setStep('email');
      return;
    }
    if (step === 'password') {
      // A recovery session is live — never leave it dangling behind the login screen.
      setSaving(true);
      const err = await endRecoverySession();
      setSaving(false);
      if (err) {
        setSaveError(`Couldn't cancel the reset (${err}). Please try again.`);
        return;
      }
    }
    leave();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {step === 'email' && (
          <View style={styles.body}>
            <Text style={styles.title}>Reset password</Text>
            <Text style={styles.subtitle}>
              Enter the email for your account and we&apos;ll send you a 6-digit code.
            </Text>
            <View style={{ marginTop: 24, gap: 10 }}>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
              {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
            </View>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={[styles.primaryBtn, (!emailValid || sending) && styles.primaryBtnDisabled]}
              disabled={!emailValid || sending}
              onPress={handleSend}
            >
              <Text style={styles.primaryBtnText}>{sending ? 'Sending…' : 'Send code'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'code' && (
          <View style={[styles.body, styles.codeBody]}>
            <EmailCodeVerification
              email={email.trim()}
              purpose="recovery"
              onVerified={userId => {
                setRecoveryUserId(userId ?? null);
                setStep('password');
              }}
            />
          </View>
        )}

        {step === 'password' && (
          <View style={styles.body}>
            <Text style={styles.title}>Set a new password</Text>
            <Text style={styles.subtitle}>Choose a new password for {email.trim()}.</Text>
            <View style={{ marginTop: 24, gap: 10 }}>
              <TextInput
                style={styles.input}
                placeholder="New password (min 6 characters)"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                textContentType="newPassword"
                autoComplete="new-password"
                editable={!passwordSaved}
                value={pw}
                onChangeText={setPw}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                textContentType="newPassword"
                autoComplete="new-password"
                editable={!passwordSaved}
                value={pw2}
                onChangeText={setPw2}
              />
              {pw2.length > 0 && pw !== pw2 ? (
                <Text style={styles.errorText}>Passwords don&apos;t match.</Text>
              ) : null}
              {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
            </View>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={[styles.primaryBtn, ((!passwordSaved && !pwValid) || saving) && styles.primaryBtnDisabled]}
              disabled={(!passwordSaved && !pwValid) || saving}
              onPress={handleSave}
            >
              {saving ? (
                <ActivityIndicator color="#04110A" />
              ) : (
                <Text style={styles.primaryBtnText}>{passwordSaved ? 'Try again' : 'Save password'}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 1, flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  codeBody: { justifyContent: 'center' },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '700', lineHeight: 32 },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 20 },
  input: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 16, paddingVertical: 14, color: COLORS.text, fontSize: 16,
  },
  errorText: { color: COLORS.red, fontSize: 13, marginTop: 2 },
  primaryBtn: { backgroundColor: COLORS.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#04110A', fontSize: 16, fontWeight: '700' },
});
