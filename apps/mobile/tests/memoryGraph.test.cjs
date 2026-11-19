const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

// types.ts carries one runtime export; the rest is erased at compile time.
const types = loadTs('src/memory/types.ts');
const { emptyGraph } = types;
const graph = loadTs('src/memory/graph.ts', { './types': types });

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);

test('entities observed together become connected', () => {
  const g = graph.observe(emptyGraph(), {
    entities: [{ kind: 'object', label: 'Postbox' }, { kind: 'object', label: 'Bin' }],
    place: 'Front door',
    at: T0,
  });

  const postbox = graph.nodeId('object', 'Postbox');
  const bin = graph.nodeId('object', 'Bin');
  const place = graph.nodeId('place', 'Front door');

  assert.ok(g.nodes[postbox] && g.nodes[bin] && g.nodes[place]);
  const names = graph.neighbours(g, postbox, T0).map((n) => `${n.kind}:${n.node.id}`);
  assert.ok(names.includes(`co_occurred:${bin}`), 'postbox should co-occur with bin');
  assert.ok(names.includes(`located_in:${place}`), 'postbox should be located in the place');
});

test('re-observing strengthens rather than duplicates', () => {
  let g = emptyGraph();
  for (let i = 0; i < 3; i += 1) {
    g = graph.observe(g, {
      entities: [{ kind: 'object', label: 'Bin' }],
      place: 'Front door',
      at: T0 + i * DAY,
    });
  }
  const bin = g.nodes[graph.nodeId('object', 'Bin')];
  assert.strictEqual(bin.mentions, 3);
  assert.strictEqual(Object.keys(g.nodes).length, 2, 'one object plus one place');
  assert.strictEqual(g.edges.length, 1, 'repeat sightings reuse the same edge');
  assert.ok(g.edges[0].weight > 2, 'weight accumulates with each sighting');
});

test('a label is one node regardless of casing or punctuation', () => {
  let g = graph.observe(emptyGraph(), { entities: [{ kind: 'place', label: 'Main Street' }], at: T0 });
  g = graph.observe(g, { entities: [{ kind: 'place', label: 'main   street!' }], at: T0 + 1000 });
  assert.strictEqual(Object.keys(g.nodes).length, 1);
  assert.strictEqual(g.nodes[graph.nodeId('place', 'Main Street')].mentions, 2);
});

test('edges decay over time and are pruned once they are noise', () => {
  const g = graph.observe(emptyGraph(), {
    entities: [{ kind: 'object', label: 'Scooter' }, { kind: 'object', label: 'Bench' }],
    at: T0,
  });
  assert.strictEqual(g.edges.length, 1);

  const soon = graph.prune(g, T0 + graph.EDGE_HALF_LIFE_MS);
  assert.strictEqual(soon.edges.length, 1, 'one half-life still leaves a usable link');

  const muchLater = graph.prune(g, T0 + graph.EDGE_HALF_LIFE_MS * 6);
  assert.strictEqual(muchLater.edges.length, 0, 'a long-untouched link is dropped');
});

test('recall returns matches with the context around them', () => {
  let g = emptyGraph();
  g = graph.observe(g, {
    entities: [{ kind: 'hazard', label: 'Roadworks' }, { kind: 'object', label: 'Crossing' }],
    place: 'Oak Street',
    at: T0,
  });
  g = graph.observe(g, { entities: [{ kind: 'object', label: 'Bakery' }], place: 'Elm Street', at: T0 });

  const hits = graph.recall(g, 'roadworks', { now: T0 + DAY });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].node.label, 'Roadworks');

  const relatedLabels = hits[0].related.map((r) => r.node.label);
  assert.ok(relatedLabels.includes('Crossing'), 'the hit carries what it was seen with');
  assert.ok(relatedLabels.includes('Oak Street'), 'the hit carries where it was');
  assert.ok(!relatedLabels.includes('Bakery'), 'unrelated places stay out');
});

test('a query only returns genuine text matches, an empty query browses', () => {
  let g = graph.observe(emptyGraph(), {
    entities: [{ kind: 'object', label: 'Bollard' }, { kind: 'object', label: 'Kerb' }],
    at: T0,
  });
  assert.strictEqual(graph.recall(g, 'elephant', { now: T0 }).length, 0);
  assert.strictEqual(graph.recall(g, '', { now: T0 }).length, 2);
});

test('familiar things are described as familiar, one-offs by when they were seen', () => {
  let g = emptyGraph();
  for (let i = 0; i < graph.FAMILIAR_MENTIONS; i += 1) {
    g = graph.observe(g, { entities: [{ kind: 'object', label: 'Lamppost' }], at: T0 + i * DAY });
  }
  g = graph.observe(g, { entities: [{ kind: 'object', label: 'Skip' }], at: T0 });

  const now = T0 + graph.FAMILIAR_MENTIONS * DAY;
  const byLabel = Object.fromEntries(graph.recall(g, '', { now }).map((h) => [h.node.label, h.reason]));
  assert.match(byLabel.Lamppost, /familiar|most days/);
  assert.match(byLabel.Skip, /days ago/);
});

test('recall prefers things last seen in the place the user is in', () => {
  let g = emptyGraph();
  g = graph.observe(g, { entities: [{ kind: 'object', label: 'Door handle' }], place: 'Office', at: T0 });
  g = graph.observe(g, { entities: [{ kind: 'object', label: 'Door handle sign' }], place: 'Gym', at: T0 });

  const hits = graph.recall(g, 'door handle', { place: 'Gym', now: T0 });
  assert.strictEqual(hits[0].node.label, 'Door handle sign');
});

test('forgetting a node removes its relationships too', () => {
  const g = graph.observe(emptyGraph(), {
    entities: [{ kind: 'person', label: 'Maria' }, { kind: 'conversation', label: 'Where is the lift?' }],
    at: T0,
  });
  assert.ok(g.edges.length > 0);

  const after = graph.forget(g, graph.nodeId('person', 'Maria'));
  assert.ok(!after.nodes[graph.nodeId('person', 'Maria')]);
  assert.ok(
    after.edges.every((e) => !e.from.includes('maria') && !e.to.includes('maria')),
    'no dangling edges point at a forgotten node',
  );
});

test('stats count what is held, by kind', () => {
  const g = graph.observe(emptyGraph(), {
    entities: [{ kind: 'hazard', label: 'Wet floor' }, { kind: 'object', label: 'Mop' }],
    place: 'Lobby',
    at: T0,
  });
  const s = graph.stats(g);
  assert.strictEqual(s.nodes, 3);
  assert.strictEqual(s.byKind.hazard, 1);
  assert.strictEqual(s.byKind.place, 1);
});
