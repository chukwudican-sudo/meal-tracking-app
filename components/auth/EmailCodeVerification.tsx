import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS } from '@/constants/theme';
import { resendVerificationEmail, verifySignupOtp } from '@/lib/auth';

const CODE_LENGTH = 6;
// Local fallback cooldown after a successful resend, matching Supabase's typical
// per-email throttle so we don't invite an immediate server rejection.
const RESEND_COOLDOWN_SECONDS = 60;

interface Props {
  email: string;
  // Called after the code is accepted and a confirmed session exists.
  onVerified: () => void;
  // When provided, renders a secondary "skip for now" action (e.g. to preserve
  // the deferred/offline-first flow during onboarding).
  onSkip?: () => void;
  skipLabel?: string;
}

// Reusable 6-digit email verification. Used both inline during onboarding
// (right after signup) and from the standalone /auth/verify-code route the
// Home banner opens. Verifying calls supabase.auth.verifyOtp(type:'signup').
export function EmailCodeVerification({ email, onVerified, onSkip, skipLabel = "I'll verify later" }: Props) {
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendNote, setResendNote] = useState<string | null>(null);

  const canSubmit = code.length === CODE_LENGTH && !verifying;

  // Tick the resend cooldown down once per second while it's active.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleChange = (next: string) => {
    // Keep digits only so autofill / paste of a formatted code still works.
    setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH));
    if (error) setError(null);
  };

  const handleVerify = async () => {
    if (!canSubmit) return;
    setVerifying(true);
    setError(null);
    const { error: err } = await verifySignupOtp(email, code);
    setVerifying(false);
    if (err) {
      // Stay on the screen and let them retry — never bounce back to signup.
      setError('That code didn\'t work. Check it and try again, or resend a new one.');
      return;
    }
    onVerified();
  };

  const handleResend = async () => {
    if (resending) return;
    if (cooldown > 0) {
      setResendNote(`Please wait ${cooldown}s before requesting another code.`);
      return;
    }
    if (!email) {
      setResendNote('No email on file to resend to.');
      return;
    }
    setResending(true);
    setResendNote(null);
    const { error: err, rateLimited, retryAfterSeconds } = await resendVerificationEmail(email);
    setResending(false);
    if (err) {
      setResendNote(err);
      if (rateLimited) setCooldown(retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
      return;
    }
    setResendNote('A new code is on its way.');
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const resendLabel = resending
    ? 'Sending…'
    : cooldown > 0
      ? `Resend code (${cooldown}s)`
      : 'Resend code';

  return (
    <View style={styles.container}>
      <Ionicons name="mail-unread-outline" size={52} color={COLORS.green} />
      <Text style={styles.title}>Enter your code</Text>
      <Text style={styles.subtitle}>
        We sent a {CODE_LENGTH}-digit verification code to {email || 'your email'}. Enter it below to
        verify your account.
      </Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={handleChange}
        placeholder="000000"
        placeholderTextColor={COLORS.textMuted}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        autoFocus
        editable={!verifying}
        returnKeyType="done"
        onSubmitEditing={handleVerify}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
        onPress={handleVerify}
        disabled={!canSubmit}
        activeOpacity={0.85}
      >
        {verifying ? (
          <ActivityIndicator color="#04110A" />
        ) : (
          <Text style={styles.primaryBtnText}>Verify</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={handleResend} disabled={resending} hitSlop={8} style={styles.resendRow}>
        <Text style={[styles.resend, cooldown > 0 && styles.resendWaiting]}>{resendLabel}</Text>
      </TouchableOpacity>
      {resendNote ? <Text style={styles.resendNote}>{resendNote}</Text> : null}

      {onSkip ? (
        <TouchableOpacity onPress={onSkip} hitSlop={8} style={styles.skipRow}>
          <Text style={styles.skipText}>{skipLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingHorizontal: 8, gap: 14 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  subtitle: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 },

  input: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 16,
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 10,
    marginTop: 4,
  },
  errorText: { color: COLORS.red, fontSize: 13, textAlign: 'center' },

  primaryBtn: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.green,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#04110A', fontSize: 16, fontWeight: '700' },

  resendRow: { paddingVertical: 4 },
  resend: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  resendWaiting: { color: COLORS.textSecondary },
  resendNote: { color: COLORS.textSecondary, fontSize: 12, textAlign: 'center', marginTop: -6 },

  skipRow: { paddingVertical: 8, marginTop: 4 },
  skipText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
});
