import {
  Episode,
  EpisodeEntity,
  MemoryEdge,
  MemoryGraph,
  MemoryKind,
  MemoryNode,
  RecallHit,
  RelationKind,
  emptyGraph,
} from './types';

/**
 * Pure graph operations. No React Native, no storage, no network — so this
 * can be reasoned about and tested on its own, and so the same logic runs
 * identically offline and online.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Edge weight halves every two weeks, so stale links fade without deletion. */
export const EDGE_HALF_LIFE_MS = 14 * DAY;

/** Below this an edge is dropped entirely rather than kept as noise. */
export const EDGE_MIN_WEIGHT = 0.05;

/** Nodes seen this many times or more are described as familiar. */
export const FAMILIAR_MENTIONS = 4;

export function nodeId(kind: MemoryKind, label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${kind}:${slug || 'unnamed'}`;
}

function decay(weight: number, from: number, to: number): number {
  if (to <= from) return weight;
  return weight * Math.pow(0.5, (to - from) / EDGE_HALF_LIFE_MS);
}

/** Undirected lookup: co-occurrence has no natural direction. */
function sameEdge(edge: MemoryEdge, from: string, to: string, kind: RelationKind): boolean {
  if (edge.kind !== kind) return false;
  if (edge.from === from && edge.to === to) return true;
  return kind === 'co_occurred' && edge.from === to && edge.to === from;
}

function upsertNode(graph: MemoryGraph, entity: EpisodeEntity, at: number): MemoryNode {
  const id = nodeId(entity.kind, entity.label);
  const existing = graph.nodes[id];
  if (existing) {
    graph.nodes[id] = {
      ...existing,
      // A later sighting refines the label's casing but never replaces identity.
      detail: entity.detail ?? existing.detail,
      metadata: { ...existing.metadata, ...entity.metadata },
      lastSeen: Math.max(existing.lastSeen, at),
      mentions: existing.mentions + 1,
    };
    return graph.nodes[id];
  }
  graph.nodes[id] = {
    id,
    kind: entity.kind,
    label: entity.label,
    detail: entity.detail,
    metadata: entity.metadata,
    firstSeen: at,
    lastSeen: at,
    mentions: 1,
  };
  return graph.nodes[id];
}

function link(graph: MemoryGraph, from: string, to: string, kind: RelationKind, at: number) {
  if (from === to) return;
  const existing = graph.edges.find((e) => sameEdge(e, from, to, kind));
  if (existing) {
    existing.weight = decay(existing.weight, existing.lastSeen, at) + 1;
    existing.lastSeen = at;
    return;
  }
  graph.edges.push({ from, to, kind, weight: 1, lastSeen: at });
}

/**
 * Fold one observed moment into the graph. Every entity in the episode is
 * linked to every other: that is the claim "these were true at the same time",
 * which is what later lets recall answer "and what else is usually here?".
 */
export function observe(graph: MemoryGraph, episode: Episode): MemoryGraph {
  const at = episode.at ?? Date.now();
  const next: MemoryGraph = {
    nodes: { ...graph.nodes },
    edges: graph.edges.map((e) => ({ ...e })),
    updatedAt: at,
  };

  // The place and the speaker are context, not peers of the things observed.
  // They get their own typed edges; mixing them into the co-occurrence pass
  // would describe the same relationship twice and inflate its weight.
  const touched = episode.entities.map((entity) => upsertNode(next, entity, at));
  const placeId = episode.place
    ? upsertNode(next, { kind: 'place', label: episode.place }, at).id
    : undefined;
  const speakerId = episode.speaker
    ? upsertNode(next, { kind: 'person', label: episode.speaker }, at).id
    : undefined;

  for (let i = 0; i < touched.length; i += 1) {
    const a = touched[i];
    if (placeId && a.id !== placeId) link(next, a.id, placeId, 'located_in', at);
    if (speakerId && a.kind === 'conversation') link(next, a.id, speakerId, 'said_by', at);
    for (let j = i + 1; j < touched.length; j += 1) {
      link(next, a.id, touched[j].id, 'co_occurred', at);
    }
  }

  return prune(next, at);
}

/** Drops edges that have decayed into noise. Nodes are kept; they are cheap. */
export function prune(graph: MemoryGraph, now = Date.now()): MemoryGraph {
  return {
    ...graph,
    edges: graph.edges.filter((e) => decay(e.weight, e.lastSeen, now) >= EDGE_MIN_WEIGHT),
  };
}

export function neighbours(
  graph: MemoryGraph,
  id: string,
  now = Date.now(),
): Array<{ node: MemoryNode; kind: RelationKind; weight: number }> {
  const out: Array<{ node: MemoryNode; kind: RelationKind; weight: number }> = [];
  for (const edge of graph.edges) {
    const otherId = edge.from === id ? edge.to : edge.to === id ? edge.from : undefined;
    if (!otherId) continue;
    const node = graph.nodes[otherId];
    if (!node) continue;
    out.push({ node, kind: edge.kind, weight: decay(edge.weight, edge.lastSeen, now) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

function textScore(node: MemoryNode, terms: string[]): number {
  if (!terms.length) return 0;
  const hay = `${node.label} ${node.detail ?? ''}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (hay === term) score += 3;
    else if (hay.includes(term)) score += 1.5;
  }
  return score;
}

