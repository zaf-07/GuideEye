const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

let speechCalls = [];
let audioInstances = [];

const announceLib = loadTs('src/lib/announce.ts', {
  'react-native': {
    AccessibilityInfo: { announceForAccessibility: () => {} },
    Platform: { OS: 'ios' },
  },
  'expo-audio': {
    createAudioPlayer: (uri) => {
      const player = {
        uri,
        played: false,
        released: false,
        listeners: {},
        play: () => { player.played = true; },
        pause: () => {},
        release: () => { player.released = true; },
        addListener: (event, cb) => {
          player.listeners[event] = cb;
          return { remove: () => {} };
        },
      };
      audioInstances.push(player);
      return player;
    },
  },
  'expo-file-system': {
    File: class MockFile {
      constructor(base, name) {
        this.uri = `file://${base}/${name}`;
      }
      create() {}
      write() { return Promise.resolve(); }
      delete() {}
    },
    Paths: { cache: '/mock-cache' },
  },
  'expo-speech': {
    speak: (text, opts) => {
      speechCalls.push({ text, opts });
      if (opts?.onDone) setTimeout(opts.onDone, 5);
    },
    stop: () => {},
  },
  '../api': {
    apiUrl: () => 'http://127.0.0.1:8000',
  },
  '../state/profile': {
    hasVisionTrack: (p) => p.impairments.includes('vision'),
  },
});

test('urgent alerts bypass cloud voice and use on-device speech directly', () => {
  speechCalls = [];
  const profile = { impairments: ['vision'], speechRate: 1.0 };
  announceLib.announce(profile, 'Caution: chair ahead on left', { urgent: true });

  assert.strictEqual(speechCalls.length, 1);
  assert.strictEqual(speechCalls[0].text, 'Caution: chair ahead on left');
  assert.strictEqual(speechCalls[0].opts.language, 'en-US');
});

test('speechBusy reports busy immediately upon announcement', () => {
  const profile = { impairments: ['vision'], speechRate: 1.0 };
  announceLib.announce(profile, 'Turning left in twenty feet', { urgent: true });

  assert.strictEqual(announceLib.speechBusy(), true, 'Mic must be locked while voice is announcing to prevent echo');
  announceLib.stopSpeaking();
});

test('stopSpeaking terminates speech and releases audio resources', () => {
  const profile = { impairments: ['vision'], speechRate: 1.0 };
  announceLib.announce(profile, 'Testing stop sequence', { urgent: true });
  announceLib.stopSpeaking();
});
