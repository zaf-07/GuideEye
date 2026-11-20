// Whole signs, and things that are not signs, played to the movement reader the way a camera would
// show them: a hand comes up into the picture, does something, and goes away again.
const test = require('node:test');
const assert = require('node:assert');
const { ASPECT, face, film, scene, lerp, ease, hand } = require('./hands.cjs');
const motion = require('../sign-motion.js');

const MID = ASPECT / 2;            // picture centre, in picture heights
const FACE = face({ x: MID, chin: 0.5, height: 0.28 });
const below = { x: MID + 0.25, y: 1.12 };               // out of the bottom of the picture
const chest = { x: MID + 0.2, y: 0.82 };
const raise = (to, shape, ms = 450) => scene.move(ms, { ...below, shape }, { ...to, shape }, { shape });
const lower = (from, shape, ms = 450) => scene.move(ms, { ...from, shape }, { ...below, shape }, { shape });
const wave = (ms, at, shape, { swing = 0.16, beats = 3 } = {}) => ({ ms, hands: k => [{ ...at, shape, x: at.x + swing * Math.sin(k * beats * Math.PI) }] });
const wristWave = (ms, at, shape, { roll = 0.45, beats = 3 } = {}) => ({ ms, hands: k => [{ ...at, shape, roll: roll * Math.sin(k * beats * Math.PI) }] });
const nod = (ms, at, shape, { drop = 0.06, beats = 3 } = {}) => ({ ms, hands: k => [{ ...at, shape, y: at.y + drop * (1 - Math.cos(k * beats * 2 * Math.PI)) / 2 }] });
const wristNod = (ms, at, shape, { beats = 3 } = {}) => ({ ms, hands: k => [{ ...at, shape, pitch: 1 - 0.45 * (1 - Math.cos(k * beats * 2 * Math.PI)) / 2 }] });
const circle = (ms, at, shape, { radius = 0.07, turns = 2 } = {}) => ({ ms, hands: k => [{ ...at, shape,
  x: at.x + radius * Math.cos(k * turns * 2 * Math.PI) - radius, y: at.y + radius * Math.sin(k * turns * 2 * Math.PI) }] });
const out = scene.nothing(700);

