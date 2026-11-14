// App-wide safety net (Nov 14). app/_layout.tsx exports this as expo-router's
// ErrorBoundary: if any screen throws while rendering, the user sees this
// instead of the app closing, and the crash is reported (React 19 / RN 0.81
// send render errors past Sentry's global handler, so without this they were
// neither caught nor reported). Self-contained on purpose: it sits outside
// every provider in the root layout, so it uses only plain RN + theme colors.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ErrorBoundaryProps } from 'expo-router';

import { COLORS } from '@/constants/theme';
import { reportError } from '@/lib/monitoring';

export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    reportError(error, 'render');
  }, [error]);

  const onRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Ionicons name="alert-circle-outline" size={44} color={COLORS.textSecondary} />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>
        The app hit an unexpected problem. Your meals and settings are safe. Tap below to try
        again — if it keeps happening, close and reopen the app.
      </Text>
      <TouchableOpacity
        style={[styles.button, retrying && styles.buttonBusy]}
        onPress={onRetry}
        disabled={retrying}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>{retrying ? 'Trying…' : 'Try again'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: { color: COLORS.text, fontSize: 20, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  body: {
    color: COLORS.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
    textAlign: 'center',
  },
  button: {
    marginTop: 28,
    backgroundColor: COLORS.green,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: '#0E1A12', fontSize: 16, fontWeight: '700' },
});
