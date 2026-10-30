import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AIError, aiErrorMessage } from '@/ai/aiEdgeClient';
import { generateRecipeConcept } from '@/ai/generateRecipeConcept';
import type { RecipeConcept as Concept } from '@/ai/types';
import { ProgressiveLoader } from '@/components/ProgressiveLoader';
import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { openPaywall } from '@/lib/paywall';
import type { RecipeCategory } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import { newId } from '@/lib/sync/uuid';

// ─── Types ───────────────────────────────────────────────────────────────────

type Stage = 'mealType' | 'describe' | 'creating';


const MEAL_TYPES: { label: string; value: RecipeCategory; hint: string }[] = [
  { label: 'Breakfast', value: 'Breakfast', hint: 'Start the day right' },
  { label: 'Snack',     value: 'Snacks',    hint: 'A quick bite between meals' },
  { label: 'Lunch',     value: 'Lunch',     hint: 'Midday fuel' },
  { label: 'Dinner',    value: 'Dinner',    hint: 'Round out the day' },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function CustomRecipeScreen() {
  const params = useLocalSearchParams<{
    swap?: string;
    seed?: string;
    fromKitchenAI?: string;
  }>();
  const swapFlow = params.swap === 'true';
  const seed = (params.seed ?? '').toString();
  const fromKitchenAI = params.fromKitchenAI === 'true';

  const addCustomRecipe = useMealStore(s => s.addCustomRecipe);
  const clearPendingRecipeConcept = useMealStore(s => s.clearPendingRecipeConcept);
  const showToast = useToastStore(s => s.showToast);
  const insets = useSafeAreaInsets();

  const [stage, setStage] = useState<Stage>('mealType');
  const [mealType, setMealType] = useState<RecipeCategory | null>(null);
  const [describeText, setDescribeText] = useState(seed);
  // One id per recipe being created: links its AI calls in ai_events.
  const [flowId] = useState(() => newId());

  // The recipe is saved to Recent as soon as it exists and shown on the one
  // recipe page (Fix | View Full Recipe there). In a swap, that page offers
  // "Use this recipe" for the slot the swap came from.
  const openRecipe = (recipe: Concept) => {
    const saved = addCustomRecipe(recipe);
    router.replace({
      pathname: '/recipe/[id]',
      params: swapFlow ? { id: saved.id, swap: 'true' } : { id: saved.id },
    });
  };

  // What Can I Make hands over an already-complete recipe: no AI call needed.
  const kitchenHandled = useRef(false);
  useEffect(() => {
    if (!fromKitchenAI || kitchenHandled.current) return;
    kitchenHandled.current = true;
    const handoff = useMealStore.getState().pendingRecipeConcept;
    clearPendingRecipeConcept();
    if (!handoff) { exit(); return; }
    // Tapping the same suggestion again reopens it rather than adding a copy.
    const existing = useMealStore.getState().savedRecipes.find(
      r => r.source === 'ai' && r.name.trim().toLowerCase() === handoff.name.trim().toLowerCase(),
    );
    if (existing) router.replace({ pathname: '/recipe/[id]', params: { id: existing.id } });
    else openRecipe(handoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKitchenAI]);

  const exit = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  const handleBack = () => {
    if (stage === 'describe') { setStage('mealType'); return; }
    exit();
  };

  // not_premium opens the shared paywall (the idea uses the free-scan pool)
  // and re-runs the same request after a purchase; anything else is a toast.
  const submitDescribe = async () => {
    const text = describeText.trim();
    if (!text || !mealType) return;
    setStage('creating');
    try {
      const recipe = await generateRecipeConcept({ description: text, mealType, flowId });
      openRecipe(recipe);
    } catch (e) {
      console.warn('[custom recipe] AI call failed:', e);
      setStage('describe');
      if (e instanceof AIError && e.code === 'not_premium') {
        openPaywall({ reason: 'scan_limit', onSuccess: () => void submitDescribe() });
        return;
      }
      showToast(aiErrorMessage(e, 'Could not create this recipe right now. Please try again.'));
    }
  };

  if (fromKitchenAI) return <Screen edges={['top', 'bottom']}><View style={styles.flex} /></Screen>;

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.iconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Custom Recipe</Text>
        <View style={styles.iconBtn} />
      </View>

      {stage === 'mealType' ? (
        <MealTypeScreen
          selected={mealType}
          onSelect={setMealType}
          onNext={() => setStage('describe')}
          bottomInset={insets.bottom}
        />
      ) : null}

      {stage === 'describe' ? (
        <DescribeScreen
          value={describeText}
          onChange={setDescribeText}
          onSubmit={submitDescribe}
          bottomInset={insets.bottom}
        />
      ) : null}

      {stage === 'creating' ? (
        <ProgressiveLoader
          messages={[
            'Reading your description…',
            'Designing your recipe…',
            'Matching it to your preferences…',
            'Almost ready…',
          ]}
        />
      ) : null}
    </Screen>
  );
}

// ─── Screen 1: meal type (vertical list) ──────────────────────────────────────

function MealTypeScreen({
  selected, onSelect, onNext, bottomInset,
}: {
  selected: RecipeCategory | null;
  onSelect: (c: RecipeCategory) => void;
  onNext: () => void;
  bottomInset: number;
}) {
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.q}>What meal is this for?</Text>
        <Text style={styles.qSub}>Pick a category to tailor your recipe.</Text>
        <View style={styles.optionList}>
          {MEAL_TYPES.map(m => {
            const active = selected === m.value;
            return (
              <TouchableOpacity
                key={m.value}
                style={[styles.optionCard, active && styles.optionCardActive]}
                onPress={() => onSelect(m.value)}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{m.label}</Text>
                  <Text style={styles.optionHint}>{m.hint}</Text>
                </View>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <Ionicons name="checkmark" size={16} color="#0E1A12" /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(bottomInset, 12) }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, !selected && styles.primaryBtnDisabled]}
          disabled={!selected}
          onPress={onNext}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Screen 2: describe (Fix Result style) ────────────────────────────────────

function DescribeScreen({
  value, onChange, onSubmit, bottomInset,
}: {
  value: string;
  onChange: (t: string) => void;
  onSubmit: () => void;
  bottomInset: number;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.q}>What are you craving?</Text>
        <Text style={styles.qSub}>We&apos;ll factor in your goals, targets, and dietary preferences automatically.</Text>
        <TextInput
          style={styles.describeInput}
          value={value}
          onChangeText={onChange}
          placeholder="Describe the recipe you want…"
          placeholderTextColor={COLORS.textMuted}
          multiline
          textAlignVertical="top"
        />
        <View style={styles.exampleCard}>
          <Text style={styles.exampleText}>
            <Text style={styles.exampleBold}>Example: </Text>
            A high protein chicken stir fry with vegetables and rice.
          </Text>
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(bottomInset, 12) }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, !value.trim() && styles.primaryBtnDisabled]}
          disabled={!value.trim()}
          onPress={onSubmit}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Create Recipe</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  title: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },


  body: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 24 },

  q: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  qSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6, marginBottom: 20 },

  // Meal-type vertical list (Build My Plan card style)
  optionList: { gap: 12 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  optionCardActive: { borderColor: COLORS.green, backgroundColor: COLORS.green + '14' },
  optionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  optionTitleActive: { color: COLORS.green },
  optionHint: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },

  // Describe / Fix input (Fix Result style)
  describeInput: {
    backgroundColor: COLORS.card,
    color: COLORS.text,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    fontSize: 16,
    minHeight: 130,
  },
  exampleCard: {
    marginTop: 16,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
  },
  exampleText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  exampleBold: { color: COLORS.text, fontWeight: '700' },

  // Concept (meal-detail-popup style)





  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  primaryBtn: {
    backgroundColor: COLORS.green,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#0E1A12', fontSize: 15, fontWeight: '800' },


  // Three-dots menu

  // Report popup
});
