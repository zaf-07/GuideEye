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

export function useNearby(enabled: boolean, role: NearbyRole | null, paused: boolean) {
  const [fromCloud, setFromCloud] = useState<NearbyOffer | null>(null);
  const [fromPeer, setFromPeer] = useState<NearbyOffer | null>(null);
  const [match, setMatch] = useState<NearbyMatch | null>(null);
  const cloudHealthy = useRef(radarConfigured());
  const peerBeacon = useRef<string | null>(null);
  const position = useRef<{ lat: number; lon: number } | null>(null);
  const link = useRef<PeerLink | null>(null);
  const pausedRef = useRef(paused);
  const handled = useRef(new Set<string>());
  pausedRef.current = paused;

  const offerMatch = useCallback((next: NearbyMatch) => {
    if (handled.current.has(next.code)) return;
    handled.current.add(next.code);
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
    let peer: PeerLink | null = null;
    const transport = startMultipeer(name, {
      found: (id) => { if (!pausedRef.current) peer?.found(id); },
      lost: () => {},
      connected: (id) => peer?.connected(id),
      disconnected: (id) => peer?.disconnected(id),
      message: (id, text) => peer?.received(id, text),
    });
    if (!transport) return undefined;
    peer = new PeerLink(name, role, transport, {
      onOffer: (offer) => setFromPeer(pausedRef.current && !offer?.youAccepted ? null : offer),
      onMatch: (next) => {
        openPeerBridge(next.code, (message) => peer?.sendMessage(message) ?? false);
        offerMatch(next);
      },
      onBeacon: (beacon) => { peerBeacon.current = beacon; },
      onMessage: receivePeerMessage,
      onPartner: setPeerPartner,
    }, () => !cloudHealthy.current);
    link.current = peer;
    return () => {
      link.current = null;
      peer?.end();
      transport.stop();
      closePeerBridge();
      setFromPeer(null);
    };
  }, [enabled, role, offerMatch]);

  useEffect(() => {
    if (paused || !link.current?.isMatched) return;
    link.current.end();
    closePeerBridge();
  }, [paused]);

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
      if (appActive) {
        const beacon = STATIC_BEACON || peerBeacon.current;
        if (position.current || beacon) {
          try {
            const state = await sendHeartbeat(role, position.current, beacon);
            if (cancelled) return;
            failures = 0;
            cloudHealthy.current = true;
            waitSeconds = state.heartbeat_every_s || 5;
            applyCloud(state);
          } catch {
            failures += 1;
            if (failures >= CLOUD_FAILURES_BEFORE_PEER) {
              cloudHealthy.current = false;
              setFromCloud(null);
            }
          }
        }
      }
      if (!cancelled) timer = setTimeout(tick, waitSeconds * 1000);
    };

    const onEvent = (event: RadarEvent) => {
      if (cancelled) return;
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

  const offer = fromCloud ?? fromPeer;

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
