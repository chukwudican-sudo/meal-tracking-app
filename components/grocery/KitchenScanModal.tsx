import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AIError } from '@/ai/aiEdgeClient';
import { scanKitchen, type ScannedIngredient } from '@/ai/scanKitchen';
import { ProgressiveLoader } from '@/components/ProgressiveLoader';
import { CATEGORY_DOT, CATEGORY_ORDER, normalizeIngredientName } from '@/constants/ingredientCategories';
import { COLORS } from '@/constants/theme';
import { openPaywall } from '@/lib/paywall';
import { compressPhotoToBase64 } from '@/lib/media/compressPhoto';
import type { IngredientCategory } from '@/store/types';
import { useMealStore } from '@/store/useMealStore';
import { useToastStore } from '@/store/useToastStore';
import { PaywallModalHost } from '@/components/paywall/PaywallModalHost';
import { ToastHost } from '@/components/ToastHost';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface CapturedPhoto {
  uri: string;
  base64: string;
  mimeType: string;
}

const MAX_PHOTOS = 4;

type Step = 'capture' | 'scanning' | 'review';

/**
 * Camera scan for My Kitchen. The user snaps up to 4 photos of their
 * fridge/pantry, the scan-kitchen edge function identifies the ingredients,
 * and a confirm-and-remove checklist lets them uncheck false positives before
 * the selected items are added to their kitchen.
 */
