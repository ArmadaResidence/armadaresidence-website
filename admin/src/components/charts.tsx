// The charts of «النظرة العامة» and «التقارير» (4 Nov 2026 — phase 2b session 6). Hand-built SVG, so every mark works the
// same by hover, tap and keyboard focus (a roving tab stop per chart: arrows move in the reading direction, Enter / Space
// opens the mark's link), time runs in the reading direction (the first night at the start side — the right in Arabic),
// and every chart has an aria-label summary and «عرض كجدول» with the same data.
// Colours (validated with the dataviz palette checks, light on #ffffff and dark on #182f41): the two branches
// --viz-1 / --viz-2 (styles.css), «مغلق» a hatched neutral; text always in the ink tokens, never a series colour.
// Motion: on the FIRST load only, donuts draw in (--motion-slow, 700 ms), bars grow, numbers count up (≤ 800 ms) and cards
// fade in with a short stagger; a filter change only moves values (≤ 200 ms, --motion-fast), never replays the entry;
// prefers-reduced-motion → no animation at all (the tokens are 0 and the JS tweens jump).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { reducedMotion } from '../../../src/lib/client';
import { Icon } from './icons';

// ───────────────────────── numbers ─────────────────────────
/** a number that counts up once on the first load (≤ 800 ms), tweens on later changes (≤ 200 ms) and, when `flash`,
 *  marks a change with a brief bronze highlight (about 1.5 s — the realtime refresh) */
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)), first, flash, className = '' }: { value: number | null | undefined; format?: (n: number) => string; first: boolean; flash?: boolean; className?: string }) {
  const [shown, setShown] = useState<number | null>(() => (value === null || value === undefined ? null : first && !reducedMotion() ? 0 : Number(value)));
  const prev = useRef<number | null>(shown);
  const [lit, setLit] = useState(false);
  const raf = useRef(0);
  useEffect(() => {
    if (value === null || value === undefined) {
      setShown(null);
      prev.current = null;
      return;
    }
    const to = Number(value);
    const from = prev.current ?? 0;
    const changed = prev.current !== null && prev.current !== to;
    prev.current = to;
    if (changed && flash) {
      setLit(true);
      const t = window.setTimeout(() => setLit(false), 1500);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [value, flash]);
  useEffect(() => {
    if (value === null || value === undefined) return;
    const to = Number(value);
    const start = shown ?? 0;
    if (reducedMotion() || start === to) {
      setShown(to);
      return;
    }
    const dur = shown === 0 && first ? 800 : 200;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(start + (to - start) * e);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (shown === null) return null;
  return <span className={`num ${lit ? 'is-flash' : ''} ${className}`} data-flash={lit ? '1' : undefined}>{format(shown)}</span>;
}

// ───────────────────────── «كيف نحسب» ─────────────────────────
/** a small info button whose one-line definition shows on hover, focus and tap (Esc closes it) */
export function HowTip({ text, label = 'كيف نحسب' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const out = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    addEventListener('keydown', k);
    addEventListener('pointerdown', out);
    return () => {
      removeEventListener('keydown', k);
      removeEventListener('pointerdown', out);
    };
  }, [open]);
  return (
    <span className="how" ref={root} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="how-btn" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open}
        onClick={() => setOpen((v) => !v)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} data-how>
        <Icon name="info" size={16} />
      </button>
      {open && <span id={id} role="tooltip" className="how-tip" data-how-tip>{text}</span>}
    </span>
  );
}

// ───────────────────────── frame + table toggle ─────────────────────────
export interface TableData { head: string[]; rows: (string | number)[][] }
/** a chart card: title + «كيف نحسب» + «عرض كجدول», the chart described by an aria-label summary */
export function ChartCard({ title, how, summary, table, children, actions, id, className = '', style }: { title: string; how?: string; summary: string; table: TableData; children: ReactNode; actions?: ReactNode; id?: string; className?: string; style?: React.CSSProperties }) {
  const [asTable, setAsTable] = useState(false);
  const hid = useId();
  return (
    <section className={`card p-4 viz-card ${className}`} aria-labelledby={hid} id={id} style={style} data-chart={id}>
      <div className="flex items-start gap-2 mb-3">
        <h2 id={hid} className="font-bold text-base leading-snug">{title}</h2>
        {how && <HowTip text={how} />}
        <div className="ms-auto flex items-center gap-2 print:hidden">
          {actions}
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} data-action="as-table">
            {asTable ? 'عرض كرسم' : 'عرض كجدول'}
          </button>
        </div>
      </div>
      {asTable ? <DataTable data={table} caption={title} /> : <figure className="m-0" role="group" aria-label={summary} data-summary>{children}</figure>}
      {/* the print copy always carries the table under the chart */}
      {!asTable && <div className="hidden print:block mt-2"><DataTable data={table} caption={title} /></div>}
    </section>
  );
}

export function DataTable({ data, caption, foot }: { data: TableData; caption?: string; foot?: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto relative">
      <table className="viz-table w-full text-sm" data-viz-table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr>{data.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {data.rows.length ? data.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className="num-ar">{c}</td>))}</tr>)
            : <tr><td colSpan={data.head.length} className="text-ink-muted">لا بيانات في هذه الفترة.</td></tr>}
        </tbody>
        {foot && <tfoot>{foot.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className="num-ar">{c}</td>))}</tr>)}</tfoot>}
      </table>
    </div>
  );
}

