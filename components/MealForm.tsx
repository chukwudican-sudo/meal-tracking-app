import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@/constants/theme';
import type { Ingredient, Macros, RecipeCategory } from '@/store/types';

const MEAL_TYPES: RecipeCategory[] = ['Breakfast', 'Snacks', 'Lunch', 'Dinner'];

export interface MealFormValues {
  name: string;
  time: string; // "HH:MM"
  category?: RecipeCategory;
  calories: number;
  macros: Macros;
  ingredients: Ingredient[];
}

interface IngredientForm {
  id: string;
  name: string;
  quantity: string;
  unit: string;
}

interface Props {
  initial?: Partial<MealFormValues>;
  primaryLabel?: string;
  showMealType?: boolean;
  onBack: () => void;
  onSubmit: (values: MealFormValues) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseHHMMToDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 12, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function formatDateToHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTimeLabel(d: Date): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

function toIntSafe(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function initialIngredientForms(ings?: Ingredient[]): IngredientForm[] {
  if (!ings || ings.length === 0) {
    return [{ id: `f-${Date.now()}`, name: '', quantity: '', unit: '' }];
  }
  return ings.map(ing => ({
    id: ing.id,
    name: ing.name,
    quantity: ing.quantity ? String(ing.quantity) : '',
    unit: ing.unit ?? '',
  }));
}

function formsToIngredients(forms: IngredientForm[]): Ingredient[] {
  return forms
    .map((f, idx) => ({
      id: `ing-${Date.now()}-${idx + 1}`,
      name: f.name.trim(),
      quantity: toIntSafe(f.quantity) || Number(f.quantity) || 0,
      unit: f.unit.trim(),
    }))
    .filter(ing => ing.name.length > 0);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MealForm({ initial, primaryLabel = 'Save', showMealType = false, onBack, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [time, setTime] = useState<Date>(parseHHMMToDate(initial?.time ?? formatDateToHHMM(new Date())));
  const [showPicker, setShowPicker] = useState(false);
  const [category, setCategory] = useState<RecipeCategory | undefined>(initial?.category);
  const [calories, setCalories] = useState(initial?.calories != null ? String(initial.calories) : '');
  const [protein, setProtein] = useState(initial?.macros ? String(initial.macros.protein) : '');
  const [carbs, setCarbs] = useState(initial?.macros ? String(initial.macros.carbs) : '');
  const [fats, setFats] = useState(initial?.macros ? String(initial.macros.fats) : '');
  const [ingredients, setIngredients] = useState<IngredientForm[]>(initialIngredientForms(initial?.ingredients));

  function updateIngredient(id: string, key: keyof IngredientForm, value: string) {
    setIngredients(prev => prev.map(i => (i.id === id ? { ...i, [key]: value } : i)));
  }
  function addIngredientRow() {
    setIngredients(prev => [...prev, { id: `f-${Date.now()}-${prev.length}`, name: '', quantity: '', unit: '' }]);
  }
  function removeIngredientRow(id: string) {
    setIngredients(prev => {
      const next = prev.filter(i => i.id !== id);
      return next.length > 0 ? next : [{ id: `f-${Date.now()}`, name: '', quantity: '', unit: '' }];
    });
  }

  function handleSubmit() {
    onSubmit({
      name: name.trim() || 'New meal',
      time: formatDateToHHMM(time),
      category,
      calories: toIntSafe(calories),
      macros: { protein: toIntSafe(protein), carbs: toIntSafe(carbs), fats: toIntSafe(fats) },
      ingredients: formsToIngredients(ingredients),
    });
  }

  return (
    <KeyboardAvoidingView style={styles.full} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Label>Name</Label>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Greek yogurt bowl"
          placeholderTextColor={COLORS.textMuted}
        />

        <Label>Time</Label>
        <TouchableOpacity style={styles.timePill} onPress={() => setShowPicker(v => !v)} activeOpacity={0.7}>
          <Text style={styles.timePillText}>{formatTimeLabel(time)}</Text>
        </TouchableOpacity>
        {showPicker ? (
          <View style={styles.pickerWrap}>
            <DateTimePicker
              value={time}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, d) => {
                if (Platform.OS === 'android') setShowPicker(false);
                if (d) setTime(d);
              }}
              themeVariant="dark"
            />
          </View>
        ) : null}

        {showMealType ? (
          <>
            <Label>Meal type</Label>
            <View style={styles.chipRow}>
              {MEAL_TYPES.map(type => {
                const active = category === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setCategory(active ? undefined : type)}
                    style={[styles.chip, active && styles.chipActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{type}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        <Label>Calories</Label>
        <TextInput
          style={styles.input}
          value={calories}
          onChangeText={setCalories}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={COLORS.textMuted}
        />

        <Label>Macros (g)</Label>
        <View style={styles.macroRow}>
          <MacroInput label="Protein" value={protein} onChange={setProtein} />
          <MacroInput label="Carbs" value={carbs} onChange={setCarbs} />
          <MacroInput label="Fats" value={fats} onChange={setFats} />
        </View>

        <Label>Ingredients</Label>
        {ingredients.map(ing => (
          <View key={ing.id} style={styles.ingredientRow}>
            <TextInput
              style={[styles.input, styles.ingName]}
              value={ing.name}
              onChangeText={t => updateIngredient(ing.id, 'name', t)}
              placeholder="Ingredient"
              placeholderTextColor={COLORS.textMuted}
            />
            <TextInput
              style={[styles.input, styles.ingQty]}
              value={ing.quantity}
              onChangeText={t => updateIngredient(ing.id, 'quantity', t)}
              keyboardType="numeric"
              placeholder="Qty"
              placeholderTextColor={COLORS.textMuted}
            />
            <TextInput
              style={[styles.input, styles.ingUnit]}
              value={ing.unit}
              onChangeText={t => updateIngredient(ing.id, 'unit', t)}
              placeholder="Unit"
              placeholderTextColor={COLORS.textMuted}
            />
            <TouchableOpacity onPress={() => removeIngredientRow(ing.id)} style={styles.ingRemove} hitSlop={8}>
              <Text style={styles.ingRemoveText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity onPress={addIngredientRow} style={styles.addIngredient} activeOpacity={0.8}>
          <Text style={styles.addIngredientText}>+ Add ingredient</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity onPress={handleSubmit} style={styles.primaryBtn} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

function MacroInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.macroItem}>
      <Text style={styles.macroLabel}>{label}</Text>
      <TextInput
        style={[styles.input, styles.macroInput]}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={COLORS.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  body: { padding: 16, paddingBottom: 24 },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.card,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  timePill: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  timePillText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  pickerWrap: { marginTop: 8, backgroundColor: COLORS.card, borderRadius: 12, overflow: 'hidden' },

  macroRow: { flexDirection: 'row', gap: 10 },
  macroItem: { flex: 1 },
  macroLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 4 },
  macroInput: { textAlign: 'center' },

  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  ingName: { flex: 1 },
  ingQty: { width: 60, textAlign: 'center' },
  ingUnit: { width: 64, textAlign: 'center' },
  ingRemove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ingRemoveText: { color: COLORS.textSecondary, fontSize: 13 },

  addIngredient: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addIngredientText: { color: COLORS.green, fontSize: 14, fontWeight: '700' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.green + '22', borderColor: COLORS.green },
  chipText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: COLORS.green },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  primaryBtn: {
    backgroundColor: COLORS.green,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0E1A12', fontSize: 16, fontWeight: '800' },
});
