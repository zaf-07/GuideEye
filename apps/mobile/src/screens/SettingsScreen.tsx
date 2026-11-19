import React from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, Display, GlassCard, RoundButton, Screen, Text } from '../components';
import { useProfile } from '../state/ProfileContext';
import { hasHearingTrack, hasVisionTrack, IMPAIRMENT_LABEL } from '../state/profile';
import { colors, spacing } from '../theme/tokens';

function Row({
  title,
  caption,
  value,
  onChange,
}: {
  title: string;
  caption: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="section">{title}</Text>
        <Text variant="caption" faint>
          {caption}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.lime, false: 'rgba(255,255,255,0.2)' }}
        accessibilityLabel={title}
      />
    </View>
  );
}

export function SettingsScreen() {
  const { profile, patch, restartOnboarding } = useProfile();
  const vision = hasVisionTrack(profile);
  const hearing = hasHearingTrack(profile);

  const changeProfile = () =>
    Alert.alert(
      'Change your accessibility profile?',
      'You will go back through setup. The app rebuilds around your new answers, and nothing you have saved is deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change', onPress: async () => { await restartOnboarding(); router.replace('/onboarding/impairment'); } },
      ],
    );

  return (
    <Screen underTabBar>
      <View style={styles.bar}>
        <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
      </View>

      <Display lead="Settings" accent="and profile" />

      <GlassCard style={{ marginTop: spacing.md }}>
        <Text variant="caption" faint>
          ACCESSIBILITY PROFILE
        </Text>
        <Text variant="section">
          {profile.impairments.map((i) => IMPAIRMENT_LABEL[i]).join(' · ') || 'Not set'}
        </Text>
        <Text variant="body" muted>
          {vision && profile.visionLevel ? `Vision: ${profile.visionLevel.replace(/_/g, ' ')}. ` : ''}
          {hearing && profile.hearingLevel ? `Hearing: ${profile.hearingLevel.replace(/_/g, ' ')}. ` : ''}
          {hearing && profile.signLanguage ? `Signing in ${profile.signLanguage}.` : ''}
        </Text>
        <Button
          label="Change my profile"
          tone="glass"
          onPress={changeProfile}
          hint="Runs setup again so the app can rebuild around a different profile."
          style={{ marginTop: spacing.sm }}
          icon={<Ionicons name="repeat-outline" size={20} color={colors.text} />}
        />
      </GlassCard>

      {vision ? (
        <GlassCard>
          <Text variant="section">Narration</Text>
          <View style={styles.chips}>
            <Chip label="Concise" active={profile.guidance === 'concise'} onPress={() => patch({ guidance: 'concise' })} />
            <Chip label="Detailed" active={profile.guidance === 'detailed'} onPress={() => patch({ guidance: 'detailed' })} />
          </View>
          <View style={styles.chips}>
            {[0.8, 1, 1.4, 1.8].map((r) => (
              <Chip key={r} label={`${r}×`} active={profile.speechRate === r} onPress={() => patch({ speechRate: r })} />
            ))}
          </View>
        </GlassCard>
      ) : null}

      {hearing ? (
        <GlassCard>
          <Text variant="section">Sign language</Text>
          <View style={styles.chips}>
            {(['ASL', 'BSL', 'ISL', 'LSF', 'other'] as const).map((l) => (
              <Chip key={l} label={l === 'other' ? 'Other' : l} active={profile.signLanguage === l} onPress={() => patch({ signLanguage: l })} />
            ))}
          </View>
          <Text variant="section" style={{ marginTop: spacing.md }}>Show replies as</Text>
          <View style={styles.chips}>
            {(['text', 'avatar', 'both'] as const).map((format) => (
              <Chip
                key={format}
                label={format === 'both' ? 'Text + avatar' : format === 'avatar' ? 'Sign avatar' : 'Text'}
                active={profile.replyFormat === format}
                onPress={() => patch({ replyFormat: format })}
              />
            ))}
          </View>
        </GlassCard>
      ) : null}

      <GlassCard>
        <Row
          title="Haptic feedback"
          caption="Pulses that get faster as objects get closer."
          value={profile.haptics}
          onChange={(v) => patch({ haptics: v })}
        />
      </GlassCard>

      <GlassCard>
        <Row
          title="Large captions"
          caption="High-contrast text for everything spoken."
          value={profile.captions}
          onChange={(v) => patch({ captions: v })}
        />
      </GlassCard>

      <GlassCard>
        <Row
          title="Keep memory on this device"
          caption="On, nothing leaves your phone. Off, your memory graph syncs through Supermemory so recall follows you across devices."
          value={profile.localOnlyMemory}
          onChange={(v) => patch({ localOnlyMemory: v })}
        />
        <Button
          label="Review what GuideEye remembers"
          tone="glass"
          onPress={() => router.push('/memory')}
          hint="Opens your memory graph, where you can search and delete entries."
          style={{ marginTop: spacing.sm }}
          icon={<Ionicons name="git-network-outline" size={20} color={colors.text} />}
        />
      </GlassCard>

    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: spacing.sm, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
