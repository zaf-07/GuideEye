import { AccessibilityInfo, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { Profile, hasVisionTrack } from '../state/profile';

let speakingUntil = 0;
let endedAt = 0;

function estimateMs(message: string, rate: number) {
  const words = message.trim().split(/\s+/).length;
  return Math.max(2500, (words * 520) / Math.max(rate, 0.5) + 2500);
}

function finished() {
  speakingUntil = 0;
  endedAt = Date.now();
}

/**
 * One announcement path for the whole app.
 *  - Blind / low-vision mode uses the configured GuideEye voice.
 *  - Other modes only enqueue the message for an enabled screen reader.
 * Keeping these paths exclusive avoids two voices speaking over one another.
 */
export function announce(profile: Profile, message: string, opts?: { urgent?: boolean }) {
  if (hasVisionTrack(profile)) {
    if (opts?.urgent) Speech.stop();
    speakingUntil = Date.now() + estimateMs(message, profile.speechRate);
    Speech.speak(message, {
      rate: profile.speechRate,
      pitch: 1,
      language: 'en-US',
      onDone: finished,
      onStopped: finished,
      onError: finished,
    });
  } else if (Platform.OS !== 'web') {
    AccessibilityInfo.announceForAccessibility(message);
  }
}

export function stopSpeaking() {
  Speech.stop();
  finished();
}

/** True while GuideEye is talking, and for a short tail after, so the microphone never obeys the app's own voice. */
export function speechBusy(graceMs = 900) {
  const now = Date.now();
  return now < speakingUntil || now - endedAt < graceMs;
}
