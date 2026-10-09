import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

// Pinned (non-auto-dismissing) banner shown on Home while the user's account
// exists but their email isn't verified. It never blocks the app — the account
// works locally in this state; verifying just enables cloud sync. Tapping it
// opens the 6-digit code entry screen (resend lives there now).
export function EmailVerificationBanner() {
  const { showVerifyBanner, dismissVerifyBanner } = useAuth();

  if (!showVerifyBanner) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="mail-unread-outline" size={16} color={COLORS.green} style={styles.leadIcon} />
      <View style={styles.textCol}>
        <Text style={styles.text} numberOfLines={2}>
          Verify your email to save your progress to the cloud
        </Text>
        <TouchableOpacity onPress={() => router.push('/auth/verify-code')} hitSlop={8}>
          <Text style={styles.action}>Enter verification code</Text>
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
  action: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  dismissBtn: { padding: 2 },
});
