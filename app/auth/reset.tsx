import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { exchangeCodeFromUrl, updatePassword } from '@/lib/auth';

const LINK_TIMEOUT_MS = 15_000;

// Landing screen for the password-reset deep link. The email link opens the app
// at mealapp://auth/reset?code=..., which we exchange for a temporary session,
// then let the user choose a new password.
export default function ResetPasswordScreen() {
  const initialUrl = Linking.useURL();
  const [status, setStatus] = useState<'exchanging' | 'ready' | 'error' | 'done'>('exchanging');
  const [linkError, setLinkError] = useState<string | null>(null);

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const valid = pw.length >= 6 && pw === pw2;

  // Legacy path: new reset emails carry a 6-digit code (/auth/forgot-password).
  // This screen only serves old link-style emails. useURL() can miss the link
  // during the foreground transition (same race auth/callback hit), so fall back
  // to getInitialURL(), and never spin forever if neither yields a usable URL.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);
  useEffect(() => {
    void Linking.getInitialURL().then(initial => {
      if (initial) setUrl(prev => prev ?? initial);
    });
    const timer = setTimeout(() => {
      // linkError is only shown in the 'error' state, so setting it is harmless
      // if the exchange already finished.
      setLinkError(prev => prev ?? 'This reset link couldn\'t be opened. Request a new code instead.');
      setStatus(s => (s === 'exchanging' ? 'error' : s));
    }, LINK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    (async () => {
      const { error } = await exchangeCodeFromUrl(url);
      if (cancelled) return;
      if (error) {
        setLinkError(error);
        setStatus('error');
      } else {
        setStatus('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    const { error } = await updatePassword(pw);
    setSaving(false);
    if (error) {
      setSaveError(error);
      return;
    }
    setStatus('done');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.body}>
        {status === 'exchanging' && (
          <View style={styles.centered}>
            <ActivityIndicator color={COLORS.green} size="large" />
            <Text style={styles.bodyText}>Verifying your reset link…</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={56} color={COLORS.red} />
            <Text style={[styles.title, { textAlign: 'center', marginTop: 16 }]}>Link expired</Text>
            <Text style={styles.bodyText}>{linkError ?? 'Please request a new password reset link.'}</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/auth/forgot-password')}>
              <Text style={styles.primaryBtnText}>Request a new code</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'ready' && (
          <>
            <Text style={styles.title}>Set a new password</Text>
            <Text style={styles.subtitle}>Choose a new password for your account.</Text>
            <View style={{ marginTop: 24, gap: 10 }}>
              <TextInput
                style={styles.input}
                placeholder="New password (min 6 characters)"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                value={pw}
                onChangeText={setPw}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                value={pw2}
                onChangeText={setPw2}
              />
              {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
            </View>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={[styles.primaryBtn, (!valid || saving) && styles.primaryBtnDisabled]}
              disabled={!valid || saving}
              onPress={handleSave}
            >
              <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save password'}</Text>
            </TouchableOpacity>
          </>
        )}

        {status === 'done' && (
          <View style={styles.centered}>
            <Ionicons name="checkmark-circle-outline" size={56} color={COLORS.green} />
            <Text style={[styles.title, { textAlign: 'center', marginTop: 16 }]}>Password updated</Text>
            <Text style={styles.bodyText}>You're all set. You can continue using the app.</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(tabs)')}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, flex: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '700', lineHeight: 32 },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 20 },
  bodyText: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 6, lineHeight: 22 },
  input: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 16, paddingVertical: 14, color: COLORS.text, fontSize: 16,
  },
  errorText: { color: COLORS.red, fontSize: 13, marginTop: 2 },
  primaryBtn: { backgroundColor: COLORS.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center', alignSelf: 'stretch' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#04110A', fontSize: 16, fontWeight: '700' },
});
