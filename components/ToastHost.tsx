import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';
import { useToastStore } from '@/store/useToastStore';

// Lift above the bottom tab bar (height 60 + paddingBottom 4) so it never
// covers Today / Plan / Library / Profile.
const TAB_BAR_OFFSET = 64;

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const active = useToastStore(s => s.active);
  const fade = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(20)).current;

  // Re-trigger entrance animation whenever a new toast id arrives.
  useEffect(() => {
    if (active) {
      fade.setValue(0);
      translate.setValue(20);
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 20,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [active, fade, translate]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.overlay,
        {
          bottom: TAB_BAR_OFFSET + Math.max(insets.bottom, 0),
          opacity: fade,
          transform: [{ translateY: translate }],
        },
      ]}
    >
      <View style={styles.toast}>
        <Text style={styles.message} numberOfLines={2}>
          {active.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    alignItems: 'center',
    zIndex: 9998,
    elevation: 28,
  },
  toast: {
    backgroundColor: '#171719',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    minWidth: 160,
  },
  message: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
