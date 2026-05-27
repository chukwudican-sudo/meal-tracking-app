import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FormPage, FormSection, RadioRow } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import {
  ACTIVITY_HINT,
  ACTIVITY_LABEL,
  cmToIn,
  inToCm,
  kgToLbs,
  lbsToKg,
} from '@/constants/goalCalc';
import type { ActivityLevel, Gender } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const GENDERS: { id: Gender; label: string }[] = [
  { id: 'male',   label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other',  label: 'Other / prefer not to say' },
];

const ACTIVITIES: ActivityLevel[] = [
  'sedentary',
  'lightly_active',
  'moderately_active',
  'very_active',
  'extra_active',
];

export default function PersonalDetailsScreen() {
  const profile = useMealStore(s => s.profile);
  const updateProfile = useMealStore(s => s.updateProfile);
  const logWeight = useMealStore(s => s.logWeight);

  const isImperial = (profile.weightUnit ?? 'lbs') === 'lbs';

  const [firstName, setFirstName] = useState(profile.firstName ?? profile.name ?? '');
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  const [heightStr, setHeightStr] = useState(
    profile.heightCm != null
      ? isImperial
        ? Math.round(cmToIn(profile.heightCm)).toString()
        : Math.round(profile.heightCm).toString()
      : ''
  );
  const [weightStr, setWeightStr] = useState(
    profile.weightKg != null
      ? isImperial
        ? Math.round(kgToLbs(profile.weightKg)).toString()
        : Math.round(profile.weightKg).toString()
      : ''
  );
  const [gender, setGender] = useState<Gender | undefined>(profile.gender);
  const [activity, setActivity] = useState<ActivityLevel | undefined>(profile.activityLevel);

  const canSave = useMemo(() => {
    return firstName.trim().length > 0;
  }, [firstName]);

  const handleSave = () => {
    const ageNum = Number(age);
    const heightNum = Number(heightStr);
    const weightNum = Number(weightStr);

    const heightCm = Number.isFinite(heightNum) && heightNum > 0
      ? isImperial ? inToCm(heightNum) : heightNum
      : profile.heightCm;
    const weightKg = Number.isFinite(weightNum) && weightNum > 0
      ? isImperial ? lbsToKg(weightNum) : weightNum
      : profile.weightKg;

    updateProfile({
      firstName: firstName.trim(),
      name: firstName.trim(),
      age: Number.isFinite(ageNum) && ageNum > 0 ? Math.round(ageNum) : profile.age,
      heightCm,
      gender,
      activityLevel: activity,
    });

    if (weightKg != null && weightKg !== profile.weightKg) {
      logWeight(weightKg);
    }

    router.back();
  };

  return (
    <FormPage
      title="Personal Details"
      saveLabel="Save"
      onSave={handleSave}
      saveDisabled={!canSave}
    >
      <FormSection>
        <Field label="First name">
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Alex"
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
            autoCapitalize="words"
          />
        </Field>
        <Field label="Age">
          <TextInput
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            placeholder="28"
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
          />
        </Field>
        <Field label={`Height (${isImperial ? 'in' : 'cm'})`}>
          <TextInput
            value={heightStr}
            onChangeText={setHeightStr}
            keyboardType="number-pad"
            placeholder={isImperial ? '70' : '178'}
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
          />
        </Field>
        <Field label={`Weight (${isImperial ? 'lbs' : 'kg'})`}>
          <TextInput
            value={weightStr}
            onChangeText={setWeightStr}
            keyboardType="decimal-pad"
            placeholder={isImperial ? '170' : '77'}
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
          />
          <Text style={styles.helper}>Saving updates today&apos;s weight log too.</Text>
        </Field>
      </FormSection>

      <FormSection label="GENDER">
        {GENDERS.map((g, idx) => (
          <View key={g.id} style={idx === 0 ? styles.firstRow : null}>
            <RadioRow label={g.label} selected={gender === g.id} onPress={() => setGender(g.id)} />
          </View>
        ))}
      </FormSection>

      <FormSection label="ACTIVITY LEVEL">
        {ACTIVITIES.map((a, idx) => (
          <View key={a} style={idx === 0 ? styles.firstRow : null}>
            <RadioRow
              label={ACTIVITY_LABEL[a]}
              hint={ACTIVITY_HINT[a]}
              selected={activity === a}
              onPress={() => setActivity(a)}
            />
          </View>
        ))}
      </FormSection>
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
  helper: { color: COLORS.textSecondary, fontSize: 11, marginTop: 6 },
  firstRow: {},
});
