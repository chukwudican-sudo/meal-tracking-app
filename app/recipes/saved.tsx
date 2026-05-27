import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecipeCard } from '@/components/recipes/RecipeCard';
import { COLORS } from '@/constants/theme';
import { toRecipeInputFromSaved, useRecipeActions } from '@/hooks/useRecipeActions';
import type { SavedRecipe } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const TAB_DEFS = [
  { key: 'favourites' as const, label: 'Favourites' },
  { key: 'recent' as const,     label: 'Recently Added' },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function SavedRecipesScreen() {
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const { favourite } = useRecipeActions();

  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // Page width derived from layout for accurate paging on iPad/foldables.
  const [pageWidth, setPageWidth] = useState(SCREEN_WIDTH - 32);

  const favourites = useMemo(
    () => savedRecipes.filter(s => s.favourited).sort(byAddedAtDesc),
    [savedRecipes]
  );
  const recent = useMemo(
    () => [...savedRecipes].sort(byAddedAtDesc),
    [savedRecipes]
  );

  const goToTab = (idx: number) => {
    setActiveIndex(idx);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: idx * pageWidth, animated: true });
    });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / pageWidth);
    if (idx !== activeIndex) setActiveIndex(idx);
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  const openRecipe = (s: SavedRecipe) => {
    // Saved recipes route through the recipe detail page using their saved id.
    router.push({ pathname: '/recipe/[id]', params: { id: s.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Saved Recipes</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.tabsRow}>
        {TAB_DEFS.map((t, idx) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => goToTab(idx)}
            style={styles.tab}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabLabel, activeIndex === idx && styles.tabLabelActive]}>
              {t.label}
              <Text style={styles.tabCount}>  {idx === 0 ? favourites.length : recent.length}</Text>
            </Text>
            <View style={[styles.tabUnderline, activeIndex === idx && styles.tabUnderlineActive]} />
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={e => setPageWidth(e.nativeEvent.layout.width)}
      >
        <SavedList
          pageWidth={pageWidth}
          recipes={favourites}
          emptyMessage="No favourites yet. Tap the heart on any recipe to save it."
          onPress={openRecipe}
          onToggleFavourite={(s) => favourite(toRecipeInputFromSaved(s))}
        />
        <SavedList
          pageWidth={pageWidth}
          recipes={recent}
          emptyMessage="Recipes you add or favourite will appear here."
          onPress={openRecipe}
          onToggleFavourite={(s) => favourite(toRecipeInputFromSaved(s))}
        />
      </ScrollView>

      <View style={styles.dotsRow}>
        {TAB_DEFS.map((_, idx) => (
          <View
            key={idx}
            style={[styles.dot, activeIndex === idx && styles.dotActive]}
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

function byAddedAtDesc(a: SavedRecipe, b: SavedRecipe) {
  return (b.addedAt || '').localeCompare(a.addedAt || '');
}

interface SavedListProps {
  pageWidth: number;
  recipes: SavedRecipe[];
  emptyMessage: string;
  onPress: (s: SavedRecipe) => void;
  onToggleFavourite: (s: SavedRecipe) => void;
}

function SavedList({ pageWidth, recipes, emptyMessage, onPress, onToggleFavourite }: SavedListProps) {
  return (
    <ScrollView
      style={{ width: pageWidth }}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
    >
      {recipes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : (
        recipes.map(r => (
          <RecipeCard
            key={r.id}
            variant="row"
            name={r.name}
            calories={r.calories}
            cookTimeMin={r.cookTimeMin}
            category={r.category}
            favourited={r.favourited}
            onPress={() => onPress(r)}
            onToggleFavourite={() => onToggleFavourite(r)}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  title: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10 },
  tabLabel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  tabLabelActive: { color: COLORS.text },
  tabCount: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '500' },
  tabUnderline: { height: 3, width: '60%', marginTop: 8, backgroundColor: 'transparent', borderRadius: 2 },
  tabUnderlineActive: { backgroundColor: COLORS.green },

  pageContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },

  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.green },
});
