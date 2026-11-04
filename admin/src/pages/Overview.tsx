// «النظرة العامة» (Ahmed, 4 Nov 2026 — phase 2b session 6; DECISIONS.md 2026-11-04). The landing page for everyone who
// holds the section. Every figure comes from the bookings recorded in this system (nothing is called hotel occupancy):
// the four cards (each a link to its list, already filtered, with a per-branch line), «تنبيهات», one donut per branch,
// «نادي أرمادا ريزيدنس», the next 14 nights, the chosen period (% sold, ADR), «آخر الطلبات», this month's sources and
// the partner enquiries. Money appears only with «الأرقام المالية» (the RPCs withhold it; nothing takes its place).
// Live: a new booking, enquiry or club sign-up (public.dashboard_signals over Realtime) refreshes the figures and a
// changed number glows bronze for about 1.5 s. Motion only on the first load; reduced motion → none.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import * as api from '../lib/api';
import * as m from '../lib/metrics';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, STATUS_LABELS, dateRange, longDate, riyadhDateTime, riyadhToday, sar, shortDate, dayName } from '../lib/format';
import { STATUS_LABEL as PARTNER_STATUS, TYPE_LABEL } from '../lib/partners';
import { BranchSelect, ErrorBox, Field, useLeaveGuard } from '../components/ui';
import DateField from '../components/DateField';
import { AnimatedNumber, Bars, ChartCard, Donut, HBars, HowTip, Legend, Lines, seriesOf, useFirstLoad } from '../components/charts';

type Sect<T> = { data: T | null; error: string | null };
/** the short branch name («طريق المطار») — the database's name_ar is the full «أرمادا ريزيدنس – …» */
const bn = (b: { slug: string; name_ar: string }) => BRANCH_NAMES[b.slug] ?? b.name_ar;
const empty = <T,>(): Sect<T> => ({ data: null, error: null });
const bname = (slug: string) => (slug === 'both' ? 'الفرعان' : BRANCH_NAMES[slug] ?? slug);

