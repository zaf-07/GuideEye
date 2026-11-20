import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Camera } from 'expo-camera';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { announce, narrating, speechBusy, stopNarration, stopSpeaking } from '../lib/announce';
import { ExpoSpeechRecognitionModule, speechRecognitionAvailable, useSpeechRecognitionEvent } from '../speechRecognition';
import { hasVisionTrack } from '../state/profile';
import { useProfile } from '../state/ProfileContext';
import { useAssistant } from '../useAssistant';
import { HELP_TEXT, extractCommand, localCommand, parseDelay, spokenDelay } from './commands';
import { holdAttention } from './frame';

type Assistant = ReturnType<typeof useAssistant>;

interface VoiceCtx {
  assistant: Assistant;
  /** True while the app-wide microphone owns speech recognition. */
  handsFree: boolean;
  listening: boolean;
  heard: string;
}

const VoiceContext = createContext<VoiceCtx | undefined>(undefined);

const OWN_MICROPHONE = /^\/(bridge|translate)\b/;
// Screens the wake word must not pull the user away from: the camera keeps
// describing the scene, and the answer is spoken wherever they are.
const STAY_PUT = /^\/(assistant|camera)\b/;
const RESTART_MS = 350;
const RETRY_MS = 1500;
const SLOW_RETRY_MS = 10000;
const FOLLOW_UP_MS = 12000;
const WAKE_DEBOUNCE_MS = 550;
const BARE_WAKE = /^\s*(?:hey[\s,]+|okay[\s,]+|ok[\s,]+|hi[\s,]+)?(?:guide\s*eye|guide)\s*[,.!?]*\s*$/i;
const GREETING = 'GuideEye is listening. Say Guide when you need me.';

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { ready, onboarded, profile } = useProfile();
  const assistant = useAssistant();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [denied, setDenied] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');

  const enabled =
    Platform.OS !== 'web' &&
    ready &&
    onboarded &&
    hasVisionTrack(profile) &&
    profile.voiceControl !== false &&
    speechRecognitionAvailable();
  const handsFree = enabled && appActive && !denied && !OWN_MICROPHONE.test(pathname);

  const want = useRef(false);
  const failures = useRef(0);
  const restart = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUpUntil = useRef(0);
  const greeted = useRef(false);
  const scheduled = useRef<ReturnType<typeof setTimeout>[]>([]);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const assistantRef = useRef(assistant);
  assistantRef.current = assistant;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const beginRef = useRef<() => void>(() => {});

  const say = useCallback((message: string) => {
    // Recognition and synthesis share AVAudioSession on iOS. Explicitly hand
    // the session to the speaker, then let begin() restore the microphone once
    // GuideEye's own voice and the echo-suppression tail are finished.
    if (want.current) {
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
    }
    announce(profileRef.current, message, { urgent: true });
    if (want.current) setTimeout(() => beginRef.current(), 250);
  }, []);

  const queue = useCallback((delay: number) => {
    if (restart.current) clearTimeout(restart.current);
    restart.current = setTimeout(() => {
      restart.current = null;
      beginRef.current();
    }, delay);
  }, []);

  const begin = useCallback(async () => {
    if (!want.current) return;
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return;
      // Starting the recognizer reconfigures the audio session, which would
      // clip whatever is being spoken. Wait for a pause; a recognizer that is
      // already running keeps listening through scene narration.
      if (speechBusy() || (await Speech.isSpeakingAsync().catch(() => false))) {
        queue(RESTART_MS);
        return;
      }
      const [permission, microphone] = await Promise.all([
        ExpoSpeechRecognitionModule.requestPermissionsAsync(),
        Camera.requestMicrophonePermissionsAsync(),
      ]);
      if (!permission.granted || !microphone.granted) {
        setDenied(true);
        say('Voice control needs microphone and speech recognition access. Turn them on in iPhone Settings, under GuideEye.');
        return;
      }
      if (!want.current) return;
      if (!greeted.current) {
        greeted.current = true;
        say(GREETING);
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        addsPunctuation: false,
        contextualStrings: ['Guide', 'GuideEye'],
        iosTaskHint: 'unspecified',
        iosCategory: {
          category: 'playAndRecord',
          categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
          mode: 'measurement',
        },
        iosVoiceProcessingEnabled: true,
      });
    } catch {
      queue(RETRY_MS);
    }
  }, [queue, say]);
  beginRef.current = () => void begin();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setAppActive(active);
      // Permission may have been enabled in Settings while GuideEye was in
      // the background. Let the listener try again when the app returns.
      if (active) setDenied(false);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    want.current = handsFree;
    if (!handsFree) return undefined;
    failures.current = 0;
    queue(RESTART_MS);
    return () => {
      want.current = false;
      if (restart.current) clearTimeout(restart.current);
      restart.current = null;
      if (wakeDebounce.current) clearTimeout(wakeDebounce.current);
      wakeDebounce.current = null;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {}
      setListening(false);
    };
  }, [handsFree, queue]);

  useEffect(() => {
    const pending = scheduled.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const run = useCallback(
    (text: string) => {
      const local = localCommand(text);
      if (local) {
        if (local.type === 'quiet') return stopSpeaking();
        if (local.type === 'repeat') return say(assistantRef.current.reply?.say || 'There is nothing to repeat yet.');
        if (local.type === 'help') return say(HELP_TEXT);
        if (local.type === 'back') {
          if (router.canGoBack()) router.back();
          else say('You are on the home screen.');
          return undefined;
        }
        if (local.type === 'cancel_scheduled') {
          const count = scheduled.current.length;
          scheduled.current.forEach(clearTimeout);
          scheduled.current = [];
          return say(count ? 'Cancelled what was scheduled.' : 'Nothing is scheduled.');
        }
        const target = local.href.split('?')[0];
        if (target !== '/main' && pathnameRef.current.startsWith(target)) {
          return say(target === '/camera' ? 'The camera is already on.' : 'You are already there.');
        }
        say(local.say);
        router.push(local.href as never);
        return undefined;
      }
      const later = parseDelay(text);
      if (later) {
        const timer = setTimeout(() => {
          scheduled.current = scheduled.current.filter((item) => item !== timer);
          void assistantRef.current.ask(later.command);
        }, later.seconds * 1000);
        scheduled.current.push(timer);
        return say(`Okay. In ${spokenDelay(later.seconds)}: ${later.command}. Keep GuideEye open until then.`);
      }
      void assistantRef.current.ask(text);
      return undefined;
    },
    [say],
  );

  const activateWake = useCallback(() => {
    // Ignore duplicate interim/final events for the same wake word.
    if (Date.now() < followUpUntil.current) return;
    followUpUntil.current = Date.now() + FOLLOW_UP_MS;
    // Scene narration stays quiet while the user is about to speak.
    holdAttention(FOLLOW_UP_MS);
    stopNarration();
    setHeard('Guide');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!STAY_PUT.test(pathname)) router.push('/assistant' as never);
    say('Yes?');
  }, [pathname, say]);

  useSpeechRecognitionEvent('start', () => {
    if (!want.current) return;
    failures.current = 0;
    setListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    if (!want.current) return;
    setListening(false);
    queue(RESTART_MS);
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!want.current) return;
    setListening(false);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setDenied(true);
      return;
    }
    if (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'speech-timeout') {
      queue(RESTART_MS);
      return;
    }
    failures.current += 1;
    queue(failures.current > 4 ? SLOW_RETRY_MS : RETRY_MS);
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!want.current) return;
    const transcript = event.results[0]?.transcript ?? '';
    if (!transcript.trim()) return;
    const addressed =
      extractCommand(transcript, {
        awaitingConfirm: Boolean(assistantRef.current.reply?.confirm),
        followUp: Date.now() < followUpUntil.current,
        wakeRequired: true,
      }) !== null;
    if (!event.isFinal) {
      // Only show what GuideEye will act on. Echoing every overheard sentence
      // made it look as if a command had been taken when it had been ignored.
      if (addressed) setHeard(transcript.trim());
      if (wakeDebounce.current) clearTimeout(wakeDebounce.current);
      wakeDebounce.current = null;
      if (BARE_WAKE.test(transcript)) {
        // iOS continuous recognition can leave a one-word utterance interim
        // indefinitely. Debounce it so a longer "Guide, take me home" still
        // has time to arrive and be handled as one final command.
        wakeDebounce.current = setTimeout(() => {
          wakeDebounce.current = null;
          activateWake();
        }, WAKE_DEBOUNCE_MS);
      }
      return;
    }
    if (wakeDebounce.current) clearTimeout(wakeDebounce.current);
    wakeDebounce.current = null;
    const quiet = /\bguides?\b.*\b(stop talking|quiet|silence|shut up|hush)\b/i.test(transcript);
    void (async () => {
      if (!addressed) {
        // Speech without the wake word is not for GuideEye.
        setHeard('');
        return;
      }
      if (!quiet) {
        if (speechBusy()) return;
        // Scene narration may be interrupted by a command; an answer may not.
        if (narrating()) stopNarration();
        else if (await Speech.isSpeakingAsync().catch(() => false)) return;
      }
      if (assistantRef.current.busy) return;
      const result = extractCommand(transcript, {
        awaitingConfirm: Boolean(assistantRef.current.reply?.confirm),
        followUp: Date.now() < followUpUntil.current,
        wakeRequired: true,
      });
      if (!result) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (result.kind === 'wake') {
        activateWake();
        return;
      }
      followUpUntil.current = 0;
      holdAttention(0);
      setHeard(result.text);
      run(result.text);
    })();
  });

  const value = useMemo<VoiceCtx>(
    () => ({ assistant, handsFree, listening, heard }),
    [assistant, handsFree, listening, heard],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {handsFree ? (
        <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 4 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.pill, listening ? styles.pillOn : null]}>
            <View style={[styles.dot, listening ? styles.dotOn : null]} />
            <Text style={styles.label} numberOfLines={1}>
              {assistant.busy ? 'Working…' : listening ? (heard ? `Heard: ${heard}` : 'Say “Guide, …”') : 'Voice starting…'}
            </Text>
          </View>
        </View>
      ) : null}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used inside <VoiceProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(7,17,15,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  pillOn: { borderColor: 'rgba(200,255,90,0.6)' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#C8FF5A' },
  label: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
