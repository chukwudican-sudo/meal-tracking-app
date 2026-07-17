import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { NUTRIENT_META } from '@/constants/nutrients';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import type { NutrientKey } from '@/store/types';

export default function NutritionGoalsScreen() {
  const goals = useMealStore(s => s.goals);
  const updateGoals = useMealStore(s => s.updateGoals);
  const trackedNutrients = useMealStore(s => s.profile.trackedNutrients ?? []);
  const updateProfile = useMealStore(s => s.updateProfile);
  const showToast = useToastStore(s => s.showToast);

  const [calories, setCalories] = useState(String(goals.dailyCalories));
  const [protein, setProtein]   = useState(String(goals.protein));
  const [carbs, setCarbs]       = useState(String(goals.carbs));
  const [fats, setFats]         = useState(String(goals.fats));
  const [water, setWater]       = useState(String(goals.waterTargetCups ?? 8));

  const [tracked, setTracked] = useState<NutrientKey[]>(trackedNutrients);
  const [targets, setTargets] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {};
    NUTRIENT_META.forEach(n => {
      const v = goals.secondaryTargets?.[n.key];
      base[n.key] = v != null ? String(v) : '';
    });
    return base;
  });

  const parseInt0 = (raw: string): number | null => {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
  };

  const toggleNutrient = (key: NutrientKey) => {
    setTracked(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const handleSave = () => {
    const c  = parseInt0(calories);
    const p  = parseInt0(protein);
    const cb = parseInt0(carbs);
    const f  = parseInt0(fats);
    const w  = parseInt0(water);
    if (c == null || p == null || cb == null || f == null || w == null) {
      showToast('Use whole numbers (0 or higher) for all targets.');
      return;
    }

    // Collect optional secondary targets only for tracked nutrients with a value.
    const secondaryTargets: Partial<Record<NutrientKey, number>> = {};
    for (const key of tracked) {
      const raw = (targets[key] ?? '').trim();
      if (raw.length === 0) continue;
      const n = parseInt0(raw);
      if (n == null) {
        showToast('Use whole numbers (0 or higher) for nutrient targets.');
        return;
      }
      secondaryTargets[key] = n;
    }

    updateGoals({
      dailyCalories: c,
      protein: p,
      carbs: cb,
      fats: f,
      waterTargetCups: w,
      secondaryTargets,
      // Manual edits clear the "auto-calculated" badge.
      isCalculated: false,
    });
    updateProfile({ trackedNutrients: tracked });
    showToast('Targets updated');
    router.back();
  };

  return (
    <FormPage
      title="Nutrition Goals"
      saveLabel="Save"
      onSave={handleSave}
    >
      {goals.isCalculated ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            These targets were calculated based on your goal. Editing
            manually will override the recommendation.
          </Text>
        </View>
      ) : null}

      <FormSection label="CALORIES & MACROS">
        <Field label="Daily calories (kcal)" value={calories} onChange={setCalories} />
        <Field label="Protein (g)"            value={protein}  onChange={setProtein} />
        <Field label="Carbs (g)"              value={carbs}    onChange={setCarbs} />
        <Field label="Fats (g)"               value={fats}     onChange={setFats} />
      </FormSection>

      <FormSection label="HYDRATION">
        <Field label="Water target (cups)"    value={water}    onChange={setWater} />
      </FormSection>

      <FormSection label="NUTRIENTS TO TRACK">
        <View style={styles.chipWrap}>
          {NUTRIENT_META.map(n => {
            const active = tracked.includes(n.key);
            return (
              <TouchableOpacity
                key={n.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => toggleNutrient(n.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{n.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tracked.length > 0 ? (
          tracked.map(key => {
            const meta = NUTRIENT_META.find(n => n.key === key)!;
            return (
              <Field
                key={key}
                label={`${meta.label} target (${meta.unit}) — optional`}
                value={targets[key] ?? ''}
                onChange={v => setTargets(prev => ({ ...prev, [key]: v }))}
              />
            );
          })
        ) : (
          <View style={styles.field}>
            <Text style={styles.bannerText}>Pick nutrients above to show them on meals and set optional targets.</Text>
          </View>
        )}
      </FormSection>
    </FormPage>
  );
}

function Field({
  label,
  value,
  onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        style={styles.input}
        placeholderTextColor={COLORS.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: COLORS.elevated,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  bannerText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },

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

  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.elevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#0E1A12' },
});
