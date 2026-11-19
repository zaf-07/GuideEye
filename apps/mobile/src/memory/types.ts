/**
 * GuideEye's memory is a graph, not a log.
 *
 * A flat list of past observations is nearly useless to a blind user: it can
 * only answer "what did I see", never "what is usually here" or "who was I
 * with when this happened". Nodes are the things worth remembering; edges are
 * the relationships between them, which is what lets recall widen from one
 * match to the context around it.
 */

export type MemoryKind =
  /** A room, crossing, shop, junction — somewhere the user returns to. */
  | 'place'
  /** A named person, from Bridge conversations or saved faces. */
  | 'person'
  /** A recurring object: your door, your desk, the bin that moves. */
  | 'object'
  /** Something that was in the way: roadworks, a wet floor, a parked bike. */
  | 'hazard'
  /** A turn of conversation carried through the Bridge. */
  | 'conversation'
  /** A sign the user made that needed correcting, or a phrase they reuse. */
  | 'sign'
  /** A standing preference the user stated out loud. */
  | 'preference';

export interface MemoryNode {
  id: string;
  kind: MemoryKind;
  /** Short human label — this is what gets spoken back. */
  label: string;
  /** Optional longer text; for conversation nodes this is the utterance. */
  detail?: string;
  firstSeen: number;
  lastSeen: number;
  /** How many episodes this node has appeared in. Drives "usual" vs "new". */
  mentions: number;
  /** Free metadata: zone, confidence, speaker role, distance. */
  metadata?: Record<string, string | number | boolean>;
  /** Set once the node has been pushed to Supermemory. */
  remoteId?: string;
}

export type RelationKind =
  /** Seen in the same moment. The backbone relation. */
  | 'co_occurred'
  /** The node sits inside a place. */
  | 'located_in'
  /** A conversation turn was produced by a person. */
  | 'said_by'
  /** One node is a more specific case of another. */
  | 'refers_to';

export interface MemoryEdge {
  from: string;
  to: string;
  kind: RelationKind;
  /** Decayed strength. Repeated co-occurrence raises it; time lowers it. */
  weight: number;
  lastSeen: number;
}

export interface MemoryGraph {
  nodes: Record<string, MemoryNode>;
  edges: MemoryEdge[];
  updatedAt: number;
}

/** One thing worth remembering, as observed in a single moment. */
export interface EpisodeEntity {
  kind: MemoryKind;
  label: string;
  detail?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Everything noticed in one moment. Entities inside an episode become
 * connected to each other — that co-occurrence is where the graph comes from.
 */
export interface Episode {
  entities: EpisodeEntity[];
  /** Where it happened; linked to every entity with `located_in`. */
  place?: string;
  /** Who said it, for conversation turns; linked with `said_by`. */
  speaker?: string;
  at?: number;
  /** Free text handed to Supermemory as the document body. */
  summary?: string;
}

export interface RecallHit {
  node: MemoryNode;
  score: number;
  /** Why it surfaced, phrased for speech: "you see this most days". */
  reason: string;
  /** One hop out: the context that makes the hit useful. */
  related: Array<{ node: MemoryNode; kind: RelationKind; weight: number }>;
  /** Present when the hit came back from Supermemory rather than on-device. */
  remote?: boolean;
}

export const emptyGraph = (): MemoryGraph => ({ nodes: {}, edges: [], updatedAt: 0 });
