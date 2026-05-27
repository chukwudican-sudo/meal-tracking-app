import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ChatShell, type ChatMessage } from '@/components/ai/ChatShell';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { COLORS } from '@/constants/theme';
import { normalizeIngredientName } from '@/constants/ingredientCategories';
import { toRecipeInputFromTemplate, useRecipeActions } from '@/hooks/useRecipeActions';
import type { RecipeTemplate } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

const SUGGESTION_COUNT = 4;

interface Suggestion {
  recipe: RecipeTemplate;
  missing: string[]; // ingredient names missing from kitchen
}

export default function WhatCanIMakeScreen() {
  const recipes = useMealStore(s => s.recipes);
  const grocery = useMealStore(s => s.grocery);
  const profile = useMealStore(s => s.profile);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const addManualCartItem = useMealStore(s => s.addManualCartItem);
  const { addToToday, addToPlan, favourite } = useRecipeActions();

  const kitchenKeys = useMemo(() => {
    const set = new Set<string>();
    Object.values(grocery.items).forEach(i => {
      if (i.section === 'kitchen') set.add(i.key);
    });
    return set;
  }, [grocery.items]);

  const dietary = (profile.dietaryRestrictions ?? []).map(d => d.toLowerCase());
  const allergies = (profile.allergies ?? []).map(a => a.toLowerCase());

  const candidates = useMemo<Suggestion[]>(() => {
    if (kitchenKeys.size < 3) return [];
    const result: Suggestion[] = [];
    for (const r of recipes) {
      // Filter by allergens — if any ingredient name contains an allergy
      // keyword, skip entirely.
      const hasAllergen = r.ingredients.some(i =>
        allergies.some(a => a && i.name.toLowerCase().includes(a))
      );
      if (hasAllergen) continue;

      // Vegetarian/vegan rough filter — exclude obvious meat keywords.
      if (dietary.includes('vegetarian') || dietary.includes('vegan')) {
        const MEAT = ['chicken', 'beef', 'turkey', 'salmon', 'tuna', 'pork', 'bacon', 'fish'];
        if (r.ingredients.some(i => MEAT.some(m => i.name.toLowerCase().includes(m)))) continue;
      }

      const missing: string[] = [];
      r.ingredients.forEach(ing => {
        const key = normalizeIngredientName(ing.name);
        if (!kitchenKeys.has(key)) missing.push(ing.name);
      });

      // Core ingredient heuristic — a recipe is "doable" if missing <= 2 items,
      // and none of those missing are the first ingredient (treated as core).
      const coreName = r.ingredients[0]?.name ?? '';
      const coreMissing = missing.includes(coreName);
      if (coreMissing) continue;
      if (missing.length > 2) continue;

      result.push({ recipe: r, missing });
    }
    // Sort by fewest missing first.
    return result.sort((a, b) => a.missing.length - b.missing.length);
  }, [recipes, kitchenKeys, dietary, allergies]);

  const [shown, setShown] = useState<Suggestion[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<'intro' | 'thinking' | 'results' | 'empty'>('intro');

  const favouritedIds = useMemo(() => {
    const set = new Set<string>();
    savedRecipes.forEach(s => { if (s.favourited && s.recipeId) set.add(s.recipeId); });
    return set;
  }, [savedRecipes]);

  // Kick off the conversation on mount.
  useEffect(() => {
    if (phase !== 'intro') return;
    const greeting = profile.name ? `Hey ${profile.name}!` : 'Hey!';

    if (kitchenKeys.size < 3) {
      setMessages([
        {
          id: 'm1',
          kind: 'assistant',
          text: `${greeting} Add what's in your kitchen and I'll suggest meals you can make right now.`,
        },
      ]);
      setPhase('empty');
      return;
    }

    setMessages([
      {
        id: 'm1',
        kind: 'assistant',
        text: `${greeting} Let me look at what's in your kitchen…`,
      },
      { id: 'm2', kind: 'thinking' },
    ]);
    setPhase('thinking');

    const timer = setTimeout(() => {
      const initial = candidates.slice(0, SUGGESTION_COUNT);
      setShown(initial);
      if (initial.length === 0) {
        setMessages(prev => prev
          .filter(m => m.kind !== 'thinking')
          .concat({ id: 'm3', kind: 'assistant', text: "Hmm — I can't pin down a full recipe from what you have. Try adding a few more staples." })
        );
        setPhase('empty');
        return;
      }
      setMessages(prev => prev
        .filter(m => m.kind !== 'thinking')
        .concat({
          id: 'm3',
          kind: 'assistant',
          text: `Here are ${initial.length} meals you can make today:`,
        })
        .concat(initial.map(s => ({
          id: `card-${s.recipe.id}`,
          kind: 'card' as const,
          render: () => renderSuggestion(s),
        })))
      );
      setPhase('results');
    }, 600);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, kitchenKeys.size, candidates, profile.name]);

  const renderSuggestion = (s: Suggestion) => (
    <View>
      <RecipeCard
        variant="ai"
        name={s.recipe.name}
        calories={s.recipe.calories}
        cookTimeMin={s.recipe.cookTimeMin}
        favourited={favouritedIds.has(s.recipe.id)}
        onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: s.recipe.id } })}
        onToggleFavourite={() => favourite(toRecipeInputFromTemplate(s.recipe))}
        missingNote={s.missing.length > 0 ? `Missing: ${s.missing.join(', ')}` : undefined}
      />
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.actionBtnOutline}
          onPress={() => addToPlan(toRecipeInputFromTemplate(s.recipe))}
          activeOpacity={0.85}
        >
          <Text style={styles.actionOutlineText}>Add to Plan</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtnPrimary}
          onPress={() => addToToday(toRecipeInputFromTemplate(s.recipe))}
          activeOpacity={0.85}
        >
          <Text style={styles.actionPrimaryText}>Add to Today</Text>
        </TouchableOpacity>
      </View>
      {s.missing.length > 0 ? (
        <TouchableOpacity
          style={styles.cartBtn}
          onPress={() => {
            s.missing.forEach(name => addManualCartItem(name));
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.cartBtnText}>+ Add missing to Cart</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const handleShowMore = () => {
    const more = candidates.slice(shown.length, shown.length + 3);
    if (more.length === 0) return;
    setShown(prev => [...prev, ...more]);
    setMessages(prev => prev.concat(more.map(s => ({
      id: `card-${s.recipe.id}`,
      kind: 'card' as const,
      render: () => renderSuggestion(s),
    }))));
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, kind: 'user', text };
    const reply: ChatMessage = {
      id: `a-${Date.now()}`,
      kind: 'assistant',
      text: "I'm only matching against your kitchen for now — tap a card or try Custom Recipe for free-form ideas.",
    };
    setMessages(prev => [...prev, userMsg, reply]);
  };

  const canShowMore = phase === 'results' && shown.length < candidates.length;
  const showGoToKitchen = phase === 'empty';

  return (
    <ChatShell
      title="What can I make?"
      onBack={handleBack}
      disclaimer="Suggestions are AI-style helpers, not medical or dietary advice. Always verify what you're cooking matches your needs."
      messages={messages}
      inputValue={input}
      onChangeInput={setInput}
      onSubmit={handleSubmit}
      placeholder="Ask a follow-up…"
      footer={
        canShowMore ? (
          <View style={styles.footerArea}>
            <TouchableOpacity onPress={handleShowMore} style={styles.showMoreBtn} activeOpacity={0.8}>
              <Text style={styles.showMoreText}>Show more</Text>
            </TouchableOpacity>
          </View>
        ) : showGoToKitchen ? (
          <View style={styles.footerArea}>
            <TouchableOpacity
              onPress={() => router.push('/kitchen')}
              style={styles.kitchenBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.kitchenBtnText}>Go to Kitchen</Text>
            </TouchableOpacity>
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtnOutline: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.green,
  },
  actionOutlineText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  actionBtnPrimary: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.green,
  },
  actionPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  cartBtn: {
    marginTop: 6,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
  },
  cartBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },

  footerArea: { paddingHorizontal: 16, paddingBottom: 8 },
  showMoreBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  showMoreText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  kitchenBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: COLORS.green,
  },
  kitchenBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
