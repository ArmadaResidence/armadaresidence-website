// «الآن» — the live screen of «مركز الضيوف» (Guest Hub H8, 16 Nov 2026; spec §5.8; DECISIONS.md 2026-11-16 «Guest Hub H8»).
// Counts and times only (Ahmed, 12 Nov 2026): open conversations by state and unit, waiting for staff and the longest
// wait, the assistant's replies and the hand-offs today, today's bookings by source (the site / «مساعد واتساب» / staff),
// cart orders waiting; the assistant's revenue today and this month only with «الأرقام المالية» (withheld by
// public.hub_now itself). The feed: the unit, the kind and the time of each event — never a name, a message's text or a
// phone. Live through public.dashboard_signals (Realtime, the RLS of the signals), with a refresh every minute for the
// waiting times. «وضع الشاشة»: full screen, larger type, no navigation, the clock in Asia/Riyadh. now: view + branch scope.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import { supabase } from '../lib/supabase';
import { hubNow } from '../lib/metrics';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, sar } from '../lib/format';
import { BranchSelect, ErrorBox, Loading } from '../components/ui';
import { Icon } from '../components/icons';

export interface NowUnit {
  key: string; name_ar: string; branch: string; assistant: number; collecting: number; waiting: number; with_staff: number;
  longest_wait_min: number | null; orders_waiting: number;
}
export interface NowData {
  at: string; today: string; units: NowUnit[]; replies_today: number; handoffs_today: number;
  bookings_today: { site: number; assistant: number; staff: number; assistant_instant: number; assistant_request: number };
  revenue?: { today: number; month: number };
  feed: { kind: string; unit: string | null; branch: string | null; at: string }[];
}
export const FEED_LABELS: Record<string, string> = {
  hub_message: 'رسالة من ضيف', hub_handoff: 'تحويل إلى الفريق', hub_booking: 'حجز من المحادثة', hub_order: 'طلب طعام', booking: 'حجز جديد أو تغيير حجز',
};
/** «14:05» in Asia/Riyadh, Western digits */
export const riyadhClock = (ts: string | number | Date, seconds = false) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false }).format(new Date(ts));
/** a wait in minutes, counted in words (never a raw «5 د») */
export function waitText(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  if (min < 1) return 'أقل من دقيقة';
  if (min < 60) return min === 1 ? 'دقيقة واحدة' : min === 2 ? 'دقيقتان' : min <= 10 ? `${min} دقائق` : `${min} دقيقة`;
  const h = Math.floor(min / 60);
  return h === 1 ? 'ساعة واحدة' : h === 2 ? 'ساعتان' : h <= 10 ? `${h} ساعات` : `${h} ساعة`;
}

