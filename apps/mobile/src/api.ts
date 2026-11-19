import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getSightHeaders } from './sightIdentity';

/**
 * One place that answers "where is the GuideEye server?".
 *
 * Before this existed, every feature resolved the address for itself: vision
 * read `localStorage` (which React Native does not have), memory read only the
 * build-time env var, and nothing agreed. On a phone they all resolved to the
 * empty string, so the whole app ran disconnected while reporting nothing.
 *
 * Resolution order, first hit wins:
 *   1. what the user typed in Settings  (survives restarts)
 *   2. EXPO_PUBLIC_API_URL              (build-time default)
 *   3. the dev machine serving this bundle, on the API port
 */

const STORAGE_KEY = 'guideeye.apiUrl';
const API_PORT = '8000';

/** Addresses that are reachable only from inside the local network. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)) return true;
  if (host.endsWith('.local')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/**
 * Plain http is allowed to the local network and refused everywhere else.
 *
 * A phone cannot reach its developer's laptop over https without a tunnel and
 * a certificate, so refusing http outright — which is what the old helper did
 * — meant the app could never talk to a dev server at all. Traffic that leaves
 * the local network still has to be encrypted.
 */
export function isAllowedEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function normalizeApiUrl(value: string): string {
  let trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  // "192.168.1.5" and "192.168.1.5:8000" are what people actually type.
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `http://${trimmed}`;
  try {
    const parsed = new URL(trimmed);
    // 8081/8082 are Metro and Expo Web in this project; FastAPI is on 8000.
    if (parsed.port === '8081' || parsed.port === '8082') parsed.port = API_PORT;
    if (!parsed.port && parsed.protocol === 'http:') parsed.port = API_PORT;
    const normalized = parsed.toString().replace(/\/+$/, '');
    return isAllowedEndpoint(normalized) ? normalized : '';
  } catch {
    return '';
  }
}

/**
 * The machine serving this JS bundle. In a dev build `hostUri` is the Mac's
 * LAN address, which is exactly the host the backend runs on, so the phone can
 * find the server with nothing configured at all.
 */
export function devHostApiUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    '';
  const host = hostUri.split('/')[0]?.split(':')[0] ?? '';
  if (!host || !isPrivateHost(host)) return '';
  return normalizeApiUrl(`http://${host}:${API_PORT}`);
}

const envApiUrl = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL ?? '');

let cached: string | null = null;
let loading: Promise<string> | null = null;
const listeners = new Set<(url: string) => void>();

function announce(url: string) {
  for (const listener of listeners) {
    try {
      listener(url);
    } catch {
      /* a bad subscriber must not break address resolution */
    }
  }
}

export function onApiUrlChange(listener: (url: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadApiUrl(): Promise<string> {
  if (cached !== null) return cached;
  if (!loading) {
    loading = (async () => {
      let stored = '';
      try {
        stored = normalizeApiUrl((await AsyncStorage.getItem(STORAGE_KEY)) ?? '');
      } catch {
        stored = '';
      }
      cached = stored || envApiUrl || devHostApiUrl();
      announce(cached);
      return cached;
    })();
  }
  return loading;
}

/**
 * The address without waiting. Callers already on a rendered screen have had
 * `loadApiUrl` resolved for them at startup; before that this falls back to
 * the build-time and dev-host guesses rather than claiming there is no server.
 */
export function apiUrl(): string {
  return cached ?? envApiUrl ?? devHostApiUrl();
}

export async function setApiUrl(value: string): Promise<string> {
  const normalized = normalizeApiUrl(value);
  cached = normalized || envApiUrl || devHostApiUrl();
  try {
    if (normalized) await AsyncStorage.setItem(STORAGE_KEY, normalized);
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* an unwritable store still leaves this session pointed at the new host */
  }
  announce(cached);
  return cached;
}

export interface ProbeResult {
  ok: boolean;
  url: string;
  detail: string;
  latencyMs?: number;
}

/** Ask a candidate address whether it is a GuideEye server. */
export async function probeApi(value: string, timeoutMs = 4000): Promise<ProbeResult> {
  const url = normalizeApiUrl(value);
  if (!url) {
    return {
      ok: false,
      url: '',
      detail: value.trim()
        ? 'That address is not usable. Use https, or http to a local address like 192.168.1.5:8000.'
        : 'No address set.',
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${url}/health`, { signal: controller.signal });
    const latencyMs = Date.now() - started;
    if (!response.ok) return { ok: false, url, detail: `Server answered ${response.status}.`, latencyMs };
    return { ok: true, url, detail: 'Connected.', latencyMs };
  } catch (error) {
    const message = (error as Error).name === 'AbortError' ? 'No answer within 4 seconds.' : (error as Error).message;
    return { ok: false, url, detail: message };
  } finally {
    clearTimeout(timer);
  }
}

export class NoServerError extends Error {
  constructor() {
    super('No GuideEye server is set. Add its address in Settings.');
    this.name = 'NoServerError';
  }
}

/** fetch against the resolved server, carrying this device's identity. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = await loadApiUrl();
  if (!base) throw new NoServerError();
  const headers = new Headers(init.headers ?? {});
  for (const [key, value] of Object.entries(getSightHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await apiFetch(path, { ...init, headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${path} failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return (await response.json()) as T;
}
