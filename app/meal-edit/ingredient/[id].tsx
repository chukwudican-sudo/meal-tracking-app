import { useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { getNutrientMeta } from '@/constants/nutrients';
import { useMealStore } from '@/store/useMealStore';
import type { Macros, NutrientKey } from '@/store/types';

const MEASUREMENTS = ['Portion', 'G', 'Cup', 'Serving', 'Tbsp', 'Oz'];
const SCREEN_W = Dimensions.get('window').width;
const DEFAULT_PAGE_W = SCREEN_W - 40;
const TILE_GAP = 10;

export default function IngredientEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ingredientId = String(id ?? '');

  const session = useMealStore(s => s.mealEditSession);
  const trackedNutrients = useMealStore(s => s.profile.trackedNutrients ?? []);
  const updateDraftIngredient = useMealStore(s => s.updateDraftIngredient);
  const removeDraftIngredient = useMealStore(s => s.removeDraftIngredient);

  const ingredient = useMemo(
    () => session?.draft.ingredients.find(i => i.id === ingredientId) ?? null,
    [session, ingredientId],
  );

  const [name, setName] = useState(ingredient?.name ?? '');
  const [unit, setUnit] = useState(ingredient?.unit || 'Serving');
  const [servings, setServings] = useState(ingredient?.servings ?? 1);
  const [calories, setCalories] = useState(String(ingredient?.calories ?? 0));
  const [protein, setProtein] = useState(String(ingredient?.macros?.protein ?? 0));
  const [carbs, setCarbs] = useState(String(ingredient?.macros?.carbs ?? 0));
  const [fats, setFats] = useState(String(ingredient?.macros?.fats ?? 0));
  const [page, setPage] = useState(0);
  const [pagerW, setPagerW] = useState(DEFAULT_PAGE_W);
  const [nutrientVals, setNutrientVals] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {};
    trackedNutrients.forEach(k => { base[k] = String(ingredient?.nutrients?.[k] ?? 0); });
    return base;
  });

  if (!session || !ingredient) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Header title="Edit Ingredient" onDelete={() => router.back()} onDone={() => router.back()} />
      </Screen>
    );
  }

  const toInt = (s: string) => Math.max(0, Math.round(Number(s) || 0));

  function done() {
    const macros: Macros = { protein: toInt(protein), carbs: toInt(carbs), fats: toInt(fats) };
    const nutrients: Partial<Record<NutrientKey, number>> = {};
    trackedNutrients.forEach(k => { nutrients[k] = toInt(nutrientVals[k] ?? '0'); });
    updateDraftIngredient(ingredientId, {
      name: name.trim() || ingredient!.name,
      unit,
      servings,
      calories: toInt(calories),
      macros,
      nutrients,
    });
    router.back();
  }

  function handleDelete() {
    Alert.alert('Delete ingredient?', `Remove "${ingredient!.name}" from this meal?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeDraftIngredient(ingredientId);
          router.back();
        },
      },
    ]);
  }

  const hasSecondary = trackedNutrients.length > 0;
  const tripleW = (pagerW - TILE_GAP * 2) / 3;
  const secondaryW = (pagerW - TILE_GAP) / 2;

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="Edit Ingredient" onDelete={handleDelete} onDone={done} />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="Ingredient name"
          placeholderTextColor={COLORS.textMuted}
        />

        <Text style={styles.label}>Measurement</Text>
        <View style={styles.chipRow}>
          {MEASUREMENTS.map(m => {
            const active = unit.toLowerCase() === m.toLowerCase();
            return (
              <TouchableOpacity
                key={m}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setUnit(m)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Number of servings</Text>
        <View style={styles.stepper}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setServings(s => Math.max(1, s - 1))}>
            <Text style={styles.stepBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.stepValue}>{servings}</Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setServings(s => s + 1)}>
            <Text style={styles.stepBtnText}>＋</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Nutrition</Text>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onLayout={e => setPagerW(e.nativeEvent.layout.width)}
          onMomentumScrollEnd={e => {
            const w = e.nativeEvent.layoutMeasurement.width || pagerW;
            setPage(Math.round(e.nativeEvent.contentOffset.x / w));
          }}
        >
          {/* Page 1: calories big + P/C/F */}
          <View style={{ width: pagerW }}>
            <MacroTile label="Calories" value={calories} onChange={setCalories} big width={pagerW} />
            <View style={[styles.tileRow, { marginTop: TILE_GAP }]}>
              <MacroTile label="Protein (g)" value={protein} onChange={setProtein} width={tripleW} />
              <MacroTile label="Carbs (g)" value={carbs} onChange={setCarbs} width={tripleW} />
              <MacroTile label="Fats (g)" value={fats} onChange={setFats} width={tripleW} />
            </View>
          </View>
          {/* Page 2: secondary nutrients */}
          {hasSecondary ? (
            <View style={{ width: pagerW }}>
              <View style={styles.tileWrap}>
                {trackedNutrients.map(k => {
                  const meta = getNutrientMeta(k);
                  return (
                    <MacroTile
                      key={k}
                      label={`${meta.label} (${meta.unit})`}
                      value={nutrientVals[k] ?? '0'}
                      onChange={v => setNutrientVals(prev => ({ ...prev, [k]: v }))}
                      width={secondaryW}
                    />
                  );
                })}
              </View>
            </View>
          ) : null}
        </ScrollView>

        {hasSecondary ? (
          <View style={styles.dots}>
            {[0, 1].map(i => (
              <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function MacroTile({
  label,
  value,
  onChange,
  big,
  width,
}: { label: string; value: string; onChange: (v: string) => void; big?: boolean; width?: number }) {
  return (
    <View style={[styles.tile, big && styles.tileBig, width != null && { width }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <TextInput
        style={styles.tileInput}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={COLORS.textMuted}
      />
    </View>
  );
}

function Header({ title, onDelete, onDone }: { title: string; onDelete: () => void; onDone: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
        <Ionicons name="chevron-back" size={26} color={COLORS.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.headerRight}>
        <TouchableOpacity onPress={onDelete} hitSlop={10}>
          <Ionicons name="trash-outline" size={22} color={COLORS.red} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDone} hitSlop={10}>
          <Text style={styles.headerDone}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerDone: { color: COLORS.green, fontSize: 15, fontWeight: '700' },

  body: { padding: 20, paddingBottom: 48 },
  nameInput: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '800',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 24, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#0E1A12' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  stepValue: { color: COLORS.text, fontSize: 18, fontWeight: '700', minWidth: 24, textAlign: 'center' },

  tileRow: { flexDirection: 'row', gap: TILE_GAP },
  tileWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },
  tile: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
  },
  tileBig: { backgroundColor: COLORS.elevated },
  tileLabel: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
  tileInput: { color: COLORS.text, fontSize: 22, fontWeight: '800', padding: 0 },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.textMuted },
  dotActive: { backgroundColor: COLORS.green },
});
