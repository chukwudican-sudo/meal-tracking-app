import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

import { COLORS } from '@/constants/theme';
import { APP_NAME } from '@/constants/app';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function DisclaimerScreen({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={styles.full}>
        <View style={styles.header}>
          <Text style={styles.title}>Health & AI disclaimer</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Section title="Not medical advice">
            <Text style={styles.p}>
              {APP_NAME} is a meal tracking tool. Nothing in this app — including
              recommendations, AI-generated estimates, or nutrition data — should be
              considered medical, dietary, or fitness advice. Consult a qualified
              healthcare provider before making decisions about your diet, especially
              if you have a medical condition.
            </Text>
          </Section>

          <Section title="AI estimates are estimates">
            <Text style={styles.p}>
              Calorie and macronutrient values produced by the in-app assistant are
              best-guess estimates based on typical portion sizes and visual cues.
              They will sometimes be wrong. Always verify before relying on them for
              health, fitness, or medical reasons. You can correct any value via the
              Fix button.
            </Text>
          </Section>

          <Section title="Photo and barcode lookups">
            <Text style={styles.p}>
              Photo identification uses an AI vision model. Photos may be transmitted
              to the AI provider for analysis. Barcode lookups use the public Open
              Food Facts database. Listed nutrition values come directly from that
              database and may be missing, outdated, or inaccurate.
            </Text>
          </Section>

          <Section title="Voice dictation">
            <Text style={styles.p}>
              When you use the microphone, audio is recorded on your device and sent
              to the AI provider for transcription. Recording stops as soon as you
              release the mic button.
            </Text>
          </Section>

          <Section title="Your data">
            <Text style={styles.p}>
              Your meals, goals, and profile are stored locally on this device. The
              AI assistant only sees the day-level context required to do its job
              (today&apos;s goals, today&apos;s logged meals, your saved meal names, your
              first name). It does not see your full history.
            </Text>
          </Section>

          <Section title="References">
            <Text style={styles.p}>
              · Open Food Facts — open database of food products and nutrition
              information ({'\u00A0'}https://world.openfoodfacts.org{'\u00A0'}).
            </Text>
            <Text style={styles.p}>
              · OpenAI — AI provider used for chat, vision, and audio transcription
              (https://openai.com).
            </Text>
          </Section>

          <Text style={styles.placeholder}>
            (Replace this disclaimer copy with your own legal text before public release.)
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  close: { color: COLORS.textSecondary, fontSize: 18 },
  body: { padding: 18, paddingBottom: 40, gap: 18 },
  section: { gap: 6 },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  p: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  placeholder: { color: COLORS.textMuted, fontSize: 11, fontStyle: 'italic', marginTop: 18 },
});
