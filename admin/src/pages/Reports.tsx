// «التقارير» (Ahmed, 4 Nov 2026 — phase 2b session 6; DECISIONS.md 2026-11-04). Controls: the period and a comparison
// (previous period, the same period last year, or custom), the branch, «Excel» (one .xlsx, a sheet per section) and «PDF»
// (the browser's print to A4 landscape, every section in order — styles.css @media print). Five sections, linked at the
// top: الأداء، سلوك الحجز، المصادر والحملات، الإلغاء والرد، النادي والشركاء. Every figure comes from the bookings
// recorded in this system; money only with «الأرقام المالية» (withheld by the RPCs). No no-show card: bookings do not
// record a no-show.
// Print (Ahmed, 5 Nov 2026): our own running header (the logo, «تقرير الأداء», the period, the comparison, the branch)
// and footer («طُبع في …» · «للاستخدام الداخلي») repeat on every page — a real <table> frame (Chrome repeats a table's
// <thead> / <tfoot> on every page, even when its one cell runs over many; CSS display: table does not), transparent on
// screen (display: contents); @page has no margin, so the browser prints none of its own (no URL). styles.css.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import * as api from '../lib/api';
import * as m from '../lib/metrics';
import { workbook, type Sheet } from '../lib/xlsx';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, DAY, NIGHT, dateRange, longDate, measureWord, nightsWord, riyadhDateTimeLong, riyadhToday, sar, shortDate } from '../lib/format';
import { BranchSelect, ErrorBox, Field } from '../components/ui';
import DateField from '../components/DateField';
import { AnimatedNumber, Bars, ChartCard, DataTable, HBars, HowTip, Legend, Lines, useFirstLoad } from '../components/charts';
import { Icon } from '../components/icons';

type Sect<T> = { data: T | null; error: string | null };
/** the short branch name («طريق المطار») — the database's name_ar is the full «أرمادا ريزيدنس – …» */
const bn = (b: { slug: string; name_ar: string }) => BRANCH_NAMES[b.slug] ?? b.name_ar;
const empty = <T,>(): Sect<T> => ({ data: null, error: null });
const DOW = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const SECTIONS = [
  { id: 'performance', label: 'الأداء' },
  { id: 'behaviour', label: 'سلوك الحجز' },
  { id: 'sources', label: 'المصادر والحملات' },
  { id: 'cancellations', label: 'الإلغاء والرد' },
  { id: 'club', label: 'النادي والشركاء' },
];
const bname = (slug: string) => BRANCH_NAMES[slug] ?? slug;
const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : Number(n));

