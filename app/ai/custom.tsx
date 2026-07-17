import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import type {
  Ingredient,
  Macros,
  RecipeCategory,
  RecipeDifficulty,
  SavedRecipe,
} from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

// ─── Types ───────────────────────────────────────────────────────────────────

type Stage = 'mealType' | 'describe' | 'creating' | 'overview' | 'building';

interface Concept {
  name: string;
  category: RecipeCategory;
  calories: number;
  cookTimeMin: number;
  difficulty?: RecipeDifficulty;
  macros: Macros;
  ingredients: Ingredient[];
  steps?: string[];
}

const MEAL_TYPES: { label: string; value: RecipeCategory; hint: string }[] = [
  { label: 'Breakfast', value: 'Breakfast', hint: 'Start the day right' },
  { label: 'Snack',     value: 'Snacks',    hint: 'A quick bite between meals' },
  { label: 'Lunch',     value: 'Lunch',     hint: 'Midday fuel' },
  { label: 'Dinner',    value: 'Dinner',    hint: 'Round out the day' },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function CustomRecipeScreen() {
  const params = useLocalSearchParams<{ swap?: string; seed?: string; recipeId?: string }>();
  const swapFlow = params.swap === 'true';
  const seed = (params.seed ?? '').toString();
  const seedRecipeId = (params.recipeId ?? '').toString();

  const recipes = useMealStore(s => s.recipes);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const pendingSwap = useMealStore(s => s.pendingSwap);
  const customizeDraft = useMealStore(s => s.customizeDraft);
  const swapMealInDay = useMealStore(s => s.swapMealInDay);
  const setCustomizeDraft = useMealStore(s => s.setCustomizeDraft);
  const clearPendingSwap = useMealStore(s => s.clearPendingSwap);
  const ensureRecipeSaved = useMealStore(s => s.ensureRecipeSaved);
  const showToast = useToastStore(s => s.showToast);

  const insets = useSafeAreaInsets();

  // When launched with a recipeId (e.g. from What Can I Make), jump straight to
  // the Stage 1 concept for that recipe.
  const seededConcept = useMemo<Concept | null>(() => {
    if (!seedRecipeId) return null;
    const src =
      recipes.find(r => r.id === seedRecipeId) ??
      savedRecipes.find(r => r.id === seedRecipeId || r.recipeId === seedRecipeId);
    return src ? conceptFromRecipe(src) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [stage, setStage] = useState<Stage>(seededConcept ? 'overview' : 'mealType');
  const [mealType, setMealType] = useState<RecipeCategory | null>(seededConcept?.category ?? null);
  const [describeText, setDescribeText] = useState(seed);
  const [concept, setConcept] = useState<Concept | null>(seededConcept);
  const [refining, setRefining] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoSubmenu, setPhotoSubmenu] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportText, setReportText] = useState('');

  // ── Navigation / back ─────────────────────────────────────────────────────
  const exit = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/recipes');
  };

  const handleBack = () => {
    if (stage === 'describe') { setStage('mealType'); return; }
    if (stage === 'overview') {
      Alert.alert('Discard this recipe?', 'Your generated concept will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            setConcept(null);
            // Seeded concepts (from What Can I Make) have no earlier step to
            // return to, so leave the flow entirely.
            if (seededConcept) exit();
            else setStage('describe');
          },
        },
      ]);
      return;
    }
    exit();
  };

  // ── Concept generation (shell) ────────────────────────────────────────────
  const submitDescribe = () => {
    const text = describeText.trim();
    if (!text || !mealType) return;
    setStage('creating');
    setTimeout(() => {
      setConcept(buildConcept(recipes, text, mealType));
      setStage('overview');
    }, 900);
  };

  const submitFix = (text: string) => {
    if (!text.trim() || !concept) return;
    setFixOpen(false);
    setRefining(true);
    setTimeout(() => {
      setConcept(prev => (prev ? refineConcept(prev, text) : prev));
      setRefining(false);
    }, 800);
  };

  const handleGenerate = () => {
    if (!concept) return;
    setStage('building');
    setTimeout(() => {
      const saved = ensureRecipeSaved({
        recipeId: undefined,
        name: concept.name,
        category: concept.category,
        calories: concept.calories,
        cookTimeMin: concept.cookTimeMin,
        macros: concept.macros,
        ingredients: concept.ingredients,
        steps: concept.steps,
        difficulty: concept.difficulty,
        source: 'ai',
        favourited: false,
      });
      if (swapFlow && pendingSwap) {
        performSwapAndExit(saved);
        return;
      }
      router.replace({ pathname: '/recipe/[id]', params: { id: saved.id } });
    }, 1000);
  };

  const performSwapAndExit = (saved: SavedRecipe) => {
    if (!pendingSwap) { exit(); return; }
    if (pendingSwap.type === 'daily') {
      swapMealInDay(
        pendingSwap.date,
        { slotId: pendingSwap.slotId, slotName: pendingSwap.slotName, time: pendingSwap.time },
        {
          recipeId: saved.recipeId,
          name: saved.name,
          calories: saved.calories,
          cookTimeMin: saved.cookTimeMin,
          macros: saved.macros,
          ingredients: saved.ingredients,
          steps: saved.steps,
          category: saved.category,
          source: 'ai',
        },
      );
    } else if (customizeDraft) {
      const planRecipeId = saved.recipeId ?? saved.id;
      const nextDays = customizeDraft.draftPlan.days.map((day, di) => {
        if (di !== pendingSwap.dayIdx) return day;
        let found = false;
        const updated = day.map(m => {
          if (m.slotName === pendingSwap.slotName && m.time === pendingSwap.time) {
            found = true;
            return { ...m, recipeId: planRecipeId, recipeName: saved.name };
          }
          return m;
        });
        if (!found) {
          updated.push({ slotName: pendingSwap.slotName, time: pendingSwap.time, recipeId: planRecipeId, recipeName: saved.name });
        }
        return updated.sort((a, b) => a.time.localeCompare(b.time));
      });
      setCustomizeDraft({ planId: customizeDraft.planId, draftPlan: { ...customizeDraft.draftPlan, days: nextDays } });
    }
    clearPendingSwap();
    exit();
  };

  // ── Photo / report / delete (concept menu) ────────────────────────────────
  const takePhoto = async () => {
    setMenuOpen(false);
    setPhotoSubmenu(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera permission to take a photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!res.canceled && res.assets?.[0]) setPhotoUri(res.assets[0].uri);
  };

  const uploadPhoto = async () => {
    setMenuOpen(false);
    setPhotoSubmenu(false);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (!res.canceled && res.assets?.[0]) setPhotoUri(res.assets[0].uri);
  };

  const removePhoto = () => {
    setMenuOpen(false);
    setPhotoSubmenu(false);
    setPhotoUri(undefined);
  };

  const openPhotoActionSheet = () => {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Upload Photo', onPress: uploadPhoto },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleDeleteConcept = () => {
    setMenuOpen(false);
    Alert.alert('Delete recipe?', 'This discards the generated recipe.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { setConcept(null); exit(); } },
    ]);
  };

  const submitReport = () => {
    setReportVisible(false);
    setReportText('');
    showToast('Thanks — your report was sent.');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.iconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Custom Recipe</Text>
        {stage === 'overview' ? (
          <TouchableOpacity
            onPress={() => { setMenuOpen(v => !v); setPhotoSubmenu(false); }}
            style={styles.iconBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color={COLORS.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
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

      {stage === 'creating' ? <LoadingScreen message="Creating your recipe…" /> : null}
      {stage === 'building' ? <LoadingScreen message="Building your recipe…" /> : null}

      {stage === 'overview' && concept ? (
        <OverviewScreen
          concept={concept}
          photoUri={photoUri}
          refining={refining}
          onPickPhoto={openPhotoActionSheet}
          onFix={() => setFixOpen(true)}
          onGenerate={handleGenerate}
          bottomInset={insets.bottom}
        />
      ) : null}

      {/* Three-dots menu (concept page) */}
      {menuOpen && stage === 'overview' ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
          <View style={styles.menu}>
            {!photoSubmenu ? (
              <>
                <TouchableOpacity style={styles.menuItem} onPress={() => setPhotoSubmenu(true)}>
                  <Ionicons name="image-outline" size={18} color={COLORS.text} />
                  <Text style={styles.menuText}>{photoUri ? 'Change Photo' : 'Add Photo'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setReportVisible(true); }}>
                  <Ionicons name="flag-outline" size={18} color={COLORS.text} />
                  <Text style={styles.menuText}>Report Food</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={handleDeleteConcept}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.red} />
                  <Text style={[styles.menuText, { color: COLORS.red }]}>Delete Food</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.menuItem} onPress={takePhoto}>
                  <Ionicons name="camera-outline" size={18} color={COLORS.text} />
                  <Text style={styles.menuText}>Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={uploadPhoto}>
                  <Ionicons name="cloud-upload-outline" size={18} color={COLORS.text} />
                  <Text style={styles.menuText}>Upload Photo</Text>
                </TouchableOpacity>
                {photoUri ? (
                  <TouchableOpacity style={styles.menuItem} onPress={removePhoto}>
                    <Ionicons name="close-circle-outline" size={18} color={COLORS.red} />
                    <Text style={[styles.menuText, { color: COLORS.red }]}>Remove Photo</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>
        </>
      ) : null}

      {/* Fix Result page */}
      <FixConceptModal
        visible={fixOpen}
        onClose={() => setFixOpen(false)}
        onSubmit={submitFix}
      />

      {/* Report Food popup */}
      <Modal visible={reportVisible} transparent animationType="fade" onRequestClose={() => setReportVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.nestedBackdrop}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReportVisible(false)} />
          <View style={styles.nestedCard}>
            <Text style={styles.nestedTitle}>Report food</Text>
            <Text style={styles.nestedSub}>Let us know what looks wrong with this recipe&apos;s data.</Text>
            <TextInput
              style={styles.nestedInput}
              value={reportText}
              onChangeText={setReportText}
              placeholder="Describe the issue"
              placeholderTextColor={COLORS.textMuted}
              multiline
              autoFocus
            />
            <View style={styles.nestedBtnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setReportVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={submitReport}>
                <Text style={styles.btnPrimaryText}>Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

// ─── Loading ──────────────────────────────────────────────────────────────────

function LoadingScreen({ message }: { message: string }) {
  return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator size="large" color={COLORS.green} />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

// ─── Stage 1: nutrition concept (meal-detail-popup style) ─────────────────────

function OverviewScreen({
  concept, photoUri, refining, onPickPhoto, onFix, onGenerate, bottomInset,
}: {
  concept: Concept;
  photoUri?: string;
  refining: boolean;
  onPickPhoto: () => void;
  onFix: () => void;
  onGenerate: () => void;
  bottomInset: number;
}) {
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Image */}
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.conceptImage} resizeMode="cover" />
        ) : (
          <TouchableOpacity style={styles.conceptImage} onPress={onPickPhoto} activeOpacity={0.8}>
            <Ionicons name="cloud-upload-outline" size={32} color={COLORS.textSecondary} />
            <Text style={styles.conceptImageText}>Add a photo</Text>
          </TouchableOpacity>
        )}

        {/* Name */}
        <Text style={styles.conceptName}>{concept.name}</Text>

        {/* Calorie tile */}
        <View style={[styles.tile, styles.tileBig]}>
          <Text style={[styles.tileValue, styles.tileValueBig]}>{concept.calories}</Text>
          <Text style={styles.tileLabel}>Calories</Text>
        </View>

        {/* Macro tiles */}
        <View style={[styles.tileRow, { marginTop: TILE_GAP }]}>
          {([
            { label: 'Protein', value: `${concept.macros.protein}g` },
            { label: 'Carbs', value: `${concept.macros.carbs}g` },
            { label: 'Fats', value: `${concept.macros.fats}g` },
          ] as const).map(t => (
            <View key={t.label} style={[styles.tile, styles.tileThird]}>
              <Text style={styles.tileValue}>{t.value}</Text>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </View>
          ))}
        </View>

        {/* Ingredients */}
        <Text style={styles.sectionLabel}>Ingredients</Text>
        <View style={styles.ingList}>
          {concept.ingredients.map((ing, idx) => (
            <View
              key={ing.id}
              style={[styles.ingRow, idx > 0 && styles.ingRowDivider]}
            >
              <Text style={styles.ingName} numberOfLines={1}>{ing.name}</Text>
              <Text style={styles.ingQty}>{formatQty(ing)}</Text>
            </View>
          ))}
        </View>

        {refining ? (
          <View style={styles.refiningRow}>
            <ActivityIndicator color={COLORS.green} />
            <Text style={styles.refiningText}>Updating your recipe…</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footerRow, { paddingBottom: Math.max(bottomInset, 12) }]}>
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onFix} disabled={refining} activeOpacity={0.85}>
          <Text style={styles.btnGhostText}>Fix</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onGenerate} disabled={refining} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Generate</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Fix Result page ──────────────────────────────────────────────────────────

function FixConceptModal({
  visible, onClose, onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const insets = useSafeAreaInsets();

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSubmit(t);
    setText('');
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setText(''); onClose(); }} style={styles.iconBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <View style={styles.fixTitleWrap}>
            <Ionicons name="sparkles" size={18} color={COLORS.green} />
            <Text style={styles.fixTitle}>Fix result</Text>
          </View>
          <View style={styles.iconBtn} />
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
        >
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <TextInput
              style={styles.describeInput}
              value={text}
              onChangeText={setText}
              placeholder="Describe what needs to be fixed"
              placeholderTextColor={COLORS.textMuted}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <View style={styles.exampleCard}>
              <Text style={styles.exampleText}>
                <Text style={styles.exampleBold}>Example: </Text>
                Lower the carbs and swap the rice for quinoa.
              </Text>
            </View>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity
              style={[styles.primaryBtn, !text.trim() && styles.primaryBtnDisabled]}
              disabled={!text.trim()}
              onPress={submit}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Update</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Screen>
    </Modal>
  );
}

