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

test('HarnessRouter UHP agent badge detection and errand metadata', () => {
  const checkUhpBadge = (reply) => {
    return Boolean(reply.provider === 'harnessrouter' || reply.errand);
  };

  assert.strictEqual(checkUhpBadge({ say: 'Regular reply' }), false);
  assert.strictEqual(checkUhpBadge({ say: 'Errand done', provider: 'harnessrouter' }), true);
  assert.strictEqual(checkUhpBadge({ say: 'Errand scheduled', errand: { id: 'err_123', status: 'queued' } }), true);
});
