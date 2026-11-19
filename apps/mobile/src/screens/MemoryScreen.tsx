import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, Display, GlassCard, RoundButton, Screen, Text } from '../components';
import { useProfile } from '../state/ProfileContext';
import { announce } from '../lib/announce';
import {
  ask,
  forgetEverything,
  forgetNode,
  graphSnapshot,
  graphStats,
  MemoryKind,
  RecallHit,
  remoteStatus,
} from '../memory';
import { colors, HIT, radius, spacing } from '../theme/tokens';

const KINDS: Array<{ id: MemoryKind; label: string }> = [
  { id: 'place', label: 'Places' },
  { id: 'person', label: 'People' },
  { id: 'object', label: 'Objects' },
  { id: 'hazard', label: 'Hazards' },
  { id: 'conversation', label: 'Conversations' },
  { id: 'sign', label: 'Signs' },
];

const RELATION_LABEL: Record<string, string> = {
  co_occurred: 'seen with',
  located_in: 'at',
  said_by: 'said by',
  refers_to: 'related to',
};

/**
 * The memory graph, made inspectable. Anything that remembers on a user's
 * behalf has to let them see and delete what it holds — especially when the
 * user cannot simply glance at a screen to check.
 */
export function MemoryScreen() {
  const { profile } = useProfile();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MemoryKind | undefined>();
  const [hits, setHits] = useState<RecallHit[]>([]);
  const [counts, setCounts] = useState({ nodes: 0, edges: 0 });
  const [sync, setSync] = useState<{ configured: boolean; reason?: string }>({ configured: false });

  const refresh = useCallback(
    async (q: string, k?: MemoryKind) => {
      const results = await ask(profile, q, { kinds: k ? [k] : undefined, limit: 25 });
      setHits(results);
      const graph = await graphSnapshot();
      const s = graphStats(graph);
      setCounts({ nodes: s.nodes, edges: s.edges });
    },
    [profile],
  );

  useEffect(() => {
    refresh(query, kind);
  }, [kind]);

  useEffect(() => {
    if (!profile.localOnlyMemory) remoteStatus().then(setSync);
  }, [profile.localOnlyMemory]);

  const summary = useMemo(
    () =>
      counts.nodes === 0
        ? 'Nothing remembered yet. As you use GuideEye, places, people and obstacles collect here.'
        : `${counts.nodes} things remembered, connected by ${counts.edges} relationships.`,
    [counts],
  );

  const remove = (id: string, label: string) =>
    Alert.alert('Forget this?', `"${label}" and its connections are deleted from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: async () => {
          await forgetNode(id);
          announce(profile, `${label} forgotten.`);
          refresh(query, kind);
        },
      },
    ]);

  const removeAll = () =>
    Alert.alert('Forget everything?', 'The whole memory graph on this device is deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget everything',
        style: 'destructive',
        onPress: async () => {
          await forgetEverything();
          announce(profile, 'Memory cleared.');
          refresh('', undefined);
        },
      },
    ]);

  return (
    <Screen>
      <View style={styles.bar}>
        <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
      </View>

      <Display lead="What GuideEye" accent="remembers" />
      <Text variant="body" muted style={{ marginTop: spacing.sm }}>
        {summary}
      </Text>

      <GlassCard style={{ marginTop: spacing.md }}>
        <Text variant="label" muted>
          Search your memory
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => refresh(query, kind)}
          placeholder="A place, a person, a thing"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel="Search your memory"
          returnKeyType="search"
        />
      </GlassCard>

      <View style={styles.chips}>
        <Chip label="All" active={!kind} onPress={() => setKind(undefined)} />
        {KINDS.map((k) => (
          <Chip key={k.id} label={k.label} active={kind === k.id} onPress={() => setKind(k.id)} />
        ))}
      </View>

      {!profile.localOnlyMemory ? (
        <GlassCard>
          <View style={styles.row}>
            <Ionicons
              name={sync.configured ? 'cloud-done-outline' : 'cloud-offline-outline'}
              size={20}
              color={sync.configured ? colors.lime : colors.textFaint}
            />
            <Text variant="caption" muted style={{ flex: 1 }}>
              {sync.configured
                ? 'Synced through Supermemory, so recall carries across your devices.'
                : `Sync is on, but the server is not set up for it. ${sync.reason ?? ''}`}
            </Text>
          </View>
        </GlassCard>
      ) : null}

      {hits.map((hit) => (
        <GlassCard key={hit.node.id}>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="section">{hit.node.label}</Text>
              <Text variant="caption" faint>
                {hit.node.kind} · {hit.reason}
                {hit.remote ? ' · synced' : ''}
              </Text>
            </View>
            <RoundButton
              icon="trash-outline"
              label={`Forget ${hit.node.label}`}
              onPress={() => remove(hit.node.id, hit.node.label)}
            />
          </View>

          {hit.node.detail ? (
            <Text variant="body" muted>
              {hit.node.detail}
            </Text>
          ) : null}

          {hit.related.length ? (
            <View style={styles.related}>
              {hit.related.map((rel) => (
                <Text key={`${hit.node.id}-${rel.node.id}-${rel.kind}`} variant="caption" muted>
                  {RELATION_LABEL[rel.kind] ?? rel.kind} · {rel.node.label}
                </Text>
              ))}
            </View>
          ) : null}
        </GlassCard>
      ))}

      {counts.nodes > 0 ? (
        <Button label="Forget everything" tone="ghost" onPress={removeAll} style={{ marginTop: spacing.md }} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: spacing.sm, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm },
  input: {
    minHeight: HIT,
    color: colors.text,
    fontSize: 18,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: spacing.md,
  },
  related: {
    gap: 2,
    marginTop: spacing.xs,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.glassBorder,
  },
});
