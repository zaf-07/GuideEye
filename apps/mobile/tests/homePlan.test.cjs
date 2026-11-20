// The home tab is built around who is using the app.
const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const { homePlan, hiddenTab } = loadTs('src/screens/home/plan.ts');
const base = { guidance: 'detailed', speechRate: 1, haptics: true, captions: true, replyFormat: 'both', localOnlyMemory: false, nearbyDiscovery: false, voiceControl: true, fullPermission: false };

test('a blind user opens straight onto the pocket assistant', () => {
  const plan = homePlan({ ...base, impairments: ['vision'] });
  assert.strictEqual(plan.primary.key, 'pocket');
  assert.deepStrictEqual(plan.actions.map((a) => a.key), ['ask', 'home', 'family', 'memory']);
  assert.match(plan.status, /Guide/);
  assert.strictEqual(homePlan({ ...base, impairments: ['vision'], voiceControl: false }).status, '');
  assert.strictEqual(hiddenTab({ impairments: ['vision'] }), 'hearing');
});

test('a deaf user opens onto captions, or onto the sign avatar if that is how they read replies', () => {
  assert.strictEqual(homePlan({ ...base, impairments: ['hearing'] }).primary.key, 'captions');
  const signer = homePlan({ ...base, impairments: ['hearing'], replyFormat: 'avatar' });
  assert.strictEqual(signer.primary.key, 'avatar');
  assert.strictEqual(signer.actions[0].key, 'captions');
  assert.strictEqual(hiddenTab({ impairments: ['hearing'] }), 'vision');
});

test('someone who came to talk with another person opens onto the conversation, with every mode in reach', () => {
  const plan = homePlan({ ...base, impairments: ['communicator'] });
  assert.strictEqual(plan.primary.key, 'bridge');
  assert.strictEqual(hiddenTab({ impairments: ['communicator'] }), null);
});

test('nothing is offered twice and every action leads somewhere', () => {
  for (const impairments of [['vision'], ['hearing'], ['communicator']]) {
    const plan = homePlan({ ...base, impairments });
    const all = [plan.primary, ...plan.actions, ...plan.more];
    assert.strictEqual(new Set(all.map((a) => a.key)).size, all.length);
    for (const action of all) {
      assert.ok(action.href.startsWith('/'));
      assert.ok(action.short.length <= 32, action.short);
    }
  }
});
