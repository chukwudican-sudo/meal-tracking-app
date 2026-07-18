import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import { resendVerificationEmail, useAuth } from '@/lib/auth';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

// Default local cooldown after a successful resend, matching Supabase's typical
// per-email throttle so we don't invite an immediate server rejection.
const RESEND_COOLDOWN_SECONDS = 60;

// Pinned (non-auto-dismissing) banner shown on Home while the user's account
// exists but their email isn't verified. It never blocks the app — the account
// works locally in this state; verifying just enables cloud sync.
export function EmailVerificationBanner() {
  const { showVerifyBanner, dismissVerifyBanner } = useAuth();
  const email = useMealStore(s => s.profile.email);
  const showToast = useToastStore(s => s.showToast);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Tick the cooldown down once per second while it's active.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  if (!showVerifyBanner) return null;

  const handleResend = async () => {
    if (sending) return;
    // Repeated taps during the cooldown give explicit feedback rather than
    // silently hammering (and being rejected by) Supabase's rate limit.
    if (cooldown > 0) {
      showToast(`Please wait ${cooldown}s before requesting another email`);
      return;
    }
    if (!email) {
      showToast('No email on file to resend to');
      return;
    }
    setSending(true);
    const { error, rateLimited, retryAfterSeconds } = await resendVerificationEmail(email);
    setSending(false);
    if (error) {
      showToast(error);
      // Server-side throttle: start (or extend) the local cooldown to match.
      if (rateLimited) setCooldown(retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
      return;
    }
    showToast('Verification email sent');
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  const resendLabel = sending
    ? 'Sending…'
    : cooldown > 0
      ? `Resend email (${cooldown}s)`
      : 'Resend email';

  return (
    <View style={styles.banner}>
      <Ionicons name="mail-unread-outline" size={16} color={COLORS.green} style={styles.leadIcon} />
      <View style={styles.textCol}>
        <Text style={styles.text} numberOfLines={2}>
          Verify your email to save your progress to the cloud
        </Text>
        <TouchableOpacity onPress={handleResend} disabled={sending} hitSlop={8}>
          <Text style={[styles.resend, cooldown > 0 && styles.resendWaiting]}>{resendLabel}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={dismissVerifyBanner}
        style={styles.dismissBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel="Dismiss"
      >
        <Ionicons name="close" size={16} color={COLORS.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.elevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  leadIcon: { marginTop: 1 },
  textCol: { flex: 1, gap: 2 },
  text: { color: COLORS.text, fontSize: 13, fontWeight: '500', lineHeight: 18 },
  resend: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  resendWaiting: { color: COLORS.textSecondary },
  dismissBtn: { padding: 2 },
});
