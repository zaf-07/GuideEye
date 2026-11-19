import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { askAssistant, reportLocation, type AssistantReply, type Coordinates } from './assistant';
import { announce } from './lib/announce';
import { useProfile } from './state/ProfileContext';

const ROUTE_UPDATE_METERS = 8;
const ROUTE_UPDATE_MS = 4000;

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
        const next = await askAssistant(request, await currentCoordinates());
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
        reportLocation({ lat: position.coords.latitude, lon: position.coords.longitude })
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
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return { reply, busy, error, navigating, ask, setError };
}
