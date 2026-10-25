// Auth + staff context. Supabase Auth session → public.my_staff() (role, branch, needs_mfa, permissions, sections).
// TOTP (aal2) is required for every role but reception and for anyone with edit on settings or users (phase 2a.1);
// below it no data policy answers. A change to my own permissions (Realtime on staff_permissions) re-reads my_staff,
// so a revoked section leaves the nav at once; the database already refuses it.
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

  // my own matrix changed (another admin) → re-read; RLS lets a user see only their own rows
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    const ch = supabase
      .channel(`perms-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_permissions', filter: `user_id=eq.${uid}` }, () => loadMe().then(setMe).catch(() => setMe(null)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff', filter: `user_id=eq.${uid}` }, () => loadMe().then(setMe).catch(() => setMe(null)))
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [session?.user.id]);

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
