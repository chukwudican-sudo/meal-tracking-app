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

// Modal sheets / popups must be opaque (COLORS.card is see-through).
export const OPAQUE_SHEET_BG = '#1C1C1C';

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
