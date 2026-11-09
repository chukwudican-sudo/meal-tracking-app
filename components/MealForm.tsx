import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';

import { PageHeader } from '@/components/PageHeader';
import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import type { Ingredient, Macros, MealSlot, RecipeCategory } from '@/store/types';

// Manual entry form (Add Meal → Manual). Fully manual by design (Alex, Nov 6):
// no AI, no maths, no "doesn't add up" checks — the user types what they know.
// Log stays disabled until name, meal type, calories and all three macros are
// filled (0 counts when typed).

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const MEAL_TYPES: { type: RecipeCategory; label: string; icon: IoniconName }[] = [
  { type: 'Breakfast', label: 'Breakfast', icon: 'sunny-outline' },
  { type: 'Lunch',     label: 'Lunch',     icon: 'restaurant-outline' },
  { type: 'Dinner',    label: 'Dinner',    icon: 'moon-outline' },
  { type: 'Snacks',    label: 'Snack',     icon: 'nutrition-outline' },
];

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
  // The day the meal is for (YYYY-MM-DD). Today, a meal type only moves the
  // time back to its slot, never later than now: a meal logged now counts as
  // eaten (initialMealStatus), and Dinner at 17:30 must not become "planned".
  date?: string;
  primaryLabel?: string;
  // Shows the meal-type tiles and makes a type required.
  showMealType?: boolean;
  // false when the host screen already has the header (Add Meal → Manual):
  // never two back arrows on one screen.
  showHeader?: boolean;
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

