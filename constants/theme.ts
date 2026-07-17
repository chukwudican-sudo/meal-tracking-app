import { Platform } from 'react-native';
import { DarkTheme } from '@react-navigation/native';

// ─── App colour palette (dark-only) ──────────────────────────────────────────

export const COLORS = {
  // Backgrounds — dark near-black base with translucent-white surfaces layered
  // on top (design-authority mockup: cards/inputs/buttons are white overlays).
  bg:       '#0F0F0F',                  // main screen background
  card:     'rgba(255,255,255,0.04)',   // card / surface background
  elevated: 'rgba(255,255,255,0.08)',   // modals, inputs, elevated surfaces

  // Borders & separators
  border:   'rgba(255,255,255,0.08)',

  // Text
  text:          '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.5)',
  textMuted:     'rgba(255,255,255,0.3)',

  // Accents (kept as 6-digit hex — several styles append alpha, e.g. green+'22')
  green:  '#4ade80',   // completed / success / primary action
  red:    '#f87171',   // missed / error
  blue:   '#60a5fa',   // progress / info
  orange: '#fb923c',   // fats / warning
  purple: '#a78bfa',   // optional nutrient accent
} as const;

// ─── Layout constants ────────────────────────────────────────────────────────

// Generous inset for the bottom of every full-screen page so footers and
// final scroll items are never squeezed against the home indicator. Pair this
// with `edges={['top','bottom']}` on the SafeAreaView; the SafeAreaView pads
// for the device safe area, this constant pads for visual breathing room.
export const SCREEN_BOTTOM_INSET = 24;

// ─── Navigation theme ─────────────────────────────────────────────────────────

export const AppDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: COLORS.bg,
    card:       COLORS.card,
    border:     COLORS.border,
    text:       COLORS.text,
    primary:    COLORS.blue,
    notification: COLORS.red,
  },
};

// ─── Typography ───────────────────────────────────────────────────────────────

export const Fonts = Platform.select({
  ios: {
    sans:    'system-ui',
    serif:   'ui-serif',
    rounded: 'ui-rounded',
    mono:    'ui-monospace',
  },
  default: {
    sans:    'normal',
    serif:   'serif',
    rounded: 'normal',
    mono:    'monospace',
  },
  web: {
    sans:    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    serif:   "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', sans-serif",
    mono:    "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});

// ─── Legacy export (keep existing imports working) ────────────────────────────

export const Colors = {
  light: {
    text:           '#11181C',
    background:     '#fff',
    tint:           '#0a7ea4',
    icon:           '#687076',
    tabIconDefault: '#687076',
    tabIconSelected:'#0a7ea4',
  },
  dark: {
    text:           COLORS.text,
    background:     COLORS.bg,
    tint:           COLORS.blue,
    icon:           COLORS.textSecondary,
    tabIconDefault: COLORS.textSecondary,
    tabIconSelected:COLORS.blue,
  },
};
