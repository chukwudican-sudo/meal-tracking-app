// The one page header and back button for the whole app (Nov 8). Before this,
// ~25 screens each drew their own: a "←" text glyph on some, Ionicons arrows
// of three sizes on others, and different heights and paddings. Every page
// now uses PageHeader (back · centred title · optional right action), or —
// where a header carries extra content — BackButton inside it.

import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@/constants/theme';

export const HEADER_HEIGHT = 52;
// Back button / right slot width: a 40pt square (Apple's minimum is 44 with
// the hit slop added on top).
export const HEADER_SIDE = 40;

interface BackButtonProps {
  // Defaults to router.back(); pages with a fallback or unsaved-changes
  // prompt pass their own.
  onPress?: () => void;
  // 'close' (✕) for leaving an edit mode rather than a page.
  icon?: 'back' | 'close';
  style?: StyleProp<ViewStyle>;
}

export function BackButton({ onPress, icon = 'back', style }: BackButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress ?? (() => router.back())}
      style={[styles.side, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={icon === 'close' ? 'Close' : 'Back'}
    >
      <Ionicons name={icon === 'close' ? 'close' : 'chevron-back'} size={26} color={COLORS.text} />
    </TouchableOpacity>
  );
}

interface PageHeaderProps {
  title?: ReactNode;
  // Omit for router.back(); null hides the button (a first step, say) and
  // keeps its space so the title stays centred.
  onBack?: (() => void) | null;
  backIcon?: 'back' | 'close';
  // Right-hand action (bookmark, Save, menu…). Keep it ~40pt wide, or pass
  // `wideSides` so the title stays centred with a wider control.
  right?: ReactNode;
  wideSides?: boolean;
  // The title's own centre content, replacing `title` (e.g. a logo + name).
  center?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function PageHeader({ title, onBack, backIcon, right, wideSides, center, style }: PageHeaderProps) {
  const sideStyle = wideSides ? styles.sideWide : styles.side;
  return (
    <View style={[styles.header, style]}>
      <View style={[sideStyle, styles.left]}>
        {onBack !== null ? <BackButton onPress={onBack ?? undefined} icon={backIcon} /> : null}
      </View>
      <View style={styles.center}>
        {center ?? (
          typeof title === 'string' || typeof title === 'number' ? (
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
          ) : (
            title
          )
        )}
      </View>
      <View style={[sideStyle, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  side: { width: HEADER_SIDE, height: HEADER_SIDE, alignItems: 'center', justifyContent: 'center' },
  sideWide: { width: 84, height: HEADER_SIDE, justifyContent: 'center' },
  left: { alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  title: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
});