const scenes = {
  'raise an open hand, hold it, lower it': { want: ['Five'], steps: [raise(chest, 'five'), scene.hold(1300, { ...chest, shape: 'five' }), lower(chest, 'five'), out] },
  'thank you: flat hand from the chin, down and out of view': { want: ['Thank you'], face: FACE, steps: [
    raise({ x: MID + 0.03, y: 0.72 }, 'flat'), scene.hold(200, { x: MID + 0.03, y: 0.72, shape: 'flat' }),
    scene.move(500, { x: MID + 0.03, y: 0.72, shape: 'flat' }, { x: MID + 0.06, y: 0.95, size: 0.16 }), lower({ x: MID + 0.06, y: 0.95 }, 'flat', 250), out] },
  'thank you, ending in a rest': { want: ['Thank you'], face: FACE, steps: [
    raise({ x: MID + 0.03, y: 0.72 }, 'flat'), scene.hold(200, { x: MID + 0.03, y: 0.72, shape: 'flat' }),
    scene.move(500, { x: MID + 0.03, y: 0.72, shape: 'flat' }, { x: MID + 0.06, y: 0.9, size: 0.16 }), scene.hold(1500, { x: MID + 0.06, y: 0.9, size: 0.16, shape: 'flat' }), lower({ x: MID + 0.06, y: 0.9 }, 'flat'), out] },
  'hello: a wave': { want: ['Hello'], face: FACE, steps: [raise({ x: MID + 0.3, y: 0.6 }, 'five'), wave(1500, { x: MID + 0.3, y: 0.6 }, 'five'), lower({ x: MID + 0.3, y: 0.6 }, 'five'), out] },
  'hello: a wave from the wrist': { want: ['Hello'], face: FACE, steps: [raise({ x: MID + 0.3, y: 0.6 }, 'five'), wristWave(1500, { x: MID + 0.3, y: 0.6 }, 'five'), lower({ x: MID + 0.3, y: 0.6 }, 'five'), out] },
  'hello: a long wave is said once, early': { want: ['Hello'], face: FACE, steps: [raise({ x: MID + 0.3, y: 0.6 }, 'five'), wave(4000, { x: MID + 0.3, y: 0.6 }, 'five', { beats: 9 }), lower({ x: MID + 0.3, y: 0.6 }, 'five'), out] },
  'hello: a salute': { want: ['Hello'], face: FACE, steps: [raise({ x: MID + 0.14, y: 0.6 }, 'flat'), scene.hold(200, { x: MID + 0.14, y: 0.6, shape: 'flat' }),
    scene.move(450, { x: MID + 0.14, y: 0.6, shape: 'flat' }, { x: MID + 0.38, y: 0.55 }), scene.hold(500, { x: MID + 0.38, y: 0.55, shape: 'flat' }), lower({ x: MID + 0.38, y: 0.55 }, 'flat'), out] },
  'yes: a nodding fist': { want: ['Yes'], face: FACE, steps: [raise(chest, 'fist'), nod(1300, chest, 'fist'), scene.hold(400, { ...chest, shape: 'fist' }), lower(chest, 'fist'), out] },
  'yes: nodding at the wrist': { want: ['Yes'], face: FACE, steps: [raise(chest, 'fist'), wristNod(1300, chest, 'fist'), scene.hold(400, { ...chest, shape: 'fist' }), lower(chest, 'fist'), out] },
  'no: fingers snapping onto the thumb twice': { want: ['No'], face: FACE, steps: [raise(chest, 'snapOpen'), scene.hold(250, { ...chest, shape: 'snapOpen' }),
    scene.hold(200, { ...chest, shape: 'snapShut' }), scene.hold(200, { ...chest, shape: 'snapOpen' }), scene.hold(250, { ...chest, shape: 'snapShut' }), lower(chest, 'snapShut'), out] },
  'no: a wagging finger': { want: ['No'], face: FACE, steps: [raise(chest, 'one'), wristWave(1400, chest, 'one', { roll: 0.35 }), lower(chest, 'one'), out] },
  'stop: a palm pushed at the camera, then held': { want: ['Stop'], face: FACE, steps: [raise(chest, 'five'), scene.hold(300, { ...chest, shape: 'five' }),
    scene.move(450, { ...chest, shape: 'five', size: 0.14 }, { ...chest, size: 0.2 }), scene.hold(2000, { ...chest, shape: 'five', size: 0.2 }), lower(chest, 'five'), out] },
  'please: a flat hand circling on the chest': { want: ['Please'], face: FACE, steps: [raise(chest, 'flat'), circle(1600, chest, 'flat'), scene.hold(300, { ...chest, shape: 'flat' }), lower(chest, 'flat'), out] },
  'sorry: a fist circling on the chest': { want: ['Sorry'], face: FACE, steps: [raise(chest, 'fist'), circle(1600, chest, 'fist'), scene.hold(300, { ...chest, shape: 'fist' }), lower(chest, 'fist'), out] },
  'help: a thumbs-up lifted': { want: ['Help'], face: FACE, steps: [raise({ ...chest, y: 0.92 }, 'thumbUp'), scene.hold(350, { ...chest, y: 0.92, shape: 'thumbUp' }),
    scene.move(500, { ...chest, y: 0.92, shape: 'thumbUp' }, { ...chest, y: 0.7 }), scene.hold(900, { ...chest, y: 0.7, shape: 'thumbUp' }), lower({ ...chest, y: 0.7 }, 'thumbUp'), out] },
  'sos: palm with the thumb in, then fingers close over it': { want: ['SOS'], face: FACE, steps: [raise(chest, 'flat'), scene.hold(600, { ...chest, shape: 'flat' }),
    scene.hold(1000, { ...chest, shape: 'fist' }), lower(chest, 'fist'), out] },
  'numbers one after another': { want: ['Two', 'Three'], steps: [raise(chest, 'two'), scene.hold(1100, { ...chest, shape: 'two' }), scene.hold(1100, { ...chest, shape: 'three' }), lower(chest, 'three'), out] },
  'a number shown briefly': { want: ['Two'], steps: [raise(chest, 'two'), scene.hold(600, { ...chest, shape: 'two' }), lower(chest, 'two'), out] },
  'a number held for a long time is said once': { want: ['Two'], steps: [raise(chest, 'two'), scene.hold(1500, { ...chest, shape: 'two' }),
    scene.move(200, { ...chest, shape: 'two' }, { x: chest.x + 0.03, y: chest.y - 0.02 }), scene.hold(1500, { x: chest.x + 0.03, y: chest.y - 0.02, shape: 'two' }), lower(chest, 'two'), out] },
  'i love you': { want: ['I love you'], steps: [raise(chest, 'ily'), scene.hold(1000, { ...chest, shape: 'ily' }), lower(chest, 'ily'), out] },
  'mother: thumb of an open hand on the chin': { want: ['Mother'], face: FACE, steps: [raise({ x: MID + 0.137, y: 0.646 }, 'five'), scene.hold(1100, { x: MID + 0.137, y: 0.646, shape: 'five' }), lower({ x: MID + 0.137, y: 0.646 }, 'five'), out] },
  'eat: bunched fingers at the mouth': { want: ['Eat'], face: FACE, steps: [raise({ x: MID + 0.014, y: 0.62 }, 'bunch'), scene.hold(1000, { x: MID + 0.014, y: 0.62, shape: 'bunch' }), lower({ x: MID + 0.014, y: 0.62 }, 'bunch'), out] },
  'more: two bunched hands meeting': { want: ['More'], face: FACE, steps: [
    { ms: 450, hands: k => [{ x: lerp(MID + 0.3, MID + 0.2, ease(k)), y: lerp(1.1, 0.8, ease(k)), shape: 'bunch' }, { x: lerp(MID - 0.3, MID - 0.2, ease(k)), y: lerp(1.1, 0.8, ease(k)), shape: 'bunch', left: true }] },
    { ms: 400, hands: k => [{ x: lerp(MID + 0.2, MID + 0.02, ease(k)), y: 0.8, shape: 'bunch' }, { x: lerp(MID - 0.2, MID - 0.02, ease(k)), y: 0.8, shape: 'bunch', left: true }] },
    { ms: 900, hands: () => [{ x: MID + 0.02, y: 0.8, shape: 'bunch' }, { x: MID - 0.02, y: 0.8, shape: 'bunch', left: true }] }, out] },
  'stop, then the palm stays up': { want: ['Stop'], face: FACE, steps: [raise(chest, 'flat'), scene.hold(300, { ...chest, shape: 'flat' }),
    scene.move(400, { ...chest, shape: 'flat', size: 0.14 }, { ...chest, size: 0.21 }), scene.hold(1200, { ...chest, shape: 'flat', size: 0.21 }),
    scene.move(150, { ...chest, shape: 'flat', size: 0.21 }, { x: chest.x + 0.02, y: chest.y + 0.015, size: 0.21 }), scene.hold(1500, { x: chest.x + 0.02, y: chest.y + 0.015, shape: 'flat', size: 0.21 }), lower(chest, 'flat'), out] },
  'a wave, then the hand stays up': { want: ['Hello'], face: FACE, steps: [raise({ x: MID + 0.3, y: 0.6 }, 'five'), wave(1300, { x: MID + 0.3, y: 0.6 }, 'five'), scene.hold(1800, { x: MID + 0.3, y: 0.6, shape: 'five' }), lower({ x: MID + 0.3, y: 0.6 }, 'five'), out] },
  'a pause with the hand up, then a wave': { want: ['Hello'], face: FACE, steps: [raise({ x: MID + 0.3, y: 0.6 }, 'five'), scene.hold(600, { x: MID + 0.3, y: 0.6, shape: 'five' }), wave(1300, { x: MID + 0.3, y: 0.6 }, 'five'), lower({ x: MID + 0.3, y: 0.6 }, 'five'), out] },
  'a wave the tracker loses for a moment': { want: ['Hello'], face: FACE, steps: [raise({ x: MID + 0.3, y: 0.6 }, 'five'), wave(700, { x: MID + 0.3, y: 0.6 }, 'five', { beats: 1.5 }), scene.nothing(200),
    { ms: 800, hands: k => [{ x: MID + 0.3 + 0.16 * Math.sin((1.5 + k * 1.5) * Math.PI), y: 0.6, shape: 'five' }] }, lower({ x: MID + 0.3, y: 0.6 }, 'five'), out] },
  'thank you with no face in view, ending in a rest': { want: ['Thank you'], steps: [
    raise({ x: MID + 0.03, y: 0.55 }, 'flat'), scene.hold(200, { x: MID + 0.03, y: 0.55, shape: 'flat' }),
    scene.move(500, { x: MID + 0.03, y: 0.55, shape: 'flat' }, { x: MID + 0.06, y: 0.75, size: 0.16 }), scene.hold(700, { x: MID + 0.06, y: 0.75, size: 0.16, shape: 'flat' }), lower({ x: MID + 0.06, y: 0.75 }, 'flat'), out] },
  'lowering an open hand from the chest is not thank you': { want: ['Four'], face: FACE, steps: [raise({ x: MID + 0.25, y: 0.8 }, 'flat'), scene.hold(1100, { x: MID + 0.25, y: 0.8, shape: 'flat' }),
    scene.move(450, { x: MID + 0.25, y: 0.8, shape: 'flat' }, { x: MID + 0.27, y: 0.98 }), scene.hold(900, { x: MID + 0.27, y: 0.98, shape: 'flat' }), lower({ x: MID + 0.27, y: 0.98 }, 'flat', 200), out] },
  'a hand raised towards the camera is not stop': { want: ['Five'], face: FACE, steps: [
    scene.move(600, { ...below, x: MID + 0.45, shape: 'five', size: 0.11 }, { x: MID + 0.45, y: 0.7, size: 0.17 }), scene.hold(1200, { x: MID + 0.45, y: 0.7, shape: 'five', size: 0.17 }), lower({ x: MID + 0.45, y: 0.7 }, 'five'), out] },
  'an open hand held out in front of the chin is not mother': { want: ['Five'], face: FACE, steps: [raise({ x: MID + 0.22, y: 0.74, size: 0.23 }, 'five'), scene.hold(1200, { x: MID + 0.22, y: 0.74, size: 0.23, shape: 'five' }), lower({ x: MID + 0.22, y: 0.74 }, 'five'), out] },
  'an open hand passing the chin is not mother': { want: [], face: FACE, steps: [scene.move(800, { x: MID + 0.45, y: 0.9, shape: 'five' }, { x: MID - 0.2, y: 0.45 }), out] },
  'a shaky camera still reads a wave': { want: ['Hello'], face: FACE, noise: 0.004, steps: [raise({ x: MID + 0.3, y: 0.6 }, 'five'), wave(1500, { x: MID + 0.3, y: 0.6 }, 'five'), lower({ x: MID + 0.3, y: 0.6 }, 'five'), out] },
  'a shaky camera still reads a held number once': { want: ['Three'], noise: 0.004, steps: [raise(chest, 'three'), scene.hold(3000, { ...chest, shape: 'three' }), lower(chest, 'three'), out] },
  'a still hand says its sign once however long it stays': { want: ['Five'], steps: [raise(chest, 'five'), scene.hold(6000, { ...chest, shape: 'five' }), lower(chest, 'five'), out] },
  'hello, then thank you, without lowering the hand': { want: ['Hello', 'Thank you'], face: FACE, steps: [
    raise({ x: MID + 0.3, y: 0.6 }, 'five'), wave(1400, { x: MID + 0.3, y: 0.6 }, 'five'),
    scene.move(350, { x: MID + 0.3, y: 0.6, shape: 'flat' }, { x: MID + 0.03, y: 0.72 }), scene.hold(220, { x: MID + 0.03, y: 0.72, shape: 'flat' }),
    scene.move(500, { x: MID + 0.03, y: 0.72, shape: 'flat' }, { x: MID + 0.06, y: 0.95, size: 0.16 }), lower({ x: MID + 0.06, y: 0.95 }, 'flat', 250), out] },
  'two fingers closing into a fist is not no': { want: ['Two'], face: FACE, steps: [raise(chest, 'two'), scene.hold(1000, { ...chest, shape: 'two' }),
    scene.hold(900, { ...chest, shape: 'fist' }), lower(chest, 'fist'), out] },
  'a thumbs-up brought into view is yes, not help': { want: ['Yes'], face: FACE, steps: [
    { ms: 400, hands: k => [{ x: MID + 0.25, y: 0.78 - 0.23 * k, shape: 'thumbUp' }] }, scene.hold(1100, { x: MID + 0.25, y: 0.55, shape: 'thumbUp' }),
    lower({ x: MID + 0.25, y: 0.55 }, 'thumbUp'), out] },
  'a hand passing through says nothing': { want: [], face: FACE, steps: [scene.move(700, { x: 0.05, y: 0.7, shape: 'five' }, { x: ASPECT - 0.05, y: 0.75 }), out] },
  'reaching up and straight back down says nothing': { want: [], face: FACE, steps: [raise({ x: MID + 0.3, y: 0.45 }, 'flat', 500), lower({ x: MID + 0.3, y: 0.45 }, 'flat', 500), out] },
  'scratching, shifting and fidgeting says nothing': { want: [], face: FACE, steps: [raise(chest, 'fist'),
    scene.move(400, { ...chest, shape: 'fist' }, { x: chest.x - 0.1, y: chest.y - 0.08 }), scene.move(350, { x: chest.x - 0.1, y: chest.y - 0.08, shape: 'fist' }, { x: chest.x + 0.05, y: chest.y + 0.02 }),
    scene.hold(300, { x: chest.x + 0.05, y: chest.y + 0.02, shape: 'fist' }), lower({ x: chest.x + 0.05, y: chest.y + 0.02 }, 'fist'), out] },
};

