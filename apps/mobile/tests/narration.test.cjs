// What scene assist says out loud, and when it stays quiet.
const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const { Narrator, similarity } = loadTs('src/narration.ts');

const chair = { key: 'chair@ahead', text: 'Chair ahead.', kind: 'objects' };
const person = { key: 'chair@ahead|person@left', text: 'Chair ahead. Person on your left.', kind: 'objects' };
const empty = { key: 'empty_path', text: 'Nothing recognized ahead.', kind: 'empty' };

test('a change is spoken once it has settled, and only once', () => {
  const narrator = new Narrator();
  assert.strictEqual(narrator.offer(chair, 10_000), null, 'one frame is not enough');
  assert.strictEqual(narrator.offer(chair, 10_700), 'Chair ahead.');
  assert.strictEqual(narrator.offer(chair, 11_200), null);
  assert.strictEqual(narrator.offer(chair, 40_000), null, 'the same scene is never repeated on its own');
});

test('a single flickering frame is ignored', () => {
  const narrator = new Narrator();
  narrator.offer(chair, 10_000);
  narrator.offer(chair, 10_700);
  assert.strictEqual(narrator.offer(person, 14_000), null);
  assert.strictEqual(narrator.offer(chair, 14_500), null, 'back to what was already said');
  assert.strictEqual(narrator.offer(person, 15_000), null, 'the change has to hold');
  assert.strictEqual(narrator.offer(person, 15_700), 'Chair ahead. Person on your left.');
});

test('phrases are spaced out and a scene flipping back and forth is not chanted', () => {
  const narrator = new Narrator();
  narrator.offer(chair, 10_000);
  assert.ok(narrator.offer(chair, 10_700));
  narrator.offer(person, 11_000);
  assert.strictEqual(narrator.offer(person, 11_800), null, 'too soon after the last phrase');
  assert.ok(narrator.offer(person, 13_300));
  narrator.offer(chair, 16_000);
  assert.strictEqual(narrator.offer(chair, 16_700), null, 'said a few seconds ago');
  narrator.offer(person, 20_000);
  assert.strictEqual(narrator.offer(person, 20_700), null);
  // Long enough later it is news again.
  narrator.offer(chair, 40_000);
  assert.strictEqual(narrator.offer(chair, 40_700), 'Chair ahead.');
});

test('nothing is said while the assistant has the floor, then the change is caught up', () => {
  const narrator = new Narrator();
  assert.strictEqual(narrator.offer(chair, 10_000, true), null);
  assert.strictEqual(narrator.offer(chair, 12_000, true), null);
  assert.strictEqual(narrator.offer(chair, 12_500, false), 'Chair ahead.');
});

test('"nothing recognised" is never volunteered', () => {
  const narrator = new Narrator();
  assert.strictEqual(narrator.offer(empty, 10_000), null);
  assert.strictEqual(narrator.offer(empty, 20_000), null);
  assert.strictEqual(narrator.offer(null, 20_000), null);
});

test('something coming closer skips the settle delay', () => {
  const narrator = new Narrator();
  const approaching = { key: 'approach:person@ahead', text: 'Careful, person coming closer.', kind: 'objects', urgent: true };
  assert.strictEqual(narrator.offer(approaching, 10_000), 'Careful, person coming closer.');
  assert.strictEqual(narrator.offer(approaching, 10_500), null);
});

test('"the camera cannot see" is repeated, but rarely', () => {
  const narrator = new Narrator();
  const covered = { key: 'view_covered', text: "The camera can't see.", kind: 'blocked' };
  narrator.offer(covered, 10_000);
  assert.ok(narrator.offer(covered, 10_700));
  assert.strictEqual(narrator.offer(covered, 20_000), null);
  assert.ok(narrator.offer(covered, 41_000));
});

test('a description is spoken when the scene is new, not when it is reworded', () => {
  const narrator = new Narrator();
  const hallway = { key: 'a', text: 'A long hallway with a wooden door on the right side.', kind: 'description' };
  const reworded = { key: 'b', text: 'There is a hallway, and a wooden door on the right.', kind: 'description' };
  const kitchen = { key: 'c', text: 'A kitchen counter with a kettle and two mugs beside the sink.', kind: 'description' };
  assert.strictEqual(narrator.offer(hallway, 10_000), hallway.text, 'the first one is said straight away');
  assert.strictEqual(narrator.offer(kitchen, 15_000), null, 'descriptions are spaced out');
  assert.strictEqual(narrator.offer(reworded, 30_000), null, 'same scene in other words');
  assert.strictEqual(narrator.offer(kitchen, 31_000, true), null, 'not over the assistant');
  assert.strictEqual(narrator.offer(kitchen, 32_000), kitchen.text);
  assert.ok(similarity(hallway.text, reworded.text) >= 0.5);
  assert.ok(similarity(hallway.text, kitchen.text) < 0.2);
});
