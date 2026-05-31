import { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { MealEntry } from '@/store/types';
import { EditMealScreen } from '@/components/EditMealScreen';
import { AddMealScreen } from '@/components/addMeal/AddMealScreen';

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

export default function DayDetailScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date ?? '';

  const meals = useMealStore(s => s.logs[date]?.meals ?? EMPTY_MEALS);
  const goals = useMealStore(s => s.goals);
  const templates = useMealStore(s => s.templates);
  const removeMealFromDay = useMealStore(s => s.removeMealFromDay);
  const restoreMealToDay = useMealStore(s => s.restoreMealToDay);
  const removeDayMealWithScope = useMealStore(s => s.removeDayMealWithScope);
  const showUndo = useUndoStore(s => s.showUndo);

  const [editing, setEditing] = useState<MealEntry | null>(null);
  const [adding, setAdding] = useState(false);

  // Always sort by time so meals appear in chronological order regardless of insertion order.
  const sortedMeals = useMemo(
    () => [...meals].sort((a, b) => a.time.localeCompare(b.time)),
    [meals],
  );

  const totalCalories = meals.reduce((s, m) => s + (m.calories ?? 0), 0);
  const calorieRatio = goals.dailyCalories > 0
    ? Math.min(1, totalCalories / goals.dailyCalories)
    : 0;

  const heading = formatDayHeading(date);

  const handleRemove = (entry: MealEntry) => {
    const template = entry.templateId
      ? templates.find(t => t.id === entry.templateId)
      : undefined;
    const isRecurring = !!template && template.recurrence.type !== 'once';

    if (isRecurring) {
      // Google Calendar 3-option semantic. iOS Alert caps at 3 buttons cleanly,
      // so we put Cancel inside the prompt and split actions across two layers.
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
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.headerTitle}>Day not found</Text>
          <View style={styles.headerSide} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <BackButton />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{heading.title}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{heading.subtitle}</Text>
        </View>
        <View style={styles.headerSide} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
        </View>

        {sortedMeals.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No meals scheduled</Text>
            <Text style={styles.emptyBody}>Tap + Add meal below to schedule one.</Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {sortedMeals.map(meal => (
              <MealRow
                key={meal.id}
                entry={meal}
                onPress={() => setEditing(meal)}
                onRemove={() => handleRemove(meal)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)} activeOpacity={0.85}>
          <Text style={styles.addBtnText}>+  Add meal</Text>
        </TouchableOpacity>
      </View>

      <EditMealScreen
        visible={!!editing}
        date={date}
        entry={editing}
        onClose={() => setEditing(null)}
      />
      <AddMealScreen
        visible={adding}
        date={date}
        onClose={() => setAdding(false)}
      />
    </SafeAreaView>
  );
}

// Stable empty array so the selector returns the same reference when there's
// no log for the day (avoids re-render loops in useSyncExternalStore).
const EMPTY_MEALS: MealEntry[] = [];

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

function MealRow({
  entry,
  onPress,
  onRemove,
}: {
  entry: MealEntry;
  onPress: () => void;
  onRemove: () => void;
}) {
  const isCompleted = entry.status === 'completed';
  return (
    <View style={styles.mealRow}>
      <TouchableOpacity style={styles.mealMain} onPress={onPress} activeOpacity={0.7}>
        <View style={styles.timeCol}>
          <Text style={styles.mealTime}>{entry.time}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.mealNameRow}>
            <Text style={styles.mealName} numberOfLines={1}>{entry.name}</Text>
            {isCompleted && <Text style={styles.completedMark}>✓</Text>}
            {entry.isAdHoc && (
              <View style={styles.addedTag}>
                <Text style={styles.addedTagText}>Added</Text>
              </View>
            )}
          </View>
          <Text style={styles.mealMeta} numberOfLines={1}>
            {entry.calories} cal · P {entry.macros.protein}g · C {entry.macros.carbs}g · F {entry.macros.fats}g
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity onPress={onRemove} style={styles.removeBtn} hitSlop={8}>
        <Text style={styles.removeBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

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

  body: { padding: 14, paddingBottom: 24, gap: 12 },

  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 8,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-end' },
  summaryLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  summaryValue: { color: COLORS.text, fontSize: 26, fontWeight: '700', marginTop: 2 },
  summaryGoal: { color: COLORS.textMuted, fontSize: 13, fontWeight: '500' },
  summaryPct: { color: COLORS.green, fontSize: 18, fontWeight: '700' },
  summarySub: { color: COLORS.textSecondary, fontSize: 11 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: COLORS.elevated, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: COLORS.green, borderRadius: 4 },

  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 22,
    alignItems: 'center',
  },
  emptyTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  emptyBody: { color: COLORS.textSecondary, fontSize: 12 },

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
  addedTagText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
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
    padding: 14,
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