export default function Now() {
  const { me } = useSession();
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [branch, setBranch] = useState(me?.branch ?? '');
  const [data, setData] = useState<NowData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const timer = useRef(0);

  useEffect(() => {
    api.branches().then(setBranches).catch(() => setBranches([]));
  }, []);
  const load = useCallback(async () => {
    try {
      setData((await hubNow(branch)) as NowData);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [branch]);
  const reload = useRef(load);
  reload.current = load;
  useEffect(() => void load(), [load]);
  // live: a signal (a message, a hand-off, a booking) refreshes without a reload; several in a burst refresh once
  useEffect(() => {
    const ch = supabase
      .channel('now-signals')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dashboard_signals' }, () => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void reload.current(), 600);
      })
      .subscribe();
    // the waiting times grow by themselves: a refresh every minute; the clock every second
    const minute = window.setInterval(() => void reload.current(), 60_000);
    const sec = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      window.clearTimeout(timer.current);
      window.clearInterval(minute);
      window.clearInterval(sec);
      void supabase.removeChannel(ch);
    };
  }, []);
  // «وضع الشاشة»: the browser's full screen too when it allows it; Esc (leaving full screen) ends the mode
  useEffect(() => {
    const off = () => {
      if (!document.fullscreenElement) setScreen(false);
    };
    document.addEventListener('fullscreenchange', off);
    return () => document.removeEventListener('fullscreenchange', off);
  }, []);
  const enter = () => {
    setScreen(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const leave = () => {
    setScreen(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  };
  useEffect(() => {
    if (!screen) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') leave();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [screen]);

  const scope = branch ? BRANCH_NAMES[branch] ?? branch : 'الفرعان';
  const body = !data ? (error ? <ErrorBox error={error} /> : <Loading />) : <NowBody data={data} screen={screen} clock={clock} />;

  if (screen) {
    return (
      <div className="now-screen fixed inset-0 z-[60] bg-page overflow-auto p-6 md:p-10" data-now-screen role="region" aria-label="الآن — وضع الشاشة">
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <h1 className="text-3xl md:text-5xl font-bold me-auto">الآن · {scope}</h1>
          <span className="text-3xl md:text-5xl font-bold num-ar" data-now-clock aria-label="الوقت بتوقيت الرياض">{riyadhClock(clock, true)}</span>
          <button type="button" className="btn btn-ghost" onClick={leave} data-action="now-screen-off"><Icon name="close" size={20} /> إنهاء وضع الشاشة</button>
        </div>
        <ErrorBox error={data ? error : null} />
        {body}
      </div>
    );
  }
  return (
    <div className="grid gap-5" data-page="now">
      <div className="flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="text-2xl font-bold">الآن</h1>
          <p className="text-sm text-ink-muted mt-1 num-ar">{scope} · <span data-now-clock>{riyadhClock(clock)}</span> بتوقيت الرياض · أعداد وأوقات فقط، بلا أسماء ولا نصوص ولا أرقام هواتف</p>
        </div>
        <BranchSelect id="now-branch" label="الفرع" branches={branches} value={branch} onChange={setBranch} allLabel="الفرعان" />
        <button type="button" className="btn btn-ghost" onClick={enter} data-action="now-screen" data-tour="now-screen"><Icon name="overview" size={18} /> وضع الشاشة</button>
      </div>
      <ErrorBox error={data ? error : null} />
      {body}
    </div>
  );
}

function Stat({ label, value, k, big }: { label: string; value: string | number; k: string; big: boolean }) {
  return (
    <div className="card p-3" data-now-stat={k}>
      <div className={`${big ? 'text-base' : 'text-xs'} font-semibold text-ink-muted`}>{label}</div>
      <div className={`${big ? 'text-4xl md:text-6xl' : 'text-2xl'} font-bold mt-1 num-ar`}>{value}</div>
    </div>
  );
}

function NowBody({ data, screen, clock }: { data: NowData; screen: boolean; clock: number }) {
  const big = screen;
  const waiting = data.units.reduce((a, u) => a + u.waiting, 0);
  const longest = data.units.reduce<number | null>((a, u) => (u.longest_wait_min === null ? a : a === null ? u.longest_wait_min : Math.max(a, u.longest_wait_min)), null);
  const b = data.bookings_today;
  return (
    <div className="grid gap-5">
      <section aria-label="اليوم" className={`grid grid-cols-2 ${data.revenue ? 'md:grid-cols-6' : 'md:grid-cols-4'} gap-3`} data-tour="now-today" data-now-today>
        <Stat k="waiting" big={big} label="بانتظار موظف" value={waiting} />
        <Stat k="longest" big={big} label="أطول انتظار" value={waitText(longest)} />
        <Stat k="replies" big={big} label="ردود المساعد اليوم" value={data.replies_today} />
        <Stat k="handoffs" big={big} label="تحويلات اليوم" value={data.handoffs_today} />
        {data.revenue && <Stat k="revenue-today" big={big} label="إيراد المساعد اليوم" value={sar(Math.round(data.revenue.today))} />}
        {data.revenue && <Stat k="revenue-month" big={big} label="إيراد المساعد هذا الشهر" value={sar(Math.round(data.revenue.month))} />}
      </section>
      <section aria-labelledby="now-bookings-h" className="card p-4" data-now-bookings>
        <h2 id="now-bookings-h" className={`${big ? 'text-2xl' : 'text-lg'} font-bold mb-3`}>حجوزات اليوم حسب المصدر</h2>
        <div className="grid grid-cols-3 gap-3">
          <Stat k="site" big={big} label="الموقع" value={b.site} />
          <Stat k="assistant" big={big} label="مساعد واتساب" value={b.assistant} />
          <Stat k="staff" big={big} label="الفريق" value={b.staff} />
        </div>
        <p className="text-sm text-ink-muted mt-2 num-ar" data-now-assistant-split>مساعد واتساب: تأكيد فوري {b.assistant_instant} · طلب حجز {b.assistant_request}</p>
      </section>
      <section aria-labelledby="now-units-h" data-tour="now-units" data-now-units>
        <h2 id="now-units-h" className={`${big ? 'text-2xl' : 'text-lg'} font-bold mb-3`}>المحادثات المفتوحة حسب الوحدة</h2>
        <div className="grid md:grid-cols-2 gap-3">
          {data.units.map((u) => (
            <div key={u.key} className="card p-4" data-now-unit={u.key}>
              <h3 className={`${big ? 'text-2xl' : 'text-base'} font-bold mb-3`}>{u.name_ar}</h3>
              <dl className={`grid grid-cols-2 gap-2 ${big ? 'text-xl' : 'text-sm'} num-ar`}>
                <dt className="text-ink-muted">مع المساعد</dt><dd className="font-bold" data-v="assistant">{u.assistant}</dd>
                <dt className="text-ink-muted">منها في الحجز</dt><dd className="font-bold" data-v="collecting">{u.collecting}</dd>
                <dt className="text-ink-muted">بانتظار موظف</dt><dd className={`font-bold ${u.waiting ? 'text-error' : ''}`} data-v="waiting">{u.waiting}</dd>
                <dt className="text-ink-muted">مع موظف</dt><dd className="font-bold" data-v="with_staff">{u.with_staff}</dd>
                <dt className="text-ink-muted">أطول انتظار</dt><dd className="font-bold" data-v="longest">{waitText(u.longest_wait_min)}</dd>
                {u.orders_waiting > 0 && <><dt className="text-ink-muted">طلبات طعام تنتظر</dt><dd className="font-bold" data-v="orders">{u.orders_waiting}</dd></>}
              </dl>
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby="now-feed-h" className="card p-4" data-tour="now-feed" data-now-feed>
        <h2 id="now-feed-h" className={`${big ? 'text-2xl' : 'text-lg'} font-bold mb-3`}>ما يحدث الآن</h2>
        {data.feed.length === 0 ? <p className="text-sm text-ink-muted">لا أحداث في آخر 24 ساعة.</p> : (
          <ol className={`grid gap-1 ${big ? 'text-xl' : 'text-sm'}`} aria-live="polite">
            {data.feed.slice(0, screen ? 15 : 40).map((f, i) => (
              <li key={`${f.at}-${i}`} className="flex gap-3 border-b border-line py-1 num-ar" data-feed-kind={f.kind}>
                <span className="font-semibold w-14 shrink-0">{riyadhClock(f.at)}</span>
                <span className="me-auto">{FEED_LABELS[f.kind] ?? f.kind}</span>
                <span className="text-ink-muted">{f.unit ?? (f.branch ? BRANCH_NAMES[f.branch] ?? f.branch : '')}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="text-xs text-ink-muted num-ar" data-now-updated>آخر تحديث: {riyadhClock(data.at, true)} · {Math.max(0, Math.round((clock - Date.parse(data.at)) / 1000)) < 90 ? 'مباشر' : 'جارٍ التحديث'}</p>
    </div>
  );
}