export default function Overview() {
  const { me } = useSession();
  const today = riyadhToday();
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [branch, setBranch] = useState(me?.branch ?? '');
  const [periodKey, setPeriodKey] = useState<m.PeriodKey>('30');
  const [custom, setCustom] = useState<m.Period>(() => m.periodOf('30'));
  const period = useMemo(() => m.periodOf(periodKey, custom), [periodKey, custom]);
  const [cards, setCards] = useState<Sect<m.Cards>>(empty);
  const [alerts, setAlerts] = useState<Sect<m.Alerts>>(empty);
  const [tonight, setTonight] = useState<Sect<m.Tonight>>(empty);
  const [club, setClub] = useState<Sect<m.Club>>(empty);
  const [fwd, setFwd] = useState<Sect<m.Forward>>(empty);
  const [trend, setTrend] = useState<Sect<m.Trend>>(empty);
  const [recent, setRecent] = useState<Sect<m.RecentRow[]>>(empty);
  const [sources, setSources] = useState<Sect<m.Sources>>(empty);
  const [live, setLive] = useState(false);
  const canBookings = api.canView(me, 'bookings');
  const canInventory = api.canView(me, 'inventory');
  const canPartners = api.canView(me, 'partners');
  const money = api.canView(me, 'finance');
  // the entry animation plays once, when the first answers are in (a later filter change never replays it)
  const first = useFirstLoad(!!(cards.data || cards.error) && !!(tonight.data || tonight.error) && !!(fwd.data || fwd.error) && !!(trend.data || trend.error));

  useEffect(() => {
    api.branches().then(setBranches).catch(() => setBranches([]));
  }, []);
  // the branches this page shows: the filter's, or every branch in scope (from the server's answer)
  const shown: m.BranchRef[] = cards.data?.branches ?? [];

  const loadMain = useCallback(async (fromLive = false) => {
    setLive(fromLive);
    const run = <T,>(p: Promise<T>, set: (s: Sect<T>) => void) =>
      p.then((data) => set({ data, error: null })).catch((e: Error) => set({ data: null, error: e.message }));
    await Promise.all([
      run(m.overviewCards(branch), setCards),
      run(m.overviewAlerts(branch), setAlerts),
      run(m.overviewTonight(branch), setTonight),
      run(m.overviewClub(branch), setClub),
      run(m.overviewForward(branch), setFwd),
      canBookings ? run(m.overviewRecent(branch), setRecent) : Promise.resolve(),
      run(m.overviewSources(branch), setSources),
    ]);
  }, [branch, canBookings]);
  const loadTrend = useCallback(async (fromLive = false) => {
    setLive(fromLive);
    try {
      setTrend({ data: await m.overviewTrend(branch, period.from, period.to), error: null });
    } catch (e) {
      setTrend({ data: null, error: (e as Error).message });
    }
  }, [branch, period.from, period.to]);
  useEffect(() => void loadMain(), [loadMain]);
  useEffect(() => void loadTrend(), [loadTrend]);

  // live refresh: one signal row per new / changed booking, partner enquiry or club membership (RLS = this user's scope);
  // several in a burst refresh once
  const timer = useRef(0);
  const reload = useRef<() => void>(() => {});
  reload.current = () => {
    void loadMain(true);
    void loadTrend(true);
  };
  useEffect(() => {
    const ch = supabase
      .channel('overview-signals')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dashboard_signals' }, () => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => reload.current(), 700);
      })
      .subscribe();
    return () => {
      window.clearTimeout(timer.current);
      void supabase.removeChannel(ch);
    };
  }, []);

  const q = (base: string, extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (branch && !me?.branch) p.set('branch', branch);
    return `${base}?${p}`;
  };
  const invBranch = (slug?: string) => slug ?? (branch || me?.branch || shown[0]?.slug || 'airport-road');
  const perBranch = (vals: Record<string, number | string> | undefined, fmt: (v: number | string) => string = String) =>
    shown.length > 1 && vals ? shown.map((b) => `${bn(b)} ${fmt(vals[b.slug] ?? 0)}`).join(' · ') : null;

  const c = cards.data;
  return (
    <div className="grid gap-5 overview" data-page="overview" data-live={live ? '1' : undefined}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="text-2xl font-bold">النظرة العامة</h1>
          <p className="text-sm text-ink-muted mt-1" data-subtitle><span className="num-ar">{longDate(today)}</span> — من الحجوزات المسجّلة في اللوحة</p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden" data-overview-filters>
          <BranchSelect id="ov-branch" label="الفرع" branches={branches} value={branch} onChange={setBranch} allLabel="الفرعان" />
          <Field label="فترة الرسوم" id="ov-period">
            <select id="ov-period" className="field w-auto" value={periodKey} onChange={(e) => setPeriodKey(e.target.value as m.PeriodKey)} data-period>
              {m.PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {periodKey === 'custom' && (
            <div className="min-w-[280px]">
              <DateField mode="range" label="من" endLabel="إلى" start={custom.from} end={custom.to} min="past" max={today} id="ov-custom"
                onChange={(a, b) => a && b && setCustom({ from: a, to: b })} />
            </div>
          )}
        </div>
      </div>

      {/* B1 — the four cards */}
      <ErrorBox error={cards.error} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-cards>
        <StatCard i={0} id="arrivals" title="الوصول اليوم" how={m.HOW.arrivals} first={first} flash={live}
          value={c?.arrivals.total} line={perBranch(c?.arrivals.by_branch)} to={canBookings ? q('/bookings', { status: 'confirmed', arrive: today }) : undefined} />
        <StatCard i={1} id="departures" title="المغادرة اليوم" how={m.HOW.departures} first={first} flash={live}
          value={c?.departures.total} line={perBranch(c?.departures.by_branch)} to={canBookings ? q('/bookings', { status: 'confirmed', depart: today }) : undefined} />
        <StatCard i={2} id="tonight" title="المباع من مخزون الليلة" how={m.HOW.tonight} first={first} flash={live}
          value={c?.tonight.pct ?? null} fmt={(n) => m.pctText(n)} empty={c && c.tonight.pct === null ? 'لا مخزون مفتوح' : undefined}
          line={shown.length > 1 && c ? shown.map((b) => `${bn(b)} ${m.pctText(c.tonight.by_branch[b.slug]?.pct)}`).join(' · ') : null}
          to={canInventory ? `/inventory?${new URLSearchParams({ branch: invBranch(), from: today })}` : undefined} />
        <StatCard i={3} id="pending" title="بانتظار الرد" how={m.HOW.pending} first={first} flash={live}
          value={c?.pending.total} to={canBookings ? q('/bookings', { status: 'request' }) : undefined}
          line={c ? [perBranch(c.pending.by_branch), c.pending.partners_both ? `الفرعان ${c.pending.partners_both}` : null, `طلبات حجز ${c.pending.requests} · شركاء ${c.pending.partners}`].filter(Boolean).join(' · ') : null} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* B2 — alerts */}
        <AlertsCard s={alerts} canPartners={canPartners} first={first} />
        {/* B3 — tonight's donuts */}
        <section className="card p-4 lg:col-span-2 reveal" style={{ animationDelay: '60ms' }} aria-labelledby="ov-donuts" data-donuts>
          <div className="flex items-start gap-2 mb-3">
            <h2 id="ov-donuts" className="font-bold text-base">مخزون الموقع الليلة</h2>
            <HowTip text={m.HOW.donut} />
          </div>
          <ErrorBox error={tonight.error} />
          <div className="grid sm:grid-cols-2 gap-4">
            {tonight.data?.branches.map((b) => <DonutBlock key={b.slug} b={b} first={first} href={canInventory ? `/inventory?${new URLSearchParams({ branch: b.slug, from: today })}` : undefined} />)}
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* B4 — the club */}
        <ClubCard s={club} first={first} flash={live} />
        {/* B5 — the next 14 nights */}
        <ForwardChart s={fwd} first={first} canInventory={canInventory} className="lg:col-span-2" />
      </div>

      {/* B6 — the chosen period */}
      <TrendBlock s={trend} first={first} money={money} flash={live} period={period} />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* B7 — the latest bookings and requests */}
        {canBookings && <RecentCard s={recent} className="lg:col-span-2" />}
        {/* B8 — this month's sources + partner enquiries */}
        <div className={`grid gap-4 ${canBookings ? '' : 'lg:col-span-3 lg:grid-cols-2'}`}>
          <SourcesCard s={sources} first={first} />
          <PartnersCard s={sources} canPartners={canPartners} />
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── cards ─────────────────────────
function StatCard({ i, id, title, how, value, fmt, line, to, first, flash, empty }: { i: number; id: string; title: string; how: string; value: number | null | undefined; fmt?: (n: number) => string; line: string | null; to?: string; first: boolean; flash: boolean; empty?: string }) {
  const guard = useLeaveGuard();
  const body: ReactNode = (
    <>
      <span className="text-sm font-semibold text-ink-muted block pe-7">{title}</span>
      <span className="block text-3xl font-bold mt-1 min-h-[2.5rem]">
        {empty ? <span className="text-base font-semibold text-ink-muted">{empty}</span> : <AnimatedNumber value={value} first={first} flash={flash} format={fmt} />}
      </span>
      {line && <span className="block text-xs text-ink-muted mt-1 num-ar" data-branch-line>{line}</span>}
    </>
  );
  return (
    <div className="card stat-card reveal relative" style={{ animationDelay: `${i * 60}ms` }} data-card={id}>
      {to ? <Link to={to} className="stat-link" onClick={(e) => guard.link(e, to)} data-card-link={id}>{body}</Link> : <div className="p-4">{body}</div>}
      <span className="absolute top-3 end-3"><HowTip text={how} /></span>
    </div>
  );
}

