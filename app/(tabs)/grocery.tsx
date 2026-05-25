import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import type { GroceryItem, IngredientCategory } from '@/store/types';
import { useMealStore, mondayOfWeek } from '@/store/useMealStore';

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

function toIsoDateLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatWeekLabel(weekStart: string): string {
  if (!weekStart) return '';
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Week of ${fmt(start)} – ${fmt(end)}`;
}

export default function GroceryScreen() {
  const grocery = useMealStore(s => s.grocery);
  const refreshGroceryWeek = useMealStore(s => s.refreshGroceryWeek);
  const sortIngredient = useMealStore(s => s.sortIngredient);
  const skipIngredient = useMealStore(s => s.skipIngredient);
  const moveKitchenToCart = useMealStore(s => s.moveKitchenToCart);
  const toggleCartStrikethrough = useMealStore(s => s.toggleCartStrikethrough);
  const addManualCartItem = useMealStore(s => s.addManualCartItem);
  const addManualKitchenItem = useMealStore(s => s.addManualKitchenItem);
  const removeGroceryItem = useMealStore(s => s.removeGroceryItem);
  const doneShopping = useMealStore(s => s.doneShopping);
  const resolveOldCartItems = useMealStore(s => s.resolveOldCartItems);
  const dismissGroceryTip = useMealStore(s => s.dismissGroceryTip);

  // Local state for inline add inputs
  const [kitchenInput, setKitchenInput] = useState('');
  const [cartInput, setCartInput] = useState('');

  // Auto-refresh on mount + every focus tick: if today's Monday-of-week differs
  // from grocery.weekStart, run refresh which (re)populates Planned and may
  // surface old-cart-items popup.
  useEffect(() => {
    const today = toIsoDateLocal(new Date());
    const thisMonday = mondayOfWeek(today);
    if (grocery.weekStart !== thisMonday) {
      refreshGroceryWeek(thisMonday);
    }
  }, [grocery.weekStart, refreshGroceryWeek]);

  // ─── Derived data ─────────────────────────────────────────────────────────
  const planned = useMemo(
    () => Object.values(grocery.items).filter(i => i.section === 'planned'),
    [grocery.items]
  );
  const kitchen = useMemo(
    () => Object.values(grocery.items).filter(i => i.section === 'kitchen'),
    [grocery.items]
  );
  const cart = useMemo(
    () => Object.values(grocery.items).filter(i => i.section === 'cart'),
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
    kitchen.forEach(item => {
      groups[item.category]?.push(item);
    });
    return groups;
  }, [kitchen]);

  const oldCartItems = useMemo(
    () =>
      grocery.cartOldWeekItems
        .map(key => grocery.items[key])
        .filter(Boolean) as GroceryItem[],
    [grocery.cartOldWeekItems, grocery.items]
  );
  const oldCartVisible = oldCartItems.length > 0;

  // ─── Handlers ─────────────────────────────────────────────────────────────
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

  const handleAddKitchen = () => {
    const name = kitchenInput.trim();
    if (!name) return;
    addManualKitchenItem(name);
    setKitchenInput('');
  };

  const handleAddCart = () => {
    const name = cartInput.trim();
    if (!name) return;
    addManualCartItem(name);
    setCartInput('');
  };

  const handleDoneShopping = () => {
    const struck = cart.filter(i => i.struckThrough).length;
    if (struck === 0) {
      Alert.alert('Nothing checked off', 'Tap items in your Cart to mark them as bought first.');
      return;
    }
    Alert.alert(
      'Done shopping?',
      `Move ${struck} item${struck === 1 ? '' : 's'} to your Kitchen?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Done', onPress: doneShopping },
      ]
    );
  };

  const handleRemovePress = (item: GroceryItem) => {
    Alert.alert(
      'Remove item?',
      `Remove "${item.name}" from your list?`,
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

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Grocery</Text>
        <Text style={styles.subtitle}>{formatWeekLabel(grocery.weekStart)}</Text>
      </View>

      {!grocery.hasSeenTip && (
        <View style={styles.tipBanner}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.tipTitle}>How this works</Text>
            <Text style={styles.tipBody}>
              Ingredients from your meal plan land in <Text style={styles.tipBold}>Planned</Text>.
              Tap <Text style={styles.tipBold}>In stock</Text> if you have it (sends to Kitchen),
              or <Text style={styles.tipBold}>Need it</Text> to add to your Cart.
            </Text>
          </View>
          <TouchableOpacity onPress={dismissGroceryTip} hitSlop={8}>
            <Text style={styles.tipDismiss}>Got it</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── Planned Ingredients ──────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Planned Ingredients</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {planned.length === 0 ? 'All sorted' : `${planned.length} to sort`}
              </Text>
            </View>
          </View>

          {planned.length === 0 ? (
            <Text style={styles.emptyText}>
              Your plan&apos;s ingredients will appear here on Monday.
            </Text>
          ) : (
            planned
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(item => (
                <View key={item.key} style={styles.plannedCard}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    {item.mealNames && item.mealNames.length > 0 && (
                      <Text style={styles.mealTag}>
                        {item.mealNames.length === 1
                          ? item.mealNames[0]
                          : `${item.mealNames[0]} +${item.mealNames.length - 1}`}
                      </Text>
                    )}
                  </View>
                  <View style={styles.plannedActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionInStock]}
                      onPress={() => sortIngredient(item.key, 'kitchen')}
                    >
                      <Text style={styles.actionBtnText}>In stock</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionNeedIt]}
                      onPress={() => sortIngredient(item.key, 'cart')}
                    >
                      <Text style={styles.actionBtnText}>Need it</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionSkip]}
                      onPress={() => handleSkip(item)}
                    >
                      <Text style={styles.actionSkipText}>Skip</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
          )}
        </View>

        {/* ─── Kitchen ──────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Kitchen</Text>
            <Text style={styles.sectionMeta}>
              {kitchen.length} item{kitchen.length === 1 ? '' : 's'}
            </Text>
          </View>

          {kitchen.length === 0 ? (
            <Text style={styles.emptyText}>
              Add what&apos;s in your kitchen so we can suggest meals.
            </Text>
          ) : (
            CATEGORY_ORDER.map(cat => {
              const items = kitchenByCategory[cat];
              if (!items || items.length === 0) return null;
              return (
                <View key={cat} style={{ marginTop: 8 }}>
                  <Text style={styles.categoryHeader}>{cat}</Text>
                  {items
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(item => (
                      <View key={item.key} style={styles.kitchenRow}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={styles.smallBtn}
                            onPress={() => moveKitchenToCart(item.key)}
                          >
                            <Text style={styles.smallBtnText}>→ Cart</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => handleRemovePress(item)}
                            hitSlop={8}
                          >
                            <Text style={styles.iconBtnText}>×</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                </View>
              );
            })
          )}

          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              placeholder="Add item to Kitchen…"
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
        </View>

        {/* ─── Cart ─────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Cart</Text>
            <Text style={styles.sectionMeta}>
              {cart.length} item{cart.length === 1 ? '' : 's'}
            </Text>
          </View>

          {cart.length === 0 ? (
            <Text style={styles.emptyText}>Your shopping list is empty.</Text>
          ) : (
            cart
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(item => (
                <Pressable
                  key={item.key}
                  style={styles.cartRow}
                  onPress={() => toggleCartStrikethrough(item.key)}
                  onLongPress={() => handleRemovePress(item)}
                >
                  <View style={styles.checkbox}>
                    {item.struckThrough && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      styles.itemName,
                      { flex: 1 },
                      item.struckThrough && styles.strikethrough,
                    ]}
                  >
                    {item.name}
                  </Text>
                  {item.isCustom && <Text style={styles.customLabel}>custom</Text>}
                </Pressable>
              ))
          )}

          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              placeholder="Add custom item…"
              placeholderTextColor={COLORS.textMuted}
              value={cartInput}
              onChangeText={setCartInput}
              onSubmitEditing={handleAddCart}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.addBtn, !cartInput.trim() && styles.addBtnDisabled]}
              onPress={handleAddCart}
              disabled={!cartInput.trim()}
            >
              <Text style={styles.addBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.doneBtn, cart.length === 0 && styles.doneBtnDisabled]}
            onPress={handleDoneShopping}
            disabled={cart.length === 0}
          >
            <Text style={styles.doneBtnText}>Done shopping</Text>
          </TouchableOpacity>
          <Text style={styles.doneHint}>Tap when you&apos;re back from the store.</Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      <OldCartModal
        visible={oldCartVisible}
        items={oldCartItems}
        onResolve={resolveOldCartItems}
      />
    </SafeAreaView>
  );
}

// ─── Old-Cart Items Modal ─────────────────────────────────────────────────────

interface OldCartModalProps {
  visible: boolean;
  items: GroceryItem[];
  onResolve: (decisions: Record<string, 'keep' | 'remove'>) => void;
}

function OldCartModal({ visible, items, onResolve }: OldCartModalProps) {
  const [decisions, setDecisions] = useState<Record<string, 'keep' | 'remove'>>({});

  // Reset decisions whenever a new set of items appears
  useEffect(() => {
    if (visible) {
      const initial: Record<string, 'keep' | 'remove'> = {};
      items.forEach(i => {
        initial[i.key] = 'keep';
      });
      setDecisions(initial);
    }
  }, [visible, items]);

  if (!visible) return null;

  const setOne = (key: string, decision: 'keep' | 'remove') => {
    setDecisions(prev => ({ ...prev, [key]: decision }));
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Items still in your Cart</Text>
          <Text style={styles.modalSubtitle}>
            These items are left over from last week. Keep or remove each one?
          </Text>

          <ScrollView style={{ maxHeight: 320, marginTop: 12 }}>
            {items.map(item => {
              const choice = decisions[item.key] ?? 'keep';
              return (
                <View key={item.key} style={styles.modalRow}>
                  <Text style={[styles.itemName, { flex: 1 }]}>{item.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      style={[
                        styles.modalChoice,
                        choice === 'keep' && styles.modalChoiceActive,
                      ]}
                      onPress={() => setOne(item.key, 'keep')}
                    >
                      <Text
                        style={[
                          styles.modalChoiceText,
                          choice === 'keep' && styles.modalChoiceTextActive,
                        ]}
                      >
                        Keep
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.modalChoice,
                        choice === 'remove' && styles.modalChoiceRemove,
                      ]}
                      onPress={() => setOne(item.key, 'remove')}
                    >
                      <Text
                        style={[
                          styles.modalChoiceText,
                          choice === 'remove' && styles.modalChoiceTextActive,
                        ]}
                      >
                        Remove
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={styles.modalConfirm}
            onPress={() => onResolve(decisions)}
          >
            <Text style={styles.modalConfirmText}>Confirm</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { fontSize: 28, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },

  tipBanner: {
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.blue,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tipTitle: { color: COLORS.text, fontWeight: '600', fontSize: 14, marginBottom: 4 },
  tipBody: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  tipBold: { color: COLORS.text, fontWeight: '600' },
  tipDismiss: { color: COLORS.blue, fontWeight: '600', fontSize: 13 },

  scrollContent: { paddingHorizontal: 16, paddingTop: 4 },

  section: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  sectionMeta: { color: COLORS.textSecondary, fontSize: 12 },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
  },
  badgeText: { color: COLORS.text, fontSize: 11, fontWeight: '600' },

  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    paddingVertical: 8,
    fontStyle: 'italic',
  },

  itemName: { color: COLORS.text, fontSize: 15 },
  mealTag: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  // Planned cards
  plannedCard: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  plannedActions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionInStock: { backgroundColor: COLORS.green },
  actionNeedIt: { backgroundColor: COLORS.blue },
  actionSkip: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  actionSkipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },

  // Kitchen rows
  categoryHeader: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 4,
  },
  kitchenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: COLORS.elevated,
  },
  smallBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { color: COLORS.textSecondary, fontSize: 16, lineHeight: 18 },

  // Add row
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  addInput: {
    flex: 1,
    backgroundColor: COLORS.elevated,
    color: COLORS.text,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    borderRadius: 8,
    fontSize: 14,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: COLORS.elevated },
  addBtnText: { color: '#FFFFFF', fontSize: 20, fontWeight: '600', lineHeight: 22 },

  // Cart rows
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  strikethrough: {
    textDecorationLine: 'line-through',
    color: COLORS.textSecondary,
  },
  customLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontStyle: 'italic',
  },

  doneBtn: {
    marginTop: 16,
    backgroundColor: COLORS.green,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  doneBtnDisabled: { backgroundColor: COLORS.elevated },
  doneBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  doneHint: {
    color: COLORS.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },

  // Old-cart modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  modalSubtitle: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  modalChoice: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.elevated,
  },
  modalChoiceActive: { backgroundColor: COLORS.blue },
  modalChoiceRemove: { backgroundColor: COLORS.red },
  modalChoiceText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  modalChoiceTextActive: { color: '#FFFFFF' },
  modalConfirm: {
    marginTop: 14,
    backgroundColor: COLORS.blue,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalConfirmText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
