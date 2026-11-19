import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PROFILE, Profile } from './profile';

const KEY = 'guideeye.profile.v1';

interface Ctx {
  /** null until storage has been read. */
  ready: boolean;
  profile: Profile;
  /** True once onboarding completed — drives the root navigator swap. */
  onboarded: boolean;
  patch: (p: Partial<Profile>) => Promise<void>;
  completeOnboarding: (p: Partial<Profile>) => Promise<void>;
  /** Sends the user back through the impairment branch from Settings. */
  restartOnboarding: () => Promise<void>;
}

const ProfileContext = createContext<Ctx | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);

  useEffect(() => {
    (async () => {
      try {
        const rawProfile = await AsyncStorage.getItem(KEY);
        if (rawProfile) setProfile({ ...DEFAULT_PROFILE, ...JSON.parse(rawProfile) });
      } catch {
        // Corrupt storage should never block the app from opening.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const patch = useCallback(
    async (p: Partial<Profile>) => {
      setProfile((cur) => {
        const next = { ...cur, ...p };
        AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const value = useMemo<Ctx>(
    () => ({
      ready,
      profile,
      onboarded: Boolean(profile.onboardedAt) && profile.impairments.length > 0,
      patch,
      completeOnboarding: async (p: Partial<Profile>) => {
        await patch({ ...p, onboardedAt: new Date().toISOString() });
      },
      restartOnboarding: async () => {
        // Keep preferences, drop the completion stamp so the root navigator
        // re-mounts the onboarding stack.
        await patch({ onboardedAt: undefined });
      },
    }),
    [ready, profile, patch],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>');
  return ctx;
}
