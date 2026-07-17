import { SavedRecipesView } from '@/components/recipes/SavedRecipesView';

interface Props {
  // Close the host AddMealScreen modal before navigating to a router screen
  // (recipe preview / Custom Recipe), since pushes are otherwise hidden behind
  // the full-screen modal.
  onClose: () => void;
}

export function SearchTab({ onClose }: Props) {
  return <SavedRecipesView mode="embedded" context="search-tab" onBeforeNavigate={onClose} />;
}
