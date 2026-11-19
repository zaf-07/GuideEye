import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Display, GlassCard, Progress, Screen, Text } from '../../components';
import { TOTAL_STEPS, useDraft } from './draft';
import { useProfile } from '../../state/ProfileContext';
import { hasHearingTrack, hasVisionTrack, IMPAIRMENT_LABEL } from '../../state/profile';
import { announce } from '../../lib/announce';
import { colors, spacing } from '../../theme/tokens';

/**
 * Step 4: confirm, then commit. Committing flips `onboarded` in the profile
 * store, which swaps the root navigator for the tailored home.
 */
export function ReadyScreen() {
  const { draft } = useDraft();
  const { completeOnboarding } = useProfile();

  useEffect(() => {
    announce(draft, 'Setup complete. Review your choices, then tap Open GuideEye.');
  }, [draft]);

  const lines: string[] = [];
  draft.impairments.forEach((i) => lines.push(IMPAIRMENT_LABEL[i]));
  if (hasVisionTrack(draft) && draft.visionLevel) {
    lines.push(`${draft.guidance === 'concise' ? 'Concise' : 'Detailed'} narration at ${draft.speechRate}× speed`);
  }
  if (hasHearingTrack(draft) && draft.signLanguage) {
    lines.push(`${draft.signLanguage === 'other' ? 'Custom' : draft.signLanguage} sign language bridge`);
    lines.push(`Replies shown as ${draft.replyFormat === 'both' ? 'text and sign avatar' : draft.replyFormat}`);
  }
  if (draft.haptics) lines.push('Haptic proximity feedback on');
  if (draft.captions) lines.push('Large captions on');

  return (
    <Screen
      footer={
        <Button
          label="Open GuideEye"
          tone="lime"
          onPress={async () => {
            await completeOnboarding(draft);
            router.replace('/');
          }}
          hint="Finishes setup and opens your home screen."
        />
      }
    >
      <Progress step={4} total={TOTAL_STEPS} />
      <View style={styles.mark}>
        <Ionicons name="checkmark" size={38} color={colors.onLight} />
      </View>
      <Display lead="You're all" accent="set up" />
      <Text variant="body" muted style={{ marginBottom: spacing.md }}>
        Your home screen is built around these answers.
      </Text>

      <GlassCard>
        {lines.map((l) => (
          <View key={l} style={styles.row}>
            <Ionicons name="ellipse" size={8} color={colors.lime} />
            <Text variant="body" style={{ flex: 1 }}>
              {l}
            </Text>
          </View>
        ))}
      </GlassCard>

      <Text variant="caption" faint style={{ marginTop: spacing.md }}>
        Settings → Accessibility profile changes any of this, any time.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
});
