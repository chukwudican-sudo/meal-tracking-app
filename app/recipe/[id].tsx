import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';

import { COLORS } from '@/constants/theme';
import {
  toRecipeInputFromSaved,
  toRecipeInputFromTemplate,
  useRecipeActions,
} from '@/hooks/useRecipeActions';
import type { Ingredient, Macros, RecipeDifficulty } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useRecipeFix } from '@/components/recipes/useRecipeFix';
import { NutritionTiles } from '@/components/recipes/NutritionTiles';
import { ProgressiveLoader } from '@/components/ProgressiveLoader';
import { AIError, aiErrorMessage } from '@/ai/aiEdgeClient';
import { generateRecipeSteps } from '@/ai/generateRecipeSteps';
import { recipeRequiresPro } from '@/lib/entitlements';
import { openPaywall } from '@/lib/paywall';
import { applyRecipeSwap } from '@/lib/recipeSwap';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { useToastStore } from '@/store/useToastStore';
import { useUndoStore } from '@/store/useUndoStore';

interface ResolvedRecipe {
  source: 'premade' | 'saved';
  id: string;
  recipeId?: string;
  name: string;
  category?: string;
  calories: number;
  cookTimeMin?: number;
  macros: Macros;
  ingredients: Ingredient[];
  steps?: string[];
  difficulty?: RecipeDifficulty;
  favourited: boolean;
}

const KEY_INGREDIENT_COUNT = 4;