for (const [name, item] of Object.entries(scenes)) {
  test(name, () => {
    const result = film(motion.createReader(), item.steps, { face: item.face || null, noise: item.noise ?? 0.0015 });
    assert.deepStrictEqual(result.words, item.want);
  });
}

test('the reading does not depend on how fast the camera is', () => {
  for (const name of ['hello: a wave', 'thank you: flat hand from the chin, down and out of view', 'yes: a nodding fist',
    'stop: a palm pushed at the camera, then held', 'please: a flat hand circling on the chest', 'numbers one after another',
    'raise an open hand, hold it, lower it', 'reaching up and straight back down says nothing']) {
    for (const frameMs of [40, 100]) {
      const item = scenes[name];
      const result = film(motion.createReader(), item.steps, { face: item.face || null, frameMs });
      assert.deepStrictEqual(result.words, item.want, `${name} at ${Math.round(1000 / frameMs)} frames a second`);
    }
  }
});

test('a sign is said when the movement is over, not while the hand is on its way', () => {
  const at = { x: MID + 0.03, y: 0.72 }, end = { x: MID + 0.06, y: 0.9, size: 0.16 };
  const result = film(motion.createReader(), [raise(at, 'flat'), scene.hold(200, { ...at, shape: 'flat' }),
    scene.move(500, { ...at, shape: 'flat' }, end), scene.hold(1500, { ...end, shape: 'flat' })], { face: FACE });
  const strokeEnds = 1000 + 450 + 200 + 500;
  assert.deepStrictEqual(result.words, ['Thank you']);
  assert.ok(result.said[0].t >= strokeEnds, 'not before the hand has finished moving');
  assert.ok(result.said[0].t - strokeEnds < 700, 'and soon after it stops');
});

