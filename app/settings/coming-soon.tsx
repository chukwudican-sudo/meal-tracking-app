import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { FormPage } from '@/components/profile/FormPage';
import { COLORS } from '@/constants/theme';

export default function ComingSoonScreen() {
  const params = useLocalSearchParams<{ title?: string }>();
  const title = (params.title || 'Feature').toString();

  return (
    <FormPage title={title}>
      <View style={styles.body}>
        <Text style={styles.icon}>🚧</Text>
        <Text style={styles.heading}>{title} is on the way</Text>
        <Text style={styles.sub}>
          We&apos;re still building this out. Check back in a future update.
        </Text>
      </View>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingVertical: 80, gap: 12 },
  icon: { fontSize: 56 },
  heading: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  sub: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 20 },
});
