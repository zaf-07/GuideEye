export type PeerEvent = { id: string };
export type PeerMessageEvent = { id: string; text: string };
export type PeerErrorEvent = { message: string };

export type GuideEyeMultipeerModuleEvents = {
  onPeerFound: (event: PeerEvent) => void;
  onPeerLost: (event: PeerEvent) => void;
  onConnected: (event: PeerEvent) => void;
  onDisconnected: (event: PeerEvent) => void;
  onMessage: (event: PeerMessageEvent) => void;
  onError: (event: PeerErrorEvent) => void;
};
