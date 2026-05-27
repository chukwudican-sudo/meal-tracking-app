import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FormPage } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';

export default function AccountDeleteConfirmScreen() {
  const resetUserData = useMealStore(s => s.resetUserData);

  const handleDelete = () => {
    resetUserData();
    // Pop until we land back on the tabs root.
    router.replace('/(tabs)');
  };

  return (
    <FormPage title="Delete Account">
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>⚠️</Text>
      </View>
      <Text style={styles.heading}>This will permanently delete your account.</Text>
      <Text style={styles.body}>
        Your personal data, plans, saved meals, recipes, weight history, and
        all preferences will be erased. This action cannot be undone. You can
        create a new account anytime.
      </Text>

      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.85}>
          <Text style={styles.deleteText}>Delete Account</Text>
        </TouchableOpacity>
      </View>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', marginTop: 8, marginBottom: 16 },
  icon: { fontSize: 56 },
  heading: { color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  body: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 16 },

  btnRow: { flexDirection: 'row', gap: 12, marginTop: 32 },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card,
  },
  cancelText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  deleteBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: COLORS.red },
  deleteText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