function alertText(a: m.AlertItem): { text: string; to: string; action: string } {
  switch (a.kind) {
    case 'inventory': {
      const parts = [a.soldout ? `نفد في ${a.soldout} ${a.soldout === 1 ? 'ليلة' : a.soldout === 2 ? 'ليلتين' : 'ليالٍ'}` : null, a.closed ? `مغلق في ${a.closed} ${a.closed === 1 ? 'ليلة' : a.closed === 2 ? 'ليلتين' : 'ليالٍ'}` : null].filter(Boolean).join('، و');
      return { text: `${a.room_name} — ${bname(a.branch)}: ${parts} خلال الأيام السبعة القادمة (من ${shortDate(a.first)})`, to: `/inventory?${new URLSearchParams({ branch: a.branch, from: a.first })}`, action: 'فتح المخزون' };
    }
    case 'coordination':
      return { text: `الحجز ${a.ref} — ${bname(a.branch)}: يحتاج تنسيقًا (الوصول ${shortDate(a.check_in)})`, to: `/bookings?ref=${a.ref}`, action: 'فتح الحجز' };
    case 'reply':
      return { text: `طلب الحجز ${a.ref} — ${bname(a.branch)}: بلا رد منذ ${a.hours} ساعة`, to: `/bookings?ref=${a.ref}`, action: 'الرد على الطلب' };
    case 'partner':
      return { text: `طلب الشراكة ${a.ref} (${TYPE_LABEL[a.request_type as keyof typeof TYPE_LABEL] ?? a.request_type}): «جديد» منذ ${a.hours} ساعة`, to: `/partners?ref=${a.ref}`, action: 'فتح الطلب' };
    case 'rate':
      return { text: `${a.room_name} — ${bname(a.branch)}: ${a.flag === 'below_base' ? 'سعر أقل من الأساسي' : 'سعر أعلى بكثير من الأساسي'} (${dateRange(a.date_from, a.date_to)})`, to: `/rates?${new URLSearchParams({ branch: a.branch, from: a.date_from })}`, action: 'فتح الأسعار' };
  }
}

