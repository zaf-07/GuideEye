import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { announce, speechBusy, stopSpeaking } from '../lib/announce';
import { ExpoSpeechRecognitionModule, speechRecognitionAvailable, useSpeechRecognitionEvent } from '../speechRecognition';
import { hasVisionTrack } from '../state/profile';
import { useProfile } from '../state/ProfileContext';
import { useAssistant } from '../useAssistant';
import { HELP_TEXT, extractCommand, localCommand, parseDelay, spokenDelay } from './commands';

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
const RESTART_MS = 350;
const RETRY_MS = 1500;
const SLOW_RETRY_MS = 10000;
const FOLLOW_UP_MS = 7000;
const GREETING = 'GuideEye is listening. Say Guide, then what you need. Say Guide, help, for examples.';

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
  const followUpUntil = useRef(0);
  const greeted = useRef(false);
  const scheduled = useRef<ReturnType<typeof setTimeout>[]>([]);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const assistantRef = useRef(assistant);
  assistantRef.current = assistant;

  const say = useCallback((message: string) => announce(profileRef.current, message, { urgent: true }), []);

  const beginRef = useRef<() => void>(() => {});

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
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setDenied(true);
        say('Voice control needs microphone and speech recognition access. Turn them on in iPhone Settings, under GuideEye.');
        return;
      }
      if (!want.current) return;
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        continuous: true,
        addsPunctuation: false,
        contextualStrings: ['Guide', 'GuideEye'],
        iosCategory: {
          category: 'playAndRecord',
          categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
          mode: 'default',
        },
      });
      if (!greeted.current) {
        greeted.current = true;
        say(GREETING);
      }
    } catch {
      queue(RETRY_MS);
    }
  }, [queue, say]);
  beginRef.current = () => void begin();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
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
    if (!want.current || !event.isFinal) return;
    const transcript = event.results[0]?.transcript ?? '';
    if (!transcript.trim()) return;
    const quiet = /\bguides?\b.*\b(stop talking|quiet|silence|shut up|hush)\b/i.test(transcript);
    void (async () => {
      if (!quiet) {
        if (speechBusy()) return;
        if (await Speech.isSpeakingAsync().catch(() => false)) return;
      }
      if (assistantRef.current.busy) return;
      const result = extractCommand(transcript, {
        awaitingConfirm: Boolean(assistantRef.current.reply?.confirm),
        followUp: Date.now() < followUpUntil.current,
      });
      if (!result) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (result.kind === 'wake') {
        followUpUntil.current = Date.now() + FOLLOW_UP_MS;
        setHeard('Guide');
        say('Yes?');
        return;
      }
      followUpUntil.current = 0;
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
