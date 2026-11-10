// The AI permission sheet (Apple 5.1.2) — see lib/aiConsent.ts. Mount one in
// the root layout (active always) and one inside every RN Modal an AI request
// can start from, with active = that modal's visibility; the top-most active
// host shows the sheet, so it's never hidden behind a modal.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRIVACY_URL } from '@/constants/legal';
import { COLORS, OPAQUE_SHEET_BG } from '@/constants/theme';
import { useAIConsentStore } from '@/store/useAIConsentStore';

let nextHostId = 0;

export function AIConsentHost({ active }: { active: boolean }) {
  const id = useRef(`ai-consent-${nextHostId++}`).current;
  const isTop = useAIConsentStore(s => s.hosts[s.hosts.length - 1] === id);
  const asking = useAIConsentStore(s => s.pending !== null);
  const answer = useAIConsentStore(s => s.answer);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!active) return;
    const { addHost, removeHost } = useAIConsentStore.getState();
    addHost(id);
    return () => removeHost(id);
  }, [active, id]);

  return (
    <Modal
      visible={active && isTop && asking}
      transparent
      animationType="fade"
      onRequestClose={() => answer(false)}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => answer(false)} accessibilityLabel="Not now" />
        <View style={[styles.sheet, { marginBottom: insets.bottom + 8 }]}>
          {/* Soft glow behind the icon (layered tints, no gradient library) */}
          <View style={styles.glowOuter} pointerEvents="none" />
          <View style={styles.glowInner} pointerEvents="none" />
          <View style={styles.grab} />

          <View style={styles.hero}>
            <View style={styles.orb}>
              <Ionicons name="sparkles" size={26} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>Turn on AI features?</Text>
            <Text style={styles.lead}>
              AI features like meal scanning, recipes and Build My Plan use{' '}
              <Text style={styles.strong}>Google Gemini</Text>. Here&apos;s exactly what it gets.
            </Text>
          </View>

          <View style={styles.list}>
            <Item
              icon="camera-outline"
              color={COLORS.blue}
              title="The photo or text you send"
              sub="Only when you use an AI feature"
            />
            <View style={styles.divider} />
            <Item
              icon="leaf-outline"
              color={COLORS.purple}
              title="Your diet, allergies and goals"
              sub="So results fit you"
            />
          </View>

          <View style={styles.never}>
            <Ionicons name="lock-closed-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.neverText}>Never your name, email, weight, height or age</Text>
          </View>

          <Text style={styles.fine}>
            We keep a private log of AI requests to improve accuracy. Change this anytime in Settings → Privacy &amp; AI.{' '}
            <Text style={styles.link} onPress={() => { void Linking.openURL(PRIVACY_URL); }}>
              Privacy Policy
            </Text>
          </Text>

          <TouchableOpacity onPress={() => answer(true)} activeOpacity={0.85} accessibilityRole="button">
            <View style={styles.allow}>
              <Text style={styles.allowText}>Allow</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => answer(false)} style={styles.later} accessibilityRole="button">
            <Text style={styles.laterText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Item({
  icon, color, title, sub,
}: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; title: string; sub: string }) {
  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: color + '24' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemSub}>{sub}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    marginHorizontal: 8,
    borderRadius: 32,
    backgroundColor: OPAQUE_SHEET_BG,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  glowOuter: {
    position: 'absolute', top: -140, alignSelf: 'center', width: 340, height: 240, borderRadius: 170,
    backgroundColor: 'rgba(96,165,250,0.07)',
  },
  glowInner: {
    position: 'absolute', top: -100, alignSelf: 'center', width: 220, height: 170, borderRadius: 110,
    backgroundColor: 'rgba(74,222,128,0.12)',
  },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: 16 },
  hero: { alignItems: 'center' },
  orb: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(74,222,128,0.24)',
    shadowColor: COLORS.green,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  title: { color: COLORS.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 },
  lead: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginHorizontal: 6, marginBottom: 16 },
  strong: { color: COLORS.text, fontWeight: '600' },
  list: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 12,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  itemIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { color: COLORS.text, fontSize: 14, fontWeight: '500' },
  itemSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
  never: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginHorizontal: 4 },
  neverText: { color: COLORS.textSecondary, fontSize: 12.5 },
  fine: { color: COLORS.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 6, marginHorizontal: 4, marginBottom: 14 },
  link: { color: COLORS.textSecondary, textDecorationLine: 'underline' },
  allow: {
    height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.green,
    shadowColor: COLORS.green, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  allowText: { color: '#06210F', fontSize: 16, fontWeight: '700' },
  later: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  laterText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
});
