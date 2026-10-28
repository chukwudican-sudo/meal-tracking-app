import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { MealForm, type MealFormValues } from '@/components/MealForm';
import { COLORS } from '@/constants/theme';
import { newId } from '@/lib/sync/uuid';
import { useMealStore, initialMealStatus } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { MealEntry } from '@/store/types';

interface Props {
  date: string;
  onCreated: () => void;
}

// Pure-manual entry: starts on a landing page, then opens the simplified meal
// form. Logging adds the meal to the day, auto-saves it to Recently Added
// (savedRecipes, source 'manual'), and returns the user to the Home tab.
export function ManualTab({ date, onCreated }: Props) {
  const addMealToDay = useMealStore(s => s.addMealToDay);
  const removeMealFromDay = useMealStore(s => s.removeMealFromDay);
  const ensureRecipeSaved = useMealStore(s => s.ensureRecipeSaved);
  const ingestMidWeekIngredients = useMealStore(s => s.ingestMidWeekIngredients);
  const showUndo = useUndoStore(s => s.showUndo);

  const [mode, setMode] = useState<'landing' | 'form'>('landing');

  function handleSubmit(values: MealFormValues) {
    // Must be a UUID: meal_logs.id is a uuid column, so a non-uuid id makes the
    // cloud sync push fail permanently.
    const id = newId();
    const entry: MealEntry = {
      id,
      name: values.name,
      time: values.time,
      category: values.category,
      calories: values.calories,
      ingredients: values.ingredients,
      macros: values.macros,
      status: initialMealStatus(date, values.time),
      isAdHoc: true,
    };
    addMealToDay(date, entry);

    // Groceries are for planned meals only — an eaten meal needs no shopping.
    if (entry.status === 'pending' && values.ingredients.length > 0) {
      ingestMidWeekIngredients(values.ingredients.map(i => ({ name: i.name, mealName: values.name })));
    }

    // Auto-save to the user's Recently Added collection.
    ensureRecipeSaved({
      name: values.name,
      category: values.category,
      calories: values.calories,
      macros: values.macros,
      ingredients: values.ingredients,
      source: 'manual',
    });

    showUndo({ message: `${values.name} added`, undo: () => removeMealFromDay(date, id) });

    // Logging from the + button should land the user back on the Home tab.
    onCreated();
    router.navigate('/(tabs)');
  }

  if (mode === 'landing') {
    return (
      <View style={styles.landing}>
        <TouchableOpacity style={styles.landingTap} onPress={() => setMode('form')} activeOpacity={0.85}>
          <View style={styles.plusCircle}>
            <Ionicons name="add" size={44} color={COLORS.green} />
          </View>
          <Text style={styles.landingTitle}>Create a new meal</Text>
          <Text style={styles.landingSubtitle}>Enter nutrition details manually.</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <MealForm
      primaryLabel="Log Meal"
      showMealType
      onBack={() => setMode('landing')}
      onSubmit={handleSubmit}
    />
  );
}

const styles = StyleSheet.create({
  landing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  landingTap: { alignItems: 'center' },
  plusCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.green + '1A',
    borderWidth: 1,
    borderColor: COLORS.green + '55',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  landingTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  landingSubtitle: { color: COLORS.textSecondary, fontSize: 14, marginTop: 8, textAlign: 'center' },
});
