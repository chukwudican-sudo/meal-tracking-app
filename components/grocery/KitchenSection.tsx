import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS } from '@/constants/theme';
import type { GroceryItem, IngredientCategory } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const ACCENT = {
  green: '#30D158',
  greenBg: 'rgba(48, 209, 88, 0.18)',
  amber: '#FF9F0A',
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

interface Props {
  // When true, show the "Go to Cart" link inline below the list. Default true;
  // can be hidden if Kitchen is rendered inside a context that already exposes
  // a Cart entry point (e.g. inside the Cart sheet itself).
  showGoToCart?: boolean;
}

export function KitchenSection({ showGoToCart = true }: Props) {
  const grocery = useMealStore(s => s.grocery);
  const moveKitchenToCart = useMealStore(s => s.moveKitchenToCart);
  const addManualKitchenItem = useMealStore(s => s.addManualKitchenItem);
  const removeGroceryItem = useMealStore(s => s.removeGroceryItem);

  const [kitchenInput, setKitchenInput] = useState('');

  const kitchen = useMemo(
    () => Object.values(grocery.items).filter(i => i.section === 'kitchen'),
    [grocery.items]
  );

  const kitchenByCategory = useMemo(() => {
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
    kitchen.forEach(item => groups[item.category]?.push(item));
    return groups;
  }, [kitchen]);

  const handleAddKitchen = () => {
    const name = kitchenInput.trim();
    if (!name) return;
    addManualKitchenItem(name);
    setKitchenInput('');
  };

  const handleRemovePress = (item: GroceryItem) => {
    Alert.alert(
      'Remove item?',
      `Remove "${item.name}" from your kitchen?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeGroceryItem(item.key),
        },
      ]
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Kitchen</Text>
          <Text style={styles.hint}>
            Add what&apos;s in your kitchen so we can suggest meals.
          </Text>
        </View>
      </View>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder="Add an item…"
          placeholderTextColor={COLORS.textMuted}
          value={kitchenInput}
          onChangeText={setKitchenInput}
          onSubmitEditing={handleAddKitchen}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.addBtn, !kitchenInput.trim() && styles.addBtnDisabled]}
          onPress={handleAddKitchen}
          disabled={!kitchenInput.trim()}
        >
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {kitchen.length === 0 ? (
        <Text style={styles.emptyText}>
          Your kitchen is empty. Add items above or sort them in from your plan.
        </Text>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const items = kitchenByCategory[cat];
          if (!items || items.length === 0) return null;
          return (
            <View key={cat} style={{ marginTop: 14 }}>
              <Text style={styles.categoryHeader}>{cat}</Text>
              {items
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(item => (
                  <View key={item.key} style={styles.row}>
                    <Text style={[styles.itemName, { flex: 1 }]}>{item.name}</Text>
                    <TouchableOpacity
                      style={[styles.chipBtn, styles.chipNeedIt]}
                      onPress={() => moveKitchenToCart(item.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.chipNeedItText}>→ Cart</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => handleRemovePress(item)}
                      hitSlop={8}
                    >
                      <Text style={styles.iconBtnText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
            </View>
          );
        })
      )}

      {showGoToCart && (
        <TouchableOpacity
          style={styles.goLink}
          onPress={() => router.push('/cart')}
          activeOpacity={0.7}
        >
          <Text style={styles.goLinkText}>Go to Cart →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
  },
  hint: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  addInput: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    color: COLORS.text,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    borderRadius: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: ACCENT.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: COLORS.elevated },
  addBtnText: { color: '#1A1207', fontSize: 22, fontWeight: '700', lineHeight: 24 },

  categoryHeader: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  itemName: { color: COLORS.text, fontSize: 15 },

  chipBtn: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  chipNeedIt: {
    backgroundColor: 'transparent',
    borderColor: ACCENT.green,
  },
  chipNeedItText: {
    color: ACCENT.green,
    fontSize: 12,
    fontWeight: '700',
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { color: COLORS.textSecondary, fontSize: 16, lineHeight: 18 },

  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    paddingVertical: 16,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  goLink: {
    marginTop: 14,
    paddingVertical: 8,
    alignSelf: 'flex-end',
  },
  goLinkText: {
    color: ACCENT.amber,
    fontSize: 13,
    fontWeight: '700',
  },
});
