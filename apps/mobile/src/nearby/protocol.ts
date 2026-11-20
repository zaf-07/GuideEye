export type NearbyRole = 'blind' | 'deaf';

export type NearbyOffer = {
  source: 'cloud' | 'peer';
  id: string;
  closeness: string;
  youAccepted: boolean;
  partnerAccepted: boolean;
};

export type NearbyMatch = { code: string; role: NearbyRole };

export type PeerBridgeMessage = {
  sender_role: NearbyRole;
  text: string;
  client_id: string;
  created_at: string;
};

export type PeerWire =
  | { t: 'hello'; role: NearbyRole }
  | { t: 'accept' }
  | { t: 'decline' }
  | { t: 'msg'; m: PeerBridgeMessage };

const PARTNER: Record<NearbyRole, NearbyRole> = { blind: 'deaf', deaf: 'blind' };
// Matches the server: after "Not now" the same person is not offered again for two minutes.
const PEER_COOLDOWN_MS = 2 * 60 * 1000;

export function roleForImpairments(impairments: readonly string[]): NearbyRole | null {
  if (impairments.includes('vision')) return 'blind';
  if (impairments.includes('hearing')) return 'deaf';
  if (impairments.includes('communicator')) return 'blind';
  return null;
}

export function socketUrl(apiUrl: string, path: string): string {
  return `${apiUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}${path}`;
}

export function peerCode(left: string, right: string): string {
  const joined = [left, right].sort().join('|');
  let hash = 2166136261;
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return String(100000 + (hash % 900000));
}

export function peerBeacon(left: string, right: string): string {
  return `mp-${[left, right].sort().join('-')}`.slice(0, 64);
}

export function parseWire(text: string): PeerWire | null {
  try {
    const value = JSON.parse(text) as Partial<PeerWire> & { role?: unknown; m?: Partial<PeerBridgeMessage> };
    if (value.t === 'hello' && (value.role === 'blind' || value.role === 'deaf')) return { t: 'hello', role: value.role };
    if (value.t === 'accept' || value.t === 'decline') return { t: value.t };
    if (value.t === 'msg' && value.m && typeof value.m.text === 'string' && typeof value.m.client_id === 'string'
      && (value.m.sender_role === 'blind' || value.m.sender_role === 'deaf')) {
      return { t: 'msg', m: {
        sender_role: value.m.sender_role, text: value.m.text.slice(0, 600), client_id: value.m.client_id.slice(0, 80),
        created_at: typeof value.m.created_at === 'string' ? value.m.created_at : new Date().toISOString(),
      } };
    }
  } catch {}
  return null;
}

export function promptCopy(offer: NearbyOffer, audioFirst: boolean) {
  const where = offer.closeness === 'very close' ? 'right next to you' : 'nearby';
  if (offer.youAccepted && !offer.partnerAccepted) {
    return { title: 'Waiting for the other person', detail: 'They have not answered yet.', spoken: 'Waiting for the other person.' };
  }
  return {
    title: 'Someone nearby wants to talk',
    detail: `A GuideEye user is ${where}. Connect to start a conversation.`,
    spoken: audioFirst
      ? `A GuideEye user is ${where} and can talk with you. Say connect, or double tap the screen. Say no to skip.`
      : `A GuideEye user is ${where}.`,
  };
}

const ACCEPT_WORDS = /^(?:yes|yeah|yep|okay|ok|sure|connect|accept)(?: (?:please|connect|yes|sure|now))?$/;
const DECLINE_WORDS = /^(?:no|nope|not now|cancel|decline|skip|stop)(?: (?:thanks|thank you|please|now))?$/;

/**
 * A spoken answer to the nearby prompt. Only a short answer counts: the whole
 * utterance has to be the answer. Matching the words anywhere in a sentence
 * meant that GuideEye's own prompt ("…say no to skip"), picked up by the
 * microphone, declined the offer, and any passing "no" or "ok" answered it.
 */
export function commandFrom(transcript: string): 'accept' | 'decline' | null {
  const said = transcript
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:hey |ok |okay )?guide(?: ?eye)? /, '')
    .trim();
  if (!said || said.split(' ').length > 3) return null;
  if (DECLINE_WORDS.test(said)) return 'decline';
  if (ACCEPT_WORDS.test(said)) return 'accept';
  return null;
}

