import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Button, Display, GlassCard, Screen, Text } from '../../components';
import { colors, radius, spacing } from '../../theme/tokens';

const BENEFITS = [
  {
    icon: <Ionicons name="eye-outline" size={25} color={colors.lime} />,
    title: 'Understand what is around you',
    detail: 'Camera guidance, reading and walking support for blind and low-vision users.',
  },
  {
    icon: <MaterialCommunityIcons name="hand-wave-outline" size={25} color={colors.lime} />,
    title: 'Communicate your way',
    detail: 'Large captions, speech and supported signing for deaf and hearing conversations.',
  },
  {
    icon: <Ionicons name="shield-checkmark-outline" size={25} color={colors.lime} />,
    title: 'Start without an account',
    detail: 'Your accessibility profile is saved on this iPhone and can be changed later.',
  },
];

/** A calm first launch: one decision per screen and no registration wall. */
export function WelcomeScreen() {
  return (
    <Screen
      footer={
        <Button
          label="Set up GuideEye"
          tone="lime"
          onPress={() => router.push('/onboarding/impairment')}
          hint="Starts the four-step accessibility setup."
        />
      }
    >
      <View style={styles.brand} accessible accessibilityRole="header">
        <View style={styles.mark}>
          <Ionicons name="eye" size={34} color={colors.onLight} />
        </View>
        <Text variant="label" style={styles.wordmark}>GUIDEEYE</Text>
      </View>

      <View style={styles.hero}>
        <Display lead="One app," accent="built around you" />
        <Text variant="body" muted>
          Choose how you use GuideEye once. The home screen, voice, captions and controls will adapt automatically.
        </Text>
      </View>

      <View style={styles.list}>
        {BENEFITS.map((benefit) => (
          <GlassCard key={benefit.title} style={styles.card}>
            <View style={styles.icon}>{benefit.icon}</View>
            <View style={styles.copy}>
              <Text variant="section">{benefit.title}</Text>
              <Text variant="body" muted>{benefit.detail}</Text>
            </View>
          </GlassCard>
        ))}
      </View>

      <Text variant="caption" faint center>
        No registration · about two minutes · all choices can be changed later
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  mark: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { letterSpacing: 2.4 },
  hero: { gap: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.sm },
  list: { gap: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: 'rgba(183,255,86,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 3 },
});
