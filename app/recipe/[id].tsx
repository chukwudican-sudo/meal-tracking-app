import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import {
  toRecipeInputFromSaved,
  toRecipeInputFromTemplate,
  useRecipeActions,
} from '@/hooks/useRecipeActions';
import type { Ingredient, Macros } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

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
  favourited: boolean;
}

export default function RecipeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = (params.id || '').toString();

  const recipes = useMealStore(s => s.recipes);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const { addToToday, addToPlan, favourite } = useRecipeActions();

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
        favourited: saved.favourited,
      };
    }
    return null;
  }, [recipes, savedRecipes, id]);

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

  if (!resolved || !recipeInput) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={handleBack} title="Recipe" />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Recipe not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header
        onBack={handleBack}
        title={resolved.category ?? 'Recipe'}
        rightAction={
          <TouchableOpacity
            onPress={() => favourite(recipeInput)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerHeartBtn}
            activeOpacity={0.7}
          >
            <Text style={[styles.headerHeart, resolved.favourited && styles.headerHeartActive]}>
              {resolved.favourited ? '♥' : '♡'}
            </Text>
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>🍽️</Text>
        </View>

        <Text style={styles.name}>{resolved.name}</Text>
        <Text style={styles.meta}>
          {resolved.calories} cal{resolved.cookTimeMin != null ? `  ·  ${resolved.cookTimeMin}m cook` : ''}
        </Text>

        <View style={styles.macroRow}>
          <MacroChip label="P" value={`${resolved.macros.protein}g`} color={COLORS.blue} />
          <MacroChip label="C" value={`${resolved.macros.carbs}g`} color={COLORS.green} />
          <MacroChip label="F" value={`${resolved.macros.fats}g`} color={COLORS.orange} />
        </View>

        <SectionHeader>Ingredients</SectionHeader>
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

        <SectionHeader>Steps</SectionHeader>
        {resolved.steps && resolved.steps.length > 0 ? (
          resolved.steps.map((s, idx) => (
            <View key={idx} style={styles.stepRow}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{idx + 1}</Text></View>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No steps included for this recipe.</Text>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          onPress={() => addToPlan(recipeInput)}
          style={[styles.footerBtn, styles.footerBtnOutline]}
          activeOpacity={0.85}
        >
          <Text style={styles.footerBtnOutlineText}>Add to Plan</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => addToToday(recipeInput)}
          style={[styles.footerBtn, styles.footerBtnPrimary]}
          activeOpacity={0.85}
        >
          <Text style={styles.footerBtnPrimaryText}>Add to Today</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Header({
  onBack,
  title,
  rightAction,
}: { onBack: () => void; title: string; rightAction?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.backBtn}>{rightAction}</View>
    </View>
  );
}

function MacroChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.macroChip, { borderColor: color + '55' }]}>
      <Text style={[styles.macroChipLabel, { color }]}>{label}</Text>
      <Text style={styles.macroChipValue}>{value}</Text>
    </View>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionHeader}>{children}</Text>;
}

function formatQty(ing: Ingredient): string {
  if (ing.quantity == null) return '';
  const qty = Number.isInteger(ing.quantity) ? `${ing.quantity}` : ing.quantity.toString();
  return `${qty}${ing.unit ? ' ' + ing.unit : ''}`;
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
  headerTitle: { flex: 1, color: COLORS.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  headerHeartBtn: { padding: 4 },
  headerHeart: { fontSize: 22, color: COLORS.textSecondary },
  headerHeartActive: { color: COLORS.red },

  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },

  hero: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  heroEmoji: { fontSize: 64 },

  name: { color: COLORS.text, fontSize: 22, fontWeight: '700', marginTop: 16 },
  meta: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },

  macroRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  macroChip: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  macroChipLabel: { fontSize: 12, fontWeight: '700' },
  macroChipValue: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginTop: 2 },

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

  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
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
  stepNumberText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  stepText: { flex: 1, color: COLORS.text, fontSize: 14, lineHeight: 20 },

  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: COLORS.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  footerBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  footerBtnOutline: { borderWidth: 1.5, borderColor: COLORS.green, backgroundColor: 'transparent' },
  footerBtnOutlineText: { color: COLORS.green, fontWeight: '700', fontSize: 14 },
  footerBtnPrimary: { backgroundColor: COLORS.green },
  footerBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  empty: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
});
