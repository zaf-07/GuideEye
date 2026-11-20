import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { colors, HIT, radius, spacing } from '../theme/tokens';

type Tone = 'primary' | 'glass' | 'lime' | 'ghost';

interface Props {
  label: string;
  onPress: () => void;
  tone?: Tone;
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

/**
 * Full-width pill. Always at least 64pt tall so it is reachable without
 * precision, and always carries an explicit accessibility label.
 */
export function Button({ label, onPress, tone = 'primary', hint, disabled, busy, icon, style }: Props) {
  const press = () => {
    if (disabled || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress();
  };

  const dark = tone === 'primary' || tone === 'lime';
  return (
    <Pressable
      onPress={press}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.base,
        tone === 'primary' && styles.primary,
        tone === 'lime' && styles.lime,
        tone === 'glass' && styles.glass,
        tone === 'ghost' && styles.ghost,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={dark ? colors.onLight : colors.text} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text variant="section" color={dark ? colors.onLight : colors.text} center style={styles.label}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: HIT + 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // A long label wraps centred inside the pill instead of running to its edge.
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, maxWidth: '100%' },
  label: { flexShrink: 1 },
  primary: { backgroundColor: colors.pillLight },
  lime: { backgroundColor: colors.lime },
  glass: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
});
