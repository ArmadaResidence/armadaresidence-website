// Auth + staff context. Supabase Auth session → public.my_staff() (role, branch, needs_mfa). Admin / management /
// sales must pass the TOTP step (aal2) before any data policy lets them read (decision 8, Q8); reception may skip it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { me as loadMe, type Me } from './api';

interface Ctx {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Ctx>({ session: null, me: null, loading: true, refresh: async () => {}, signOut: async () => {} });

const IDLE_MS = 12 * 60 * 60 * 1000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    if (data.session) {
      try {
        setMe(await loadMe());
      } catch {
        setMe(null);
      }
    } else setMe(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadMe().then(setMe).catch(() => setMe(null));
      else setMe(null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  // idle sign-out after 12 h without interaction
  useEffect(() => {
    let last = Date.now();
    const bump = () => (last = Date.now());
    const check = () => {
      if (session && Date.now() - last > IDLE_MS) supabase.auth.signOut();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => addEventListener(e, bump, { passive: true }));
    const t = setInterval(check, 60_000);
    return () => {
      events.forEach((e) => removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [session]);

  const value = useMemo<Ctx>(() => ({ session, me, loading, refresh, signOut: async () => void (await supabase.auth.signOut()) }), [session, me, loading, refresh]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