export default function RecipePreviewScreen() {
  const params = useLocalSearchParams<{ id: string; swap?: string }>();
  const id = (params.id || '').toString();
  // Opened from Custom Recipe during a swap: offer "Use this recipe".
  const swapMode = params.swap === 'true';
  const pendingSwap = useMealStore(s => s.pendingSwap);
  const clearPendingSwap = useMealStore(s => s.clearPendingSwap);
  const setRecipeSteps = useMealStore(s => s.setRecipeSteps);
  const showUndo = useUndoStore(s => s.showUndo);
  const showToast = useToastStore(s => s.showToast);
  const [writingSteps, setWritingSteps] = useState(false);

  const recipes = useMealStore(s => s.recipes);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const markRecipeViewed = useMealStore(s => s.markRecipeViewed);
  const { favourite, addToToday } = useRecipeActions();
  const insets = useSafeAreaInsets();
  const footerBottomPad = Math.max(insets.bottom, 16) + 16;

  const resolved = useMemo<ResolvedRecipe | null>(() => {
    const premade = recipes.find(r => r.id === id);
    if (premade) {
      const saved = savedRecipes.find(s => s.recipeId === premade.id);
      return {
        source: 'premade',
        id: premade.id,
        recipeId: premade.id,
        name: premade.name,
        category: premade.category,
        calories: premade.calories,
        cookTimeMin: premade.cookTimeMin,
        macros: premade.macros,
        ingredients: premade.ingredients,
        steps: premade.steps,
        difficulty: premade.difficulty,
        favourited: !!saved?.favourited,
      };
    }
    const saved = savedRecipes.find(s => s.id === id);
    if (saved) {
      return {
        source: 'saved',
        id: saved.id,
        recipeId: saved.recipeId,
        name: saved.name,
        category: saved.category,
        calories: saved.calories,
        cookTimeMin: saved.cookTimeMin,
        macros: saved.macros,
        ingredients: saved.ingredients,
        steps: saved.steps,
        difficulty: saved.difficulty,
        favourited: saved.favourited,
      };
    }
    return null;
  }, [recipes, savedRecipes, id]);

  // Opening a recipe clears its "NEW" tag in Saved Recipes.
  useEffect(() => {
    if (resolved) markRecipeViewed(resolved.id);
  }, [resolved, markRecipeViewed]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  const recipeInput = useMemo(() => {
    if (!resolved) return null;
    if (resolved.source === 'premade') {
      const premade = recipes.find(r => r.id === resolved.id);
      return premade ? toRecipeInputFromTemplate(premade) : null;
    }
    const saved = savedRecipes.find(s => s.id === resolved.id);
    return saved ? toRecipeInputFromSaved(saved) : null;
  }, [resolved, recipes, savedRecipes]);

  // Fix: only the user's own recipes (rules live in useRecipeFix).
  const { canFix, openFix, fixSheet } = useRecipeFix(resolved?.source === 'saved' ? resolved.id : undefined);

  const openFullRecipe = (recipeId: string) =>
    router.push({ pathname: '/recipe/detail/[id]', params: { id: recipeId } });

  // View Full Recipe: open it when the steps exist; otherwise (a Custom Recipe
  // that only has ingredients) write the steps from exactly these ingredients
  // first. Writing steps is the Pro part.
  const handleViewFull = async () => {
    if (!resolved || writingSteps) return;
    const saved = useMealStore.getState().savedRecipes.find(r => r.id === resolved.id);
    // Only an AI recipe that has ingredients but no steps yet gets its steps
    // written; everything else (built-in, manual, already complete) just opens.
    const needsSteps = !!saved && saved.source === 'ai' && saved.ingredients.length > 0
      && !(saved.steps && saved.steps.length > 0);
    if (!saved || !needsSteps) {
      openFullRecipe(resolved.id);
      return;
    }
    // Read live: a retry after the paywall runs from an older closure.
    if (recipeRequiresPro({ source: saved.source }) && !useEntitlementStore.getState().isPro) {
      openPaywall({
        reason: 'premium_feature',
        headline: 'Unlock the full recipe with Pro',
        onSuccess: () => void handleViewFull(),
      });
      return;
    }
    setWritingSteps(true);
    try {
      const full = await generateRecipeSteps({
        name: saved.name,
        calories: saved.calories,
        protein: saved.macros.protein,
        carbs: saved.macros.carbs,
        fats: saved.macros.fats,
        mealType: saved.category,
        ingredients: saved.ingredients,
        flowId: saved.id,
      });
      if (full.steps.length === 0) throw new Error('No steps returned');
      setRecipeSteps(saved.id, full.steps);
      openFullRecipe(saved.id);
    } catch (e) {
      console.warn('[recipe] writing steps failed:', e);
      if (e instanceof AIError && e.code === 'not_premium') {
        openPaywall({
          reason: 'premium_feature',
          headline: 'Unlock the full recipe with Pro',
          onSuccess: () => void handleViewFull(),
        });
        return;
      }
      showToast(aiErrorMessage(e, 'Could not write the full recipe right now. Please try again.'));
    } finally {
      setWritingSteps(false);
    }
  };

  // Swap from Custom Recipe: put this recipe in the slot the swap came from,
  // then return there (this page replaced Custom Recipe, which sits on top of
  // the recipe picker).
  const canUseForSwap = swapMode && !!pendingSwap && resolved?.source === 'saved';
  const handleUseForSwap = () => {
    if (!resolved || !pendingSwap) return;
    const saved = useMealStore.getState().savedRecipes.find(r => r.id === resolved.id);
    if (!saved) return;
    const undo = applyRecipeSwap(pendingSwap, saved);
    clearPendingSwap();
    showUndo({ message: `Swapped to ${saved.name}`, undo });
    if (router.canDismiss()) router.dismiss(2);
    else handleBack();
  };

  if (!resolved || !recipeInput) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Header onBack={handleBack} favourited={false} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Recipe not found.</Text>
        </View>
      </Screen>
    );
  }

  const keyIngredients = resolved.ingredients.slice(0, KEY_INGREDIENT_COUNT);

  return (
    <Screen edges={['top', 'bottom']}>
      <Header
        onBack={handleBack}
        favourited={resolved.favourited}
        onToggleFavourite={() => favourite(recipeInput)}
        onAdd={() => addToToday(recipeInput, { save: false })}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>🍽️</Text>
        </View>

        <Text style={styles.name}>{resolved.name}</Text>

        <View style={styles.tagRow}>
          {resolved.category ? (
            <View style={styles.tagPill}>
              <Text style={styles.tagPillText}>{resolved.category}</Text>
            </View>
          ) : null}
          {resolved.cookTimeMin != null ? (
            <Text style={styles.meta}>{resolved.cookTimeMin}m cook</Text>
          ) : null}
        </View>

        <View style={styles.tiles}>
          <NutritionTiles calories={resolved.calories} macros={resolved.macros} />
        </View>

        <Text style={styles.sectionHeader}>Key ingredients</Text>
        {keyIngredients.length === 0 ? (
          <Text style={styles.emptyText}>No ingredients listed.</Text>
        ) : (
          keyIngredients.map((ing, idx) => (
            <View key={ing.id || idx} style={styles.ingredientRow}>
              <Text style={styles.ingredientDot}>•</Text>
              <Text style={styles.ingredientName} numberOfLines={1}>{ing.name}</Text>
              <Text style={styles.ingredientQty}>{formatQty(ing)}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {writingSteps ? (
        <View style={styles.writing}>
          <ProgressiveLoader
            messages={['Writing the steps…', 'Using your ingredients…', 'Almost ready…']}
            variant="inline"
          />
        </View>
      ) : null}
      <View style={[styles.footer, styles.footerRow, { paddingBottom: footerBottomPad }]}>
        {canFix ? (
          <TouchableOpacity onPress={openFix} disabled={writingSteps} style={[styles.footerBtn, styles.fixBtn]} activeOpacity={0.85}>
            <Text style={styles.fixBtnText}>Fix</Text>
          </TouchableOpacity>
        ) : null}
        {canUseForSwap ? (
          <TouchableOpacity onPress={handleUseForSwap} disabled={writingSteps} style={[styles.footerBtn, styles.viewBtn]} activeOpacity={0.85}>
            <Text style={styles.viewBtnText}>Use this recipe</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => void handleViewFull()}
            disabled={writingSteps}
            style={[styles.footerBtn, styles.viewBtn, writingSteps && styles.btnDisabled]}
            activeOpacity={0.85}
          >
            <Text style={styles.viewBtnText}>View Full Recipe</Text>
          </TouchableOpacity>
        )}
      </View>
      {fixSheet}
    </Screen>
  );
}

function Header({
  onBack,
  favourited,
  onToggleFavourite,
  onAdd,
}: {
  onBack: () => void;
  favourited: boolean;
  onToggleFavourite?: () => void;
  onAdd?: () => void;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>
      <View style={styles.headerActions}>
        {onAdd ? (
          <TouchableOpacity
            onPress={onAdd}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerAddBtn}
            activeOpacity={0.85}
          >
            <Text style={styles.headerAddText}>＋</Text>
          </TouchableOpacity>
        ) : null}
        {onToggleFavourite ? (
          <TouchableOpacity
            onPress={onToggleFavourite}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerBookmarkBtn}
            activeOpacity={0.7}
          >
            <Ionicons
              name={favourited ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={favourited ? COLORS.green : COLORS.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}


function formatQty(ing: Ingredient): string {
  if (ing.quantity == null) return '';
  const qty = Number.isInteger(ing.quantity) ? `${ing.quantity}` : ing.quantity.toString();
  return `${qty}${ing.unit ? ' ' + ing.unit : ''}`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerBookmarkBtn: { padding: 4 },
  headerAddBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAddText: { color: '#0E1A12', fontSize: 20, fontWeight: '800', lineHeight: 22 },

  scroll: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },

  hero: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  heroEmoji: { fontSize: 72 },

  name: { color: COLORS.text, fontSize: 24, fontWeight: '700', marginTop: 16 },

  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  tagPill: {
    backgroundColor: COLORS.green + '22',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagPillText: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
  meta: { color: COLORS.textSecondary, fontSize: 13 },



  sectionHeader: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 8,
  },

  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  ingredientDot: { color: COLORS.textSecondary, marginRight: 8, fontSize: 14 },
  ingredientName: { flex: 1, color: COLORS.text, fontSize: 14 },
  ingredientQty: { color: COLORS.textSecondary, fontSize: 13 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: COLORS.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  viewBtn: {
    backgroundColor: COLORS.green,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  viewBtnText: { color: '#0E1A12', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  tiles: { marginTop: 14 },
  writing: { paddingHorizontal: 16, paddingVertical: 10 },
  // Fix | View Full Recipe — same pattern as Custom Recipe's Fix | Generate.
  footerRow: { flexDirection: 'row', gap: 12 },
  footerBtn: { flex: 1 },
  fixBtn: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  fixBtnText: { color: COLORS.text, fontWeight: '700', fontSize: 15 },

  empty: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
});
