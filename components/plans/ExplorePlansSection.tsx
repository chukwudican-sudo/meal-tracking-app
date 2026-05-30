import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
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

export function ExplorePlansSection() {
  const plans = useMealStore(s => s.plans);

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

  const visibleCats = CATEGORIES.filter(c => (byCategory.get(c)?.length ?? 0) > 0);
  if (visibleCats.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Explore Plans</Text>
      {visibleCats.map(cat => {
        const list = byCategory.get(cat)!;
        return (
          <View key={cat} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{cat}</Text>
              <TouchableOpacity
                onPress={() =>
                  router.push({ pathname: '/plan/category/[type]', params: { type: cat } })
                }
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
                  onPress={() =>
                    router.push({ pathname: '/plan/[id]', params: { id: p.id } })
                  }
                />
              ))}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  heading: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  section: { marginTop: 14 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  seeAll: { color: COLORS.green, fontSize: 13, fontWeight: '600' },
  hScroll: { paddingHorizontal: 4, paddingBottom: 4 },
});
