import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecipeCard } from '@/components/recipes/RecipeCard';
import { COLORS } from '@/constants/theme';
import { toRecipeInputFromTemplate, useRecipeActions } from '@/hooks/useRecipeActions';
import type { RecipeCategory, RecipeTemplate } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const VALID: RecipeCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

export default function RecipeCategoryScreen() {
  const params = useLocalSearchParams<{ type: string }>();
  const recipes = useMealStore(s => s.recipes);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const { favourite } = useRecipeActions();

  const category = useMemo<RecipeCategory | null>(() => {
    const raw = (params.type || '').toString();
    const match = VALID.find(c => c.toLowerCase() === raw.toLowerCase());
    return match ?? null;
  }, [params.type]);

  const list: RecipeTemplate[] = useMemo(() => {
    if (!category) return [];
    return recipes.filter(r => r.category === category);
  }, [recipes, category]);

  const favouritedIds = useMemo(() => {
    const set = new Set<string>();
    savedRecipes.forEach(s => { if (s.favourited && s.recipeId) set.add(s.recipeId); });
    return set;
  }, [savedRecipes]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{category ?? 'Recipes'}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!category ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Unknown category.</Text>
          </View>
        ) : list.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No recipes in this category yet.</Text>
          </View>
        ) : (
          list.map(r => (
            <RecipeCard
              key={r.id}
              variant="row"
              name={r.name}
              calories={r.calories}
              cookTimeMin={r.cookTimeMin}
              category={r.category}
              favourited={favouritedIds.has(r.id)}
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: r.id } })}
              onToggleFavourite={() => favourite(toRecipeInputFromTemplate(r))}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
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
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  title: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
});
