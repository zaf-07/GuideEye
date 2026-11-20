// Full permission: what GuideEye does without asking, and what it never does.
const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const { actsWithoutAsking } = loadTs('src/voice/permission.ts');
const profile = loadTs('src/state/profile.ts');

test('full permission is off until the user turns it on', () => {
  assert.strictEqual(profile.DEFAULT_PROFILE.fullPermission, false);
  assert.strictEqual(profile.DEFAULT_PROFILE.voiceControl, true);
});

test('with full permission, calls and messages go ahead', () => {
  assert.strictEqual(actsWithoutAsking({ intent: 'message', confirm: 'Send to Mom on WhatsApp?' }, true), true);
  assert.strictEqual(actsWithoutAsking({ intent: 'call', confirm: 'Call Tim?' }, true), true);
});

test('a payment always waits for a yes', () => {
  for (const intent of ['pay_quote', 'scan_pay', 'pay_waiting']) {
    assert.strictEqual(actsWithoutAsking({ intent, confirm: 'Pay $3.50 for one medium coffee?' }, true), false);
  }
});

test('without full permission nothing is confirmed for the user', () => {
  assert.strictEqual(actsWithoutAsking({ intent: 'message', confirm: 'Send to Mom on WhatsApp?' }, false), false);
  assert.strictEqual(actsWithoutAsking({ intent: 'call', confirm: 'Call Tim?' }, undefined), false);
});

test('a reply that asks nothing, or changes a saved address, is left alone', () => {
  assert.strictEqual(actsWithoutAsking({ intent: 'message', confirm: null }, true), false);
  assert.strictEqual(actsWithoutAsking({ intent: 'place_set', confirm: 'Save 450 Serra Mall as your home?' }, true), false);
});

test('a command the language model worked out is always read back first', () => {
  assert.strictEqual(actsWithoutAsking({ intent: 'message', confirm: 'Send to Mom on WhatsApp?', inferred: true }, true), false);
  assert.strictEqual(actsWithoutAsking({ intent: 'call', confirm: 'Call Tim?', inferred: false }, true), true);
});

test('a question from the assistant keeps the microphone open for the answer', () => {
  const { expectsAnswer } = loadTs('src/voice/permission.ts');
  for (const intent of ['contact_edit_waiting', 'contact_waiting', 'clarify', 'place_set']) {
    assert.strictEqual(expectsAnswer({ intent }), true, intent);
  }
  for (const intent of ['see', 'chat', 'contact_renamed', 'pay_quote']) {
    assert.strictEqual(expectsAnswer({ intent }), false, intent);
  }
  assert.strictEqual(expectsAnswer(null), false);
});
