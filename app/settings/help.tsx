import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';
import { openPrivacy, openSupportEmail, openTerms } from '@/lib/openLink';

// Only things that work (Apple 2.1: no "coming soon"). FAQ and About Us come
// back once they have real content.
const ITEMS: { label: string; onPress: () => void }[] = [
  { label: 'Contact Support',  onPress: () => { void openSupportEmail(); } },
  { label: 'Send Feedback',    onPress: () => router.push('/settings/feedback') },
  { label: 'Terms of Service', onPress: () => { void openTerms(); } },
  { label: 'Privacy Policy',   onPress: () => { void openPrivacy(); } },
];

export default function HelpScreen() {
  return (
    <FormPage title="Help">
      <FormSection>
        {ITEMS.map(item => (
          <TouchableOpacity key={item.label} style={styles.row} onPress={item.onPress} activeOpacity={0.7}>
            <Text style={styles.rowText}>{item.label}</Text>
            <Text style={styles.rowArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </FormSection>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  rowText: { color: COLORS.text, fontSize: 15 },
  rowArrow: { color: COLORS.textSecondary, fontSize: 22, fontWeight: '300' },
});
