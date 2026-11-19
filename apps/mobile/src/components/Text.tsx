import React from 'react';
import { StyleSheet, Text as RNText, TextProps, TextStyle } from 'react-native';
import { colors, fonts, type as t } from '../theme/tokens';

type Variant = keyof typeof t;

interface Props extends TextProps {
  variant?: Variant;
  muted?: boolean;
  faint?: boolean;
  color?: string;
  center?: boolean;
  style?: TextStyle | TextStyle[];
}

export function Text({ variant = 'body', muted, faint, color, center, style, ...rest }: Props) {
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={2.4}
      style={[
        t[variant],
        { color: color ?? (faint ? colors.textFaint : muted ? colors.textMuted : colors.text) },
        center && styles.center,
        style,
      ]}
    />
  );
}

/**
 * Headline with the reference design's signature: the last clause set in
 * italic serif. e.g. Display("Rent anything,", "right nearby").
 */
export function Display({
  lead,
  accent,
  style,
}: {
  lead: string;
  accent?: string;
  style?: TextStyle;
}) {
  return (
    <RNText
      accessibilityRole="header"
      maxFontSizeMultiplier={1.8}
      style={[t.display, { color: colors.text }, style]}
    >
      {lead}
      {accent ? (
        <RNText style={styles.accent}>
          {'\n'}
          {accent}
        </RNText>
      ) : null}
    </RNText>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  accent: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontWeight: '400',
    color: colors.textMuted,
  },
});
