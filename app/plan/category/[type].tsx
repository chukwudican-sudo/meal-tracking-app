import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.headerBackText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{category}</Text>
        <View style={styles.headerBack} />
      </View>

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
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 13 },
});
