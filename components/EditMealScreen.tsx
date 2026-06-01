import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';

import { COLORS } from '@/constants/theme';
import { isTemplateApplicableOnDate, toIsoDate, useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type {
  Ingredient,
  MealEntry,
  MealTemplate,
  RecurrenceRule,
} from '@/store/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  date: string;
  entry: MealEntry | null;
  visible: boolean;
  onClose: () => void;
  mode?: 'edit' | 'create';
  onSaved?: () => void;
}

type Tab = 'edit' | 'ai';

type RecType = 'daily' | 'weekly' | 'every';
type EveryUnit = 'days' | 'weeks';
type OpenPicker = 'time' | null;

interface IngredientForm {
  id: string;
  name: string;
  quantity: string;
  unit: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  // Display: 12-hour with AM/PM.
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

function formatDayPill(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

function toIntSafe(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function ingredientsToForms(ings: Ingredient[]): IngredientForm[] {
  if (ings.length === 0) return [{ id: `f-${Date.now()}`, name: '', quantity: '', unit: '' }];
  return ings.map(ing => ({
    id: ing.id,
    name: ing.name,
    quantity: String(ing.quantity),
    unit: ing.unit,
  }));
}

function formsToIngredients(forms: IngredientForm[], baseId: string): Ingredient[] {
  return forms
    .map((f, idx) => ({
      id: `${baseId}-ing-${idx + 1}`,
      name: f.name.trim(),
      quantity: toIntSafe(f.quantity) || Number(f.quantity) || 0,
      unit: f.unit.trim(),
    }))
    .filter(ing => ing.name.length > 0);
}

function cloneEntry(e: MealEntry): MealEntry {
  return {
    ...e,
    ingredients: e.ingredients.map(i => ({ ...i })),
    macros: { ...e.macros },
  };
}

function cloneTemplate(t: MealTemplate): MealTemplate {
  return {
    ...t,
    ingredients: t.ingredients.map(i => ({ ...i })),
    macros: { ...t.macros },
    recurrence: { ...t.recurrence } as RecurrenceRule,
  };
}

// Read recurrence kind + cadence out of an existing template's rule.
function deriveRecurrenceState(template: MealTemplate | null): {
  isRecurring: boolean;
  type: RecType;
  everyN: string;
  everyUnit: EveryUnit;
} {
  if (!template || template.recurrence.type === 'once') {
    return { isRecurring: false, type: 'daily', everyN: '2', everyUnit: 'days' };
  }
  const rec = template.recurrence;
  if (rec.type === 'daily') {
    const e = rec.every ?? 1;
    if (e === 1) return { isRecurring: true, type: 'daily', everyN: '2', everyUnit: 'days' };
    return { isRecurring: true, type: 'every', everyN: String(e), everyUnit: 'days' };
  }
  if (rec.type === 'weekly') {
    const e = rec.every ?? 1;
    if (e === 1) return { isRecurring: true, type: 'weekly', everyN: '2', everyUnit: 'weeks' };
    return { isRecurring: true, type: 'every', everyN: String(e), everyUnit: 'weeks' };
  }
  return { isRecurring: true, type: 'daily', everyN: '2', everyUnit: 'days' };
}

// Build a recurrence rule from current UI state.
function buildRecurrence(
  isRecurring: boolean,
  type: RecType,
  everyN: string,
  everyUnit: EveryUnit,
  baseDate: string,
  previous?: RecurrenceRule,
): RecurrenceRule {
  if (!isRecurring) return { type: 'once', date: baseDate };

  // Preserve start/until/exclude where reasonable
  const startDate = (previous && 'startDate' in previous && previous.startDate) || baseDate;
  const untilDate = previous && 'untilDate' in previous ? previous.untilDate : undefined;
  const excludeDates =
    previous && 'excludeDates' in previous ? previous.excludeDates : undefined;

  if (type === 'daily') {
    return { type: 'daily', every: 1, startDate, untilDate, excludeDates };
  }
  if (type === 'weekly') {
    const dow = new Date(baseDate + 'T00:00:00').getDay();
    const days =
      previous && previous.type === 'weekly' ? previous.days : [dow];
    return { type: 'weekly', days, every: 1, startDate, untilDate, excludeDates };
  }
  // 'every'
  const n = Math.max(1, toIntSafe(everyN) || 1);
  if (everyUnit === 'days') {
    return { type: 'daily', every: n, startDate, untilDate, excludeDates };
  }
  const dow = new Date(baseDate + 'T00:00:00').getDay();
  const days = previous && previous.type === 'weekly' ? previous.days : [dow];
  return { type: 'weekly', days, every: n, startDate, untilDate, excludeDates };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditMealScreen({
  date,
  entry,
  visible,
  onClose,
  mode = 'edit',
  onSaved,
}: Props) {
  const insets = useSafeAreaInsets();
  const templates = useMealStore(s => s.templates);
  const editMealOnDay = useMealStore(s => s.editMealOnDay);
  const addTemplate = useMealStore(s => s.addTemplate);
  const updateTemplate = useMealStore(s => s.updateTemplate);
  const removeTemplate = useMealStore(s => s.removeTemplate);
  const addMealToDay = useMealStore(s => s.addMealToDay);
  const removeMealFromDay = useMealStore(s => s.removeMealFromDay);
  const saveToLibrary = useMealStore(s => s.saveToLibrary);
  const removeFromLibrary = useMealStore(s => s.removeFromLibrary);
  const ingestMidWeekIngredients = useMealStore(s => s.ingestMidWeekIngredients);
  const showUndo = useUndoStore(s => s.showUndo);

  // Find the template this entry materialized from (if any). A template-derived
  // entry has id `${date}-${templateId}`.
  const sourceTemplate = useMemo(() => {
    if (!entry) return null;
    return (
      templates.find(t => entry.id === `${date}-${t.id}` && t.recurrence.type !== 'once') ?? null
    );
  }, [entry, templates, date]);

  // Snapshot whether the meal was already recurring when this edit session opened.
  // This prevents the scope dialog from appearing when the user is setting
  // recurrence for the very first time (it should only appear on subsequent edits).
  const wasAlreadyRecurringRef = useRef(false);
  useEffect(() => {
    if (visible) {
      wasAlreadyRecurringRef.current = sourceTemplate !== null;
    }
  // Only re-snapshot when the modal opens (visible flips to true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('edit');
  const [name, setName] = useState('');
  const [time, setTime] = useState<Date>(new Date());
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fats, setFats] = useState('');
  const [ingredients, setIngredients] = useState<IngredientForm[]>([]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recType, setRecType] = useState<RecType>('daily');
  const [everyN, setEveryN] = useState('2');
  const [everyUnit, setEveryUnit] = useState<EveryUnit>('days');
  const [saveLib, setSaveLib] = useState(false);

  // ── AI tab state (shell only) ─────────────────────────────────────────────
  const [aiMessages, setAiMessages] = useState<ChatMsg[]>([]);
  const [aiInput, setAiInput] = useState('');

  // Reset form whenever a different entry is opened or create mode is launched.
  useEffect(() => {
    if (!visible) return;
    if (mode === 'create') {
      setTab('edit');
      setName('');
      setTime(new Date());
      setOpenPicker(null);
      setCalories('');
      setProtein('');
      setCarbs('');
      setFats('');
      setIngredients([{ id: `f-${Date.now()}`, name: '', quantity: '', unit: '' }]);
      setIsRecurring(false);
      setRecType('daily');
      setEveryN('2');
      setEveryUnit('days');
      setSaveLib(false);
      setAiMessages([]);
      setAiInput('');
      return;
    }
    if (!entry) return;
    setTab('edit');
    setName(entry.name);
    setTime(parseHHMMToDate(entry.time));
    setOpenPicker(null);
    setCalories(String(entry.calories));
    setProtein(String(entry.macros.protein));
    setCarbs(String(entry.macros.carbs));
    setFats(String(entry.macros.fats));
    setIngredients(ingredientsToForms(entry.ingredients));
    const rec = deriveRecurrenceState(sourceTemplate);
    setIsRecurring(rec.isRecurring);
    setRecType(rec.type);
    setEveryN(rec.everyN);
    setEveryUnit(rec.everyUnit);
    setSaveLib(false);
    setAiMessages([]);
    setAiInput('');
  }, [entry, visible, sourceTemplate, mode]);

  // ── Field handlers ────────────────────────────────────────────────────────
  function updateIngredient(id: string, key: keyof IngredientForm, value: string) {
    setIngredients(prev => prev.map(i => (i.id === id ? { ...i, [key]: value } : i)));
  }
  function addIngredientRow() {
    setIngredients(prev => [
      ...prev,
      { id: `f-${Date.now()}-${prev.length}`, name: '', quantity: '', unit: '' },
    ]);
  }
  function removeIngredientRow(id: string) {
    setIngredients(prev => {
      const next = prev.filter(i => i.id !== id);
      return next.length > 0 ? next : [{ id: `f-${Date.now()}`, name: '', quantity: '', unit: '' }];
    });
  }

  // Build the would-be next entry from current form state.
  function buildNextEntry(): MealEntry {
    if (!entry) {
      // Should never happen since save is guarded behind entry presence.
      throw new Error('No entry to edit');
    }
    return {
      id: entry.id,
      name: name.trim() || entry.name,
      time: formatDateToHHMM(time),
      calories: toIntSafe(calories),
      ingredients: formsToIngredients(ingredients, entry.id),
      macros: {
        protein: toIntSafe(protein),
        carbs: toIntSafe(carbs),
        fats: toIntSafe(fats),
      },
      status: entry.status,
    };
  }

  // ── Create flow ───────────────────────────────────────────────────────────
  function handleCreate() {
    const trimmedName = name.trim() || 'New meal';
    const cleanIngredients = formsToIngredients(ingredients, `tmp-${Date.now()}`);
    const macros = {
      protein: toIntSafe(protein),
      carbs: toIntSafe(carbs),
      fats: toIntSafe(fats),
    };
    const cals = toIntSafe(calories);
    const timeStr = formatDateToHHMM(time);

    let createdTemplateId: string | null = null;
    let entryId: string;

    if (isRecurring) {
      const tplId = `tpl-${Date.now()}`;
      createdTemplateId = tplId;
      entryId = `${date}-${tplId}`;
      const recRule = buildRecurrence(true, recType, everyN, everyUnit, date);
      const newTemplate: MealTemplate = {
        id: tplId,
        name: trimmedName,
        time: timeStr,
        calories: cals,
        ingredients: cleanIngredients,
        macros,
        recurrence: recRule,
      };
      addTemplate(newTemplate);
      const newEntry: MealEntry = {
        id: entryId,
        name: trimmedName,
        time: timeStr,
        calories: cals,
        ingredients: cleanIngredients,
        macros,
        status: 'pending',
        templateId: tplId,
        // User-initiated creation through Add Meal is ad-hoc relative to the
        // original plan, even when it carries recurrence. Stays permanent.
        isAdHoc: true,
      };
      addMealToDay(date, newEntry);
    } else {
      entryId = `${date}-custom-${Date.now()}`;
      const newEntry: MealEntry = {
        id: entryId,
        name: trimmedName,
        time: timeStr,
        calories: cals,
        ingredients: cleanIngredients,
        macros,
        status: 'pending',
        isAdHoc: true,
      };
      addMealToDay(date, newEntry);
    }

    let savedLibId: string | null = null;
    if (saveLib) {
      savedLibId = `lib-${Date.now()}`;
      saveToLibrary({
        id: savedLibId,
        name: trimmedName,
        calories: cals,
        ingredients: cleanIngredients,
        macros,
        usageCount: 0,
        lastUsed: toIsoDate(new Date()),
      });
    }

    // Surface any new ingredients into the Grocery → Planned section
    // (no-op if the ingredient is already in Kitchen or Cart).
    if (cleanIngredients.length > 0) {
      ingestMidWeekIngredients(
        cleanIngredients.map(ing => ({ name: ing.name, mealName: trimmedName }))
      );
    }

    showUndo({
      message: isRecurring
        ? `Added recurring "${trimmedName}"`
        : `Added "${trimmedName}"`,
      undo: () => {
        removeMealFromDay(date, entryId);
        if (createdTemplateId) removeTemplate(createdTemplateId);
        if (savedLibId) removeFromLibrary(savedLibId);
      },
    });

    onSaved?.();
    onClose();
  }

  // ── Save flow ─────────────────────────────────────────────────────────────
  function handleSave() {
    if (mode === 'create') {
      handleCreate();
      return;
    }
    if (!entry) return;

    // Only show the scope dialog when the meal was ALREADY recurring when this
    // edit session opened (wasAlreadyRecurring) AND the user kept it recurring.
    // If the user is setting recurrence for the first time, or turning it off,
    // skip the dialog and save directly.
    const wasAlreadyRecurring = wasAlreadyRecurringRef.current;
    const showScopeDialog = wasAlreadyRecurring && isRecurring;

    if (!showScopeDialog) {
      const previous = cloneEntry(entry);
      const next = buildNextEntry();
      editMealOnDay(date, next);
      const savedLibId = saveLib ? `lib-${Date.now()}` : null;
      if (savedLibId) {
        saveToLibrary({
          id: savedLibId,
          name: next.name,
          calories: next.calories,
          ingredients: next.ingredients,
          macros: next.macros,
          usageCount: 0,
          lastUsed: toIsoDate(new Date()),
        });
      }
      showUndo({
        message: 'Meal updated',
        undo: () => {
          editMealOnDay(date, previous);
          if (savedLibId) removeFromLibrary(savedLibId);
        },
      });
      onSaved?.();
      onClose();
      return;
    }

    // Meal was already recurring and user kept it recurring — ask scope.
    Alert.alert(
      'Update recurring meal',
      'Apply your changes to which occurrences?',
      [
        { text: 'This meal', onPress: () => saveScope('this') },
        { text: 'This and future', onPress: () => saveScope('future') },
        { text: 'All recurring', onPress: () => saveScope('all') },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }

  function saveScope(scope: 'this' | 'future' | 'all') {
    if (!entry || !sourceTemplate) return;
    const previousEntry = cloneEntry(entry);
    const previousTemplate = cloneTemplate(sourceTemplate);
    const next = buildNextEntry();

    if (scope === 'this') {
      // Exclude this date on the existing recurring template + add a one-off
      // template carrying the new values + update the day entry.
      const rec = previousTemplate.recurrence as Exclude<RecurrenceRule, { type: 'once' }>;
      const excluded: MealTemplate = {
        ...previousTemplate,
        recurrence: {
          ...rec,
          excludeDates: [...(rec.excludeDates ?? []), date],
        } as RecurrenceRule,
      };
      const oneOffId = `tpl-once-${Date.now()}`;
      const oneOff: MealTemplate = {
        id: oneOffId,
        name: next.name,
        time: next.time,
        calories: next.calories,
        ingredients: next.ingredients,
        macros: next.macros,
        recurrence: { type: 'once', date },
      };
      updateTemplate(excluded);
      addTemplate(oneOff);
      editMealOnDay(date, next);

      showUndo({
        message: 'Updated this meal',
        undo: () => {
          updateTemplate(previousTemplate);
          removeTemplate(oneOffId);
          editMealOnDay(date, previousEntry);
        },
      });
      onClose();
      return;
    }

    if (scope === 'future') {
      // End the current template the day before this one.
      // Build a new template starting from this date with the new values.
      const yesterday = shiftIso(date, -1);
      const rec = previousTemplate.recurrence as Exclude<RecurrenceRule, { type: 'once' }>;
      const cappedTemplate: MealTemplate = {
        ...previousTemplate,
        recurrence: { ...rec, untilDate: yesterday } as RecurrenceRule,
      };
      const newId = `tpl-${Date.now()}`;
      const newRule = buildRecurrence(
        isRecurring,
        recType,
        everyN,
        everyUnit,
        date,
        // Don't carry over untilDate/excludeDates from old rule — new schedule starts fresh.
        undefined,
      );
      const newTemplate: MealTemplate = {
        id: newId,
        name: next.name,
        time: next.time,
        calories: next.calories,
        ingredients: next.ingredients,
        macros: next.macros,
        recurrence: newRule,
      };
      updateTemplate(cappedTemplate);
      addTemplate(newTemplate);
      editMealOnDay(date, next);

      showUndo({
        message: 'Updated this and future',
        undo: () => {
          updateTemplate(previousTemplate);
          removeTemplate(newId);
          editMealOnDay(date, previousEntry);
        },
      });
      onClose();
      return;
    }

    // scope === 'all'
    // Update the template itself + every materialized entry across all logs
    // that came from this template.
    const newRuleAll = buildRecurrence(
      isRecurring,
      recType,
      everyN,
      everyUnit,
      date,
      previousTemplate.recurrence,
    );
    const updatedTemplate: MealTemplate = {
      ...previousTemplate,
      name: next.name,
      time: next.time,
      calories: next.calories,
      ingredients: next.ingredients,
      macros: next.macros,
      recurrence: newRuleAll,
    };

    // Snapshot every existing entry that came from this template so undo can
    // restore them exactly.
    const allLogs = useMealStore.getState().logs;
    const affected: { date: string; previous: MealEntry; nextEntry: MealEntry }[] = [];
    Object.values(allLogs).forEach(log => {
      log.meals.forEach(m => {
        if (m.id === `${log.date}-${previousTemplate.id}`) {
          const replaced: MealEntry = {
            id: m.id,
            name: next.name,
            time: next.time,
            calories: next.calories,
            ingredients: next.ingredients,
            macros: next.macros,
            status: m.status,
          };
          affected.push({ date: log.date, previous: cloneEntry(m), nextEntry: replaced });
        }
      });
    });

    updateTemplate(updatedTemplate);
    affected.forEach(a => editMealOnDay(a.date, a.nextEntry));

    showUndo({
      message: 'Updated all recurring',
      undo: () => {
        updateTemplate(previousTemplate);
        affected.forEach(a => editMealOnDay(a.date, a.previous));
      },
    });
    onClose();
  }

  // ── AI Adjust (shell) ─────────────────────────────────────────────────────
  function sendAiMessage() {
    const text = aiInput.trim();
    if (!text) return;
    setAiMessages(prev => [
      ...prev,
      { role: 'user', content: text },
      {
        role: 'assistant',
        content:
          "AI adjustment is coming soon — once connected I'll pre-fill the fields based on your description and let you confirm before saving.",
      },
    ]);
    setAiInput('');
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!entry && mode === 'edit') {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        <View style={styles.full} />
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.full, { paddingTop: insets.top }]}>
        <KeyboardAvoidingView
          style={styles.full}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.headerCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{mode === 'create' ? 'New meal' : 'Edit meal'}</Text>
            <TouchableOpacity onPress={handleSave} hitSlop={12}>
              <Text style={styles.headerSave}>Save</Text>
            </TouchableOpacity>
          </View>

          {/* Tab switcher */}
          <View style={styles.tabSwitcher}>
            <TabPill label="Edit" active={tab === 'edit'} onPress={() => setTab('edit')} />
            <TabPill label="AI Adjust" active={tab === 'ai'} onPress={() => setTab('ai')} />
          </View>

          {tab === 'edit' ? (
            <ScrollView
              contentContainerStyle={[styles.body, { paddingBottom: 32 + insets.bottom }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Basics */}
              <Section title="Basics">
                <Label text="Name" />
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Chicken stir-fry"
                  placeholderTextColor={COLORS.textMuted}
                />

                {/* When — Date | Time pills (Google Calendar pattern) */}
                <Label text="When" />
                <View style={styles.whenRow}>
                  <View style={styles.whenPillStatic}>
                    <Text style={styles.whenPillLabel}>Date</Text>
                    <Text style={styles.whenPillValue}>{formatDayPill(date)}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.whenPill, openPicker === 'time' && styles.whenPillActive]}
                    onPress={() => setOpenPicker(openPicker === 'time' ? null : 'time')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.whenPillLabel}>Time</Text>
                    <Text
                      style={[
                        styles.whenPillValue,
                        openPicker === 'time' && styles.whenPillValueActive,
                      ]}
                    >
                      {formatTimeLabel(time)}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Inline expansion area */}
                {openPicker === 'time' && (
                  Platform.OS === 'ios' ? (
                    <View style={styles.timeWrap}>
                      <DateTimePicker
                        value={time}
                        mode="time"
                        display="spinner"
                        onChange={(_, d) => d && setTime(d)}
                        themeVariant="dark"
                        style={styles.timePicker}
                      />
                    </View>
                  ) : (
                    <View style={styles.timeWrap}>
                      <DateTimePicker
                        value={time}
                        mode="time"
                        is24Hour
                        display="default"
                        onChange={(_, d) => {
                          if (d) setTime(d);
                        }}
                      />
                    </View>
                  )
                )}

                <Label text="Calories" />
                <TextInput
                  style={styles.input}
                  value={calories}
                  onChangeText={setCalories}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.textMuted}
                />
              </Section>

              {/* Macros */}
              <Section title="Macros (g)">
                <View style={styles.row3}>
                  <View style={styles.col}>
                    <Label text="Protein" />
                    <TextInput
                      style={styles.input}
                      value={protein}
                      onChangeText={setProtein}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                  <View style={styles.col}>
                    <Label text="Carbs" />
                    <TextInput
                      style={styles.input}
                      value={carbs}
                      onChangeText={setCarbs}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                  <View style={styles.col}>
                    <Label text="Fats" />
                    <TextInput
                      style={styles.input}
                      value={fats}
                      onChangeText={setFats}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                </View>
              </Section>

              {/* Ingredients */}
              <Section title="Ingredients">
                {ingredients.map(ing => (
                  <View key={ing.id} style={styles.ingCard}>
                    <TextInput
                      style={styles.input}
                      value={ing.name}
                      onChangeText={v => updateIngredient(ing.id, 'name', v)}
                      placeholder="Ingredient name"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <View style={styles.ingRow}>
                      <TextInput
                        style={[styles.input, styles.qtyInput]}
                        value={ing.quantity}
                        onChangeText={v => updateIngredient(ing.id, 'quantity', v)}
                        keyboardType="numeric"
                        placeholder="Qty"
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <TextInput
                        style={[styles.input, styles.unitInput]}
                        value={ing.unit}
                        onChangeText={v => updateIngredient(ing.id, 'unit', v)}
                        placeholder="Unit"
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <TouchableOpacity
                        style={styles.removeIngBtn}
                        onPress={() => removeIngredientRow(ing.id)}
                      >
                        <Text style={styles.removeIngText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <TouchableOpacity style={styles.addIngBtn} onPress={addIngredientRow}>
                  <Text style={styles.addIngText}>+ Add ingredient</Text>
                </TouchableOpacity>
              </Section>

              {/* Recurrence */}
              <Section title="Recurrence">
                <View style={styles.recurringRow}>
                  <Text style={styles.recurringLabel}>Repeat this meal</Text>
                  <Switch
                    value={isRecurring}
                    onValueChange={setIsRecurring}
                    trackColor={{ true: COLORS.green, false: COLORS.elevated }}
                    thumbColor={isRecurring ? '#0E1A12' : '#cfcfd2'}
                  />
                </View>

                {isRecurring && (
                  <>
                    <View style={styles.segmented}>
                      {(['daily', 'weekly', 'every'] as RecType[]).map(t => (
                        <TouchableOpacity
                          key={t}
                          style={[styles.segment, recType === t && styles.segmentActive]}
                          onPress={() => setRecType(t)}
                        >
                          <Text
                            style={[
                              styles.segmentText,
                              recType === t && styles.segmentTextActive,
                            ]}
                          >
                            {t === 'daily' ? 'Daily' : t === 'weekly' ? 'Weekly' : 'Every…'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {recType === 'every' && (
                      <View style={styles.everyRow}>
                        <Text style={styles.everyLabel}>Every</Text>
                        <TextInput
                          style={[styles.input, styles.everyInput]}
                          value={everyN}
                          onChangeText={setEveryN}
                          keyboardType="number-pad"
                        />
                        <View style={styles.unitToggle}>
                          {(['days', 'weeks'] as EveryUnit[]).map(u => (
                            <TouchableOpacity
                              key={u}
                              style={[styles.unitBtn, everyUnit === u && styles.unitBtnActive]}
                              onPress={() => setEveryUnit(u)}
                            >
                              <Text
                                style={[
                                  styles.unitBtnText,
                                  everyUnit === u && styles.unitBtnTextActive,
                                ]}
                              >
                                {u}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}

                    {sourceTemplate && (
                      <Text style={styles.recurringHint}>
                        This meal repeats — saving will let you choose to update only this day,
                        this and future days, or all instances.
                      </Text>
                    )}
                  </>
                )}
              </Section>

              {/* Save to Library */}
              <Section title="Save options">
                <View style={styles.recurringRow}>
                  <Text style={styles.recurringLabel}>Save to library</Text>
                  <Switch
                    value={saveLib}
                    onValueChange={setSaveLib}
                    trackColor={{ true: COLORS.green, false: COLORS.elevated }}
                    thumbColor={saveLib ? '#0E1A12' : '#cfcfd2'}
                  />
                </View>
                <Text style={styles.recurringHint}>
                  Keeps a copy in your library for quick reuse later.
                </Text>
              </Section>
            </ScrollView>
          ) : (
            <View style={styles.aiPane}>
              <ScrollView
                contentContainerStyle={styles.aiMessages}
                keyboardShouldPersistTaps="handled"
              >
                {aiMessages.length === 0 ? (
                  <View style={styles.aiEmpty}>
                    <Text style={styles.aiEmptyTitle}>Describe your changes</Text>
                    <Text style={styles.aiEmptySub}>
                      Tell the assistant what to adjust — e.g. &quot;swap the rice for quinoa&quot;
                      or &quot;double the portion&quot;. AI will pre-fill the fields and you confirm
                      before anything is saved.
                    </Text>
                    <Text style={styles.aiEmptyShellNote}>Shell only — real AI wiring coming soon.</Text>
                  </View>
                ) : (
                  aiMessages.map((m, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.aiBubbleRow,
                        m.role === 'user' ? styles.aiBubbleRight : styles.aiBubbleLeft,
                      ]}
                    >
                      <View
                        style={[
                          styles.aiBubble,
                          m.role === 'user' ? styles.aiBubbleUser : styles.aiBubbleAi,
                        ]}
                      >
                        <Text
                          style={[
                            styles.aiBubbleText,
                            m.role === 'user' ? styles.aiBubbleTextUser : styles.aiBubbleTextAi,
                          ]}
                        >
                          {m.content}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>

              <View style={[styles.aiInputBar, { paddingBottom: 8 + insets.bottom }]}>
                <TouchableOpacity style={styles.aiIconBtn} disabled>
                  <Text style={styles.aiIconText}>🖼️</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.aiInput}
                  value={aiInput}
                  onChangeText={setAiInput}
                  placeholder="Describe an adjustment…"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                />
                <TouchableOpacity style={styles.aiIconBtn} disabled>
                  <Text style={styles.aiIconText}>🎙️</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.aiSendBtn, !aiInput.trim() && styles.aiSendBtnDisabled]}
                  onPress={sendAiMessage}
                  disabled={!aiInput.trim()}
                >
                  <Text style={styles.aiSendBtnText}>↑</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TabPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.tabPill, active && styles.tabPillActive]}
      onPress={onPress}
    >
      <Text style={[styles.tabPillText, active && styles.tabPillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Label({ text }: { text: string }) {
  return <Text style={styles.label}>{text}</Text>;
}

// Silence unused-import lint when applicable date helper isn't called here directly.
void isTemplateApplicableOnDate;

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerCancel: { color: COLORS.textSecondary, fontSize: 15 },
  headerSave: { color: COLORS.green, fontSize: 15, fontWeight: '700' },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },

  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    margin: 12,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  tabPill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabPillActive: { backgroundColor: COLORS.green },
  tabPillText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  tabPillTextActive: { color: '#0E1A12', fontWeight: '700' },

  body: { padding: 16, paddingBottom: 32, gap: 6 },

  section: { gap: 8, marginBottom: 18 },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  label: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
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

  whenRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  whenPill: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  whenPillStatic: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    opacity: 0.85,
  },
  whenPillActive: {
    borderColor: COLORS.green,
    backgroundColor: COLORS.green + '1F',
  },
  whenPillLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  whenPillValue: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  whenPillValueActive: { color: COLORS.green },

  timeWrap: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    alignItems: 'center',
    marginTop: 8,
  },
  timePicker: { width: '100%' },

  row3: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },

  ingCard: {
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    padding: 10,
    gap: 8,
    marginBottom: 8,
  },
  ingRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  qtyInput: { flex: 1 },
  unitInput: { flex: 1 },
  removeIngBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  removeIngText: { color: COLORS.red, fontSize: 12, fontWeight: '600' },
  addIngBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  addIngText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  recurringRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  recurringLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    padding: 3,
    gap: 3,
    marginTop: 6,
  },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: COLORS.green },
  segmentText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  segmentTextActive: { color: '#0E1A12', fontWeight: '700' },

  everyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  everyLabel: { color: COLORS.text, fontSize: 14 },
  everyInput: { width: 70 },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.elevated,
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  unitBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  unitBtnActive: { backgroundColor: COLORS.green },
  unitBtnText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  unitBtnTextActive: { color: '#0E1A12', fontWeight: '700' },
  recurringHint: { color: COLORS.textMuted, fontSize: 11, marginTop: 8, lineHeight: 16 },

  aiPane: { flex: 1 },
  aiMessages: { padding: 14, gap: 8, flexGrow: 1 },
  aiEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    gap: 8,
  },
  aiEmptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  aiEmptySub: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  aiEmptyShellNote: { color: COLORS.textMuted, fontSize: 11, marginTop: 14, textAlign: 'center' },
  aiBubbleRow: { flexDirection: 'row' },
  aiBubbleLeft: { justifyContent: 'flex-start' },
  aiBubbleRight: { justifyContent: 'flex-end' },
  aiBubble: { maxWidth: '82%', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14 },
  aiBubbleAi: { backgroundColor: COLORS.card, borderTopLeftRadius: 4 },
  aiBubbleUser: { backgroundColor: COLORS.green, borderTopRightRadius: 4 },
  aiBubbleText: { fontSize: 14, lineHeight: 20 },
  aiBubbleTextAi: { color: COLORS.text },
  aiBubbleTextUser: { color: '#0E1A12' },

  aiInputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  aiIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  aiIconText: { fontSize: 18 },
  aiInput: {
    flex: 1,
    color: COLORS.text,
    backgroundColor: COLORS.card,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    maxHeight: 110,
  },
  aiSendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiSendBtnDisabled: { backgroundColor: COLORS.elevated },
  aiSendBtnText: { color: '#0E1A12', fontSize: 18, fontWeight: '700' },
});
