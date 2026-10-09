import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  // A confirmation link can reach us two ways: the live useURL() listener
  // (app already running) or getInitialURL() (link launched/woke the app, or
  // arrived before the listener was ready — e.g. during a foreground
  // transition back from the mail app). Guard so whichever wins, the other
  // can't re-process the same link. cancelledRef stops any setState after
  // unmount.
  const handledRef = useRef(false);
  const cancelledRef = useRef(false);

  const handleUrl = useCallback(async (incoming: string, source: string) => {
    if (handledRef.current) return;
    handledRef.current = true;
    console.info(`[auth/callback] handling url from ${source} at ${new Date().toISOString()}:`, incoming);
    const { error: err } = await exchangeCodeFromUrl(incoming);
    if (cancelledRef.current) return;
    if (err) {
      setError(err);
    } else {
      router.replace('/(tabs)');
    }
  }, []);

  // Live listener path: fires whenever the OS hands the running app a deep link.
  useEffect(() => {
    console.info(`[auth/callback] effect fired at ${new Date().toISOString()}, url=`, url);
    if (!url) return;
    void handleUrl(url, 'useURL');
  }, [url, handleUrl]);

  // Fallback path: if the link arrived before the useURL() listener caught it
  // (cold launch, or a foreground transition race), getInitialURL() still has
  // it. Runs once on mount.
  useEffect(() => {
    (async () => {
      const initial = await Linking.getInitialURL();
      console.info(`[auth/callback] getInitialURL at ${new Date().toISOString()}:`, initial);
      if (initial) void handleUrl(initial, 'getInitialURL');
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [handleUrl]);

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