export function KitchenScanModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const addScannedKitchenItems = useMealStore(s => s.addScannedKitchenItems);
  const showToast = useToastStore(s => s.showToast);

  const [step, setStep] = useState<Step>('capture');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [results, setResults] = useState<ScannedIngredient[]>([]);
  // Keys (normalized names) that are currently checked to add.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reset = () => {
    setStep('capture');
    setPhotos([]);
    setProcessingPhoto(false);
    setResults([]);
    setSelected(new Set());
  };

  const close = () => {
    reset();
    onClose();
  };

  const takePhoto = async () => {
    if (photos.length >= MAX_PHOTOS || processingPhoto) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera permission to scan your kitchen.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setProcessingPhoto(true);
    try {
      // Resize + recompress right away so we only ever hold light payloads.
      const { base64, mimeType } = await compressPhotoToBase64(asset.uri);
      if (!base64) throw new Error('Could not read photo data');
      setPhotos(prev => [...prev, { uri: asset.uri, base64, mimeType }]);
    } catch (e) {
      console.warn('Kitchen photo capture failed:', e);
      showToast('Could not process that photo. Try again.');
    } finally {
      setProcessingPhoto(false);
    }
  };

  // Shared handler for scan failures. Premium gate opens the shared paywall
  // (matching ScanTab) and retries the scan on a successful purchase;
  // everything else is a lightweight toast.
  const handleScanError = (e: unknown, retry: () => void) => {
    console.warn('Kitchen scan failed:', e);
    if (e instanceof AIError && e.code === 'not_premium') {
      openPaywall({ reason: 'scan_limit', onSuccess: retry });
      return;
    }
    if (
      e instanceof AIError &&
      (e.code === 'rate_limited' || e.code === 'ai_failed' || e.code === 'unauthorized')
    ) {
      showToast(e.message || 'The AI scanner is temporarily unavailable. Please try again.');
      return;
    }
    showToast('Could not scan your kitchen. Try again.');
  };

  const startScan = async () => {
    if (photos.length === 0) return;
    setStep('scanning');
    try {
      const ingredients = await scanKitchen(
        photos.map(p => ({ base64: p.base64, mimeType: p.mimeType })),
      );

      // Filter out anything already in the kitchen (mirrors addManualKitchenItem's
      // dedupe) so the review list only shows genuinely new items.
      const kitchenKeys = new Set(
        Object.values(useMealStore.getState().grocery.items)
          .filter(i => i.section === 'kitchen')
          .map(i => i.key),
      );
      const fresh = ingredients.filter(ing => !kitchenKeys.has(normalizeIngredientName(ing.name)));

      if (fresh.length === 0) {
        showToast('You already have everything we found.');
        close();
        return;
      }

      setResults(fresh);
      setSelected(new Set(fresh.map(f => normalizeIngredientName(f.name))));
      setStep('review');
    } catch (e) {
      handleScanError(e, () => void startScan());
      setStep('capture');
    }
  };

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirmAdd = () => {
    const chosen = results.filter(r => selected.has(normalizeIngredientName(r.name)));
    if (chosen.length === 0) return;
    const added = addScannedKitchenItems(
      chosen.map(c => ({ name: c.name, category: c.category })),
    );
    showToast(`Added ${added} item${added === 1 ? '' : 's'} to your kitchen`);
    close();
  };

  // Group the detected ingredients by category, in the shared display order,
  // for the review checklist.
  const grouped = useMemo(() => {
    const groups = {} as Record<IngredientCategory, ScannedIngredient[]>;
    CATEGORY_ORDER.forEach(c => { groups[c] = []; });
    results.forEach(r => { groups[r.category]?.push(r); });
    return groups;
  }, [results]);

  const selectedCount = selected.size;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} transparent>
      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.headerBtn}>
            <Text style={styles.headerClose}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {step === 'review' ? 'Review ingredients' : 'Scan your kitchen'}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {step === 'scanning' ? (
          <ProgressiveLoader
            messages={[
              'Uploading your photos…',
              'Scanning for ingredients…',
              'Sorting them into categories…',
              'Almost done…',
            ]}
          />
        ) : step === 'review' ? (
          <>
            <Text style={styles.intro}>
              We found these ingredients. Uncheck anything that&apos;s wrong, then add the rest to your kitchen.
            </Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.reviewBody}>
              {CATEGORY_ORDER.map(cat => {
                const items = grouped[cat];
                if (!items || items.length === 0) return null;
                const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
                return (
                  <View key={cat} style={styles.catBlock}>
                    <View style={styles.catHeaderRow}>
                      <View style={[styles.dot, { backgroundColor: CATEGORY_DOT[cat] }]} />
                      <Text style={styles.catHeader}>{cat}</Text>
                    </View>
                    <View style={styles.catContainer}>
                      {sorted.map((item, idx) => {
                        const key = normalizeIngredientName(item.name);
                        const checked = selected.has(key);
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.reviewRow, idx > 0 && styles.reviewRowDivider]}
                            onPress={() => toggle(key)}
                            activeOpacity={0.7}
                          >
                            <Ionicons
                              name={checked ? 'checkbox' : 'square-outline'}
                              size={22}
                              color={checked ? COLORS.green : COLORS.textSecondary}
                            />
                            <Text style={[styles.reviewName, !checked && styles.reviewNameOff]}>
                              {item.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={close} activeOpacity={0.85}>
                <Text style={styles.secondaryText}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.doneBtn, selectedCount === 0 && styles.doneDisabled]}
                onPress={confirmAdd}
                activeOpacity={0.85}
                disabled={selectedCount === 0}
              >
                <Text style={styles.doneText}>
                  {selectedCount === 0
                    ? 'Select items'
                    : `Add ${selectedCount} item${selectedCount === 1 ? '' : 's'}`}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.intro}>
              Snap your fridge, cupboards, and pantry — up to {MAX_PHOTOS} photos. We&apos;ll identify the
              ingredients and let you review them before adding.
            </Text>

            <View style={{ flex: 1 }}>
              {photos.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                  {photos.map((photo, i) => (
                    <View key={`${photo.uri}-${i}`} style={styles.thumbWrap}>
                      <Image source={{ uri: photo.uri }} style={styles.thumb} resizeMode="cover" />
                      <Pressable
                        style={styles.thumbRemove}
                        onPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                        hitSlop={8}
                      >
                        <Text style={styles.thumbRemoveText}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="camera-outline" size={44} color={COLORS.textSecondary} />
                  <Text style={styles.emptyText}>No photos yet</Text>
                </View>
              )}
            </View>

            <View style={styles.footer}>
              {photos.length >= MAX_PHOTOS ? (
                <Text style={styles.limitNote}>Maximum of {MAX_PHOTOS} photos reached.</Text>
              ) : (
                <TouchableOpacity style={styles.takeBtn} onPress={takePhoto} activeOpacity={0.85} disabled={processingPhoto}>
                  {processingPhoto ? (
                    <ActivityIndicator color={COLORS.text} />
                  ) : (
                    <>
                      <Ionicons name="camera" size={18} color={COLORS.text} />
                      <Text style={styles.takeText}>{photos.length > 0 ? 'Take Another Photo' : 'Take Photo'}</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.doneBtn, (photos.length === 0 || processingPhoto) && styles.doneDisabled]}
                onPress={startScan}
                activeOpacity={0.85}
                disabled={photos.length === 0 || processingPhoto}
              >
                <Text style={styles.doneText}>
                  Scan{photos.length > 0 ? ` (${photos.length})` : ''}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
      <PaywallModalHost active={visible} />
      <ToastHost />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerClose: { color: COLORS.textSecondary, fontSize: 18, fontWeight: '600' },
  title: { flex: 1, color: COLORS.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  intro: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },

  thumbRow: { gap: 12, paddingVertical: 8 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 110, height: 150, borderRadius: 12, backgroundColor: COLORS.card },
  thumbRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Review checklist
  reviewBody: { paddingBottom: 12, gap: 18 },
  catBlock: { gap: 8 },
  catHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  catHeader: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  catContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  reviewRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  reviewName: { flex: 1, color: COLORS.text, fontSize: 16 },
  reviewNameOff: { color: COLORS.textSecondary, textDecorationLine: 'line-through' },

  footer: { flexDirection: 'row', gap: 10, paddingTop: 12, alignItems: 'center' },
  takeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  takeText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  limitNote: { flex: 1, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  secondaryText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  doneBtn: {
    flex: 1.4,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: COLORS.green,
  },
  doneDisabled: { opacity: 0.45 },
  doneText: { color: '#0E1A12', fontSize: 15, fontWeight: '800' },
});
