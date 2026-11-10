// Settings → Account → Password. Current password first (an unlocked phone
// alone can't change it), then the new one twice. Same rule as sign-up
// (6+ characters). Stays signed in afterwards.

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { changePassword } from '@/lib/auth';
import { useToastStore } from '@/store/useToastStore';

const MIN_LENGTH = 6;

export default function PasswordScreen() {
  const showToast = useToastStore(s => s.showToast);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // After FormPage has re-rendered with saved=true (its leave guard is off).
  useEffect(() => {
    if (done) router.back();
  }, [done]);

  const dirty = current.length > 0 || next.length > 0 || confirm.length > 0;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = current.length > 0 && next.length >= MIN_LENGTH && next === confirm;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await changePassword(current, next);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    showToast('Password changed');
    setDone(true);
  };

  return (
    <FormPage
      title="Password"
      saveLabel="Save"
      // Async: keep the page (and its unsaved guard) until the change succeeds.
      onSave={() => { void submit(); return false; }}
      saveDisabled={!valid || busy}
      dirty={dirty}
      saved={done}
    >
      <FormSection label="CURRENT PASSWORD">
        <Field>
          <TextInput
            value={current}
            onChangeText={v => { setCurrent(v); setError(null); }}
            placeholder="Current password"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            autoCapitalize="none"
            style={styles.input}
            editable={!busy}
          />
        </Field>
      </FormSection>

      <FormSection label="NEW PASSWORD">
        <Field>
          <TextInput
            value={next}
            onChangeText={v => { setNext(v); setError(null); }}
            placeholder={`New password (min ${MIN_LENGTH} characters)`}
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            autoCapitalize="none"
            style={styles.input}
            editable={!busy}
          />
        </Field>
        <Field>
          <TextInput
            value={confirm}
            onChangeText={v => { setConfirm(v); setError(null); }}
            placeholder="Confirm new password"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            autoCapitalize="none"
            style={styles.input}
            editable={!busy}
            onSubmitEditing={() => { void submit(); }}
          />
        </Field>
      </FormSection>

      <View style={styles.messages}>
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={COLORS.textSecondary} />
            <Text style={styles.hint}>Changing your password…</Text>
          </View>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : tooShort ? (
          <Text style={styles.hint}>Use at least {MIN_LENGTH} characters.</Text>
        ) : mismatch ? (
          <Text style={styles.hint}>The new passwords don&apos;t match.</Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={() => router.push('/auth/forgot-password')}
        style={styles.forgot}
        hitSlop={8}
        accessibilityRole="link"
      >
        <Text style={styles.forgotText}>Forgot your current password?</Text>
      </TouchableOpacity>
    </FormPage>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <View style={styles.field}>{children}</View>;
}

const styles = StyleSheet.create({
  field: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  input: {
    backgroundColor: COLORS.elevated,
    color: COLORS.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  messages: { paddingHorizontal: 4, minHeight: 24 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hint: { color: COLORS.textSecondary, fontSize: 13 },
  error: { color: COLORS.red, fontSize: 13 },
  forgot: { alignSelf: 'center', marginTop: 20 },
  forgotText: { color: COLORS.green, fontSize: 14, fontWeight: '600' },
});
