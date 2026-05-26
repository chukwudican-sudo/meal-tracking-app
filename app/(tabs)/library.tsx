import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CartIcon } from '@/components/CartIcon';
import { ProfileIcon } from '@/components/ProfileIcon';
import { KitchenSection } from '@/components/grocery/KitchenSection';
import { COLORS } from '@/constants/theme';
import { useNavSourceStore } from '@/store/useNavSourceStore';

export default function LibraryScreen() {
  const kitchenSource = useNavSourceStore(s => s.kitchenSource);
  const setKitchenSource = useNavSourceStore(s => s.setKitchenSource);

  const handleBack = () => {
    const target = kitchenSource;
    setKitchenSource(null);
    if (!target) return;
    if (target === '/cart') router.replace('/cart');
    else router.navigate(target);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {kitchenSource ? (
          <TouchableOpacity
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.title}>Library</Text>
        <View style={styles.headerActions}>
          <ProfileIcon />
          <CartIcon />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <KitchenSection />

        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderTitle}>More library content coming soon</Text>
          <Text style={styles.placeholderBody}>
            Saved meals, favourites, and AI recipe suggestions will live here.
          </Text>
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
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '600',
  },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  scroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
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
    fontSize: 15,
    fontWeight: '600',
  },
  placeholderBody: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});
