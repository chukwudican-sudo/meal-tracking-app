import { useEffect, useMemo, useRef, useState } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import { aiClient } from '@/ai/aiClient';
import { AIError } from '@/ai/aiEdgeClient';
import { scanMeal, type ScanMode } from '@/ai/scanMeal';
import { compressPhotoToBase64 } from '@/lib/media/compressPhoto';
import type { DayContext, MealDraft } from '@/ai/types';
import { openPaywall } from '@/lib/paywall';
import type { UserGoals } from '@/store/types';
import { rateMeal } from '@/utils/mealRating';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';

// 'food' estimates a plated meal, 'label' reads a Nutrition Facts label (both
// via scan-meal), 'barcode' looks the product up. Photo-library picks reuse the
// current photo mode, so there's no separate Upload mode.
type Mode = 'food' | 'barcode' | 'label';

const MODES: { id: Mode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'food',    label: 'Scan Food',  icon: 'scan-outline' },
  { id: 'barcode', label: 'Barcode',    icon: 'barcode-outline' },
  { id: 'label',   label: 'Food label', icon: 'document-text-outline' },
];

const BUSY_TEXT: Record<Mode, string> = {
  food: 'Identifying…',
  barcode: 'Looking up product…',
  label: 'Reading label…',
};

// expo-camera exposes iOS lenses by AVCaptureDevice.localizedName ("Back Ultra
// Wide Camera" in English). No match (older phone, non-English device names) ->
// the .5x toggle simply isn't shown.
function findUltraWideLens(lenses: string[]): string | null {
  return lenses.find(l => /ultra ?wide/i.test(l)) ?? null;
}

// Food label frame: a portrait, label-shaped box (2:3) about two-thirds of the
// screen wide, centered in the space between the top buttons and the controls.
const LABEL_WIDTH_RATIO = 0.66;
const LABEL_ASPECT = 1.5; // height / width
const LABEL_DIM = 'rgba(0,0,0,0.45)';
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
  /** Closes the whole Add Meal screen (the camera hides that screen's header). */
  onClose: () => void;
}

