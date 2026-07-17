import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
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
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';

import { COLORS } from '@/constants/theme';
import { getNutrientMeta } from '@/constants/nutrients';
import { rateMealGrade } from '@/utils/mealRating';
import { aiClient } from '@/ai/aiClient';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import type { Macros, NutrientKey, NutrientValues } from '@/store/types';

const SCREEN_W = Dimensions.get('window').width;
const DEFAULT_PAGE_W = Math.min(SCREEN_W - 32, 460) - 32; // popup inner width minus padding
const TILE_GAP = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseHHMMToDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 12, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}
function formatDateToHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function formatTimeLabel(hhmm: string): string {
  const d = parseHHMMToDate(hhmm);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}
function scaleMacros(m: Macros, ratio: number): Macros {
  return {
    protein: Math.round(m.protein * ratio),
    carbs: Math.round(m.carbs * ratio),
    fats: Math.round(m.fats * ratio),
  };
}
function scaleNutrients(n: NutrientValues | undefined, ratio: number): NutrientValues {
  const out: NutrientValues = {};
  if (!n) return out;
  (Object.keys(n) as NutrientKey[]).forEach(k => {
    const v = n[k];
    if (v != null) out[k] = Math.round(v * ratio);
  });
  return out;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MealDetailModal() {
  const router = useRouter();
  const isFocused = useIsFocused();

  const session = useMealStore(s => s.mealEditSession);
  const savedRecipes = useMealStore(s => s.savedRecipes);
  const goals = useMealStore(s => s.goals);
  const trackedNutrients = useMealStore(s => s.profile.trackedNutrients ?? []);

  const updateMealDraft = useMealStore(s => s.updateMealDraft);
  const commitMealEditSession = useMealStore(s => s.commitMealEditSession);
  const closeMealEditSession = useMealStore(s => s.closeMealEditSession);
  const removeMealFromDay = useMealStore(s => s.removeMealFromDay);
  const toggleFavouriteRecipe = useMealStore(s => s.toggleFavouriteRecipe);
  const setPendingSwap = useMealStore(s => s.setPendingSwap);
  const showToast = useToastStore(s => s.showToast);

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [fixVisible, setFixVisible] = useState(false);
  const [fixText, setFixText] = useState('');
  const [fixing, setFixing] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportText, setReportText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoSubmenu, setPhotoSubmenu] = useState(false);
  const [page, setPage] = useState(0);
  const [pagerW, setPagerW] = useState(DEFAULT_PAGE_W);

  // Snapshot the meal as it was when the popup opened so we can detect unsaved
  // edits (including those made on the pushed macro/ingredient routes). Keyed by
  // draft id so reopening a different meal re-snapshots.
  const originalRef = useRef<string | null>(null);
  const idRef = useRef<string | null>(null);
  useEffect(() => {
    if (session && idRef.current !== session.draft.id) {
      idRef.current = session.draft.id;
      originalRef.current = JSON.stringify(session.draft);
    } else if (!session) {
      idRef.current = null;
      originalRef.current = null;
    }
  }, [session]);

  // Visible only when a session exists and the host screen is focused. Pushing
  // an edit route unfocuses the host, hiding the popup without losing the draft.
  const visible = session != null && isFocused;

  if (!session) return null;
  const draft = session.draft;
  const servings = draft.servings ?? 1;
  const draftJson = JSON.stringify(draft);
  const dirty = originalRef.current != null && originalRef.current !== draftJson;

  const favourited = savedRecipes.some(
    r => r.favourited && r.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
  );
  const grade = rateMealGrade({ calories: draft.calories, macros: draft.macros }, goals);

  function resetTransient() {
    setShowTimePicker(false);
    setEditingName(false);
    setFixVisible(false);
    setReportVisible(false);
    setMenuOpen(false);
    setPhotoSubmenu(false);
    setPage(0);
  }

  function commitAndClose() {
    resetTransient();
    commitMealEditSession();
  }

  function discardAndClose() {
    resetTransient();
    closeMealEditSession();
  }

  // Back arrow / backdrop: guard against losing unsaved edits.
  function handleDismiss() {
    if (dirty) {
      Alert.alert('Discard changes?', 'Your edits to this meal will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: discardAndClose },
      ]);
    } else {
      discardAndClose();
    }
  }

  function changeServings(next: number) {
    if (next < 1) return;
    const ratio = next / servings;
    updateMealDraft({
      servings: next,
      calories: Math.round(draft.calories * ratio),
      macros: scaleMacros(draft.macros, ratio),
      nutrients: scaleNutrients(draft.nutrients, ratio),
      ingredients: draft.ingredients.map(i => ({
        ...i,
        calories: i.calories != null ? Math.round(i.calories * ratio) : i.calories,
        macros: i.macros ? scaleMacros(i.macros, ratio) : i.macros,
      })),
    });
  }

  function toggleBookmark() {
    const updated = toggleFavouriteRecipe({
      name: draft.name,
      category: draft.category,
      calories: draft.calories,
      macros: draft.macros,
      ingredients: draft.ingredients,
      source: 'manual',
    });
    showToast(updated.favourited ? 'Added to Saved Recipes' : 'Removed from Saved Recipes');
  }

  // ─── Photo handlers ───────────────────────────────────────────────────────

  async function takePhoto() {
    setMenuOpen(false);
    setPhotoSubmenu(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera permission to take a photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!res.canceled && res.assets?.[0]) updateMealDraft({ photoUri: res.assets[0].uri });
  }

  async function uploadPhoto() {
    setMenuOpen(false);
    setPhotoSubmenu(false);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (!res.canceled && res.assets?.[0]) updateMealDraft({ photoUri: res.assets[0].uri });
  }

  function removePhoto() {
    setMenuOpen(false);
    setPhotoSubmenu(false);
    updateMealDraft({ photoUri: undefined });
  }

  function openPhotoActionSheet() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Upload Photo', onPress: uploadPhoto },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ─── Delete / report ──────────────────────────────────────────────────────

  function handleDelete() {
    setMenuOpen(false);
    if (session!.context === 'plan') {
      Alert.alert('Remove from this day?', 'This empties the slot for this day only.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Swap instead',
          onPress: () => {
            const cat = draft.category;
            setPendingSwap({
              type: 'daily',
              date: session!.date,
              slotId: draft.slotId,
              slotName: cat ?? 'Meal',
              time: draft.time,
              category: cat,
            });
            discardAndClose();
            router.push({
              pathname: '/recipes/saved',
              params: { swapMode: 'true', ...(cat ? { swapFilter: cat } : {}) },
            });
          },
        },
        {
          text: 'Empty slot',
          style: 'destructive',
          onPress: () => {
            removeMealFromDay(session!.date, draft.id);
            discardAndClose();
          },
        },
      ]);
    } else {
      Alert.alert('Delete food?', 'This removes the meal from your day.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            removeMealFromDay(session!.date, draft.id);
            discardAndClose();
          },
        },
      ]);
    }
  }

  function submitReport() {
    setReportVisible(false);
    setReportText('');
    showToast('Thanks — your report was sent.');
  }

  function openMacroEdit(key: string) {
    router.push({ pathname: '/meal-edit/macro/[key]', params: { key } });
  }
  function openIngredientEdit(id: string) {
    router.push({ pathname: '/meal-edit/ingredient/[id]', params: { id } });
  }

  async function submitFix() {
    const text = fixText.trim();
    if (!text || fixing) return;
    setFixing(true);
    try {
      const next = await aiClient.fixMeal(
        {
          fixText: text,
          currentDraft: { name: draft.name, time: draft.time, calories: draft.calories, macros: draft.macros },
          history: [],
        },
        {
          date: session!.date,
          goals,
          profile: useMealStore.getState().profile,
          todaysMeals: [],
          libraryNames: [],
        },
      );
      updateMealDraft({ name: next.name, calories: next.calories, macros: next.macros });
      setFixText('');
      setFixVisible(false);
    } catch (e) {
      console.warn('Fix failed:', e);
      Alert.alert('Could not re-evaluate', 'Try again.');
    } finally {
      setFixing(false);
    }
  }

  // ─── Tile sizing (measured page width prevents page overlap) ───────────────
  const tripleW = (pagerW - TILE_GAP * 2) / 3;
  const secondaryW = (pagerW - TILE_GAP) / 2;
  const hasSecondary = trackedNutrients.length > 0;
  const pageCount = hasSecondary ? 2 : 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
      <Pressable style={styles.backdrop} onPress={handleDismiss}>
        <Pressable style={styles.card} onPress={() => menuOpen && setMenuOpen(false)}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleDismiss} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Nutrition</Text>
            <TouchableOpacity onPress={() => { setMenuOpen(v => !v); setPhotoSubmenu(false); }} hitSlop={10}>
              <Ionicons name="ellipsis-horizontal" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
          >
            {/* Image tile */}
            {draft.photoUri ? (
              <Image source={{ uri: draft.photoUri }} style={styles.image} resizeMode="cover" />
            ) : (
              <TouchableOpacity style={styles.imagePlaceholder} onPress={openPhotoActionSheet} activeOpacity={0.8}>
                <Ionicons name="cloud-upload-outline" size={32} color={COLORS.textSecondary} />
                <Text style={styles.imagePlaceholderText}>Add a photo</Text>
              </TouchableOpacity>
            )}

            {/* Bookmark + time + name + servings */}
            <View style={styles.infoRow}>
              <TouchableOpacity onPress={toggleBookmark} hitSlop={8} style={styles.bookmarkBtn}>
                <Ionicons
                  name={favourited ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={favourited ? COLORS.green : COLORS.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity style={styles.timePill} onPress={() => setShowTimePicker(v => !v)}>
                <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
                <Text style={styles.timePillText}>{formatTimeLabel(draft.time)}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => changeServings(servings - 1)}>
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepValue}>{servings}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => changeServings(servings + 1)}>
                  <Text style={styles.stepBtnText}>＋</Text>
                </TouchableOpacity>
              </View>
            </View>

            {showTimePicker ? (
              <View style={styles.pickerWrap}>
                <DateTimePicker
                  value={parseHHMMToDate(draft.time)}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, d) => {
                    if (Platform.OS === 'android') setShowTimePicker(false);
                    if (d) updateMealDraft({ time: formatDateToHHMM(d) });
                  }}
                  themeVariant="dark"
                />
              </View>
            ) : null}

            {/* Name */}
            {editingName ? (
              <TextInput
                style={styles.nameInput}
                value={nameDraft}
                onChangeText={setNameDraft}
                autoFocus
                onBlur={() => {
                  updateMealDraft({ name: nameDraft.trim() || draft.name });
                  setEditingName(false);
                }}
                returnKeyType="done"
                onSubmitEditing={() => {
                  updateMealDraft({ name: nameDraft.trim() || draft.name });
                  setEditingName(false);
                }}
              />
            ) : (
              <TouchableOpacity onPress={() => { setNameDraft(draft.name); setEditingName(true); }}>
                <Text style={styles.name}>{draft.name}</Text>
              </TouchableOpacity>
            )}

            {/* Health grade + Added tag */}
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { borderColor: grade.color }]}>
                <View style={[styles.badgeDot, { backgroundColor: grade.color }]} />
                <Text style={styles.badgeText}>{grade.label}</Text>
              </View>
              {session.context === 'home' && draft.isAdHoc ? (
                <View style={styles.addedTag}><Text style={styles.addedTagText}>Added</Text></View>
              ) : null}
            </View>

            {/* Macro pager */}
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onLayout={e => setPagerW(e.nativeEvent.layout.width)}
              onMomentumScrollEnd={e => {
                const w = e.nativeEvent.layoutMeasurement.width || pagerW;
                setPage(Math.round(e.nativeEvent.contentOffset.x / w));
              }}
              style={{ marginTop: 16 }}
            >
              {/* Page 1: calories big + P/C/F */}
              <View style={{ width: pagerW }}>
                <TouchableOpacity
                  style={[styles.tile, styles.tileBig, { width: pagerW }]}
                  onPress={() => openMacroEdit('calories')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tileValue, styles.tileValueBig]}>{draft.calories}</Text>
                  <Text style={styles.tileLabel}>Calories</Text>
                </TouchableOpacity>
                <View style={[styles.tileRow, { marginTop: TILE_GAP }]}>
                  {([
                    { key: 'protein', label: 'Protein', value: `${draft.macros.protein}g` },
                    { key: 'carbs', label: 'Carbs', value: `${draft.macros.carbs}g` },
                    { key: 'fats', label: 'Fats', value: `${draft.macros.fats}g` },
                  ] as const).map(t => (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.tile, { width: tripleW }]}
                      onPress={() => openMacroEdit(t.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.tileValue}>{t.value}</Text>
                      <Text style={styles.tileLabel}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Page 2: secondary nutrients */}
              {hasSecondary ? (
                <View style={{ width: pagerW }}>
                  <View style={styles.tileWrap}>
                    {trackedNutrients.map(key => {
                      const meta = getNutrientMeta(key);
                      const val = draft.nutrients?.[key] ?? 0;
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[styles.tile, { width: secondaryW }]}
                          onPress={() => openMacroEdit(key)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.tileValue}>{val}{meta.unit}</Text>
                          <Text style={styles.tileLabel}>{meta.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </ScrollView>

            {/* Page dots */}
            {pageCount > 1 ? (
              <View style={styles.dots}>
                {Array.from({ length: pageCount }).map((_, i) => (
                  <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
                ))}
              </View>
            ) : null}

            {/* Ingredients */}
            {draft.ingredients.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Ingredients</Text>
                <View style={styles.ingList}>
                  {draft.ingredients.map((ing, idx) => (
                    <TouchableOpacity
                      key={ing.id}
                      style={[styles.ingRow, idx > 0 && styles.ingRowDivider]}
                      onPress={() => openIngredientEdit(ing.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.ingName} numberOfLines={1}>{ing.name}</Text>
                      <Text style={styles.ingQty}>
                        {ing.quantity ? `${ing.quantity} ${ing.unit}`.trim() : ing.unit || '1 serving'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>

          {/* Bottom buttons */}
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setFixVisible(true)}>
              <Text style={styles.btnGhostText}>Fix</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={commitAndClose}>
              <Text style={styles.btnPrimaryText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Three-dots menu */}
          {menuOpen ? (
            <View style={styles.menu}>
              {!photoSubmenu ? (
                <>
                  <TouchableOpacity style={styles.menuItem} onPress={() => setPhotoSubmenu(true)}>
                    <Ionicons name="image-outline" size={18} color={COLORS.text} />
                    <Text style={styles.menuText}>{draft.photoUri ? 'Change Photo' : 'Add Photo'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setReportVisible(true); }}>
                    <Ionicons name="flag-outline" size={18} color={COLORS.text} />
                    <Text style={styles.menuText}>Report Food</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
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
                  {draft.photoUri ? (
                    <TouchableOpacity style={styles.menuItem} onPress={removePhoto}>
                      <Ionicons name="close-circle-outline" size={18} color={COLORS.red} />
                      <Text style={[styles.menuText, { color: COLORS.red }]}>Remove Photo</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </Pressable>
      </Pressable>

      {/* Fix Issue popup (keyboard-safe) */}
      <Modal visible={fixVisible} transparent animationType="fade" onRequestClose={() => setFixVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.nestedBackdrop}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFixVisible(false)} />
          <View style={styles.nestedCard}>
            <Text style={styles.nestedTitle}>Fix this meal</Text>
            <Text style={styles.nestedSub}>Tell the assistant what was off and it will re-estimate.</Text>
            <TextInput
              style={styles.nestedInput}
              value={fixText}
              onChangeText={setFixText}
              placeholder="e.g. it was a large portion"
              placeholderTextColor={COLORS.textMuted}
              multiline
              autoFocus
            />
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setFixVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={submitFix} disabled={fixing}>
                {fixing ? <ActivityIndicator color="#0E1A12" /> : <Text style={styles.btnPrimaryText}>Re-evaluate</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Report Food popup (keyboard-safe shell) */}
      <Modal visible={reportVisible} transparent animationType="fade" onRequestClose={() => setReportVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.nestedBackdrop}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReportVisible(false)} />
          <View style={styles.nestedCard}>
            <Text style={styles.nestedTitle}>Report food</Text>
            <Text style={styles.nestedSub}>Let us know what looks wrong with this food&apos;s data.</Text>
            <TextInput
              style={styles.nestedInput}
              value={reportText}
              onChangeText={setReportText}
              placeholder="Describe the issue"
              placeholderTextColor={COLORS.textMuted}
              multiline
              autoFocus
            />
            <View style={styles.btnRow}>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '88%',
    backgroundColor: COLORS.bg,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },

  scrollBody: { paddingBottom: 8 },

  image: { width: '100%', aspectRatio: 1, borderRadius: 16, marginTop: 12, backgroundColor: COLORS.card },
  imagePlaceholder: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    marginTop: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imagePlaceholderText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  bookmarkBtn: { paddingRight: 2 },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timePillText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  pickerWrap: { marginTop: 8, backgroundColor: COLORS.card, borderRadius: 12, overflow: 'hidden' },

  name: { color: COLORS.text, fontSize: 24, fontWeight: '800', marginTop: 12 },
  nameInput: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.green,
    paddingVertical: 2,
  },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  addedTag: { backgroundColor: COLORS.elevated, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  addedTagText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  stepValue: { color: COLORS.text, fontSize: 16, fontWeight: '700', minWidth: 20, textAlign: 'center' },

  tile: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  tileBig: { backgroundColor: COLORS.elevated },
  tileRow: { flexDirection: 'row', gap: TILE_GAP },
  tileWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },
  tileValue: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  tileValueBig: { fontSize: 30 },
  tileLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.textMuted },
  dotActive: { backgroundColor: COLORS.green },

  sectionLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 4 },
  ingList: {},
  ingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
  },
  ingRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  ingName: { color: COLORS.text, fontSize: 15, flex: 1 },
  ingQty: { color: COLORS.textSecondary, fontSize: 14 },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  btnGhost: { backgroundColor: COLORS.card },
  btnGhostText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  btnPrimary: { backgroundColor: COLORS.green },
  btnPrimaryText: { color: '#0E1A12', fontSize: 15, fontWeight: '800' },

  menu: {
    position: 'absolute',
    top: 50,
    right: 16,
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
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  menuText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },

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
  },
});
