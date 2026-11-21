const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const voice = loadTs('src/voice/commands.ts');

test('the wake word is required and stripped', () => {
  assert.deepStrictEqual(voice.extractCommand('Guide, take me to Safeway'), { kind: 'command', text: 'take me to Safeway' });
  assert.deepStrictEqual(voice.extractCommand('hey guide text Tom I am late'), { kind: 'command', text: 'text Tom I am late' });
  assert.deepStrictEqual(voice.extractCommand('GuideEye where am I'), { kind: 'command', text: 'where am I' });
  assert.deepStrictEqual(voice.extractCommand('Guide'), { kind: 'wake' });
  assert.strictEqual(voice.extractCommand('take me to Safeway'), null);
  assert.strictEqual(voice.extractCommand('the tour guided us'), null);
  assert.strictEqual(voice.extractCommand('   '), null);
});

test('a bare yes or no only counts while something waits for confirmation', () => {
  assert.strictEqual(voice.extractCommand('yes'), null);
  assert.deepStrictEqual(voice.extractCommand('yes', { awaitingConfirm: true }), { kind: 'command', text: 'yes' });
  assert.deepStrictEqual(voice.extractCommand('no cancel it', { awaitingConfirm: true }), { kind: 'command', text: 'no cancel it' });
  assert.strictEqual(voice.extractCommand('yesterday I went out', { awaitingConfirm: true }), null);
  assert.strictEqual(voice.extractCommand('send it to everyone I know right now please thanks', { awaitingConfirm: true }), null);
});

test('a follow-up after the wake word needs no second wake word', () => {
  assert.deepStrictEqual(voice.extractCommand('take me home', { followUp: true }), { kind: 'command', text: 'take me home' });
});

test('screen commands stay on the phone', () => {
  assert.strictEqual(voice.localCommand('open settings').href, '/main/settings');
  assert.strictEqual(voice.localCommand('open camera').href, '/camera?mode=scene&pocket=true');
  assert.strictEqual(voice.localCommand('go to the home screen').href, '/main');
  assert.strictEqual(voice.localCommand('go back').type, 'back');
  assert.strictEqual(voice.localCommand('stop talking').type, 'quiet');
  assert.strictEqual(voice.localCommand('repeat that').type, 'repeat');
  assert.strictEqual(voice.localCommand('help').type, 'help');
});

test('assistant requests are not swallowed by screen commands', () => {
  for (const text of [
    'take me home', 'take me back', 'go back to the start', 'open whatsapp', 'repeat the directions',
    'stop navigation', 'text Tom I am on my way', 'what is around me', 'where am I', 'call Tim',
    'what is in front of me', 'read this', 'remember this',
  ]) {
    assert.strictEqual(voice.localCommand(text), null, text);
  }
});

test('delayed requests', () => {
  assert.deepStrictEqual(voice.parseDelay('in 15 minutes take me home'), { seconds: 900, command: 'take me home' });
  const safeway = voice.extractCommand("Guide, I'm going to Safeway in fifteen minutes");
  assert.deepStrictEqual(voice.parseDelay(safeway.text), { seconds: 900, command: 'take me to Safeway' });
  assert.deepStrictEqual(voice.parseDelay("in fifteen minutes we're going home"), { seconds: 900, command: "we're going home" });
  assert.deepStrictEqual(voice.parseDelay('take me to Safeway in twenty five minutes'), { seconds: 1500, command: 'take me to Safeway' });
  assert.deepStrictEqual(voice.parseDelay('in half an hour text Tom I am home'), { seconds: 1800, command: 'text Tom I am home' });
  assert.deepStrictEqual(voice.parseDelay('after an hour, take me home'), { seconds: 3600, command: 'take me home' });
});

test('things that only look like delays go to the assistant untouched', () => {
  assert.strictEqual(voice.parseDelay('remind me in 15 minutes to go home'), null);
  assert.strictEqual(voice.parseDelay('set a timer for ten minutes'), null);
  assert.strictEqual(voice.parseDelay('text Tom I will be there in 15 minutes'), null);
  assert.strictEqual(voice.parseDelay('take me home'), null);
  assert.strictEqual(voice.parseDelay('in the minutes take me home'), null);
  assert.strictEqual(voice.parseDelay('in 900 hours take me home'), null);
});

test('numbers and spoken delays', () => {
  assert.strictEqual(voice.parseNumber('forty five'), 45);
  assert.strictEqual(voice.parseNumber('a'), 1);
  assert.strictEqual(voice.parseNumber('soon'), null);
  assert.strictEqual(voice.spokenDelay(900), '15 minutes');
  assert.strictEqual(voice.spokenDelay(60), '1 minute');
  assert.strictEqual(voice.spokenDelay(45), '45 seconds');
});

const frame = loadTs('src/voice/frame.ts');

test('requests about what the camera sees ask for a frame', () => {
  assert.strictEqual(frame.needsCamera('Where is the door?'), true);
  assert.strictEqual(frame.needsCamera('Find my keys in the camera view'), true);
  for (const text of ["what's in front of me", 'Read the text', 'remember this', 'pay this', 'pay', 'what is this', 'explain this letter', 'what does this say']) {
    assert.strictEqual(frame.needsCamera(text), true, text);
  }
  for (const text of ['take me home', 'text Tom I am on my way', 'where am I', 'buy me a coffee', 'set a timer for ten minutes', 'where are my keys', 'call Tim']) {
    assert.strictEqual(frame.needsCamera(text), false, text);
  }
});

test('the frame source hands out a fresh frame and falls back to the last one', async () => {
  assert.strictEqual(await frame.captureFrame(), null);
  assert.strictEqual(await frame.waitForFrameSource(10), false);
  const waiting = frame.waitForFrameSource(1000);
  frame.setFrameSource(async () => 'file://fresh.jpg');
  assert.strictEqual(await waiting, true);
  assert.strictEqual(await frame.captureFrame(), 'file://fresh.jpg');
  frame.setFrameSource(async () => { throw new Error('camera busy'); });
  frame.noteFrame('file://last.jpg');
  assert.strictEqual(await frame.captureFrame(), 'file://last.jpg');
  frame.setFrameSource(null);
  assert.strictEqual(frame.hasFrameSource(), false);
  assert.strictEqual(await frame.captureFrame(), null);
});
