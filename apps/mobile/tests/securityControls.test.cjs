const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const loadTs = require('./load-ts.cjs');

const mockCrypto = {
  getRandomBytes: (size) => crypto.randomBytes(size),
};

const identity = loadTs('src/sightIdentity.ts', {
  'expo-crypto': mockCrypto,
});


const asyncStorageStub = {
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
};
const constantsStub = { default: { expoConfig: {}, expoGoConfig: {} } };

const api = loadTs('src/api.ts', {
  '@react-native-async-storage/async-storage': asyncStorageStub,
  'expo-constants': constantsStub,
  './sightIdentity': { getSightHeaders: () => ({}) },
});

/** The address resolver, stubbed so vision.ts can be loaded on its own. */
const apiStub = {
  apiUrl: () => '',
  isAllowedEndpoint: api.isAllowedEndpoint,
  NoServerError: class NoServerError extends Error {},
};

const vision = loadTs('src/vision.ts', {
  'expo-crypto': mockCrypto,
  './api': apiStub,
  './detector': {
    detectObjects: () => Promise.resolve([]),
    detectVideoFrame: () => Promise.resolve(null),
    localDetectorBackend: () => 'stub',
    warmUpDetector: () => Promise.resolve(),
  },
  './detector.types': {},
  './yoloxEngine': {},
  './cameraCoach': {},
});

test('sha256Sync matches node crypto sha256', () => {
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const expected = crypto.createHash('sha256').update(secret).digest('hex');
  const actual = identity.sha256Sync(secret);
  assert.strictEqual(actual, expected);
});

test('getSightDeviceId derives from sha256 of full secret without leaking secret prefix', () => {
  const secret = identity.getSightDeviceSecret();
  assert.match(secret, /^[a-f0-9]{64}$/);

  const deviceId = identity.getSightDeviceId();
  const expectedHash = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 32);
  assert.strictEqual(deviceId, `device-${expectedHash}`);

  // Crucial security property: device ID must NEVER equal the raw secret prefix
  assert.notStrictEqual(deviceId, `device-${secret.slice(0, 32)}`);
});

test('tampering with secret suffix alters the derived device ID completely', () => {
  const originalSecret = 'a'.repeat(64);
  const tamperedSecret = 'a'.repeat(32) + 'b'.repeat(32);

  const originalId = `device-${identity.sha256Sync(originalSecret).slice(0, 32)}`;
  const tamperedId = `device-${identity.sha256Sync(tamperedSecret).slice(0, 32)}`;

  assert.notStrictEqual(originalId, tamperedId);
});

test('transport security: https anywhere, cleartext only on the local network', () => {
  // Loopback, for a server running on this machine.
  assert.strictEqual(vision.isSecureEndpoint('http://localhost:8000'), true);
  assert.strictEqual(vision.isSecureEndpoint('http://127.0.0.1:8000'), true);

  // HTTPS is allowed to any host.
  assert.strictEqual(vision.isSecureEndpoint('https://api.guideeye.org'), true);
  assert.strictEqual(vision.isSecureEndpoint('https://dgx-spark.local:8000'), true);

  // Cleartext to the local network is allowed deliberately: a phone cannot
  // reach the laptop serving it over https without a tunnel and a
  // certificate, and refusing it outright left the app unable to talk to a
  // development server at all.
  assert.strictEqual(vision.isSecureEndpoint('http://192.168.1.50:8000'), true);
  assert.strictEqual(vision.isSecureEndpoint('http://10.0.0.4:8000'), true);
  assert.strictEqual(vision.isSecureEndpoint('http://172.16.5.9:8000'), true);
  assert.strictEqual(vision.isSecureEndpoint('http://dgx-spark.local:8000'), true);

  // Everything that leaves the local network must still be encrypted.
  assert.strictEqual(vision.isSecureEndpoint('http://campus-vision.internal'), false);
  assert.strictEqual(vision.isSecureEndpoint('http://203.0.113.10:8000'), false);
  assert.strictEqual(vision.isSecureEndpoint('http://172.32.0.1:8000'), false);
  assert.strictEqual(vision.isSecureEndpoint('ftp://localhost'), false);
});

test('normalizeApiUrl refuses to hand back an address it would not allow', () => {
  assert.strictEqual(api.normalizeApiUrl('http://example.com:8000'), '');
  assert.strictEqual(api.normalizeApiUrl('not a url'), '');
  assert.strictEqual(api.normalizeApiUrl(''), '');
  // A bare host is what people actually type; it gets the API port.
  assert.strictEqual(api.normalizeApiUrl('192.168.1.5'), 'http://192.168.1.5:8000');
  // Metro's port is a standing trap: it is the address the phone already has.
  assert.strictEqual(api.normalizeApiUrl('http://192.168.1.5:8081'), 'http://192.168.1.5:8000');
});

test('native globals do not trigger browser hostname access', () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  try {
    // React Native exposes `window`, but not the browser Location/Document APIs.
    global.window = {};
    delete global.document;
    const nativeVision = loadTs('src/vision.ts', {
      './api': apiStub,
      './detector': {
        detectObjects: () => Promise.resolve([]),
        detectVideoFrame: () => Promise.resolve(null),
        localDetectorBackend: () => 'stub',
        warmUpDetector: () => Promise.resolve(),
      },
      './detector.types': {},
      './blockedView': {},
    });
    assert.strictEqual(nativeVision.getApiUrl(), '');
    assert.strictEqual(nativeVision.hasVisionBackend(), false);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});

test('tflite startup notice suppression intercepts console.error and LogBox notices', () => {
  const originalError = console.error;
  let calls = [];
  const capture = (...args) => { calls.push(args); };

  try {
    console.error = capture;
    loadTs('app/_layout.tsx', {
      '../src/api': { loadApiUrl: () => Promise.resolve('') },
      '../src/sightIdentity': { initIdentity: () => Promise.resolve('') },
      'expo-router': { Stack: () => null },
      'expo-status-bar': { StatusBar: () => null },
      'react-native': { LogBox: { ignoreLogs: () => {} } },
      'react-native-safe-area-context': { SafeAreaProvider: () => null },
      '../components/NearbyPrompt': { NearbyPrompt: () => null },
      '../src/state/ProfileContext': { ProfileProvider: () => null },
      '../src/theme/tokens': { colors: { canvasDeep: '#07110F' } },
    });

    // Suppressed:
    console.error('INFO: Created TensorFlow Lite XNNPACK delegate for CPU.');
    console.error('Created TensorFlow Lite');
    console.error('XNNPACK delegate for CPU');
    assert.strictEqual(calls.length, 0);

    // Unsuppressed:
    console.error('Fatal crash occurred in app logic');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], 'Fatal crash occurred in app logic');
  } finally {
    console.error = originalError;
  }
});
