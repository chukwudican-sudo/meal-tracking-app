import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '@/constants/theme';
import { toIsoDate, useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { Ingredient, MealTemplate, RecurrenceRule } from '@/store/types';
import { DayDetailModal } from '@/components/DayDetailModal';
import { AddMealScreen } from '@/components/addMeal/AddMealScreen';
import { CartIcon } from '@/components/CartIcon';
import { ProfileIcon } from '@/components/ProfileIcon';
import { PlannedIngredientsSection } from '@/components/grocery/PlannedIngredientsSection';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_START_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type ScopeChoice = 'this' | 'future' | 'all' | 'cancel';

function toMidnight(iso: string): Date {
  return new Date(iso + 'T00:00:00');
}

function shiftIso(iso: string, offsetDays: number): string {
  const d = toMidnight(iso);
  d.setDate(d.getDate() + offsetDays);
  return toIsoDate(d);
}

function mondayOfWeek(iso: string): string {
  const d = toMidnight(iso);
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return toIsoDate(d);
}

function parseLinesToIngredients(value: string): Ingredient[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((name, idx) => ({
      id: `ing-${idx + 1}-${Date.now()}`,
      name,
      quantity: 1,
      unit: '',
    }));
}

function parseNonNegativeInt(value: string): number | null {
  const num = Number(value.trim());
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
}

// Returns 6 rows × 7 cols (Mon–Sun) for the month containing anchorIso.
// Each row also carries its Monday ISO so we can match it to the selected week.
function monthGridRows(anchorIso: string): { weekStartIso: string; cells: (string | null)[] }[] {
  const d = toMidnight(anchorIso);
  d.setDate(1);
  const startDow = d.getDay();
  const monOffset = startDow === 0 ? 6 : startDow - 1;
  const start = new Date(d);
  start.setDate(d.getDate() - monOffset);

  return Array.from({ length: 6 }, (_, row) => {
    const monday = new Date(start);
    monday.setDate(start.getDate() + row * 7);
    const cells: (string | null)[] = Array.from({ length: 7 }, (__, col) => {
      const cell = new Date(monday);
      cell.setDate(monday.getDate() + col);
      return cell.getMonth() === d.getMonth() ? toIsoDate(cell) : null;
    });
    return { weekStartIso: toIsoDate(monday), cells };
  });
}

// Navigate by exactly one calendar month (handles month-length differences correctly)
function shiftMonth(iso: string, months: number): string {
  const d = toMidnight(iso);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return toIsoDate(d);
}


function chooseScope(title: string): Promise<ScopeChoice> {
  return new Promise(resolve => {
    Alert.alert(title, 'Apply changes to which occurrences?', [
      { text: 'This one', onPress: () => resolve('this') },
      { text: 'This + future', onPress: () => resolve('future') },
      { text: 'All', onPress: () => resolve('all') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
    ]);
  });
}

export default function PlanScreen() {
  const templates = useMealStore(s => s.templates);
  const logs = useMealStore(s => s.logs);
  const addTemplate = useMealStore(s => s.addTemplate);
  const updateTemplate = useMealStore(s => s.updateTemplate);
  const removeTemplate = useMealStore(s => s.removeTemplate);
  const showUndo = useUndoStore(s => s.showUndo);

  const todayIso = toIsoDate(new Date());
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [miniMonthAnchor, setMiniMonthAnchor] = useState(todayIso);
  const [editingTemplate, setEditingTemplate] = useState<MealTemplate | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [timePromptForTemplateId, setTimePromptForTemplateId] = useState<string | null>(null);
  const [timePromptValue, setTimePromptValue] = useState('12:00');
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);
  const [headerAddVisible, setHeaderAddVisible] = useState(false);

  const [name, setName] = useState('');
  const [time, setTime] = useState('12:00');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fats, setFats] = useState('');
  const [ingredientsText, setIngredientsText] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceRule['type']>('daily');
  const [onceDate, setOnceDate] = useState(todayIso);
  const [weeklyDays, setWeeklyDays] = useState<number[]>([1]);
  const [everyDays, setEveryDays] = useState('2');
  const [everyWeeks, setEveryWeeks] = useState('2');
  const [monthlyEvery, setMonthlyEvery] = useState('1');
  const [formError, setFormError] = useState<string | null>(null);

  const weekStartIso = mondayOfWeek(selectedDate);
  const weekDates = Array.from({ length: 7 }, (_, i) => shiftIso(weekStartIso, i));

  const getDayProgress = useCallback((iso: string) => {
    const dayMeals = logs[iso]?.meals ?? [];
    const planned = dayMeals.length;
    const completed = dayMeals.filter(m => m.status === 'completed').length;
    const pct = planned === 0 ? 0 : Math.round((completed / planned) * 100);
    return { planned, completed, pct };
  }, [logs]);

  const openCreateTemplate = (forDate: string) => {
    setEditingTemplate(null);
    setName('');
    setTime('12:00');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFats('');
    setIngredientsText('');
    setRecurrenceType('daily');
    setOnceDate(forDate);
    setWeeklyDays([new Date(forDate + 'T00:00:00').getDay()]);
    setEveryDays('2');
    setEveryWeeks('2');
    setMonthlyEvery('1');
    setFormError(null);
    setModalVisible(true);
  };

  const buildRecurrence = (baseDate: string): RecurrenceRule | null => {
    if (recurrenceType === 'once') return { type: 'once', date: onceDate };
    if (recurrenceType === 'daily') {
      const every = parseNonNegativeInt(everyDays);
      if (every === null || every < 1) return null;
      return { type: 'daily', every, startDate: baseDate };
    }
    if (recurrenceType === 'weekly') {
      const every = parseNonNegativeInt(everyWeeks);
      if (every === null || every < 1 || weeklyDays.length === 0) return null;
      return { type: 'weekly', days: weeklyDays.sort((a, b) => a - b), every, startDate: baseDate };
    }
    if (recurrenceType === 'monthly') {
      const every = parseNonNegativeInt(monthlyEvery);
      if (every === null || every < 1) return null;
      const day = toMidnight(baseDate).getDate();
      return { type: 'monthly', day, every, startDate: baseDate };
    }
    return null;
  };

  const validateTemplate = (baseDate: string) => {
    const cals = parseNonNegativeInt(calories);
    const p = parseNonNegativeInt(protein);
    const c = parseNonNegativeInt(carbs);
    const f = parseNonNegativeInt(fats);
    const ing = parseLinesToIngredients(ingredientsText);
    if (!name.trim() || !time.trim()) return { ok: false as const, reason: 'Name and time are required.' };
    if (cals === null || p === null || c === null || f === null) return { ok: false as const, reason: 'Calories/macros must be whole numbers >= 0.' };
    if (ing.length === 0) return { ok: false as const, reason: 'At least one ingredient is required.' };
    const recurrence = buildRecurrence(baseDate);
    if (!recurrence) return { ok: false as const, reason: 'Recurrence is invalid.' };
    return { ok: true as const, cals, p, c, f, ing, recurrence };
  };

  const applyTemplateSave = async () => {
    const baseDate = selectedDate;
    const valid = validateTemplate(baseDate);
    if (!valid.ok) {
      setFormError(valid.reason);
      return;
    }
    setFormError(null);

    const nextTemplate: MealTemplate = {
      id: editingTemplate?.id ?? `tpl-${Date.now()}`,
      name: name.trim(),
      time: time.trim(),
      calories: valid.cals,
      ingredients: valid.ing,
      macros: { protein: valid.p, carbs: valid.c, fats: valid.f },
      recurrence: valid.recurrence,
    };

    if (!editingTemplate) {
      addTemplate(nextTemplate);
      showUndo({ message: 'Template created', undo: () => removeTemplate(nextTemplate.id) });
      setModalVisible(false);
      return;
    }

    const previous = editingTemplate;
    let scope: ScopeChoice = 'all';
    if (editingTemplate.recurrence.type !== 'once') scope = await chooseScope('Update recurring template');
    if (scope === 'cancel') return;

    if (scope === 'all') {
      updateTemplate(nextTemplate);
      showUndo({ message: 'Template updated', undo: () => updateTemplate(previous) });
    } else if (scope === 'future') {
      const updated: MealTemplate = {
        ...nextTemplate,
        recurrence:
          nextTemplate.recurrence.type === 'once'
            ? { type: 'once', date: selectedDate }
            : { ...nextTemplate.recurrence, startDate: selectedDate },
      };
      updateTemplate(updated);
      showUndo({ message: 'Template updated (future)', undo: () => updateTemplate(previous) });
    } else {
      const recurring = previous.recurrence.type === 'once' ? null : previous.recurrence;
      if (recurring) {
        updateTemplate({
          ...previous,
          recurrence: {
            ...recurring,
            excludeDates: [...(recurring.excludeDates ?? []), selectedDate],
          } as RecurrenceRule,
        });
      }
      const oneOff: MealTemplate = {
        ...nextTemplate,
        id: `tpl-once-${Date.now()}`,
        recurrence: { type: 'once', date: selectedDate },
      };
      addTemplate(oneOff);
      showUndo({
        message: 'Template updated (this occurrence)',
        undo: () => {
          removeTemplate(oneOff.id);
          updateTemplate(previous);
        },
      });
    }

    setModalVisible(false);
  };

  const applyReorderTime = () => {
    if (!timePromptForTemplateId) return;
    const template = templates.find(t => t.id === timePromptForTemplateId);
    if (!template) return;
    const previous = template;
    const updated = { ...template, time: timePromptValue.trim() || template.time };
    updateTemplate(updated);
    showUndo({ message: 'Order adjusted', undo: () => updateTemplate(previous) });
    setTimePromptForTemplateId(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Plan</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => openCreateTemplate(selectedDate)}>
              <Text style={styles.headerBtnText}>+ Add</Text>
            </TouchableOpacity>
            <ProfileIcon />
            <CartIcon />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Mini month</Text>
            <Text style={styles.muted}>{toMidnight(miniMonthAnchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
          </View>
          <View style={styles.monthNavRow}>
            <TouchableOpacity onPress={() => setMiniMonthAnchor(shiftMonth(miniMonthAnchor, -1))}>
              <Text style={styles.yearNav}>←</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMiniMonthAnchor(shiftMonth(miniMonthAnchor, 1))}>
              <Text style={styles.yearNav}>→</Text>
            </TouchableOpacity>
          </View>
          {/* Day-of-week header — flex:1 per cell guarantees alignment with grid */}
          <View style={styles.miniWeekLabels}>
            {WEEK_START_MON.map(d => (
              <Text key={d} style={styles.miniWeekLabel}>{d[0]}</Text>
            ))}
          </View>
          <View style={styles.monthGrid}>
            {monthGridRows(miniMonthAnchor).map((row, rowIdx) => {
              const rowIsSelectedWeek = row.weekStartIso === weekStartIso;
              return (
                <View key={rowIdx} style={[styles.miniRow, rowIsSelectedWeek && styles.miniRowWeek]}>
                  {row.cells.map((iso, colIdx) => (
                    <Pressable
                      key={`${iso ?? 'nil'}-${rowIdx}-${colIdx}`}
                      onPress={() => {
                        if (!iso) return;
                        setSelectedDate(iso);
                      }}
                      style={[
                        styles.monthCell,
                        iso === selectedDate && styles.monthCellSelected,
                      ]}
                    >
                      <Text style={[
                        styles.monthCellText,
                        !iso && styles.monthCellHiddenText,
                        iso === selectedDate && styles.monthCellTextSelected,
                      ]}>
                        {iso ? toMidnight(iso).getDate() : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Week schedule</Text>
            <TouchableOpacity style={styles.dayAddBtn} onPress={() => setHeaderAddVisible(true)}>
              <Text style={styles.dayAddText}>+ Day meal</Text>
            </TouchableOpacity>
          </View>

          {weekDates.map(iso => {
            const progress = getDayProgress(iso);
            return (
              <View key={iso} style={styles.dayCard}>
                <TouchableOpacity
                  onPress={() => {
                    setSelectedDate(iso);
                    setDayDetailDate(iso);
                  }}
                  style={styles.dayHeader}
                  activeOpacity={0.8}
                >
                  <View>
                    <Text style={styles.dayTitle}>
                      {toMidnight(iso).toLocaleDateString('en-US', { weekday: 'short' })} {toMidnight(iso).getDate()}
                    </Text>
                    <Text style={styles.dayMeta}>{progress.planned} planned</Text>
                  </View>
                  <Text style={styles.dayPct}>{progress.pct}%</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        <PlannedIngredientsSection />
      </ScrollView>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingTemplate ? 'Edit template' : 'Add template'}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={COLORS.textMuted} style={styles.input} />
              <TextInput value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={COLORS.textMuted} style={styles.input} />
              <TextInput value={calories} onChangeText={setCalories} keyboardType="number-pad" placeholder="Calories" placeholderTextColor={COLORS.textMuted} style={styles.input} />
              <View style={styles.macroInputs}>
                <TextInput value={protein} onChangeText={setProtein} keyboardType="number-pad" placeholder="P" placeholderTextColor={COLORS.textMuted} style={[styles.input, styles.macroInput]} />
                <TextInput value={carbs} onChangeText={setCarbs} keyboardType="number-pad" placeholder="C" placeholderTextColor={COLORS.textMuted} style={[styles.input, styles.macroInput]} />
                <TextInput value={fats} onChangeText={setFats} keyboardType="number-pad" placeholder="F" placeholderTextColor={COLORS.textMuted} style={[styles.input, styles.macroInput]} />
              </View>
              <TextInput
                value={ingredientsText}
                onChangeText={setIngredientsText}
                placeholder="Ingredients (one per line)"
                placeholderTextColor={COLORS.textMuted}
                style={[styles.input, styles.textArea]}
                multiline
              />
              <Text style={styles.muted}>Recurrence</Text>
              <View style={styles.recurrenceRow}>
                {(['once', 'daily', 'weekly', 'monthly'] as const).map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.recChip, recurrenceType === type && styles.recChipActive]}
                    onPress={() => setRecurrenceType(type)}
                  >
                    <Text style={[styles.recChipText, recurrenceType === type && styles.recChipTextActive]}>{type}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {recurrenceType === 'once' && (
                <TextInput value={onceDate} onChangeText={setOnceDate} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.textMuted} style={styles.input} />
              )}
              {recurrenceType === 'weekly' && (
                <>
                  <TextInput value={everyWeeks} onChangeText={setEveryWeeks} keyboardType="number-pad" placeholder="Every X weeks" placeholderTextColor={COLORS.textMuted} style={styles.input} />
                  <View style={styles.weekdayRow}>
                    {SHORT_DAYS.map((d, idx) => (
                      <TouchableOpacity
                        key={d}
                        style={[styles.weekdayChip, weeklyDays.includes(idx) && styles.weekdayChipActive]}
                        onPress={() =>
                          setWeeklyDays(prev =>
                            prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx]
                          )
                        }
                      >
                        <Text style={[styles.weekdayText, weeklyDays.includes(idx) && styles.weekdayTextActive]}>{d[0]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {recurrenceType === 'daily' && (
                <TextInput value={everyDays} onChangeText={setEveryDays} keyboardType="number-pad" placeholder="Every X days" placeholderTextColor={COLORS.textMuted} style={styles.input} />
              )}
              {recurrenceType === 'monthly' && (
                <TextInput value={monthlyEvery} onChangeText={setMonthlyEvery} keyboardType="number-pad" placeholder="Every X months" placeholderTextColor={COLORS.textMuted} style={styles.input} />
              )}
              {formError && <Text style={styles.error}>{formError}</Text>}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={applyTemplateSave}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!timePromptForTemplateId} transparent animationType="fade" onRequestClose={() => setTimePromptForTemplateId(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.timeModal}>
            <Text style={styles.modalTitle}>Set new time</Text>
            <TextInput value={timePromptValue} onChangeText={setTimePromptValue} placeholder="HH:MM" placeholderTextColor={COLORS.textMuted} style={styles.input} />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setTimePromptForTemplateId(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={applyReorderTime}>
                <Text style={styles.saveText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <DayDetailModal date={dayDetailDate} onClose={() => setDayDetailDate(null)} />
      <AddMealScreen visible={headerAddVisible} date={todayIso} onClose={() => setHeaderAddVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 14, paddingBottom: 34, gap: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  headerBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  headerBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  sectionCard: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12, marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  muted: { color: COLORS.textSecondary, fontSize: 12 },
  yearNav: { color: COLORS.text, fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
  monthNavRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginBottom: 8 },
  miniWeekLabels: { flexDirection: 'row', marginBottom: 4 },
  miniWeekLabel: { flex: 1, color: COLORS.textSecondary, fontSize: 10, textAlign: 'center' },
  monthGrid: { gap: 2 },
  miniRow: { flexDirection: 'row', borderRadius: 13, overflow: 'hidden' },
  miniRowWeek: { backgroundColor: COLORS.green + '20' },
  monthCell: { flex: 1, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  monthCellSelected: { backgroundColor: COLORS.green + '44' },
  monthCellHiddenText: { color: 'transparent' },
  monthCellText: { color: COLORS.textSecondary, fontSize: 12 },
  monthCellTextSelected: { color: COLORS.green, fontWeight: '700' },
  dayAddBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
  dayAddText: { color: COLORS.text, fontSize: 11, fontWeight: '600' },
  dayCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
  dayHeader: { padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayTitle: { color: COLORS.text, fontWeight: '600', fontSize: 13 },
  dayMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  dayPct: { color: COLORS.green, fontWeight: '700', fontSize: 13 },
  dayList: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: 10, gap: 8 },
  templateRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  templateName: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  templateMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  templateActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  inlineAddBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  inlineAddText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12 },
  timeModal: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12 },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: { backgroundColor: COLORS.elevated, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, color: COLORS.text, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 8, fontSize: 13 },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  macroInputs: { flexDirection: 'row', gap: 8 },
  macroInput: { flex: 1 },
  recurrenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  recChip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  recChipActive: { borderColor: COLORS.green, backgroundColor: COLORS.green + '1F' },
  recChipText: { color: COLORS.textSecondary, fontSize: 11 },
  recChipTextActive: { color: COLORS.green, fontWeight: '600' },
  weekdayRow: { flexDirection: 'row', gap: 5, marginBottom: 8, flexWrap: 'wrap' },
  weekdayChip: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  weekdayChipActive: { borderColor: COLORS.green, backgroundColor: COLORS.green + '22' },
  weekdayText: { color: COLORS.textSecondary, fontSize: 10 },
  weekdayTextActive: { color: COLORS.green, fontWeight: '700' },
  error: { color: COLORS.red, fontSize: 12, marginBottom: 6 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  saveBtn: { flex: 1.2, backgroundColor: COLORS.green, borderRadius: 8, alignItems: 'center', paddingVertical: 10 },
  saveText: { color: '#0E1A12', fontSize: 12, fontWeight: '700' },
});
