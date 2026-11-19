/**
 * Optional speech recognition.
 *
 * `expo-speech-recognition` is native code: it is absent in Expo Go and in any
 * build where the module did not link, and importing it there throws at module
 * scope. Bridge is the one screen a deaf-blind pair depends on, so it must not
 * be taken down by a missing voice-input module — the signing direction, the
 * captions and the quick replies all still work without it.
 *
 * The stub keeps the same shape as the real module, so callers never branch:
 * `isRecognitionAvailable()` simply answers false and the UI already handles
 * that case by pointing the user at quick replies.
 */

type SpeechModule = typeof import('expo-speech-recognition');

let native: SpeechModule | null = null;
try {
  native = require('expo-speech-recognition') as SpeechModule;
} catch {
  native = null;
}

const stubModule = {
  isRecognitionAvailable: () => false,
  requestPermissionsAsync: async () => ({ granted: false, canAskAgain: false, status: 'denied' }),
  start: () => {},
  stop: () => {},
  abort: () => {},
} as unknown as SpeechModule['ExpoSpeechRecognitionModule'];

export const ExpoSpeechRecognitionModule: SpeechModule['ExpoSpeechRecognitionModule'] =
  native?.ExpoSpeechRecognitionModule ?? stubModule;

/**
 * A no-op hook when the module is missing. It is still called unconditionally
 * by the caller, so the rules of hooks hold either way.
 */
export const useSpeechRecognitionEvent: SpeechModule['useSpeechRecognitionEvent'] =
  native?.useSpeechRecognitionEvent ?? (((_event: never, _handler: never) => {}) as SpeechModule['useSpeechRecognitionEvent']);

/** False in Expo Go and anywhere the native module is unavailable. */
export function speechRecognitionAvailable(): boolean {
  return native !== null;
}
