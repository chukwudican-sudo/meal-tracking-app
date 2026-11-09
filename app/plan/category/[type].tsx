import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { router, useLocalSearchParams } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { PlanCard } from '@/components/plans/PlanCard';

export default function PlanCategoryScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const category = params.type ?? '';
  const plans = useMealStore(s => s.plans);

  const list = useMemo(
    () => plans.filter(p => p.category === category),
    [plans, category],
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <PageHeader style={styles.header} title={category} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {list.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No plans in this category yet.</Text>
          </View>
        ) : (
          list.map(p => (
            <PlanCard
              key={p.id}
              plan={p}
              variant="row"
              onPress={() => router.push({ pathname: '/plan/[id]', params: { id: p.id } })}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },

  body: { padding: 16, paddingBottom: 40 },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 13 },
});
