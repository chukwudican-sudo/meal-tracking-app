import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
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

// ─── Refined accent palette ───────────────────────────────────────────────────
// Tinted iOS-style chips: subtle background fill + bold accent text.
const ACCENT = {
  inStockBg: 'rgba(48, 209, 88, 0.18)',      // soft green tint
  inStockBorder: 'rgba(48, 209, 88, 0.45)',
  inStockText: '#30D158',
  needItBg: 'rgba(255, 159, 10, 0.18)',      // amber tint
  needItBorder: 'rgba(255, 159, 10, 0.45)',
  needItText: '#FF9F0A',
  skipBg: 'rgba(142, 142, 147, 0.10)',
  skipText: COLORS.textSecondary,
  doneBg: '#30D158',
  primaryBg: '#FF9F0A',                       // for + add buttons
  underline: '#FF9F0A',
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

const TAB_KEYS = ['planned', 'kitchen', 'cart'] as const;
type TabKey = (typeof TAB_KEYS)[number];
const TAB_LABELS: Record<TabKey, string> = {
  planned: 'Planned',
  kitchen: 'Kitchen',
  cart: 'Cart',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Screen ───────────────────────────────────────────────────────────────────

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

  const [kitchenInput, setKitchenInput] = useState('');
  const [cartInput, setCartInput] = useState('');

  // ─── Tab state + horizontal pager ─────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>('planned');
  const pagerRef = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);

  const goToTab = (tab: TabKey) => {
    setActiveTab(tab);
    const index = TAB_KEYS.indexOf(tab);
    pagerRef.current?.scrollTo({ x: index * pageWidth, animated: true });
  };

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth <= 0) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    const next = TAB_KEYS[idx] ?? 'planned';
    if (next !== activeTab) setActiveTab(next);
  };

  // Auto-refresh on Monday rollover
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
  const counts: Record<TabKey, number> = {
    planned: planned.length,
    kitchen: kitchen.length,
    cart: cart.length,
  };

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
        { text: 'Remove', style: 'destructive', onPress: () => removeGroceryItem(item.key) },
      ]
    );
  };

  // ─── Pages ────────────────────────────────────────────────────────────────

  const renderPlannedPage = () => (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {!grocery.hasSeenTip && (
        <View style={styles.tipBanner}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.tipTitle}>How this works</Text>
            <Text style={styles.tipBody}>
              Ingredients from your meal plan land here. Tap{' '}
              <Text style={styles.tipBold}>In stock</Text> if you have it,{' '}
              <Text style={styles.tipBold}>Need it</Text> to add to Cart, or{' '}
              <Text style={styles.tipBold}>Skip</Text> to remove.
            </Text>
          </View>
          <TouchableOpacity onPress={dismissGroceryTip} hitSlop={8}>
            <Text style={styles.tipDismiss}>Got it</Text>
          </TouchableOpacity>
        </View>
      )}

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
                  style={[styles.chipBtn, styles.chipInStock]}
                  onPress={() => sortIngredient(item.key, 'kitchen')}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipText, { color: ACCENT.inStockText }]}>In stock</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chipBtn, styles.chipNeedIt]}
                  onPress={() => sortIngredient(item.key, 'cart')}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipText, { color: ACCENT.needItText }]}>Need it</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chipBtn, styles.chipSkip]}
                  onPress={() => handleSkip(item)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipText, { color: ACCENT.skipText }]}>Skip</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
      )}
    </ScrollView>
  );

  const renderKitchenPage = () => (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder="Add what's in your kitchen…"
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
          Add what you already have so we can suggest meals from it.
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
                  <View key={item.key} style={styles.kitchenRow}>
                    <Text style={[styles.itemName, { flex: 1 }]}>{item.name}</Text>
                    <TouchableOpacity
                      style={[styles.chipBtn, styles.chipNeedIt]}
                      onPress={() => moveKitchenToCart(item.key)}
                    >
                      <Text style={[styles.chipText, { color: ACCENT.needItText }]}>→ Cart</Text>
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
    </ScrollView>
  );

  const renderCartPage = () => (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
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
              <View
                style={[
                  styles.checkbox,
                  item.struckThrough && {
                    borderColor: ACCENT.inStockText,
                    backgroundColor: ACCENT.inStockBg,
                  },
                ]}
              >
                {item.struckThrough && (
                  <Text style={[styles.checkmark, { color: ACCENT.inStockText }]}>✓</Text>
                )}
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

      <TouchableOpacity
        style={[styles.doneBtn, cart.length === 0 && styles.doneBtnDisabled]}
        onPress={handleDoneShopping}
        disabled={cart.length === 0}
      >
        <Text style={styles.doneBtnText}>Done shopping</Text>
      </TouchableOpacity>
      <Text style={styles.doneHint}>Tap when you&apos;re back from the store.</Text>
    </ScrollView>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Grocery</Text>
        <Text style={styles.subtitle}>{formatWeekLabel(grocery.weekStart)}</Text>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TAB_KEYS.map(key => {
          const active = activeTab === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.tabBtn}
              onPress={() => goToTab(key)}
              activeOpacity={0.7}
            >
              <View style={styles.tabLabelRow}>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {TAB_LABELS[key]}
                </Text>
                {counts[key] > 0 && (
                  <View
                    style={[
                      styles.tabCount,
                      active && { backgroundColor: ACCENT.underline },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabCountText,
                        active && { color: '#1A1207' },
                      ]}
                    >
                      {counts[key]}
                    </Text>
                  </View>
                )}
              </View>
              <View
                style={[
                  styles.tabUnderline,
                  active && { backgroundColor: ACCENT.underline },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Horizontal pager */}
      <View
        style={{ flex: 1 }}
        onLayout={e => setPageWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumEnd}
          keyboardShouldPersistTaps="handled"
          // iOS bounces by default; disable so swipe boundaries feel firm
          bounces={false}
          contentOffset={{ x: TAB_KEYS.indexOf(activeTab) * pageWidth, y: 0 }}
        >
          <View style={{ width: pageWidth }}>{renderPlannedPage()}</View>
          <View style={{ width: pageWidth }}>{renderKitchenPage()}</View>
          <View style={{ width: pageWidth }}>{renderCartPage()}</View>
        </ScrollView>

        {/* Page indicator dots — anchored to the bottom of the content area */}
        <View pointerEvents="none" style={styles.dotsRow}>
          {TAB_KEYS.map(key => {
            const active = activeTab === key;
            return (
              <View
                key={key}
                style={[
                  styles.dot,
                  active && {
                    backgroundColor: ACCENT.underline,
                    width: 18,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

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
    paddingBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },

  // ─── Tabs ───────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 12,
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 10,
  },
  tabLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  tabLabelActive: { color: COLORS.text },
  tabCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountText: { color: COLORS.textSecondary, fontSize: 10, fontWeight: '700' },
  tabUnderline: {
    height: 2.5,
    width: '70%',
    backgroundColor: 'transparent',
    borderRadius: 2,
  },

  // ─── Pages ──────────────────────────────────────────────────────────────
  page: { flex: 1 },
  pageContent: { padding: 16, paddingBottom: 60 },

  // ─── Page indicator dots ────────────────────────────────────────────────
  dotsRow: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.elevated,
  },

  // ─── Tip banner ─────────────────────────────────────────────────────────
  tipBanner: {
    padding: 14,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ACCENT.underline,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  tipTitle: { color: COLORS.text, fontWeight: '600', fontSize: 14, marginBottom: 4 },
  tipBody: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  tipBold: { color: COLORS.text, fontWeight: '600' },
  tipDismiss: { color: ACCENT.underline, fontWeight: '700', fontSize: 13 },

  // ─── Empty / shared text ────────────────────────────────────────────────
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    paddingVertical: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  itemName: { color: COLORS.text, fontSize: 15 },
  mealTag: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  // ─── Planned cards ─────────────────────────────────────────────────────
  plannedCard: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  plannedActions: { flexDirection: 'row', gap: 6 },

  // ─── Tinted chip buttons (refined palette) ──────────────────────────────
  chipBtn: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipInStock: {
    backgroundColor: ACCENT.inStockBg,
    borderColor: ACCENT.inStockBorder,
  },
  chipNeedIt: {
    backgroundColor: ACCENT.needItBg,
    borderColor: ACCENT.needItBorder,
  },
  chipSkip: {
    backgroundColor: ACCENT.skipBg,
    borderColor: COLORS.border,
  },
  chipText: { fontSize: 12, fontWeight: '700' },

  // ─── Kitchen rows ───────────────────────────────────────────────────────
  categoryHeader: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  kitchenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
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

  // ─── Add row ────────────────────────────────────────────────────────────
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  addInput: {
    flex: 1,
    backgroundColor: COLORS.card,
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
    backgroundColor: ACCENT.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: COLORS.elevated },
  addBtnText: { color: '#1A1207', fontSize: 22, fontWeight: '700', lineHeight: 24 },

  // ─── Cart rows ──────────────────────────────────────────────────────────
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { fontSize: 14, fontWeight: '800' },
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
    marginTop: 22,
    backgroundColor: ACCENT.doneBg,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneBtnDisabled: { backgroundColor: COLORS.elevated },
  doneBtnText: { color: '#0E1A12', fontSize: 15, fontWeight: '800' },
  doneHint: {
    color: COLORS.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },

  // ─── Old-cart modal ─────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
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
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.elevated,
  },
  modalChoiceActive: {
    backgroundColor: ACCENT.inStockBg,
    borderWidth: 1,
    borderColor: ACCENT.inStockBorder,
  },
  modalChoiceRemove: {
    backgroundColor: 'rgba(255,59,48,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.45)',
  },
  modalChoiceText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
  modalChoiceTextActive: { color: COLORS.text },
  modalConfirm: {
    marginTop: 14,
    backgroundColor: ACCENT.primaryBg,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalConfirmText: { color: '#1A1207', fontWeight: '800', fontSize: 14 },
});
