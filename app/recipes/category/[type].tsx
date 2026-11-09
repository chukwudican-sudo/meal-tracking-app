import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';

import { RecipeCard } from '@/components/recipes/RecipeCard';
import { COLORS } from '@/constants/theme';
import { toRecipeInputFromTemplate, useRecipeActions } from '@/hooks/useRecipeActions';
import type { RecipeCategory, RecipeTemplate } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const VALID: RecipeCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

export default function RecipeCategoryScreen() {
  const params = useLocalSearchParams<{ type: string }>();
  const recipes = useMealStore(s => s.recipes);
  const { addToToday } = useRecipeActions();

  const category = useMemo<RecipeCategory | null>(() => {
    const raw = (params.type || '').toString();
    const match = VALID.find(c => c.toLowerCase() === raw.toLowerCase());
    return match ?? null;
  }, [params.type]);

  const list: RecipeTemplate[] = useMemo(() => {
    if (!category) return [];
    return recipes.filter(r => r.category === category);
  }, [recipes, category]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <PageHeader style={styles.header} title={category ?? 'Recipes'} onBack={handleBack} />

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
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: r.id } })}
              onAdd={() => addToToday(toRecipeInputFromTemplate(r), { save: false })}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },

  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
});
