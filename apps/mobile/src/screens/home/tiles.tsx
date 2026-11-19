import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text } from '../../components';
import { colors, radius, shadow, spacing } from '../../theme/tokens';

export interface Action {
  key: string;
  title: string;
  accent?: string;
  blurb: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Working engine route. Omit to fall through to the roadmap screen. */
  route?: string;
  hint?: string;
}

/**
 * The hero action. Deliberately enormous: a blind user should be able to
 * start scene description by tapping anywhere in the top half of the screen.
 */
export function PrimaryTile({ action, onPress }: { action: Action; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${action.title}. ${action.blurb}`}
      accessibilityHint={action.hint}
      style={({ pressed }) => [styles.primary, shadow.card, pressed && styles.pressed]}
    >
      <View style={styles.primaryIcon}>
        <Ionicons name={action.icon} size={30} color={colors.onLight} />
      </View>
      <Text variant="title" color={colors.onLight}>
        {action.title}
      </Text>
      <Text variant="body" color="rgba(22,33,26,0.72)">
        {action.blurb}
      </Text>
      <View style={styles.primaryCta}>
        <Text variant="label" color={colors.onLight}>
          Start now
        </Text>
        <Ionicons name="arrow-forward" size={18} color={colors.onLight} />
      </View>
    </Pressable>
  );
}

export function ActionTile({ action, onPress }: { action: Action; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${action.title}. ${action.blurb}`}
      accessibilityHint={action.hint}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={styles.tileIcon}>
        <Ionicons name={action.icon} size={24} color={colors.lime} />
      </View>
      <View style={{ gap: 4 }}>
        <Text variant="section">{action.title}</Text>
        <Text variant="caption" muted>
          {action.blurb}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: colors.lime,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    minHeight: 220,
    justifyContent: 'center',
  },
  primaryIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 150,
    justifyContent: 'space-between',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(185,240,91,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
