import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecipeCard } from '@/components/recipes/RecipeCard';
import { COLORS } from '@/constants/theme';
import { toRecipeInputFromSaved, useRecipeActions } from '@/hooks/useRecipeActions';
import type {
  RecipeCategory,
  RecipeTemplate,
  SavedRecipe,
} from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useUndoStore } from '@/store/useUndoStore';
import { applyRecipeSwap } from '@/lib/recipeSwap';

type TabKey = 'all' | 'saved' | 'recent' | 'recipes';

const TAB_DEFS: { key: TabKey; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'saved',   label: 'Saved' },
  { key: 'recent',  label: 'Recent' },
  { key: 'recipes', label: 'Recipes' },
];

const FILTER_OPTIONS: { label: string; category: RecipeCategory | 'All' }[] = [
  { label: 'All',       category: 'All' },
  { label: 'Breakfast', category: 'Breakfast' },
  { label: 'Snacks',    category: 'Snacks' },
  { label: 'Lunch',     category: 'Lunch' },
  { label: 'Dinner',    category: 'Dinner' },
];

const NEW_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Context = 'saved-recipes' | 'swap' | 'search-tab';

interface Props {
  mode: 'full' | 'embedded';
  context: Context;
  swapFilter?: RecipeCategory | 'All';
  // Called before any navigation away (preview / create new). Used by the
  // embedded Search tab to close the host modal first so the pushed route is
  // not hidden behind it.
  onBeforeNavigate?: () => void;
}

// Premade templates project into the same shape as a SavedRecipe so the whole
// page can render a single normalized list type.
function templateToSavedLike(t: RecipeTemplate): SavedRecipe {
  return {
    id:          t.id,
    recipeId:    t.id,
    name:        t.name,
    category:    t.category,
    calories:    t.calories,
    cookTimeMin: t.cookTimeMin,
    macros:      t.macros,
    ingredients: t.ingredients,
    steps:       t.steps,
    difficulty:  t.difficulty,
    source:      'premade',
    favourited:  false,
    addedAt:     '',
  };
}

function defaultIndexForContext(context: Context): number {
  if (context === 'saved-recipes') return 1; // Saved
  if (context === 'search-tab') return 2;     // Recent
  return 0;                                    // swap → All
}

