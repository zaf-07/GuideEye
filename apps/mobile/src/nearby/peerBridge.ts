import type { PeerBridgeMessage } from './protocol';

export type PeerInboxMessage = PeerBridgeMessage & { id: number; from_this_device: boolean };

type Sender = (message: PeerBridgeMessage) => boolean;

let activeCode: string | null = null;
let partnerConnected = false;
let startedAt = 0;
let sender: Sender | null = null;
let lastId = 0;
let inbox: PeerInboxMessage[] = [];

function nextId() {
  lastId = Math.max(Date.now(), lastId + 1);
  return lastId;
}

export function openPeerBridge(code: string, send: Sender) {
  activeCode = code;
  partnerConnected = true;
  startedAt = Date.now();
  sender = send;
  inbox = [];
}

export function closePeerBridge() {
  activeCode = null;
  partnerConnected = false;
  sender = null;
  inbox = [];
}

export function setPeerPartner(connected: boolean) {
  partnerConnected = connected;
}

export function isPeerBridge(code: string | null | undefined): boolean {
  return Boolean(code) && code === activeCode;
}

export function peerBridgeActive(): boolean {
  return activeCode !== null;
}

export function peerConversation(code: string) {
  return {
    code,
    created_at: new Date(startedAt).toISOString(),
    expires_at: new Date(startedAt + 2 * 60 * 60 * 1000).toISOString(),
    devices: partnerConnected ? 2 : 1,
    max_devices: 2,
    partner_joined: partnerConnected,
    is_member: true,
  };
}

export function receivePeerMessage(message: PeerBridgeMessage) {
  if (inbox.some((item) => item.client_id === message.client_id)) return;
  inbox = [...inbox, { ...message, id: nextId(), from_this_device: false }].slice(-200);
}

export function sendPeerMessage(message: PeerBridgeMessage): PeerInboxMessage | null {
  if (!sender || !partnerConnected || !sender(message)) return null;
  return { ...message, id: nextId(), from_this_device: true };
}

export function peerMessagesAfter(afterId = 0): PeerInboxMessage[] {
  return inbox.filter((item) => item.id > afterId);
}
