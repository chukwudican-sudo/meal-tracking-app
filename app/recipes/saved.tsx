import { useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/Screen';
import { SavedRecipesView } from '@/components/recipes/SavedRecipesView';
import type { RecipeCategory } from '@/store/types';

export default function SavedRecipesScreen() {
  const params = useLocalSearchParams<{ swapMode?: string; swapFilter?: string }>();
  const swapMode = params.swapMode === 'true';
  const swapFilter = (params.swapFilter as RecipeCategory | undefined) ?? 'All';

  return (
    <Screen edges={['top', 'bottom']}>
      <SavedRecipesView
        mode="full"
        context={swapMode ? 'swap' : 'saved-recipes'}
        swapFilter={swapFilter}
      />
    </Screen>
  );
}
