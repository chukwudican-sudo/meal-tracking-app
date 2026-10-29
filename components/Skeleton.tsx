import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

// Placeholder bar shown where content will appear while it loads, with a soft
// light band sweeping across (the standard "skeleton" loading pattern). No
// gradient library: the band is a translucent strip. Static when the user has
// Reduce Motion on.
const SWEEP_MS = 1300;
const BAND_WIDTH = 80;

interface Props {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height, radius = 8, style }: Props) {
  const [boxWidth, setBoxWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setReduceMotion(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion || boxWidth === 0) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, boxWidth, x]);

  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-BAND_WIDTH, boxWidth] });

  return (
    <View
      style={[styles.base, { width, height, borderRadius: radius }, style]}
      onLayout={e => setBoxWidth(e.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {!reduceMotion && boxWidth > 0 ? (
        <Animated.View style={[styles.band, { transform: [{ translateX }] }]} />
      ) : null}
    </View>
  );
}

// Fades its children in once when mounted (results replacing a skeleton).
export function FadeIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [opacity]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  base: { backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
  band: { position: 'absolute', top: 0, bottom: 0, width: BAND_WIDTH, backgroundColor: 'rgba(255,255,255,0.08)' },
});
