import { Platform } from 'react-native';
import { getSightDeviceId } from './sightIdentity';
import { getApiUrl } from './vision';

export type Contact = { name: string; phone: string };

export type Coordinates = { lat: number; lon: number };

export type AssistantReply = {
  intent: string;
  heard: string;
  say: string;
  confirm: string | null;
  open_url: string | null;
  map_url: string | null;
  navigating: boolean;
  timer: { seconds: number; label: string } | null;
  warnings: string[];
};

export type RouteUpdate = {
  active: boolean;
  say: string | null;
  destination?: string;
  remaining?: string;
};

export type Place = { name: string; label: string; lat: number; lon: number };

export type RouteStep = { say: string; turn: string; lat: number; lon: number; distance_m: number };

export type RouteSnapshot =
  | { active: false }
  | {
      active: true;
      destination: { name: string; lat: number; lon: number };
      distance_m: number;
      next: number;
      steps: RouteStep[];
    };

export function assistantConfigured() {
  return Boolean(getApiUrl());
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new Error('Set the GuideEye server address in Settings first.');
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, init);
  } catch {
    throw new Error('The GuideEye server could not be reached.');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : '';
    throw new Error(detail || `The request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function form(fields: Record<string, string | number | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data.append(key, String(value));
  }
  return data;
}

export function listContacts() {
  return request<Contact[]>('/contacts');
}

export function addContact(name: string, phone: string) {
  return request<Contact>('/contacts', { method: 'POST', body: form({ name, phone }) });
}

export function removeContact(name: string) {
  return request<{ status: string }>(`/contacts/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

async function attachFrame(data: FormData, field: string, uri: string) {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    data.append(field, await response.blob(), 'frame.jpg');
  } else {
    data.append(field, { uri, name: 'frame.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
}

export async function askAssistant(text: string, location?: Coordinates | null, frameUri?: string | null) {
  const body = form({ text, session: getSightDeviceId(), lat: location?.lat, lon: location?.lon });
  if (frameUri) await attachFrame(body, 'image', frameUri).catch(() => {});
  return request<AssistantReply>('/assistant', { method: 'POST', body });
}

export function reportLocation(location: Coordinates, heading?: number | null) {
  const facing = typeof heading === 'number' && heading >= 0 && heading <= 360 ? heading : undefined;
  return request<RouteUpdate>('/location', {
    method: 'POST',
    body: form({ ...location, heading: facing, session: getSightDeviceId() }),
  });
}

export function routeSnapshot() {
  return request<RouteSnapshot>(`/navigation/route?session=${encodeURIComponent(getSightDeviceId())}`);
}

export function listPlaces() {
  return request<Place[]>('/places');
}

export function savePlace(name: string, address: string, location?: Coordinates | null) {
  return request<Place>('/places', {
    method: 'POST',
    body: form({ name, address, lat: location?.lat, lon: location?.lon }),
  });
}

export function removePlace(name: string) {
  return request<{ status: string }>(`/places/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function observeForMemory(frameUri: string, location?: Coordinates | null) {
  const body = form({ lat: location?.lat, lon: location?.lon });
  await attachFrame(body, 'image', frameUri);
  return request<unknown>('/memory/observe', { method: 'POST', body });
}
