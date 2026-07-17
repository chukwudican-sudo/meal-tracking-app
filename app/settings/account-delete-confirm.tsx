import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FormPage } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';

// Account deletion is deferred to a later backend phase: it needs a server-side
// function to remove the Supabase auth user and cascade-delete all of the
// account's rows. The previous implementation only wiped the local cache while
// leaving the session/account intact — a broken half-deleted state — so this
// screen is intentionally a "coming soon" placeholder and performs no deletion.
// The entry point in Account Settings is disabled; this guards direct/deep-link
// access too.
export default function AccountDeleteConfirmScreen() {
  return (
    <FormPage title="Delete Account">
      <View style={styles.body}>
        <Text style={styles.icon}>🚧</Text>
        <Text style={styles.heading}>Account deletion is coming soon</Text>
        <Text style={styles.sub}>
          We&apos;re still building secure account deletion. Once it&apos;s ready
          you&apos;ll be able to permanently remove your account and all of its
          data from here. For now, no changes have been made.
        </Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <Text style={styles.doneText}>Go back</Text>
        </TouchableOpacity>
      </View>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingVertical: 60, gap: 12, paddingHorizontal: 8 },
  icon: { fontSize: 56 },
  heading: { color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  sub: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 16 },
  doneBtn: {
    marginTop: 24, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card,
  },
  doneText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
});
