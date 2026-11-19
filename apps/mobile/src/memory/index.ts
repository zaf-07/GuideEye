import { Profile } from '../state/profile';
import { forget, observe, recall, stats } from './graph';
import { clearGraph, loadGraph, peekGraph, saveGraph } from './store';
import { remoteRecall, remoteRemember, remoteStatus } from './supermemory';
import { Episode, MemoryGraph, MemoryKind, RecallHit } from './types';

export * from './types';
export { nodeId, neighbours, stats } from './graph';

/**
 * The facade every feature uses.
 *
 * Local-first by design: the on-device graph is always written, and is the
 * only store unless the user has explicitly turned off "keep memory on this
 * device" in Settings. Sync is additive, never a replacement — if the network
 * or the backend is gone, recall still works from the phone.
 */

const syncEnabled = (profile: Profile) => !profile.localOnlyMemory;

function describeEpisode(episode: Episode): string {
  if (episode.summary) return episode.summary;
  const labels = episode.entities.map((e) => e.label).filter(Boolean);
  const where = episode.place ? ` at ${episode.place}` : '';
  return labels.length ? `${labels.join(', ')}${where}` : `Visit${where}`;
}

/**
 * Record one observed moment. Always local; mirrored to Supermemory only
 * with the user's consent. Sync failures are swallowed on purpose: a memory
 * that did not reach the server is not a reason to interrupt someone who is
 * crossing a road.
 */
export async function remember(profile: Profile, episode: Episode): Promise<MemoryGraph> {
  const graph = await loadGraph();
  const next = observe(graph, episode);
  saveGraph(next);

  if (syncEnabled(profile)) {
    const content = describeEpisode(episode);
    const kind: MemoryKind = episode.entities[0]?.kind ?? 'object';
    remoteRemember({
      kind,
      content,
      supportingContext: episode.place
        ? `Observed at ${episode.place} by a GuideEye user who is ${profile.impairments.join(' and ')}.`
        : undefined,
      metadata: {
        kind,
        ...(episode.place ? { place: episode.place } : {}),
        ...(episode.speaker ? { speaker: episode.speaker } : {}),
      },
      date: new Date(episode.at ?? Date.now()).toISOString(),
    }).catch(() => {});
  }

  return next;
}

export interface AskOptions {
  limit?: number;
  kinds?: MemoryKind[];
  place?: string;
}

/**
 * Ask memory a question. On-device hits come back first and immediately;
 * synced hits are merged in behind them when sync is on and reachable.
 */
export async function ask(profile: Profile, query: string, opts: AskOptions = {}): Promise<RecallHit[]> {
  const graph = await loadGraph();
  const local = recall(graph, query, opts);
  if (!syncEnabled(profile)) return local;

  try {
    const remote = await remoteRecall(query, { limit: opts.limit, kinds: opts.kinds });
    const seen = new Set(local.map((hit) => hit.node.label.toLowerCase()));
    return [...local, ...remote.filter((hit) => !seen.has(hit.node.label.toLowerCase()))];
  } catch {
    return local;
  }
}

/**
 * A one-line preamble for a scene brief: what the user already knows about
 * here, so narration can say what is different instead of repeating itself.
 */
export async function contextFor(profile: Profile, place: string): Promise<string | undefined> {
  const graph = await loadGraph();
  const hits = recall(graph, '', { place, limit: 3, kinds: ['hazard', 'object'] });
  const familiar = hits.filter((hit) => hit.node.mentions > 1).map((hit) => hit.node.label);
  if (!familiar.length) return undefined;
  return `You usually find ${familiar.join(', ')} here.`;
}

export async function forgetNode(id: string): Promise<MemoryGraph> {
  const graph = await loadGraph();
  const next = forget(graph, id);
  saveGraph(next, { immediate: true });
  return next;
}

export async function forgetEverything(): Promise<void> {
  await clearGraph();
}

export async function graphSnapshot(): Promise<MemoryGraph> {
  return loadGraph();
}

export { peekGraph, remoteStatus, stats as graphStats };
