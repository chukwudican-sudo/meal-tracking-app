import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import type {
  MealPlan,
  MealSlot,
  PlanDayMeal,
  RecipeCategory,
  RecipeTemplate,
  UserProfile,
} from '@/store/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function categoryForSlot(slotName: string): RecipeCategory {
  const lc = slotName.toLowerCase();
  if (lc.includes('snack')) return 'Snacks';
  if (lc.includes('breakfast')) return 'Breakfast';
  if (lc.includes('lunch')) return 'Lunch';
  if (lc.includes('dinner') || lc.includes('supper')) return 'Dinner';
  return 'Lunch';
}

// Filter the catalogue by dietary preferences + allergies coming from profile.
function applyDietaryFilter(
  recipes: RecipeTemplate[],
  profile: UserProfile,
): RecipeTemplate[] {
  const allergies = (profile.allergies ?? []).map(a => a.toLowerCase()).filter(Boolean);
  const dietary = (profile.dietaryRestrictions ?? []).map(d => d.toLowerCase());
  const vegetarian = dietary.some(d => d.includes('vegetarian'));
  const vegan = dietary.some(d => d.includes('vegan'));
  const pesc = dietary.some(d => d.includes('pesc'));

  const MEAT_KEYWORDS = ['chicken', 'beef', 'turkey', 'pork', 'bacon', 'ham', 'sausage'];
  const SEAFOOD_KEYWORDS = ['fish', 'salmon', 'tuna', 'shrimp', 'prawn'];
  const ANIMAL_KEYWORDS = ['egg', 'milk', 'yogurt', 'cheese', 'butter', 'cream'];

  return recipes.filter(r => {
    const text = r.ingredients.map(i => i.name.toLowerCase()).join(' ') + ' ' + r.name.toLowerCase();
    if (allergies.some(a => text.includes(a))) return false;
    if (vegan && [...MEAT_KEYWORDS, ...SEAFOOD_KEYWORDS, ...ANIMAL_KEYWORDS].some(k => text.includes(k))) return false;
    if (vegetarian && [...MEAT_KEYWORDS, ...SEAFOOD_KEYWORDS].some(k => text.includes(k))) return false;
    if (pesc && MEAT_KEYWORDS.some(k => text.includes(k))) return false;
    return true;
  });
}

