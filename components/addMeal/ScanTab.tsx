import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  CameraView,
  useCameraPermissions,
  type CameraType,
  type FlashMode,
} from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@/constants/theme';
import { aiClient, isStubAI } from '@/ai/aiClient';
import type { DayContext, MealDraft } from '@/ai/types';
import type { UserGoals } from '@/store/types';
import { rateMeal } from '@/utils/mealRating';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

type Mode = 'scan' | 'upload' | 'barcode';
type ScanState = 'camera' | 'result' | 'fix';

interface DraftMeta {
  photoUri?: string;
  barcode?: string;
  /** When true, parent (AddMealScreen) logs the meal directly and closes. */
  logImmediately?: boolean;
}

interface Props {
  context: DayContext;
  onDraftReady: (draft: MealDraft, source: DraftMeta) => void;
}

export function ScanTab({ context, onDraftReady }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('scan');
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [busy, setBusy] = useState(false);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  // Half-sheet state — populated after a successful scan/upload/barcode hit.
  const [scanState, setScanState] = useState<ScanState>('camera');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  // Servings counter — multiplies/divides macros relative to base draft.
  const [servings, setServings] = useState(1);
  const [fixText, setFixText] = useState('');
  const [bookmarked, setBookmarked] = useState(false);

  const ensureRecipeSaved = useMealStore(s => s.ensureRecipeSaved);
  const removeSavedRecipe = useMealStore(s => s.removeSavedRecipe);
  const showToast = useToastStore(s => s.showToast);

  // Reset the locked-out barcode each time we re-enter Barcode mode.
  useEffect(() => {
    if (mode !== 'barcode') setScannedCode(null);
  }, [mode]);

  // Reset all half-sheet state when leaving the result/fix view back to camera.
  function resetToCamera() {
    setScanState('camera');
    setCapturedUri(null);
    setDraft(null);
    setServings(1);
    setFixText('');
    setBookmarked(false);
  }

  // Servings-scaled draft used for display + Log payload.
  const scaledDraft = useMemo<MealDraft | null>(() => {
    if (!draft) return null;
    return {
      name:     draft.name,
      time:     draft.time,
      calories: Math.round(draft.calories * servings),
      macros: {
        protein: Math.round(draft.macros.protein * servings),
        carbs:   Math.round(draft.macros.carbs   * servings),
        fats:    Math.round(draft.macros.fats    * servings),
      },
    };
  }, [draft, servings]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>Camera capture is only available on the mobile app.</Text>
      </View>
    );
  }

  if (!permission) return <View style={styles.full} />;

  if (!permission.granted) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>Camera permission needed to scan or photograph meals.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Capture handlers ─────────────────────────────────────────────────

  async function handleCapture() {
    if (busy) return;
    if (mode === 'upload') return handleUpload();
    if (mode === 'barcode') return; // barcode triggers via onBarcodeScanned

    if (!cameraRef.current) return;
    setBusy(true);
    try {
      const shot = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.5,
      });
      if (!shot?.uri) throw new Error('Could not take photo');
      const dataUri = shot.base64 ? `data:image/jpeg;base64,${shot.base64}` : shot.uri;
      const result = await aiClient.parseMeal({ imageUri: dataUri }, context);
      setCapturedUri(shot.uri);
      setDraft(result);
      setServings(1);
      setBookmarked(false);
      setScanState('result');
    } catch (e) {
      console.warn('Scan failed:', e);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.5,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const dataUri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
      const parsed = await aiClient.parseMeal({ imageUri: dataUri }, context);
      setCapturedUri(asset.uri);
      setDraft(parsed);
      setServings(1);
      setBookmarked(false);
      setScanState('result');
    } catch (e) {
      console.warn('Upload failed:', e);
    } finally {
      setBusy(false);
    }
  }

  async function handleBarcode(code: string) {
    if (busy || scannedCode === code) return;
    setScannedCode(code);
    setBusy(true);
    try {
      const parsed = await lookupBarcode(code);
      setCapturedUri(null);
      setDraft(parsed);
      setServings(1);
      setBookmarked(false);
      setScanState('result');
    } catch (e) {
      console.warn('Barcode lookup failed:', e);
      setScannedCode(null);
    } finally {
      setBusy(false);
    }
  }

  // ─── Half-sheet actions ────────────────────────────────────────────────

  function handleLog() {
    if (!scaledDraft) return;
    onDraftReady(scaledDraft, { photoUri: capturedUri ?? undefined, logImmediately: true });
    resetToCamera();
  }

  function handleRetake() {
    resetToCamera();
  }

  function handleBookmarkToggle() {
    if (!scaledDraft) return;
    if (bookmarked) {
      // Best-effort: remove a recipe with the same name we just saved.
      const list = useMealStore.getState().savedRecipes;
      const match = list.find(r => r.name === scaledDraft.name && r.source === 'ai');
      if (match) removeSavedRecipe(match.id);
      setBookmarked(false);
      showToast('Removed from Saved Recipes');
      return;
    }
    const saved = ensureRecipeSaved({
      name: scaledDraft.name,
      calories: scaledDraft.calories,
      macros: scaledDraft.macros,
      ingredients: [],
      source: 'ai',
      favourited: true,
    });
    void saved;
    setBookmarked(true);
    showToast('Added to Saved Recipes');
  }

  async function handleReevaluate() {
    if (!draft || !fixText.trim()) return;
    setBusy(true);
    try {
      const next = await aiClient.fixMeal(
        {
          fixText: fixText.trim(),
          imageUri: capturedUri ?? undefined,
          currentDraft: draft,
          history: [],
        },
        context,
      );
      setDraft(next);
      // Keep the user's serving multiplier — only the base values changed.
      setFixText('');
      setScanState('result');
    } catch (e) {
      console.warn('Re-evaluate failed:', e);
    } finally {
      setBusy(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const showCamera = scanState === 'camera';

  return (
    <View style={styles.full}>
      {/* Camera is mounted only in the camera state to avoid stale frames
          peeking through the half-sheet darkness on slower devices. */}
      {showCamera ? (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          flash={flash}
          barcodeScannerSettings={
            mode === 'barcode'
              ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }
              : undefined
          }
          onBarcodeScanned={mode === 'barcode' ? ({ data }) => handleBarcode(data) : undefined}
        >
          <View pointerEvents="none" style={styles.brackets}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>

          {isStubAI && (
            <View style={styles.stubBadge}>
              <Text style={styles.stubBadgeText}>Stub mode (no API key)</Text>
            </View>
          )}

          {busy && (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color={COLORS.green} />
              <Text style={styles.busyText}>
                {mode === 'barcode' ? 'Looking up product…' : 'Identifying…'}
              </Text>
            </View>
          )}

          <View style={styles.modeRow}>
            {(['scan', 'upload', 'barcode'] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.modePill, mode === m && styles.modePillActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.modePillText, mode === m && styles.modePillTextActive]}>
                  {m === 'scan' ? 'Scan' : m === 'upload' ? 'Upload' : 'Barcode'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.sideBtn}
              onPress={() => setFlash(f => (f === 'off' ? 'on' : 'off'))}
            >
              <Text style={styles.sideBtnText}>{flash === 'on' ? '⚡' : '⚡︎'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.shutter, mode === 'barcode' && styles.shutterDisabled]}
              onPress={handleCapture}
              disabled={mode === 'barcode' || busy}
            >
              <View style={styles.shutterInner} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sideBtn}
              onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
            >
              <Text style={styles.sideBtnText}>↻</Text>
            </TouchableOpacity>
          </View>
        </CameraView>
      ) : (
        // Result / Fix views — captured photo as backdrop, half-sheet overlay.
        <View style={StyleSheet.absoluteFill}>
          {capturedUri ? (
            <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.barcodeBackdrop]}>
              <Text style={styles.barcodeBackdropEmoji}>📦</Text>
            </View>
          )}
          <View style={styles.backdropDim} />

          {scanState === 'result' && scaledDraft && (
            <ResultSheet
              draft={scaledDraft}
              servings={servings}
              onServingsChange={setServings}
              bookmarked={bookmarked}
              onBookmarkToggle={handleBookmarkToggle}
              onFix={() => setScanState('fix')}
              onRetake={handleRetake}
              onLog={handleLog}
              goals={context.goals}
            />
          )}

        </View>
      )}

      {/* Fix Result overlay lives in its own Modal so KeyboardAvoidingView
          operates at the OS root and reliably lifts the card above the
          keyboard. Embedding inside the result-stack View was unreliable
          because of the dimmed background's absolute positioning. */}
      <Modal
        transparent
        visible={scanState === 'fix'}
        animationType="slide"
        onRequestClose={() => setScanState('result')}
      >
        <FixOverlay
          fixText={fixText}
          setFixText={setFixText}
          busy={busy}
          onClose={() => setScanState('result')}
          onReevaluate={handleReevaluate}
        />
      </Modal>
    </View>
  );
}

