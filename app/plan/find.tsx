import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import type { MealPlan, PlanCategory } from '@/store/types';
import { PlanCard } from '@/components/plans/PlanCard';

const CATEGORIES: PlanCategory[] = [
  'Balanced',
  'High Protein',
  'Low Carb',
  'High Fiber',
  'Keto',
  'Mediterranean',
];

export default function FindPlanScreen() {
  const plans = useMealStore(s => s.plans);
  const savedPlans = useMealStore(s => s.savedPlans);
  const removeSavedPlan = useMealStore(s => s.removeSavedPlan);
  const renameSavedPlan = useMealStore(s => s.renameSavedPlan);
  const showToast = useToastStore(s => s.showToast);

  const byCategory = useMemo(() => {
    const map = new Map<PlanCategory, MealPlan[]>();
    CATEGORIES.forEach(c => map.set(c, []));
    plans.forEach(p => {
      if (p.category && map.has(p.category)) {
        map.get(p.category)!.push(p);
      }
    });
    return map;
  }, [plans]);

  const handleSavedLongPress = (plan: MealPlan) => {
    Alert.alert(
      plan.name,
      'What would you like to do with this saved plan?',
      [
        {
          text: 'Rename',
          onPress: () => {
            Alert.prompt(
              'Rename saved plan',
              'Enter a new name for this plan.',
              (next) => {
                const trimmed = (next ?? '').trim();
                if (!trimmed) return;
                renameSavedPlan(plan.id, trimmed);
                showToast('Plan renamed');
              },
              'plain-text',
              plan.name,
            );
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            removeSavedPlan(plan.id);
            showToast('Plan deleted');
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
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plan'))}
          style={styles.headerBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.headerBackText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Find a Plan</Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Browse pre-made plans by category, or pick one you saved earlier.
        </Text>

        {CATEGORIES.map(cat => {
          const list = byCategory.get(cat) ?? [];
          if (list.length === 0) return null;
          return (
            <View key={cat} style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{cat}</Text>
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/plan/category/[type]', params: { type: cat } })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.seeAll}>See all</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hScroll}
              >
                {list.map(p => (
                  <PlanCard
                    key={p.id}
                    plan={p}
                    onPress={() => router.push({ pathname: '/plan/[id]', params: { id: p.id } })}
                  />
                ))}
              </ScrollView>
            </View>
          );
        })}

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Saved Plans</Text>
          </View>
          {savedPlans.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No saved plans yet. Saved plans show up here after you replace an active plan or save
                your current plan in Build My Plan.
              </Text>
            </View>
          ) : (
            savedPlans.map(p => (
              <PlanCard
                key={p.id}
                plan={p}
                variant="row"
                onPress={() => router.push({ pathname: '/plan/[id]', params: { id: p.id } })}
                onLongPress={() => handleSavedLongPress(p)}
              />
            ))
          )}
        </View>
      </ScrollView>
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

  intro: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 6, lineHeight: 19 },

  section: { marginTop: 18 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  seeAll: { color: COLORS.green, fontSize: 13, fontWeight: '600' },
  hScroll: { paddingHorizontal: 4, paddingBottom: 4 },

  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
});
