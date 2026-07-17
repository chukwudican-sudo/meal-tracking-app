import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { sendPasswordReset } from '@/lib/auth';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const valid = email.includes('@');

  const handleReset = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    const { error: err } = await sendPasswordReset(email);
    setLoading(false);
    if (err) {
      setError(err);
      return;
    }
    setSent(true);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/onboarding'))}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {sent ? (
        <View style={[styles.body, styles.centered]}>
          <Ionicons name="mail-unread-outline" size={56} color={COLORS.green} />
          <Text style={[styles.title, { textAlign: 'center', marginTop: 20 }]}>Check your email</Text>
          <Text style={styles.bodyText}>
            If an account exists for {email}, we sent a link to reset your password.
          </Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Back to login</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={styles.title}>Reset password</Text>
          <Text style={styles.subtitle}>
            Enter the email for your account and we'll send you a reset link.
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
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={[styles.primaryBtn, (!valid || loading) && styles.primaryBtnDisabled]}
            disabled={!valid || loading}
            onPress={handleReset}
          >
            <Text style={styles.primaryBtnText}>{loading ? 'Sending…' : 'Reset password'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 1, flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  centered: { alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '700', lineHeight: 32 },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 20 },
  bodyText: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 22 },
  input: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 16, paddingVertical: 14, color: COLORS.text, fontSize: 16,
  },
  errorText: { color: COLORS.red, fontSize: 13, marginTop: 2 },
  primaryBtn: { backgroundColor: COLORS.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#04110A', fontSize: 16, fontWeight: '700' },
});
