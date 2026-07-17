import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { router, useLocalSearchParams } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { toIsoDate, useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { Ingredient, MealEntry } from '@/store/types';

type IngredientForm = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
};

function ensureParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toPositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeTime(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '12:00';
  return trimmed;
}

function makeIngredientForms(ingredients: Ingredient[]): IngredientForm[] {
  if (ingredients.length === 0) {
    return [{ id: 'new-1', name: '', quantity: '', unit: '' }];
  }
  return ingredients.map(ing => ({
    id: ing.id,
    name: ing.name,
    quantity: String(ing.quantity),
    unit: ing.unit,
  }));
}

function createIngredientId(baseId: string, idx: number): string {
  return `${baseId}-ing-${idx + 1}`;
}

function cloneMealEntry(entry: MealEntry): MealEntry {
  return {
    ...entry,
    ingredients: entry.ingredients.map(ing => ({ ...ing })),
    macros: { ...entry.macros },
  };
}

export default function MealEditorScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; date?: string | string[] }>();
  const mealId = ensureParam(params.id) ?? 'new';
  const selectedDate = ensureParam(params.date) ?? toIsoDate(new Date());
  const isEditing = mealId !== 'new';

  const logs = useMealStore(s => s.logs);
  const addMealToDay = useMealStore(s => s.addMealToDay);
  const editMealOnDay = useMealStore(s => s.editMealOnDay);
  const showUndo = useUndoStore(s => s.showUndo);

  const existingEntry = useMemo(
    () => (isEditing ? logs[selectedDate]?.meals.find(m => m.id === mealId) : undefined),
    [isEditing, logs, mealId, selectedDate]
  );

  const [name, setName] = useState('');
  const [time, setTime] = useState('12:00');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fats, setFats] = useState('');
  const [ingredients, setIngredients] = useState<IngredientForm[]>([{ id: 'new-1', name: '', quantity: '', unit: '' }]);

  useEffect(() => {
    if (existingEntry) {
      setName(existingEntry.name);
      setTime(existingEntry.time);
      setCalories(String(existingEntry.calories));
      setProtein(String(existingEntry.macros.protein));
      setCarbs(String(existingEntry.macros.carbs));
      setFats(String(existingEntry.macros.fats));
      setIngredients(makeIngredientForms(existingEntry.ingredients));
      return;
    }

    setName('');
    setTime('12:00');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFats('');
    setIngredients([{ id: 'new-1', name: '', quantity: '', unit: '' }]);
  }, [existingEntry, selectedDate, mealId]);

  const canSave = name.trim().length > 0 && time.trim().length > 0;

  const handleIngredientChange = (id: string, key: keyof IngredientForm, value: string) => {
    setIngredients(prev => prev.map(ing => (ing.id === id ? { ...ing, [key]: value } : ing)));
  };

  const handleAddIngredient = () => {
    setIngredients(prev => [...prev, { id: `new-${Date.now()}`, name: '', quantity: '', unit: '' }]);
  };

  const handleRemoveIngredient = (id: string) => {
    setIngredients(prev => {
      const next = prev.filter(ing => ing.id !== id);
      return next.length > 0 ? next : [{ id: 'new-1', name: '', quantity: '', unit: '' }];
    });
  };

  const handleSave = () => {
    if (!canSave) return;
    const previousEntry = existingEntry ? cloneMealEntry(existingEntry) : null;

    const resolvedId =
      existingEntry?.id ?? `${selectedDate}-custom-${Date.now()}`;

    const cleanedIngredients: Ingredient[] = ingredients
      .map((ing, idx) => ({
        id: createIngredientId(resolvedId, idx),
        name: ing.name.trim(),
        quantity: toPositiveNumber(ing.quantity),
        unit: ing.unit.trim(),
      }))
      .filter(ing => ing.name.length > 0);

    const nextEntry: MealEntry = {
      id: resolvedId,
      name: name.trim(),
      time: normalizeTime(time),
      calories: toPositiveNumber(calories),
      ingredients: cleanedIngredients,
      macros: {
        protein: toPositiveNumber(protein),
        carbs: toPositiveNumber(carbs),
        fats: toPositiveNumber(fats),
      },
      status: existingEntry?.status ?? 'pending',
    };

    if (existingEntry) {
      editMealOnDay(selectedDate, nextEntry);
      if (previousEntry) {
        showUndo({
          message: 'Meal updated',
          undo: () => editMealOnDay(selectedDate, previousEntry),
        });
      }
    } else {
      addMealToDay(selectedDate, nextEntry);
    }

    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardSafe}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{isEditing ? 'Edit meal' : 'Add meal'}</Text>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionLabel}>Basics</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Meal name"
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
          />
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="Time (HH:MM)"
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
            autoCapitalize="none"
          />
          <TextInput
            value={calories}
            onChangeText={setCalories}
            placeholder="Calories"
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
            keyboardType="numeric"
          />

          <Text style={styles.sectionLabel}>Macros (g)</Text>
          <View style={styles.row}>
            <TextInput
              value={protein}
              onChangeText={setProtein}
              placeholder="Protein"
              placeholderTextColor={COLORS.textMuted}
              style={[styles.input, styles.rowInput]}
              keyboardType="numeric"
            />
            <TextInput
              value={carbs}
              onChangeText={setCarbs}
              placeholder="Carbs"
              placeholderTextColor={COLORS.textMuted}
              style={[styles.input, styles.rowInput]}
              keyboardType="numeric"
            />
            <TextInput
              value={fats}
              onChangeText={setFats}
              placeholder="Fats"
              placeholderTextColor={COLORS.textMuted}
              style={[styles.input, styles.rowInput]}
              keyboardType="numeric"
            />
          </View>

          <Text style={styles.sectionLabel}>Ingredients</Text>
          {ingredients.map(ing => (
            <View key={ing.id} style={styles.ingredientCard}>
              <TextInput
                value={ing.name}
                onChangeText={value => handleIngredientChange(ing.id, 'name', value)}
                placeholder="Ingredient name"
                placeholderTextColor={COLORS.textMuted}
                style={styles.input}
              />
              <View style={styles.row}>
                <TextInput
                  value={ing.quantity}
                  onChangeText={value => handleIngredientChange(ing.id, 'quantity', value)}
                  placeholder="Qty"
                  placeholderTextColor={COLORS.textMuted}
                  style={[styles.input, styles.qtyInput]}
                  keyboardType="numeric"
                />
                <TextInput
                  value={ing.unit}
                  onChangeText={value => handleIngredientChange(ing.id, 'unit', value)}
                  placeholder="Unit"
                  placeholderTextColor={COLORS.textMuted}
                  style={[styles.input, styles.unitInput]}
                />
                <TouchableOpacity
                  style={styles.removeIngredientBtn}
                  onPress={() => handleRemoveIngredient(ing.id)}
                >
                  <Text style={styles.removeIngredientText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <TouchableOpacity style={styles.secondaryBtn} onPress={handleAddIngredient}>
            <Text style={styles.secondaryBtnText}>+ Add ingredient</Text>
          </TouchableOpacity>
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
            <Text style={styles.saveBtnText}>Save meal</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  keyboardSafe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  scroll: {
    padding: 16,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 8,
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
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  rowInput: {
    flex: 1,
  },
  ingredientCard: {
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  qtyInput: {
    flex: 0.9,
    marginBottom: 0,
  },
  unitInput: {
    flex: 1.1,
    marginBottom: 0,
  },
  removeIngredientBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  removeIngredientText: {
    color: COLORS.red,
    fontSize: 12,
    fontWeight: '600',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 2,
  },
  secondaryBtnText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
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
