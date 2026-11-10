// Settings → Privacy & AI. Where the AI permission (Apple 5.1.2) can be
// turned off or back on; the same disclosure as the permission sheet is shown
// here, so switching on from this page is informed consent too.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { PRIVACY_URL } from '@/constants/legal';
import { COLORS } from '@/constants/theme';
import { useMealStore } from '@/store/useMealStore';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function formatDay(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PrivacyScreen() {
  const aiConsent = useMealStore(s => s.profile.aiConsent);
  const aiConsentAt = useMealStore(s => s.profile.aiConsentAt);
  const setAiConsent = useMealStore(s => s.setAiConsent);

  // Saved on tap, like iOS Settings.
  const on = aiConsent === true;
  const day = formatDay(aiConsentAt);
  const status = on
    ? `On${day ? ` · allowed ${day}` : ''}`
    : aiConsent === false
      ? 'Off · AI features will ask before use'
      : 'Not set · AI features will ask before use';

  return (
    <FormPage title="Privacy & AI">
      <View style={styles.banner}>
        <View style={styles.bannerRow}>
          <View style={styles.bannerIcon}>
            <Ionicons name="sparkles" size={22} color={COLORS.green} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>AI features</Text>
            <Text style={styles.bannerSub}>Powered by Google Gemini</Text>
          </View>
          <Switch
            value={on}
            onValueChange={setAiConsent}
            trackColor={{ true: COLORS.green, false: COLORS.elevated }}
            thumbColor="#fff"
            accessibilityLabel="Allow AI features"
          />
        </View>
        <Text style={[styles.status, on && styles.statusOn]}>{status}</Text>
        <Text style={styles.bannerNote}>
          Scan, Describe, Fix, recipe ideas and steps, the recipe assistant, Build My Plan, What Can I Make and
          Kitchen scan use AI. Manual add, barcode and everything else work without it.
        </Text>
      </View>

      <FormSection label="WHAT GEMINI RECEIVES">
        <InfoRow icon="camera-outline" color={COLORS.blue} text="The photo or text you send, only when you use an AI feature" first />
        <InfoRow icon="leaf-outline" color={COLORS.purple} text="Your diet preferences, allergies and goals" />
        <InfoRow icon="lock-closed-outline" color={COLORS.red} text="Never your name, email, weight, height or age" />
      </FormSection>

      <FormSection label="YOUR DATA">
        <InfoRow
          icon="document-text-outline"
          color={COLORS.textSecondary}
          text="We keep a private log of AI requests to improve accuracy. Deleting your account deletes it."
          first
        />
        <TouchableOpacity
          style={styles.row}
          onPress={() => { void Linking.openURL(PRIVACY_URL); }}
          activeOpacity={0.7}
          accessibilityRole="link"
        >
          <Text style={styles.rowText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </TouchableOpacity>
      </FormSection>
    </FormPage>
  );
}

function InfoRow({ icon, color, text, first }: { icon: IoniconName; color: string; text: string; first?: boolean }) {
  return (
    <View style={[styles.row, first && styles.rowFirst]}>
      <View style={[styles.rowIcon, { backgroundColor: color + '24' }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Text style={[styles.rowText, styles.infoText]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    backgroundColor: 'rgba(74,222,128,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  bannerSub: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 },
  status: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 10 },
  statusOn: { color: COLORS.green },
  bannerNote: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  rowFirst: { borderTopWidth: 0 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { color: COLORS.text, fontSize: 15 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 19 },
});