type Transport = {
  invite: (peer: string) => void;
  send: (text: string) => boolean;
  disconnect: () => void;
};

type Handlers = {
  onOffer: (offer: NearbyOffer | null) => void;
  onMatch: (match: NearbyMatch) => void;
  onBeacon: (beacon: string | null) => void;
  onMessage: (message: PeerBridgeMessage) => void;
  onPartner: (connected: boolean) => void;
};

export class PeerLink {
  private peer: string | null = null;
  private partnerRole: NearbyRole | null = null;
  private youAccepted = false;
  private partnerAccepted = false;
  private matched = false;
  private cooldown = new Map<string, number>();

  constructor(
    private readonly me: string,
    private readonly role: NearbyRole,
    private readonly transport: Transport,
    private readonly handlers: Handlers,
    private readonly consentHere: () => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  get connectedPeer() {
    return this.peer;
  }

  get isMatched() {
    return this.matched;
  }

  /**
   * The cloud health check is asynchronous. A peer may have completed its
   * hello exchange while the app still believed the server was healthy. When
   * the radar later fails, promote that already-connected peer to the direct
   * consent flow instead of waiting for another discovery event that may
   * never arrive.
   */
  enableDirectConsent() {
    if (this.peer && this.partnerRole === PARTNER[this.role] && !this.matched) {
      this.publishOffer();
    }
  }

  found(peer: string) {
    if (this.peer || peer === this.me || (this.cooldown.get(peer) ?? 0) > this.now()) return;
    if (this.me < peer) this.transport.invite(peer);
  }

  connected(peer: string) {
    if (this.peer && this.peer !== peer) return;
    this.peer = peer;
    this.send({ t: 'hello', role: this.role });
  }

  disconnected(peer: string) {
    if (peer !== this.peer) return;
    const wasMatched = this.matched;
    this.reset();
    this.handlers.onOffer(null);
    this.handlers.onBeacon(null);
    if (wasMatched) this.handlers.onPartner(false);
  }

  received(peer: string, text: string) {
    if (peer !== this.peer) return;
    const wire = parseWire(text);
    if (!wire) return;
    if (wire.t === 'hello') {
      this.partnerRole = wire.role;
      if (wire.role !== PARTNER[this.role]) {
        this.drop(peer);
        return;
      }
      if (this.consentHere()) this.publishOffer();
      else this.handlers.onBeacon(peerBeacon(this.me, peer));
    } else if (wire.t === 'accept') {
      this.partnerAccepted = true;
      if (this.youAccepted) this.establish();
      else this.publishOffer();
    } else if (wire.t === 'decline') {
      this.drop(peer);
    } else if (wire.t === 'msg' && this.matched) {
      this.handlers.onMessage(wire.m);
    }
  }

  accept() {
    if (!this.peer || this.partnerRole !== PARTNER[this.role] || this.youAccepted) return;
    this.youAccepted = true;
    this.send({ t: 'accept' });
    if (this.partnerAccepted) this.establish();
    else this.publishOffer();
  }

  decline() {
    if (!this.peer) return;
    this.send({ t: 'decline' });
    this.drop(this.peer);
  }

  sendMessage(message: PeerBridgeMessage): boolean {
    return this.matched && this.send({ t: 'msg', m: message });
  }

  end() {
    if (this.peer) this.transport.disconnect();
    this.reset();
  }

  private send(wire: PeerWire) {
    return this.transport.send(JSON.stringify(wire));
  }

  private publishOffer() {
    if (!this.peer || this.matched) return;
    this.handlers.onOffer({
      source: 'peer', id: this.peer, closeness: 'very close',
      youAccepted: this.youAccepted, partnerAccepted: this.partnerAccepted,
    });
  }

  private establish() {
    if (!this.peer || this.matched) return;
    this.matched = true;
    this.handlers.onOffer(null);
    this.handlers.onPartner(true);
    this.handlers.onMatch({ code: peerCode(this.me, this.peer), role: this.role });
  }

  private drop(peer: string) {
    this.cooldown.set(peer, this.now() + PEER_COOLDOWN_MS);
    this.transport.disconnect();
    this.reset();
    this.handlers.onOffer(null);
    this.handlers.onBeacon(null);
  }

  private reset() {
    this.peer = null;
    this.partnerRole = null;
    this.youAccepted = false;
    this.partnerAccepted = false;
    this.matched = false;
  }
}
