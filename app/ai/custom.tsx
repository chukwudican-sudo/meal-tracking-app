import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ChatShell, type ChatMessage, type ChipSuggestion } from '@/components/ai/ChatShell';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { COLORS } from '@/constants/theme';
import { toRecipeInputFromTemplate, useRecipeActions } from '@/hooks/useRecipeActions';
import type { Macros, RecipeTemplate } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';

interface GeneratedRecipe {
  id: string;            // ephemeral generated id (not in store)
  baseRecipe: RecipeTemplate;
  name: string;
  calories: number;
  cookTimeMin: number;
  macros: Macros;
  description: string;
}

// Steps the conversation flows through.
type Stage = 'init' | 'awaitDescribe' | 'askTime' | 'askCuisine' | 'thinking' | 'showResult' | 'done';

const TIME_CHIPS = ['<15m', '15-30m', '30m+'];
const CUISINE_CHIPS = ['Italian', 'Asian', 'Mexican', 'American'];

export default function CustomRecipeScreen() {
  const params = useLocalSearchParams<{ seed?: string }>();
  const seed = (params.seed || '').toString();

  const recipes = useMealStore(s => s.recipes);
  const profile = useMealStore(s => s.profile);
  const { addToToday, addToPlan, favourite } = useRecipeActions();

  const [stage, setStage] = useState<Stage>('init');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(seed);
  const [chips, setChips] = useState<ChipSuggestion[]>([]);
  const [generated, setGenerated] = useState<GeneratedRecipe | null>(null);

  // Track whether the latest generation has been "saved" (plan/today/favourited)
  // so we can warn on back-out.
  const savedRef = useRef(false);
  const generatedRef = useRef<GeneratedRecipe | null>(null);
  generatedRef.current = generated;

  // Intro greeting.
  useEffect(() => {
    if (stage !== 'init') return;
    const greeting = profile.name ? `Hey ${profile.name}!` : 'Hey!';
    setMessages([
      {
        id: 'm1',
        kind: 'assistant',
        text: `${greeting} Describe a recipe you'd like — ingredients, vibe, dietary notes, anything.`,
      },
    ]);
    if (seed) {
      // Auto-send the seeded text after a short delay.
      setStage('awaitDescribe');
      const timer = setTimeout(() => submitDescribe(seed), 250);
      return () => clearTimeout(timer);
    }
    setStage('awaitDescribe');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, seed, profile.name]);

  const generateRecipe = (description: string, timeChoice?: string, cuisine?: string): GeneratedRecipe => {
    // Closest-match base recipe by simple keyword overlap on name + ingredients.
    const lower = (description + ' ' + (cuisine ?? '')).toLowerCase();
    const scored = recipes.map(r => {
      let score = 0;
      const hay = `${r.name} ${r.category} ${r.ingredients.map(i => i.name).join(' ')}`.toLowerCase();
      lower.split(/\s+/).filter(Boolean).forEach(token => {
        if (hay.includes(token)) score++;
      });
      return { r, score };
    }).sort((a, b) => b.score - a.score);

    const baseRecipe = (scored[0]?.score ?? 0) > 0 ? scored[0].r : recipes[Math.floor(Math.random() * recipes.length)];
    // Lightly mutate: cap time per chip and adjust calories within +-15%.
    let cookTimeMin = baseRecipe.cookTimeMin;
    if (timeChoice === '<15m') cookTimeMin = Math.min(cookTimeMin, 12);
    else if (timeChoice === '15-30m') cookTimeMin = Math.min(Math.max(cookTimeMin, 15), 28);
    else if (timeChoice === '30m+') cookTimeMin = Math.max(cookTimeMin, 30);

    const drift = 0.9 + Math.random() * 0.2;
    const calories = Math.round(baseRecipe.calories * drift);
    const macros: Macros = {
      protein: Math.round(baseRecipe.macros.protein * drift),
      carbs:   Math.round(baseRecipe.macros.carbs   * drift),
      fats:    Math.round(baseRecipe.macros.fats    * drift),
    };

    // Build a generated name from cuisine + base name.
    const namePrefix = cuisine ? `${cuisine}-style ` : '';
    const name = `${namePrefix}${baseRecipe.name}`;

    return {
      id: `gen-${Date.now()}`,
      baseRecipe,
      name,
      calories,
      cookTimeMin,
      macros,
      description,
    };
  };

  const submitDescribe = (text: string) => {
    setInput('');
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, kind: 'user', text };

    // Heuristic: if profile has dietary info or description already mentions time/cuisine,
    // skip the chip questions and go straight to thinking.
    const lower = text.toLowerCase();
    const mentionsTime = /(\d+\s?min|quick|fast|slow|under|less than)/.test(lower);
    const mentionsCuisine = CUISINE_CHIPS.some(c => lower.includes(c.toLowerCase()));

    setMessages(prev => [...prev, userMsg]);

    if (!mentionsTime) {
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        kind: 'assistant',
        text: 'How much time do you have?',
      }]);
      setChips(TIME_CHIPS.map(label => ({
        id: `time-${label}`,
        label,
        onPress: () => onTimeChip(text, label, mentionsCuisine),
      })));
      setStage('askTime');
      return;
    }

    if (!mentionsCuisine) {
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        kind: 'assistant',
        text: 'Any cuisine in mind?',
      }]);
      setChips(CUISINE_CHIPS.map(label => ({
        id: `cuisine-${label}`,
        label,
        onPress: () => startGenerate(text, undefined, label),
      })));
      setStage('askCuisine');
      return;
    }

    startGenerate(text);
  };

  const onTimeChip = (description: string, timeChoice: string, alreadyMentionsCuisine: boolean) => {
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, kind: 'user', text: timeChoice };
    setMessages(prev => [...prev, userMsg]);
    setChips([]);

    if (!alreadyMentionsCuisine) {
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        kind: 'assistant',
        text: 'Any cuisine in mind?',
      }]);
      setChips(CUISINE_CHIPS.map(label => ({
        id: `cuisine-${label}`,
        label,
        onPress: () => startGenerate(description, timeChoice, label),
      })));
      setStage('askCuisine');
      return;
    }
    startGenerate(description, timeChoice);
  };

  const startGenerate = (description: string, timeChoice?: string, cuisine?: string) => {
    if (cuisine) {
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, kind: 'user', text: cuisine };
      setMessages(prev => [...prev, userMsg]);
    }
    setChips([]);
    setMessages(prev => [...prev, { id: `t-${Date.now()}`, kind: 'thinking' }]);
    setStage('thinking');

    const timer = setTimeout(() => {
      const gen = generateRecipe(description, timeChoice, cuisine);
      setGenerated(gen);
      savedRef.current = false;
      setMessages(prev => prev
        .filter(m => m.kind !== 'thinking')
        .concat({
          id: `a-${Date.now()}`,
          kind: 'assistant',
          text: `Here's a recipe based on ${gen.baseRecipe.name.toLowerCase()} — feel free to add it to your plan or save it.`,
        })
        .concat({
          id: `card-${gen.id}`,
          kind: 'card',
          render: () => renderGeneratedCard(gen),
        }));
      setStage('showResult');
    }, 800);
    return () => clearTimeout(timer);
  };

  const renderGeneratedCard = (gen: GeneratedRecipe) => {
    const recipeInput = {
      ...toRecipeInputFromTemplate(gen.baseRecipe),
      recipeId: undefined, // generated, not a premade match
      name: gen.name,
      calories: gen.calories,
      cookTimeMin: gen.cookTimeMin,
      macros: gen.macros,
      source: 'ai' as const,
    };

    return (
      <View>
        <RecipeCard
          variant="ai"
          name={gen.name}
          calories={gen.calories}
          cookTimeMin={gen.cookTimeMin}
          onPress={() => {
            // Open detail by auto-saving first so it has a real id.
            const fav = favourite(recipeInput);
            savedRef.current = true;
            router.push({ pathname: '/recipe/[id]', params: { id: fav.id } });
          }}
        />
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.actionBtnOutline}
            onPress={() => { savedRef.current = true; addToPlan(recipeInput); }}
            activeOpacity={0.85}
          >
            <Text style={styles.actionOutlineText}>Add to Plan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtnPrimary}
            onPress={() => { savedRef.current = true; addToToday(recipeInput); }}
            activeOpacity={0.85}
          >
            <Text style={styles.actionPrimaryText}>Add to Today</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.favBtn}
          onPress={() => { favourite(recipeInput); savedRef.current = true; }}
          activeOpacity={0.85}
        >
          <Text style={styles.favBtnText}>♡ Save</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;
    if (stage === 'awaitDescribe') {
      submitDescribe(text);
      return;
    }
    if (stage === 'showResult') {
      // Refine — treat as a new describe with the existing recipe as context.
      submitDescribe(text);
      return;
    }
    setInput('');
  };

  const handleBack = () => {
    if (generatedRef.current && !savedRef.current) {
      Alert.alert(
        'Save this recipe before leaving?',
        'You generated a recipe but haven\'t added or saved it yet.',
        [
          {
            text: 'Save',
            onPress: () => {
              const g = generatedRef.current;
              if (g) {
                favourite({
                  ...toRecipeInputFromTemplate(g.baseRecipe),
                  recipeId: undefined,
                  name: g.name,
                  calories: g.calories,
                  cookTimeMin: g.cookTimeMin,
                  macros: g.macros,
                  source: 'ai',
                });
              }
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/recipes');
            },
          },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/recipes');
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  return (
    <ChatShell
      title="Custom Recipe"
      onBack={handleBack}
      disclaimer="Suggestions are AI-style helpers, not medical or dietary advice. Verify ingredients match your needs."
      messages={messages}
      chips={chips}
      inputValue={input}
      onChangeInput={setInput}
      onSubmit={handleSubmit}
      placeholder={stage === 'showResult' ? 'Tweak this recipe…' : 'Describe a recipe…'}
      inputDisabled={stage === 'thinking'}
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
  favBtn: {
    marginTop: 6,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.elevated,
  },
  favBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
});
