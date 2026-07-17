import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { COLORS } from '@/constants/theme';

interface SliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

// Minimal draggable horizontal slider (no external dependency). Functional,
// unpolished — design pass comes later.
export function Slider({ min, max, step, value, onChange }: SliderProps) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const THUMB = 28;

  const clampToStep = (raw: number) => {
    const clamped = Math.max(min, Math.min(max, raw));
    const snapped = Math.round((clamped - min) / step) * step + min;
    // Avoid floating point drift like 0.7500000001.
    return Math.round(snapped * 100) / 100;
  };

  const fromX = (x: number) => {
    const w = widthRef.current || 1;
    const ratio = Math.max(0, Math.min(1, (x - THUMB / 2) / (w - THUMB)));
    return clampToStep(min + ratio * (max - min));
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => onChange(fromX(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => onChange(fromX(e.nativeEvent.locationX)),
    }),
  ).current;

  const pct = max > min ? (value - min) / (max - min) : 0;
  const trackW = Math.max(0, width - THUMB);
  const thumbLeft = pct * trackW;

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setWidth(w);
        widthRef.current = w;
      }}
      {...responder.panHandlers}
    >
      <View style={styles.track} />
      <View style={[styles.fill, { width: thumbLeft + THUMB / 2 }]} />
      <View style={[styles.thumb, { left: thumbLeft }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 28, justifyContent: 'center' },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  fill: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.green,
  },
  thumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.green,
    borderWidth: 3,
    borderColor: COLORS.bg,
  },
});
