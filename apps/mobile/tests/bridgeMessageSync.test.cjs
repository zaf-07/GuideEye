const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const campusMemory = loadTs('src/campusMemory.ts', {
  './vision': { getApiUrl: () => 'http://127.0.0.1:8000' },
  './sightIdentity': {
    getSightDeviceId: () => 'dev-test-1234',
    getSightHeaders: () => ({ 'X-Device-Id': 'dev-test-1234' }),
    getSightSessionId: () => 'sess-test-1',
  },
  './nearby/peerBridge': {
    isPeerBridge: (code) => code.startsWith('mp-') || code === '123456',
    peerBridgeActive: () => false,
    peerConversation: (code) => ({
      code,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      devices: 2,
      max_devices: 2,
      partner_joined: true,
      is_member: true,
    }),
    peerMessagesAfter: () => [],
    sendPeerMessage: () => ({ id: 1, sender_role: 'blind', text: 'hi', client_id: 'c1', created_at: 'now', from_this_device: true }),
  },
});

test('mergeBridgeMessages deduplicates incoming messages by client_id', () => {
  const existing = [
    { id: -1, session_id: '123456', sender_role: 'blind', text: 'Hello partner', client_id: 'client-uuid-1', pending: true, created_at: '2026-11-20T00:00:00Z', relative_time: 'just now' },
  ];

  // Server returns the stored message with a real positive server ID and pending: false
  const confirmed = [
    { id: 42, session_id: '123456', sender_role: 'blind', text: 'Hello partner', client_id: 'client-uuid-1', pending: false, created_at: '2026-11-20T00:00:00Z', relative_time: 'just now' },
  ];

  const merged = campusMemory.mergeBridgeMessages(existing, confirmed);
  assert.strictEqual(merged.length, 1, 'Should reconcile pending and confirmed message into one');
  assert.strictEqual(merged[0].id, 42);
  assert.strictEqual(merged[0].pending, false);
  assert.strictEqual(merged[0].client_id, 'client-uuid-1');
});

test('mergeBridgeMessages sorts confirmed messages by id with pending at the end', () => {
  const existing = [
    { id: 10, session_id: '123456', sender_role: 'deaf', text: 'HELLO', client_id: 'c-10', pending: false, created_at: '2026-11-20T00:00:00Z', relative_time: '1m ago' },
    { id: 3, session_id: '123456', sender_role: 'blind', text: 'Hi', client_id: 'c-3', pending: false, created_at: '2026-11-20T00:00:00Z', relative_time: '2m ago' },
    { id: -5, session_id: '123456', sender_role: 'blind', text: 'Waiting to send', client_id: 'c-pending', pending: true, created_at: '2026-11-20T00:00:00Z', relative_time: 'just now' },
  ];

  const incoming = [
    { id: 7, session_id: '123456', sender_role: 'deaf', text: 'HOW ARE YOU?', client_id: 'c-7', pending: false, created_at: '2026-11-20T00:00:00Z', relative_time: 'just now' },
  ];

  const merged = campusMemory.mergeBridgeMessages(existing, incoming);
  assert.strictEqual(merged.length, 4);
  assert.deepStrictEqual(merged.map((m) => m.id), [3, 7, 10, -5], 'Confirmed messages must be in ascending server ID order, pending unsent message last');
});

test('mergeBridgeMessages handles multiple rapid duplicates idempotently', () => {
  const existing = [
    { id: 1, session_id: '123456', sender_role: 'blind', text: 'One', client_id: 'c1', pending: false, created_at: '2026-11-20T00:00:00Z', relative_time: 'just now' },
  ];

  const duplicates = [
    { id: 1, session_id: '123456', sender_role: 'blind', text: 'One', client_id: 'c1', pending: false, created_at: '2026-11-20T00:00:00Z', relative_time: 'just now' },
    { id: 1, session_id: '123456', sender_role: 'blind', text: 'One', client_id: 'c1', pending: false, created_at: '2026-11-20T00:00:00Z', relative_time: 'just now' },
  ];

  const merged = campusMemory.mergeBridgeMessages(existing, duplicates);
  assert.strictEqual(merged.length, 1);
});

test('LOCAL_BRIDGE_CODE constant is defined and configured check operates cleanly', () => {
  assert.strictEqual(campusMemory.LOCAL_BRIDGE_CODE, 'local');
  assert.strictEqual(typeof campusMemory.bridgeServerConfigured(), 'boolean');
});
