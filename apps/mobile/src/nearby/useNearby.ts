import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { PeerLink, type NearbyMatch, type NearbyOffer, type NearbyRole } from './protocol';
import { newPeerName, startMultipeer } from './multipeer';
import { closePeerBridge, openPeerBridge, receivePeerMessage, setPeerPartner } from './peerBridge';
import {
  leaveRadar,
  openRadarSocket,
  radarConfigured,
  respondToOffer,
  sendHeartbeat,
  type RadarEvent,
  type RadarOffer,
  type RadarState,
} from './radar';

const CLOUD_FAILURES_BEFORE_PEER = 2;
const STATIC_BEACON = process.env.EXPO_PUBLIC_RADAR_BEACON || '';

function cloudOffer(offer: RadarOffer | null): NearbyOffer | null {
  if (!offer) return null;
  return {
    source: 'cloud', id: offer.offer_id, closeness: offer.closeness,
    youAccepted: offer.you_accepted, partnerAccepted: offer.partner_accepted,
  };
}

/**
 * `busy` is true while a conversation is open. The phone then stays off the
 * cloud radar (nobody is offered a second conversation mid-sentence) but keeps
 * its direct link, which is carrying the conversation.
 */
export function useNearby(enabled: boolean, role: NearbyRole | null, paused: boolean, busy = false) {
  const [fromCloud, setFromCloud] = useState<NearbyOffer | null>(null);
  const [fromPeer, setFromPeer] = useState<NearbyOffer | null>(null);
  const [match, setMatch] = useState<NearbyMatch | null>(null);
  const cloudHealthy = useRef(radarConfigured());
  const peerBeacon = useRef<string | null>(null);
  const position = useRef<{ lat: number; lon: number } | null>(null);
  const link = useRef<PeerLink | null>(null);
  const pausedRef = useRef(paused);
  const busyRef = useRef(busy);
  const handled = useRef(new Set<string>());
  const wasBusy = useRef(busy);
  pausedRef.current = paused;
  busyRef.current = busy;

  const offerMatch = useCallback((next: NearbyMatch, direct = false) => {
    if (!direct && handled.current.has(next.code)) return;
    if (!direct) handled.current.add(next.code);
    setFromCloud(null);
    setFromPeer(null);
    setMatch(next);
  }, []);

  const applyCloud = useCallback((state: Pick<RadarState, 'offer' | 'match'>) => {
    setFromCloud(cloudOffer(state.offer));
    if (state.match) offerMatch({ code: state.match.code, role: state.match.your_role });
  }, [offerMatch]);

  useEffect(() => {
    if (!enabled || !role) return undefined;
    const name = newPeerName();
    const nearby = new Set<string>();
    const inviteAfter = new Map<string, number>();
    let peer: PeerLink | null = null;
    const discover = () => {
      if (!peer || peer.connectedPeer || pausedRef.current || busyRef.current || AppState.currentState !== 'active') return;
      const now = Date.now();
      for (const id of nearby) {
        if (name >= id || (inviteAfter.get(id) ?? 0) > now) continue;
        if (peer.found(id)) {
          inviteAfter.set(id, now + 22000);
          break;
        }
      }
    };
    const transport = startMultipeer(name, {
      found: (id) => { nearby.add(id); discover(); },
      lost: (id) => { nearby.delete(id); inviteAfter.delete(id); },
      connected: (id) => peer?.connected(id),
      disconnected: (id) => {
        peer?.disconnected(id);
        inviteAfter.set(id, Date.now() + 3000);
      },
      message: (id, text) => peer?.received(id, text),
    });
    if (!transport) return undefined;
    peer = new PeerLink(name, role, transport, {
      onOffer: (offer) => setFromPeer(pausedRef.current && !offer?.youAccepted ? null : offer),
      onMatch: (next) => {
        openPeerBridge(next.code, (message) => peer?.sendMessage(message) ?? false);
        offerMatch(next, true);
      },
      onBeacon: (beacon) => { peerBeacon.current = beacon; },
      onMessage: receivePeerMessage,
      onPartner: setPeerPartner,
    }, () => !cloudHealthy.current);
    link.current = peer;
    discover();
    const retry = setInterval(discover, 3000);
    return () => {
      clearInterval(retry);
      link.current = null;
      peer?.end();
      transport.stop();
      closePeerBridge();
      setFromPeer(null);
    };
  }, [enabled, role, offerMatch]);

  useEffect(() => {
    const leftConversation = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (leftConversation) {
      link.current?.end();
      peerBeacon.current = null;
      closePeerBridge();
      setFromPeer(null);
      setFromCloud(null);
    }
  }, [busy]);

  useEffect(() => {
    if (!enabled || !role || paused) return undefined;
    let watcher: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted || cancelled) return;
        const subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 5000 },
          (fix) => { position.current = { lat: fix.coords.latitude, lon: fix.coords.longitude }; },
        );
        if (cancelled) subscription.remove();
        else watcher = subscription;
      } catch {}
    })();
    return () => {
      cancelled = true;
      watcher?.remove();
    };
  }, [enabled, role, paused]);

  useEffect(() => {
    if (!enabled || !role || paused || !radarConfigured()) {
      cloudHealthy.current = false;
      setFromCloud(null);
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let appActive = AppState.currentState === 'active';

    const tick = async () => {
      if (cancelled) return;
      let waitSeconds = 5;
      if (appActive && busyRef.current) {
        setFromCloud(null);
      } else if (appActive) {
        const beacon = STATIC_BEACON || peerBeacon.current;
        if (position.current || beacon) {
          try {
            const state = await sendHeartbeat(role, position.current, beacon);
            if (cancelled) return;
            failures = 0;
            cloudHealthy.current = true;
            waitSeconds = state.heartbeat_every_s || 5;
            if (!busyRef.current && appActive) applyCloud(state);
          } catch {
            failures += 1;
            if (failures >= CLOUD_FAILURES_BEFORE_PEER) {
              cloudHealthy.current = false;
              setFromCloud(null);
              link.current?.enableDirectConsent();
            }
          }
        }
      }
      if (!cancelled) timer = setTimeout(tick, waitSeconds * 1000);
    };

    const onEvent = (event: RadarEvent) => {
      if (cancelled || busyRef.current) return;
      if (event.event === 'state') applyCloud(event);
      else if (event.event === 'offer' || event.event === 'offer_update') setFromCloud(cloudOffer(event));
      else if (event.event === 'declined' || event.event === 'expired') setFromCloud(null);
      else if (event.event === 'match') offerMatch({ code: event.code, role: event.your_role });
    };

    cloudHealthy.current = true;
    const closeSocket = openRadarSocket(onEvent);
    const appState = AppState.addEventListener('change', (state) => {
      appActive = state === 'active';
      if (!appActive) void leaveRadar();
    });
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      closeSocket();
      appState.remove();
      void leaveRadar();
    };
  }, [enabled, role, paused, applyCloud, offerMatch]);

  // Step off the radar the moment a conversation opens, instead of waiting
  // for presence to time out on the server.
  useEffect(() => {
    if (busy && enabled && radarConfigured()) void leaveRadar();
  }, [busy, enabled]);

  const offer = busy ? null : fromCloud ?? fromPeer;

  const accept = useCallback(() => {
    if (!offer) return;
    if (offer.source === 'peer') {
      link.current?.accept();
      return;
    }
    setFromCloud({ ...offer, youAccepted: true });
    respondToOffer(offer.id, true).then(applyCloud).catch(() => setFromCloud(null));
  }, [offer, applyCloud]);

  const decline = useCallback(() => {
    if (!offer) return;
    if (offer.source === 'peer') {
      link.current?.decline();
      setFromPeer(null);
      return;
    }
    setFromCloud(null);
    respondToOffer(offer.id, false).catch(() => {});
  }, [offer]);

  const clearMatch = useCallback(() => setMatch(null), []);

  return { offer, match, accept, decline, clearMatch };
}
