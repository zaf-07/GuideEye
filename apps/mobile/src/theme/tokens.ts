/**
 * GuideEye design tokens.
 * Visual language: deep forest-green field, soft dark glass cards, a single
 * white pill as the primary action, and an italic serif accent word inside
 * otherwise geometric sans headlines.
 */
import { Platform } from 'react-native';

export const colors = {
  // Backgrounds
  canvas: '#16271F',
  canvasDeep: '#07110F',
  canvasTop: '#2E4A3A',
  ink: '#07110F',

  // Glass surfaces
  glass: 'rgba(255,255,255,0.09)',
  glassStrong: 'rgba(255,255,255,0.16)',
  glassBorder: 'rgba(255,255,255,0.14)',
  scrim: 'rgba(8,12,9,0.55)',

  // Text
  text: '#FFFFFF',
  textMuted: '#C3CDC2',
  textFaint: '#8E9B8D',
  onLight: '#16211A',

  // Accents
  lime: '#B7FF56',
  limeDeep: '#8FD02F',
  pillLight: '#F3F2EC',
  amber: '#FFD043',
  danger: '#FF6B5E',
  info: '#8FD3FF',
} as const;

export const radius = {
  sm: 14,
  md: 22,
  lg: 28,
  xl: 34,
  pill: 999,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  xxl: 42,
} as const;

/**
 * Two families only: a geometric sans for structure, a serif used *in italic*
 * for the accent word of a headline (see the reference design).
 */
export const fonts = {
  sans: Platform.select({ ios: 'SF Pro Display', default: 'sans-serif' }) as string,
  sansFallback: Platform.select({ ios: 'System', default: 'sans-serif' }) as string,
  serif: Platform.select({ ios: 'Times New Roman', default: 'serif' }) as string,
} as const;

export const type = {
  display: { fontSize: 42, lineHeight: 46, fontWeight: '700' as const, letterSpacing: -1.2 },
  title: { fontSize: 30, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.7 },
  section: { fontSize: 21, lineHeight: 26, fontWeight: '600' as const, letterSpacing: -0.3 },
  body: { fontSize: 17, lineHeight: 25, fontWeight: '400' as const },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
} as const;

/** Minimum interactive size. Deliberately well above the 44pt HIG floor. */
export const HIT = 64;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;
