const test = require('node:test');
const assert = require('node:assert');
const { HandSignReader, readHandshape, handShape } = require('./load-ts.cjs')('src/handSigns.ts');

const CHAINS = { thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
const BASES = { index: [-0.03, -0.1], middle: [0, -0.1], ring: [0.03, -0.1], pinky: [0.06, -0.09] };

function hand(fingers, thumb = 'in', at = [0.5, 0.6]) {
  const points = Array.from({ length: 21 }, () => ({ x: at[0], y: at[1], z: 0 }));
  const place = (index, dx, dy) => { points[index] = { x: at[0] + dx, y: at[1] + dy, z: 0 }; };
  for (const [name, [bx, by]] of Object.entries(BASES)) {
    const [mcp, pip, dip, tip] = CHAINS[name];
    place(mcp, bx, by);
    if (fingers.includes(name)) {
      place(pip, bx, by - 0.035); place(dip, bx, by - 0.065); place(tip, bx, by - 0.09);
    } else {
      place(pip, bx, by - 0.03); place(dip, bx, by - 0.005); place(tip, bx, by + 0.02);
    }
  }
  place(1, -0.03, -0.03);
  place(2, -0.05, -0.05);
  if (thumb === 'up') { place(2, -0.06, -0.05); place(3, -0.08, -0.1); place(4, -0.09, -0.16); }
  else if (thumb === 'down') { place(2, -0.06, -0.05); place(3, -0.08, 0); place(4, -0.09, 0.06); }
  else if (thumb === 'out') { place(3, -0.085, -0.06); place(4, -0.12, -0.07); }
  else { place(3, -0.03, -0.07); place(4, -0.01, -0.08); }
  return points;
}

const ALL = ['index', 'middle', 'ring', 'pinky'];

function hold(reader, points, start, frames = 14) {
  let state;
  for (let i = 0; i < frames; i++) state = reader.feed(points, start + i * 66);
  return state;
}

test('finger states are read from the bend of each finger', () => {
  const shape = handShape(hand(['index', 'middle'], 'in'));
  assert.deepStrictEqual([shape.index, shape.middle, shape.ring, shape.pinky], ['up', 'up', 'down', 'down']);
  assert.strictEqual(shape.thumb, 'down');
});

test('still handshapes map to their signs', () => {
  assert.strictEqual(readHandshape(hand(['index', 'middle'], 'in')), 'Peace');
  assert.strictEqual(readHandshape(hand(['index', 'middle', 'ring'], 'in')), 'Water');
  assert.strictEqual(readHandshape(hand(['index'], 'in')), 'You');
  assert.strictEqual(readHandshape(hand(['index', 'pinky'], 'out')), 'I love you');
  assert.strictEqual(readHandshape(hand(ALL, 'out')), 'Hello');
  assert.strictEqual(readHandshape(hand(ALL, 'in')), 'SOS');
  assert.strictEqual(readHandshape(hand([], 'up')), 'Yes');
  assert.strictEqual(readHandshape(hand([], 'down')), 'No');
  assert.strictEqual(readHandshape(hand([], 'in')), '');
});

test('a held sign is committed once, and again only after the hand leaves', () => {
  const reader = new HandSignReader();
  const peace = hand(['index', 'middle'], 'in');
  let state = hold(reader, peace, 0, 20);
  assert.strictEqual(state.word, 'Peace');
  assert.strictEqual(state.count, 1);
  assert.ok(state.confidence >= 0.7);
  state = hold(reader, peace, 2000, 30);
  assert.strictEqual(state.count, 1);
  for (let i = 0; i < 12; i++) state = reader.feed(null, 5000 + i * 66);
  assert.strictEqual(state.word, '');
  state = hold(reader, peace, 7000, 20);
  assert.strictEqual(state.count, 2);
});

test('a different sign is committed without waiting for the hand to drop', () => {
  const reader = new HandSignReader();
  hold(reader, hand(['index', 'middle'], 'in'), 0, 20);
  const state = hold(reader, hand(['index', 'middle', 'ring'], 'in'), 2000, 24);
  assert.strictEqual(state.word, 'Water');
  assert.strictEqual(state.count, 2);
});

test('a moving hand is not read as a still handshape', () => {
  const reader = new HandSignReader();
  let state;
  for (let i = 0; i < 20; i++) {
    state = reader.feed(hand(['index', 'middle'], 'in', [0.2 + i * 0.03, 0.6]), i * 66);
  }
  assert.strictEqual(state.count, 0);
});

test('a waving open hand says hello', () => {
  const reader = new HandSignReader();
  let state = { count: 0, word: '' };
  for (let i = 0; i < 40 && state.count === 0; i++) {
    const x = 0.5 + 0.08 * Math.sin(i / 2);
    state = reader.feed(hand(ALL, 'out', [x, 0.6]), i * 66);
  }
  assert.strictEqual(state.word, 'Hello');
  assert.strictEqual(state.count, 1);
  assert.strictEqual(state.confidence, 0.92);
});

test('a nodding fist says yes', () => {
  const reader = new HandSignReader();
  let state = { count: 0, word: '' };
  for (let i = 0; i < 40 && state.count === 0; i++) {
    const y = 0.6 + 0.04 * Math.sin(i / 1.5);
    state = reader.feed(hand([], 'in', [0.5, y]), i * 66);
  }
  assert.strictEqual(state.word, 'Yes');
});

test('missing or partial landmarks are ignored', () => {
  const reader = new HandSignReader();
  assert.deepStrictEqual(reader.feed(undefined, 0), { word: '', confidence: 0, progress: 0, count: 0 });
  assert.strictEqual(reader.feed([{ x: 0, y: 0 }], 66).count, 0);
});
