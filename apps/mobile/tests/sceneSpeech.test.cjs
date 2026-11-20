// The sentence built from on-device detections, and the key that says "the scene changed".
const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const vision = loadTs('src/vision.ts', {
  './voice/frame': { noteFrame: () => {}, isAssistantBusy: () => false },
  './api': { apiUrl: () => '', isAllowedEndpoint: () => true, NoServerError: class NoServerError extends Error {} },
  './detector': {
    detectObjects: async () => ({ available: false, detections: [] }),
    detectVideoFrame: () => null,
    localDetectorBackend: () => null,
    warmUpDetector: async () => {},
  },
  './frameFiles': { FrameJanitor: class { track() {} clear() {} } },
});

const item = (label, direction, distance_m, extra = {}) => ({
  label, direction, distance_m, confidence: 0.8, x: 0.4, y: 0.4, width: 0.2, height: 0.3, ...extra,
});

test('objects are named with where they are, the way a person would say it', () => {
  const result = vision.synthesizeLocalSceneResult([item('chair', 'left', 2.3), item('person', 'ahead', 0.9)], '', 'scene');
  assert.strictEqual(result.speech, 'Person ahead, very close. Chair on your left, about 2.5 meters.');
  assert.strictEqual(result.kind, 'objects');
  assert.strictEqual(result.summary, 'Person ahead, very close');
});

test('several of the same thing are counted, not listed', () => {
  const result = vision.synthesizeLocalSceneResult([item('person', 'ahead', 3.2), item('person', 'ahead', 4.1), item('bus', 'right', 7)], '', 'scene');
  assert.strictEqual(result.speech, '2 people ahead, about 3 meters. Bus on your right.');
});

test('the scene key ignores a wobbling distance but notices something very close', () => {
  const at = (distance) => vision.synthesizeLocalSceneResult([item('chair', 'ahead', distance)], '', 'scene').scene_key;
  assert.strictEqual(at(2.3), at(2.6));
  assert.strictEqual(at(2.3), at(4));
  assert.notStrictEqual(at(2.3), at(0.9));
});

test('something approaching is said first and marked urgent', () => {
  const result = vision.synthesizeLocalSceneResult([item('person', 'ahead', 1.8, { is_approaching: true })], '', 'scene');
  assert.ok(result.speech.startsWith('Careful, person coming closer.'));
  assert.strictEqual(result.urgency, 'high');
});

test('an empty view is not announced and never called clear', () => {
  const result = vision.synthesizeLocalSceneResult([], '', 'scene');
  assert.strictEqual(result.kind, 'empty');
  assert.strictEqual(result.should_speak, false);
  assert.doesNotMatch(result.speech, /clear/i);
});

test('a covered lens is reported as such', () => {
  const blocked = { columns: Array(12).fill(true), centers: Array.from({ length: 12 }, (_, i) => (i + 0.5) / 12), covered: true, dark: false };
  const result = vision.synthesizeLocalSceneResult([], '', 'scene', blocked);
  assert.strictEqual(result.kind, 'blocked');
  assert.match(result.speech, /can't see/);
});
