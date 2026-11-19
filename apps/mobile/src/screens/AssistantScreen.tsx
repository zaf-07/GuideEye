import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, Display, GlassCard, RoundButton, Screen, Text } from '../components';
import { assistantConfigured } from '../assistant';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from '../speechRecognition';
import { useVoice } from '../voice/VoiceControl';
import { colors, HIT, radius, spacing } from '../theme/tokens';

const SUGGESTIONS = [
  'Where am I?',
  'Take me to the nearest pharmacy',
  'Take me home',
  'Take me back',
  'Stop navigation',
  'Set a timer for ten minutes',
];

export function AssistantScreen() {
  const params = useLocalSearchParams<{ prompt?: string }>();
  const voice = useVoice();
  const { reply, busy, error, navigating, ask, setError } = voice.assistant;
  const handsFree = voice.handsFree;
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const started = useRef(false);
  const configured = assistantConfigured();

  useEffect(() => {
    if (started.current || !params.prompt || !configured) return;
    started.current = true;
    void ask(String(params.prompt));
  }, [ask, configured, params.prompt]);

  useSpeechRecognitionEvent('start', () => {
    if (!handsFree) setListening(true);
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', (event) => {
    if (handsFree) return;
    setListening(false);
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      setError('Voice input could not start. Type your request instead.');
    }
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (handsFree || !event.isFinal) return;
    const heard = event.results[0]?.transcript.trim();
    if (heard) void ask(heard);
  });

  const send = () => {
    const request = text.trim();
    if (!request) return;
    setText('');
    void ask(request);
  };

  const toggleListening = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      setListening(false);
      return;
    }
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setError('Voice input is not available on this device. Type your request instead.');
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone and speech-recognition permission are needed for voice input.');
        return;
      }
      ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: false, continuous: false });
    } catch {
      setListening(false);
      setError('Voice input could not start. Type your request instead.');
    }
  };

  return (
    <Screen>
      <View style={styles.bar}>
        <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
      </View>

      <Display lead="Ask" accent="GuideEye" />
      <Text variant="body" muted>
        Walking directions, your address, messages, calls and timers. Anything that sends or pays waits for your yes.
      </Text>

      {!configured ? (
        <GlassCard>
          <Text variant="body">Set the GuideEye server address in Settings to use the assistant.</Text>
        </GlassCard>
      ) : null}

      {handsFree ? (
        <GlassCard>
          <View style={styles.row}>
            <Ionicons name="mic-outline" size={22} color={colors.lime} />
            <Text variant="body" style={styles.fill}>
              Hands-free is on. Say “Guide”, then your request, from any screen.
            </Text>
          </View>
        </GlassCard>
      ) : (
      <Button
        label={listening ? 'Listening. Tap to stop' : 'Speak a request'}
        tone="lime"
        disabled={!configured || busy}
        onPress={() => void toggleListening()}
        icon={<Ionicons name={listening ? 'stop-circle-outline' : 'mic-outline'} size={24} color={colors.onLight} />}
        hint="Starts listening for one request."
      />
      )}

      <GlassCard>
        <Text variant="label" muted>
          Or type it
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          placeholder="Take me to the nearest supermarket"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel="Type a request"
          maxLength={300}
          returnKeyType="send"
        />
        <Button label="Send" busy={busy} disabled={!configured} onPress={send} />
      </GlassCard>

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
          <Text variant="caption" muted>
            You said: {reply.heard}
          </Text>
          <Text variant="section" accessibilityLiveRegion="polite">
            {reply.say}
          </Text>
          {reply.confirm ? (
            <View style={styles.actions}>
              <Button label="Yes" tone="lime" busy={busy} onPress={() => void ask('yes')} hint={reply.confirm} />
              <Button label="No" tone="glass" disabled={busy} onPress={() => void ask('no')} hint="Cancels it." />
            </View>
          ) : null}
          {reply.map_url ? (
            <Button
              label="Open the route in Maps"
              tone="glass"
              onPress={() => {
                if (reply.map_url) Linking.openURL(reply.map_url).catch(() => setError('The map could not be opened.'));
              }}
            />
          ) : null}
        </GlassCard>
      ) : null}

      {navigating ? (
        <GlassCard>
          <View style={styles.row}>
            <Ionicons name="navigate-outline" size={22} color={colors.lime} />
            <Text variant="body" style={styles.fill}>
              Guiding you turn by turn. Keep GuideEye open. Directions do not mean a crossing is safe.
            </Text>
          </View>
          <Button label="Stop navigation" tone="glass" disabled={busy} onPress={() => void ask('Stop navigation')} />
        </GlassCard>
      ) : null}

      <Text variant="label" muted>
        Try
      </Text>
      <View style={styles.chips}>
        {SUGGESTIONS.map((suggestion) => (
          <Chip key={suggestion} label={suggestion} onPress={() => void ask(suggestion)} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fill: { flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    minHeight: HIT,
    color: colors.text,
    fontSize: 18,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: spacing.md,
  },
});
