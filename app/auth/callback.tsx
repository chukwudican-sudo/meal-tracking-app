import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { COLORS } from '@/constants/theme';
import { exchangeCodeFromUrl } from '@/lib/auth';

// Landing screen for the email-verification deep link
// (mealapp://auth/callback?code=...). Exchanges the code for a session, which
// activates the account, then sends the user into the app.
export default function AuthCallbackScreen() {
  const url = Linking.useURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    (async () => {
      const { error: err } = await exchangeCodeFromUrl(url);
      if (cancelled) return;
      if (err) {
        setError(err);
      } else {
        router.replace('/(tabs)');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.centered}>
        {error ? (
          <>
            <Ionicons name="alert-circle-outline" size={56} color={COLORS.red} />
            <Text style={styles.title}>Verification failed</Text>
            <Text style={styles.bodyText}>{error}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/onboarding')}>
              <Text style={styles.primaryBtnText}>Back to start</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator color={COLORS.green} size="large" />
            <Text style={styles.bodyText}>Confirming your email…</Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  bodyText: { color: COLORS.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  primaryBtn: { backgroundColor: COLORS.green, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center', marginTop: 12 },
  primaryBtnText: { color: '#04110A', fontSize: 16, fontWeight: '700' },
});