export default function Reports() {
  const { me } = useSession();
  const money = api.canView(me, 'finance');
  const today = riyadhToday();
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [branch, setBranch] = useState(me?.branch ?? '');
  const [periodKey, setPeriodKey] = useState<m.PeriodKey>('30');
  const [custom, setCustom] = useState<m.Period>(() => m.periodOf('30'));
  const [cmpKey, setCmpKey] = useState<m.CompareKey>('previous');
  const [cmpCustom, setCmpCustom] = useState<m.Period>(() => m.compareOf('previous', m.periodOf('30'))!);
  const period = useMemo(() => m.periodOf(periodKey, custom), [periodKey, custom]);
  const cmp = useMemo(() => m.compareOf(cmpKey, period, cmpCustom), [cmpKey, period, cmpCustom]);
  const [perf, setPerf] = useState<Sect<m.Performance>>(empty);
  const [beh, setBeh] = useState<Sect<m.Behaviour>>(empty);
  const [src, setSrc] = useState<Sect<m.SourcesReport>>(empty);
  const [can, setCan] = useState<Sect<m.Cancellations>>(empty);
  const [cp, setCp] = useState<Sect<m.ClubPartners>>(empty);
  const first = useFirstLoad(!!perf.data);
  // the time on the printout: the moment of printing (set synchronously before the print layout)
  const [printedAt, setPrintedAt] = useState(() => new Date().toISOString());
  useEffect(() => {
    const before = () => flushSync(() => setPrintedAt(new Date().toISOString()));
    addEventListener('beforeprint', before);
    return () => removeEventListener('beforeprint', before);
  }, []);

  useEffect(() => {
    api.branches().then(setBranches).catch(() => setBranches([]));
  }, []);
  const load = useCallback(async () => {
    const run = <T,>(p: Promise<T>, set: (s: Sect<T>) => void) => p.then((data) => set({ data, error: null })).catch((e: Error) => set({ data: null, error: e.message }));
    await Promise.all([
      run(m.reportPerformance(branch, period, cmp), setPerf),
      run(m.reportBehaviour(branch, period), setBeh),
      run(m.reportSources(branch, period), setSrc),
      run(m.reportCancellations(branch, period), setCan),
      run(m.reportClubPartners(branch, period), setCp),
    ]);
  }, [branch, period, cmp]);
  useEffect(() => void load(), [load]);

  const scope = branch ? bname(branch) : (perf.data?.branches.map((b) => bn(b)).join(' و') || 'الفرعان');
  const periodText = dateRange(period.from, period.to);
  const cmpText = cmp ? dateRange(cmp.from, cmp.to) : null;

  function exportXlsx() {
    const sheets = buildSheets({ perf: perf.data, beh: beh.data, src: src.data, can: can.data, cp: cp.data, money, scope, periodText, cmpText });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(workbook(sheets));
    a.download = `armada-reports-${period.from}-${period.to}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="grid gap-5 reports" data-page="reports">
      {/* print only: the running header and footer of every page (screen: not shown; the frame lets the page flow) */}
      <table className="report-print-frame" role="presentation">
      <thead className="report-print-head" aria-hidden="true" data-print-head><tr><td>
        <div className="report-print-head-in">
          <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="" className="report-print-logo" />
          <div>
            <p className="report-print-title">تقرير الأداء</p>
            <p className="num-ar">الفترة: {periodText}{cmpText ? ` · المقارنة: ${cmpText}` : ''} · الفرع: {scope}</p>
          </div>
        </div>
      </td></tr></thead>
      <tbody className="report-print-body"><tr><td>
      <div className="flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="text-2xl font-bold">التقارير</h1>
          <p className="text-sm text-ink-muted mt-1 num-ar" data-report-scope>{scope} · {periodText}{cmpText ? ` · المقارنة: ${cmpText}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden" data-report-controls>
          <Field label="الفترة" id="rp-period">
            <select id="rp-period" data-tour="report-period" className="field w-auto" value={periodKey} onChange={(e) => setPeriodKey(e.target.value as m.PeriodKey)} data-period>
              {m.PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {periodKey === 'custom' && (
            <div className="min-w-[280px]"><DateField mode="range" label="من" endLabel="إلى" start={custom.from} end={custom.to} min="past" max={today} id="rp-custom" onChange={(a, b) => a && b && setCustom({ from: a, to: b })} /></div>
          )}
          <Field label="المقارنة" id="rp-cmp">
            <select id="rp-cmp" data-tour="report-period" className="field w-auto" value={cmpKey} onChange={(e) => setCmpKey(e.target.value as m.CompareKey)} data-compare>
              {m.COMPARE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {cmpKey === 'custom' && (
            <div className="min-w-[280px]"><DateField mode="range" label="مقارنة من" endLabel="إلى" start={cmpCustom.from} end={cmpCustom.to} min="past" id="rp-cmp-custom" onChange={(a, b) => a && b && setCmpCustom({ from: a, to: b })} /></div>
          )}
          <BranchSelect id="rp-branch" label="الفرع" branches={branches} value={branch} onChange={setBranch} allLabel="الفرعان" />
          <button type="button" className="btn btn-ghost" onClick={exportXlsx} disabled={!perf.data} data-action="xlsx" data-tour="report-export"><Icon name="download" size={18} /> Excel</button>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()} data-action="pdf" data-tour="report-export"><Icon name="print" size={18} /> PDF</button>
        </div>
      </div>

      <nav aria-label="أقسام التقرير" className="print:hidden">
        <ul className="flex flex-wrap gap-2" data-report-links>
          {SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`} className="chip chip-request" onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }}>{s.label}</a></li>)}
        </ul>
      </nav>
      <p className="text-sm text-ink-muted note-scope" data-scope-note>كل الأرقام من الحجوزات المسجّلة في اللوحة. حجوزات المنصات الأخرى تدخل بعد ربط مدير القنوات.</p>
      <Performance s={perf} money={money} first={first} hasCmp={!!cmp} />
      <BehaviourSection s={beh} first={first} />
      <SourcesSection s={src} money={money} first={first} />
      <CancelSection s={can} first={first} />
      <ClubSection s={cp} first={first} />
      </td></tr></tbody>
      <tfoot className="report-print-foot" aria-hidden="true" data-print-foot><tr><td>
        <div className="report-print-foot-in">
          <span className="num-ar">طُبع في {riyadhDateTimeLong(printedAt)} (بتوقيت الرياض)</span>
          <span>للاستخدام الداخلي</span>
        </div>
      </td></tr></tfoot>
      </table>
    </div>
  );
}

function SectionHead({ id, title }: { id: string; title: string }) {
  return <h2 id={`${id}-h`} className="text-xl font-bold scroll-mt-20">{title}</h2>;
}
function Kpi({ title, how, value, change, k }: { title: string; how: string; value: ReactNode; change?: { text: string; dir: 'up' | 'down' | 'flat' } | null; k: string }) {
  return (
    <div className="card p-3 report-kpi" data-kpi={k}>
      <div className="flex items-center gap-1"><span className="text-xs font-semibold text-ink-muted">{title}</span><HowTip text={how} /></div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {change !== undefined && <div className="text-xs text-ink-muted mt-1 num-ar" data-change={change?.dir ?? 'none'}>{change ? <>{change.dir === 'up' ? '▲' : change.dir === 'down' ? '▼' : '•'} {change.text} عن فترة المقارنة</> : 'لا بيانات للمقارنة'}</div>}
    </div>
  );
}

// ───────────────────────── الأداء ─────────────────────────
function Performance({ s, money, first, hasCmp }: { s: Sect<m.Performance>; money: boolean; first: boolean; hasCmp: boolean }) {
  const d = s.data;
  const cur = d?.current;
  const prev = d?.compare ?? null;
  const ch = (a: number | null | undefined, b: number | null | undefined, pts = false) => (hasCmp ? m.changeText(a, b, pts) : undefined);
  const daily = d?.daily;
  const n = daily?.current.length ?? 0;
  const every = n > 60 ? 14 : n > 31 ? 7 : n > 14 ? 3 : 1;
  const headMoney = money ? ['الإيراد', 'متوسط سعر الليلة'] : [];
  const rowMoney = (r: { revenue?: number; adr?: number | null }) => (money ? [r.revenue === undefined ? '—' : sar(r.revenue), r.adr == null ? '—' : sar(r.adr)] : []);
  return (
    <section id="performance" aria-labelledby="performance-h" className="grid gap-3 report-section" data-section="performance">
      <SectionHead id="performance" title="الأداء" />
      <ErrorBox error={s.error} />
      {cur && (
        <>
          <div className={`grid grid-cols-2 ${money ? 'md:grid-cols-5' : 'md:grid-cols-3'} gap-3`}>
            <Kpi k="pct" title="المباع من مخزون الموقع" how={m.HOW.avgPct} value={<AnimatedNumber value={cur.pct} first={first} format={(x) => m.pctText(x)} />} change={ch(cur.pct, prev?.pct, true)} />
            {money && cur.revenue !== undefined && <Kpi k="revenue" title="الإيراد" how={m.HOW.revenue} value={<AnimatedNumber value={cur.revenue} first={first} format={(x) => sar(Math.round(x))} />} change={ch(cur.revenue, prev?.revenue)} />}
            {money && cur.adr !== undefined && <Kpi k="adr" title="متوسط سعر الليلة" how={m.HOW.adr} value={cur.adr === null ? '—' : <AnimatedNumber value={cur.adr} first={first} format={(x) => sar(Math.round(x))} />} change={ch(cur.adr, prev?.adr)} />}
            <Kpi k="bookings" title="الحجوزات المؤكدة" how={m.HOW.bookings} value={<AnimatedNumber value={cur.bookings} first={first} />} change={ch(cur.bookings, prev?.bookings)} />
            <Kpi k="nights" title="الليالي المباعة" how={m.HOW.nights} value={<AnimatedNumber value={cur.nights} first={first} />} change={ch(cur.nights, prev?.nights)} />
          </div>
          {daily && (
            <ChartCard title="المباع لكل ليلة" how={m.HOW.dailyCompare} id="perf-daily"
              summary={`نسبة المباع لكل ليلة في الفترة الحالية (متوسط ${m.pctText(cur.pct)})${prev ? ` مقابل فترة المقارنة (متوسط ${m.pctText(prev.pct)})` : ''}.`}
              table={{ head: ['الليلة', 'الفترة الحالية', ...(daily.compare ? ['ليلة المقارنة', 'فترة المقارنة'] : [])], rows: daily.current.map((x, i) => [longDate(x.night), m.pctText(x.pct), ...(daily.compare ? [daily.compare[i] ? longDate(daily.compare[i].night) : '—', m.pctText(daily.compare[i]?.pct)] : [])]) }}>
              <Legend items={[{ key: 'cur', label: 'الفترة الحالية', cls: 's1' }, ...(daily.compare ? [{ key: 'cmp', label: 'فترة المقارنة', cls: 's2', dashed: true }] : [])]} />
              <Lines first={first} label="المباع لكل ليلة" max={100} unit="٪" xLabelEvery={every}
                series={[
                  { key: 'cur', label: 'الفترة الحالية', cls: 's1', points: daily.current.map((x) => ({ label: shortDate(x.night), value: x.pct, tip: `${longDate(x.night)}: ${x.pct === null ? 'مغلق' : m.pctText(x.pct)}` })) },
                  ...(daily.compare ? [{ key: 'cmp', label: 'فترة المقارنة', cls: 's2', dashed: true, points: daily.current.map((_, i) => { const c = daily.compare![i]; return { label: '', value: c?.pct ?? null, tip: c ? `المقارنة ${longDate(c.night)}: ${c.pct === null ? 'مغلق' : m.pctText(c.pct)}` : '' }; }) }] : []),
                ]} />
            </ChartCard>
          )}
          <section className="card p-4" aria-labelledby="perf-table-h" data-perf-table>
            <div className="flex items-start gap-2 mb-3"><h3 id="perf-table-h" className="font-bold">حسب الفرع ونوع الغرفة</h3><HowTip text={m.HOW.table} /></div>
            <DataTable caption="حسب الفرع ونوع الغرفة"
              data={{ head: ['الفرع / نوع الغرفة', 'الليالي', 'المباع', ...headMoney], rows: (d!.branches ?? []).flatMap((b) => [
                ...d!.table.filter((r) => r.branch === b.slug).map((r) => [`${bn(b)} — ${r.name_ar}`, r.nights, m.pctText(r.pct), ...rowMoney(r)]),
                ...d!.subtotals.filter((r) => r.branch === b.slug).map((r) => [`مجموع ${bn(b)}`, r.nights, m.pctText(r.pct), ...rowMoney(r)]),
              ]) }}
              foot={[['الإجمالي', d!.total.nights, m.pctText(d!.total.pct), ...rowMoney(d!.total)]]} />
          </section>
        </>
      )}
    </section>
  );
}

// ───────────────────────── سلوك الحجز ─────────────────────────
function BehaviourSection({ s, first }: { s: Sect<m.Behaviour>; first: boolean }) {
  const d = s.data;
  return (
    <section id="behaviour" aria-labelledby="behaviour-h" className="grid gap-3 report-section" data-section="behaviour">
      <SectionHead id="behaviour" title="سلوك الحجز" />
      <ErrorBox error={s.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi k="bookings" title="الحجوزات المؤكدة" how={m.HOW.bookings} value={<AnimatedNumber value={d.bookings} first={first} />} />
            <Kpi k="los" title="متوسط مدة الإقامة" how={m.HOW.los} value={d.avg_los === null ? '—' : <AnimatedNumber value={d.avg_los} first={first} format={(x) => measureWord(x, NIGHT)} />} />
            <Kpi k="lead" title="متوسط الحجز المسبق" how={m.HOW.lead} value={d.avg_lead === null ? '—' : <AnimatedNumber value={d.avg_lead} first={first} format={(x) => measureWord(x, DAY)} />} />
            <Kpi k="same-day" title="حجوزات اليوم نفسه" how={m.HOW.sameDay} value={<AnimatedNumber value={d.same_day_share} first={first} format={(x) => m.pctText(x)} />} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="المباع حسب ليلة الأسبوع" how={m.HOW.weekdays} id="weekdays"
              summary={`نسبة المباع حسب ليلة الأسبوع: ${d.weekdays.map((w) => `${DOW[w.dow]} ${m.pctText(w.pct)}`).join('، ')}.`}
              table={{ head: ['الليلة', 'المباع', 'محجوز', 'متاح'], rows: d.weekdays.map((w) => [DOW[w.dow], m.pctText(w.pct), w.sold, w.left]) }}>
              <Bars first={first} label="المباع حسب ليلة الأسبوع" height={180}
                slots={d.weekdays.map((w) => ({ key: String(w.dow), label: DOW[w.dow], shade: w.dow === 4 || w.dow === 5, bars: [{ series: 1, value: w.pct, tip: `${DOW[w.dow]}: ${w.pct === null ? 'مغلق' : `${m.pctText(w.pct)} — محجوز ${w.sold}، متاح ${w.left}`}` }] }))} />
            </ChartCard>
            <ChartCard title="توزيع مدة الإقامة" how={m.HOW.losDist} id="los"
              summary={`الحجوزات حسب عدد الليالي: ${m.LOS_BUCKETS.map((b) => `${b.label} ${d.los[b.key]}`).join('، ')}.`}
              table={{ head: ['المدة', 'الحجوزات'], rows: m.LOS_BUCKETS.map((b) => [b.label, d.los[b.key]]) }}>
              <HBars first={first} rows={m.LOS_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: d.los[b.key], text: String(d.los[b.key]) }))} />
            </ChartCard>
          </div>
        </>
      )}
    </section>
  );
}

// ───────────────────────── المصادر والحملات ─────────────────────────
function SourcesSection({ s, money, first }: { s: Sect<m.SourcesReport>; money: boolean; first: boolean }) {
  const d = s.data;
  return (
    <section id="sources" aria-labelledby="sources-h" className="grid gap-3 report-section" data-section="sources">
      <SectionHead id="sources" title="المصادر والحملات" />
      <ErrorBox error={s.error} />
      {d && (
        <div className="grid lg:grid-cols-2 gap-4">
          <ChartCard title="حسب مصدر أول زيارة" how={m.HOW.srcTable} id="src"
            summary={d.bookings ? `الحجوزات المؤكدة حسب المصدر: ${d.sources.map((x) => `${m.sourceLabel(x.key)} ${x.bookings}`).join('، ')}.` : 'لا حجوزات مؤكدة في الفترة.'}
            table={{ head: ['المصدر', 'الحجوزات', 'الليالي', ...(money ? ['الإيراد', 'حصة الإيراد'] : [])], rows: d.sources.map((x) => [m.sourceLabel(x.key), x.bookings, x.nights, ...(money ? [sar(x.revenue ?? 0), m.pctText(x.revenue_share)] : [])]) }}>
            {d.bookings === 0 ? <p className="text-sm text-ink-muted">لا حجوزات مؤكدة في الفترة.</p> : (
              <HBars first={first} cls="s2" rows={d.sources.map((x) => ({ key: x.key, label: m.sourceLabel(x.key), value: x.bookings, text: money && x.revenue !== undefined ? `${x.bookings} · ${sar(x.revenue)} · ${m.pctText(x.revenue_share)}` : `${x.bookings} · ${nightsWord(x.nights)}` }))} />
            )}
          </ChartCard>
          <section className="card p-4" aria-labelledby="camp-h" data-campaigns>
            <div className="flex items-start gap-2 mb-3"><h3 id="camp-h" className="font-bold">الحملات (utm_campaign)</h3><HowTip text={m.HOW.campaigns} /></div>
            <DataTable caption="الحملات" data={{ head: ['الحملة', 'المنصة', 'الحجوزات', ...(money ? ['الإيراد', 'متوسط قيمة الحجز'] : [])], rows: d.campaigns.map((c) => [c.campaign, m.sourceLabel(c.platform), c.bookings, ...(money ? [sar(c.revenue ?? 0), sar(c.avg_value ?? 0)] : [])]) }} />
          </section>
        </div>
      )}
    </section>
  );
}

// ───────────────────────── الإلغاء والرد ─────────────────────────
function CancelSection({ s, first }: { s: Sect<m.Cancellations>; first: boolean }) {
  const d = s.data;
  return (
    <section id="cancellations" aria-labelledby="cancellations-h" className="grid gap-3 report-section" data-section="cancellations">
      <SectionHead id="cancellations" title="الإلغاء والرد" />
      <ErrorBox error={s.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi k="cancel-rate" title="نسبة الإلغاء" how={m.HOW.cancelRate} value={<AnimatedNumber value={d.rate} first={first} format={(x) => m.pctText(x)} />} />
            <Kpi k="cancelled" title="أُلغيت بعد التأكيد" how={m.HOW.cancelRate} value={<span className="num-ar">{d.cancelled} من {d.confirmed}</span>} />
            <Kpi k="reply" title="وقت الرد المعتاد" how={m.HOW.reply} value={<span className="num-ar">{m.durationText(d.reply_median_minutes)}</span>} />
            <Kpi k="partners-reply" title="أول تواصل مع الشركاء (الوسيط)" how={m.HOW.partnersReply} value={<span className="num-ar">{m.durationText(d.partners_median_minutes)}</span>} />
          </div>
          <p className="text-xs text-ink-muted num-ar" data-declined>طلبات أُلغيت قبل تأكيدها: {d.declined} · طلبات حجز في الفترة: {d.requests}، رُدّ على {d.reply_count} منها.</p>
          <ChartCard title="الإلغاء حسب المدة قبل الوصول" how={m.HOW.cancelBuckets} id="cancel-buckets"
            summary={`الحجوزات الملغاة بعد تأكيدها حسب المدة قبل الوصول: ${m.CANCEL_BUCKETS.map((b) => `${b.label} ${d.buckets[b.key]}`).join('، ')}.`}
            table={{ head: ['المدة قبل الوصول', 'الإلغاءات'], rows: m.CANCEL_BUCKETS.map((b) => [b.label, d.buckets[b.key]]) }}>
            <HBars first={first} rows={m.CANCEL_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: d.buckets[b.key], text: String(d.buckets[b.key]) }))} />
          </ChartCard>
        </>
      )}
    </section>
  );
}

// ───────────────────────── النادي والشركاء ─────────────────────────
function ClubSection({ s, first }: { s: Sect<m.ClubPartners>; first: boolean }) {
  const d = s.data;
  const wmax = d ? Math.max(4, ...d.weeks.map((w) => w.members)) : 4;
  const funnelTotal = d?.enquiries ?? 0;
  return (
    <section id="club" aria-labelledby="club-h" className="grid gap-3 report-section" data-section="club">
      <SectionHead id="club" title="النادي والشركاء" />
      <ErrorBox error={s.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi k="joined" title="أعضاء جدد في الفترة" how={m.HOW.newMembers} value={<AnimatedNumber value={d.joined} first={first} />} />
            <Kpi k="booked-members" title="أعضاء حجزوا في الفترة" how={m.HOW.bookedMembers} value={<AnimatedNumber value={d.booked_members} first={first} />} />
            <Kpi k="unsubscribe" title="نسبة إلغاء الاشتراك" how={m.HOW.unsubscribe} value={<><AnimatedNumber value={d.unsubscribe_rate} first={first} format={(x) => m.pctText(x)} />{d.unsubscribe_rate === null && '—'}</>} />
            <Kpi k="conversion" title="تحويل طلبات الشركاء" how={m.HOW.funnel} value={<><AnimatedNumber value={d.conversion} first={first} format={(x) => m.pctText(x)} />{d.conversion === null && '—'}</>} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="أعضاء جدد كل أسبوع" how={m.HOW.newMembers} id="weeks"
              summary={`الأعضاء الجدد كل أسبوع: ${d.weeks.map((w) => `أسبوع ${shortDate(w.week_from)} ${w.members}`).join('، ')}.`}
              table={{ head: ['الأسبوع من', 'الأعضاء الجدد'], rows: d.weeks.map((w) => [longDate(w.week_from), w.members]) }}>
              <Bars first={first} label="أعضاء جدد كل أسبوع" height={180} max={wmax} unit="" xLabelEvery={d.weeks.length > 12 ? 4 : d.weeks.length > 6 ? 2 : 1}
                slots={d.weeks.map((w) => ({ key: w.week_from, label: shortDate(w.week_from), bars: [{ series: 1, value: w.members, tip: `أسبوع ${longDate(w.week_from)}: ${w.members}` }] }))} />
            </ChartCard>
            <ChartCard title="الأعضاء حسب المصدر" how={m.HOW.clubSources} id="club-sources"
              summary={`الأعضاء الحاليون ${d.members}: ${m.CLUB_SOURCE_LABELS.map((x) => `${x.label} ${d.sources[x.key]?.all ?? 0}`).join('، ')}.`}
              table={{ head: ['المصدر', 'الأعضاء', 'الجدد في الفترة'], rows: m.CLUB_SOURCE_LABELS.map((x) => [x.label, d.sources[x.key]?.all ?? 0, d.sources[x.key]?.joined ?? 0]) }}>
              <HBars first={first} rows={m.CLUB_SOURCE_LABELS.map((x) => ({ key: x.key, label: x.label, value: d.sources[x.key]?.all ?? 0, text: `${d.sources[x.key]?.all ?? 0} · جدد ${d.sources[x.key]?.joined ?? 0}` }))} />
            </ChartCard>
          </div>
          <ChartCard title="مسار طلبات الشركاء" how={m.HOW.funnel} id="funnel"
            summary={`طلبات الشركاء في الفترة ${funnelTotal} حسب حالتها الأخيرة: ${m.FUNNEL.map((f) => `${f.label} ${d.funnel[f.key] ?? 0}`).join('، ')}؛ التحويل ${m.pctText(d.conversion)}.`}
            table={{ head: ['الحالة الأخيرة', 'الطلبات'], rows: [...m.FUNNEL.map((f) => [f.label, d.funnel[f.key] ?? 0]), ['مؤرشف', d.funnel.archived ?? 0]] }}>
            <HBars first={first} cls="s2" max={Math.max(1, funnelTotal)} rows={m.FUNNEL.map((f) => ({ key: f.key, label: f.label, value: d.funnel[f.key] ?? 0, text: `${d.funnel[f.key] ?? 0}${funnelTotal ? ` · ${Math.round(((d.funnel[f.key] ?? 0) / funnelTotal) * 1000) / 10}٪` : ''}` }))} />
            {(d.funnel.archived ?? 0) > 0 && <p className="text-xs text-ink-muted mt-2 num-ar">مؤرشف (خارج النسبة): {d.funnel.archived}</p>}
          </ChartCard>
        </>
      )}
    </section>
  );
}

// ───────────────────────── Excel ─────────────────────────
function buildSheets(x: { perf: m.Performance | null; beh: m.Behaviour | null; src: m.SourcesReport | null; can: m.Cancellations | null; cp: m.ClubPartners | null; money: boolean; scope: string; periodText: string; cmpText: string | null }): Sheet[] {
  const head = `${x.scope} · ${x.periodText}${x.cmpText ? ` · المقارنة: ${x.cmpText}` : ''} · كل الأرقام من الحجوزات المسجّلة في اللوحة`;
  const sheets: Sheet[] = [];
  const p = x.perf;
  if (p) {
    const mh = x.money ? ['الإيراد', 'متوسط سعر الليلة'] : [];
    const mv = (r: { revenue?: number; adr?: number | null }) => (x.money ? [num(r.revenue), num(r.adr)] : []);
    sheets.push({ name: 'الأداء', blocks: [
      { title: head, rows: [['المؤشر', 'الفترة الحالية', ...(p.compare ? ['فترة المقارنة'] : [])],
        ['المباع من مخزون الموقع (٪)', num(p.current.pct), ...(p.compare ? [num(p.compare.pct)] : [])],
        ...(x.money ? [['الإيراد', num(p.current.revenue), ...(p.compare ? [num(p.compare.revenue)] : [])], ['متوسط سعر الليلة', num(p.current.adr), ...(p.compare ? [num(p.compare.adr)] : [])]] : []),
        ['الحجوزات المؤكدة', p.current.bookings, ...(p.compare ? [p.compare.bookings] : [])],
        ['الليالي المباعة', p.current.nights, ...(p.compare ? [p.compare.nights] : [])]] },
      { title: 'المباع لكل ليلة', rows: [['الليلة', 'الفترة الحالية (٪)', ...(p.daily.compare ? ['ليلة المقارنة', 'فترة المقارنة (٪)'] : [])],
        ...p.daily.current.map((d, i) => [d.night, num(d.pct), ...(p.daily.compare ? [p.daily.compare[i]?.night ?? '', num(p.daily.compare[i]?.pct)] : [])])] },
      { title: 'حسب الفرع ونوع الغرفة', rows: [['الفرع', 'نوع الغرفة', 'الليالي', 'المباع (٪)', ...mh],
        ...p.branches.flatMap((b) => [
          ...p.table.filter((r) => r.branch === b.slug).map((r) => [bn(b), r.name_ar ?? '', r.nights, num(r.pct), ...mv(r)]),
          ...p.subtotals.filter((r) => r.branch === b.slug).map((r) => [`مجموع ${bn(b)}`, '', r.nights, num(r.pct), ...mv(r)]),
        ]),
        ['الإجمالي', '', p.total.nights, num(p.total.pct), ...mv(p.total)]] },
    ] });
  }
  const b = x.beh;
  if (b) sheets.push({ name: 'سلوك الحجز', blocks: [
    { title: head, rows: [['المؤشر', 'القيمة'], ['الحجوزات المؤكدة', b.bookings], ['متوسط مدة الإقامة (ليلة)', num(b.avg_los)], ['متوسط الحجز المسبق (يوم)', num(b.avg_lead)], ['حجوزات اليوم نفسه (٪)', num(b.same_day_share)]] },
    { title: 'المباع حسب ليلة الأسبوع', rows: [['الليلة', 'المباع (٪)', 'محجوز', 'متاح'], ...b.weekdays.map((w) => [DOW[w.dow], num(w.pct), w.sold, w.left])] },
    { title: 'توزيع مدة الإقامة', rows: [['المدة', 'الحجوزات'], ...m.LOS_BUCKETS.map((k) => [k.label, b.los[k.key]])] },
  ] });
  const s = x.src;
  if (s) sheets.push({ name: 'المصادر والحملات', blocks: [
    { title: head, rows: [['المصدر', 'الحجوزات', 'الليالي', ...(x.money ? ['الإيراد', 'حصة الإيراد (٪)'] : [])], ...s.sources.map((r) => [m.sourceLabel(r.key), r.bookings, r.nights, ...(x.money ? [num(r.revenue), num(r.revenue_share)] : [])])] },
    { title: 'الحملات', rows: [['الحملة', 'المنصة', 'الحجوزات', ...(x.money ? ['الإيراد', 'متوسط قيمة الحجز'] : [])], ...s.campaigns.map((c) => [c.campaign, m.sourceLabel(c.platform), c.bookings, ...(x.money ? [num(c.revenue), num(c.avg_value)] : [])])] },
  ] });
  const c = x.can;
  if (c) sheets.push({ name: 'الإلغاء والرد', blocks: [
    { title: head, rows: [['المؤشر', 'القيمة'], ['نسبة الإلغاء (٪)', num(c.rate)], ['أُلغيت بعد التأكيد', c.cancelled], ['تأكدت', c.confirmed], ['طلبات أُلغيت قبل تأكيدها', c.declined],
      ['وقت الرد المعتاد (دقيقة)', num(c.reply_median_minutes)], ['طلبات رُدّ عليها', c.reply_count], ['أول تواصل مع الشركاء — الوسيط (دقيقة)', num(c.partners_median_minutes)]] },
    { title: 'الإلغاء حسب المدة قبل الوصول', rows: [['المدة', 'الإلغاءات'], ...m.CANCEL_BUCKETS.map((k) => [k.label, c.buckets[k.key]])] },
  ] });
  const cp = x.cp;
  if (cp) sheets.push({ name: 'النادي والشركاء', blocks: [
    { title: head, rows: [['المؤشر', 'القيمة'], ['الأعضاء الحاليون', cp.members], ['أعضاء جدد في الفترة', cp.joined], ['أعضاء حجزوا في الفترة', cp.booked_members], ['ألغوا الاشتراك', cp.unsubscribed], ['نسبة إلغاء الاشتراك (٪)', num(cp.unsubscribe_rate)], ['تحويل طلبات الشركاء (٪)', num(cp.conversion)]] },
    { title: 'أعضاء جدد كل أسبوع', rows: [['الأسبوع من', 'الأعضاء الجدد'], ...cp.weeks.map((w) => [w.week_from, w.members])] },
    { title: 'الأعضاء حسب المصدر', rows: [['المصدر', 'الأعضاء', 'الجدد في الفترة'], ...m.CLUB_SOURCE_LABELS.map((k) => [k.label, cp.sources[k.key]?.all ?? 0, cp.sources[k.key]?.joined ?? 0])] },
    { title: 'مسار طلبات الشركاء', rows: [['الحالة الأخيرة', 'الطلبات'], ...m.FUNNEL.map((f) => [f.label, cp.funnel[f.key] ?? 0]), ['مؤرشف', cp.funnel.archived ?? 0]] },
  ] });
  return sheets;
}
