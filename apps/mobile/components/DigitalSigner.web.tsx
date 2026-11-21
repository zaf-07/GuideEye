import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { signerDocument } from '../../../web/signer-document';
import { Button } from '../src/components';

export default function DigitalSigner({ text }: { text: string }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => signerDocument(text), [text]);

  useEffect(() => {
    if (!attempt) return;
    const timeout = window.setTimeout(() => setStatus('The avatar did not load. Try Replay signs.'), 30000);
    const onStatus = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== 'guideeye-signer') return;
      const labels: Record<string, string> = {
        playing: 'Signing…',
        finished: 'Playback finished.',
        error: 'The avatar could not play. Try again or switch to Sign cards.',
      };
      if (!Object.hasOwn(labels, event.data.type)) return;
      window.clearTimeout(timeout);
      setStatus(labels[event.data.type]);
    };
    window.addEventListener('message', onStatus);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onStatus);
    };
  }, [attempt]);

  return (
    <View style={{ padding: 12, gap: 12 }}>
      {attempt > 0 && <iframe key={attempt} ref={frame} title="3D sign language avatar" sandbox="allow-scripts"
        srcDoc={html} style={{ display: 'block', width: '100%', aspectRatio: '6 / 5', maxHeight: 350, border: 0, borderRadius: 12, background: '#17151c' }} />}
      <Text style={{ color: '#fff' }} accessibilityLiveRegion="polite">
        {status || 'Playing sends this caption to three.ws.'}
      </Text>
      <Button label={attempt ? 'Replay signs' : 'Play with 3D signer'} disabled={!text.trim()} onPress={() => {
        setStatus('Loading avatar and signs…');
        setAttempt((value) => value + 1);
      }} />
    </View>
  );
}
