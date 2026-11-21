import React, { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, Text } from '../src/components';
import { announce, speechBusy, stopSpeaking } from '../src/lib/announce';
import { commandFrom, promptCopy, roleForImpairments } from '../src/nearby/protocol';
import { useNearby } from '../src/nearby/useNearby';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from '../src/speechRecognition';
import { useProfile } from '../src/state/ProfileContext';
import { hasVisionTrack } from '../src/state/profile';
import { useVoice } from '../src/voice/VoiceControl';
import { colors, radius, spacing } from '../src/theme/tokens';

const DOUBLE_TAP_MS = 450;
const LISTEN_AFTER_MS = 6500;

export function NearbyPrompt() {
  const { profile, ready, onboarded } = useProfile();
  const pathname = usePathname();
  const { code } = useGlobalSearchParams<{ code?: string }>();
  const role = roleForImpairments(profile.impairments);
  const enabled = ready && onboarded && Boolean(profile.nearbyDiscovery) && role !== null;
  // Keep Multipeer alive while Bridge is open: the peer session is the actual
  // message transport after a direct match. Pausing here used to disconnect
  // the two phones immediately after both people accepted.
  const paused = pathname.startsWith('/onboarding');
  // A conversation is already open: do not offer another one on top of it.
  const inConversation = pathname.startsWith('/bridge') && Boolean(code);
  const { offer, match, accept, decline, clearMatch } = useNearby(enabled, role, paused, inConversation);
  const { handsFree } = useVoice();
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const offeredAt = useRef(0);
  const audioFirst = hasVisionTrack(profile);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const offerRef = useRef(offer);
  offerRef.current = offer;
  const actions = useRef({ accept, decline });
  actions.current = { accept, decline };
  const lastTap = useRef(0);
  const offerId = offer?.id ?? null;
  const waiting = Boolean(offer?.youAccepted && !offer.partnerAccepted);

  useSpeechRecognitionEvent('result', (event) => {
    if (!offerRef.current || offerRef.current.youAccepted || !event.isFinal) return;
    // The always-on microphone also hears GuideEye reading the prompt aloud
    // ("…say no to skip"). Nothing heard while it is speaking, or in the first
    // moment after the prompt appears, is the user's answer.
    if (speechBusy() || Date.now() - offeredAt.current < 1500) return;
    const command = commandFrom(event.results[0]?.transcript ?? '');
    if (command === 'accept') actions.current.accept();
    else if (command === 'decline') actions.current.decline();
  });

  useEffect(() => {
    if (!offerId) return undefined;
    offeredAt.current = Date.now();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const copy = promptCopy(offerRef.current!, audioFirst);
    announce(profileRef.current, copy.spoken, { urgent: true });
    // With hands-free voice on, its microphone is already listening and the
    // answer arrives through it. Starting a second recognizer fought with it.
    if (!audioFirst || handsFreeRef.current) return undefined;
    const timer = setTimeout(async () => {
      try {
        if (!offerRef.current || !ExpoSpeechRecognitionModule.isRecognitionAvailable()) return;
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted || !offerRef.current) return;
        ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: false, continuous: false });
      } catch {}
    }, LISTEN_AFTER_MS);
    return () => {
      clearTimeout(timer);
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
    };
  }, [offerId, audioFirst]);

  useEffect(() => {
    if (waiting) announce(profileRef.current, 'Waiting for the other person.', { urgent: true });
  }, [waiting]);

  useEffect(() => {
    if (!match) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    announce(profileRef.current, 'Connected. Opening your conversation.', { urgent: true });
    router.push({ pathname: '/bridge', params: { code: match.code, role: match.role } });
    clearMatch();
  }, [match, clearMatch]);

  if (!offer || paused) return null;
  const copy = promptCopy(offer, audioFirst);

  const tapAnywhere = () => {
    if (!audioFirst || offer.youAccepted) return;
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      stopSpeaking();
      accept();
    }
    lastTap.current = now;
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={decline} accessibilityViewIsModal>
      <Pressable style={styles.backdrop} onPress={tapAnywhere} accessible={false}>
        <View style={styles.sheet} accessibilityLiveRegion="assertive">
          <View style={styles.icon}>
            <Ionicons name="people" size={30} color={colors.onLight} />
          </View>
          <Text variant="title" center>{copy.title}</Text>
          <Text variant="body" muted center>{copy.detail}</Text>
          <Button
            label={waiting ? 'Waiting…' : 'Connect'}
            tone="lime"
            busy={waiting}
            onPress={accept}
            hint="Opens a conversation with the nearby GuideEye user once they also connect."
          />
          <Button label="Not now" tone="ghost" onPress={decline} hint="Dismisses this and does not ask about this person again for two minutes." />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    alignItems: 'stretch',
  },
  icon: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
