import React from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/tokens';

/**
 * A liquid-glass surface: a real backdrop blur where the platform can do one,
 * with the light catching along the top edge the way it does on frosted glass.
 *
 * `expo-blur` is optional, exactly like the other native modules here. In Expo
 * Go, in a build where it is not linked, or on web, the require throws and the
 * surface falls back to a layered translucent fill. It looks flatter; it never
 * crashes, and the tab bar stays readable either way.
 */
type BlurComponent = React.ComponentType<{
  intensity?: number;
  tint?: string;
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
}>;

let BlurView: BlurComponent | null = null;
try {
  BlurView = (require('expo-blur') as { BlurView: BlurComponent }).BlurView ?? null;
} catch {
  BlurView = null;
}

export const hasBackdropBlur = BlurView !== null && Platform.OS !== 'web';

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

interface Props {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** 0–100. Higher is frostier; iOS reads heavier than Android at the same value. */
  intensity?: number;
  /** Rounds the blur layer with the surface so the corners stay clean. */
  radius?: number;
}

export function LiquidGlass({ children, style, intensity = 40, radius = 28 }: Props) {
  return (
    <View style={[styles.root, { borderRadius: radius }, style]}>
      {hasBackdropBlur && BlurView ? (
        <BlurView
          intensity={intensity}
          tint="dark"
          style={[FILL, { borderRadius: radius }]}
        />
      ) : (
        <View style={[FILL, styles.opaqueFallback, { borderRadius: radius }]} />
      )}

      {/* The sheen: brighter at the top edge, fading out by the middle. */}
      <LinearGradient
        colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0)']}
        locations={[0, 0.45, 1]}
        style={[FILL, { borderRadius: radius }]}
        pointerEvents="none"
      />

      <View style={[styles.hairline, { borderRadius: radius }]} pointerEvents="none" />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: 'rgba(12,22,18,0.55)' },
  // Without a blur behind it the surface has to carry its own weight, or the
  // content behind it shows through as noise.
  opaqueFallback: { backgroundColor: 'rgba(10,20,16,0.92)' },
  hairline: {
    ...FILL,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
  },
  content: { flex: 1 },
});
