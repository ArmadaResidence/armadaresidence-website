// Auth + staff context. Supabase Auth session → public.my_staff() (role, branch, needs_second_factor, permissions,
// sections). The second step (phase 2a.2: a 6-digit email code, a remembered device or an admin backup code) is required
// for every user; below it no data policy answers. A revoked device or session is noticed when the tab comes back to the
// front and every minute (my_staff re-read quietly), so the gate sends the user to /code without a reload. A change to my own permissions (Realtime on staff_permissions) re-reads my_staff,
// so a revoked section leaves the nav at once; the database already refuses it.
//
// Status (26 Oct 2026, defect: «لا صلاحية» flashed on load): `status` is 'loading' until the session AND my_staff()
// have both resolved — the gate shows a neutral splash meanwhile and decides «no access» only on a definitive answer
// (no staff row, or an inactive user). A failed my_staff() is 'error' (retry), never «no access». While a user is
// already known, a refresh (token, Realtime) keeps the current `me` until the new one arrives: no flicker.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { me as loadMe, type Me } from './api';

export type SessionStatus = 'loading' | 'ready' | 'error';
interface Ctx {
  session: Session | null;
  me: Me | null;
  status: SessionStatus;
  /** true until the first answer (kept for callers that only need a boolean) */
  loading: boolean;
  /** re-read the session and my_staff; `soft` keeps the current screen mounted (no splash) until the answer arrives */
  refresh: (soft?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Ctx>({ session: null, me: null, status: 'loading', loading: true, refresh: async () => {}, signOut: async () => {} });

const IDLE_MS = 12 * 60 * 60 * 1000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const seq = useRef(0); // the latest load wins; stale answers are dropped

  /** load my_staff for `s`; `soft` keeps the current me (and status) until the answer arrives */
  const load = useCallback(async (s: Session | null, soft: boolean) => {
    const n = ++seq.current;
    setSession(s);
    if (!s) {
      setMe(null);
      setStatus('ready');
      return;
    }
    if (!soft) setStatus('loading');
    try {
      const m = await loadMe();
      if (n !== seq.current) return;
      setMe(m);
      setStatus('ready');
    } catch {
      if (n !== seq.current) return;
      if (!soft) {
        setMe(null);
        setStatus('error');
      }
    }
  }, []);

  const refresh = useCallback(async (soft = false) => {
    const { data } = await supabase.auth.getSession();
    await load(data.session, soft);
  }, [load]);

  useEffect(() => {
    let known = false;
    refresh().then(() => (known = true));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') return void load(null, false);
      // a token refresh or a duplicate initial event: keep what is shown, update quietly
      const soft = event === 'TOKEN_REFRESHED' || (event === 'INITIAL_SESSION' && known);
      void load(s, soft);
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh, load]);

  // my own matrix changed (another admin) → re-read quietly; RLS lets a user see only their own rows
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    const again = () => void load(session, true);
    const ch = supabase
      .channel(`perms-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_permissions', filter: `user_id=eq.${uid}` }, again)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff', filter: `user_id=eq.${uid}` }, again)
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [session, load]);

  // the second step can be withdrawn from elsewhere (an admin revoked the devices, a password change): re-read quietly
  useEffect(() => {
    if (!session) return;
    const again = () => {
      if (document.visibilityState === 'visible') void load(session, true);
    };
    document.addEventListener('visibilitychange', again);
    const t = setInterval(again, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', again);
      clearInterval(t);
    };
  }, [session, load]);

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

  const value = useMemo<Ctx>(
    () => ({ session, me, status, loading: status === 'loading', refresh, signOut: async () => void (await supabase.auth.signOut()) }),
    [session, me, status, refresh],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
