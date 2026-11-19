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

export function askAssistant(text: string, location?: Coordinates | null) {
  return request<AssistantReply>('/assistant', {
    method: 'POST',
    body: form({ text, session: getSightDeviceId(), lat: location?.lat, lon: location?.lon }),
  });
}

export function reportLocation(location: Coordinates) {
  return request<RouteUpdate>('/location', { method: 'POST', body: form({ ...location, session: getSightDeviceId() }) });
}
