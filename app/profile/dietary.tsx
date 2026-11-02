import { StyleSheet, Switch, Text, TouchableOpacity } from 'react-native';

import { FormPage, FormSection, RadioRow } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';

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
  const hasPlan = useMealStore(s => s.templates.length > 0);

  // Saved on each tap, like iOS Settings — no Save button. Read straight from
  // the store so what's shown is always what's saved.
  const current = profile.dietaryRestrictions?.[0];
  const preference: string =
    (current && PREFERENCES.find(p => p.toLowerCase() === current.toLowerCase())) || PREFERENCES[0];
  const allergies = new Set<string>(profile.allergies ?? []);
  if (allergies.size === 0) allergies.add('No allergies');

  const setPreference = (p: string) => {
    updateProfile({ dietaryRestrictions: p === 'No food preferences' ? [] : [p] });
  };

  const toggleAllergy = (name: string) => {
    // From the store, not this render: two quick taps must both stick.
    const next = new Set<string>(useMealStore.getState().profile.allergies ?? []);
    if (name === 'No allergies') {
      next.clear();
    } else if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    next.delete('No allergies');
    updateProfile({ allergies: Array.from(next) });
  };

  return (
    <FormPage title="Dietary & Allergies">
      {hasPlan ? (
        <Text style={styles.planNote}>
          Changes may affect your current plan.
        </Text>
      ) : null}

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
  planNote: {
    color: COLORS.orange,
    fontSize: 13,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  footnote: {
    color: COLORS.textSecondary,
    fontSize: 12,
    paddingHorizontal: 4,
    marginTop: 4,
    marginBottom: 24,
  },
});
