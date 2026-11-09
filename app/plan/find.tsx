import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';

export default function FindYourPlanScreen() {
  return (
    <Screen edges={['top', 'bottom']}>
      <PageHeader
        style={styles.header}
        title="Find Your Plan"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plan'))}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.heroEmoji}>🧭</Text>
          <Text style={styles.heroTitle}>Coming soon</Text>
          <Text style={styles.heroBody}>
            Find Your Plan asks a few quick questions about your goals, schedule, and preferences,
            then matches you to a plan from our pre-made library.
          </Text>
          <Text style={styles.heroBody}>
            We&apos;re finishing the question flow now. In the meantime, you can browse plans by
            category in <Text style={styles.heroEmphasis}>Explore Plans</Text> below the week
            schedule, or build a fully custom plan tailored to your goals with{' '}
            <Text style={styles.heroEmphasis}>Build My Plan</Text>.
          </Text>
        </View>

        <View style={styles.bridgeCard}>
          <Text style={styles.bridgeBadge}>Want to skip the wait?</Text>
          <Text style={styles.bridgeTitle}>None of these fit?</Text>
          <Text style={styles.bridgeBody}>
            Build your own plan from scratch — pick the meals you actually want, slot by slot.
          </Text>
          <TouchableOpacity
            style={styles.bridgeBtn}
            onPress={() => router.replace('/plan/build')}
            activeOpacity={0.85}
          >
            <Text style={styles.bridgeBtnText}>Try Build My Plan instead →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },

  body: { padding: 16, paddingBottom: 40, gap: 16 },

  heroCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    alignItems: 'center',
  },
  heroEmoji: { fontSize: 44, marginBottom: 8 },
  heroTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700', marginBottom: 10 },
  heroBody: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 12,
  },
  heroEmphasis: { color: COLORS.text, fontWeight: '700' },

  bridgeCard: {
    backgroundColor: COLORS.green + '14',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.green,
    padding: 20,
  },
  bridgeBadge: {
    color: COLORS.green,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  bridgeTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  bridgeBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  bridgeBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  bridgeBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
});
