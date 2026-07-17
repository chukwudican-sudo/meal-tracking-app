import { router } from 'expo-router';
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
import { Screen } from '@/components/Screen';

import { COLORS } from '@/constants/theme';
import type { GroceryItem } from '@/store/types';
import { useMealStore, mondayOfWeek } from '@/store/useMealStore';

const ACCENT = {
  green: '#30D158',
  greenBg: 'rgba(48, 209, 88, 0.18)',
  amber: '#FF9F0A',
};

function toIsoDateLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function CartScreen() {
  const grocery = useMealStore(s => s.grocery);
  const refreshGroceryWeek = useMealStore(s => s.refreshGroceryWeek);
  const toggleCartStrikethrough = useMealStore(s => s.toggleCartStrikethrough);
  const addManualCartItem = useMealStore(s => s.addManualCartItem);
  const removeGroceryItem = useMealStore(s => s.removeGroceryItem);
  const doneShopping = useMealStore(s => s.doneShopping);
  const resolveOldCartItems = useMealStore(s => s.resolveOldCartItems);

  const [cartInput, setCartInput] = useState('');

  // Refresh the grocery week if needed (Monday rollover) when Cart opens.
  useEffect(() => {
    const today = toIsoDateLocal(new Date());
    const thisMonday = mondayOfWeek(today);
    if (grocery.weekStart !== thisMonday) {
      refreshGroceryWeek(thisMonday);
    }
  }, [grocery.weekStart, refreshGroceryWeek]);

  const cart = useMemo(
    () =>
      Object.values(grocery.items)
        .filter(i => i.section === 'cart')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [grocery.items]
  );

  const oldCartItems = useMemo(
    () =>
      grocery.cartOldWeekItems
        .map(key => grocery.items[key])
        .filter(Boolean) as GroceryItem[],
    [grocery.cartOldWeekItems, grocery.items]
  );
  const oldCartVisible = oldCartItems.length > 0;

  const handleAddCart = () => {
    const name = cartInput.trim();
    if (!name) return;
    addManualCartItem(name);
    setCartInput('');
  };

  const handleDoneShopping = () => {
    const struck = cart.filter(i => i.struckThrough).length;
    if (struck === 0) {
      Alert.alert(
        'Nothing checked off',
        'Tap items in your Cart to mark them as bought first.'
      );
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
      `Remove "${item.name}" from your cart?`,
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

  const handleViewKitchen = () => {
    // Kitchen is its own modal route. router.push stacks it on top of Cart,
    // so the back arrow naturally returns to Cart.
    router.push('/kitchen');
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Cart</Text>
          {cart.length > 0 && (
            <Text style={styles.subtitle}>
              {cart.filter(i => !i.struckThrough).length} to buy
            </Text>
          )}
        </View>
        {/* Spacer to balance back button width */}
        <View style={styles.backBtn} />
      </View>

      {/* Add custom item input */}
      <View style={styles.addRowWrap}>
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
      </View>

      {/* Items list */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {cart.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>🛒</Text>
            <Text style={styles.emptyText}>Nothing to buy right now.</Text>
            <Text style={styles.emptySub}>
              Items you mark as &ldquo;Need it&rdquo; in your plan will land here.
            </Text>
          </View>
        ) : (
          cart.map(item => (
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
                    borderColor: ACCENT.green,
                    backgroundColor: ACCENT.greenBg,
                  },
                ]}
              >
                {item.struckThrough && (
                  <Text style={[styles.checkmark, { color: ACCENT.green }]}>✓</Text>
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
          style={styles.viewKitchenLink}
          onPress={handleViewKitchen}
          activeOpacity={0.7}
        >
          <Text style={styles.viewKitchenText}>View Kitchen →</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Footer pinned to bottom */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.doneBtn, cart.length === 0 && styles.doneBtnDisabled]}
          onPress={handleDoneShopping}
          disabled={cart.length === 0}
        >
          <Text style={styles.doneBtnText}>Done shopping</Text>
        </TouchableOpacity>
        <Text style={styles.doneHint}>Tap when you&apos;re back from the store.</Text>
      </View>

      <OldCartModal
        visible={oldCartVisible}
        items={oldCartItems}
        onResolve={resolveOldCartItems}
      />
    </Screen>
  );
}

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },

  addRowWrap: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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

  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },

  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 14,
    opacity: 0.7,
  },
  emptyText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  emptySub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 24,
  },

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
  itemName: { color: COLORS.text, fontSize: 15 },
  customLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontStyle: 'italic',
  },

  viewKitchenLink: {
    marginTop: 18,
    paddingVertical: 10,
    alignSelf: 'center',
  },
  viewKitchenText: {
    color: ACCENT.amber,
    fontSize: 13,
    fontWeight: '700',
  },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  doneBtn: {
    backgroundColor: ACCENT.green,
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
    marginTop: 6,
  },

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
    backgroundColor: ACCENT.greenBg,
    borderWidth: 1,
    borderColor: ACCENT.green,
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
    backgroundColor: ACCENT.amber,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalConfirmText: { color: '#1A1207', fontWeight: '800', fontSize: 14 },
});
