const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

test('offline scene labels group shoe aliases and skip low-confidence or broad categories', async () => {
  const { classifyExtraObjects } = loadTs('src/objectLabels.ts', {
    expo: {
      requireOptionalNativeModule: () => ({
        classify: async () => [
          { label: 'clothing', confidence: 0.9 },
          { label: 'footwear', confidence: 0.9 },
          { label: 'sneaker', confidence: 0.89 },
          { label: 'wallet', confidence: 0.7 },
          { label: 'stairs', confidence: 0.3 },
        ],
      }),
    },
  });
  assert.deepEqual(await classifyExtraObjects('file:///frame.jpg'), ['shoes', 'wallet']);
});