test('while a movement is going, its path is reported so it can be drawn', () => {
  const at = { x: MID + 0.3, y: 0.6 };
  const result = film(motion.createReader(), [raise(at, 'five'), wave(1500, at, 'five')], { face: FACE });
  const moving = result.views.filter(view => view.phase === 'moving');
  assert.ok(moving.length > 10);
  const longest = moving.reduce((best, view) => (view.trail.length > best.length ? view.trail : best), []);
  assert.ok(longest.length > 15);
  assert.ok(longest.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1.2));
});

test('a held handshape fills its progress before it is said', () => {
  const result = film(motion.createReader(), [raise(chest, 'two'), scene.hold(1300, { ...chest, shape: 'two' })]);
  const saidAt = result.said[0].t;
  const before = result.views.filter(view => view.phase === 'holding' && view.t < saidAt);
  assert.ok(before.length > 3);
  assert.ok(before.every(view => view.current === 'Two' && view.progress < 1));
  assert.ok(before[before.length - 1].progress > before[0].progress);
});

test('reset forgets a half-finished movement', () => {
  const reader = motion.createReader();
  film(reader, [raise({ x: MID + 0.3, y: 0.6 }, 'five'), wave(500, { x: MID + 0.3, y: 0.6 }, 'five', { beats: 1 })], { face: FACE });
  reader.reset();
  const result = film(reader, [scene.nothing(800)], { start: 9000 });
  assert.deepStrictEqual(result.words, []);
});

test('still handshapes keep their meanings', () => {
  const words = shape => motion.readWord(hand({ x: MID, y: 0.6, shape }).map(point => ({ ...point, x: point.x * ASPECT })));
  assert.deepStrictEqual(['one', 'two', 'three', 'flat', 'five', 'ily', 'ok', 'thumbUp', 'fist'].map(words),
    ['One', 'Two', 'Three', 'Four', 'Five', 'I love you', 'OK', 'Yes', '']);
});
