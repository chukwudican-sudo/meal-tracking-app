import { Platform } from 'react-native';
import { DarkTheme } from '@react-navigation/native';

// ─── App colour palette (dark-only) ──────────────────────────────────────────

export const COLORS = {
  // Backgrounds
  bg:       '#1C1C1E',   // main screen background
  card:     '#2C2C2E',   // card / surface background
  elevated: '#3A3A3C',   // modals, inputs, elevated surfaces

  // Borders & separators
  border:   '#3A3A3C',

  // Text
  text:          '#FFFFFF',
  textSecondary: '#8E8E93',
  textMuted:     '#48484A',

  // Accents
  green:  '#34C759',   // completed / success
  red:    '#FF3B30',   // missed / error
  blue:   '#4F8EF7',   // primary action / progress
  orange: '#FF9500',   // fats / warning
  purple: '#BF5AF2',   // optional nutrient accent
} as const;

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
