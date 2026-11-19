import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Button, Chip, Display, GlassCard, RoundButton, Screen, Text } from '../components';
import { apiJson, apiUrl, devHostApiUrl, loadApiUrl, probeApi, setApiUrl } from '../api';
import { onSyncHealth, remoteStatus, syncHealth, type SyncHealth } from '../memory';
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


/**
 * Where the GuideEye server is, and whether memories are reaching it.
 *
 * There was no way to set this on a phone at all: the address came from a
 * build-time variable, and the one code path that read a user value used
 * `localStorage`, which React Native does not have. So the app shipped with
 * every server-backed feature permanently dark and no way to say so.
 */
function ServerCard() {
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [sync, setSync] = useState<string>('');
  const [health, setHealth] = useState<SyncHealth>(syncHealth);

  useEffect(() => onSyncHealth(setHealth), []);

  useEffect(() => {
    loadApiUrl().then((url) => setDraft(url)).catch(() => {});
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    setResult(null);
    try {
      const probe = await probeApi(draft);
      setResult({ ok: probe.ok, detail: probe.ok ? `Connected in ${probe.latencyMs} ms.` : probe.detail });
      if (probe.ok) {
        await setApiUrl(probe.url);
        setDraft(probe.url);
        const status = await remoteStatus();
        setSync(
          status.configured
            ? 'Supermemory is on. New memories sync as they are made.'
            : `Memories stay on the server only: ${status.reason ?? 'Supermemory is not set up there.'}`,
        );
      }
    } finally {
      setChecking(false);
    }
  }, [draft]);

  const syncNow = useCallback(async () => {
    setSync('Syncing everything…');
    try {
      const body = await apiJson<{ sent: number; failed: number; skipped: number }>('/memory/sync', { method: 'POST' });
      setSync(`Sent ${body.sent}, failed ${body.failed}, skipped ${body.skipped}.`);
    } catch (error) {
      setSync((error as Error).message);
    }
  }, []);

  const suggestion = devHostApiUrl();

  return (
    <GlassCard>
      <Text variant="caption" faint>GUIDEEYE SERVER</Text>
      <Text variant="section">Where this phone looks for GuideEye</Text>
      <Text variant="body" muted>
        Scene descriptions, sign reading and synced memory all come from here. Plain http is
        allowed to an address on your own network; anything further away must use https.
      </Text>

      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={suggestion || 'http://192.168.1.5:8000'}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="GuideEye server address"
        style={styles.input}
      />

      {suggestion && suggestion !== draft ? (
        <Button
          label={`Use this Mac (${suggestion.replace(/^https?:\/\//, '')})`}
          tone="glass"
          onPress={() => setDraft(suggestion)}
          hint="Fills in the computer that is serving the app right now."
          style={{ marginTop: spacing.sm }}
          icon={<Ionicons name="laptop-outline" size={20} color={colors.text} />}
        />
      ) : null}

      <Button
        label={checking ? 'Checking…' : 'Test and save'}
        onPress={check}
        hint="Asks the address whether a GuideEye server is answering, then saves it."
        style={{ marginTop: spacing.sm }}
        icon={
          checking ? (
            <ActivityIndicator color={colors.onLight} />
          ) : (
            <Ionicons name="wifi-outline" size={20} color={colors.onLight} />
          )
        }
      />

      {result ? (
        <Text
          variant="body"
          style={{ marginTop: spacing.sm, color: result.ok ? colors.lime : colors.amber }}
          accessibilityLiveRegion="polite"
        >
          {result.detail}
        </Text>
      ) : null}

      <Button
        label="Sync all memories now"
        tone="glass"
        onPress={syncNow}
        hint="Pushes everything already stored to Supermemory, including notes made before it was set up."
        style={{ marginTop: spacing.sm }}
        icon={<Ionicons name="cloud-upload-outline" size={20} color={colors.text} />}
      />

      {sync ? (
        <Text variant="caption" muted style={{ marginTop: spacing.sm }} accessibilityLiveRegion="polite">
          {sync}
        </Text>
      ) : null}

      <Text variant="caption" faint style={{ marginTop: spacing.sm }}>
        {apiUrl() ? `Currently using ${apiUrl()}` : 'No server set — on-device features still work.'}
      </Text>

      <Text
        variant="caption"
        style={{ marginTop: 4, color: health.state === 'failed' ? colors.amber : colors.textFaint }}
      >
        {`Last memory: ${health.detail}`}
        {health.synced || health.failed ? ` (${health.synced} synced, ${health.failed} failed this session)` : ''}
      </Text>
    </GlassCard>
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

      <ServerCard />

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

      {hasVisionTrack(profile) ? (
        <GlassCard>
          <Row
            title="Hands-free voice control"
            caption="The microphone stays on while GuideEye is open. Say “Guide”, then your request, from any screen. Speech is recognised in English."
            value={profile.voiceControl !== false}
            onChange={(v) => patch({ voiceControl: v })}
          />
        </GlassCard>
      ) : null}

      <GlassCard>
        <Row
          title="Find nearby GuideEye users"
          caption="While the app is open, another GuideEye user close to you can be offered a conversation. Neither of you sees who the other is until you both connect. Your location is used only to check distance and is not stored."
          value={profile.nearbyDiscovery}
          onChange={(v) => {
            void patch({ nearbyDiscovery: v });
            if (v) Location.requestForegroundPermissionsAsync().catch(() => {});
          }}
        />
      </GlassCard>

      <GlassCard>
        <Row
          title="Keep memory on this device"
          caption="On, nothing leaves your phone. Off (the default), every new memory syncs through Supermemory so recall follows you across devices."
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
  input: {
    marginTop: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
});