function AlertsCard({ s, first }: { s: Sect<m.Alerts>; canPartners: boolean; first: boolean }) {
  const guard = useLeaveGuard();
  const n = s.data?.count ?? 0;
  return (
    <section className="card p-4 reveal" style={{ animationDelay: '0ms' }} aria-labelledby="ov-alerts" data-alerts={n}>
      <div className="flex items-start gap-2 mb-3">
        <h2 id="ov-alerts" className="font-bold text-base">تنبيهات</h2>
        {s.data && <span className={`chip ${n ? 'chip-flag' : 'chip-request'}`} data-alert-count><AnimatedNumber value={n} first={first} /></span>}
        <HowTip text={`${m.HOW.alerts}${s.data ? ` المدة الحالية: ${s.data.hours} ساعة.` : ''}`} />
      </div>
      <ErrorBox error={s.error} />
      {s.data && (n === 0
        ? <p className="text-sm text-ink-muted" data-no-alerts>لا توجد تنبيهات الآن</p>
        : (
          <ul className="grid gap-2 max-h-80 overflow-y-auto pe-1" data-alert-list>
            {s.data.items.map((a, i) => {
              const t = alertText(a);
              return (
                <li key={i} className="alert-item" data-alert={a.kind}>
                  <span className="text-sm num-ar">{t.text}</span>
                  <Link to={t.to} className="link text-sm font-semibold whitespace-nowrap" onClick={(e) => guard.link(e, t.to)} data-alert-link={a.kind}>{t.action}</Link>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}

function DonutBlock({ b, first, href }: { b: m.TonightBranch; first: boolean; href?: string }) {
  const total = b.sold + b.left + b.closed;
  const pctOf = (v: number) => (total ? `${Math.round((v / total) * 1000) / 10}٪` : '—');
  const segs = [
    { key: 'sold', label: 'محجوز', value: b.sold, cls: 'seg-sold' },
    { key: 'left', label: 'متاح للبيع', value: b.left, cls: 'seg-left' },
    { key: 'closed', label: 'مغلق', value: b.closed, cls: 'seg-closed' },
  ];
  const summary = `${bn(b)} الليلة: المباع ${m.pctText(b.pct)} — محجوز ${b.sold}، متاح للبيع ${b.left}، مغلق ${b.closed}${b.closed_types ? ` (${b.closed_types} من ${b.types} أنواع غرف مغلقة)` : ''}.`;
  return (
    <div className="flex items-center gap-4 flex-wrap" data-donut={b.slug}>
      <figure className="m-0" role="group" aria-label={summary}>
        <Donut segs={segs} center={m.pctText(b.pct)} sub="المباع" first={first} href={href} label={bn(b)} size={150} />
      </figure>
      <div className="min-w-0">
        <p className="font-semibold mb-2">{bn(b)}</p>
        <ul className="grid gap-1.5 text-sm" data-donut-legend>
          {segs.map((sg) => (
            <li key={sg.key} className="flex items-center gap-2">
              <span className={`viz-swatch ${sg.cls}`} aria-hidden="true" />
              <span>{sg.label}</span>
              <span className="num-ar text-ink-muted">{sg.value} · {pctOf(sg.value)}</span>
            </li>
          ))}
        </ul>
        {b.closed_types > 0 && <p className="text-xs text-ink-muted mt-2 num-ar">{b.closed_types} من {b.types} أنواع غرف مغلقة الليلة</p>}
        {href && <Link to={href} className="link text-sm mt-2 inline-block">فتح المخزون الليلة</Link>}
      </div>
    </div>
  );
}

function ClubCard({ s, first, flash }: { s: Sect<m.Club>; first: boolean; flash: boolean }) {
  const d = s.data;
  const rows = d ? m.CLUB_SOURCE_LABELS.map((x) => ({ key: x.key, label: x.label, value: d.sources[x.key]?.all ?? 0 })).filter((r) => r.value > 0 || r.key !== 'other') : [];
  return (
    <ChartCard title="نادي أرمادا ريزيدنس" how={m.HOW.club} id="club" className="reveal"
      summary={d ? `أعضاء النادي: ${d.all}، اليوم ${d.today_count}، هذا الأسبوع ${d.week}.` : 'نادي أرمادا ريزيدنس'}
      table={{ head: ['المصدر', 'الكل', 'اليوم', 'هذا الأسبوع'], rows: d ? m.CLUB_SOURCE_LABELS.map((x) => [x.label, d.sources[x.key]?.all ?? 0, d.sources[x.key]?.today ?? 0, d.sources[x.key]?.week ?? 0]) : [] }}>
      <ErrorBox error={s.error} />
      {d && (
        <>
          <dl className="grid grid-cols-3 gap-2 mb-4 text-center" data-club-totals>
            <div><dt className="text-xs text-ink-muted">كل الأعضاء</dt><dd className="text-2xl font-bold"><AnimatedNumber value={d.all} first={first} flash={flash} /></dd></div>
            <div><dt className="text-xs text-ink-muted">اليوم</dt><dd className="text-2xl font-bold"><AnimatedNumber value={d.today_count} first={first} flash={flash} /></dd></div>
            <div><dt className="text-xs text-ink-muted">هذا الأسبوع</dt><dd className="text-2xl font-bold"><AnimatedNumber value={d.week} first={first} flash={flash} /></dd></div>
          </dl>
          <p className="text-xs font-semibold text-ink-muted mb-2">الحصة حسب المصدر</p>
          <HBars first={first} rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.value, text: `${r.value} · ${d.all ? Math.round((r.value / d.all) * 1000) / 10 : 0}٪` }))} />
        </>
      )}
    </ChartCard>
  );
}

function ForwardChart({ s, first, canInventory, className }: { s: Sect<m.Forward>; first: boolean; canInventory: boolean; className?: string }) {
  const d = s.data;
  const br = d?.branches ?? [];
  const slots = (d?.nights ?? []).map((n) => ({
    key: n.night,
    label: `${dayName(n.night, true)} ${Number(n.night.slice(8))}`,
    shade: n.weekend,
    bars: br.map((b) => {
      const v = n.by_branch[b.slug];
      const closed = !v || v.pct === null;
      return {
        series: Number(seriesOf(br, b.slug).slice(1)),
        value: closed ? null : v.pct,
        tip: `${longDate(n.night)}\n${bn(b)}: ${closed ? 'مغلق' : `المباع ${m.pctText(v.pct)} — محجوز ${v.sold}، متبقٍّ ${v.left}`}`,
        href: canInventory ? `/inventory?${new URLSearchParams({ branch: b.slug, from: n.night })}` : undefined,
      };
    }),
  }));
  const avg = (slug: string) => {
    const xs = (d?.nights ?? []).map((n) => n.by_branch[slug]).filter((v) => v && v.pct !== null);
    const sold = xs.reduce((a, v) => a + (v!.sold ?? 0), 0);
    const left = xs.reduce((a, v) => a + (v!.left ?? 0), 0);
    return sold + left ? (100 * sold) / (sold + left) : null;
  };
  return (
    <ChartCard title="المحجوز للأيام القادمة" how={m.HOW.forward} id="forward" className={`reveal ${className ?? ''}`}
      summary={d ? `نسبة المباع لكل ليلة من الليالي الأربع عشرة القادمة؛ ${br.map((b) => `${bn(b)} في المتوسط ${m.pctText(avg(b.slug))}`).join('، ')}.` : 'المحجوز للأيام القادمة'}
      table={{ head: ['الليلة', ...br.flatMap((b) => [`${bn(b)} — المباع`, `${bn(b)} — محجوز`, `${bn(b)} — متبقٍّ`])], rows: (d?.nights ?? []).map((n) => [longDate(n.night), ...br.flatMap((b) => { const v = n.by_branch[b.slug]; return v && v.pct !== null ? [m.pctText(v.pct), v.sold ?? 0, v.left ?? 0] : ['مغلق', '—', '—']; })]) }}>
      <ErrorBox error={s.error} />
      {d && (
        <>
          {br.length > 1 && <Legend items={br.map((b) => ({ key: b.slug, label: bn(b), cls: seriesOf(br, b.slug) }))} />}
          <Bars slots={slots} first={first} label="المحجوز للأيام القادمة" xLabelEvery={slots.length > 10 && br.length > 1 ? 2 : 1} />
          <p className="text-xs text-ink-muted mt-1"><span className="viz-swatch viz-shade-swatch align-middle" aria-hidden="true" /> ليالي الخميس والجمعة</p>
        </>
      )}
    </ChartCard>
  );
}

function TrendBlock({ s, first, money, flash, period }: { s: Sect<m.Trend>; first: boolean; money: boolean; flash: boolean; period: m.Period }) {
  const d = s.data;
  const days = d?.days ?? [];
  const every = days.length > 60 ? 14 : days.length > 31 ? 7 : days.length > 14 ? 3 : 1;
  const kpi = (title: string, how: string, node: ReactNode, key: string) => (
    <div className="card p-3" data-kpi={key}>
      <div className="flex items-center gap-1"><span className="text-xs font-semibold text-ink-muted">{title}</span><HowTip text={how} /></div>
      <div className="text-xl font-bold mt-1">{node}</div>
    </div>
  );
  return (
    <section className="grid gap-3 reveal" aria-labelledby="ov-trend" data-trend>
      <h2 id="ov-trend" className="font-bold text-lg">المباع ومتوسط سعر الليلة <span className="text-sm font-normal text-ink-muted num-ar">({dateRange(period.from, period.to)})</span></h2>
      <ErrorBox error={s.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-kpis>
            {money && d.totals.revenue !== undefined && kpi('الإيراد', m.HOW.revenue, <AnimatedNumber value={d.totals.revenue} first={first} flash={flash} format={(n) => sar(Math.round(n))} />, 'revenue')}
            {kpi('متوسط المباع', m.HOW.avgPct, <AnimatedNumber value={d.totals.pct} first={first} flash={flash} format={(n) => m.pctText(n)} />, 'pct')}
            {money && d.totals.adr !== undefined && kpi('متوسط سعر الليلة', m.HOW.adr, d.totals.adr === null ? <span className="text-ink-muted">—</span> : <AnimatedNumber value={d.totals.adr} first={first} flash={flash} format={(n) => sar(Math.round(n))} />, 'adr')}
            {kpi('الليالي المباعة', m.HOW.nights, <AnimatedNumber value={d.totals.nights} first={first} flash={flash} />, 'nights')}
          </div>
          <div className={`grid gap-4 ${money ? 'lg:grid-cols-2' : ''}`}>
            <ChartCard title="المباع من مخزون الموقع لكل ليلة" how={m.HOW.trend} id="trend-pct"
              summary={`نسبة المباع لكل ليلة من ${longDate(period.from)} إلى ${longDate(period.to)}؛ المتوسط ${m.pctText(d.totals.pct)}.`}
              table={{ head: ['الليلة', 'المباع', 'محجوز', 'متاح'], rows: days.map((x) => [longDate(x.night), x.pct === null ? 'مغلق' : m.pctText(x.pct), x.sold, x.left]) }}>
              <Bars first={first} label="المباع لكل ليلة" xLabelEvery={every}
                slots={days.map((x) => ({ key: x.night, label: shortDate(x.night), bars: [{ series: 1, value: x.pct, tip: `${longDate(x.night)}\n${x.pct === null ? 'مغلق' : `المباع ${m.pctText(x.pct)} — محجوز ${x.sold}، متاح ${x.left}`}` }] }))} />
            </ChartCard>
            {/* ADR on its own scale in its own chart (never a second axis on the % chart) */}
            {money && d.totals.adr !== undefined && (
              <ChartCard title="متوسط سعر الليلة" how={m.HOW.adr} id="trend-adr"
                summary={`متوسط سعر الليلة لكل يوم في الفترة؛ متوسط الفترة ${d.totals.adr === null ? 'لا ليالٍ مباعة' : sar(d.totals.adr)}.`}
                table={{ head: ['الليلة', 'متوسط سعر الليلة', 'الليالي', 'الإيراد'], rows: days.map((x) => [longDate(x.night), x.adr == null ? '—' : sar(x.adr), x.nights, sar(x.revenue ?? 0)]) }}>
                <Lines first={first} label="متوسط سعر الليلة" xLabelEvery={every} format={(n) => String(Math.round(n))}
                  series={[{ key: 'adr', label: 'متوسط سعر الليلة', cls: 's2', points: days.map((x) => ({ label: shortDate(x.night), value: x.adr ?? null, tip: `${longDate(x.night)}\n${x.adr == null ? 'لا ليالٍ مباعة' : `متوسط سعر الليلة ${sar(x.adr)} — ${x.nights} ليلة`}` })) }]} />
              </ChartCard>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function RecentCard({ s, className }: { s: Sect<m.RecentRow[]>; className?: string }) {
  const guard = useLeaveGuard();
  return (
    <section className={`card p-4 reveal ${className ?? ''}`} aria-labelledby="ov-recent" data-recent>
      <div className="flex items-start gap-2 mb-3">
        <h2 id="ov-recent" className="font-bold text-base">آخر الطلبات</h2>
        <HowTip text={m.HOW.recent} />
        <Link to="/bookings" className="link text-sm ms-auto" onClick={(e) => guard.link(e, '/bookings')} data-all-bookings>كل الحجوزات</Link>
      </div>
      <ErrorBox error={s.error} />
      {s.data && (s.data.length === 0 ? <p className="text-sm text-ink-muted">لا حجوزات بعد.</p> : (
        <div className="overflow-x-auto relative">
          <table className="viz-table w-full text-sm" data-recent-table>
            <thead><tr><th scope="col">رقم الحجز</th><th scope="col">الضيف</th><th scope="col">الفرع</th><th scope="col">الإقامة</th><th scope="col">المصدر</th><th scope="col">الحالة</th></tr></thead>
            <tbody>
              {s.data.map((r) => (
                <tr key={r.ref} data-recent-row={r.ref}>
                  <th scope="row"><Link to={`/bookings?ref=${r.ref}`} className="link num" onClick={(e) => guard.link(e, `/bookings?ref=${r.ref}`)}>{r.ref}</Link></th>
                  <td>{r.guest_name}</td>
                  <td>{bname(r.branch)}</td>
                  <td className="num-ar whitespace-nowrap">{dateRange(r.check_in, r.check_out)}</td>
                  <td>{m.sourceLabel(r.source)}</td>
                  <td><span className={`chip chip-${r.status}`}>{STATUS_LABELS[r.status]}</span><span className="sr-only">، سُجّل {riyadhDateTime(r.created_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function SourcesCard({ s, first }: { s: Sect<m.Sources>; first: boolean }) {
  const d = s.data;
  return (
    <ChartCard title="مصادر حجوزات الشهر" how={m.HOW.sources} id="sources" className="reveal"
      summary={d ? (d.total ? `حجوزات هذا الشهر المؤكدة: ${d.total}؛ ${d.sources.map((x) => `${m.sourceLabel(x.key)} ${m.pctText(x.share)}`).join('، ')}.` : 'لا حجوزات مؤكدة هذا الشهر بعد.') : 'مصادر حجوزات الشهر'}
      table={{ head: ['المصدر', 'الحجوزات', 'الحصة'], rows: (d?.sources ?? []).map((x) => [m.sourceLabel(x.key), x.bookings, m.pctText(x.share)]) }}>
      <ErrorBox error={s.error} />
      {d && (d.total === 0 ? <p className="text-sm text-ink-muted">لا حجوزات مؤكدة هذا الشهر بعد.</p> : (
        <HBars first={first} cls="s2" max={100} rows={d.sources.map((x) => ({ key: x.key, label: m.sourceLabel(x.key), value: x.share, text: `${x.bookings} · ${m.pctText(x.share)}` }))} />
      ))}
    </ChartCard>
  );
}

function PartnersCard({ s, canPartners }: { s: Sect<m.Sources>; canPartners: boolean }) {
  const guard = useLeaveGuard();
  const p = s.data?.partners;
  return (
    <section className="card p-4 reveal" aria-labelledby="ov-partners" data-partners-card>
      <div className="flex items-start gap-2 mb-3">
        <h2 id="ov-partners" className="font-bold text-base">طلبات الشركاء</h2>
        <HowTip text={m.HOW.partners} />
        {canPartners && <Link to="/partners" className="link text-sm ms-auto" onClick={(e) => guard.link(e, '/partners')}>كل الطلبات</Link>}
      </div>
      {p && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-partner-counts>
          {(['new', 'contacted', 'quoted', 'confirmed', 'lost'] as const).map((k) => {
            const inner = <><span className="block text-xs text-ink-muted">{PARTNER_STATUS[k]}</span><span className="block text-xl font-bold num">{p[k] ?? 0}</span></>;
            return (
              <li key={k} className="rounded border border-line p-2" data-partner-status={k}>
                {canPartners ? <Link to={`/partners?status=${k}`} className="block" onClick={(e) => guard.link(e, `/partners?status=${k}`)}>{inner}</Link> : inner}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

