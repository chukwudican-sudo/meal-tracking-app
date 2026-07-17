import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { COLORS } from '@/constants/theme';

interface Props {
  // 0..1 fill fraction.
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  // Optional content rendered in the center (e.g. an emoji or value).
  children?: React.ReactNode;
}

export function ProgressRing({
  progress,
  size = 64,
  strokeWidth = 6,
  color = COLORS.green,
  trackColor = COLORS.border,
  children,
}: Props) {
  const clamped = Math.max(0, Math.min(1, isFinite(progress) ? progress : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);
  const center = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      {children != null ? (
        typeof children === 'string' || typeof children === 'number'
          ? <Text style={styles.centerText}>{children}</Text>
          : children
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centerText: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
});
