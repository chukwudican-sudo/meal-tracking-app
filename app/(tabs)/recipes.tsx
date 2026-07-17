import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '@/components/Screen';

import { CartIcon } from '@/components/CartIcon';
import { ProfileIcon } from '@/components/ProfileIcon';
import { ActionTile } from '@/components/recipes/ActionTile';
import { CategoryRow } from '@/components/recipes/CategoryRow';
import { NavTile } from '@/components/recipes/NavTile';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { COLORS } from '@/constants/theme';
import { toRecipeInputFromTemplate, useRecipeActions } from '@/hooks/useRecipeActions';
import type { RecipeCategory, RecipeTemplate } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const CATEGORIES: RecipeCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

export default function RecipesScreen() {
  const recipes      = useMealStore(s => s.recipes);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const grocery      = useMealStore(s => s.grocery);
  const { addToToday } = useRecipeActions();

  const [query, setQuery] = useState('');

  const kitchenCount = useMemo(
    () => Object.values(grocery.items).filter(i => i.section === 'kitchen').length,
    [grocery.items]
  );

  const trimmedQuery = query.trim().toLowerCase();
  const searchResults = useMemo<RecipeTemplate[]>(() => {
    if (!trimmedQuery) return [];
    return recipes.filter(r =>
      r.name.toLowerCase().includes(trimmedQuery) ||
      r.category.toLowerCase().includes(trimmedQuery) ||
      r.ingredients.some(i => i.name.toLowerCase().includes(trimmedQuery))
    );
  }, [recipes, trimmedQuery]);

  const recipesByCategory = useMemo(() => {
    const grouped: Record<RecipeCategory, RecipeTemplate[]> = {
      Breakfast: [], Lunch: [], Dinner: [], Snacks: [],
    };
    recipes.forEach(r => grouped[r.category].push(r));
    return grouped;
  }, [recipes]);

  const openRecipe = (recipe: RecipeTemplate) => {
    router.push({ pathname: '/recipe/[id]', params: { id: recipe.id } });
  };

  // Premade plus-tap logs to today WITHOUT saving to the user's collection.
  const handleAdd = (recipe: RecipeTemplate) => {
    addToToday(toRecipeInputFromTemplate(recipe), { save: false });
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Recipes</Text>
        <View style={styles.headerActions}>
          <ProfileIcon />
          <CartIcon />
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search recipes…"
          placeholderTextColor={COLORS.textSecondary}
          style={styles.searchInput}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {trimmedQuery ? (
          <SearchResults
            results={searchResults}
            query={query}
            onPressRecipe={openRecipe}
            onAdd={handleAdd}
            onCreateCustom={() => router.push({ pathname: '/ai/custom', params: { seed: query } })}
          />
        ) : (
          <>
            <View style={styles.actionRow}>
              <ActionTile
                icon="🤖"
                title="What can I make?"
                subtitle="Based on your kitchen."
                accent="green"
                onPress={() => router.push('/ai/what-can-i-make')}
              />
              <View style={{ width: 12 }} />
              <ActionTile
                icon="✨"
                title="Custom Recipe"
                subtitle="Describe anything."
                accent="purple"
                onPress={() => router.push('/ai/custom')}
              />
            </View>

            <View style={styles.navRow}>
              <NavTile
                icon="❤️"
                title="Saved Recipes"
                count={savedRecipes.length}
                onPress={() => router.push('/recipes/saved')}
              />
              <View style={{ width: 12 }} />
              <NavTile
                icon="🥬"
                title="My Kitchen"
                count={kitchenCount}
                onPress={() => router.push('/kitchen')}
              />
            </View>

            {CATEGORIES.map(cat => (
              <CategoryRow
                key={cat}
                title={cat}
                recipes={recipesByCategory[cat]}
                onSeeAll={() => router.push({ pathname: '/recipes/category/[type]', params: { type: cat } })}
                onPressRecipe={openRecipe}
              />
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

interface SearchResultsProps {
  results: RecipeTemplate[];
  query: string;
  onPressRecipe: (r: RecipeTemplate) => void;
  onAdd: (r: RecipeTemplate) => void;
  onCreateCustom: () => void;
}

function SearchResults({
  results,
  query,
  onPressRecipe,
  onAdd,
  onCreateCustom,
}: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No matches for &ldquo;{query.trim()}&rdquo;</Text>
        <Text style={styles.emptyBody}>Want me to create this recipe for you?</Text>
        <TouchableOpacity onPress={onCreateCustom} style={styles.emptyBtn} activeOpacity={0.8}>
          <Text style={styles.emptyBtnText}>Create with AI</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={styles.resultsHeader}>{results.length} {results.length === 1 ? 'result' : 'results'}</Text>
      {results.map(r => (
        <RecipeCard
          key={r.id}
          variant="row"
          name={r.name}
          calories={r.calories}
          cookTimeMin={r.cookTimeMin}
          category={r.category}
          onPress={() => onPressRecipe(r)}
          onAdd={() => onAdd(r)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 40,
  },
  searchIcon: { fontSize: 14, marginRight: 8, opacity: 0.7 },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    paddingVertical: 0,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 96 },

  actionRow: { flexDirection: 'row', marginTop: 8 },
  navRow: { flexDirection: 'row', marginTop: 12 },

  resultsHeader: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },

  emptyCard: {
    marginTop: 24,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center' },
  emptyBtn: {
    marginTop: 14,
    backgroundColor: COLORS.green,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
