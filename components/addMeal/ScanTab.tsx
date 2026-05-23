import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  CameraView,
  useCameraPermissions,
  type CameraType,
  type FlashMode,
} from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import { COLORS } from '@/constants/theme';
import { aiClient, isStubAI } from '@/ai/aiClient';
import type { DayContext, MealDraft } from '@/ai/types';

type Mode = 'scan' | 'upload' | 'barcode';

interface Props {
  context: DayContext;
  onDraftReady: (draft: MealDraft, source: { photoUri?: string; barcode?: string }) => void;
}

export function ScanTab({ context, onDraftReady }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('scan');
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [busy, setBusy] = useState(false);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  // Reset the locked-out barcode each time we re-enter Barcode mode.
  useEffect(() => {
    if (mode !== 'barcode') setScannedCode(null);
  }, [mode]);

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
      const draft = await aiClient.parseMeal({ imageUri: dataUri }, context);
      onDraftReady(draft, { photoUri: shot.uri });
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
      const draft = await aiClient.parseMeal({ imageUri: dataUri }, context);
      onDraftReady(draft, { photoUri: asset.uri });
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
      const draft = await lookupBarcode(code);
      onDraftReady(draft, { barcode: code });
    } catch (e) {
      console.warn('Barcode lookup failed:', e);
      setScannedCode(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.full}>
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
        {/* Corner brackets framing */}
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

        {/* Mode pills */}
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

        {/* Bottom controls */}
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
    </View>
  );
}

// ─── Open Food Facts barcode lookup ─────────────────────────────────────────

async function lookupBarcode(code: string): Promise<MealDraft> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
  const json = await res.json();
  if (json.status !== 1 || !json.product) {
    throw new Error('Product not found');
  }
  const p = json.product;
  const n = p.nutriments ?? {};
  // Macros are per 100g. We default the entry to a 100g serving and let the
  // user adjust calories/macros on the draft card.
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

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1, justifyContent: 'flex-end' },
  brackets: {
    ...StyleSheet.absoluteFillObject,
    margin: 40,
  },
  corner: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderColor: '#fff',
  },
  cornerTL: { top: 0, left: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 8 },
  cornerTR: { top: 0, right: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 8 },
  cornerBL: { bottom: 0, left: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 8 },
  cornerBR: { bottom: 0, right: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 8 },
  stubBadge: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  stubBadgeText: { color: '#bbb', fontSize: 11 },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    gap: 10,
  },
  busyText: { color: '#fff', fontSize: 13 },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 18,
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(60,60,67,0.7)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  modePillActive: { backgroundColor: '#fff' },
  modePillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  modePillTextActive: { color: '#000' },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: 32,
    paddingHorizontal: 36,
  },
  sideBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(60,60,67,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideBtnText: { color: '#fff', fontSize: 18 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'transparent',
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisabled: { opacity: 0.4 },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  fallback: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  fallbackText: { color: COLORS.textSecondary, textAlign: 'center', fontSize: 14 },
  permBtn: {
    backgroundColor: COLORS.green,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
  },
  permBtnText: { color: '#0E1A12', fontWeight: '700' },
});
