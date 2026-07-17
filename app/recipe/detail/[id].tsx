import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

interface ChatMsg {
  id: string;
  role: 'assistant' | 'user';
  text: string;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_HEIGHT = Math.round(SCREEN_HEIGHT * 0.52);

export default function RecipeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = (params.id || '').toString();

  const recipes = useMealStore(s => s.recipes);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const { favourite } = useRecipeActions();
  const insets = useSafeAreaInsets();

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

  if (!resolved || !recipeInput) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Recipe</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Recipe not found.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{resolved.name}</Text>
        <TouchableOpacity
          onPress={() => favourite(recipeInput)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons
            name={resolved.favourited ? 'bookmark' : 'bookmark-outline'}
            size={22}
            color={resolved.favourited ? COLORS.green : COLORS.textSecondary}
          />
        </TouchableOpacity>
      </View>

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

        <View style={styles.statRow}>
          <Stat label="Calories" value={`${resolved.calories}`} />
          {resolved.cookTimeMin != null ? <Stat label="Cook time" value={`${resolved.cookTimeMin}m`} /> : null}
          <Stat label="Protein" value={`${resolved.macros.protein}g`} />
          <Stat label="Carbs" value={`${resolved.macros.carbs}g`} />
          <Stat label="Fats" value={`${resolved.macros.fats}g`} />
        </View>

        <Text style={styles.sectionHeader}>Ingredients</Text>
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
          resolved.steps.map((s, idx) => (
            <View key={idx} style={styles.stepRow}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{idx + 1}</Text></View>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No steps included for this recipe.</Text>
        )}
      </ScrollView>

      <RecipeAiChat recipeName={resolved.name} bottomInset={insets.bottom} />
    </Screen>
  );
}

// ─── AI chat (shell) ─────────────────────────────────────────────────────────

function RecipeAiChat({ recipeName, bottomInset }: { recipeName: string; bottomInset: number }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const translateY = useRef(new Animated.Value(PANEL_HEIGHT)).current;
  const scrollRef = useRef<ScrollView>(null);

  const openPanel = () => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'intro',
          role: 'assistant',
          text: `Ask me anything about ${recipeName} — swaps, substitutions, or tweaks. (AI answers are coming soon; this is a preview.)`,
        },
      ]);
    }
    setOpen(true);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 4,
      speed: 14,
    }).start();
  };

  const closePanel = () => {
    Animated.timing(translateY, {
      toValue: PANEL_HEIGHT,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setOpen(false));
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', text };
    const reply: ChatMsg = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      text: `Good question about ${recipeName}! Smart AI cooking help is on the way — for now, trust your taste and adjust to preference.`,
    };
    setMessages(prev => [...prev, userMsg, reply]);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <>
      {/* Floating action button */}
      {!open ? (
        <TouchableOpacity style={[styles.fab, { bottom: Math.max(bottomInset, 12) + 12 }]} onPress={openPanel} activeOpacity={0.85}>
          <Ionicons name="sparkles" size={22} color="#0E1A12" />
        </TouchableOpacity>
      ) : null}

      {/* Backdrop */}
      {open ? <Pressable style={styles.backdrop} onPress={closePanel} /> : null}

      {/* Slide-up panel */}
      <Animated.View
        style={[
          styles.panel,
          { height: PANEL_HEIGHT, transform: [{ translateY }] },
        ]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <View style={styles.panelHandleRow}>
          <View style={styles.panelHandle} />
        </View>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Recipe Assistant</Text>
          <TouchableOpacity onPress={closePanel} hitSlop={10}>
            <Ionicons name="chevron-down" size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.chatScroll}
            keyboardShouldPersistTaps="handled"
          >
            {messages.map(m => (
              <View
                key={m.id}
                style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}
              >
                <Text style={m.role === 'user' ? styles.userText : styles.assistantText}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.inputRow, { paddingBottom: Math.max(bottomInset, 10) }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about this recipe…"
              placeholderTextColor={COLORS.textSecondary}
              style={styles.input}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              multiline
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!input.trim()}
              style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
              activeOpacity={0.8}
            >
              <Text style={styles.sendBtnText}>↑</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  headerTitle: { flex: 1, color: COLORS.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginHorizontal: 4 },

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

  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  stat: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 64,
    flexGrow: 1,
  },
  statValue: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  statLabel: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

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

  // ── Chat panel ──
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  panelHandleRow: { alignItems: 'center', paddingTop: 8 },
  panelHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  panelTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },

  chatScroll: { padding: 14, gap: 8 },
  assistantBubble: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
    alignSelf: 'flex-start',
    maxWidth: '88%',
  },
  assistantText: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
  userBubble: {
    backgroundColor: COLORS.green,
    borderRadius: 14,
    padding: 12,
    alignSelf: 'flex-end',
    maxWidth: '88%',
  },
  userText: { color: '#0E1A12', fontSize: 14, lineHeight: 20 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 8,
    backgroundColor: COLORS.bg,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    color: COLORS.text,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.elevated },
  sendBtnText: { color: '#0E1A12', fontSize: 18, fontWeight: '700' },
});
