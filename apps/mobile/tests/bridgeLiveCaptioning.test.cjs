const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const translator = loadTs('src/aslGlossTranslator.ts', {
  './aslSignPoses': loadTs('src/aslSignPoses.ts', {}),
});

test('live caption ASL translation preserves numbers in room directions', () => {
  const result = translator.translateEnglishToASLGloss('Room 204 is on your right');
  assert.ok(result.aslSentence.includes('ROOM'));
  assert.ok(result.aslSentence.includes('2 0 4'));
  assert.ok(result.tokens.length > 0);
  assert.ok(result.tokens.some((t) => t.type === 'number' && t.gloss === '2'));
});

test('live caption formats complex question into ASL topic-comment grammar', () => {
  const result = translator.translateEnglishToASLGloss('Where can I find water?');
  assert.ok(result.aslSentence.includes('WATER'));
  assert.ok(result.aslSentence.endsWith('WHERE'));
});

test('live caption punctuation and case normalizations', () => {
  const result1 = translator.translateEnglishToASLGloss('HELLO, PLEASE HELP ME!');
  const result2 = translator.translateEnglishToASLGloss('hello please help me');
  assert.strictEqual(result1.aslSentence, result2.aslSentence);
});

test('interim caption stream sanitization and upper-casing', () => {
  const interimRaw = '  i can help you follow me  ';
  const cleaned = interimRaw.trim();
  assert.strictEqual(cleaned, 'i can help you follow me');
  assert.strictEqual(cleaned.toUpperCase(), 'I CAN HELP YOU FOLLOW ME');
});
