// Proves the optional-native-module shims survive a missing module, which is
// what Expo Go presents, and what any build with an unlinked module presents.
// Each require is forced to throw the way the real native binding does.
//
// `Module._resolveFilename` is patched for the whole file and deliberately not
// restored: `node --test` runs each test file in its own process, so the
// breakage cannot leak into another file's requires.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const realResolve = Module._resolveFilename;
const BROKEN = new Set(['onnxruntime-react-native', 'expo-speech-recognition']);
Module._resolveFilename = function (request, ...rest) {
  if (BROKEN.has(request)) {
    const error = new Error(`Cannot find native module '${request}'`);
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  return realResolve.call(this, request, ...rest);
};

const loadTs = require('./load-ts.cjs');

test('speech recognition degrades to an unavailable stub', () => {
  const sr = loadTs('src/speechRecognition.ts');
  assert.strictEqual(sr.speechRecognitionAvailable(), false);
  assert.strictEqual(sr.ExpoSpeechRecognitionModule.isRecognitionAvailable(), false);
  assert.doesNotThrow(() => sr.ExpoSpeechRecognitionModule.stop());
  assert.doesNotThrow(() => sr.useSpeechRecognitionEvent('result', () => {}));
});

test('a missing ONNX runtime reports no local detector instead of throwing', () => {
  const detector = loadTs('src/detector.native.ts', {
    'expo-asset': { Asset: {} },
    'jpeg-js': { decode: () => ({}) },
    './blockedView': { analyzeBlockedView: () => null },
    '../assets/models/yolox_nano.onnx': 1,
  });
  assert.strictEqual(detector.hasLocalDetector(), false);
});

test('a linked ONNX runtime enables the local detector', () => {
  const detector = loadTs('src/detector.native.ts', {
    'onnxruntime-react-native': {
      InferenceSession: { create: async () => ({ run: async () => ({}) }) },
      Tensor: class Tensor {},
    },
    'expo-asset': { Asset: {} },
    'jpeg-js': { decode: () => ({}) },
    './blockedView': { analyzeBlockedView: () => null },
    '../assets/models/yolox_nano.onnx': 1,
  });
  assert.strictEqual(detector.hasLocalDetector(), true);
});

test('detection returns unavailable rather than crashing the camera route', async () => {
  const detector = loadTs('src/detector.native.ts', {
    'expo-asset': { Asset: {} },
    'jpeg-js': { decode: () => ({}) },
    './blockedView': { analyzeBlockedView: () => null },
    '../assets/models/yolox_nano.onnx': 1,
  });
  const result = await detector.detectObjects('file:///frame.jpg');
  assert.deepStrictEqual(result, { available: false, detections: [] });
});
