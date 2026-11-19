import type { GuideEyeMultipeerModuleEvents } from '../../modules/guideeye-multipeer/src/GuideEyeMultipeer.types';

type NativeMultipeer = {
  start(name: string): boolean;
  stop(): void;
  invite(id: string): boolean;
  send(text: string): boolean;
  disconnect(): void;
  connectedPeers(): string[];
  addListener<E extends keyof GuideEyeMultipeerModuleEvents>(
    event: E,
    listener: GuideEyeMultipeerModuleEvents[E],
  ): { remove(): void };
};

let native: NativeMultipeer | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = (require('../../modules/guideeye-multipeer/src/GuideEyeMultipeerModule').default ?? null) as NativeMultipeer | null;
} catch {
  native = null;
}

export function multipeerAvailable(): boolean {
  return native !== null;
}

export function newPeerName(): string {
  return `ge-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export type MultipeerHandlers = {
  found: (id: string) => void;
  lost: (id: string) => void;
  connected: (id: string) => void;
  disconnected: (id: string) => void;
  message: (id: string, text: string) => void;
};

export function startMultipeer(name: string, handlers: MultipeerHandlers) {
  const module = native;
  if (!module) return null;
  const subscriptions = [
    module.addListener('onPeerFound', (event) => handlers.found(event.id)),
    module.addListener('onPeerLost', (event) => handlers.lost(event.id)),
    module.addListener('onConnected', (event) => handlers.connected(event.id)),
    module.addListener('onDisconnected', (event) => handlers.disconnected(event.id)),
    module.addListener('onMessage', (event) => handlers.message(event.id, event.text)),
  ];
  let started = false;
  try {
    started = module.start(name);
  } catch {
    started = false;
  }
  if (!started) {
    subscriptions.forEach((subscription) => subscription.remove());
    return null;
  }
  return {
    invite: (id: string) => { try { module.invite(id); } catch {} },
    send: (text: string) => { try { return module.send(text); } catch { return false; } },
    disconnect: () => { try { module.disconnect(); } catch {} },
    stop: () => {
      subscriptions.forEach((subscription) => subscription.remove());
      try { module.stop(); } catch {}
    },
  };
}
