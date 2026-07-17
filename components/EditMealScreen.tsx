import { Modal, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import { MealForm, type MealFormValues } from '@/components/MealForm';
import { newId } from '@/lib/sync/uuid';
import { useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { MealEntry } from '@/store/types';

interface Props {
  date: string;
  entry: MealEntry | null;
  visible: boolean;
  onClose: () => void;
  mode?: 'edit' | 'create';
  onSaved?: () => void;
}

// Simplified Edit Meal screen: a plain form (name, time, calories, macros,
// ingredients) with Cancel/Save. No tabs, AI Adjust, recurrence, or library.
export function EditMealScreen({ date, entry, visible, onClose, mode = 'edit', onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const editMealOnDay = useMealStore(s => s.editMealOnDay);
  const addMealToDay = useMealStore(s => s.addMealToDay);
  const removeMealFromDay = useMealStore(s => s.removeMealFromDay);
  const ingestMidWeekIngredients = useMealStore(s => s.ingestMidWeekIngredients);
  const showUndo = useUndoStore(s => s.showUndo);

  if (mode === 'edit' && !entry) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        <View style={[styles.full, { paddingTop: insets.top }]} />
      </Modal>
    );
  }

  const initial: Partial<MealFormValues> | undefined = entry
    ? {
        name: entry.name,
        time: entry.time,
        calories: entry.calories,
        macros: entry.macros,
        ingredients: entry.ingredients,
      }
    : undefined;

  function handleSubmit(values: MealFormValues) {
    if (mode === 'create') {
      // UUID required — meal_logs.id is a uuid column on the server.
      const id = newId();
      const newEntry: MealEntry = {
        id,
        name: values.name,
        time: values.time,
        calories: values.calories,
        ingredients: values.ingredients,
        macros: values.macros,
        status: 'pending',
        isAdHoc: true,
      };
      addMealToDay(date, newEntry);
      if (values.ingredients.length > 0) {
        ingestMidWeekIngredients(values.ingredients.map(i => ({ name: i.name, mealName: values.name })));
      }
      showUndo({ message: `${values.name} added`, undo: () => removeMealFromDay(date, id) });
      onSaved?.();
      onClose();
      return;
    }

    if (!entry) return;
    editMealOnDay(date, {
      ...entry,
      name: values.name,
      time: values.time,
      calories: values.calories,
      macros: values.macros,
      ingredients: values.ingredients,
    });
    onSaved?.();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.full, { paddingTop: insets.top }]}>
        <MealForm
          initial={initial}
          primaryLabel="Save"
          onBack={onClose}
          onSubmit={handleSubmit}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
});
