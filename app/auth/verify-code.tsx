import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import { EmailCodeVerification } from '@/components/auth/EmailCodeVerification';
import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { getPendingCredentials } from '@/lib/pendingCredentials';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

// Standalone entry point for email verification, opened from the Home verify
// banner. Reuses the same code-entry component shown inline during onboarding.
// Dismissing without verifying is fine — pendingEmailVerification keeps the
// offline-first access it already granted.
export default function VerifyCodeScreen() {
  const storedEmail = useMealStore(s => s.profile.email) ?? '';
  // Codes go to the address the account was created with (kept with the
  // pending signup credentials), not the profile copy, which older builds let
  // users edit in Settings.
  const [signupEmail, setSignupEmail] = useState<string | null>(null);
  // Hold the code UI until the lookup settles so Resend/Verify can't fire on
  // the stale address first.
  const [emailReady, setEmailReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void getPendingCredentials().then(c => {
      if (!alive) return;
      if (c?.email) setSignupEmail(c.email);
      setEmailReady(true);
    });
    return () => { alive = false; };
  }, []);
  const email = signupEmail ?? storedEmail;
  const showToast = useToastStore(s => s.showToast);

  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const handleVerified = () => {
    showToast('Email verified');
    dismiss();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={dismiss}
            style={styles.iconBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.body}>
          {emailReady ? <EmailCodeVerification email={email} onVerified={handleVerified} /> : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
});
