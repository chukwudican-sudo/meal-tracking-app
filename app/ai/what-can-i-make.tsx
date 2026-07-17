import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { KitchenScanModal } from '@/components/grocery/KitchenScanModal';
import { Screen } from '@/components/Screen';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { normalizeIngredientName } from '@/constants/ingredientCategories';
import { COLORS } from '@/constants/theme';
import type { GroceryItem, IngredientCategory, RecipeTemplate } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

const INITIAL = 6;
const MORE = 4;

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

const CATEGORY_DOT: Record<IngredientCategory, string> = {
  'Proteins': '#f87171',
  'Carbs & Grains': '#facc15',
  'Fruits & Vegetables': '#4ade80',
  'Dairy': '#60a5fa',
  'Oils & Fats': '#fb923c',
  'Spices & Seasonings': '#a78bfa',
  'Condiments': '#5eead4',
  'Other': 'rgba(255,255,255,0.45)',
};

interface Suggestion {
  recipe: RecipeTemplate;
  missing: string[]; // ingredient names missing from the kitchen
}

type Phase = 'overview' | 'loading' | 'results';

export default function WhatCanIMakeScreen() {
  const recipes = useMealStore(s => s.recipes);
  const grocery = useMealStore(s => s.grocery);
  const profile = useMealStore(s => s.profile);
  const addManualKitchenItem = useMealStore(s => s.addManualKitchenItem);
  const addManualCartItem = useMealStore(s => s.addManualCartItem);
  const showToast = useToastStore(s => s.showToast);

  const kitchenItems = useMemo(
    () => Object.values(grocery.items).filter(i => i.section === 'kitchen'),
    [grocery.items],
  );
  const kitchenCount = kitchenItems.length;
  const kitchenEmpty = kitchenCount === 0;

  const kitchenKeys = useMemo(() => {
    const set = new Set<string>();
    kitchenItems.forEach(i => set.add(i.key));
    return set;
  }, [kitchenItems]);

  const byCategory = useMemo(() => {
    const groups = {} as Record<IngredientCategory, GroceryItem[]>;
    CATEGORY_ORDER.forEach(c => { groups[c] = []; });
    kitchenItems.forEach(item => groups[item.category]?.push(item));
    return groups;
  }, [kitchenItems]);

  const dietary = (profile.dietaryRestrictions ?? []).map(d => d.toLowerCase());
  const allergies = (profile.allergies ?? []).map(a => a.toLowerCase());

  // Placeholder matcher (AI shell): score every recipe by how many of its
  // ingredients are already in the Kitchen, respecting allergies/diet.
  const pool = useMemo<Suggestion[]>(() => {
    const list: Suggestion[] = [];
    for (const r of recipes) {
      const hasAllergen = r.ingredients.some(i =>
        allergies.some(a => a && i.name.toLowerCase().includes(a)),
      );
      if (hasAllergen) continue;
      if (dietary.includes('vegetarian') || dietary.includes('vegan')) {
        const MEAT = ['chicken', 'beef', 'turkey', 'salmon', 'tuna', 'pork', 'bacon', 'fish'];
        if (r.ingredients.some(i => MEAT.some(m => i.name.toLowerCase().includes(m)))) continue;
      }
      const missing = r.ingredients
        .filter(ing => !kitchenKeys.has(normalizeIngredientName(ing.name)))
        .map(i => i.name);
      list.push({ recipe: r, missing });
    }
    list.sort((a, b) => a.missing.length - b.missing.length);
    const close = list.filter(s => s.missing.length <= 2);
    return close.length > 0 ? close : list.slice(0, 8);
  }, [recipes, kitchenKeys, dietary, allergies]);

  const [phase, setPhase] = useState<Phase>('overview');
  const [count, setCount] = useState(INITIAL);
  const [input, setInput] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  const shown = useMemo<Suggestion[]>(() => {
    if (pool.length === 0) return [];
    return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
  }, [pool, count]);

  const perfect = shown.filter(s => s.missing.length === 0);
  const partial = shown.filter(s => s.missing.length > 0);

  const handleBack = () => {
    if (phase !== 'overview') { setPhase('overview'); return; }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  const handleAddItem = () => {
    const name = input.trim();
    if (!name) return;
    addManualKitchenItem(name);
    setInput('');
    showToast('Added to kitchen');
  };

  const findRecipes = () => {
    setCount(INITIAL);
    setPhase('loading');
    setTimeout(() => setPhase('results'), 900);
  };

  const openConcept = (recipe: RecipeTemplate) => {
    router.push({ pathname: '/ai/custom', params: { recipeId: recipe.id } });
  };

  const addMissing = (name: string) => {
    addManualCartItem(name);
    showToast('Added to Cart');
  };

  const inputBar = (
    <View style={styles.inputWrap}>
      <Ionicons name="add" size={14} color="rgba(255,255,255,0.4)" />
      <TextInput
        style={styles.input}
        placeholder="Add an item..."
        placeholderTextColor="rgba(255,255,255,0.3)"
        value={input}
        onChangeText={setInput}
        onSubmitEditing={handleAddItem}
        returnKeyType="done"
      />
    </View>
  );

  const renderResultCard = (s: Suggestion, key: string) => (
    <View key={key}>
      <RecipeCard
        variant="row"
        name={s.recipe.name}
        calories={s.recipe.calories}
        cookTimeMin={s.recipe.cookTimeMin}
        category={s.recipe.category}
        onPress={() => openConcept(s.recipe)}
      />
      {s.missing.length > 0 ? (
        <View style={styles.missingWrap}>
          <Text style={styles.missingLabel}>Missing</Text>
          <View style={styles.pillRow}>
            {s.missing.map((name, i) => (
              <TouchableOpacity
                key={`${name}-${i}`}
                style={styles.missingChip}
                onPress={() => addMissing(name)}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={13} color={COLORS.green} />
                <Text style={styles.missingChipText}>{name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={16} color="#cccccc" />
        </TouchableOpacity>
        <Text style={styles.title}>What can I make?</Text>
        <View style={styles.backBtn} />
      </View>

      {/* ── Kitchen Overview ─────────────────────────────────────────────── */}
      {phase === 'overview' ? (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {kitchenEmpty ? (
            <View style={styles.emptyBlock}>
              <TouchableOpacity style={styles.emptyCamera} onPress={() => setScanOpen(true)} activeOpacity={0.85}>
                <Ionicons name="camera-outline" size={28} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
              <Text style={styles.emptyText}>Scan your kitchen to get started</Text>
              <View style={styles.emptyInput}>{inputBar}</View>
              <Text style={styles.hint}>Scan your fridge or pantry to add items quickly</Text>
            </View>
          ) : (
            <>
              {/* Kitchen status card */}
              <View style={styles.kitchenCard}>
                <MaterialCommunityIcons name="fridge-outline" size={18} color="#4ade80" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.kitchenCardTitle}>Your kitchen</Text>
                  <Text style={styles.kitchenCardSub}>
                    {kitchenCount} item{kitchenCount === 1 ? '' : 's'} available
                  </Text>
                </View>
              </View>

              {/* Add row */}
              <View style={styles.addRow}>
                {inputBar}
                <TouchableOpacity style={styles.cameraBtn} onPress={() => setScanOpen(true)} activeOpacity={0.85}>
                  <Ionicons name="camera-outline" size={18} color="rgba(255,255,255,0.5)" />
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>Scan your fridge or pantry to add items quickly</Text>

              {/* Categories */}
              <View style={styles.categories}>
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
                      <View style={styles.pillRow}>
                        {sorted.map(item => (
                          <View key={item.key} style={styles.itemPill}>
                            <Text style={styles.itemPillText}>{item.name}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Find recipes */}
              <TouchableOpacity style={styles.findBtn} onPress={findRecipes} activeOpacity={0.85}>
                <Text style={styles.findBtnText}>Find recipes</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      ) : null}

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {phase === 'loading' ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={COLORS.green} />
          <Text style={styles.loadingText}>Checking what you can make…</Text>
        </View>
      ) : null}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {phase === 'results' ? (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {perfect.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Ready to cook</Text>
              <Text style={styles.sectionSub}>You have everything you need.</Text>
              {perfect.map((s, i) => renderResultCard(s, `perfect-${i}`))}
            </>
          ) : null}

          {partial.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, perfect.length > 0 && { marginTop: 22 }]}>
                You&apos;re close
              </Text>
              <Text style={styles.sectionSub}>Missing 1–2 items — tap one to add it to your Cart.</Text>
              {partial.map((s, i) => renderResultCard(s, `partial-${i}`))}
            </>
          ) : null}

          {perfect.length === 0 && partial.length === 0 ? (
            <View style={styles.centerWrap}>
              <Text style={styles.sectionSub}>No suggestions yet. Try adding more to your kitchen.</Text>
            </View>
          ) : null}

          {shown.length > 0 ? (
            <TouchableOpacity style={styles.suggestMore} onPress={() => setCount(c => c + MORE)} activeOpacity={0.85}>
              <Text style={styles.suggestMoreText}>Suggest More</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : null}

      <KitchenScanModal visible={scanOpen} onClose={() => setScanOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, color: '#ffffff', fontSize: 16, fontWeight: '500', textAlign: 'center' },

  body: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },

  // Kitchen status card
  kitchenCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  kitchenCardTitle: { color: '#ffffff', fontSize: 15, fontWeight: '500' },
  kitchenCardSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 2 },

  // Add row
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  input: { flex: 1, color: '#ffffff', fontSize: 13, padding: 0 },
  cameraBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  hint: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 6 },

  // Categories
  categories: { marginTop: 20 },
  catBlock: { marginBottom: 16 },
  catHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  catHeader: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  itemPill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  itemPillText: { color: '#dddddd', fontSize: 13 },

  // Find recipes
  findBtn: {
    marginTop: 24,
    backgroundColor: '#4ade80',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  findBtnText: { color: '#000000', fontSize: 15, fontWeight: '500' },

  // Empty state
  emptyBlock: { alignItems: 'center', paddingTop: 48 },
  emptyCamera: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', marginTop: 18 },
  emptyInput: { alignSelf: 'stretch', marginTop: 20 },

  // Loading
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: '600' },

  // Results
  sectionTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  sectionSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4, marginBottom: 12 },
  missingWrap: { marginTop: -4, marginBottom: 12, paddingHorizontal: 2 },
  missingLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  missingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.green + '1F',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  missingChipText: { color: COLORS.green, fontSize: 12, fontWeight: '700' },

  suggestMore: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  suggestMoreText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
