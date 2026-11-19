import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { askAssistant, reportLocation, routeSnapshot, type AssistantReply, type Coordinates, type RouteSnapshot } from './assistant';
import { announce } from './lib/announce';
import { useProfile } from './state/ProfileContext';
import { captureFrame, hasFrameSource, needsCamera, waitForFrameSource } from './voice/frame';

const ROUTE_UPDATE_METERS = 8;
const ROUTE_UPDATE_MS = 4000;
const ROUTE_SNAPSHOT_MS = 5000;
const CAMERA_WAIT_MS = 7000;
const CAMERA_SETTLE_MS = 1300;

export type RouteGuide = {
  destination: string;
  remainingMeters: number;
  turn: string;
  say: string;
  stepMeters: number;
};

function toGuide(snapshot: RouteSnapshot): RouteGuide | null {
  if (!snapshot.active) return null;
  const step = snapshot.steps[Math.min(snapshot.next, snapshot.steps.length - 1)];
  return {
    destination: snapshot.destination.name,
    remainingMeters: snapshot.distance_m,
    turn: step?.turn ?? 'straight',
    say: step?.say ?? '',
    stepMeters: step?.distance_m ?? 0,
  };
}

async function frameFor(request: string, say: (message: string) => void): Promise<string | null> {
  if (hasFrameSource()) return captureFrame();
  if (!needsCamera(request)) return null;
  say('Opening the camera. Point the phone at it.');
  router.push('/camera?mode=scene&pocket=true' as never);
  if (!(await waitForFrameSource(CAMERA_WAIT_MS))) return null;
  await new Promise((resolve) => setTimeout(resolve, CAMERA_SETTLE_MS));
  return captureFrame();
}

export async function currentCoordinates(): Promise<Coordinates | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: position.coords.latitude, lon: position.coords.longitude };
  } catch {
    return null;
  }
}

export function useAssistant() {
  const { profile } = useProfile();
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [navigating, setNavigating] = useState(false);
  const [guide, setGuide] = useState<RouteGuide | null>(null);
  const heading = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const profileRef = useRef(profile);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const say = useCallback((message: string) => {
    if (message) announce(profileRef.current, message, { urgent: true });
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const request = text.trim();
      if (!request) return null;
      setBusy(true);
      setError('');
      try {
        const [location, frame] = await Promise.all([currentCoordinates(), frameFor(request, say)]);
        const next = await askAssistant(request, location, frame);
        setReply(next);
        setNavigating(next.navigating);
        say(next.say);
        if (next.open_url) Linking.openURL(next.open_url).catch(() => setError('That could not be opened on this device.'));
        if (next.timer) {
          const label = next.timer.label ? `Reminder: ${next.timer.label}.` : 'Your timer is finished.';
          timers.current.push(setTimeout(() => say(label), next.timer.seconds * 1000));
        }
        return next;
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : 'Something went wrong.';
        setError(message);
        say(message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [say],
  );

  useEffect(() => {
    if (!navigating) return undefined;
    let active = true;
    let subscription: Location.LocationSubscription | undefined;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: ROUTE_UPDATE_METERS, timeInterval: ROUTE_UPDATE_MS },
      (position) => {
        const course = position.coords.heading;
        const facing = heading.current ?? (typeof course === 'number' && course >= 0 ? course : null);
        reportLocation({ lat: position.coords.latitude, lon: position.coords.longitude }, facing)
          .then((update) => {
            if (!active) return;
            if (update.say) say(update.say);
            if (!update.active) setNavigating(false);
          })
          .catch(() => {});
      },
    )
      .then((created) => {
        if (active) subscription = created;
        else created.remove();
      })
      .catch(() => {});
    return () => {
      active = false;
      subscription?.remove();
    };
  }, [navigating, say]);

  useEffect(() => {
    if (!navigating) {
      setGuide(null);
      heading.current = null;
      return undefined;
    }
    let active = true;
    let compass: Location.LocationSubscription | undefined;
    const refresh = () => {
      routeSnapshot()
        .then((snapshot) => {
          if (!active) return;
          setGuide(toGuide(snapshot));
          if (!snapshot.active) setNavigating(false);
        })
        .catch(() => {});
    };
    refresh();
    const poll = setInterval(refresh, ROUTE_SNAPSHOT_MS);
    Location.watchHeadingAsync((value) => {
      const degrees = value.trueHeading >= 0 ? value.trueHeading : value.magHeading;
      heading.current = degrees >= 0 && degrees <= 360 ? degrees : null;
    })
      .then((created) => {
        if (active) compass = created;
        else created.remove();
      })
      .catch(() => {});
    return () => {
      active = false;
      clearInterval(poll);
      compass?.remove();
    };
  }, [navigating]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return { reply, busy, error, navigating, guide, ask, setError };
}
