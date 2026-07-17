import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';
import { router, useLocalSearchParams } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { MealEntry, MealSlot } from '@/store/types';
import { MealDetailModal } from '@/components/MealDetailModal';
import { AddMealScreen } from '@/components/addMeal/AddMealScreen';
import { slotNameToCategory } from '@/utils/mealSlots';

function formatDayHeading(iso: string): { title: string; subtitle: string } {
  const d = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  let rel = '';
  if (diff === 0) rel = 'Today';
  else if (diff === -1) rel = 'Yesterday';
  else if (diff === 1) rel = 'Tomorrow';
  else if (diff < 0) rel = `${-diff} days ago`;
  else rel = `In ${diff} days`;
  const title = d.toLocaleDateString('en-US', { weekday: 'long' });
  const subtitle = `${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · ${rel}`;
  return { title, subtitle };
}

// Stable empty array so the selector returns the same reference when there's
// no log for the day (avoids re-render loops in useSyncExternalStore).
const EMPTY_MEALS: MealEntry[] = [];

interface SlotSection {
  slot: MealSlot;
  meal?: MealEntry;
}

export default function DayDetailScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date ?? '';

  const meals = useMealStore(s => s.logs[date]?.meals ?? EMPTY_MEALS);
  const goals = useMealStore(s => s.goals);
  const profile = useMealStore(s => s.profile);
  const templates = useMealStore(s => s.templates);
  const resolveDayFromTemplates = useMealStore(s => s.resolveDayFromTemplates);

  // Materialize the day's meals from the active plan's templates the first
  // time this day is opened. Days that already have a log (edited/completed)
  // are left untouched by resolveDayFromTemplates.
  useEffect(() => {
    if (date) resolveDayFromTemplates(date);
  }, [date, resolveDayFromTemplates]);
  const removeMealFromDay = useMealStore(s => s.removeMealFromDay);
  const restoreMealToDay = useMealStore(s => s.restoreMealToDay);
  const removeDayMealWithScope = useMealStore(s => s.removeDayMealWithScope);
  const setPendingSwap = useMealStore(s => s.setPendingSwap);
  const openMealEditSession = useMealStore(s => s.openMealEditSession);
  const showUndo = useUndoStore(s => s.showUndo);
  const insets = useSafeAreaInsets();
  const footerBottomPad = Math.max(insets.bottom, 16) + 16;

  const [adding, setAdding] = useState(false);

  const activeSlots = useMemo<MealSlot[]>(
    () =>
      (profile.mealSlots ?? [])
        .filter(s => !s.skipped)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [profile.mealSlots],
  );

  // Assign each meal to a slot: by slotId first, then by time fallback.
  const { sections, otherMeals } = useMemo(() => {
    const usedIds = new Set<string>();
    const bySlot = new Map<string, MealEntry>();

    meals.forEach(m => {
      if (m.slotId) {
        const slot = activeSlots.find(s => s.id === m.slotId);
        if (slot && !bySlot.has(slot.id)) {
          bySlot.set(slot.id, m);
          usedIds.add(m.id);
        }
      }
    });
    activeSlots.forEach(slot => {
      if (!bySlot.has(slot.id)) {
        const m = meals.find(mm => !usedIds.has(mm.id) && mm.time === slot.time);
        if (m) {
          bySlot.set(slot.id, m);
          usedIds.add(m.id);
        }
      }
    });

    const sec: SlotSection[] = activeSlots.map(slot => ({ slot, meal: bySlot.get(slot.id) }));
    const others = meals
      .filter(m => !usedIds.has(m.id))
      .sort((a, b) => a.time.localeCompare(b.time));
    return { sections: sec, otherMeals: others };
  }, [meals, activeSlots]);

  const totalCalories = meals.reduce((s, m) => s + (m.calories ?? 0), 0);
  const totalP = meals.reduce((s, m) => s + (m.macros?.protein ?? 0), 0);
  const totalC = meals.reduce((s, m) => s + (m.macros?.carbs ?? 0), 0);
  const totalF = meals.reduce((s, m) => s + (m.macros?.fats ?? 0), 0);
  const calorieRatio = goals.dailyCalories > 0
    ? Math.min(1, totalCalories / goals.dailyCalories)
    : 0;

  const heading = formatDayHeading(date);

  const handleSwap = (slot: MealSlot) => {
    setPendingSwap({
      type: 'daily',
      date,
      slotId: slot.id,
      slotName: slot.name,
      time: slot.time,
      category: slotNameToCategory(slot.name),
    });
    const cat = slotNameToCategory(slot.name);
    router.push({
      pathname: '/recipes/saved',
      params: { swapMode: 'true', ...(cat ? { swapFilter: cat } : {}) },
    });
  };

  const handleRemove = (entry: MealEntry) => {
    const template = entry.templateId
      ? templates.find(t => t.id === entry.templateId)
      : undefined;
    const isRecurring = !!template && template.recurrence.type !== 'once';

    if (isRecurring) {
      Alert.alert(
        `Remove "${entry.name}"?`,
        'This is a recurring meal. What would you like to remove?',
        [
          {
            text: 'This meal',
            onPress: () => {
              removeDayMealWithScope(date, entry.id, 'this');
              const idx = meals.findIndex(m => m.id === entry.id);
              showUndo({
                message: `Removed "${entry.name}"`,
                undo: () => restoreMealToDay(date, entry, Math.max(0, idx)),
              });
            },
          },
          {
            text: 'This and future meals',
            onPress: () => removeDayMealWithScope(date, entry.id, 'future'),
          },
          {
            text: 'All recurring meals',
            style: 'destructive',
            onPress: () => removeDayMealWithScope(date, entry.id, 'all'),
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    Alert.alert(
      `Remove "${entry.name}"?`,
      'This will be removed from the day.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const idx = meals.findIndex(m => m.id === entry.id);
            removeMealFromDay(date, entry.id);
            showUndo({
              message: `Removed "${entry.name}"`,
              undo: () => restoreMealToDay(date, entry, Math.max(0, idx)),
            });
          },
        },
      ],
    );
  };

  if (!date) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.headerTitle}>Day not found</Text>
          <View style={styles.headerSide} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BackButton />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{heading.title}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{heading.subtitle}</Text>
        </View>
        <View style={styles.headerSide} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Macro summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryLabel}>Total calories</Text>
              <Text style={styles.summaryValue}>
                {Math.round(totalCalories).toLocaleString()}
                <Text style={styles.summaryGoal}>  / {goals.dailyCalories}</Text>
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.summaryPct}>{Math.round(calorieRatio * 100)}%</Text>
              <Text style={styles.summarySub}>of goal</Text>
            </View>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.round(calorieRatio * 100)}%` }]} />
          </View>
          <View style={styles.macroSummaryRow}>
            <MacroPill label="P" value={totalP} color={COLORS.blue} />
            <MacroPill label="C" value={totalC} color={COLORS.green} />
            <MacroPill label="F" value={totalF} color={COLORS.orange} />
          </View>
        </View>

        {/* Slot sections */}
        {sections.map(({ slot, meal }) => (
          <SlotBlock
            key={slot.id}
            slot={slot}
            meal={meal}
            onSwap={() => handleSwap(slot)}
            onEdit={meal ? () => openMealEditSession(date, 'plan', meal) : undefined}
            onRemove={meal ? () => handleRemove(meal) : undefined}
          />
        ))}

        {/* Ad-hoc meals not tied to a slot */}
        {otherMeals.length > 0 ? (
          <>
            <Text style={styles.otherHeader}>Other meals</Text>
            {otherMeals.map(meal => (
              <View key={meal.id} style={styles.mealRow}>
                <TouchableOpacity style={styles.mealMain} onPress={() => openMealEditSession(date, 'plan', meal)} activeOpacity={0.7}>
                  <View style={styles.timeCol}>
                    <Text style={styles.mealTime}>{meal.time}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.mealNameRow}>
                      <Text style={styles.mealName} numberOfLines={1}>{meal.name}</Text>
                      {meal.isAdHoc && (
                        <View style={styles.addedTag}><Text style={styles.addedTagText}>Added</Text></View>
                      )}
                    </View>
                    <Text style={styles.mealMeta} numberOfLines={1}>
                      {meal.calories} cal · P {meal.macros.protein}g · C {meal.macros.carbs}g · F {meal.macros.fats}g
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemove(meal)} style={styles.removeBtn} hitSlop={8}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)} activeOpacity={0.85}>
          <Text style={styles.addBtnText}>+  Add meal</Text>
        </TouchableOpacity>
      </View>

      <MealDetailModal />
      <AddMealScreen
        visible={adding}
        date={date}
        onClose={() => setAdding(false)}
      />
    </Screen>
  );
}

function SlotBlock({
  slot,
  meal,
  onSwap,
  onEdit,
  onRemove,
}: {
  slot: MealSlot;
  meal?: MealEntry;
  onSwap: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    <View style={styles.slotBlock}>
      <View style={styles.slotHeaderRow}>
        <Text style={styles.slotName}>{slot.name}</Text>
        <Text style={styles.slotTime}>{slot.time}</Text>
      </View>

      {meal ? (
        <View style={styles.slotMealCard}>
          <TouchableOpacity style={{ flex: 1 }} onPress={onEdit} activeOpacity={0.7} disabled={!onEdit}>
            <View style={styles.mealNameRow}>
              <Text style={styles.slotMealName} numberOfLines={1}>{meal.name}</Text>
              {meal.status === 'completed' && <Text style={styles.completedMark}>✓</Text>}
            </View>
            <Text style={styles.slotMealMeta} numberOfLines={1}>
              {meal.calories} cal · P {meal.macros.protein}g · C {meal.macros.carbs}g · F {meal.macros.fats}g
            </Text>
          </TouchableOpacity>
          <View style={styles.slotActions}>
            <TouchableOpacity onPress={onSwap} style={styles.swapBtn} hitSlop={6}>
              <Text style={styles.swapBtnText}>Swap</Text>
            </TouchableOpacity>
            {onRemove ? (
              <TouchableOpacity onPress={onRemove} style={styles.removeBtn} hitSlop={8}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.emptySlotCard} onPress={onSwap} activeOpacity={0.7}>
          <Text style={styles.emptySlotText}>No meal yet</Text>
          <Text style={styles.emptySlotAdd}>+ Add {slot.name.toLowerCase()}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function MacroPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.macroPill, { borderColor: color + '55' }]}>
      <Text style={[styles.macroPillLabel, { color }]}>{label}</Text>
      <Text style={styles.macroPillValue}>{Math.round(value)}g</Text>
    </View>
  );
}

function BackButton() {
  return (
    <TouchableOpacity
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plan'))}
      style={styles.headerSide}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Text style={styles.headerBackText}>←</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerSide: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerBackText: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  headerSubtitle: { color: COLORS.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 2 },

  body: { padding: 14, paddingBottom: 40, gap: 14 },

  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 10,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-end' },
  summaryLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  summaryValue: { color: COLORS.text, fontSize: 26, fontWeight: '700', marginTop: 2 },
  summaryGoal: { color: COLORS.textMuted, fontSize: 13, fontWeight: '500' },
  summaryPct: { color: COLORS.green, fontSize: 18, fontWeight: '700' },
  summarySub: { color: COLORS.textSecondary, fontSize: 11 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: COLORS.elevated, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: COLORS.green, borderRadius: 4 },
  macroSummaryRow: { flexDirection: 'row', gap: 8 },
  macroPill: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
  },
  macroPillLabel: { fontSize: 12, fontWeight: '700' },
  macroPillValue: { color: COLORS.text, fontSize: 12, fontWeight: '600' },

  // Slot section
  slotBlock: { gap: 8 },
  slotHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  slotName: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  slotTime: { color: COLORS.textSecondary, fontSize: 13 },

  slotMealCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  slotMealName: { color: COLORS.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  slotMealMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  slotActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  emptySlotCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 4,
  },
  emptySlotText: { color: COLORS.textSecondary, fontSize: 13 },
  emptySlotAdd: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  swapBtn: {
    backgroundColor: COLORS.elevated,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  swapBtnText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  // Other / ad-hoc meals
  otherHeader: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  mealMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeCol: { width: 52 },
  mealTime: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  mealNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mealName: { color: COLORS.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  completedMark: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  mealMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  addedTag: {
    backgroundColor: COLORS.elevated,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  addedTagText: { color: COLORS.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: COLORS.textSecondary, fontSize: 12 },

  footer: {
    paddingHorizontal: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  addBtn: {
    backgroundColor: COLORS.green,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  addBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
});
