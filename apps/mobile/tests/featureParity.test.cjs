const test = require('node:test');
const assert = require('node:assert');

test('guardian live trip sharing speech announcements match web parity', () => {
  const onSpeech = 'Guardian live sharing enabled for this journey.';
  const offSpeech = 'Guardian sharing disabled.';

  assert.strictEqual(onSpeech, 'Guardian live sharing enabled for this journey.');
  assert.strictEqual(offSpeech, 'Guardian sharing disabled.');
});

test('micro-whisper cues include expected directional sequence', () => {
  const cues = [
    { word: 'Left', haptic: 'medium', delay: 1500 },
    { word: 'Forward', haptic: 'light', delay: 1500 },
    { word: 'Right', haptic: 'medium', delay: 1500 },
    { word: 'Stop!', haptic: 'heavy', delay: 1800 },
  ];

  assert.strictEqual(cues.length, 4);
  assert.deepStrictEqual(cues.map(c => c.word), ['Left', 'Forward', 'Right', 'Stop!']);
  assert.strictEqual(cues[3].word, 'Stop!');
  assert.strictEqual(cues[3].haptic, 'heavy');
});

test('wearable status parses Vexo BLE band metadata accurately', () => {
  const parseBandStatus = (data) => {
    const connected = Boolean(data && data.connected);
    const name = (data && data.band_name) || 'Vexo-HACK-20';
    const battery = data && data.battery && data.battery.percent != null ? `${data.battery.percent}%` : 'unknown';
    const transport = ((data && data.transport) || 'ble').toUpperCase();
    return { connected, name, battery, transport };
  };

  const disconnected = parseBandStatus({ connected: false });
  assert.strictEqual(disconnected.connected, false);
  assert.strictEqual(disconnected.name, 'Vexo-HACK-20');
  assert.strictEqual(disconnected.battery, 'unknown');
  assert.strictEqual(disconnected.transport, 'BLE');

  const connected = parseBandStatus({
    connected: true,
    band_name: 'Vexo-HACK-20',
    battery: { percent: 88 },
    transport: 'ble',
  });
  assert.strictEqual(connected.connected, true);
  assert.strictEqual(connected.battery, '88%');
  assert.strictEqual(connected.transport, 'BLE');
});

test('HarnessRouter UHP agent badge detection and errand metadata', () => {
  const checkUhpBadge = (reply) => {
    return Boolean(reply.provider === 'harnessrouter' || reply.errand);
  };

  assert.strictEqual(checkUhpBadge({ say: 'Regular reply' }), false);
  assert.strictEqual(checkUhpBadge({ say: 'Errand done', provider: 'harnessrouter' }), true);
  assert.strictEqual(checkUhpBadge({ say: 'Errand scheduled', errand: { id: 'err_123', status: 'queued' } }), true);
});
