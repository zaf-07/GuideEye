import { getSightDeviceId, getSightDeviceSecret, getSightSessionId } from '../sightIdentity';
import { MemoryKind, RecallHit, RelationKind } from './types';

/**
 * Supermemory access, always through GuideEye's own API.
 *
 * The Supermemory key is a Bearer secret with write access to every memory in
 * the account. Anything shipped in an app bundle can be extracted from it, so
 * the key stays on the server and the app authenticates as its device. The
 * server derives the Supermemory namespace from the verified device ID, which
 * means one device cannot read another's memories by asking nicely.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

export interface RemoteRememberInput {
  kind: MemoryKind;
  /** The document body Supermemory extracts memories from. */
  content: string;
  /** Stable caller-side ID, so re-observing a thing appends instead of forking. */
  id?: string;
  /** Steers extraction; Supermemory caps this at 1500 characters. */
  supportingContext?: string;
  metadata?: Record<string, string | number | boolean>;
  date?: string;
}

export interface RemoteStatus {
  configured: boolean;
  reason?: string;
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Device-ID': getSightDeviceId(),
    'X-Device-Secret': getSightDeviceSecret(),
    'X-Session-ID': getSightSessionId(),
  };
}

async function call<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!API_URL) throw new Error('No API URL configured');
  const response = await fetch(`${API_URL.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Memory sync failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export async function remoteStatus(): Promise<RemoteStatus> {
  if (!API_URL) return { configured: false, reason: 'No backend configured' };
  try {
    const response = await fetch(`${API_URL.replace(/\/$/, '')}/v1/recall/status`);
    if (!response.ok) return { configured: false, reason: `Backend returned ${response.status}` };
    return (await response.json()) as RemoteStatus;
  } catch (error) {
    return { configured: false, reason: (error as Error).message };
  }
}

export async function remoteRemember(input: RemoteRememberInput): Promise<{ id: string; status: string }> {
  return call('/v1/recall/remember', input);
}

interface RemoteHit {
  id: string;
  text: string;
  similarity: number;
  kind?: MemoryKind;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
  related?: Array<{ id: string; text: string; relation: RelationKind }>;
}

/**
 * Remote recall returns Supermemory's own extracted facts plus the graph
 * context it keeps (parents, children and siblings of each memory), mapped
 * onto the same shape the on-device graph produces so callers never branch.
 */
export async function remoteRecall(
  query: string,
  opts: { limit?: number; kinds?: MemoryKind[]; signal?: AbortSignal } = {},
): Promise<RecallHit[]> {
  const body = { query, limit: opts.limit ?? 8, kinds: opts.kinds };
  const data = await call<{ results: RemoteHit[] }>('/v1/recall/search', body, opts.signal);
  const now = Date.now();
  return (data.results ?? []).map((hit) => {
    const seen = hit.updatedAt ? Date.parse(hit.updatedAt) : now;
    return {
      node: {
        id: hit.id,
        kind: hit.kind ?? 'object',
        label: hit.text,
        firstSeen: Number.isNaN(seen) ? now : seen,
        lastSeen: Number.isNaN(seen) ? now : seen,
        mentions: 1,
        metadata: hit.metadata as Record<string, string | number | boolean> | undefined,
        remoteId: hit.id,
      },
      score: hit.similarity,
      reason: 'from your synced memory',
      related: (hit.related ?? []).map((rel) => ({
        node: {
          id: rel.id,
          kind: 'object' as MemoryKind,
          label: rel.text,
          firstSeen: now,
          lastSeen: now,
          mentions: 1,
          remoteId: rel.id,
        },
        kind: rel.relation,
        weight: 1,
      })),
      remote: true,
    };
  });
}
