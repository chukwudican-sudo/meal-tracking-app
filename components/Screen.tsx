import { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/theme';

type Edge = 'top' | 'bottom' | 'left' | 'right';

interface ScreenProps {
  children: ReactNode;
  /**
   * Which device edges to inset against. Defaults to top + bottom, which is
   * what every full-screen modal page in this app needs (clear the status
   * bar / notch up top, clear the home indicator / nav bar at the bottom).
   * Tab pages should pass `edges={['top']}` only, since the tab bar already
   * sits above the bottom safe area.
   */
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  /** Override the default app background color. */
  backgroundColor?: string;
}

/**
 * Reliable replacement for `<SafeAreaView edges={...}>` from
 * react-native-safe-area-context.
 *
 * `SafeAreaView` from that package can intermittently render with zero
 * insets during navigation transitions and on screens presented as
 * `fullScreenModal`, causing titles and headers to slide under the notch /
 * Dynamic Island. Reading from `useSafeAreaInsets()` directly and applying
 * padding manually is the bulletproof pattern, recommended in the package's
 * own docs for screens that need stable insets.
 *
 * Drop-in replacement: just import `Screen` instead of `SafeAreaView` and
 * pass the same `edges` prop.
 */
export function Screen({ children, edges = ['top', 'bottom'], style, backgroundColor }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
    paddingLeft: edges.includes('left') ? insets.left : 0,
    paddingRight: edges.includes('right') ? insets.right : 0,
  };
  return (
    <View
      style={[
        { flex: 1, backgroundColor: backgroundColor ?? COLORS.bg },
        padding,
        style,
      ]}
    >
      {children}
    </View>
  );
}
