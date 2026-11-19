import { getApiUrl } from '../vision';
import { getSightDeviceId, getSightDeviceSecret, getSightHeaders } from '../sightIdentity';
import { socketUrl, type NearbyRole } from './protocol';

export type RadarOffer = {
  offer_id: string;
  expires_in_s: number;
  closeness: string;
  you_accepted: boolean;
  partner_accepted: boolean;
};

export type RadarMatch = { code: string; your_role: NearbyRole; partner_role: NearbyRole };

export type RadarState = {
  active: boolean;
  heartbeat_every_s: number;
  offer: RadarOffer | null;
  match: RadarMatch | null;
};

export type RadarEvent =
  | ({ event: 'state' } & RadarState)
  | ({ event: 'offer' | 'offer_update' } & RadarOffer)
  | ({ event: 'match' } & RadarMatch)
  | { event: 'declined' | 'expired'; offer_id: string }
  | { event: 'error'; detail: string };

const REQUEST_TIMEOUT_MS = 4000;

export function radarConfigured(): boolean {
  return Boolean(getApiUrl());
}

async function radarRequest<T>(path: string, body: unknown): Promise<T> {
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new Error('No GuideEye server is configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { ...getSightHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Radar request failed (${response.status})`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function sendHeartbeat(role: NearbyRole, position: { lat: number; lon: number } | null, beacon: string | null) {
  return radarRequest<RadarState>('/v1/radar/heartbeat', {
    role,
    lat: position?.lat ?? null,
    lon: position?.lon ?? null,
    beacon: beacon || null,
  });
}

export function respondToOffer(offerId: string, accept: boolean) {
  return radarRequest<RadarState>('/v1/radar/respond', { offer_id: offerId, accept });
}

export function leaveRadar() {
  return radarRequest<{ active: boolean }>('/v1/radar/leave', {}).catch(() => ({ active: false }));
}

export function openRadarSocket(onEvent: (event: RadarEvent) => void): () => void {
  const apiUrl = getApiUrl();
  if (!apiUrl || typeof WebSocket === 'undefined') return () => {};
  let closed = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (closed) return;
    try {
      socket = new WebSocket(socketUrl(apiUrl, '/v1/radar/ws'));
    } catch {
      return;
    }
    socket.onopen = () => {
      socket?.send(JSON.stringify({ device_id: getSightDeviceId(), secret: getSightDeviceSecret() }));
    };
    socket.onmessage = (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as RadarEvent);
      } catch {}
    };
    socket.onclose = () => {
      if (!closed) retry = setTimeout(connect, 5000);
    };
    socket.onerror = () => {};
  };
  connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    try { socket?.close(); } catch {}
  };
}