// ───────────────────────── tooltip + roving focus ─────────────────────────
interface Mark { key: string; tip: string; href?: string; x: number; y: number }
/** shared mark behaviour: hover / tap / focus shows the tip; Enter / Space / click opens the href */
function useMarks(marks: Mark[], label: string) {
  const nav = useNavigate();
  const [active, setActive] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);
  activeRef.current = active;
  // a tap on a mark that was not showing its tip only shows it; a second tap follows the link
  const tapFollows = useRef(false);
  // the compatibility mouse events a tap fires (mouseover … mouseout) must not hide the tip it just opened
  const touchAt = useRef(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const refs = useRef<(SVGElement | null)[]>([]);
  const rtl = typeof document !== 'undefined' && document.documentElement.dir !== 'ltr';
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = (d: number) => {
      const j = Math.max(0, Math.min(marks.length - 1, i + d));
      setFocusIdx(j);
      setActive(j);
      refs.current[j]?.focus();
    };
    // marks are ordered in reading order (time order): ArrowLeft goes forward in Arabic, back in English
    if (e.key === 'ArrowLeft') { e.preventDefault(); next(rtl ? 1 : -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(rtl ? -1 : 1); }
    else if (e.key === 'Home') { e.preventDefault(); next(-marks.length); }
    else if (e.key === 'End') { e.preventDefault(); next(marks.length); }
    else if ((e.key === 'Enter' || e.key === ' ') && marks[i]?.href) { e.preventDefault(); nav(marks[i].href!); }
    else if (e.key === 'Escape') setActive(null);
  };
  const props = (i: number) => ({
    ref: (el: SVGElement | null) => { refs.current[i] = el; },
    tabIndex: i === focusIdx ? 0 : -1,
    role: marks[i]?.href ? 'link' : 'img',
    'aria-label': marks[i]?.tip,
    onMouseEnter: () => setActive(i),
    onMouseLeave: () => { if (Date.now() - touchAt.current > 1000) setActive((a) => (a === i ? null : a)); },
    onFocus: () => { setActive(i); setFocusIdx(i); },
    onBlur: () => { if (Date.now() - touchAt.current > 1000) setActive((a) => (a === i ? null : a)); },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touchAt.current = Date.now();
      tapFollows.current = activeRef.current === i;
      setActive(i);
    },
    onClick: (e: React.MouseEvent) => {
      // a tap first shows the tip; a second tap (or a mouse click) follows the link
      const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch';
      if (marks[i]?.href && (!touch || tapFollows.current)) nav(marks[i].href!);
      tapFollows.current = false;
    },
    onKeyDown: (e: KeyboardEvent) => onKey(e, i),
    'data-mark': marks[i]?.key,
    style: { cursor: marks[i]?.href ? 'pointer' : 'default', outline: 'none' } as React.CSSProperties,
  });
  const tip = active !== null && marks[active] ? marks[active] : null;
  return { props, tip, label };
}

function Tip({ mark, w, h }: { mark: Mark | null; w: number; h: number }) {
  if (!mark) return null;
  const left = `${(mark.x / w) * 100}%`;
  const top = `${(mark.y / h) * 100}%`;
  return (
    <div className="viz-tip" role="status" style={{ left, top }} data-viz-tip>
      {mark.tip.split('\n').map((l, i) => <div key={i} className={i === 0 ? 'font-semibold' : ''}>{l}</div>)}
    </div>
  );
}