// Numbers only (one decimal point kept, rounded on save — "12.5" must not
// become 125), capped so a stray paste can't log 1e9 calories.
function numberText(s: string): string {
  const [whole, ...rest] = s.replace(/[^0-9.]/g, '').split('.');
  return (rest.length > 0 ? `${whole}.${rest.join('').slice(0, 1)}` : whole).slice(0, 6);
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function initialIngredientForms(ings?: Ingredient[]): IngredientForm[] {
  return (ings ?? []).map(ing => ({
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
      quantity: Number(f.quantity) || 0,
      unit: f.unit.trim(),
    }))
    .filter(ing => ing.name.length > 0);
}

// The time of the user's meal slot for a type (Profile → meal times), e.g.
// Breakfast → 08:00. Snacks: the next snack slot from now, else the last one.
function slotTimeFor(type: RecipeCategory, slots: MealSlot[], now: Date): string | null {
  const word = type === 'Snacks' ? 'snack' : type.toLowerCase();
  const matches = slots
    .filter(s => !s.skipped && s.name.toLowerCase().includes(word))
    .sort((a, b) => a.time.localeCompare(b.time));
  if (matches.length === 0) return null;
  if (type !== 'Snacks') return matches[0].time;
  const nowHHMM = formatDateToHHMM(now);
  return (matches.find(s => s.time >= nowHHMM) ?? matches[matches.length - 1]).time;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MealForm({
  initial, date, primaryLabel = 'Save', showMealType = false, showHeader = true, onBack, onSubmit,
}: Props) {
  const mealSlots = useMealStore(s => s.profile.mealSlots);

  const [name, setName] = useState(initial?.name ?? '');
  const [time, setTime] = useState<Date>(parseHHMMToDate(initial?.time ?? formatDateToHHMM(new Date())));
  // Once the user sets the time themselves, picking a meal type no longer moves it.
  const [timeTouched, setTimeTouched] = useState(initial?.time != null);
  const [showPicker, setShowPicker] = useState(false);
  const [category, setCategory] = useState<RecipeCategory | undefined>(initial?.category);
  const [calories, setCalories] = useState(initial?.calories != null ? String(initial.calories) : '');
  const [protein, setProtein] = useState(initial?.macros ? String(initial.macros.protein) : '');
  const [carbs, setCarbs] = useState(initial?.macros ? String(initial.macros.carbs) : '');
  const [fats, setFats] = useState(initial?.macros ? String(initial.macros.fats) : '');
  const [ingredients, setIngredients] = useState<IngredientForm[]>(initialIngredientForms(initial?.ingredients));

  // What's still missing, in screen order — named live under the button so
  // the user always knows why Log is grey (not only once everything's done).
  const missing: string[] = [];
  if (!name.trim()) missing.push('name');
  if (showMealType && !category) missing.push('meal type');
  if (calories === '') missing.push('calories');
  if (protein === '') missing.push('protein');
  if (carbs === '') missing.push('carbs');
  if (fats === '') missing.push('fats');
  const canSubmit = missing.length === 0;
  const nutritionDone = calories !== '' && protein !== '' && carbs !== '' && fats !== '';

  function pickType(type: RecipeCategory) {
    setCategory(type);
    if (timeTouched) return;
    const now = new Date();
    const slotTime = slotTimeFor(type, mealSlots ?? [], now);
    if (!slotTime) return;
    const isToday = !date || date === formatLocalDate(now);
    if (isToday && slotTime > formatDateToHHMM(now)) {
      setTime(now);
      return;
    }
    setTime(parseHHMMToDate(slotTime));
  }

  function updateIngredient(id: string, key: keyof IngredientForm, value: string) {
    setIngredients(prev => prev.map(i => (i.id === id ? { ...i, [key]: value } : i)));
  }
  function addIngredientRow() {
    setIngredients(prev => [...prev, { id: `f-${Date.now()}-${prev.length}`, name: '', quantity: '', unit: '' }]);
  }
  function removeIngredientRow(id: string) {
    setIngredients(prev => prev.filter(i => i.id !== id));
  }

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      time: formatDateToHHMM(time),
      category,
      calories: toIntSafe(calories),
      macros: { protein: toIntSafe(protein), carbs: toIntSafe(carbs), fats: toIntSafe(fats) },
      ingredients: formsToIngredients(ingredients),
    });
  }

  return (
    <KeyboardAvoidingView style={styles.full} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {showHeader ? <PageHeader title="New meal" onBack={onBack} /> : null}

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Section first required done={!!name.trim()}>Name</Section>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Greek yogurt bowl"
          placeholderTextColor={COLORS.textMuted}
          maxLength={80}
        />

        {showMealType ? (
          <>
            <Section required done={!!category}>Meal type</Section>
            <View style={styles.typeRow}>
              {MEAL_TYPES.map(({ type, label, icon }) => {
                const active = category === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => pickType(type)}
                    style={[styles.typeTile, active && styles.typeTileActive]}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={icon} size={18} color={active ? COLORS.green : COLORS.textSecondary} />
                    <Text style={[styles.typeText, active && styles.typeTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        <Section>Time</Section>
        <TouchableOpacity style={styles.timeRow} onPress={() => setShowPicker(v => !v)} activeOpacity={0.7}>
          <Text style={styles.timeLabel}>Time</Text>
          <View style={styles.timeValueWrap}>
            <Text style={styles.timeValue}>{formatTimeLabel(time)}</Text>
            <Ionicons name={showPicker ? 'chevron-up' : 'chevron-forward'} size={16} color={COLORS.textMuted} />
          </View>
        </TouchableOpacity>
        {showPicker ? (
          <View style={styles.pickerWrap}>
            <DateTimePicker
              value={time}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(e, d) => {
                if (Platform.OS === 'android') setShowPicker(false);
                // Android also calls this on Cancel ('dismissed'): not a choice.
                if (d && e.type === 'set') {
                  setTime(d);
                  setTimeTouched(true);
                }
              }}
              themeVariant="dark"
            />
          </View>
        ) : null}

        <Section required done={nutritionDone}>Nutrition</Section>
        <View style={styles.nutGrid}>
          <NumberTile big value={calories} onChange={setCalories} label="Calories (kcal)" color={COLORS.green} />
          <View style={styles.macroRow}>
            <NumberTile value={protein} onChange={setProtein} label="Protein (g)" color={COLORS.blue} />
            <NumberTile value={carbs} onChange={setCarbs} label="Carbs (g)" color={COLORS.purple} />
            <NumberTile value={fats} onChange={setFats} label="Fats (g)" color={COLORS.orange} />
          </View>
        </View>

        <Section>
          Ingredients <Text style={styles.optional}>(optional)</Text>
        </Section>
        {ingredients.map(ing => (
          <View key={ing.id} style={styles.ingredientRow}>
            <TextInput
              style={[styles.ingInput, styles.ingName]}
              value={ing.name}
              onChangeText={t => updateIngredient(ing.id, 'name', t)}
              placeholder="Ingredient"
              placeholderTextColor={COLORS.textMuted}
              maxLength={60}
            />
            <TextInput
              style={[styles.ingInput, styles.ingQty]}
              value={ing.quantity}
              onChangeText={t => updateIngredient(ing.id, 'quantity', t.replace(/[^0-9.]/g, '').slice(0, 6))}
              keyboardType="decimal-pad"
              placeholder="Qty"
              placeholderTextColor={COLORS.textMuted}
            />
            <TextInput
              style={[styles.ingInput, styles.ingUnit]}
              value={ing.unit}
              onChangeText={t => updateIngredient(ing.id, 'unit', t)}
              placeholder="Unit"
              placeholderTextColor={COLORS.textMuted}
              maxLength={12}
            />
            <TouchableOpacity onPress={() => removeIngredientRow(ing.id)} style={styles.ingRemove} hitSlop={8}>
              <Ionicons name="close" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity onPress={addIngredientRow} style={styles.addIngredient} activeOpacity={0.8}>
          <Ionicons name="add" size={16} color={COLORS.textSecondary} />
          <Text style={styles.addIngredientText}>Add ingredient</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, !canSubmit && styles.primaryBtnTextDisabled]}>{primaryLabel}</Text>
        </TouchableOpacity>
        {/* Always rendered (blank when ready) so the footer doesn't jump. */}
        <Text style={styles.needHint} numberOfLines={1}>
          {canSubmit ? ' ' : `Still need: ${missing.join(', ')}`}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

// Section label; required ones carry a grey "Required" tag that becomes a
// green tick once that part is filled in.
function Section({
  children, first, required, done,
}: { children: React.ReactNode; first?: boolean; required?: boolean; done?: boolean }) {
  return (
    <View style={[styles.sectionRow, first && styles.sectionFirst]}>
      <Text style={styles.section}>{children}</Text>
      {required ? (
        done ? (
          <Ionicons name="checkmark-circle" size={14} color={COLORS.green} />
        ) : (
          <Text style={styles.requiredTag}>Required</Text>
        )
      ) : null}
    </View>
  );
}

// A centred number with its label underneath (calories tile spans the row).
function NumberTile({
  value, onChange, label, color, big,
}: { value: string; onChange: (v: string) => void; label: string; color: string; big?: boolean }) {
  const input = useRef<TextInput>(null);
  return (
    // The whole tile focuses its number, not just the digits.
    <Pressable style={[styles.tile, big && styles.tileBig]} onPress={() => input.current?.focus()}>
      <TextInput
        ref={input}
        style={[styles.tileInput, big && styles.tileInputBig]}
        value={value}
        onChangeText={t => onChange(numberText(t))}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={COLORS.textMuted}
      />
      <View style={styles.tileLabelRow}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

// One spacing rhythm: 8 inside a section, 16 between sections, 16 page sides,
// radius 12 and fixed row heights everywhere.
const ROW_H = 46;

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 20 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 2,
    minHeight: 16,
  },
  section: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  requiredTag: { color: COLORS.textMuted, fontSize: 11, fontWeight: '500' },
  sectionFirst: { marginTop: 4 },
  optional: { textTransform: 'none', letterSpacing: 0, color: COLORS.textMuted, fontWeight: '500' },

  nameInput: {
    height: ROW_H,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
  },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeTile: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  typeTileActive: { backgroundColor: COLORS.green + '1F', borderColor: COLORS.green + '80' },
  typeText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  typeTextActive: { color: COLORS.green },

  timeRow: {
    height: ROW_H,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeLabel: { color: COLORS.textSecondary, fontSize: 15 },
  timeValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeValue: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  pickerWrap: { marginTop: 8, backgroundColor: COLORS.card, borderRadius: 12, overflow: 'hidden' },

  nutGrid: { gap: 8 },
  macroRow: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    height: 64,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBig: { height: 76, backgroundColor: COLORS.elevated },
  tileInput: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    paddingVertical: 0,
  },
  tileInputBig: { fontSize: 30 },
  tileLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tileLabel: { color: COLORS.textSecondary, fontSize: 12 },

  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  ingInput: {
    height: 44,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: COLORS.text,
    fontSize: 14,
  },
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
  addIngredient: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addIngredientText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  primaryBtn: {
    height: 50,
    backgroundColor: COLORS.green,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { backgroundColor: COLORS.elevated },
  primaryBtnText: { color: '#0E1A12', fontSize: 16, fontWeight: '800' },
  primaryBtnTextDisabled: { color: COLORS.textMuted },
  needHint: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', marginTop: 6 },
});