// ─── Result half-sheet ──────────────────────────────────────────────────────

interface ResultSheetProps {
  draft: MealDraft;
  servings: number;
  onServingsChange: (n: number) => void;
  bookmarked: boolean;
  onBookmarkToggle: () => void;
  onFix: () => void;
  onRetake: () => void;
  onLog: () => void;
  goals: UserGoals;
}

function ResultSheet({
  draft,
  servings,
  onServingsChange,
  bookmarked,
  onBookmarkToggle,
  onFix,
  onRetake,
  onLog,
  goals,
}: ResultSheetProps) {
  // Friendly ingredient summary — ScanTab doesn't currently parse ingredients
  // out of the image, so for now we just leave the line empty.
  const summaryLine = '';
  const rating = rateForGoals(draft, goals);

  return (
    <View style={styles.sheet}>
      <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
        {/* Top row: name + bookmark */}
        <View style={styles.sheetTopRow}>
          <Text style={styles.sheetName} numberOfLines={2}>{draft.name}</Text>
          <TouchableOpacity onPress={onBookmarkToggle} hitSlop={10} style={styles.bookmarkBtn}>
            <Ionicons
              name={bookmarked ? 'bookmark' : 'bookmark-outline'}
              size={24}
              color={bookmarked ? COLORS.green : COLORS.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {summaryLine ? <Text style={styles.sheetSummary}>{summaryLine}</Text> : null}

        {/* Calorie row + servings counter */}
        <View style={styles.calorieRow}>
          <View>
            <Text style={styles.calorieValue}>{draft.calories}</Text>
            <Text style={styles.calorieLabel}>calories</Text>
          </View>
          <View style={styles.servingControl}>
            <TouchableOpacity
              style={styles.servingBtn}
              onPress={() => onServingsChange(Math.max(1, servings - 1))}
              hitSlop={6}
            >
              <Text style={styles.servingBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.servingValueWrap}>
              <Text style={styles.servingValue}>{servings}</Text>
              <Text style={styles.servingLabel}>{servings === 1 ? 'serving' : 'servings'}</Text>
            </View>
            <TouchableOpacity
              style={styles.servingBtn}
              onPress={() => onServingsChange(servings + 1)}
              hitSlop={6}
            >
              <Text style={styles.servingBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Macros */}
        <View style={styles.macroRow}>
          <MacroPill label="Protein" value={draft.macros.protein} unit="g" />
          <MacroPill label="Carbs"   value={draft.macros.carbs}   unit="g" />
          <MacroPill label="Fats"    value={draft.macros.fats}    unit="g" />
        </View>

        {/* Health rating badge */}
        <View style={[styles.ratingBadge, { borderColor: rating.color }]}>
          <View style={[styles.ratingDot, { backgroundColor: rating.color }]} />
          <Text style={styles.ratingLabel} numberOfLines={2}>{rating.label}</Text>
        </View>
      </ScrollView>

      {/* Action row pinned to bottom */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.fixBtn} onPress={onFix}>
          <Text style={styles.fixBtnText}>Fix Results</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.retakeBtn} onPress={onRetake}>
          <Text style={styles.retakeBtnText}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.logBtn} onPress={onLog}>
          <Text style={styles.logBtnText}>Log</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MacroPill({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View style={styles.macroPill}>
      <Text style={styles.macroPillValue}>{value}{unit}</Text>
      <Text style={styles.macroPillLabel}>{label}</Text>
    </View>
  );
}

// ─── Fix overlay ────────────────────────────────────────────────────────────

interface FixOverlayProps {
  fixText: string;
  setFixText: (s: string) => void;
  busy: boolean;
  onClose: () => void;
  onReevaluate: () => void;
}

function FixOverlay({ fixText, setFixText, busy, onClose, onReevaluate }: FixOverlayProps) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={styles.fixBackdrop} onPress={onClose}>
        {/* Inner Pressable absorbs taps so the card itself doesn't dismiss.
            The card sits at flex-end and rides up with the keyboard via the
            outer KeyboardAvoidingView. */}
        <Pressable style={styles.fixCard} onPress={() => {}}>
          <View style={styles.fixHandle} />
          <View style={styles.fixHeader}>
            <Text style={styles.fixTitle}>Fix Result</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.fixCloseBtn}>
              <Text style={styles.fixCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.fixHint}>
            Describe any corrections — wrong food, portion size, missed ingredients, etc.
          </Text>
          <TextInput
            style={styles.fixInput}
            value={fixText}
            onChangeText={setFixText}
            placeholder="e.g. that's actually a chicken thigh, not a breast"
            placeholderTextColor={COLORS.textMuted}
            multiline
            autoFocus
          />
          <TouchableOpacity
            style={[styles.fixSubmit, (!fixText.trim() || busy) && styles.disabled]}
            onPress={onReevaluate}
            disabled={!fixText.trim() || busy}
          >
            {busy ? (
              <ActivityIndicator color="#0E1A12" />
            ) : (
              <Text style={styles.fixSubmitText}>Re-evaluate</Text>
            )}
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Contextual rating — shared with the meal detail popup via utils/mealRating.
function rateForGoals(draft: MealDraft, goals: UserGoals): { label: string; color: string } {
  return rateMeal({ calories: draft.calories, macros: draft.macros }, goals);
}

