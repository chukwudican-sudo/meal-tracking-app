import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import type { GroceryItem, IngredientCategory } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

const ACCENT = {
  green: '#30D158',
};

const CATEGORY_ORDER: IngredientCategory[] = [
  'Proteins',
  'Carbs & Grains',
  'Fruits & Vegetables',
  'Dairy',
  'Oils & Fats',
  'Spices & Seasonings',
  'Condiments',
  'Other',
];

export default function PlannedIngredientsScreen() {
  const grocery = useMealStore(s => s.grocery);
  const sortIngredient = useMealStore(s => s.sortIngredient);
  const skipIngredient = useMealStore(s => s.skipIngredient);
  const showToast = useToastStore(s => s.showToast);

  const [query, setQuery] = useState('');

  const planned = useMemo(
    () => Object.values(grocery.items).filter(i => i.section === 'planned'),
    [grocery.items]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return planned;
    return planned.filter(i => i.name.toLowerCase().includes(q));
  }, [planned, query]);

  const byCategory = useMemo(() => {
    const groups: Record<IngredientCategory, GroceryItem[]> = {
      'Proteins': [],
      'Carbs & Grains': [],
      'Fruits & Vegetables': [],
      'Dairy': [],
      'Oils & Fats': [],
      'Spices & Seasonings': [],
      'Condiments': [],
      'Other': [],
    };
    filtered.forEach(item => groups[item.category]?.push(item));
    return groups;
  }, [filtered]);

  const handleInStock = (item: GroceryItem) => {
    sortIngredient(item.key, 'kitchen');
    showToast('Moved to Kitchen');
  };

  const handleNeedIt = (item: GroceryItem) => {
    sortIngredient(item.key, 'cart');
    showToast('Added to Cart');
  };

  const handleSkip = (item: GroceryItem) => {
    const usedIn = item.mealNames?.[0] ?? 'a meal';
    Alert.alert(
      'Skip ingredient?',
      `This ingredient is used in ${usedIn}. Skip anyway?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip', style: 'destructive', onPress: () => skipIngredient(item.key) },
      ]
    );
  };

  const count = planned.length;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plan'))}
          style={styles.iconBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Planned Ingredients</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search ingredients…"
            placeholderTextColor={COLORS.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      <Text style={styles.counter}>
        {count} {count === 1 ? 'ingredient' : 'ingredients'} to sort
      </Text>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {count === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>All done! Your ingredients are sorted.</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No ingredients match &ldquo;{query.trim()}&rdquo;.</Text>
          </View>
        ) : (
          CATEGORY_ORDER.map(cat => {
            const items = byCategory[cat];
            if (!items || items.length === 0) return null;
            return (
              <View key={cat} style={styles.categoryGroup}>
                <Text style={styles.categoryHeader}>{cat}</Text>
                {items
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(item => (
                    <View key={item.key} style={styles.itemRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        {item.mealNames && item.mealNames.length > 0 ? (
                          <Text style={styles.mealTag}>
                            {item.mealNames.length === 1
                              ? item.mealNames[0]
                              : `${item.mealNames[0]} +${item.mealNames.length - 1}`}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.actionsRow}>
                        <TouchableOpacity
                          style={[styles.chipBtn, styles.chipInStock]}
                          onPress={() => handleInStock(item)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.chipInStockText}>In stock</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.chipBtn, styles.chipNeedIt]}
                          onPress={() => handleNeedIt(item)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.chipNeedItText}>Need it</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.chipSkip}
                          onPress={() => handleSkip(item)}
                          activeOpacity={0.6}
                          hitSlop={4}
                        >
                          <Text style={styles.chipSkipText}>Skip</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  title: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  searchRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14, padding: 0 },

  counter: {
    color: COLORS.textSecondary,
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },

  categoryGroup: { marginTop: 14 },
  categoryHeader: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },

  itemRow: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemName: { color: COLORS.text, fontSize: 15 },
  mealTag: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipBtn: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  chipInStock: { backgroundColor: ACCENT.green, borderColor: ACCENT.green },
  chipInStockText: { color: '#0E1A12', fontSize: 12, fontWeight: '800' },
  chipNeedIt: { backgroundColor: 'transparent', borderColor: ACCENT.green },
  chipNeedItText: { color: ACCENT.green, fontSize: 12, fontWeight: '700' },
  chipSkip: { paddingHorizontal: 8, paddingVertical: 7 },
  chipSkipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },

  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', fontStyle: 'italic' },
});
