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
//
// Defect fixed 5 Nov 2026 (Ahmed: «the page reloaded on its own and my text was gone»): supabase-js re-checks the session
// every time the tab comes back to the front (_recoverAndRefresh) and announces it as SIGNED_IN for the SAME user. That
// event used to count as a new sign-in: status 'loading' → the splash → every screen unmounted and mounted again, so
// whatever was being typed was lost. Now any event for the user already signed in is a quiet refresh: the screen stays
// mounted, `session` / `me` keep their identity unless something really changed (another user, new permissions), and
// nothing a form holds is touched. Only a different user, or no user, takes the full path.
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
  const meRef = useRef<Me | null>(null);
  const sessionRef = useRef<Session | null>(null);

  /** load my_staff for `s`; `soft` keeps the current me (and status) until the answer arrives */
  const load = useCallback(async (s: Session | null, soft: boolean) => {
    const n = ++seq.current;
    // the same user again (a token refresh, the tab back in front, a duplicate event): never a new screen
    const sameUser = !!s && !!sessionRef.current && sessionRef.current.user.id === s.user.id && meRef.current !== null;
    if (sameUser) soft = true;
    // keep the session object while the user and token are unchanged, so effects keyed on it do not re-run
    if (!s || !sessionRef.current || sessionRef.current.user.id !== s.user.id || sessionRef.current.access_token !== s.access_token) {
      sessionRef.current = s;
      setSession(s);
    }
    if (!s) {
      meRef.current = null;
      setMe(null);
      setStatus('ready');
      return;
    }
    if (!soft) setStatus('loading');
    try {
      const m = await loadMe();
      if (n !== seq.current) return;
      // the same answer keeps the same object: nothing downstream re-renders for an unchanged user
      if (!meRef.current || JSON.stringify(meRef.current) !== JSON.stringify(m)) {
        meRef.current = m;
        setMe(m);
      }
      setStatus('ready');
    } catch {
      if (n !== seq.current) return;
      if (!soft) {
        meRef.current = null;
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
      // a token refresh, a duplicate initial event, or SIGNED_IN for the user already shown (the tab back in front):
      // keep what is shown, update quietly — load() also forces this for the same user
      const soft = event === 'TOKEN_REFRESHED' || (event === 'INITIAL_SESSION' && known) || (event === 'SIGNED_IN' && known && sessionRef.current?.user.id === s?.user.id);
      void load(s, soft);
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh, load]);

  // my own matrix changed (another admin) → re-read quietly; RLS lets a user see only their own rows
  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) return;
    const again = () => void load(sessionRef.current, true);
    const ch = supabase
      .channel(`perms-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_permissions', filter: `user_id=eq.${uid}` }, again)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff', filter: `user_id=eq.${uid}` }, again)
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [uid, load]);

  // the second step can be withdrawn from elsewhere (an admin revoked the devices, a password change): re-read quietly
  useEffect(() => {
    if (!uid) return;
    const again = () => {
      if (document.visibilityState === 'visible') void load(sessionRef.current, true);
    };
    document.addEventListener('visibilitychange', again);
    const t = setInterval(again, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', again);
      clearInterval(t);
    };
  }, [uid, load]);

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
    () => ({ session, me, status, loading: status === 'loading', refresh, signOut: async () => {
      try {
        sessionStorage.setItem('armada-signed-out', '1');
      } catch { /* private mode */ }
      await supabase.auth.signOut();
    } }),
    [session, me, status, refresh],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
