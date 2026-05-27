import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TouchableOpacity } from 'react-native';

import { FormPage, FormSection, RadioRow } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

const PREFERENCES = ['No food preferences', 'Vegetarian', 'Vegan', 'Pescetarian'] as const;

const ALLERGIES = [
  'No allergies',
  'Gluten intolerant',
  'Wheat intolerant',
  'Lactose intolerant',
  'Allergic to milk',
  'Allergic to egg',
  'Allergic to shellfish',
  'Allergic to fish',
  'Allergic to nuts',
] as const;

export default function DietaryScreen() {
  const profile = useMealStore(s => s.profile);
  const updateProfile = useMealStore(s => s.updateProfile);
  const templates = useMealStore(s => s.templates);
  const showToast = useToastStore(s => s.showToast);

  // Map current store state into local edit state.
  const initialPreference = (() => {
    const current = profile.dietaryRestrictions?.[0];
    if (!current) return PREFERENCES[0];
    const match = PREFERENCES.find(p => p.toLowerCase() === current.toLowerCase());
    return match ?? PREFERENCES[0];
  })();

  const [preference, setPreference] = useState<string>(initialPreference);
  const [allergies, setAllergies] = useState<Set<string>>(() => {
    const set = new Set<string>(profile.allergies ?? []);
    if (set.size === 0) set.add('No allergies');
    return set;
  });

  const toggleAllergy = (name: string) => {
    const next = new Set(allergies);
    if (name === 'No allergies') {
      next.clear();
      next.add('No allergies');
      setAllergies(next);
      return;
    }
    if (next.has(name)) next.delete(name);
    else { next.add(name); next.delete('No allergies'); }
    if (next.size === 0) next.add('No allergies');
    setAllergies(next);
  };

  const persist = () => {
    const restrictions = preference === 'No food preferences' ? [] : [preference];
    const allergyList = Array.from(allergies).filter(a => a !== 'No allergies');
    updateProfile({
      dietaryRestrictions: restrictions,
      allergies: allergyList,
    });
    showToast('Preferences updated');
    router.back();
  };

  const handleSave = () => {
    if (templates.length > 0) {
      Alert.alert(
        'Heads up',
        'Changing your food or allergy preferences may affect your current plan. Sure you want to continue?',
        [
          { text: 'Keep Preferences', style: 'cancel' },
          { text: 'Change Preferences', style: 'destructive', onPress: persist },
        ]
      );
      return;
    }
    persist();
  };

  return (
    <FormPage
      title="Dietary & Allergies"
      saveLabel="Save"
      onSave={handleSave}
    >
      <FormSection label="FOOD PREFERENCES">
        {PREFERENCES.map((p) => (
          <RadioRow
            key={p}
            label={p}
            selected={preference === p}
            onPress={() => setPreference(p)}
          />
        ))}
      </FormSection>

      <FormSection label="ALLERGIES">
        {ALLERGIES.map((a) => (
          <ToggleRow
            key={a}
            label={a}
            value={allergies.has(a)}
            onValueChange={() => toggleAllergy(a)}
          />
        ))}
      </FormSection>

      <Text style={styles.footnote}>
        AI features (What can I make, Custom Recipe) read these to avoid
        suggesting anything you can&apos;t or don&apos;t eat.
      </Text>
    </FormPage>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
}: { label: string; value: boolean; onValueChange: () => void }) {
  return (
    <TouchableOpacity style={styles.toggleRow} onPress={onValueChange} activeOpacity={0.7}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: COLORS.green, false: COLORS.elevated }}
        thumbColor="#fff"
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  toggleLabel: { color: COLORS.text, fontSize: 15, flex: 1 },
  footnote: {
    color: COLORS.textSecondary,
    fontSize: 12,
    paddingHorizontal: 4,
    marginTop: 4,
    marginBottom: 24,
  },
});
