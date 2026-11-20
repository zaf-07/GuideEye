import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Button, ChoiceCard, Chip, Display, GlassCard, Progress, Screen, Text } from '../../components';
import { TOTAL_STEPS, useDraft } from './draft';
import { VisionLevel } from '../../state/profile';
import { colors, spacing } from '../../theme/tokens';
import { announce } from '../../lib/announce';

const LEVELS: { id: VisionLevel; title: string; subtitle: string }[] = [
  { id: 'low_vision', title: 'Low vision', subtitle: 'I see shapes, contrast and large text' },
  { id: 'legally_blind', title: 'Legally blind', subtitle: 'I have some usable sight, mostly central or peripheral loss' },
  { id: 'totally_blind', title: 'Totally blind', subtitle: 'I rely entirely on audio and touch' },
];

/** Step 2 for the vision track: how much sight, and how much talking. */
export function VisionSetupScreen() {
  const { draft, set } = useDraft();

  return (
    <Screen
      footer={
        <Button
          label="Continue"
          disabled={!draft.visionLevel}
          onPress={() => router.push('/onboarding/permissions')}
        />
      }
    >
      <Progress step={2} total={TOTAL_STEPS} />
      <Display lead="How much" accent="do you see?" />
      <Text variant="body" muted style={{ marginBottom: spacing.md }}>
        This tunes how detailed the scene descriptions are and how early you get
        warned about obstacles.
      </Text>

      <View style={{ gap: spacing.sm }}>
        {LEVELS.map((l) => (
          <ChoiceCard
            key={l.id}
            title={l.title}
            subtitle={l.subtitle}
            selected={draft.visionLevel === l.id}
            onPress={() => set({ visionLevel: l.id })}
          />
        ))}
      </View>

      <GlassCard style={{ marginTop: spacing.md }}>
        <Text variant="section">Narration style</Text>
        <View style={styles.chips}>
          <Chip
            label="Concise"
            active={draft.guidance === 'concise'}
            onPress={() => set({ guidance: 'concise' })}
          />
          <Chip
            label="Detailed"
            active={draft.guidance === 'detailed'}
            onPress={() => set({ guidance: 'detailed' })}
          />
        </View>
        <Text variant="caption" faint>
          {draft.guidance === 'concise'
            ? '"Door ahead, slightly left."'
            : '"A glass door is ahead on your left; the handle appears to be on the right side."'}
        </Text>
      </GlassCard>

      <GlassCard>
        <Text variant="section">Speaking speed</Text>
        <View style={styles.chips}>
          {[0.8, 1, 1.4, 1.8].map((r) => (
            <Chip
              key={r}
              label={`${r}×`}
              active={draft.speechRate === r}
              onPress={() => {
                set({ speechRate: r });
                announce({ ...draft, speechRate: r }, `Speaking at ${r} times speed.`);
              }}
            />
          ))}
        </View>
        <Text variant="caption" faint>
          Tap one to hear it. Experienced screen reader users often prefer 1.4× or faster.
        </Text>
      </GlassCard>

      <GlassCard>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="section">Haptic proximity</Text>
            <Text variant="caption" faint>
              The phone pulses faster as you get closer to something.
            </Text>
          </View>
          <Switch
            value={draft.haptics}
            onValueChange={(v) => set({ haptics: v })}
            trackColor={{ true: colors.lime, false: 'rgba(255,255,255,0.2)' }}
            accessibilityLabel="Haptic proximity feedback"
          />
        </View>
      </GlassCard>

      <GlassCard>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="section">Voice control</Text>
            <Text variant="caption" faint>
              The microphone stays on while GuideEye is open. Say “Guide”, then what you need, from any screen.
              Turn it off to use buttons only.
            </Text>
          </View>
          <Switch
            value={draft.voiceControl !== false}
            onValueChange={(v) => {
              set({ voiceControl: v });
              announce({ ...draft, voiceControl: v }, v ? 'Voice control on.' : 'Voice control off.');
            }}
            trackColor={{ true: colors.lime, false: 'rgba(255,255,255,0.2)' }}
            accessibilityLabel="Voice control"
          />
        </View>
      </GlassCard>

      <GlassCard>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="section">Full permission</Text>
            <Text variant="caption" faint>
              GuideEye acts as soon as you ask: it opens screens, starts directions, calls and messages your
              contacts without asking “are you sure?”. Paying always waits for your yes.
            </Text>
          </View>
          <Switch
            value={Boolean(draft.fullPermission)}
            onValueChange={(v) => {
              set({ fullPermission: v });
              announce(
                { ...draft, fullPermission: v },
                v ? 'Full permission on. I will call and message without asking first. Payments still need your yes.' : 'Full permission off. I will ask before I call or message.',
              );
            }}
            trackColor={{ true: colors.lime, false: 'rgba(255,255,255,0.2)' }}
            accessibilityLabel="Full permission"
          />
        </View>
      </GlassCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
