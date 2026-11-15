/**
 * Lucrari Design System — Theme Tokens
 * Palette: "Muted Plum & Warm Charcoal" (Sakin Mürdüm & Sıcak Kömür)
 *
 * Complete Light & Dark Mode specification with subtle borders,
 * muted sage positives, dusty rose negatives, and soft plum accents.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // Backgrounds & Surfaces
    background: '#F8F6F7',        // Warm Ivory
    backgroundSecondary: '#F2EEF0', // Soft Rose Gray
    surface: '#FFFFFF',           // Soft White
    surfaceElevated: '#FCFAFB',   // Warm White Elevated
    surfaceHighlight: '#EEE6EA',  // Primary soft bg / Pale Plum
    border: '#E8E1E4',            // Soft Mauve Gray Border
    borderSubtle: '#EFEAEC',      // Divider Light Gray
    disabledBg: '#EEECEE',
    disabledText: '#AAA4A7',

    // Typography
    text: '#2B2729',              // Deep Charcoal
    textSecondary: '#7E757A',     // Warm Gray
    textMuted: '#A39A9F',         // Tertiary Soft Gray

    // Brand & CTA (Muted Plum)
    tint: '#725766',              // Primary / CTA Muted Plum
    tintHover: '#654B59',         // Deep Plum
    tintPressed: '#59434F',       // Dark Plum
    tintMuted: '#EEE6EA',         // Pale Plum Soft Bg
    tintBorder: '#D8CAD1',

    // Financial Semantic Statuses
    positive: '#5F806F',          // Muted Sage
    positiveBg: '#E7EFEA',        // Positive Soft Bg
    positiveBorder: 'rgba(95, 128, 111, 0.30)',
    negative: '#B96267',          // Dusty Red
    negativeBg: '#F5E7E8',        // Negative Soft Bg
    negativeBorder: 'rgba(185, 98, 103, 0.30)',
    warning: '#B98B4D',           // Muted Gold
    warningBg: '#F5EEE2',         // Warning Soft Bg
    warningBorder: 'rgba(185, 139, 77, 0.30)',
    info: '#667B96',              // Dusty Blue
    infoBg: '#E8EEF5',
    infoBorder: 'rgba(102, 123, 150, 0.30)',

    // Navigation
    tabBarBackground: '#FFFFFF',
    tabBarBorder: '#E8E1E4',
    tabIconDefault: '#7E757A',
    tabIconSelected: '#725766',
    icon: '#7E757A',
  },
  dark: {
    // Backgrounds & Surfaces
    background: '#171416',        // Deep Warm Charcoal
    backgroundSecondary: '#1D191C', // Dark Plum Gray
    surface: '#221E21',           // Charcoal Plum
    surfaceElevated: '#292328',   // Soft Elevated
    surfaceHighlight: '#342831',  // Primary soft bg / Dark Plum Tint
    border: '#3A3237',            // Dark Mauve Border
    borderSubtle: '#302A2E',      // Subtle Divider
    disabledBg: '#292529',
    disabledText: '#686166',

    // Typography
    text: '#F3EFF1',              // Warm White
    textSecondary: '#B5AEB2',     // Soft Gray
    textMuted: '#837B80',         // Tertiary Muted Gray

    // Brand & CTA (Soft Plum)
    tint: '#A98699',              // Primary / CTA Soft Plum
    tintHover: '#B894A7',         // Light Plum
    tintPressed: '#967487',       // Muted Plum
    tintMuted: '#342831',         // Dark Plum Tint Soft Bg
    tintBorder: 'rgba(169, 134, 153, 0.35)',

    // Financial Semantic Statuses
    positive: '#79A08C',          // Soft Sage
    positiveBg: '#203129',        // Positive Soft Bg
    positiveBorder: 'rgba(121, 160, 140, 0.35)',
    negative: '#D17D82',          // Soft Rose Red
    negativeBg: '#3B2528',        // Negative Soft Bg
    negativeBorder: 'rgba(209, 125, 130, 0.35)',
    warning: '#D0A567',           // Soft Gold
    warningBg: '#392F22',         // Warning Soft Bg
    warningBorder: 'rgba(208, 165, 103, 0.35)',
    info: '#8499B5',              // Soft Blue
    infoBg: '#222B38',
    infoBorder: 'rgba(132, 153, 181, 0.35)',

    // Navigation
    tabBarBackground: '#1D191C',
    tabBarBorder: '#302A2E',
    tabIconDefault: '#837B80',
    tabIconSelected: '#A98699',
    icon: '#B5AEB2',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
