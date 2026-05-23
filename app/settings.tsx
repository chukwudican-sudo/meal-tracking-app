import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';

export default function SettingsScreen() {
  const goals = useMealStore(s => s.goals);
  const updateGoals = useMealStore(s => s.updateGoals);
  const profile = useMealStore(s => s.profile);
  const updateProfile = useMealStore(s => s.updateProfile);

  const [name, setName] = useState('');
  const [dailyCalories, setDailyCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fats, setFats] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(profile.name);
  }, [profile]);

  useEffect(() => {
    setDailyCalories(String(goals.dailyCalories));
    setProtein(String(goals.protein));
    setCarbs(String(goals.carbs));
    setFats(String(goals.fats));
  }, [goals]);

  const canSave = useMemo(() => {
    const values = [dailyCalories, protein, carbs, fats];
    return values.every(v => v.trim().length > 0);
  }, [dailyCalories, protein, carbs, fats]);

  const parseNonNegativeInt = (raw: string): number | null => {
    const value = Number(raw.trim());
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
  };

  const handleSave = () => {
    const nextDailyCalories = parseNonNegativeInt(dailyCalories);
    const nextProtein = parseNonNegativeInt(protein);
    const nextCarbs = parseNonNegativeInt(carbs);
    const nextFats = parseNonNegativeInt(fats);

    if (
      nextDailyCalories === null ||
      nextProtein === null ||
      nextCarbs === null ||
      nextFats === null
    ) {
      setError('Use whole numbers 0 or higher for all goals.');
      return;
    }

    updateGoals({
      dailyCalories: nextDailyCalories,
      protein: nextProtein,
      carbs: nextCarbs,
      fats: nextFats,
    });

    updateProfile({ name: name.trim() });

    setError(null);
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardSafe}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>Profile</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Your first name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Alex"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
              autoCapitalize="words"
            />
            <Text style={styles.helper}>Used to personalize the AI assistant&apos;s replies.</Text>
          </View>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Nutrition goals</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Daily calories (kcal)</Text>
            <TextInput
              value={dailyCalories}
              onChangeText={setDailyCalories}
              keyboardType="number-pad"
              placeholder="2200"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Protein (g)</Text>
            <TextInput
              value={protein}
              onChangeText={setProtein}
              keyboardType="number-pad"
              placeholder="165"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Carbs (g)</Text>
            <TextInput
              value={carbs}
              onChangeText={setCarbs}
              keyboardType="number-pad"
              placeholder="220"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Fats (g)</Text>
            <TextInput
              value={fats}
              onChangeText={setFats}
              keyboardType="number-pad"
              placeholder="65"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
            />
          </View>

          {!!error && <Text style={styles.errorText}>{error}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
          >
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  keyboardSafe: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title:    { fontSize: 18, fontWeight: '700', color: COLORS.text },
  closeBtn: { fontSize: 16, color: COLORS.textSecondary },
  content: {
    padding: 16,
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 14,
  },
  field: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.card,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  helper: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 6,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 18,
  },
  errorText: {
    color: COLORS.red,
    fontSize: 12,
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 11,
  },
  cancelBtnText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 1.2,
    backgroundColor: COLORS.green,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 11,
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    color: '#0E1A12',
    fontSize: 13,
    fontWeight: '700',
  },
});
