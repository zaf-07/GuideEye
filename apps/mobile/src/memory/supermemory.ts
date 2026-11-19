import { NoServerError, apiJson, apiUrl } from '../api';
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

async function call<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return apiJson<T>(path, { method: 'POST', body: JSON.stringify(body), signal });
}

export async function remoteStatus(): Promise<RemoteStatus> {
  if (!apiUrl()) return { configured: false, reason: 'No GuideEye server set. Add it in Settings.' };
  try {
    return await apiJson<RemoteStatus>('/v1/recall/status');
  } catch (error) {
    if (error instanceof NoServerError) return { configured: false, reason: error.message };
    return { configured: false, reason: (error as Error).message };
  }
}

/**
 * The server answers with where the memory actually landed: `synced` means
 * Supermemory acknowledged it, `local` that the server has no key, `failed`
 * that the write was rejected. Callers surface this instead of assuming.
 */
export async function remoteRemember(
  input: RemoteRememberInput,
): Promise<{ id: string; status: string; namespace?: string | null }> {
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
