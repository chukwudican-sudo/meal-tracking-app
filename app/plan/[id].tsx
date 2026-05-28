import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import type { MealPlan, RecipeTemplate } from '@/store/types';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function PlanDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';

  const plans = useMealStore(s => s.plans);
  const savedPlans = useMealStore(s => s.savedPlans);
  const templates = useMealStore(s => s.templates);
  const recipes = useMealStore(s => s.recipes);
  const profile = useMealStore(s => s.profile);
  const activatePlan = useMealStore(s => s.activatePlan);
  const saveCurrentPlanAs = useMealStore(s => s.saveCurrentPlanAs);
  const showToast = useToastStore(s => s.showToast);

  const plan: MealPlan | undefined = useMemo(
    () => plans.find(p => p.id === id) ?? savedPlans.find(p => p.id === id),
    [plans, savedPlans, id],
  );

  const recipeById = useMemo(() => {
    const m = new Map<string, RecipeTemplate>();
    recipes.forEach(r => m.set(r.id, r));
    return m;
  }, [recipes]);

  // Build distinct recipe list for the "Meals in this plan" section.
  const distinctMeals = useMemo(() => {
    if (!plan) return [] as { recipeId: string; recipeName: string }[];
    const seen = new Map<string, { recipeId: string; recipeName: string }>();
    plan.days.forEach(day =>
      day.forEach(m => {
        if (!seen.has(m.recipeId)) {
          seen.set(m.recipeId, { recipeId: m.recipeId, recipeName: m.recipeName });
        }
      }),
    );
    return Array.from(seen.values());
  }, [plan]);

  if (!plan) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.headerBackText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Plan not found</Text>
          <View style={styles.headerBack} />
        </View>
      </SafeAreaView>
    );
  }

  const handleStartPlan = () => {
    if (templates.length === 0) {
      activatePlan(plan);
      showToast(`${plan.name} activated`);
      router.dismissAll();
      return;
    }
    Alert.alert(
      'Replace your current plan?',
      'This will replace your current plan. Would you like to save your current plan first?',
      [
        {
          text: 'Save and replace',
          onPress: () => {
            const fallback = profile.activePlanName || `Plan saved ${new Date().toLocaleDateString()}`;
            saveCurrentPlanAs(fallback);
            activatePlan(plan);
            showToast(`${plan.name} activated`);
            router.dismissAll();
          },
        },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            activatePlan(plan);
            showToast(`${plan.name} activated`);
            router.dismissAll();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.headerBackText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{plan.name}</Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {plan.description ? (
          <Text style={styles.description}>{plan.description}</Text>
        ) : null}

        {plan.disclaimer ? (
          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerText}>{plan.disclaimer}</Text>
          </View>
        ) : null}

        {plan.targets ? (
          <View style={styles.targetsCard}>
            <Text style={styles.targetsLabel}>Daily target</Text>
            <Text style={styles.targetsCalories}>{plan.targets.calories} cal</Text>
            <View style={styles.macroRow}>
              <Text style={styles.macroPill}>P {plan.targets.protein}g</Text>
              <Text style={styles.macroPill}>C {plan.targets.carbs}g</Text>
              <Text style={styles.macroPill}>F {plan.targets.fats}g</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Meals in this plan</Text>
        <View style={styles.mealList}>
          {distinctMeals.map((m, idx) => {
            const r = recipeById.get(m.recipeId);
            return (
              <TouchableOpacity
                key={`${m.recipeId}-${idx}`}
                style={styles.mealRow}
                activeOpacity={0.7}
                onPress={() => {
                  if (r) router.push({ pathname: '/recipe/[id]', params: { id: r.id } });
                }}
                disabled={!r}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.mealName} numberOfLines={1}>{m.recipeName}</Text>
                  {r ? (
                    <Text style={styles.mealMeta}>
                      {r.calories} cal · {r.cookTimeMin}m · {r.category}
                    </Text>
                  ) : (
                    <Text style={styles.mealMeta}>Custom recipe</Text>
                  )}
                </View>
                {r ? <Text style={styles.chevron}>›</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Weekly schedule</Text>
        {plan.days.map((day, dayIdx) => (
          <View key={dayIdx} style={styles.dayBlock}>
            <Text style={styles.dayName}>{WEEKDAY_LABELS[dayIdx]}</Text>
            {day.length === 0 ? (
              <Text style={styles.daySkip}>Rest day</Text>
            ) : (
              day.map((m, mi) => (
                <View key={mi} style={styles.dayMealRow}>
                  <Text style={styles.dayMealTime}>{m.time}</Text>
                  <Text style={styles.dayMealName} numberOfLines={1}>{m.recipeName}</Text>
                </View>
              ))
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.startBtn} onPress={handleStartPlan} activeOpacity={0.85}>
          <Text style={styles.startBtnText}>Start Plan</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerBackText: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  headerTitle: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  body: { padding: 16, paddingBottom: 40 },

  description: { color: COLORS.text, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  disclaimer: {
    backgroundColor: COLORS.orange + '22',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  disclaimerText: { color: COLORS.orange, fontSize: 12, lineHeight: 17 },

  targetsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 16,
  },
  targetsLabel: { color: COLORS.textSecondary, fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  targetsCalories: { color: COLORS.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  macroRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  macroPill: {
    color: COLORS.textSecondary,
    fontSize: 11,
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  sectionTitle: {
    color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 8,
  },
  mealList: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  mealName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  mealMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  chevron: { color: COLORS.textSecondary, fontSize: 20 },

  dayBlock: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  dayName: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  daySkip: { color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic' },
  dayMealRow: { flexDirection: 'row', paddingVertical: 4, gap: 10 },
  dayMealTime: { color: COLORS.textSecondary, fontSize: 12, width: 56 },
  dayMealName: { color: COLORS.text, fontSize: 13, flex: 1 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  startBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
});
