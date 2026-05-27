import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

export default function NutritionGoalsScreen() {
  const goals = useMealStore(s => s.goals);
  const updateGoals = useMealStore(s => s.updateGoals);
  const showToast = useToastStore(s => s.showToast);

  const [calories, setCalories] = useState(String(goals.dailyCalories));
  const [protein, setProtein]   = useState(String(goals.protein));
  const [carbs, setCarbs]       = useState(String(goals.carbs));
  const [fats, setFats]         = useState(String(goals.fats));
  const [water, setWater]       = useState(String(goals.waterTargetCups ?? 8));

  const parseInt0 = (raw: string): number | null => {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
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
    updateGoals({
      dailyCalories: c,
      protein: p,
      carbs: cb,
      fats: f,
      waterTargetCups: w,
      // Manual edits clear the "auto-calculated" badge.
      isCalculated: false,
    });
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
});
