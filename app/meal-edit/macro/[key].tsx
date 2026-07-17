import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Screen } from '@/components/Screen';
import { ProgressRing } from '@/components/ProgressRing';
import { COLORS } from '@/constants/theme';
import { getNutrientMeta } from '@/constants/nutrients';
import { useMealStore } from '@/store/useMealStore';
import type { NutrientKey } from '@/store/types';

const MACRO_KEYS = ['protein', 'carbs', 'fats'] as const;
type MacroKey = (typeof MACRO_KEYS)[number];

function isMacroKey(k: string): k is MacroKey {
  return (MACRO_KEYS as readonly string[]).includes(k);
}

export default function MacroEditScreen() {
  const { key: rawKey } = useLocalSearchParams<{ key: string }>();
  const key = String(rawKey ?? 'calories');

  const session = useMealStore(s => s.mealEditSession);
  const goals = useMealStore(s => s.goals);
  const logs = useMealStore(s => s.logs);
  const updateMealDraft = useMealStore(s => s.updateMealDraft);

  // Snapshot the on-mount value for Revert.
  const draft = session?.draft;

  const currentValue = useMemo(() => {
    if (!draft) return 0;
    if (key === 'calories') return draft.calories;
    if (isMacroKey(key)) return draft.macros[key];
    return draft.nutrients?.[key as NutrientKey] ?? 0;
  }, [draft, key]);

  const initialRef = useRef(currentValue);
  const [value, setValue] = useState(String(currentValue));

  // Re-seed when the session/key first resolves.
  useEffect(() => {
    initialRef.current = currentValue;
    setValue(String(currentValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.draft.id, key]);

  if (!session || !draft) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Header title="Edit" onDone={() => router.back()} />
      </Screen>
    );
  }

  const meta = !isMacroKey(key) && key !== 'calories' ? getNutrientMeta(key as NutrientKey) : null;
  const label = key === 'calories' ? 'Calories' : isMacroKey(key) ? cap(key) : meta!.label;
  const unit = key === 'calories' ? 'kcal' : isMacroKey(key) ? 'g' : meta!.unit;

  // Daily target for this metric.
  const target =
    key === 'calories'
      ? goals.dailyCalories
      : isMacroKey(key)
        ? goals[key]
        : goals.secondaryTargets?.[key as NutrientKey] ?? 0;

  // Sum the same metric across other meals that day (excludes this meal).
  const otherTotal = (logs[session.date]?.meals ?? [])
    .filter(m => m.id !== draft.id)
    .reduce((sum, m) => {
      if (key === 'calories') return sum + m.calories;
      if (isMacroKey(key)) return sum + m.macros[key];
      return sum + (m.nutrients?.[key as NutrientKey] ?? 0);
    }, 0);

  const numeric = Number(value) || 0;
  const remaining = Math.max(0, target - otherTotal);
  const progress = target > 0 ? (otherTotal + numeric) / target : 0;

  function revert() {
    setValue(String(initialRef.current));
  }

  function done() {
    const v = Math.max(0, Math.round(Number(value) || 0));
    if (key === 'calories') {
      updateMealDraft({ calories: v });
      router.back();
      return;
    }
    if (isMacroKey(key)) {
      const nextMacros = { ...draft!.macros, [key]: v };
      updateMealDraft({ macros: nextMacros });
      const synced = 4 * nextMacros.protein + 4 * nextMacros.carbs + 9 * nextMacros.fats;
      Alert.alert(
        'Sync calories?',
        `Update calories to match macros (${synced} kcal)?`,
        [
          { text: "Don't sync", style: 'cancel', onPress: () => router.back() },
          {
            text: 'Sync',
            onPress: () => {
              updateMealDraft({ calories: synced });
              router.back();
            },
          },
        ],
      );
      return;
    }
    // secondary nutrient
    updateMealDraft({ nutrients: { ...(draft!.nutrients ?? {}), [key]: v } });
    router.back();
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title={`Edit ${label}`} onDone={done} />

      <View style={styles.body}>
        {target > 0 ? (
          <View style={styles.ringWrap}>
            <ProgressRing progress={progress} size={150} strokeWidth={12}>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.ringValue}>{numeric}</Text>
                <Text style={styles.ringUnit}>{unit}</Text>
              </View>
            </ProgressRing>
            <Text style={styles.remainingText}>
              {remaining} out of {target} {unit} left today
            </Text>
          </View>
        ) : (
          <View style={styles.noTarget}>
            <Text style={styles.noTargetText}>No daily target set for {label.toLowerCase()}.</Text>
          </View>
        )}

        <Text style={styles.inputLabel}>{label} ({unit})</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          keyboardType="number-pad"
          autoFocus
          selectTextOnFocus
          placeholder="0"
          placeholderTextColor={COLORS.textMuted}
        />

        <TouchableOpacity style={styles.revertBtn} onPress={revert}>
          <Ionicons name="arrow-undo-outline" size={16} color={COLORS.textSecondary} />
          <Text style={styles.revertText}>Revert</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

function Header({ title, onDone }: { title: string; onDone: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
        <Ionicons name="chevron-back" size={26} color={COLORS.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <TouchableOpacity onPress={onDone} hitSlop={10}>
        <Text style={styles.headerDone}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  headerDone: { color: COLORS.green, fontSize: 15, fontWeight: '700', width: 50, textAlign: 'right' },

  body: { padding: 20, alignItems: 'center' },
  ringWrap: { alignItems: 'center', marginTop: 12, marginBottom: 24 },
  ringValue: { color: COLORS.text, fontSize: 30, fontWeight: '800' },
  ringUnit: { color: COLORS.textSecondary, fontSize: 13 },
  remainingText: { color: COLORS.textSecondary, fontSize: 13, marginTop: 14 },
  noTarget: { marginTop: 16, marginBottom: 24 },
  noTargetText: { color: COLORS.textMuted, fontSize: 13 },

  inputLabel: { alignSelf: 'flex-start', color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  input: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.card,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  revertBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, padding: 8 },
  revertText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
});
