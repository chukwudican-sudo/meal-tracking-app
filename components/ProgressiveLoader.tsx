import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/theme';

interface ProgressiveLoaderProps {
  // Ordered status lines, cycled continuously in a loop for as long as this
  // component stays mounted.
  messages: string[];
  // Fixed cadence between lines (ms). Deliberately NOT paced against an
  // assumed total wait — a fast response (e.g. 2-3s) still shows real
  // cycling instead of freezing on the first line, and a slow one keeps
  // cycling for its whole duration instead of going static after the last
  // line. Defaults to the middle of the intended 1.2-1.5s range.
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 1350;

// Shared long-wait loader for AI calls that routinely run 2-25s (duration is
// unpredictable, so this can't pace itself against a fixed total). Replaces
// the static "spinner + one fixed line" pattern on those screens with an
// evolving, looping sequence of status lines. Modelled on onboarding.tsx's
// ProcessingStep, minus the progress ring (there's no real percentage to show
// for an indeterminate network wait). Parents keep full control of when it
// appears/disappears by conditionally rendering it around their loading flag.
export function ProgressiveLoader({ messages, intervalMs = DEFAULT_INTERVAL_MS }: ProgressiveLoaderProps) {
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (messages.length <= 1) return;
    const id = setInterval(() => {
      // Fade the current line out, swap to the next one while invisible, then
      // fade back in — a gentle crossfade rather than a hard text swap.
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
        if (!mountedRef.current) return;
        setIndex(prev => (prev + 1) % messages.length);
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [messages.length, intervalMs, opacity]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={COLORS.green} />
      <Animated.Text style={[styles.text, { opacity }]}>
        {messages[index % messages.length]}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  text: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
