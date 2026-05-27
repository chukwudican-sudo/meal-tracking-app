import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '@/constants/theme';
import type { RecipeTemplate } from '@/store/types';

import { RecipeCard } from './RecipeCard';

interface Props {
  title: string;
  recipes: RecipeTemplate[];
  favouritedIds: Set<string>;     // recipeIds that are favourited
  onSeeAll: () => void;
  onPressRecipe: (recipe: RecipeTemplate) => void;
  onToggleFavourite: (recipe: RecipeTemplate) => void;
}

export function CategoryRow({
  title,
  recipes,
  favouritedIds,
  onSeeAll,
  onPressRecipe,
  onToggleFavourite,
}: Props) {
  if (recipes.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>See all</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {recipes.map(r => (
          <RecipeCard
            key={r.id}
            variant="compact"
            name={r.name}
            calories={r.calories}
            cookTimeMin={r.cookTimeMin}
            favourited={favouritedIds.has(r.id)}
            onPress={() => onPressRecipe(r)}
            onToggleFavourite={() => onToggleFavourite(r)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  seeAll: { color: COLORS.green, fontSize: 13, fontWeight: '600' },
  scrollContent: { paddingHorizontal: 4, paddingBottom: 4 },
});
