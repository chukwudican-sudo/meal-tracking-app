import { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { MealEntry } from '@/store/types';

import { AddMealScreen } from './addMeal/AddMealScreen';
import { EditMealScreen } from './EditMealScreen';

// Stable empty-array reference so selectors below never produce a fresh
// snapshot on every render (which would trip useSyncExternalStore into an
// infinite update loop).
const EMPTY_MEALS: MealEntry[] = [];

interface Props {
  date: string | null;
  onClose: () => void;
}

export function DayDetailModal({ date, onClose }: Props) {
  const visible = date !== null;

  const goals = useMealStore(s => s.goals);
  const storedMeals = useMealStore(s => (date ? s.logs[date]?.meals : undefined));
  const meals = storedMeals ?? EMPTY_MEALS;
  const removeMealFromDay = useMealStore(s => s.removeMealFromDay);
  const restoreMealToDay = useMealStore(s => s.restoreMealToDay);
  const showUndo = useUndoStore(s => s.showUndo);

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<MealEntry | null>(null);

  const totals = useMemo(() => {
    return meals.reduce(
      (acc, m) => ({
        kcal: acc.kcal + m.calories,
        p: acc.p + (m.macros?.protein ?? 0),
        c: acc.c + (m.macros?.carbs ?? 0),
        f: acc.f + (m.macros?.fats ?? 0),
      }),
      { kcal: 0, p: 0, c: 0, f: 0 },
    );
  }, [meals]);

  const calorieRatio = goals.dailyCalories > 0 ? Math.min(1, totals.kcal / goals.dailyCalories) : 0;

  function handleDelete(entry: MealEntry, index: number) {
    if (!date) return;
    removeMealFromDay(date, entry.id);
    showUndo({
      message: `Removed "${entry.name}"`,
      undo: () => restoreMealToDay(date, entry, index),
    });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={45} tint="dark" style={StyleSheet.absoluteFill} />
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.popup} onPress={() => {}}>
          <SafeAreaView style={styles.popupInner} edges={[]}>
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dateTitle}>{date ? formatDateLong(date) : ''}</Text>
                <Text style={styles.dateSub}>{date ? formatDateRel(date) : ''}</Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              {/* Nutrition summary */}
              <View style={styles.summarySection}>
                <View style={styles.kcalRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kcalLabel}>Calories</Text>
                    <Text style={styles.kcalBig}>
                      {Math.round(totals.kcal)}
                      <Text style={styles.kcalGoal}>  / {goals.dailyCalories}</Text>
                    </Text>
                  </View>
                  <View style={styles.kcalPctWrap}>
                    <Text style={styles.kcalPct}>{Math.round(calorieRatio * 100)}%</Text>
                    <Text style={styles.kcalPctSub}>of goal</Text>
                  </View>
                </View>
                <View style={styles.kcalTrack}>
                  <View style={[styles.kcalFill, { width: `${Math.round(calorieRatio * 100)}%` }]} />
                </View>
                <View style={styles.macroBars}>
                  <MacroBar label="Protein" value={totals.p} goal={goals.protein} color={COLORS.green} />
                  <MacroBar label="Carbs"   value={totals.c} goal={goals.carbs}   color={COLORS.blue} />
                  <MacroBar label="Fats"    value={totals.f} goal={goals.fats}    color={COLORS.orange} />
                </View>
              </View>

              {/* Meals */}
              {meals.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyTitle}>No meals added yet</Text>
                  <Text style={styles.emptySub}>Tap + Add meal to get started</Text>
                </View>
              ) : (
                <View style={styles.mealList}>
                  {meals.map((m, idx) => (
                    <MealRow
                      key={m.id}
                      entry={m}
                      onPress={() => setEditing(m)}
                      onDelete={() => handleDelete(m, idx)}
                    />
                  ))}
                </View>
              )}
            </ScrollView>

            {/* + Add meal */}
            <View style={styles.footer}>
              <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
                <Text style={styles.addBtnText}>+  Add meal</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>

      {/* Add meal flow */}
      {date && (
        <AddMealScreen visible={showAdd} date={date} onClose={() => setShowAdd(false)} />
      )}

      {/* Edit existing meal — full-screen EditMealScreen */}
      {date && (
        <EditMealScreen
          visible={!!editing}
          date={date}
          entry={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Modal>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function MacroBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  const ratio = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <View style={macroStyles.row}>
      <View style={macroStyles.labelRow}>
        <Text style={macroStyles.label}>{label}</Text>
        <Text style={macroStyles.values}>
          <Text style={{ color: COLORS.text }}>{Math.round(value)}</Text>
          <Text style={macroStyles.goal}> / {goal} g</Text>
        </Text>
      </View>
      <View style={macroStyles.track}>
        <View style={[macroStyles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function MealRow({
  entry,
  onPress,
  onDelete,
}: {
  entry: MealEntry;
  onPress: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={mealStyles.row}>
      <TouchableOpacity style={mealStyles.main} onPress={onPress} activeOpacity={0.7}>
        <View style={mealStyles.timeCol}>
          <Text style={mealStyles.time}>{entry.time}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={mealStyles.name}>{entry.name}</Text>
          <Text style={mealStyles.macros}>
            {entry.calories} kcal · {entry.macros.protein}g P · {entry.macros.carbs}g C · {entry.macros.fats}g F
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDelete} style={mealStyles.deleteBtn} hitSlop={8}>
        <Text style={mealStyles.deleteText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateLong(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatDateRel(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T00:00:00');
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return `${-diff} days ago`;
  return `In ${diff} days`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  popup: {
    width: '100%',
    maxWidth: 480,
    height: '85%',
  },
  popupInner: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dateTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  dateSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: COLORS.text, fontSize: 14 },
  body: { paddingHorizontal: 18, paddingBottom: 18 },
  summarySection: { paddingVertical: 14, gap: 10 },
  kcalRow: { flexDirection: 'row', alignItems: 'flex-end' },
  kcalLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 2 },
  kcalBig: { color: COLORS.text, fontSize: 28, fontWeight: '700' },
  kcalGoal: { color: COLORS.textMuted, fontSize: 14, fontWeight: '500' },
  kcalPctWrap: { alignItems: 'flex-end' },
  kcalPct: { color: COLORS.green, fontSize: 18, fontWeight: '700' },
  kcalPctSub: { color: COLORS.textSecondary, fontSize: 11 },
  kcalTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.elevated,
    overflow: 'hidden',
  },
  kcalFill: { height: '100%', backgroundColor: COLORS.green, borderRadius: 4 },
  macroBars: { gap: 10, marginTop: 6 },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    gap: 6,
  },
  emptyTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  emptySub: { color: COLORS.textSecondary, fontSize: 13 },
  mealList: { marginTop: 14, gap: 8 },
  footer: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  addBtn: {
    backgroundColor: COLORS.green,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  addBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
});

const macroStyles = StyleSheet.create({
  row: { gap: 4 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  values: { fontSize: 12 },
  goal: { color: COLORS.textMuted },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.elevated,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3 },
});

const mealStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeCol: { width: 46 },
  time: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  name: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  macros: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { color: COLORS.textSecondary, fontSize: 12 },
});