/** the measured width of a chart box (re-measured on resize) */
function useWidth(min = 280) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(min, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(min, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

// ───────────────────────── donut ─────────────────────────
export interface DonutSeg { key: string; label: string; value: number; cls: string }
export function Donut({ segs, center, sub, first, href, size = 168, label }: { segs: DonutSeg[]; center: string; sub?: string; first: boolean; href?: string; size?: number; label: string }) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  const r = 64;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && segs.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  let acc = 0;
  const marks: Mark[] = segs.map((s) => {
    const mid = (acc + s.value / 2) / (total || 1);
    acc += s.value;
    const a = mid * 2 * Math.PI - Math.PI / 2;
    return { key: s.key, tip: `${s.label}: ${s.value}${total ? ` (${Math.round((s.value / total) * 1000) / 10}٪)` : ''}`, href, x: 90 + Math.cos(a) * r, y: 90 + Math.sin(a) * r };
  });
  const { props, tip } = useMarks(marks, label);
  acc = 0;
  return (
    <div className="viz-donut relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 180 180" width={size} height={size} className={first ? 'is-first' : ''}>
        <circle cx="90" cy="90" r={r} className="donut-track" />
        {total > 0 && segs.map((s, i) => {
          const len = (s.value / total) * c;
          const off = (acc / total) * c;
          acc += s.value;
          if (s.value <= 0) return null;
          return (
            <circle key={s.key} cx="90" cy="90" r={r} className={`donut-seg ${s.cls}`} {...props(i)}
              strokeDasharray={`${Math.max(len - gap, 0.01)} ${c}`} strokeDashoffset={-off} />
          );
        })}
        <text x="90" y={sub ? 88 : 96} textAnchor="middle" className="donut-center num">{center}</text>
        {sub && <text x="90" y="112" textAnchor="middle" className="donut-sub">{sub}</text>}
      </svg>
      <Tip mark={tip} w={180} h={180} />
    </div>
  );
}

// ───────────────────────── vertical bars (one or two series per slot) ─────────────────────────
export interface BarSlot { key: string; label: string; shade?: boolean; bars: { series: number; value: number | null; tip: string; href?: string }[] }
/** bars on a 0–100 % scale; slots in time order, the first at the reading start; `shade` = a weekend band */
export function Bars({ slots, first, height = 200, max = 100, unit = '٪', label, xLabelEvery = 1 }: { slots: BarSlot[]; first: boolean; height?: number; max?: number; unit?: string; label: string; xLabelEvery?: number }) {
  const [ref, w] = useWidth();
  const rtl = document.documentElement.dir !== 'ltr';
  const pad = { t: 10, b: 28, s: 34, e: 6 };
  const iw = w - pad.s - pad.e;
  const ih = height - pad.t - pad.b;
  const n = slots.length || 1;
  const sw = iw / n;
  const per = Math.max(1, ...slots.map((s) => s.bars.length));
  const bw = Math.max(3, Math.min(22, (sw - 6) / per - 2));
  const xOf = (i: number) => (rtl ? pad.e + iw - (i + 0.5) * sw : pad.s + (i + 0.5) * sw);
  const yOf = (v: number) => pad.t + ih - (Math.min(v, max) / max) * ih;
  // label every k-th slot so the axis labels never collide (about 6 px a character + a gap)
  const labelEvery = Math.max(xLabelEvery, Math.ceil((Math.max(1, ...slots.map((s) => s.label.length)) * 6 + 10) / sw));
  const marks: Mark[] = [];
  slots.forEach((s, i) => s.bars.forEach((b, j) => {
    const cx = xOf(i) + (j - (s.bars.length - 1) / 2) * (bw + 2);
    marks.push({ key: `${s.key}:${j}`, tip: b.tip, href: b.href, x: cx, y: yOf(b.value ?? 0) });
  }));
  const { props, tip } = useMarks(marks, label);
  const axisX = rtl ? w - pad.s + 4 : pad.s - 4;
  let k = -1;
  return (
    <div ref={ref} className="relative w-full" data-viz-bars>
      <svg width={w} height={height} className={`viz-svg ${first ? 'is-first' : ''}`}>
        {[0, 25, 50, 75, 100].filter((g) => g <= max).map((g) => (
          <g key={g}>
            <line x1={pad.s} x2={w - pad.e} y1={yOf(g)} y2={yOf(g)} className="viz-grid" transform={rtl ? `translate(${pad.e - pad.s} 0)` : undefined} />
            <text x={axisX} y={yOf(g) + 4} textAnchor={rtl ? 'start' : 'end'} className="viz-axis num">{`${g}${unit}`}</text>
          </g>
        ))}
        {slots.map((s, i) => s.shade ? <rect key={`sh${s.key}`} x={xOf(i) - sw / 2} y={pad.t} width={sw} height={ih} className="viz-shade" /> : null)}
        {slots.map((s, i) => (
          <g key={s.key}>
            {s.bars.map((b, j) => {
              k += 1;
              const cx = xOf(i) + (j - (s.bars.length - 1) / 2) * (bw + 2);
              const v = b.value ?? 0;
              const hgt = Math.max((Math.min(v, max) / max) * ih, b.value === null ? 0 : 1.5);
              return (
                <g key={j}>
                  {/* the hit target is the whole column, wider than the mark */}
                  <rect x={cx - bw / 2 - 1} y={pad.t} width={bw + 2} height={ih} className="viz-hit" {...props(k)} />
                  {b.value === null
                    ? <line x1={cx - bw / 2} x2={cx + bw / 2} y1={pad.t + ih - 1} y2={pad.t + ih - 1} className="viz-closed-tick" />
                    : <rect x={cx - bw / 2} y={pad.t + ih - hgt} width={bw} height={hgt} rx={Math.min(4, bw / 2)} className={`viz-bar s${b.series}`} style={{ transformOrigin: `${cx}px ${pad.t + ih}px` }} />}
                </g>
              );
            })}
            {i % labelEvery === 0 && <text x={xOf(i)} y={height - 8} textAnchor="middle" className="viz-axis num-ar">{s.label}</text>}
          </g>
        ))}
        <line x1={pad.s} x2={w - pad.e} y1={pad.t + ih} y2={pad.t + ih} className="viz-base" transform={rtl ? `translate(${pad.e - pad.s} 0)` : undefined} />
      </svg>
      <Tip mark={tip} w={w} h={height} />
    </div>
  );
}

// ───────────────────────── lines (solid / dashed) ─────────────────────────
export interface LineSeries { key: string; label: string; dashed?: boolean; cls: string; points: { label: string; value: number | null; tip: string }[] }
/** one y-scale only (never a second axis); points in time order; a gap where a value is null */
export function Lines({ series, first, height = 200, max, unit = '', format = (n: number) => String(Math.round(n)), label, xLabelEvery = 1 }: { series: LineSeries[]; first: boolean; height?: number; max?: number; unit?: string; format?: (n: number) => string; label: string; xLabelEvery?: number }) {
  const [ref, w] = useWidth();
  const rtl = document.documentElement.dir !== 'ltr';
  const pad = { t: 12, b: 28, s: 44, e: 8 };
  const iw = w - pad.s - pad.e;
  const ih = height - pad.t - pad.b;
  const n = Math.max(1, ...series.map((s) => s.points.length));
  const vals = series.flatMap((s) => s.points.map((p) => p.value).filter((v): v is number => v !== null));
  const top = max ?? niceMax(Math.max(1, ...vals));
  const step = n > 1 ? iw / (n - 1) : 0;
  const xOf = (i: number) => (n === 1 ? pad.s + iw / 2 : rtl ? pad.e + iw - i * step : pad.s + i * step);
  const yOf = (v: number) => pad.t + ih - (v / top) * ih;
  const lead = series[0];
  const labelEvery = Math.max(xLabelEvery, Math.ceil((Math.max(1, ...lead.points.map((p) => p.label.length)) * 6 + 10) / Math.max(step, 1)));
  // one mark per x position (a crosshair): the tip lists every series at that point
  const marks: Mark[] = Array.from({ length: n }, (_, i) => ({
    key: String(i),
    tip: series.map((s) => s.points[i]?.tip).filter(Boolean).join('\n'),
    x: xOf(i),
    y: yOf(Math.max(0, ...series.map((s) => s.points[i]?.value ?? 0))),
  }));
  const { props, tip } = useMarks(marks, label);
  const path = (s: LineSeries) => {
    let d = '';
    let pen = false;
    s.points.forEach((p, i) => {
      if (p.value === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(p.value).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const axisX = rtl ? w - pad.s + 4 : pad.s - 4;
  const grid = [0, top / 2, top];
  const activeI = tip ? Number(tip.key) : null;
  return (
    <div ref={ref} className="relative w-full" data-viz-lines>
      <svg width={w} height={height} className={`viz-svg ${first ? 'is-first' : ''}`}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={pad.s} x2={w - pad.e} y1={yOf(g)} y2={yOf(g)} className="viz-grid" transform={rtl ? `translate(${pad.e - pad.s} 0)` : undefined} />
            <text x={axisX} y={yOf(g) + 4} textAnchor={rtl ? 'start' : 'end'} className="viz-axis num">{`${format(g)}${unit}`}</text>
          </g>
        ))}
        {activeI !== null && <line x1={xOf(activeI)} x2={xOf(activeI)} y1={pad.t} y2={pad.t + ih} className="viz-cross" />}
        {series.map((s) => <path key={s.key} d={path(s)} className={`viz-line ${s.cls} ${s.dashed ? 'is-dashed' : ''}`} />)}
        {series.map((s) => s.points.map((p, i) => (p.value === null ? null : (
          <circle key={`${s.key}${i}`} cx={xOf(i)} cy={yOf(p.value)} r={activeI === i ? 4.5 : n > 40 ? 0 : 2.5} className={`viz-dot ${s.cls}`} />
        ))))}
        {marks.map((m, i) => <rect key={m.key} x={xOf(i) - Math.max(step, 8) / 2} y={pad.t} width={Math.max(step, 8)} height={ih} className="viz-hit" {...props(i)} />)}
        {lead.points.map((p, i) => (i % labelEvery === 0 ? <text key={i} x={xOf(i)} y={height - 8} textAnchor="middle" className="viz-axis num-ar">{p.label}</text> : null))}
        <line x1={pad.s} x2={w - pad.e} y1={pad.t + ih} y2={pad.t + ih} className="viz-base" transform={rtl ? `translate(${pad.e - pad.s} 0)` : undefined} />
      </svg>
      <Tip mark={tip} w={w} h={height} />
    </div>
  );
}
function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// ───────────────────────── horizontal bars (a ranked list) ─────────────────────────
/** label · bar · value — readable as a list, the bar only reinforces the number */
export function HBars({ rows, first, max, cls = 's1' }: { rows: { key: string; label: string; value: number; text: string }[]; first: boolean; max?: number; cls?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={`hbars ${first ? 'is-first' : ''}`} data-hbars>
      {rows.map((r) => (
        <li key={r.key} className="hbar-row" data-hbar={r.key}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track" aria-hidden="true"><span className={`hbar-fill ${cls}`} style={{ transform: `scaleX(${Math.max(r.value, 0) / top})` }} /></span>
          <span className="hbar-value num-ar">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** the legend of one or more series: swatch + name in ink (identity never by colour alone) */
export function Legend({ items }: { items: { key: string; label: string; cls: string; dashed?: boolean }[] }) {
  return (
    <ul className="legend mb-2" data-legend>
      {items.map((i) => (
        <li key={i.key} className="legend-item">
          <span className={`viz-swatch ${i.cls} ${i.dashed ? 'is-dashed' : ''}`} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** first-load flag of a page: true until the first data arrives and has been painted once */
export function useFirstLoad(ready: boolean) {
  const [first, setFirst] = useState(true);
  useEffect(() => {
    if (!ready || !first) return;
    const t = window.setTimeout(() => setFirst(false), 1000);
    return () => window.clearTimeout(t);
  }, [ready, first]);
  return first;
}

/** the CSS class of a branch's series (fixed by branch order, never by rank) */
export const seriesOf = (branches: { slug: string }[], slug: string) => `s${Math.max(0, branches.findIndex((b) => b.slug === slug)) + 1}`;
export const useStableCallback = <T extends (...a: never[]) => unknown>(fn: T) => {
  const r = useRef(fn);
  r.current = fn;
  return useCallback(((...a: Parameters<T>) => r.current(...a)) as T, []);
};
