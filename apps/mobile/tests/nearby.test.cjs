const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const protocol = loadTs('src/nearby/protocol.ts');
const bridge = loadTs('src/nearby/peerBridge.ts');

function pair(leftRole, rightRole, { leftConsent = true, rightConsent = true } = {}) {
  const log = { left: { offers: [], matches: [], beacons: [], messages: [], partner: [] }, right: { offers: [], matches: [], beacons: [], messages: [], partner: [] } };
  const sides = {};
  const wire = (from, to) => ({
    invite: () => { sides[from].connected(to); sides[to].connected(from); },
    send: (text) => { queueMicrotask(() => sides[to].received(from, text)); return true; },
    disconnect: () => { queueMicrotask(() => { sides[from].disconnected(to); sides[to].disconnected(from); }); },
  });
  const handlers = (name) => ({
    onOffer: (offer) => log[name].offers.push(offer),
    onMatch: (match) => log[name].matches.push(match),
    onBeacon: (beacon) => log[name].beacons.push(beacon),
    onMessage: (message) => log[name].messages.push(message),
    onPartner: (connected) => log[name].partner.push(connected),
  });
  sides.a = new protocol.PeerLink('a', leftRole, wire('a', 'b'), handlers('left'), () => leftConsent);
  sides.b = new protocol.PeerLink('b', rightRole, wire('b', 'a'), handlers('right'), () => rightConsent);
  return { a: sides.a, b: sides.b, log };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test('roles, socket address and voice commands', () => {
  assert.strictEqual(protocol.roleForImpairments(['vision']), 'blind');
  assert.strictEqual(protocol.roleForImpairments(['hearing']), 'deaf');
  assert.strictEqual(protocol.roleForImpairments(['communicator']), 'blind');
  assert.strictEqual(protocol.roleForImpairments([]), null);
  assert.strictEqual(protocol.socketUrl('https://api.example.com/', '/v1/radar/ws'), 'wss://api.example.com/v1/radar/ws');
  assert.strictEqual(protocol.socketUrl('http://10.0.0.5:8000', '/v1/radar/ws'), 'ws://10.0.0.5:8000/v1/radar/ws');
  assert.strictEqual(protocol.commandFrom('Connect please'), 'accept');
  assert.strictEqual(protocol.commandFrom('no thanks'), 'decline');
  assert.strictEqual(protocol.commandFrom('what was that'), null);
});

test('both phones derive the same six-digit code and beacon', () => {
  assert.match(protocol.peerCode('ge-one', 'ge-two'), /^\d{6}$/);
  assert.strictEqual(protocol.peerCode('ge-one', 'ge-two'), protocol.peerCode('ge-two', 'ge-one'));
  assert.strictEqual(protocol.peerBeacon('b', 'a'), 'mp-a-b');
});

test('the prompt never names the other person or their role', () => {
  const offer = { source: 'cloud', id: 'x', closeness: 'very close', youAccepted: false, partnerAccepted: false };
  const copy = protocol.promptCopy(offer, true);
  assert.doesNotMatch(`${copy.title} ${copy.detail} ${copy.spoken}`, /blind|deaf/i);
  assert.match(copy.spoken, /double tap/);
  assert.match(protocol.promptCopy({ ...offer, youAccepted: true }, false).title, /Waiting/);
});

test('malformed peer messages are ignored', () => {
  assert.strictEqual(protocol.parseWire('not json'), null);
  assert.strictEqual(protocol.parseWire('{"t":"hello","role":"pilot"}'), null);
  assert.strictEqual(protocol.parseWire('{"t":"msg","m":{"text":"hi"}}'), null);
  assert.deepStrictEqual(protocol.parseWire('{"t":"accept","extra":1}'), { t: 'accept' });
});

test('a blind and a deaf phone find each other, both accept, and talk', async () => {
  const { a, b, log } = pair('blind', 'deaf');
  b.found('a');
  assert.strictEqual(a.connectedPeer, null);
  a.found('b');
  await settle();
  assert.strictEqual(log.left.offers.at(-1).source, 'peer');
  assert.strictEqual(log.right.offers.at(-1).youAccepted, false);
  a.accept();
  await settle();
  assert.strictEqual(log.left.matches.length, 0);
  assert.strictEqual(log.right.offers.at(-1).partnerAccepted, true);
  b.accept();
  await settle();
  assert.deepStrictEqual(log.left.matches, [{ code: protocol.peerCode('a', 'b'), role: 'blind' }]);
  assert.deepStrictEqual(log.right.matches, [{ code: protocol.peerCode('a', 'b'), role: 'deaf' }]);
  assert.ok(a.sendMessage({ sender_role: 'blind', text: 'Hello', client_id: 'c1', created_at: '2026-11-19T00:00:00Z' }));
  await settle();
  assert.strictEqual(log.right.messages[0].text, 'Hello');
});

test('two phones with the same role disconnect without prompting anyone', async () => {
  const { a, log } = pair('blind', 'blind');
  a.found('b');
  await settle();
  assert.strictEqual(log.left.offers.filter(Boolean).length, 0);
  assert.strictEqual(log.right.offers.filter(Boolean).length, 0);
  assert.strictEqual(a.connectedPeer, null);
});

test('declining clears the offer on both phones and stops re-inviting', async () => {
  const { a, b, log } = pair('blind', 'deaf');
  a.found('b');
  await settle();
  b.decline();
  await settle();
  assert.strictEqual(log.left.offers.at(-1), null);
  assert.strictEqual(a.connectedPeer, null);
  a.found('b');
  await settle();
  assert.strictEqual(a.connectedPeer, null);
});

test('with the server reachable the peer link only reports proximity', async () => {
  const { a, log } = pair('blind', 'deaf', { leftConsent: false, rightConsent: false });
  a.found('b');
  await settle();
  assert.deepStrictEqual(log.left.beacons, ['mp-a-b']);
  assert.deepStrictEqual(log.right.beacons, ['mp-a-b']);
  assert.strictEqual(log.left.offers.length, 0);
});

test('an already connected pair falls back to direct consent when the cloud fails', async () => {
  const { a, b, log } = pair('blind', 'deaf', { leftConsent: false, rightConsent: false });
  a.found('b');
  await settle();
  assert.strictEqual(log.left.offers.length, 0);
  assert.strictEqual(log.right.offers.length, 0);
  a.enableDirectConsent();
  b.enableDirectConsent();
  assert.strictEqual(log.left.offers.at(-1).source, 'peer');
  assert.strictEqual(log.right.offers.at(-1).source, 'peer');
});

test('the peer bridge keeps messages in order and drops duplicates', () => {
  const sent = [];
  bridge.openPeerBridge('123456', (message) => { sent.push(message); return true; });
  assert.ok(bridge.isPeerBridge('123456'));
  assert.ok(!bridge.isPeerBridge('654321'));
  assert.strictEqual(bridge.peerConversation('123456').partner_joined, true);
  const mine = bridge.sendPeerMessage({ sender_role: 'blind', text: 'Hi', client_id: 'm1', created_at: 'now' });
  bridge.receivePeerMessage({ sender_role: 'deaf', text: 'HELLO', client_id: 't1', created_at: 'now' });
  bridge.receivePeerMessage({ sender_role: 'deaf', text: 'HELLO', client_id: 't1', created_at: 'now' });
  const inbox = bridge.peerMessagesAfter(0);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(inbox.length, 1);
  assert.ok(inbox[0].id > mine.id);
  assert.deepStrictEqual(bridge.peerMessagesAfter(inbox[0].id), []);
  bridge.setPeerPartner(false);
  assert.strictEqual(bridge.sendPeerMessage({ sender_role: 'blind', text: 'x', client_id: 'm2', created_at: 'now' }), null);
  bridge.closePeerBridge();
  assert.ok(!bridge.peerBridgeActive());
});

test('multipeer reports unavailable when the native module is not linked', () => {
  const multipeer = loadTs('src/nearby/multipeer.ts', {
    '../../modules/guideeye-multipeer/src/GuideEyeMultipeerModule': { default: null },
  });
  assert.strictEqual(multipeer.multipeerAvailable(), false);
  assert.strictEqual(multipeer.startMultipeer('ge-test', {}), null);
  assert.match(multipeer.newPeerName(), /^ge-[a-z0-9]+$/);
});