// Open Food Facts barcode lookup — unchanged.
async function lookupBarcode(code: string): Promise<MealDraft> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
  const json = await res.json();
  if (json.status !== 1 || !json.product) {
    throw new Error('Product not found');
  }
  const p = json.product;
  const n = p.nutriments ?? {};
  return {
    name: (p.product_name || p.generic_name || 'Scanned product').slice(0, 60),
    time: nowHHMM(),
    calories: Math.round(n['energy-kcal_100g'] ?? n.energy_kcal_100g ?? 0),
    macros: {
      protein: Math.round(n.proteins_100g ?? 0),
      carbs: Math.round(n.carbohydrates_100g ?? 0),
      fats: Math.round(n.fat_100g ?? 0),
    },
  };
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1, justifyContent: 'flex-end' },
  brackets: { ...StyleSheet.absoluteFillObject, margin: 40 },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: '#fff' },
  cornerTL: { top: 0, left: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 8 },
  cornerTR: { top: 0, right: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 8 },
  cornerBL: { bottom: 0, left: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 8 },
  cornerBR: { bottom: 0, right: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 8 },
  stubBadge: {
    position: 'absolute', top: 14, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  stubBadgeText: { color: '#bbb', fontSize: 11 },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', gap: 10,
  },
  busyText: { color: '#fff', fontSize: 13 },
  modeRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: 18,
  },
  modePill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(60,60,67,0.7)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
  },
  modePillActive: { backgroundColor: '#fff' },
  modePillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  modePillTextActive: { color: '#000' },
  controlsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingBottom: 32, paddingHorizontal: 36,
  },
  sideBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(60,60,67,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  sideBtnText: { color: '#fff', fontSize: 18 },
  shutter: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: 'transparent',
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterDisabled: { opacity: 0.4 },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },

  fallback: {
    flex: 1, backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, gap: 16,
  },
  fallbackText: { color: COLORS.textSecondary, textAlign: 'center', fontSize: 14 },
  permBtn: { backgroundColor: COLORS.green, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  permBtnText: { color: '#0E1A12', fontWeight: '700' },

  // Captured-photo backdrop + dim
  backdropDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  barcodeBackdrop: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  barcodeBackdropEmoji: { fontSize: 64, opacity: 0.5 },

  // Half-sheet
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: '60%',
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  sheetBody: { padding: 18, paddingBottom: 12, gap: 14 },
  sheetTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  sheetName: { color: COLORS.text, fontSize: 22, fontWeight: '700', flex: 1, paddingRight: 12 },
  bookmarkBtn: { padding: 4 },
  sheetSummary: { color: COLORS.textSecondary, fontSize: 13, marginTop: -6 },

  calorieRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.elevated, borderRadius: 14, padding: 14,
  },
  calorieValue: { color: COLORS.text, fontSize: 32, fontWeight: '700' },
  calorieLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  servingControl: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.bg, borderRadius: 999, padding: 4, gap: 4,
  },
  servingBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center',
  },
  servingBtnText: { color: COLORS.text, fontSize: 18, fontWeight: '700', lineHeight: 18 },
  servingValueWrap: { alignItems: 'center', minWidth: 56 },
  servingValue: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  servingLabel: { color: COLORS.textSecondary, fontSize: 10 },

  macroRow: { flexDirection: 'row', gap: 10 },
  macroPill: {
    flex: 1, backgroundColor: COLORS.elevated,
    borderRadius: 12, padding: 10, alignItems: 'center',
  },
  macroPillValue: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  macroPillLabel: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  ratingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, padding: 10,
  },
  ratingDot: { width: 8, height: 8, borderRadius: 4 },
  ratingLabel: { color: COLORS.text, fontSize: 13, fontWeight: '600', flex: 1 },

  actionRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border,
  },
  fixBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
  },
  fixBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  retakeBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    backgroundColor: COLORS.elevated, alignItems: 'center',
  },
  retakeBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  logBtn: {
    flex: 1.4, paddingVertical: 13, borderRadius: 12,
    backgroundColor: COLORS.green, alignItems: 'center',
  },
  logBtnText: { color: '#0E1A12', fontSize: 13, fontWeight: '700' },

  // Fix overlay (rendered inside a Modal so KeyboardAvoidingView is at root)
  fixBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  fixCard: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 12,
  },
  fixHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.textMuted,
    marginBottom: 6,
  },
  fixHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fixTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  fixCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.elevated, alignItems: 'center', justifyContent: 'center' },
  fixCloseText: { color: COLORS.text, fontSize: 14 },
  fixHint: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  fixInput: {
    backgroundColor: COLORS.elevated, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    color: COLORS.text, fontSize: 14, minHeight: 80, textAlignVertical: 'top',
  },
  fixSubmit: {
    backgroundColor: COLORS.green, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  fixSubmitText: { color: '#0E1A12', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
