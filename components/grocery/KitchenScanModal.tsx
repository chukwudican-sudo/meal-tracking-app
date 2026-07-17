import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
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

import { COLORS } from '@/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Camera scan (AI shell). Lets the user snap multiple photos of their
 * fridge/pantry in one session. AI identification isn't wired up yet, so on
 * "Done" we surface a message instead of adding items.
 */
export function KitchenScanModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);

  const reset = () => {
    setPhotos([]);
    setProcessing(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera permission to scan your kitchen.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.4 });
    if (!res.canceled && res.assets?.[0]) {
      setPhotos(prev => [...prev, res.assets[0].uri]);
    }
  };

  const finish = () => {
    if (photos.length === 0) { close(); return; }
    setProcessing(true);
    // Shell: pretend to analyze, then explain the feature isn't live yet.
    setTimeout(() => {
      setProcessing(false);
      Alert.alert(
        'Scan captured',
        `We saved ${photos.length} photo${photos.length === 1 ? '' : 's'}. Automatic ingredient detection isn't available yet — for now, add items manually. This will fill your kitchen automatically once AI is enabled.`,
        [{ text: 'OK', onPress: close }],
      );
    }, 1100);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} transparent>
      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.headerBtn}>
            <Text style={styles.headerClose}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Scan your kitchen</Text>
          <View style={styles.headerBtn} />
        </View>

        <Text style={styles.intro}>
          Snap your fridge, cupboards, and pantry. Take as many photos as you need — we&apos;ll identify
          the ingredients when AI is enabled.
        </Text>

        <View style={{ flex: 1 }}>
          {photos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
              {photos.map((uri, i) => (
                <View key={`${uri}-${i}`} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
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
          <TouchableOpacity style={styles.takeBtn} onPress={takePhoto} activeOpacity={0.85} disabled={processing}>
            <Ionicons name="camera" size={18} color={COLORS.text} />
            <Text style={styles.takeText}>{photos.length > 0 ? 'Take Another Photo' : 'Take Photo'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.doneBtn, (photos.length === 0 || processing) && styles.doneDisabled]}
            onPress={finish}
            activeOpacity={0.85}
            disabled={photos.length === 0 || processing}
          >
            {processing ? (
              <ActivityIndicator color="#0E1A12" />
            ) : (
              <Text style={styles.doneText}>Done{photos.length > 0 ? ` (${photos.length})` : ''}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
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
  footer: { gap: 10, paddingTop: 12 },
  takeBtn: {
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
  doneBtn: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: COLORS.green,
  },
  doneDisabled: { opacity: 0.45 },
  doneText: { color: '#0E1A12', fontSize: 15, fontWeight: '800' },
});
