import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { FormPage } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { signInWithEmail, signOut, useAuth } from '@/lib/auth';
import { deleteAccountRequest } from '@/lib/deleteAccount';
import { clearPendingPassword } from '@/lib/pendingCredentials';
import { showManageSubscriptions } from '@/lib/purchases';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { useMealStore } from '@/store/useMealStore';

export default function AccountDeleteConfirmScreen() {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canSubmit = password.trim().length > 0 && !deleting;

  const handleManageSubscription = async () => {
    const ok = await showManageSubscriptions();
    if (!ok) {
      Alert.alert(
        'Unable to open subscription settings',
        'Please manage your subscription from your device\'s App Store settings.'
      );
    }
  };

  const performDelete = async () => {
    const email = user?.email;
    if (!email) {
      Alert.alert('Something went wrong', 'Could not find your account email. Please sign in again.');
      return;
    }

    setDeleting(true);

    // Re-verify the password before doing anything destructive — there's no
    // separate "verify password" endpoint in this app, so signing in again
    // with the same credentials is the existing idiom (see lib/auth.tsx).
    const authResult = await signInWithEmail(email, password);
    if (authResult.error) {
      Alert.alert('Incorrect password', 'Please re-enter your current password and try again.');
      setDeleting(false);
      return;
    }

    const { error } = await deleteAccountRequest();
    if (error) {
      Alert.alert('Could not delete your account', error);
      setDeleting(false);
      return;
    }

    // Account is gone server-side — clean up everything local the same way
    // logout does (app/settings.tsx's finishLogout), minus the outbox flush
    // (there's no destination left to flush to).
    await signOut();
    void clearPendingPassword();
    useEntitlementStore.getState()._reset();
    useMealStore.getState().resetUserData();
    router.replace('/onboarding');
  };

  const handleDeletePress = () => {
    if (!canSubmit) return;
    Alert.alert(
      'Delete your account permanently?',
      "This can't be undone. Your profile, meals, plans, and saved recipes will be permanently deleted.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void performDelete(); } },
      ]
    );
  };

  return (
    <FormPage title="Delete Account">
      <View style={styles.body}>
        <Text style={styles.heading}>This will permanently delete your account</Text>
        <Text style={styles.sub}>
          Everything tied to {user?.email ?? 'your account'} — your profile, meal logs, weight
          history, plans, and saved recipes — will be permanently deleted. This cannot be undone.
        </Text>

        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>Active subscription?</Text>
          <Text style={styles.warningText}>
            Deleting your account does not cancel an active subscription. You&apos;ll need to
            cancel it separately in your device&apos;s subscription settings, or you may keep being
            charged.
          </Text>
          <TouchableOpacity
            style={styles.manageBtn}
            onPress={() => { void handleManageSubscription(); }}
            activeOpacity={0.8}
          >
            <Text style={styles.manageBtnText}>Manage Subscription</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Confirm your password to continue</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Current password"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
            editable={!deleting}
          />
        </View>

        <TouchableOpacity
          style={[styles.deleteBtn, !canSubmit && styles.deleteBtnDisabled]}
          onPress={handleDeletePress}
          disabled={!canSubmit}
          activeOpacity={0.85}
        >
          {deleting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.deleteBtnText}>Delete My Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          disabled={deleting}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  body: { paddingVertical: 12, gap: 20 },
  heading: { color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  sub: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },

  warningBox: {
    backgroundColor: COLORS.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.red,
    padding: 16,
    gap: 10,
  },
  warningTitle: { color: COLORS.red, fontSize: 14, fontWeight: '700' },
  warningText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  manageBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 2,
  },
  manageBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  field: { gap: 8 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  input: {
    backgroundColor: COLORS.elevated,
    color: COLORS.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },

  deleteBtn: {
    backgroundColor: COLORS.red,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  deleteBtnDisabled: { opacity: 0.4 },
  deleteBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  cancelBtn: { paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
});