export function ScanTab({ context, onDraftReady, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('food');
  const [ultraWideLens, setUltraWideLens] = useState<string | null>(null);
  const [useUltraWide, setUseUltraWide] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const { width: screenW } = useWindowDimensions();
  const [areaH, setAreaH] = useState(0);
  const [panelH, setPanelH] = useState(0);
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

  // Shared handler for scan/upload failures. Premium gate opens the shared
  // paywall (matching AITab) and retries the same capture on a successful
  // purchase; everything else is a lightweight toast, since the camera view
  // has no inline note slot. ScanError subclasses AIError.
  function handleScanError(e: unknown, retry: () => void) {
    console.warn('Scan failed:', e);
    if (e instanceof AIError && e.code === 'not_premium') {
      openPaywall({ reason: 'scan_limit', onSuccess: retry });
      return;
    }
    if (e instanceof AIError && e.code === 'rate_limited') {
      showToast(e.message || "You've hit the hourly limit for AI scans. Try again later.");
      return;
    }
    if (e instanceof AIError && e.code === 'unauthorized') {
      showToast('Your session expired. Please sign in again.');
      return;
    }
    if (e instanceof AIError && e.code === 'invalid_input') {
      showToast(e.message || 'Could not read this photo. Try again.');
      return;
    }
    if (e instanceof AIError && e.code === 'ai_failed') {
      showToast(e.message || 'The AI scanner is temporarily unavailable. Please try again.');
      return;
    }
    showToast('Could not scan this meal. Try again.');
  }

  // Photo -> frozen preview -> compress -> scan. Shared by the shutter and the
  // library button. The paywall's onSuccess retry re-runs it on the SAME photo,
  // so buying Pro mid-scan never snaps a new picture or reopens the library.
  async function analyzePhoto(uri: string, scanMode: ScanMode) {
    setBusy(true);
    setCapturedUri(uri); // freeze on this photo while it's analysed
    try {
      // Resize + recompress before sending (raw captures are multi-MB).
      const { base64, mimeType } = await compressPhotoToBase64(uri);
      if (!base64) throw new Error('Could not read photo data');
      const result = await scanMeal(base64, mimeType, scanMode);
      setDraft(result);
      setServings(1);
      setBookmarked(false);
      setScanState('result');
    } catch (e) {
      setCapturedUri(null); // back to the live camera
      void cameraRef.current?.resumePreview().catch(() => {});
      handleScanError(e, () => void analyzePhoto(uri, scanMode));
    } finally {
      setBusy(false);
    }
  }

  async function handleCapture() {
    if (busy || mode === 'barcode' || !cameraRef.current) return; // barcode scans itself
    let uri: string | undefined;
    setBusy(true);
    // Freeze the preview on the tapped frame right away: takePictureAsync
    // captures + re-encodes a full-resolution photo (~1-2s on iOS), and the live
    // preview kept moving until it returned. The still photo replaces this
    // paused frame once it's ready.
    void cameraRef.current.pausePreview().catch(() => {});
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      uri = shot?.uri;
    } catch (e) {
      console.warn('Capture failed:', e);
    } finally {
      setBusy(false);
    }
    if (!uri) {
      void cameraRef.current?.resumePreview().catch(() => {});
      showToast('Could not take a photo. Try again.');
      return;
    }
    await analyzePhoto(uri, mode === 'label' ? 'label' : 'meal');
  }

  async function handleUpload() {
    if (busy) return;
    let uri: string | undefined;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.5,
      });
      if (result.canceled || !result.assets?.[0]) return;
      uri = result.assets[0].uri;
    } catch (e) {
      console.warn('Photo library failed:', e);
      showToast('Could not open your photos. Try again.');
      return;
    }
    await analyzePhoto(uri, mode === 'label' ? 'label' : 'meal');
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
      showToast("We couldn't find this product. Try Food label instead.");
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

  // Label frame geometry (only used in Food label mode, once layout is known).
  const labelTop0 = insets.top + 60;
  const labelSpace = areaH - labelTop0 - panelH - 24;
  const labelW = Math.round(screenW * LABEL_WIDTH_RATIO);
  const labelH = Math.max(0, Math.min(Math.round(labelW * LABEL_ASPECT), labelSpace));
  const labelRect = {
    left: Math.round((screenW - labelW) / 2),
    top: Math.round(labelTop0 + Math.max(0, (labelSpace - labelH) / 2)),
    width: labelW,
    height: labelH,
  };
  const showLabelFrame = mode === 'label' && areaH > 0 && panelH > 0 && labelH > 0;

  return (
    <View style={styles.full}>
      {/* Camera is mounted only in the camera state to avoid stale frames
          peeking through the half-sheet darkness on slower devices. */}
      {showCamera ? (
        // CameraView must stay childless: expo-camera warns children "may lead to
        // inconsistent behaviour or crashes", and on iOS (New Architecture) they
        // did — unmounting the camera after a successful scan hit an RN assertion
        // in unmountChildComponentView and killed the app. Overlays render as
        // siblings layered on top instead.
        <View style={styles.camera} onLayout={e => setAreaH(e.nativeEvent.layout.height)}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            flash={flash}
            selectedLens={useUltraWide && ultraWideLens ? ultraWideLens : undefined}
            onAvailableLensesChanged={({ lenses }) => setUltraWideLens(findUltraWideLens(lenses))}
            barcodeScannerSettings={
              mode === 'barcode'
                ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }
                : undefined
            }
            onBarcodeScanned={mode === 'barcode' ? ({ data }) => handleBarcode(data) : undefined}
          />
          {capturedUri ? (
            <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : null}

          {showLabelFrame ? (
            <>
              {/* Dim everything outside the label box so the label is the focus. */}
              <View pointerEvents="none" style={[styles.dim, { top: 0, left: 0, right: 0, height: labelRect.top }]} />
              <View
                pointerEvents="none"
                style={[styles.dim, { top: labelRect.top + labelRect.height, left: 0, right: 0, bottom: 0 }]}
              />
              <View
                pointerEvents="none"
                style={[styles.dim, { top: labelRect.top, height: labelRect.height, left: 0, width: labelRect.left }]}
              />
              <View
                pointerEvents="none"
                style={[styles.dim, { top: labelRect.top, height: labelRect.height, left: labelRect.left + labelRect.width, right: 0 }]}
              />
              <View pointerEvents="none" style={[styles.frame, labelRect]}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
            </>
          ) : mode !== 'label' ? (
            <View
              pointerEvents="none"
              style={[styles.frame, mode === 'barcode' ? styles.frameBarcode : styles.framePhoto]}
            >
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
              {mode === 'barcode' && <View style={styles.scanLine} />}
            </View>
          ) : null}

          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            <TouchableOpacity style={styles.roundBtn} onPress={onClose} accessibilityLabel="Close" hitSlop={6}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.roundBtn}
              onPress={() => setShowTips(true)}
              accessibilityLabel="Scanning tips"
              hitSlop={6}
            >
              <Ionicons name="help" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {mode === 'barcode' && (
            <View pointerEvents="none" style={styles.hintWrap}>
              <Text style={styles.hintText}>Point at a barcode — it scans automatically</Text>
            </View>
          )}

          <View style={styles.bottomPanel} onLayout={e => setPanelH(e.nativeEvent.layout.height)}>
            {ultraWideLens ? (
              <View style={styles.zoomRow}>
                <View style={styles.zoomPill}>
                  {([true, false] as const).map(ultra => {
                    const active = useUltraWide === ultra;
                    return (
                      <TouchableOpacity
                        key={ultra ? 'ultra' : 'wide'}
                        style={[styles.zoomBtn, active && styles.zoomBtnActive]}
                        onPress={() => setUseUltraWide(ultra)}
                      >
                        <Text style={[styles.zoomText, active && styles.zoomTextActive]}>
                          {ultra ? '.5x' : '1x'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.modeRow}>
              {MODES.map(m => {
                const active = mode === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.modeTile, active && styles.modeTileActive]}
                    onPress={() => setMode(m.id)}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={m.icon} size={24} color={active ? '#0F0F0F' : '#fff'} />
                    <Text style={[styles.modeTileText, active && styles.modeTileTextActive]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.controlsRow}>
              <TouchableOpacity
                style={styles.sideBtn}
                onPress={() => setFlash(f => (f === 'off' ? 'on' : 'off'))}
                accessibilityLabel={flash === 'on' ? 'Flash on' : 'Flash off'}
              >
                <Ionicons name={flash === 'on' ? 'flash' : 'flash-off-outline'} size={22} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shutter, mode === 'barcode' && styles.shutterDisabled]}
                onPress={handleCapture}
                disabled={mode === 'barcode' || busy}
                accessibilityLabel="Take photo"
              >
                <View style={styles.shutterInner} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sideBtn}
                onPress={handleUpload}
                disabled={busy}
                accessibilityLabel="Choose from photo library"
              >
                <Ionicons name="images-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {busy && (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color={COLORS.green} />
              <Text style={styles.busyText}>{BUSY_TEXT[mode]}</Text>
            </View>
          )}
        </View>
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
      <Modal transparent visible={showTips} animationType="slide" onRequestClose={() => setShowTips(false)}>
        <TipsSheet onClose={() => setShowTips(false)} bottomInset={insets.bottom} />
      </Modal>

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

// ─── Tips sheet ─────────────────────────────────────────────────────────────

const TIPS: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }[] = [
  { icon: 'scan-outline', title: 'Fit the whole plate in the frame', body: "Everything you're eating should be visible inside the corners." },
  { icon: 'sunny-outline', title: 'Use good light', body: "Daylight works best. Turn on the flash if it's dark." },
  { icon: 'trending-up-outline', title: 'Shoot from a slight angle', body: 'About 45° shows both the size and the height of the food.' },
  { icon: 'barcode-outline', title: 'Packaged food? Use Barcode or Food label', body: 'They read the exact numbers from the package.' },
];

function TipsSheet({ onClose, bottomInset }: { onClose: () => void; bottomInset: number }) {
  return (
    <Pressable style={styles.tipsBackdrop} onPress={onClose}>
      <Pressable style={[styles.tipsSheet, { paddingBottom: Math.max(bottomInset, 16) + 16 }]} onPress={() => {}}>
        <View style={styles.fixHandle} />
        <Text style={styles.tipsTitle}>How to get a good scan</Text>
        {TIPS.map(t => (
          <View key={t.title} style={styles.tipRow}>
            <View style={styles.tipIcon}>
              <Ionicons name={t.icon} size={20} color={COLORS.green} />
            </View>
            <View style={styles.tipTextCol}>
              <Text style={styles.tipTitle}>{t.title}</Text>
              <Text style={styles.tipBody}>{t.body}</Text>
            </View>
          </View>
        ))}
        <TouchableOpacity style={styles.tipsBtn} onPress={onClose} activeOpacity={0.85}>
          <Text style={styles.tipsBtnText}>Got it</Text>
        </TouchableOpacity>
      </Pressable>
    </Pressable>
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

// Opaque surface for sheets that overlay the captured photo. COLORS.card is a
// translucent white (rgba(...,0.04)) meant to sit on the opaque app bg; over a
// photo it lets the image bleed through, so these surfaces need a solid color.
const OPAQUE_SHEET_BG = '#1C1C1C';

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  frame: { position: 'absolute', alignSelf: 'center' },
  dim: { position: 'absolute', backgroundColor: LABEL_DIM },
  framePhoto: { top: '17%', left: 36, right: 36, bottom: '40%' },
  frameBarcode: { top: '34%', left: 45, right: 45, height: 170 },
  corner: { position: 'absolute', width: 52, height: 52, borderColor: '#fff' },
  cornerTL: { top: 0, left: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 22 },
  cornerTR: { top: 0, right: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 22 },
  cornerBL: { bottom: 0, left: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 22 },
  cornerBR: { bottom: 0, right: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 22 },
  scanLine: { position: 'absolute', top: '50%', left: 24, right: 24, height: 2, backgroundColor: COLORS.green },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  roundBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center', justifyContent: 'center',
  },
  hintWrap: { position: 'absolute', top: '27%', left: 16, right: 16, alignItems: 'center' },
  hintText: {
    color: '#fff', fontSize: 14, fontWeight: '600', overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
  },
  bottomPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 16, gap: 14 },
  zoomRow: { alignItems: 'center' },
  zoomPill: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.42)' },
  zoomBtn: { minWidth: 44, height: 30, paddingHorizontal: 10, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  zoomBtnActive: { backgroundColor: '#fff' },
  zoomText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  zoomTextActive: { color: '#0F0F0F', fontWeight: '700' },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', gap: 10,
  },
  busyText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modeRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  modeTile: {
    flex: 1, height: 76, borderRadius: 18,
    backgroundColor: 'rgba(38,38,38,0.78)',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  modeTileActive: { backgroundColor: '#fff' },
  modeTileText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modeTileTextActive: { color: '#0F0F0F' },
  controlsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 32,
  },
  sideBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(38,38,38,0.78)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutter: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: 'transparent',
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterDisabled: { opacity: 0.35 },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  tipsBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  tipsSheet: {
    backgroundColor: OPAQUE_SHEET_BG,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 10, gap: 16,
  },
  tipsTitle: { color: COLORS.text, fontSize: 22, fontWeight: '700', marginTop: 4 },
  tipRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  tipIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(74,222,128,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  tipTextCol: { flex: 1, gap: 3 },
  tipTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  tipBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  tipsBtn: { marginTop: 6, height: 54, borderRadius: 16, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center' },
  tipsBtnText: { color: '#04110A', fontSize: 16, fontWeight: '700' },

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
    backgroundColor: OPAQUE_SHEET_BG,
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
    backgroundColor: OPAQUE_SHEET_BG,
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
