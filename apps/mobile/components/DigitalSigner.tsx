import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Button } from '../src/components';
import { signerDocument } from './signerDocument';

type PlaybackState = 'idle' | 'loading' | 'playing' | 'finished' | 'error';

export default function DigitalSigner({ text }: { text: string }) {
  const [state, setState] = useState<PlaybackState>('idle');
  const [attempt, setAttempt] = useState(0);
  const viewer = useRef<WebView<object>>(null);
  const source = useMemo(() => ({ html: signerDocument(text) }), [text]);
  const showPlayer = state === 'loading' || state === 'playing' || state === 'finished';

  useEffect(() => {
    if (state !== 'loading') return;
    const timeout = setTimeout(() => setState('error'), 30000);
    return () => clearTimeout(timeout);
  }, [state]);

  const play = () => {
    if (Platform.OS === 'web') {
      void Linking.openURL(`https://three.ws/sign-language?say=${encodeURIComponent(text.trim())}`)
        .catch(() => setState('error'));
    } else if (showPlayer) {
      viewer.current?.injectJavaScript('window.guideEyeReplay?.(); true;');
    } else {
      setAttempt((value) => value + 1);
      setState('loading');
    }
  };

  return (
    <View style={styles.container}>
      {showPlayer ? (
        <View style={styles.stage}>
          <WebView<object> key={attempt} ref={viewer} source={source}
            style={styles.webView}
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
            scrollEnabled={false} bounces={false} mediaCapturePermissionGrantType="deny"
            onError={() => setState('error')}
            onMessage={({ nativeEvent }) => {
              try {
                const { type } = JSON.parse(nativeEvent.data);
                if (type === 'playing' || type === 'finished' || type === 'error') setState(type);
              } catch {}
            }}
          />
        </View>
      ) : null}
      <Text style={styles.text} accessibilityLiveRegion="polite">
        {state === 'error' ? 'The avatar could not play. Try again or switch to Sign cards.' :
          state === 'loading' ? 'Loading avatar and signs…' :
          state === 'playing' ? 'Signing…' :
          state === 'finished' ? 'Playback finished.' :
          'Playing sends this caption to three.ws.'}
      </Text>
      <Button label={showPlayer ? 'Replay signs' : state === 'error' ? 'Retry 3D signer' : 'Play with 3D signer'}
        disabled={!text.trim() || state === 'loading'} onPress={play} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, gap: 12 },
  stage: { width: '100%', aspectRatio: 6 / 5, maxHeight: 350, overflow: 'hidden', borderRadius: 12, backgroundColor: '#17151c' },
  webView: { flex: 1, backgroundColor: 'transparent' },
  text: { color: '#fff' },
});
