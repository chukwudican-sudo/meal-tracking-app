import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CartIcon } from '@/components/CartIcon';
import { KitchenScanModal } from '@/components/grocery/KitchenScanModal';
import { Screen } from '@/components/Screen';
import { CATEGORY_DOT, CATEGORY_ORDER } from '@/constants/ingredientCategories';
import { COLORS } from '@/constants/theme';
import type { GroceryItem, IngredientCategory } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

export default function KitchenScreen() {
  const grocery = useMealStore(s => s.grocery);
  const addManualKitchenItem = useMealStore(s => s.addManualKitchenItem);
  const moveKitchenToCart = useMealStore(s => s.moveKitchenToCart);
  const removeGroceryItem = useMealStore(s => s.removeGroceryItem);
  const showToast = useToastStore(s => s.showToast);

  const [input, setInput] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  const kitchen = useMemo(
    () => Object.values(grocery.items).filter(i => i.section === 'kitchen'),
    [grocery.items],
  );

  const byCategory = useMemo(() => {
    const groups = {} as Record<IngredientCategory, GroceryItem[]>;
    CATEGORY_ORDER.forEach(c => { groups[c] = []; });
    kitchen.forEach(item => groups[item.category]?.push(item));
    return groups;
  }, [kitchen]);

  const isEmpty = kitchen.length === 0;

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const handleAdd = () => {
    const name = input.trim();
    if (!name) return;
    addManualKitchenItem(name);
    setInput('');
    showToast('Added to kitchen');
  };

  const handleMoveToCart = (item: GroceryItem) => {
    moveKitchenToCart(item.key);
    showToast('Added to Cart');
  };

  const handleRemove = (item: GroceryItem) => {
    removeGroceryItem(item.key);
    showToast(`Removed ${item.name}`);
  };

  // Add-item input + camera button (shared between normal & empty layouts).
  const addRow = (
    <View style={styles.addRow}>
      <View style={styles.inputWrap}>
        <Ionicons name="add" size={20} color={COLORS.textSecondary} />
        <TextInput
          style={styles.input}
          placeholder="Add an item..."
          placeholderTextColor={COLORS.textMuted}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleAdd}
          returnKeyType="done"
        />
      </View>
      <TouchableOpacity
        style={styles.cameraBtn}
        onPress={() => setScanOpen(true)}
        activeOpacity={0.85}
        accessibilityLabel="Scan your kitchen with the camera"
      >
        <Ionicons name="camera-outline" size={22} color={COLORS.text} />
      </TouchableOpacity>
    </View>
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={26} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My kitchen</Text>
        <CartIcon />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {isEmpty ? (
          <View style={styles.emptyBlock}>
            <TouchableOpacity
              style={styles.emptyCamera}
              onPress={() => setScanOpen(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="camera-outline" size={40} color={COLORS.green} />
            </TouchableOpacity>
            <Text style={styles.emptyTitle}>Scan your kitchen to get started</Text>
            <Text style={styles.emptyBody}>
              Snap your fridge or pantry, or add items by hand below.
            </Text>
            {addRow}
            <Text style={styles.hint}>Scan your fridge or pantry to add items quickly.</Text>
          </View>
        ) : (
          <>
            {addRow}
            <Text style={styles.hint}>Scan your fridge or pantry to add items quickly.</Text>

            <Text style={styles.count}>
              {kitchen.length} item{kitchen.length === 1 ? '' : 's'}
            </Text>

            {CATEGORY_ORDER.map(cat => {
              const items = byCategory[cat];
              if (!items || items.length === 0) return null;
              const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
              return (
                <View key={cat} style={styles.catBlock}>
                  <View style={styles.catHeaderRow}>
                    <View style={[styles.dot, { backgroundColor: CATEGORY_DOT[cat] }]} />
                    <Text style={styles.catHeader}>{cat}</Text>
                  </View>
                  <View style={styles.catContainer}>
                    {sorted.map((item, idx) => (
                      <View
                        key={item.key}
                        style={[styles.itemRow, idx > 0 && styles.itemRowDivider]}
                      >
                        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                        <TouchableOpacity
                          style={styles.cartPill}
                          onPress={() => handleMoveToCart(item)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="cart-outline" size={13} color={COLORS.green} />
                          <Text style={styles.cartPillText}>Cart</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.removeBtn}
                          onPress={() => handleRemove(item)}
                          hitSlop={8}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="close" size={16} color={COLORS.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}

            <TouchableOpacity
              style={styles.goToCart}
              onPress={() => router.push('/cart')}
              activeOpacity={0.7}
            >
              <Text style={styles.goToCartText}>Go to cart</Text>
              <Ionicons name="arrow-forward" size={15} color={COLORS.green} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <KitchenScanModal visible={scanOpen} onClose={() => setScanOpen(false)} />
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
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },

  // Add row
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  input: { flex: 1, color: COLORS.text, fontSize: 15, padding: 0 },
  cameraBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  hint: { color: COLORS.textSecondary, fontSize: 13, marginTop: 10 },
  count: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600', marginTop: 20 },

  // Category
  catBlock: { marginTop: 20 },
  catHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  catHeader: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  catContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  itemRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  itemName: { flex: 1, color: COLORS.text, fontSize: 16 },

  cartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: COLORS.green,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  cartPillText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  removeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Go to cart
  goToCart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 28,
    paddingVertical: 8,
  },
  goToCartText: { color: COLORS.green, fontSize: 15, fontWeight: '700' },

  // Empty state
  emptyBlock: { alignItems: 'center', paddingTop: 40 },
  emptyCamera: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.green + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800', marginTop: 20, textAlign: 'center' },
  emptyBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 22,
    paddingHorizontal: 12,
  },
});
