import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadApiUrl } from '../src/api';
import { initIdentity } from '../src/sightIdentity';
import { ProfileProvider } from '../src/state/ProfileContext';
import { colors } from '../src/theme/tokens';

const ignoredTfliteNotice = 'Created TensorFlow Lite';
LogBox.ignoreLogs([
  ignoredTfliteNotice,
  `INFO: ${ignoredTfliteNotice}`,
  'XNNPACK delegate for CPU',
  /Created TensorFlow Lite/i,
  /INFO:\s*Created TensorFlow Lite/i,
  /XNNPACK delegate/i,
]);

// The TFLite / XNNPACK runtime emits startup notices via stderr every time the
// model initializes, which surface as intrusive LogBox banners. They are not
// actionable, so suppress them across every console level.
const isTfliteNotice = (value: unknown): boolean => {
  if (value == null) return false;
  const str =
    typeof value === 'string'
      ? value
      : String((value as { message?: unknown })?.message || (value as { stack?: unknown })?.stack || value);
  return (
    str.includes(ignoredTfliteNotice) ||
    str.includes('XNNPACK delegate') ||
    /Created TensorFlow Lite/i.test(str)
  );
};

const suppressTfliteStartupNotice =
  (method: (...args: unknown[]) => void) =>
  (...args: unknown[]) => {
    if (args.some(isTfliteNotice) || isTfliteNotice(args.map((v) => String(v)).join(' '))) return;
    method(...args);
  };

console.error = suppressTfliteStartupNotice(console.error);
console.warn = suppressTfliteStartupNotice(console.warn);
console.info = suppressTfliteStartupNotice(console.info);
console.log = suppressTfliteStartupNotice(console.log);

export default function RootLayout() {
  useEffect(() => {
    // Identity first: the device secret is what the server derives this
    // phone's Supermemory namespace from, and minting it lazily meant a new
    // namespace on every launch. Then resolve the server address once, so
    // every feature asks the same question and gets the same answer.
    initIdentity()
      .then(() => loadApiUrl())
      .catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.canvasDeep },
            animation: 'slide_from_right',
          }}
        />
      </ProfileProvider>
    </SafeAreaProvider>
  );
}