// ─── Concept builders (shell — replaced by real AI later) ─────────────────────

function buildConcept(
  recipes: ReturnType<typeof useMealStore.getState>['recipes'],
  description: string,
  category: RecipeCategory,
): Concept {
  const lower = description.toLowerCase();
  const scored = recipes
    .map(r => {
      let score = r.category === category ? 1 : 0;
      const hay = `${r.name} ${r.category} ${r.ingredients.map(i => i.name).join(' ')}`.toLowerCase();
      lower.split(/\s+/).filter(Boolean).forEach(tok => { if (hay.includes(tok)) score++; });
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);

  const base =
    (scored[0]?.score ?? 0) > 0
      ? scored[0].r
      : recipes.find(r => r.category === category) ?? recipes[Math.floor(Math.random() * recipes.length)];

  const ingredients: Ingredient[] = base.ingredients.map((i, idx) => ({
    ...i,
    id: `ci-${Date.now()}-${idx}`,
  }));

  const calTarget = parseCalories(lower);
  const calories = calTarget ?? base.calories;
  const macros = calTarget ? scaleMacros(base.macros, calTarget / base.calories) : { ...base.macros };

  return {
    name: base.name,
    category,
    calories,
    cookTimeMin: base.cookTimeMin,
    difficulty: base.difficulty,
    macros,
    ingredients,
    steps: base.steps ? [...base.steps] : undefined,
  };
}

function conceptFromRecipe(r: {
  name: string;
  category?: RecipeCategory;
  calories: number;
  cookTimeMin?: number;
  difficulty?: RecipeDifficulty;
  macros: Macros;
  ingredients: Ingredient[];
  steps?: string[];
}): Concept {
  return {
    name: r.name,
    category: r.category ?? 'Lunch',
    calories: r.calories,
    cookTimeMin: r.cookTimeMin ?? 20,
    difficulty: r.difficulty,
    macros: { ...r.macros },
    ingredients: r.ingredients.map((i, idx) => ({ ...i, id: `ci-${idx}` })),
    steps: r.steps ? [...r.steps] : undefined,
  };
}

function refineConcept(prev: Concept, fix: string): Concept {
  const lower = fix.toLowerCase();
  let macros = { ...prev.macros };
  let calories = prev.calories;

  const calTarget = parseCalories(lower);
  if (calTarget) {
    const ratio = prev.calories > 0 ? calTarget / prev.calories : 1;
    macros = scaleMacros(prev.macros, ratio);
    calories = calTarget;
  } else {
    const down = /(lower|less|fewer|reduce|cut)/.test(lower);
    const up = /(more|higher|increase|add|boost)/.test(lower);
    if (/carb/.test(lower)) macros.carbs = Math.round(macros.carbs * (down ? 0.8 : up ? 1.2 : 1));
    if (/protein/.test(lower)) macros.protein = Math.round(macros.protein * (up ? 1.2 : down ? 0.8 : 1));
    if (/fat/.test(lower)) macros.fats = Math.round(macros.fats * (down ? 0.8 : up ? 1.2 : 1));
    calories = macros.protein * 4 + macros.carbs * 4 + macros.fats * 9;
  }

  let ingredients = prev.ingredients;
  const swap = lower.match(/(?:swap|replace)\s+([a-z]+)\s+(?:for|with)\s+([a-z]+)/);
  if (swap) {
    const [, from, to] = swap;
    ingredients = prev.ingredients.map(i =>
      i.name.toLowerCase().includes(from) ? { ...i, name: capitalize(to) } : i
    );
  }

  return { ...prev, calories, macros, ingredients };
}

function parseCalories(text: string): number | null {
  const m = text.match(/(\d{2,4})\s*(k?cal|calorie)/);
  if (m) return Number(m[1]);
  const plain = text.match(/\bto\s+(\d{3,4})\b/);
  return plain ? Number(plain[1]) : null;
}

function scaleMacros(m: Macros, ratio: number): Macros {
  return {
    protein: Math.round(m.protein * ratio),
    carbs: Math.round(m.carbs * ratio),
    fats: Math.round(m.fats * ratio),
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatQty(ing: Ingredient): string {
  if (ing.quantity == null) return ing.unit || '';
  const qty = Number.isInteger(ing.quantity) ? `${ing.quantity}` : ing.quantity.toString();
  return `${qty}${ing.unit ? ' ' + ing.unit : ''}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const TILE_GAP = 10;

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

  fixTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  fixTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },

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

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },

  // Concept (meal-detail-popup style)
  conceptImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  conceptImageText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 6 },
  conceptName: { color: COLORS.text, fontSize: 24, fontWeight: '800', marginTop: 14 },

  tile: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  tileBig: { backgroundColor: COLORS.elevated, marginTop: 14, width: '100%' },
  tileThird: { flex: 1 },
  tileRow: { flexDirection: 'row', gap: TILE_GAP },
  tileValue: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  tileValueBig: { fontSize: 30 },
  tileLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },

  sectionLabel: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginTop: 22, marginBottom: 4 },
  ingList: {},
  ingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  ingRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  ingName: { color: COLORS.text, fontSize: 15, flex: 1, marginRight: 10 },
  ingQty: { color: COLORS.textSecondary, fontSize: 14 },

  refiningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 20 },
  refiningText: { color: COLORS.textSecondary, fontSize: 14 },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 12,
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

  btn: { flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  btnGhost: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  btnGhostText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  btnPrimary: { backgroundColor: COLORS.green },
  btnPrimaryText: { color: '#0E1A12', fontSize: 15, fontWeight: '800' },

  // Three-dots menu
  menu: {
    position: 'absolute',
    top: 52,
    right: 12,
    backgroundColor: COLORS.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 6,
    minWidth: 180,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    zIndex: 30,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  menuText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },

  // Report popup
  nestedBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 24 },
  nestedCard: {
    backgroundColor: COLORS.bg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
  },
  nestedTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  nestedSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, marginBottom: 12 },
  nestedInput: {
    backgroundColor: COLORS.card,
    color: COLORS.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  nestedBtnRow: { flexDirection: 'row', gap: 12 },
});
