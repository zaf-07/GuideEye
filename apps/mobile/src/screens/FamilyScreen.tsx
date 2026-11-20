import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, Display, GlassCard, RoundButton, Screen, Text } from '../components';
import { addContact, assistantConfigured, listContacts, removeContact, type Contact } from '../assistant';
import { useAssistant } from '../useAssistant';
import { useProfile } from '../state/ProfileContext';
import { announce } from '../lib/announce';
import { colors, HIT, radius, spacing } from '../theme/tokens';

export function FamilyScreen() {
  const { reply, busy, error, ask, setError } = useAssistant();
  const { profile } = useProfile();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [guardianActive, setGuardianActive] = useState(false);
  const configured = assistantConfigured();

  const refresh = useCallback(async () => {
    try {
      setContacts(await listContacts());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your contacts could not be loaded.');
    }
  }, [setError]);

  useEffect(() => {
    if (configured) void refresh();
  }, [configured, refresh]);

  const save = async () => {
    if (!name.trim() || !phone.trim()) {
      setError('Enter a name and a phone number with the country code.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await addContact(name.trim(), phone.trim());
      setName('');
      setPhone('');
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That contact could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (contact: Contact) => {
    try {
      await removeContact(contact.name);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That contact could not be removed.');
    }
  };

  const toggleGuardian = (active: boolean) => {
    setGuardianActive(active);
    if (active) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      announce(profile, 'Guardian live sharing enabled for this journey.', { urgent: true });
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      announce(profile, 'Guardian sharing disabled.', { urgent: true });
    }
  };

  return (
    <Screen>
      <View style={styles.bar}>
        <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
      </View>

      <Display lead="People you" accent="trust" />
      <Text variant="body" muted>
        Share where you are or call someone with one tap. Nothing is sent until you say yes.
      </Text>

      <GlassCard strong>
        <View style={styles.row}>
          <View style={styles.fill}>
            <Text variant="caption" style={{ color: colors.lime, fontWeight: '700' }}>GUARDIAN</Text>
            <Text variant="section">Share this journey</Text>
            <Text variant="caption" muted>
              Let a trusted contact see your live trip until you arrive safely.
            </Text>
          </View>
          <Switch
            value={guardianActive}
            onValueChange={toggleGuardian}
            trackColor={{ true: colors.lime, false: 'rgba(255,255,255,0.2)' }}
            accessibilityLabel="Guardian live trip sharing toggle"
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: guardianActive ? colors.lime : colors.textFaint }} />
          <Text variant="caption" style={{ color: guardianActive ? colors.lime : colors.textFaint, fontWeight: '600' }}>
            {guardianActive ? 'Live Sharing Active' : 'Off'}
          </Text>
        </View>
      </GlassCard>

      {!configured ? (
        <GlassCard>
          <Text variant="body">Set the GuideEye server address in Settings to use Family.</Text>
        </GlassCard>
      ) : null}

      {error ? (
        <GlassCard>
          <View style={styles.row}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
            <Text variant="body" style={styles.fill} accessibilityLiveRegion="polite">
              {error}
            </Text>
          </View>
        </GlassCard>
      ) : null}

      {reply?.say ? (
        <GlassCard strong>
          <Text variant="section" accessibilityLiveRegion="polite">
            {reply.say}
          </Text>
          {reply.confirm ? (
            <View style={styles.actions}>
              <Button label="Yes" tone="lime" busy={busy} onPress={() => void ask('yes')} hint={reply.confirm} />
              <Button label="No" tone="glass" disabled={busy} onPress={() => void ask('no')} hint="Cancels it." />
            </View>
          ) : null}
        </GlassCard>
      ) : null}

      {contacts.map((contact) => (
        <GlassCard key={contact.name}>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={28} color={colors.lime} />
            <View style={styles.fill}>
              <Text variant="section">{contact.name}</Text>
              <Text variant="caption" muted>
                +{contact.phone}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Button
              label={`Call ${contact.name}`}
              tone="lime"
              disabled={busy}
              onPress={() => void ask(`Call ${contact.name}`)}
              hint="Starts a phone call."
              icon={<Ionicons name="call" size={20} color={colors.onLight} />}
            />
            <Button
              label="Share my location"
              tone="glass"
              disabled={busy}
              onPress={() => void ask(`Tell ${contact.name} where I am`)}
              hint={`Prepares a WhatsApp message to ${contact.name}.`}
              icon={<Ionicons name="location-outline" size={20} color={colors.text} />}
            />
            <Pressable
              onPress={() => void remove(contact)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${contact.name}`}
              accessibilityHint={`Removes ${contact.name} from your contacts.`}
              style={styles.remove}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text variant="label" color={colors.danger}>
                Remove
              </Text>
            </Pressable>
          </View>
        </GlassCard>
      ))}

      {configured && !contacts.length ? (
        <Text variant="body" muted>
          No contacts yet. Add the first person below.
        </Text>
      ) : null}

      <GlassCard>
        <Text variant="label" muted>
          Add a contact
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name, for example Mom"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel="Contact name"
          maxLength={40}
          returnKeyType="next"
        />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone with country code"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel="Phone number with country code"
          keyboardType="phone-pad"
          maxLength={24}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
        <Button label="Add contact" busy={saving} disabled={!configured} onPress={() => void save()} />
      </GlassCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fill: { flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  // Deliberately smaller than the two things people come here to do.
  remove: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, alignSelf: 'flex-end', paddingHorizontal: spacing.sm },
  input: {
    minHeight: HIT,
    color: colors.text,
    fontSize: 18,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: spacing.md,
  },
});
