import React, { createContext, useContext, useMemo, useState } from 'react';
import { DEFAULT_PROFILE, Profile } from '../../state/profile';

interface DraftCtx {
  draft: Profile;
  set: (p: Partial<Profile>) => void;
}

const Ctx = createContext<DraftCtx | undefined>(undefined);

/** Holds answers while the user moves through onboarding; committed at the end. */
export function DraftProvider({
  initial,
  children,
}: {
  initial?: Partial<Profile>;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<Profile>({ ...DEFAULT_PROFILE, ...initial });
  const value = useMemo(
    () => ({ draft, set: (p: Partial<Profile>) => setDraft((d) => ({ ...d, ...p })) }),
    [draft],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDraft() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDraft must be used inside <DraftProvider>');
  return ctx;
}

/** Total onboarding steps, used by the progress rule. */
export const TOTAL_STEPS = 4;
