import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { colors, HIT, radius, shadow, spacing } from '../theme/tokens';

export function GlassCard({
  children,
  style,
  strong,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  strong?: boolean;
}) {
  return (
    <View style={[styles.card, strong && styles.cardStrong, shadow.card, style]}>{children}</View>
  );
}

interface ChoiceProps {
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
  icon?: React.ReactNode;
  /** Spoken as the VoiceOver hint; keep it a full sentence. */
  hint?: string;
}

/** A large selectable card — the onboarding workhorse. */
export function ChoiceCard({ title, subtitle, selected, onPress, icon, hint }: ChoiceProps) {
  const press = () => {
    Haptics.selectionAsync().catch(() => {});
    onPress();
  };
  return (
    <Pressable
      onPress={press}
      accessibilityRole="radio"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={hint}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <View style={styles.choiceIcon}>{icon}</View> : null}
      <View style={styles.choiceBody}>
        <Text variant="section" color={selected ? colors.onLight : colors.text}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" color={selected ? 'rgba(22,33,26,0.75)' : colors.textMuted}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

/** Small rounded pill used for filters and tags. */
export function Chip({
  label,
  active,
  onPress,
  grow,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  /** Share the row equally with its siblings instead of sizing to the label. */
  grow?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: Boolean(active) }}
      accessibilityLabel={label}
      style={[styles.chip, grow && styles.chipGrow, active && styles.chipActive]}
    >
      <Text variant="label" color={active ? colors.onLight : colors.text}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardStrong: { backgroundColor: colors.glassStrong },
  choice: {
    minHeight: HIT + 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  choiceSelected: { backgroundColor: colors.pillLight, borderColor: colors.pillLight },
  choiceIcon: { width: 40, alignItems: 'center' },
  choiceBody: { flex: 1, gap: 4 },
  radio: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.onLight },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.onLight },
  chip: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  chipGrow: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  chipActive: { backgroundColor: colors.pillLight, borderColor: colors.pillLight },
  pressed: { opacity: 0.85 },
});
