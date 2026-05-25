import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS } from '@/constants/theme';
import type { GroceryItem } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useNavSourceStore } from '@/store/useNavSourceStore';
import { useToastStore } from '@/store/useToastStore';

const ACCENT = {
  green: '#30D158',
  amber: '#FF9F0A',
  underline: '#FF9F0A',
};

interface Props {
  // Tab path that the Library tab should treat as the "back to" target
  // when the user taps "Go to Kitchen" from inside this section. Defaults
  // to the Plan tab.
  sourceTab?: '/(tabs)' | '/(tabs)/plan' | '/(tabs)/library' | '/(tabs)/profile';
}

export function PlannedIngredientsSection({ sourceTab = '/(tabs)/plan' }: Props) {
  const grocery = useMealStore(s => s.grocery);
  const sortIngredient = useMealStore(s => s.sortIngredient);
  const skipIngredient = useMealStore(s => s.skipIngredient);
  const dismissGroceryTip = useMealStore(s => s.dismissGroceryTip);
  const showToast = useToastStore(s => s.showToast);
  const setKitchenSource = useNavSourceStore(s => s.setKitchenSource);

  const planned = useMemo(
    () =>
      Object.values(grocery.items)
        .filter(i => i.section === 'planned')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [grocery.items]
  );
  const count = planned.length;

  // Auto-expand on first non-empty load and whenever new items arrive.
  // Otherwise default to collapsed and remember user's last toggle.
  const prevCountRef = useRef(0);
  const initializedRef = useRef(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevCountRef.current = count;
      if (count > 0) setExpanded(true);
      return;
    }
    if (count > prevCountRef.current) {
      setExpanded(true);
    }
    prevCountRef.current = count;
  }, [count]);

  const handleSkip = (item: GroceryItem) => {
    const usedIn = item.mealNames?.[0] ?? 'a meal';
    Alert.alert(
      'Skip ingredient?',
      `This ingredient is used in ${usedIn}. Skip anyway?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: () => skipIngredient(item.key),
        },
      ]
    );
  };

  const handleInStock = (item: GroceryItem) => {
    sortIngredient(item.key, 'kitchen');
    showToast('Moved to Kitchen');
  };

  const handleNeedIt = (item: GroceryItem) => {
    sortIngredient(item.key, 'cart');
    showToast('Added to Cart');
  };

  const goToKitchen = () => {
    setKitchenSource(sourceTab);
    router.navigate('/(tabs)/library');
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setExpanded(prev => !prev)}
        hitSlop={6}
      >
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.title}>Planned Ingredients</Text>
          {count > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{count}</Text>
            </View>
          )}
        </View>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {!expanded && count > 0 && (
        <Text style={styles.collapsedHint}>
          {count} {count === 1 ? 'item' : 'items'} to sort
        </Text>
      )}

      {expanded && (
        <View style={styles.body}>
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
            planned.map(item => (
              <View key={item.key} style={styles.itemRow}>
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
            ))
          )}

          <TouchableOpacity
            style={styles.goLink}
            onPress={goToKitchen}
            activeOpacity={0.7}
          >
            <Text style={styles.goLinkText}>Go to Kitchen →</Text>
          </TouchableOpacity>
        </View>
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
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  chevron: {
    color: COLORS.textSecondary,
    fontSize: 16,
    paddingHorizontal: 6,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT.amber,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#1A1207',
    fontSize: 11,
    fontWeight: '800',
  },
  collapsedHint: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },

  body: {
    marginTop: 10,
  },

  tipBanner: {
    padding: 12,
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ACCENT.underline,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tipTitle: { color: COLORS.text, fontWeight: '600', fontSize: 13, marginBottom: 2 },
  tipBody: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  tipBold: { color: COLORS.text, fontWeight: '600' },
  tipDismiss: { color: ACCENT.underline, fontWeight: '700', fontSize: 13 },

  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    paddingVertical: 16,
    fontStyle: 'italic',
    textAlign: 'center',
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
  chipInStock: {
    backgroundColor: ACCENT.green,
    borderColor: ACCENT.green,
  },
  chipInStockText: {
    color: '#0E1A12',
    fontSize: 12,
    fontWeight: '800',
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
  chipSkip: {
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  chipSkipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },

  goLink: {
    marginTop: 12,
    paddingVertical: 6,
    alignSelf: 'flex-end',
  },
  goLinkText: {
    color: ACCENT.amber,
    fontSize: 13,
    fontWeight: '700',
  },
});