// Rank recipes by goal-aware score (higher = better fit).
function rankForGoal(
  recipes: RecipeTemplate[],
  profile: UserProfile,
): RecipeTemplate[] {
  const goal = profile.goalType;
  const scored = recipes.map(r => {
    let score = 0;
    if (goal === 'gain_muscle' || goal === 'lean_bulk') score += r.macros.protein * 1.2;
    if (goal === 'lose_weight') score -= r.calories * 0.5;
    if (goal === 'maintain') score += r.macros.protein * 0.5;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.r);
}

// A picked slot result. `recipe: null` represents a skipped slot ("No <slot>").
interface PickedSlot {
  slot: MealSlot;
  recipe: RecipeTemplate | null;
}

// Build a 7-day plan by rotating sibling recipes within the same category.
function assembleWeek(
  picks: PickedSlot[],
  filteredByCategory: Record<RecipeCategory, RecipeTemplate[]>,
): PlanDayMeal[][] {
  return Array.from({ length: 7 }, (_, day) =>
    picks.flatMap<PlanDayMeal>(p => {
      if (!p.recipe) return [];
      const cat = categoryForSlot(p.slot.name);
      const pool = filteredByCategory[cat] ?? [];
      // Find anchor index in pool, rotate from there.
      const anchorIdx = Math.max(0, pool.findIndex(r => r.id === p.recipe!.id));
      const choice = pool.length > 0 ? pool[(anchorIdx + day) % pool.length] : p.recipe;
      return [
        {
          slotName: p.slot.name,
          time: p.slot.time,
          recipeId: choice.id,
          recipeName: choice.name,
        },
      ];
    }),
  );
}

function dayCalories(
  day: PlanDayMeal[],
  recipeById: Map<string, RecipeTemplate>,
): number {
  return day.reduce((sum, m) => sum + (recipeById.get(m.recipeId)?.calories ?? 0), 0);
}

// ─── Screen ──────────────────────────────────────────────────────────────────

type Step = 'slots' | 'pick' | 'preview';

export default function BuildPlanScreen() {
  const profile = useMealStore(s => s.profile);
  const recipes = useMealStore(s => s.recipes);
  const templates = useMealStore(s => s.templates);
  const updateProfile = useMealStore(s => s.updateProfile);
  const activatePlan = useMealStore(s => s.activatePlan);
  const saveCurrentPlanAs = useMealStore(s => s.saveCurrentPlanAs);
  const showToast = useToastStore(s => s.showToast);

  const [step, setStep] = useState<Step>('slots');
  const [slots, setSlots] = useState<MealSlot[]>(profile.mealSlots);
  const [slotIdx, setSlotIdx] = useState(0);
  const [picks, setPicks] = useState<PickedSlot[]>([]);
  // Per-slot card budget — picker starts with 4 and grows by 3 on "Show more".
  const [shownCount, setShownCount] = useState(4);
  // AI "Describe what you want" — produces one custom recipe pinned to the top.
  const [describeText, setDescribeText] = useState('');
  const [customCard, setCustomCard] = useState<RecipeTemplate | null>(null);

  // Preview swap modal state.
  const [swap, setSwap] = useState<{ dayIdx: number; mealIdx: number } | null>(null);

  // Final assembled plan stored in state once we hit preview.
  const [assembled, setAssembled] = useState<MealPlan | null>(null);

  // ── Pre-computed filtered pools ──────────────────────────────────────────
  const dietaryFiltered = useMemo(() => applyDietaryFilter(recipes, profile), [recipes, profile]);
  const recipeById = useMemo(() => {
    const m = new Map<string, RecipeTemplate>();
    recipes.forEach(r => m.set(r.id, r));
    if (customCard) m.set(customCard.id, customCard);
    return m;
  }, [recipes, customCard]);

  const byCategory = useMemo<Record<RecipeCategory, RecipeTemplate[]>>(() => {
    const map: Record<RecipeCategory, RecipeTemplate[]> = {
      Breakfast: [], Lunch: [], Dinner: [], Snacks: [],
    };
    const ranked = rankForGoal(dietaryFiltered, profile);
    ranked.forEach(r => { map[r.category].push(r); });
    return map;
  }, [dietaryFiltered, profile]);

  // ── Profile completeness guard ───────────────────────────────────────────
  if (!profile.goalType) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title="Build My Plan" />
        <View style={styles.guardWrap}>
          <Text style={styles.guardEmoji}>🛠️</Text>
          <Text style={styles.guardTitle}>Set up your profile first</Text>
          <Text style={styles.guardBody}>
            Build My Plan tailors meals to your goal, dietary preferences, and activity level.
            Set your goal first so we can generate relevant suggestions.
          </Text>
          <TouchableOpacity
            style={styles.guardCta}
            onPress={() => router.replace('/profile/edit-goal')}
          >
            <Text style={styles.guardCtaText}>Complete profile</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Step 1: Slot editor ──────────────────────────────────────────────────
  if (step === 'slots') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title="Build My Plan" subtitle="Step 1 of 3 · Meal slots" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.helperText}>
              These are the meals you eat in a day. You can add, remove, or rename them, and adjust
              the times.
            </Text>
            {slots.map((slot, idx) => (
              <View key={slot.id} style={styles.slotRow}>
                <TextInput
                  style={[styles.slotInput, { flex: 2 }]}
                  value={slot.name}
                  onChangeText={v => setSlots(prev => prev.map((s, i) => i === idx ? { ...s, name: v } : s))}
                  placeholder="Meal name"
                  placeholderTextColor={COLORS.textMuted}
                />
                <TextInput
                  style={[styles.slotInput, { flex: 1 }]}
                  value={slot.time}
                  onChangeText={v => setSlots(prev => prev.map((s, i) => i === idx ? { ...s, time: v } : s))}
                  placeholder="HH:MM"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={styles.slotRemove}
                  onPress={() => setSlots(prev => prev.filter((_, i) => i !== idx))}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.slotRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={styles.addSlotBtn}
              onPress={() => setSlots(prev => [
                ...prev,
                { id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, name: 'New meal', time: '12:00' },
              ])}
            >
              <Text style={styles.addSlotText}>+ Add meal slot</Text>
            </TouchableOpacity>
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.back()}
            >
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, slots.length === 0 && styles.disabledBtn]}
              disabled={slots.length === 0}
              onPress={() => {
                // Sort slots by time for a consistent picker walk.
                const sorted = [...slots].sort((a, b) => a.time.localeCompare(b.time));
                setSlots(sorted);
                updateProfile({ mealSlots: sorted });
                setSlotIdx(0);
                setShownCount(4);
                setCustomCard(null);
                setStep('pick');
              }}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Step 2: Per-slot picker ──────────────────────────────────────────────
  if (step === 'pick') {
    const slot = slots[slotIdx];
    const cat = categoryForSlot(slot.name);
    const pool = byCategory[cat] ?? [];
    const cards: RecipeTemplate[] = customCard
      ? [customCard, ...pool.filter(r => r.id !== customCard.id).slice(0, shownCount - 1)]
      : pool.slice(0, shownCount);

    const pickRecipe = (recipe: RecipeTemplate | null) => {
      const next: PickedSlot = { slot, recipe };
      const newPicks = [...picks, next];
      // Last slot? assemble and move to preview.
      if (slotIdx >= slots.length - 1) {
        const plan = buildPlan(newPicks);
        setPicks(newPicks);
        setAssembled(plan);
        setStep('preview');
      } else {
        setPicks(newPicks);
        setSlotIdx(slotIdx + 1);
        setShownCount(4);
        setCustomCard(null);
        setDescribeText('');
      }
    };

    const handleDescribe = () => {
      const text = describeText.trim();
      if (!text) return;
      const custom: RecipeTemplate = {
        id: `custom-${Date.now()}`,
        name: text.slice(0, 60),
        category: cat,
        calories: 450,
        cookTimeMin: 20,
        macros: { protein: 25, carbs: 45, fats: 15 },
        ingredients: [],
        steps: ['Step 1', 'Step 2'],
      };
      setCustomCard(custom);
      setDescribeText('');
      showToast('Generated a custom option');
    };

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header
          title={slot.name}
          subtitle={`Step ${slotIdx + 1} of ${slots.length} · ${slot.time}`}
          onBack={() => {
            // Going back: drop the last pick if exists.
            if (slotIdx === 0) {
              setStep('slots');
              return;
            }
            setSlotIdx(slotIdx - 1);
            setPicks(prev => prev.slice(0, -1));
            setShownCount(4);
            setCustomCard(null);
            setDescribeText('');
          }}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {cards.length === 0 && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  No matching recipes for this slot. Adjust dietary preferences in your profile or
                  describe what you want below.
                </Text>
              </View>
            )}
            {cards.map(r => (
              <PickCard
                key={r.id}
                recipe={r}
                isCustom={customCard?.id === r.id}
                onPick={() => pickRecipe(r)}
              />
            ))}
            {pool.length > shownCount && (
              <TouchableOpacity
                style={styles.showMoreBtn}
                onPress={() => setShownCount(c => c + 3)}
              >
                <Text style={styles.showMoreText}>Show more</Text>
              </TouchableOpacity>
            )}
            <View style={styles.describeBox}>
              <Text style={styles.describeLabel}>Describe what you want</Text>
              <TextInput
                style={styles.describeInput}
                value={describeText}
                onChangeText={setDescribeText}
                placeholder={`e.g. quick high-protein ${slot.name.toLowerCase()}`}
                placeholderTextColor={COLORS.textMuted}
                multiline
              />
              <TouchableOpacity
                style={[styles.describeBtn, !describeText.trim() && styles.disabledBtn]}
                disabled={!describeText.trim()}
                onPress={handleDescribe}
              >
                <Text style={styles.describeBtnText}>Generate option</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.skipRow}
              onPress={() => pickRecipe(null)}
            >
              <Text style={styles.skipText}>No {slot.name}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Step 3: Preview ──────────────────────────────────────────────────────
  if (!assembled) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title="Build My Plan" />
        <View style={styles.guardWrap}>
          <Text style={styles.guardBody}>Assembling your plan…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header
        title="Preview your plan"
        subtitle="Tap any meal to swap it"
        onBack={() => setStep('pick')}
      />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {assembled.days.map((day, dayIdx) => (
          <View key={dayIdx} style={styles.dayBlock}>
            <View style={styles.dayHead}>
              <Text style={styles.dayName}>{WEEKDAY_LABELS[dayIdx]}</Text>
              <Text style={styles.dayCals}>{dayCalories(day, recipeById)} cal</Text>
            </View>
            {day.length === 0 && (
              <Text style={styles.daySkip}>No meals — all slots skipped</Text>
            )}
            {day.map((meal, mealIdx) => {
              const r = recipeById.get(meal.recipeId);
              return (
                <TouchableOpacity
                  key={`${dayIdx}-${mealIdx}`}
                  style={styles.previewMeal}
                  onPress={() => setSwap({ dayIdx, mealIdx })}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewMealName}>{meal.recipeName}</Text>
                    <Text style={styles.previewMealMeta}>
                      {meal.slotName} · {meal.time}{r ? ` · ${r.calories} cal` : ''}
                    </Text>
                  </View>
                  <Text style={styles.swapChevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => setStep('pick')}
        >
          <Text style={styles.secondaryBtnText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => onActivate(assembled)}
        >
          <Text style={styles.primaryBtnText}>Activate Plan</Text>
        </TouchableOpacity>
      </View>

      {/* Swap overlay */}
      <Modal
        transparent
        visible={!!swap}
        animationType="slide"
        onRequestClose={() => setSwap(null)}
      >
        <Pressable style={styles.swapBackdrop} onPress={() => setSwap(null)}>
          <Pressable style={styles.swapCard}>
            {swap && (() => {
              const targetMeal = assembled.days[swap.dayIdx][swap.mealIdx];
              const cat = categoryForSlot(targetMeal.slotName);
              const candidates = (byCategory[cat] ?? []).slice(0, 8);
              return (
                <>
                  <Text style={styles.swapTitle}>Swap {targetMeal.slotName}</Text>
                  <ScrollView style={{ maxHeight: 400 }}>
                    {candidates.map(c => (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.swapItem}
                        onPress={() => {
                          setAssembled(prev => prev ? {
                            ...prev,
                            days: prev.days.map((d, di) =>
                              di === swap.dayIdx
                                ? d.map((m, mi) =>
                                    mi === swap.mealIdx
                                      ? { ...m, recipeId: c.id, recipeName: c.name }
                                      : m,
                                  )
                                : d,
                            ),
                          } : prev);
                          setSwap(null);
                        }}
                      >
                        <Text style={styles.swapItemName}>{c.name}</Text>
                        <Text style={styles.swapItemMeta}>{c.calories} cal · {c.cookTimeMin}m</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    style={styles.swapCancel}
                    onPress={() => setSwap(null)}
                  >
                    <Text style={styles.swapCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );

  // ── Helpers wired to closure state ──────────────────────────────────────

  function buildPlan(allPicks: PickedSlot[]): MealPlan {
    const days = assembleWeek(allPicks, byCategory);
    return {
      id: `plan-built-${Date.now()}`,
      name: `Custom Plan ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      description: 'Custom plan built from your picks.',
      disclaimer: undefined,
      category: undefined,
      days,
      targets: undefined,
      savedAt: new Date().toISOString(),
      source: 'user',
    };
  }

  function onActivate(plan: MealPlan) {
    if (templates.length === 0) {
      activatePlan(plan);
      showToast(`${plan.name} activated`);
      router.dismissAll();
      return;
    }
    Alert.alert(
      'Replace your current plan?',
      'You already have an active plan. Save it first or replace it.',
      [
        {
          text: 'Save and replace',
          onPress: () => {
            const fallback = profile.activePlanName || `Plan saved ${new Date().toLocaleDateString()}`;
            saveCurrentPlanAs(fallback);
            activatePlan(plan);
            showToast(`${plan.name} activated`);
            router.dismissAll();
          },
        },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            activatePlan(plan);
            showToast(`${plan.name} activated`);
            router.dismissAll();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Header({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
  };
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={handleBack}
        style={styles.headerBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.headerBackText}>←</Text>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.headerBack} />
    </View>
  );
}

function PickCard({
  recipe,
  isCustom,
  onPick,
}: {
  recipe: RecipeTemplate;
  isCustom: boolean;
  onPick: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPick} activeOpacity={0.85} style={styles.pickCard}>
      <View style={styles.pickHead}>
        <Text style={styles.pickName} numberOfLines={1}>{recipe.name}</Text>
        {isCustom ? <Text style={styles.customTag}>Custom</Text> : null}
      </View>
      <Text style={styles.pickMeta}>
        {recipe.calories} cal · {recipe.cookTimeMin}m
      </Text>
      <View style={styles.macroRow}>
        <Text style={styles.macroPill}>P {recipe.macros.protein}g</Text>
        <Text style={styles.macroPill}>C {recipe.macros.carbs}g</Text>
        <Text style={styles.macroPill}>F {recipe.macros.fats}g</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerBackText: { color: COLORS.text, fontSize: 22, fontWeight: '600' },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  headerSubtitle: { color: COLORS.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 2 },

  body: { padding: 16, paddingBottom: 40, gap: 10 },

  helperText: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 6 },

  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  slotInput: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 13,
  },
  slotRemove: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  slotRemoveText: { color: COLORS.textSecondary, fontSize: 16 },
  addSlotBtn: {
    borderWidth: 1, borderStyle: 'dashed',
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  addSlotText: { color: COLORS.green, fontSize: 13, fontWeight: '600' },

  pickCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 4,
  },
  pickHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickName: { color: COLORS.text, fontSize: 15, fontWeight: '700', flex: 1 },
  customTag: {
    color: COLORS.green, fontSize: 10, fontWeight: '700',
    borderWidth: 1, borderColor: COLORS.green,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10,
    marginLeft: 8,
  },
  pickMeta: { color: COLORS.textSecondary, fontSize: 12 },
  macroRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  macroPill: {
    color: COLORS.textSecondary,
    fontSize: 11,
    backgroundColor: COLORS.elevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },

  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 13 },

  showMoreBtn: {
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  showMoreText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  describeBox: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginTop: 6,
    gap: 8,
  },
  describeLabel: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  describeInput: {
    backgroundColor: COLORS.elevated,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  describeBtn: {
    backgroundColor: COLORS.green + '22',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.green,
  },
  describeBtnText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  skipRow: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  skipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },

  // Preview
  dayBlock: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 10,
  },
  dayHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dayName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  dayCals: { color: COLORS.green, fontSize: 12, fontWeight: '700' },
  daySkip: { color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic' },
  previewMeal: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  previewMealName: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  previewMealMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  swapChevron: { color: COLORS.textSecondary, fontSize: 20, paddingLeft: 8 },

  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  primaryBtn: {
    flex: 1.4,
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  disabledBtn: { opacity: 0.4 },

  // Guard
  guardWrap: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  guardEmoji: { fontSize: 48, marginBottom: 12 },
  guardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  guardBody: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 16, lineHeight: 19 },
  guardCta: { backgroundColor: COLORS.green, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  guardCtaText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },

  // Swap modal
  swapBackdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
  swapCard: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
  },
  swapTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  swapItem: {
    backgroundColor: COLORS.elevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  swapItemName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  swapItemMeta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  swapCancel: {
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    marginTop: 4,
  },
  swapCancelText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
});
