import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import type { MealPlan } from '@/store/types';

function formatSavedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function SavedPlansSection() {
  const savedPlans = useMealStore(s => s.savedPlans);
  const activePlanName = useMealStore(s => s.profile.activePlanName);
  const renameSavedPlan = useMealStore(s => s.renameSavedPlan);
  const removeSavedPlan = useMealStore(s => s.removeSavedPlan);
  const showToast = useToastStore(s => s.showToast);

  const handleLongPress = (plan: MealPlan) => {
    const isUserPlan = plan.source === 'user';
    const buttons: Parameters<typeof Alert.alert>[2] = [
      {
        text: 'Rename',
        onPress: () => {
          Alert.prompt(
            'Rename plan',
            'Enter a new name.',
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
    ];
    if (isUserPlan) {
      buttons.push({
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Delete plan?',
            `"${plan.name}" will be removed from Saved Plans. This cannot be undone.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  removeSavedPlan(plan.id);
                  showToast('Plan deleted');
                },
              },
            ],
          );
        },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(plan.name, isUserPlan ? 'What would you like to do?' : 'Pre-made plans cannot be deleted.', buttons);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Saved Plans</Text>

      {savedPlans.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No saved plans yet. Plans you build or start will appear here.
          </Text>
        </View>
      ) : (
        savedPlans.map(plan => {
          const isCurrent = !!activePlanName && plan.name === activePlanName;
          const dateLabel = formatSavedDate(plan.savedAt);
          return (
            <TouchableOpacity
              key={plan.id}
              activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/plan/[id]', params: { id: plan.id } })}
              onLongPress={() => handleLongPress(plan)}
              style={[styles.row, isCurrent && styles.rowCurrent]}
            >
              <View style={styles.thumb}>
                <Text style={styles.thumbEmoji}>📋</Text>
              </View>
              <View style={styles.body}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{plan.name}</Text>
                  {isCurrent && (
                    <View style={styles.currentTag}>
                      <Text style={styles.currentTagText}>Current</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {dateLabel ? `Saved ${dateLabel}` : 'Saved plan'}
                  {plan.category ? ` · ${plan.category}` : ''}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 18 },
  heading: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    paddingHorizontal: 4,
  },

  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 10,
  },
  rowCurrent: { borderColor: COLORS.green },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  thumbEmoji: { fontSize: 24 },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: COLORS.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  currentTag: {
    backgroundColor: COLORS.green + '22',
    borderColor: COLORS.green,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  currentTagText: { color: COLORS.green, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  chevron: { color: COLORS.textSecondary, fontSize: 22, paddingLeft: 8 },
});
