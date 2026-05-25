import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CartIcon } from '@/components/CartIcon';
import { COLORS } from '@/constants/theme';

export default function ProfileScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header with cart icon in top-right */}
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <CartIcon />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderTitle}>Profile coming soon</Text>
          <Text style={styles.placeholderBody}>
            Your account, preferences, and goals will live here.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SETTINGS</Text>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/settings')}
            activeOpacity={0.7}
          >
            <Text style={styles.rowText}>App settings</Text>
            <Text style={styles.rowArrow}>›</Text>
          </TouchableOpacity>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text },

  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },

  placeholderCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  placeholderTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  placeholderBody: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },

  section: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  rowText: { color: COLORS.text, fontSize: 15 },
  rowArrow: { color: COLORS.textSecondary, fontSize: 22, fontWeight: '300' },
});
