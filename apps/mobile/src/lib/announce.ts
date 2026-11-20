import { AccessibilityInfo, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { apiUrl } from '../api';
import { Profile, hasVisionTrack } from '../state/profile';

let speakingUntil = 0;
let endedAt = 0;
let cloudPlayer: any = null;
let cloudFile: any = null;
let webAudio: HTMLAudioElement | null = null;
let finishTimer: ReturnType<typeof setTimeout> | null = null;
let cloudRun = 0;
// Scene narration is tracked apart from replies: the microphone may listen through it.
let narrationUntil = 0;

function estimateMs(message: string, rate: number) {
  const words = message.trim().split(/\s+/).length;
  return Math.max(2500, (words * 520) / Math.max(rate, 0.5) + 2500);
}

function finished() {
  speakingUntil = 0;
  endedAt = Date.now();
  if (finishTimer) clearTimeout(finishTimer);
  finishTimer = null;
}

function stopCloudVoice() {
  if (Platform.OS === 'web') {
    if (webAudio) {
      try {
        webAudio.pause();
        webAudio.src = '';
      } catch {
        /* best-effort */
      }
      webAudio = null;
    }
  } else {
    try {
      cloudPlayer?.pause?.();
      cloudPlayer?.release?.();
    } catch {
      /* best-effort */
    }
    cloudPlayer = null;
    try { cloudFile?.delete?.(); } catch { /* cache cleanup is best-effort */ }
    cloudFile = null;
  }
}

function speakNative(profile: Profile, message: string, opts?: { urgent?: boolean }) {
  if (opts?.urgent) Speech.stop();
  Speech.speak(message, {
    rate: profile.speechRate,
    pitch: 1,
    language: 'en-US',
    onDone: finished,
    onStopped: finished,
    onError: finished,
  });
}

/**
 * Sends only the text to the user's configured GuideEye server. That server
 * owns the ElevenLabs credential and returns MP3 bytes; the mobile bundle
 * never receives or stores a provider key. Urgent alerts stay on-device so a
 * network request can never delay a safety warning.
 */
async function speakCloud(profile: Profile, message: string, run: number): Promise<boolean> {
  const server = apiUrl();
  if (!server) return false;
  try {
    const body = new FormData();
    body.append('text', message);
    const response = await fetch(`${server}/speech`, { method: 'POST', body });
    if (!response.ok) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || run !== cloudRun) return false;

    stopCloudVoice();

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.Audio !== 'undefined') {
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new window.Audio(url);
        webAudio = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          finished();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          finished();
        };
        await audio.play();
        finishTimer = setTimeout(finished, estimateMs(message, profile.speechRate));
        return true;
      }
      return false;
    }

    // Dynamic safe loading of expo-audio and expo-file-system so missing/unlinked native modules never crash the app
    let expoAudio: any = null;
    let expoFs: any = null;
    try {
      expoAudio = require('expo-audio');
      expoFs = require('expo-file-system');
    } catch {
      return false;
    }

    if (!expoAudio?.createAudioPlayer || !expoFs?.File || !expoFs?.Paths) {
      return false;
    }

    const file = new expoFs.File(expoFs.Paths.cache, 'guideeye-elevenlabs.mp3');
    file.create({ overwrite: true });
    await file.write(bytes);
    cloudFile = file;
    const player = expoAudio.createAudioPlayer(file.uri);
    cloudPlayer = player;
    player.addListener?.('playbackStatusUpdate', (status: any) => {
      if (status && (status.playbackState === 'finished' || (status.duration > 0 && status.currentTime >= status.duration))) {
        finished();
      }
    });
    player.play();

    // Conservative fallback timer in case platform omits completion event
    finishTimer = setTimeout(finished, estimateMs(message, profile.speechRate));
    return true;
  } catch {
    return false;
  }
}

/**
 * One announcement path for the whole app.
 *  - Blind / low-vision mode uses the configured GuideEye voice (ElevenLabs cloud, native fallback).
 *  - Other modes only enqueue the message for an enabled screen reader.
 * Keeping these paths exclusive avoids two voices speaking over one another.
 */
export function announce(profile: Profile, message: string, opts?: { urgent?: boolean }) {
  if (hasVisionTrack(profile)) {
    const run = ++cloudRun;
    stopCloudVoice();
    // The assistant outranks scene narration: cut the phrase and take the floor.
    if (Date.now() < narrationUntil) {
      narrationUntil = 0;
      Speech.stop();
    }
    speakingUntil = Date.now() + estimateMs(message, profile.speechRate);
    if (opts?.urgent) {
      speakNative(profile, message, opts);
      return;
    }
    void speakCloud(profile, message, run).then((played) => {
      if (!played && run === cloudRun) speakNative(profile, message);
    });
  } else if (Platform.OS !== 'web') {
    AccessibilityInfo.announceForAccessibility(message);
  }
}

/**
 * Speak now with the on-device voice, whatever the profile. For buttons a
 * person pressed ("repeat", "speak this sign"): it interrupts anything else,
 * and the microphone ignores it like any other GuideEye speech.
 */
export function speakAloud(message: string, opts?: { rate?: number; language?: string }) {
  const text = message.trim();
  if (!text) return;
  cloudRun += 1;
  stopCloudVoice();
  narrationUntil = 0;
  const rate = opts?.rate ?? 1;
  speakingUntil = Date.now() + estimateMs(text, rate);
  Speech.stop();
  Speech.speak(text, {
    rate,
    pitch: 1,
    language: opts?.language ?? 'en-US',
    onDone: finished,
    onStopped: finished,
    onError: finished,
  });
}

function narrationFinished() {
  narrationUntil = 0;
}

/**
 * Scene narration ("chair ahead"). It is the lowest-priority voice: it stays
 * silent while GuideEye is answering, only ever interrupts its own previous
 * phrase, and uses the on-device voice so a hazard never waits on the network.
 * Returns false when it stayed silent.
 */
export function narrate(message: string, opts?: { rate?: number }): boolean {
  const text = message.trim();
  if (!text || speechBusy(0)) return false;
  const rate = opts?.rate ?? 1;
  if (Date.now() < narrationUntil) Speech.stop();
  narrationUntil = Date.now() + estimateMs(text, rate);
  Speech.speak(text, {
    rate,
    pitch: 1,
    language: 'en-US',
    onDone: narrationFinished,
    onStopped: narrationFinished,
    onError: narrationFinished,
  });
  return true;
}

/** True while a scene narration phrase is (probably) being spoken. */
export function narrating() {
  return Date.now() < narrationUntil;
}

/** Cut a narration phrase short, for example because the user started a command. */
export function stopNarration() {
  if (!narrating()) return;
  narrationUntil = 0;
  Speech.stop();
}

/** Explicitly triggers a test announcement to verify on-device ElevenLabs voice playback. */
export function testVoice(profile: Profile, sampleText = 'Hello! This is GuideEye speaking with ElevenLabs natural voice.') {
  announce(profile, sampleText);
}

export function stopSpeaking() {
  cloudRun += 1;
  stopCloudVoice();
  narrationUntil = 0;
  Speech.stop();
  finished();
}

/** True while GuideEye is talking, and for a short tail after, so the microphone never obeys the app's own voice. */
export function speechBusy(graceMs = 900) {
  const now = Date.now();
  return now < speakingUntil || now - endedAt < graceMs;
}
