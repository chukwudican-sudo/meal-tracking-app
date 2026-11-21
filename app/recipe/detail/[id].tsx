import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';

import { useRecipeFix } from '@/components/recipes/useRecipeFix';
import { NutritionTiles } from '@/components/recipes/NutritionTiles';
import { COLORS } from '@/constants/theme';
import {
  toRecipeInputFromSaved,
  toRecipeInputFromTemplate,
  useRecipeActions,
} from '@/hooks/useRecipeActions';
import { useResolvedRecipe } from '@/hooks/useResolvedRecipe';
import { openPaywall } from '@/lib/paywall';
import type { Ingredient, RecipeDifficulty } from '@/store/types';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { useMealStore } from '@/store/useMealStore';

export default function RecipeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = (params.id || '').toString();

  const recipes = useMealStore(s => s.recipes);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const { favourite } = useRecipeActions();
  const insets = useSafeAreaInsets();
  const isPro = useEntitlementStore(s => s.isPro);

  const resolved = useResolvedRecipe(id);

  const recipeInput = useMemo(() => {
    if (!resolved) return null;
    if (resolved.source === 'premade') {
      const premade = recipes.find(r => r.id === resolved.id);
      return premade ? toRecipeInputFromTemplate(premade) : null;
    }
    const saved = savedRecipes.find(s => s.id === resolved.id);
    return saved ? toRecipeInputFromSaved(saved) : null;
  }, [resolved, recipes, savedRecipes]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  // Client-only Pro gate: this screen has no edge function of its own to
  // return a not_premium error for, so it's checked directly against the
  // live RevenueCat entitlement. The screen itself stays reachable (calories/
  // macros/preview data above are never hidden) — only the ingredients/steps
  // are swapped for a locked card, and it unlocks automatically the moment
  // isPro flips true (purchase completed right here, or restored elsewhere).
  const locked = !!resolved?.requiresPro && !isPro;

  // Fix: only the user's own recipes (built-in ones are reference content).
  const { canFix, openFix, fixSheet } = useRecipeFix(resolved?.source === 'saved' ? resolved.id : undefined);

  const handleUnlock = () => {
    openPaywall({ reason: 'premium_feature', headline: 'Unlock the full recipe with Pro' });
  };

  if (!resolved || !recipeInput) {
    return (
      <Screen edges={['top', 'bottom']}>
        <PageHeader title="Recipe" onBack={handleBack} style={styles.headerBorder} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Recipe not found.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <PageHeader
        title={resolved.name}
        onBack={handleBack}
        style={styles.headerBorder}
        right={
          <TouchableOpacity
            onPress={() => favourite(recipeInput)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.bookmarkBtn}
            activeOpacity={0.7}
          >
            <Ionicons
              name={resolved.favourited ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={resolved.favourited ? COLORS.green : COLORS.textSecondary}
            />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>🍽️</Text>
        </View>

        <Text style={styles.name}>{resolved.name}</Text>

        <View style={styles.infoBar}>
          {resolved.category ? (
            <View style={styles.tagPill}>
              <Text style={styles.tagPillText}>{resolved.category}</Text>
            </View>
          ) : null}
          {resolved.difficulty ? (
            <View style={[styles.difficultyPill, difficultyStyle(resolved.difficulty)]}>
              <Text style={[styles.difficultyText, difficultyTextStyle(resolved.difficulty)]}>
                {resolved.difficulty}
              </Text>
            </View>
          ) : null}
        </View>

        {resolved.cookTimeMin != null ? (
          <Text style={styles.cookTime}>{resolved.cookTimeMin}m cook</Text>
        ) : null}
        <View style={styles.tiles}>
          <NutritionTiles calories={resolved.calories} macros={resolved.macros} />
        </View>

        {/* Ingredients are visible to everyone; free users see step 1 of a
            Pro recipe and unlock the rest (teaser). */}
        <>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionHeader, styles.sectionHeaderInRow]}>Ingredients</Text>
              {canFix ? (
                <TouchableOpacity style={styles.fixBtn} onPress={openFix} activeOpacity={0.8} accessibilityLabel="Fix this recipe">
                  <Ionicons name="create-outline" size={15} color={COLORS.text} />
                  <Text style={styles.fixBtnText}>Fix</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {resolved.ingredients.length === 0 ? (
              <Text style={styles.emptyText}>No ingredients listed.</Text>
            ) : (
              resolved.ingredients.map((ing, idx) => (
                <View key={ing.id || idx} style={styles.ingredientRow}>
                  <Text style={styles.ingredientDot}>•</Text>
                  <Text style={styles.ingredientName}>{ing.name}</Text>
                  <Text style={styles.ingredientQty}>{formatQty(ing)}</Text>
                </View>
              ))
            )}

            <Text style={styles.sectionHeader}>Steps</Text>
            {resolved.steps && resolved.steps.length > 0 ? (
              (locked ? resolved.steps.slice(0, 1) : resolved.steps).map((s, idx) => (
                <View key={idx} style={styles.stepRow}>
                  <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{idx + 1}</Text></View>
                  <Text style={styles.stepText}>{s}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>No steps included for this recipe.</Text>
            )}
            {locked ? <LockedRecipeCard onUnlock={handleUnlock} /> : null}
        </>
      </ScrollView>

      {fixSheet}

      <TouchableOpacity
        style={[styles.fab, { bottom: Math.max(insets.bottom, 12) + 12 }]}
        onPress={() => router.push({ pathname: '/recipe/assistant/[id]', params: { id: resolved.id } })}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Ask the Recipe Assistant"
      >
        <Ionicons name="sparkles" size={22} color="#0E1A12" />
      </TouchableOpacity>
    </Screen>
  );
}

// Replaces the Ingredients/Steps sections for any recipe that requires an
// active Pro subscription when the viewer doesn't have one. Deliberately
// keeps the hero/name/calories/macros above visible — the teaser is the
// point, a fully blank screen wouldn't sell the upgrade.
function LockedRecipeCard({ onUnlock }: { onUnlock: () => void }) {
  return (
    <View style={styles.lockedCard}>
      <Ionicons name="lock-closed" size={22} color={COLORS.textSecondary} />
      <Text style={styles.lockedTitle}>The rest of the steps are locked</Text>
      <Text style={styles.lockedBody}>
        Upgrade to Pro to see every step of this recipe.
      </Text>
      <TouchableOpacity style={styles.lockedBtn} onPress={onUnlock} activeOpacity={0.85}>
        <Text style={styles.lockedBtnText}>Unlock with Pro</Text>
      </TouchableOpacity>
    </View>
  );
}

function difficultyStyle(d: RecipeDifficulty) {
  switch (d) {
    case 'Easy': return { backgroundColor: COLORS.green + '22' };
    case 'Medium': return { backgroundColor: COLORS.orange + '22' };
    case 'Hard': return { backgroundColor: COLORS.red + '22' };
  }
}
function difficultyTextStyle(d: RecipeDifficulty) {
  switch (d) {
    case 'Easy': return { color: COLORS.green };
    case 'Medium': return { color: COLORS.orange };
    case 'Hard': return { color: COLORS.red };
  }
}

function formatQty(ing: Ingredient): string {
  if (ing.quantity == null) return '';
  const qty = Number.isInteger(ing.quantity) ? `${ing.quantity}` : ing.quantity.toString();
  return `${qty}${ing.unit ? ' ' + ing.unit : ''}`;
}

const styles = StyleSheet.create({
  headerBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  bookmarkBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 96 },

  hero: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  heroEmoji: { fontSize: 68 },

  name: { color: COLORS.text, fontSize: 22, fontWeight: '700', marginTop: 16 },

  infoBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  tagPill: {
    backgroundColor: COLORS.green + '22',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagPillText: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
  difficultyPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  difficultyText: { fontSize: 12, fontWeight: '700' },


  sectionHeader: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 8,
  },
  cookTime: { color: COLORS.textSecondary, fontSize: 13, marginTop: 8 },
  tiles: { marginTop: 14 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 },
  sectionHeaderInRow: { marginTop: 0, marginBottom: 0 },
  fixBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card,
  },
  fixBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

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

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  stepNumberText: { color: '#0E1A12', fontSize: 13, fontWeight: '700' },
  stepText: { flex: 1, color: COLORS.text, fontSize: 14, lineHeight: 20 },

  empty: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },

  lockedCard: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 8,
  },
  lockedTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginTop: 10 },
  lockedBody: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
    maxWidth: 280,
  },
  lockedBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  lockedBtnText: { color: '#0E1A12', fontWeight: '700', fontSize: 14 },

  // ── FAB ──
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
});
