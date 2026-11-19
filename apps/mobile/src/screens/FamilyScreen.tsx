import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Display, GlassCard, RoundButton, Screen, Text } from '../components';
import { addContact, assistantConfigured, listContacts, removeContact, type Contact } from '../assistant';
import { useAssistant } from '../useAssistant';
import { colors, HIT, radius, spacing } from '../theme/tokens';

export function FamilyScreen() {
  const { reply, busy, error, ask, setError } = useAssistant();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
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

  return (
    <Screen>
      <View style={styles.bar}>
        <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
      </View>

      <Display lead="People you" accent="trust" />
      <Text variant="body" muted>
        Share where you are or call someone with one tap. Nothing is sent until you say yes.
      </Text>

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
              label="Share my location"
              tone="lime"
              disabled={busy}
              onPress={() => void ask(`Tell ${contact.name} where I am`)}
              hint={`Prepares a WhatsApp message to ${contact.name} and asks before sending.`}
            />
            <Button
              label={`Call ${contact.name}`}
              tone="glass"
              disabled={busy}
              onPress={() => void ask(`Call ${contact.name}`)}
              hint="Asks before the call starts."
            />
            <Button
              label="Remove"
              tone="ghost"
              disabled={busy}
              onPress={() => void remove(contact)}
              hint={`Removes ${contact.name} from your contacts.`}
            />
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
  input: {
    minHeight: HIT,
    color: colors.text,
    fontSize: 18,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: spacing.md,
  },
});
