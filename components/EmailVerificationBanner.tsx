import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import { resendVerificationEmail, useAuth } from '@/lib/auth';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

// Pinned (non-auto-dismissing) banner shown on Home while the user's account
// exists but their email isn't verified. It never blocks the app — the account
// works locally in this state; verifying just enables cloud sync.
export function EmailVerificationBanner() {
  const { showVerifyBanner, dismissVerifyBanner } = useAuth();
  const email = useMealStore(s => s.profile.email);
  const showToast = useToastStore(s => s.showToast);
  const [sending, setSending] = useState(false);

  if (!showVerifyBanner) return null;

  const handleResend = async () => {
    if (sending) return;
    if (!email) {
      showToast('No email on file to resend to');
      return;
    }
    setSending(true);
    const { error } = await resendVerificationEmail(email);
    setSending(false);
    showToast(error ? error : 'Verification email sent');
  };

  return (
    <View style={styles.banner}>
      <Ionicons name="mail-unread-outline" size={16} color={COLORS.green} style={styles.leadIcon} />
      <View style={styles.textCol}>
        <Text style={styles.text} numberOfLines={2}>
          Verify your email to save your progress to the cloud
        </Text>
        <TouchableOpacity onPress={handleResend} disabled={sending} hitSlop={8}>
          <Text style={styles.resend}>{sending ? 'Sending…' : 'Resend email'}</Text>
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
  dismissBtn: { padding: 2 },
});
