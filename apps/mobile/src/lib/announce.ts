import { AccessibilityInfo, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { Profile, hasVisionTrack } from '../state/profile';

/**
 * One announcement path for the whole app.
 *  - Blind / low-vision mode uses the configured GuideEye voice.
 *  - Other modes only enqueue the message for an enabled screen reader.
 * Keeping these paths exclusive avoids two voices speaking over one another.
 */
export function announce(profile: Profile, message: string, opts?: { urgent?: boolean }) {
  if (hasVisionTrack(profile)) {
    if (opts?.urgent) Speech.stop();
    Speech.speak(message, {
      rate: profile.speechRate,
      pitch: 1,
      language: 'en-US',
    });
  } else if (Platform.OS !== 'web') {
    AccessibilityInfo.announceForAccessibility(message);
  }
}

export function stopSpeaking() {
  Speech.stop();
}