function describe(node: MemoryNode, now: number): string {
  const days = Math.max(0, Math.round((now - node.lastSeen) / DAY));
  if (node.mentions >= FAMILIAR_MENTIONS) {
    return days === 0 ? 'you come across this most days' : `familiar, last seen ${days} days ago`;
  }
  if (days === 0) return 'seen today';
  if (days === 1) return 'seen yesterday';
  return `seen ${days} days ago`;
}

export interface RecallOptions {
  limit?: number;
  kinds?: MemoryKind[];
  /** Bias results toward things last seen in this place. */
  place?: string;
  now?: number;
  /** How many related nodes to attach to each hit. */
  relatedPerHit?: number;
}

/**
 * Relationship-aware recall. A node scores on three things: how well it
 * matches the words asked, how familiar it is, and how recently it was seen.
 * Each hit then carries its strongest neighbours, so the caller can say
 * "the bin, by your front door, where you also pass the postbox".
 */
export function recall(graph: MemoryGraph, query: string, opts: RecallOptions = {}): RecallHit[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 8;
  const relatedPerHit = opts.relatedPerHit ?? 3;
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const placeId = opts.place ? nodeId('place', opts.place) : undefined;

  const scored = Object.values(graph.nodes)
    .filter((node) => !opts.kinds || opts.kinds.includes(node.kind))
    .map((node) => {
      const text = textScore(node, terms);
      const familiarity = Math.log1p(node.mentions);
      const recency = Math.pow(0.5, (now - node.lastSeen) / (7 * DAY));
      let score = text * 2 + familiarity + recency;
      if (placeId) {
        const near = graph.edges.some(
          (e) => sameEdge(e, node.id, placeId, 'located_in') || sameEdge(e, node.id, placeId, 'co_occurred'),
        );
        if (near) score += 1.5;
      }
      return { node, score, text };
    })
    // With a query, only genuine text matches survive; an empty query browses.
    .filter((hit) => (terms.length ? hit.text > 0 : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ node, score }) => ({
    node,
    score,
    reason: describe(node, now),
    related: neighbours(graph, node.id, now).slice(0, relatedPerHit),
  }));
}

/** Everything known about one node, for the memory browser and for deletion. */
export function forget(graph: MemoryGraph, id: string): MemoryGraph {
  const nodes = { ...graph.nodes };
  delete nodes[id];
  return {
    nodes,
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
    updatedAt: Date.now(),
  };
}

export function forgetAll(): MemoryGraph {
  return emptyGraph();
}

export function stats(graph: MemoryGraph) {
  const byKind: Partial<Record<MemoryKind, number>> = {};
  for (const node of Object.values(graph.nodes)) {
    byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
  }
  return { nodes: Object.keys(graph.nodes).length, edges: graph.edges.length, byKind };
}
