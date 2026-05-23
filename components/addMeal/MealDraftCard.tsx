import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ScrollView,
} from 'react-native';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { MealDraft } from '@/ai/types';
import type { MealEntry, MealTemplate, RecurrenceRule } from '@/store/types';

type Recurrence = 'once' | 'daily' | 'weekly';

interface Props {
  date: string;
  initial: MealDraft;
  mode: 'create' | 'edit';
  editingMealId?: string;
  showFix?: boolean;
  onFix?: (current: MealDraft) => void;
  onCancel: () => void;
  onSaved: () => void;
}

export function MealDraftCard({
  date,
  initial,
  mode,
  editingMealId,
  showFix = false,
  onFix,
  onCancel,
  onSaved,
}: Props) {
  const addTemplate = useMealStore(s => s.addTemplate);
  const editMealOnDay = useMealStore(s => s.editMealOnDay);
  const saveToLibrary = useMealStore(s => s.saveToLibrary);
  const resolveDay = useMealStore(s => s.resolveDayFromTemplates);
  const showUndo = useUndoStore(s => s.showUndo);

  const [name, setName] = useState(initial.name);
  const [time, setTime] = useState(initial.time);
  const [calories, setCalories] = useState(String(initial.calories));
  const [protein, setProtein] = useState(String(initial.macros.protein));
  const [carbs, setCarbs] = useState(String(initial.macros.carbs));
  const [fats, setFats] = useState(String(initial.macros.fats));
  const [recurrence, setRecurrence] = useState<Recurrence>('once');
  const [saveLib, setSaveLib] = useState(false);

  const draft: MealDraft = useMemo(
    () => ({
      name: name.trim() || 'New meal',
      time,
      calories: toInt(calories),
      macros: {
        protein: toInt(protein),
        carbs: toInt(carbs),
        fats: toInt(fats),
      },
    }),
    [name, time, calories, protein, carbs, fats],
  );

  function buildRecurrence(): RecurrenceRule {
    if (recurrence === 'once') return { type: 'once', date };
    if (recurrence === 'daily') return { type: 'daily' };
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    return { type: 'weekly', days: [dayOfWeek] };
  }

  function handleSave() {
    if (mode === 'edit' && editingMealId) {
      const entry: MealEntry = {
        id: editingMealId,
        name: draft.name,
        time: draft.time,
        calories: draft.calories,
        ingredients: [],
        macros: draft.macros,
        status: 'pending',
      };
      editMealOnDay(date, entry);

      if (saveLib) {
        saveToLibrary({
          id: `lib-${Date.now()}`,
          name: draft.name,
          calories: draft.calories,
          ingredients: [],
          macros: draft.macros,
          usageCount: 0,
          lastUsed: new Date().toISOString().slice(0, 10),
        });
      }
      onSaved();
      return;
    }

    const id = `tpl-${Date.now()}`;
    const template: MealTemplate = {
      id,
      name: draft.name,
      time: draft.time,
      calories: draft.calories,
      ingredients: [],
      macros: draft.macros,
      recurrence: buildRecurrence(),
    };
    addTemplate(template);

    // Materialize today's entry so it shows up immediately on the DayDetailModal.
    // We add the entry directly because resolveDayFromTemplates is a no-op when
    // the day already exists in `logs`.
    const entryId = `${date}-${id}`;
    const entry: MealEntry = {
      id: entryId,
      name: draft.name,
      time: draft.time,
      calories: draft.calories,
      ingredients: [],
      macros: draft.macros,
      status: 'pending',
    };
    useMealStore.getState().addMealToDay(date, entry);

    if (saveLib) {
      saveToLibrary({
        id: `lib-${id}`,
        name: draft.name,
        calories: draft.calories,
        ingredients: [],
        macros: draft.macros,
        usageCount: 0,
        lastUsed: new Date().toISOString().slice(0, 10),
      });
    }

    showUndo({
      message: `Added "${draft.name}" to ${formatDate(date)}`,
      undo: () => {
        useMealStore.getState().removeTemplate(id);
        useMealStore.getState().removeMealFromDay(date, entryId);
      },
    });

    // Touch the resolver in case templates from the new save apply to
    // future days viewed elsewhere (no-op for the current `date`).
    resolveDay(date);

    onSaved();
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{mode === 'edit' ? 'Edit meal' : 'Confirm meal'}</Text>

      <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
        <Field label="Name">
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Chicken stir-fry"
            placeholderTextColor={COLORS.textMuted}
          />
        </Field>

        <View style={styles.row2}>
          <Field label="Time" half>
            <TextInput
              style={styles.input}
              value={time}
              onChangeText={setTime}
              placeholder="HH:MM"
              placeholderTextColor={COLORS.textMuted}
              maxLength={5}
            />
          </Field>
          <Field label="Calories" half>
            <TextInput
              style={styles.input}
              value={calories}
              onChangeText={setCalories}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textMuted}
            />
          </Field>
        </View>

        <View style={styles.row3}>
          <Field label="Protein (g)" third>
            <TextInput
              style={styles.input}
              value={protein}
              onChangeText={setProtein}
              keyboardType="number-pad"
              placeholderTextColor={COLORS.textMuted}
            />
          </Field>
          <Field label="Carbs (g)" third>
            <TextInput
              style={styles.input}
              value={carbs}
              onChangeText={setCarbs}
              keyboardType="number-pad"
              placeholderTextColor={COLORS.textMuted}
            />
          </Field>
          <Field label="Fats (g)" third>
            <TextInput
              style={styles.input}
              value={fats}
              onChangeText={setFats}
              keyboardType="number-pad"
              placeholderTextColor={COLORS.textMuted}
            />
          </Field>
        </View>

        {mode === 'create' && (
          <Field label="Repeat">
            <View style={styles.segmented}>
              {(['once', 'daily', 'weekly'] as const).map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.segment, recurrence === opt && styles.segmentActive]}
                  onPress={() => setRecurrence(opt)}
                >
                  <Text style={[styles.segmentText, recurrence === opt && styles.segmentTextActive]}>
                    {opt === 'once' ? 'Once' : opt === 'daily' ? 'Daily' : 'Weekly'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>
        )}

        <View style={styles.libRow}>
          <Text style={styles.libLabel}>Save to library too?</Text>
          <Switch
            value={saveLib}
            onValueChange={setSaveLib}
            trackColor={{ true: COLORS.green, false: COLORS.elevated }}
            thumbColor={saveLib ? '#0E1A12' : '#cfcfd2'}
          />
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        {showFix && (
          <TouchableOpacity style={styles.fixBtn} onPress={() => onFix?.(draft)}>
            <Text style={styles.fixText}>Fix</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Field({
  label,
  children,
  half,
  third,
}: {
  label: string;
  children: React.ReactNode;
  half?: boolean;
  third?: boolean;
}) {
  return (
    <View style={[styles.field, half && styles.fieldHalf, third && styles.fieldThird]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function toInt(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    maxHeight: '90%',
  },
  cardTitle: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  body: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 4,
  },
  field: {
    marginBottom: 10,
  },
  fieldHalf: { flex: 1 },
  fieldThird: { flex: 1 },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: COLORS.elevated,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 14,
  },
  row2: { flexDirection: 'row', gap: 10 },
  row3: { flexDirection: 'row', gap: 8 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: COLORS.green,
  },
  segmentText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#0E1A12',
    fontWeight: '700',
  },
  libRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 8,
  },
  libLabel: { color: COLORS.text, fontSize: 13 },
  actions: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  cancelText: { color: COLORS.textSecondary, fontWeight: '600' },
  fixBtn: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  fixText: { color: COLORS.blue, fontWeight: '700' },
  saveBtn: {
    flex: 1.4,
    backgroundColor: COLORS.green,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveText: { color: '#0E1A12', fontWeight: '700' },
});
