import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import type { WeightUnit } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

export default function AccountSettingsScreen() {
  const profile = useMealStore(s => s.profile);
  const updateProfile = useMealStore(s => s.updateProfile);
  const showToast = useToastStore(s => s.showToast);

  const [email, setEmail]         = useState(profile.email ?? '');
  const [firstName, setFirstName] = useState(profile.firstName ?? profile.name ?? '');
  const [lastName, setLastName]   = useState(profile.lastName ?? '');

  const unit = profile.weightUnit ?? 'lbs';

  const setUnit = (next: WeightUnit) => {
    if (unit === next) return;
    updateProfile({ weightUnit: next });
  };

  const handleSave = () => {
    updateProfile({
      email: email.trim() || undefined,
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      name: firstName.trim() || profile.name,
    });
    showToast('Account saved');
    router.back();
  };

  const navComingSoon = (title: string) =>
    router.push({ pathname: '/settings/coming-soon', params: { title } });

  return (
    <FormPage
      title="Account Settings"
      saveLabel="Save"
      onSave={handleSave}
    >
      <FormSection label="IDENTITY">
        <Field label="Email">
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="alex@example.com"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />
        </Field>
        <Field label="First name">
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Alex"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="words"
            style={styles.input}
          />
        </Field>
        <Field label="Last name">
          <TextInput
            value={lastName}
            onChangeText={setLastName}
            placeholder="Smith"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="words"
            style={styles.input}
          />
        </Field>
        <TouchableOpacity
          style={styles.row}
          onPress={() => showToast('Password change coming soon')}
          activeOpacity={0.7}
        >
          <Text style={styles.rowText}>Password</Text>
          <Text style={styles.rowArrow}>›</Text>
        </TouchableOpacity>
      </FormSection>

      <FormSection label="PREFERENCES">
        <View style={styles.row}>
          <Text style={styles.rowText}>Unit System</Text>
          <View style={styles.unitToggle}>
            <TouchableOpacity
              style={[styles.unitBtn, unit === 'lbs' && styles.unitBtnActive]}
              onPress={() => setUnit('lbs')}
              activeOpacity={0.8}
            >
              <Text style={[styles.unitBtnText, unit === 'lbs' && styles.unitBtnTextActive]}>lbs</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.unitBtn, unit === 'kg' && styles.unitBtnActive]}
              onPress={() => setUnit('kg')}
              activeOpacity={0.8}
            >
              <Text style={[styles.unitBtnText, unit === 'kg' && styles.unitBtnTextActive]}>kg</Text>
            </TouchableOpacity>
          </View>
        </View>
        <NavRow label="Language" onPress={() => navComingSoon('Language')} />
        <NavRow label="Data Consent" onPress={() => navComingSoon('Data Consent')} />
        <NavRow label="Export My Data" onPress={() => navComingSoon('Export My Data')} />
      </FormSection>

      <TouchableOpacity
        style={styles.deleteRow}
        onPress={() => router.push('/settings/account-delete-confirm')}
        activeOpacity={0.7}
      >
        <Text style={styles.deleteText}>Delete Account</Text>
      </TouchableOpacity>
    </FormPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.rowText}>{label}</Text>
      <Text style={styles.rowArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  field: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: COLORS.elevated,
    color: COLORS.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  rowText: { color: COLORS.text, fontSize: 15 },
  rowArrow: { color: COLORS.textSecondary, fontSize: 22, fontWeight: '300' },

  unitToggle: { flexDirection: 'row', backgroundColor: COLORS.elevated, borderRadius: 8, overflow: 'hidden' },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 6 },
  unitBtnActive: { backgroundColor: COLORS.green },
  unitBtnText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  unitBtnTextActive: { color: '#fff' },

  deleteRow: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  deleteText: { color: COLORS.red, fontSize: 14, fontWeight: '600' },
});
