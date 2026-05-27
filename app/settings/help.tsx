import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { FormPage, FormSection } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';

const SHELL_ITEMS = [
  { label: 'FAQ',              soon: true },
  { label: 'About Us',         soon: true },
  { label: 'Contact Support',  soon: true },
  { label: 'Feedback',         soon: false },
  { label: 'Terms of Service', soon: true },
  { label: 'Privacy Policy',   soon: true },
] as const;

export default function HelpScreen() {
  const navTo = (item: typeof SHELL_ITEMS[number]) => {
    if (!item.soon) {
      router.push('/settings/feedback');
      return;
    }
    router.push({ pathname: '/settings/coming-soon', params: { title: item.label } });
  };

  return (
    <FormPage title="Help">
      <FormSection>
        {SHELL_ITEMS.map(item => (
          <TouchableOpacity
            key={item.label}
            style={styles.row}
            onPress={() => navTo(item)}
            activeOpacity={0.7}
          >
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
