// What the phone's detector sees is sent to the assistant's memory as short text.
const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const frame = loadTs('src/voice/frame.ts');

test('one entry per kind of object, nearest first, lower case', () => {
  const seen = frame.summarizeSeen([
    { label: 'Chair', position: 'On your left', distance_m: 3.1 },
    { label: 'person', position: 'ahead', distance_m: 1.2 },
    { label: 'chair', position: 'ahead', distance_m: 2 },
    { label: '', position: 'ahead' },
    { label: 'laptop', position: 'on your right' },
  ]);
  assert.deepStrictEqual(seen, [
    { label: 'person', position: 'ahead', distance_m: 1.2 },
    { label: 'chair', position: 'ahead', distance_m: 2 },
    { label: 'laptop', position: 'on your right', distance_m: null },
  ]);
});

test('the list is capped', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ label: `thing ${index}`, position: 'ahead' }));
  assert.strictEqual(frame.summarizeSeen(many).length, 12);
});

test('what was seen is only offered while it is current', () => {
  frame.noteSeenObjects([{ label: 'chair', position: 'ahead', distance_m: 2 }]);
  assert.strictEqual(frame.seenObjects().length, 1);
  assert.strictEqual(frame.seenObjects(-1).length, 0);
});
