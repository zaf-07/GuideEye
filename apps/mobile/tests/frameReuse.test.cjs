// The assistant borrows the scan loop's frame instead of asking the camera for a second photo.
const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

test('a frame the scan loop just took is reused; an old one triggers a new capture', async () => {
  const frame = loadTs('src/voice/frame.ts');
  let captures = 0;
  frame.setFrameSource(async () => {
    captures += 1;
    return 'file:///fresh.jpg';
  });
  frame.noteFrame('file:///loop.jpg');
  assert.strictEqual(await frame.captureFrame(), 'file:///loop.jpg');
  assert.strictEqual(captures, 0);
  assert.strictEqual(frame.recentFrame(), 'file:///loop.jpg');

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 4000;
    assert.strictEqual(await frame.captureFrame(), 'file:///fresh.jpg');
    assert.strictEqual(captures, 1);
    assert.strictEqual(frame.recentFrame(3000), null);
  } finally {
    Date.now = realNow;
  }
});

test('attention and busy flags are plain shared state', () => {
  const frame = loadTs('src/voice/frame.ts');
  assert.strictEqual(frame.isAssistantBusy(), false);
  frame.setAssistantBusy(true);
  assert.strictEqual(frame.isAssistantBusy(), true);
  frame.setAssistantBusy(false);
  frame.holdAttention(5000);
  assert.strictEqual(frame.attentionHeld(), true);
  frame.holdAttention(0);
  assert.strictEqual(frame.attentionHeld(), false);
});
