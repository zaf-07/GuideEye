import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, radius, spacing } from '../theme/tokens';

/** Circular glass control — back, notifications, favourite. */
export function RoundButton({
  icon,
  label,
  onPress,
  tone = 'glass',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'glass' | 'lime';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.round,
        tone === 'lime' && styles.roundLime,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Ionicons name={icon} size={24} color={tone === 'lime' ? colors.onLight : colors.text} />
    </Pressable>
  );
}

/**
 * A stored name that already carries its own greeting produced "Hello, Hello,
 * there" on screen. Strip any greeting the name arrives with, so this bar is
 * the only thing that decides how the person is greeted.
 */
function bareName(value: string): string {
  return value.replace(/^\s*(hello|hi|hey)\s*,?\s*/i, '').trim();
}

export function GreetingBar({
  name,
  onSettings,
}: {
  name: string;
  onSettings: () => void;
}) {
  const person = bareName(name) || 'there';
  return (
    <View style={styles.bar}>
      <View style={styles.greet} accessibilityRole="header">
        <View style={styles.avatar}>
          <Ionicons name="person" size={20} color={colors.onLight} />
        </View>
        <Text variant="section" numberOfLines={1} style={styles.greetText}>
          Hello, {person}
        </Text>
      </View>
      <RoundButton icon="settings-outline" label="Settings" onPress={onSettings} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    // A long name used to push the settings button off the screen edge.
    gap: spacing.sm,
  },
  greetText: { flexShrink: 1 },
  greet: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.sm,
    backgroundColor: colors.glass,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  roundLime: { backgroundColor: colors.lime, borderColor: colors.lime },
});
