import AsyncStorage from '@react-native-async-storage/async-storage';
import { MemoryGraph, emptyGraph } from './types';

const KEY = 'guideeye.memory.graph.v1';

/**
 * The graph is written back after every episode, so a crash mid-walk cannot
 * lose what was just learned. Writes are coalesced because scene observation
 * fires far more often than storage should.
 */
let cache: MemoryGraph | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

export async function loadGraph(): Promise<MemoryGraph> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as MemoryGraph) : emptyGraph();
  } catch {
    // A corrupt graph must never stop the app opening; start a fresh one.
    cache = emptyGraph();
  }
  return cache;
}

export function peekGraph(): MemoryGraph | null {
  return cache;
}

export function saveGraph(graph: MemoryGraph, { immediate = false } = {}): void {
  cache = graph;
  if (pending) clearTimeout(pending);
  const write = () => {
    pending = null;
    AsyncStorage.setItem(KEY, JSON.stringify(graph)).catch(() => {});
  };
  if (immediate) write();
  else pending = setTimeout(write, 1500);
}

export async function clearGraph(): Promise<void> {
  cache = emptyGraph();
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