export function SavedRecipesView({ mode, context, swapFilter = 'All', onBeforeNavigate }: Props) {
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const recipes = useMealStore(s => s.recipes);
  const viewedRecipeIds = useMealStore(s => s.viewedRecipeIds);
  const pendingSwap = useMealStore(s => s.pendingSwap);
  const clearPendingSwap = useMealStore(s => s.clearPendingSwap);
  const showUndo = useUndoStore(s => s.showUndo);
  const { addToToday } = useRecipeActions();
  const insets = useSafeAreaInsets();

  const isSwap = context === 'swap';

  const [activeIndex, setActiveIndex] = useState(() => defaultIndexForContext(context));
  const [filter, setFilter] = useState<RecipeCategory | 'All'>(swapFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(SCREEN_WIDTH);
  const [tabsWidth, setTabsWidth] = useState(SCREEN_WIDTH);
  const underlineAnim = useRef(new Animated.Value(defaultIndexForContext(context))).current;

  const newRecipeIds = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    savedRecipes.forEach(r => {
      if (r.source === 'premade') return;
      if (viewedRecipeIds.includes(r.id)) return;
      const added = r.addedAt ? new Date(r.addedAt).getTime() : 0;
      if (added && now - added <= NEW_WINDOW_MS) set.add(r.id);
    });
    return set;
  }, [savedRecipes, viewedRecipeIds]);

  // ─── Base lists per tab ────────────────────────────────────────────────
  const templatesAsSaved = useMemo(
    () => recipes.map(templateToSavedLike).sort(byCategoryName),
    [recipes]
  );

  const allList = useMemo(() => {
    const savedRecipeIds = new Set(
      savedRecipes.map(s => s.recipeId).filter((x): x is string => !!x)
    );
    const savedSorted = [...savedRecipes].sort(byAddedAtDesc);
    const premadeNotSaved = templatesAsSaved.filter(t => !savedRecipeIds.has(t.id));
    return [...savedSorted, ...premadeNotSaved];
  }, [savedRecipes, templatesAsSaved]);

  const savedList = useMemo(
    () => savedRecipes.filter(s => s.favourited).sort(byAddedAtDesc),
    [savedRecipes]
  );
  const recentList = useMemo(
    () => savedRecipes.filter(s => s.source !== 'premade').sort(byAddedAtDesc),
    [savedRecipes]
  );

  // Apply the meal-type filter + name search to whichever base list.
  const applyView = (list: SavedRecipe[]): SavedRecipe[] => {
    const q = searchQuery.trim().toLowerCase();
    return list.filter(r => {
      if (filter !== 'All' && r.category !== filter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  };

  const pages = useMemo(
    () => [allList, savedList, recentList, templatesAsSaved].map(applyView),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allList, savedList, recentList, templatesAsSaved, filter, searchQuery]
  );

  // Slide the underline smoothly whenever the active tab changes.
  useEffect(() => {
    Animated.timing(underlineAnim, {
      toValue: activeIndex,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [activeIndex, underlineAnim]);

  const goToTab = (idx: number) => {
    setActiveIndex(idx);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: idx * pageWidth, animated: true });
    });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    if (idx !== activeIndex) setActiveIndex(idx);
  };

  const handleBack = () => {
    if (isSwap) clearPendingSwap();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  const openPreview = (s: SavedRecipe) => {
    onBeforeNavigate?.();
    router.push({ pathname: '/recipe/[id]', params: { id: s.id } });
  };

  const handlePick = (s: SavedRecipe) => {
    if (!isSwap || !pendingSwap) {
      openPreview(s);
      return;
    }
    const undo = applyRecipeSwap(pendingSwap, s);
    clearPendingSwap();
    showUndo({ message: `Swapped to ${s.name}`, undo });
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  const handleAdd = (s: SavedRecipe) => {
    if (s.source === 'premade') {
      addToToday(toRecipeInputFromSaved(s), { save: false });
    } else {
      addToToday(toRecipeInputFromSaved(s));
    }
  };

  const handleCreateNew = () => {
    onBeforeNavigate?.();
    router.push({ pathname: '/ai/custom', params: isSwap ? { swap: 'true' } : {} });
  };

  const title =
    context === 'swap' ? 'Swap Meal'
    : context === 'saved-recipes' ? 'Saved Recipes'
    : null;

  const emptyFor = (key: TabKey): string => {
    switch (key) {
      case 'saved':   return 'Nothing saved yet';
      case 'recent':  return 'No recent recipes yet';
      case 'recipes': return 'No recipes available';
      default:        return 'No recipes yet';
    }
  };

  return (
    <View style={styles.container}>
      {/* Title header (hidden when embedded) */}
      {mode === 'full' && title ? (
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.iconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <View style={styles.iconBtn} />
        </View>
      ) : null}

      {/* Search row + filter icon */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search recipes…"
            placeholderTextColor={COLORS.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <TouchableOpacity
          onPress={() => setFilterOpen(true)}
          style={styles.filterIconBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="options-outline" size={20} color={filter === 'All' ? COLORS.text : COLORS.green} />
          {filter !== 'All' ? <View style={styles.filterDot} /> : null}
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow} onLayout={e => setTabsWidth(e.nativeEvent.layout.width)}>
        {TAB_DEFS.map((t, idx) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => goToTab(idx)}
            style={styles.tab}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabLabel, activeIndex === idx && styles.tabLabelActive]}>
              {t.label}
            </Text>
            <View style={styles.tabUnderlineSpacer} />
          </TouchableOpacity>
        ))}
        {(() => {
          const innerTabW = (tabsWidth - 32) / TAB_DEFS.length;
          const underlineW = innerTabW * 0.6;
          const left = underlineAnim.interpolate({
            inputRange: [0, 1, 2, 3],
            outputRange: [0, 1, 2, 3].map(i => 16 + innerTabW * i + innerTabW * 0.2),
          });
          return (
            <Animated.View
              pointerEvents="none"
              style={[styles.animatedUnderline, { width: underlineW, left }]}
            />
          );
        })()}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
        onLayout={e => setPageWidth(e.nativeEvent.layout.width)}
        keyboardShouldPersistTaps="handled"
      >
        {TAB_DEFS.map((t, idx) => (
          <SavedList
            key={t.key}
            pageWidth={pageWidth}
            recipes={pages[idx]}
            newRecipeIds={newRecipeIds}
            emptyMessage={emptyFor(t.key)}
            showAdd={!isSwap}
            onPress={handlePick}
            onAdd={handleAdd}
          />
        ))}
      </ScrollView>

      {/* Create new recipe — floating action button */}
      <TouchableOpacity
        style={[styles.fab, { bottom: Math.max(insets.bottom, 12) + 12 }]}
        onPress={handleCreateNew}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>

      {/* Filter popup */}
      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.filterBackdrop} onPress={() => setFilterOpen(false)}>
          <Pressable style={styles.filterCard} onPress={() => {}}>
            <Text style={styles.filterCardTitle}>Filter by meal type</Text>
            {FILTER_OPTIONS.map(opt => {
              const active = filter === opt.category;
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.filterOption, active && styles.filterOptionActive]}
                  onPress={() => { setFilter(opt.category); setFilterOpen(false); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterOptionText, active && styles.filterOptionTextActive]}>{opt.label}</Text>
                  {active ? <Ionicons name="checkmark" size={18} color={COLORS.green} /> : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}


function byAddedAtDesc(a: SavedRecipe, b: SavedRecipe) {
  return (b.addedAt || '').localeCompare(a.addedAt || '');
}

function byCategoryName(a: SavedRecipe, b: SavedRecipe) {
  return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
}

// ─── List page ─────────────────────────────────────────────────────────────────

interface SavedListProps {
  pageWidth: number;
  recipes: SavedRecipe[];
  newRecipeIds: Set<string>;
  emptyMessage: string;
  showAdd: boolean;
  onPress: (s: SavedRecipe) => void;
  onAdd: (s: SavedRecipe) => void;
}

function SavedList({ pageWidth, recipes, newRecipeIds, emptyMessage, showAdd, onPress, onAdd }: SavedListProps) {
  return (
    <ScrollView
      style={{ width: pageWidth }}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
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
            isNew={newRecipeIds.has(r.id)}
            onPress={() => onPress(r)}
            onAdd={showAdd ? () => onAdd(r) : undefined}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

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

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  searchBox: {
    flex: 1,
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
  filterIconBtn: {
    width: 44,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.green,
  },

  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10 },
  tabLabel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  tabLabelActive: { color: COLORS.text },
  tabUnderlineSpacer: { height: 3, marginTop: 8 },
  animatedUnderline: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.green,
  },

  pager: { flex: 1 },
  pageContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },

  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },

  fab: {
    position: 'absolute',
    right: 18,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: '#0E1A12', fontSize: 26, fontWeight: '800', lineHeight: 28 },

  // Filter popup
  filterBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  filterCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
  },
  filterCardTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  filterOptionActive: { backgroundColor: COLORS.green + '18' },
  filterOptionText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  filterOptionTextActive: { color: COLORS.green },
});
