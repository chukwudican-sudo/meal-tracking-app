import { useEffect, useRef } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { COLORS } from '@/constants/theme';

export interface WheelItem<T = string> {
  label: string;
  value: T;
}

interface WheelPickerProps<T> {
  items: WheelItem<T>[];
  selectedIndex: number;
  onIndexChange: (index: number) => void;
  itemHeight?: number;
  visibleCount?: number; // odd number of rows visible
  width?: number | string;
}

// A lightweight iOS-style scroll wheel built on a snapping ScrollView. Not
// pixel-perfect to UIPickerView, but functional: the centered row is the
// selected value, and scrolling snaps to each item.
export function WheelPicker<T>({
  items,
  selectedIndex,
  onIndexChange,
  itemHeight = 40,
  visibleCount = 5,
  width = 90,
}: WheelPickerProps<T>) {
  const ref = useRef<ScrollView>(null);
  const height = itemHeight * visibleCount;
  const padding = (height - itemHeight) / 2;

  // Keep the wheel aligned when the selected index changes externally.
  useEffect(() => {
    ref.current?.scrollTo({ y: selectedIndex * itemHeight, animated: false });
  }, [selectedIndex, itemHeight]);

  const handleEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(y / itemHeight)));
    if (idx !== selectedIndex) onIndexChange(idx);
  };

  return (
    <View style={[styles.wrap, { height, width: width as any }]}>
      {/* Center selection band */}
      <View
        pointerEvents="none"
        style={[styles.band, { top: padding, height: itemHeight }]}
      />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: padding }}
        onMomentumScrollEnd={handleEnd}
        onScrollEndDrag={handleEnd}
      >
        {items.map((item, i) => (
          <View key={`${item.label}-${i}`} style={[styles.item, { height: itemHeight }]}>
            <Text
              style={[styles.itemText, i === selectedIndex && styles.itemTextActive]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
  },
  item: { alignItems: 'center', justifyContent: 'center' },
  itemText: { color: 'rgba(255,255,255,0.4)', fontSize: 18 },
  itemTextActive: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
});
