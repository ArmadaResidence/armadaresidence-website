// Live badges (Ahmed, 2 Nov 2026 — part D): the count of booking requests awaiting action on «الحجوزات», kept current
// through Supabase Realtime. The channel is the reservations table's postgres_changes, which Realtime filters with the
// table's own RLS (bookings view + the branch scope): a user who cannot see bookings never subscribes, and a row outside
// a user's scope never reaches them. A new request can raise a browser notification and a short sound — both opt-in
// per user (off by default), only while the dashboard is open, and the text carries the ref and the branch only (no
// guest data). Test bookings are left out (the count and the alerts) unless this browser opted in for QA
// (localStorage `armada-test-events` = 1 — the e2e on a preview branch).
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { canView, type Me } from './api';
import { BRANCH_NAMES } from './format';

const testEvents = () => {
  try {
    return localStorage.getItem('armada-test-events') === '1';
  } catch {
    return false;
  }
};

async function requestCount(): Promise<number | null> {
  let q = supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'request');
  if (!testEvents()) q = q.eq('is_test', false);
  const { count, error } = await q;
  return error ? null : count ?? 0;
}

/** a short two-note chime from WebAudio (no sound file) */
export function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const at = ctx.currentTime;
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.18, at + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.16 + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(at + i * 0.16);
      o.stop(at + i * 0.16 + 0.24);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch { /* no audio: the badge is enough */ }
}

export function notifyText(ref: string, branch: string | null) {
  return { title: 'طلب حجز جديد', body: `${branch ? `${BRANCH_NAMES[branch] ?? branch} — ` : ''}${ref}` };
}

/** the «الحجوزات» badge; `alerts` = the user's opt-ins, read at each event */
export function useBookingBadge(me: Me | null, alerts: () => { notify: boolean; sound: boolean }): number | null {
  const [count, setCount] = useState<number | null>(null);
  const allowed = canView(me, 'bookings');
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  useEffect(() => {
    if (!allowed) {
      setCount(null);
      return;
    }
    let alive = true;
    let timer = 0;
    const recount = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const n = await requestCount();
        if (alive && n !== null) setCount(n);
      }, 250);
    };
    recount();
    const ch = supabase
      .channel('nav-bookings-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (p) => {
        recount();
        const row = p.new as { ref?: string; branch?: string | null; status?: string; is_test?: boolean } | null;
        if (p.eventType !== 'INSERT' || !row || row.status !== 'request' || !row.ref) return;
        if (row.is_test && !testEvents()) return;
        const a = alertsRef.current();
        if (a.notify && 'Notification' in window && Notification.permission === 'granted') {
          const t = notifyText(row.ref, row.branch ?? null);
          try {
            new Notification(t.title, { body: t.body, tag: row.ref, lang: 'ar', dir: 'rtl' });
          } catch { /* some browsers only notify from a service worker */ }
        }
        if (a.sound) chime();
      })
      .subscribe();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [allowed]);
  return count;
}

// «طلبات الشركاء» (3 Nov 2026): the count of new partner enquiries on its sidebar item, live through Realtime on
// public.partner_enquiries — Realtime applies that table's RLS (partners view + the branch scope), so a user without the
// permission never subscribes and a row outside their scope never reaches them. No notification, no sound.
async function newEnquiries(): Promise<number | null> {
  let q = supabase.from('partner_enquiries').select('id', { count: 'exact', head: true }).eq('status', 'new');
  if (!testEvents()) q = q.eq('is_test', false);
  const { count, error } = await q;
  return error ? null : count ?? 0;
}

export function usePartnersBadge(me: Me | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  const allowed = canView(me, 'partners');
  useEffect(() => {
    if (!allowed) {
      setCount(null);
      return;
    }
    let alive = true;
    let timer = 0;
    const recount = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const n = await newEnquiries();
        if (alive && n !== null) setCount(n);
      }, 250);
    };
    recount();
    const ch = supabase
      .channel('nav-partners-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_enquiries' }, recount)
      .subscribe();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [allowed]);
  return count;
}

// «المحادثات» (Guest Hub H3, 13 Nov 2026): the conversations waiting for staff in the user's units, live through the
// signals (public.dashboard_signals — kind, unit and time only; Realtime applies their RLS: a hub signal reaches only the
// unit's team). A new waiting conversation can raise a browser notification and the chime, both opt-in per user (off
// by default); the text is the unit and «محادثة جديدة» / «بانتظار موظف» — never a guest word, a name or a number.
export function hubNotifyText(unit: string | null, fresh: boolean) {
  return { title: 'مركز الضيوف', body: `${unit ? `${unit} — ` : ''}${fresh ? 'محادثة جديدة' : 'بانتظار موظف'}` };
}
export function useHubBadge(me: Me | null, alerts: () => { hubNotify: boolean; hubSound: boolean }): number | null {
  const [count, setCount] = useState<number | null>(null);
  const allowed = canView(me, 'inbox');
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  useEffect(() => {
    if (!allowed) {
      setCount(null);
      return;
    }
    let alive = true;
    let timer = 0;
    let last: number | null = null;
    const units = new Map<string, string>();
    void supabase.from('hub_units').select('id,name_ar').then(({ data }) => {
      for (const u of (data ?? []) as { id: string; name_ar: string }[]) units.set(u.id, u.name_ar);
    });
    const recount = (sig?: { kind: string; unit_id: string | null }) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const { data, error } = await supabase.rpc('hub_inbox_badge', { p_test: testEvents() });
        if (!alive || error) return;
        const n = Number(data ?? 0);
        if (sig && last !== null && n > last) {
          const a = alertsRef.current();
          const t = hubNotifyText(sig.unit_id ? units.get(sig.unit_id) ?? null : null, sig.kind === 'hub_handoff');
          if (a.hubNotify && 'Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(t.title, { body: t.body, tag: `hub:${sig.unit_id ?? ''}`, lang: 'ar', dir: 'rtl' });
            } catch { /* some browsers only notify from a service worker */ }
          }
          if (a.hubSound) chime();
        }
        last = n;
        setCount(n);
      }, 300);
    };
    recount();
    const ch = supabase
      .channel('nav-hub-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dashboard_signals' }, (p) => {
        const row = p.new as { kind?: string; unit_id?: string | null } | null;
        if (!row?.kind?.startsWith('hub_')) return;
        recount({ kind: row.kind, unit_id: row.unit_id ?? null });
      })
      .subscribe();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [allowed]);
  return count;
}
