// The site's calendar picker in the dashboard (phase 2a.1, item 2): the same markup as src/components/DateRangeField.astro
// and the same script (src/lib/daterange.ts), so a date is never typed, the week starts on Sunday, the months are
// Arabic and the fields read «الأحد 25 أكتوبر 2026». Two modes: `range` (two fields) and `single` (one field, a tap
// picks and closes). `min` lets filters and the calendar jumper reach past dates ('past' = 1 January of last year);
// edits keep today as the minimum, and the server refuses past nights anyway. Values are ISO YYYY-MM-DD.
import { useEffect, useId, useRef } from 'react';
import { initDateRange } from '../../../src/lib/daterange';
import ui from '../../../content/ui.json';
import { riyadhToday } from '../lib/format';

const T = (ui as { ar: { datepicker: Record<string, unknown>; form: { stay_length: string; plural: { nights: Record<string, string> } } } }).ar;

type Common = { label: string; min?: 'today' | 'past' | string; max?: string; id?: string; className?: string; disabled?: boolean };
type RangeProps = Common & { mode: 'range'; start: string; end: string; onChange: (start: string, end: string) => void; endLabel: string };
type SingleProps = Common & { mode: 'single'; value: string; onChange: (value: string) => void };

const Calendar = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
const Chevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

function minIso(min: Common['min']): string | null {
  if (!min || min === 'today') return null;
  if (min === 'past') return `${Number(riyadhToday().slice(0, 4)) - 1}-01-01`;
  return min;
}

export default function DateField(props: RangeProps | SingleProps) {
  const root = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, '');
  const id = props.id ?? `df-${uid}`;
  const single = props.mode === 'single';
  const labels = single ? [props.label] : [props.label, props.endLabel];
  const which = single ? (['start'] as const) : (['start', 'end'] as const);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const values = single ? [props.value] : [props.start, props.end];

  const data = {
    ...T.datepicker,
    stay_length: T.form.stay_length,
    nights: T.form.plural.nights,
    labels: { start: labels[0], end: labels[1] ?? '' },
    mode: props.mode,
    min: minIso(props.min),
    max: props.max ?? null,
    ...(single ? { pick_check_in: 'اختر التاريخ' } : {}),
  };

  // bind the picker once; report every change of the hidden inputs
  useEffect(() => {
    const el = root.current;
    if (!el || el.hasAttribute('data-bound')) return;
    el.setAttribute('data-bound', '');
    initDateRange(el);
    const read = () => {
      const s = el.querySelector<HTMLInputElement>('[data-dr-value="start"]')!.value;
      const e = el.querySelector<HTMLInputElement>('[data-dr-value="end"]')?.value ?? '';
      const fn = onChange.current as (a: string, b?: string) => void;
      if (single) fn(s);
      else fn(s, e);
    };
    el.addEventListener('change', (ev) => {
      if ((ev.target as HTMLElement).matches('[data-dr-value]')) read();
    });
  }, [single]);

  // outside value → the picker (it re-reads the inputs on `change`)
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    which.forEach((w, i) => {
      const input = el.querySelector<HTMLInputElement>(`[data-dr-value="${w}"]`);
      if (input && input.value !== (values[i] ?? '')) {
        input.value = values[i] ?? '';
        input.dispatchEvent(new Event('change', { bubbles: false }));
      }
    });
  }, [values[0], values[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={root} className={`date-field ${single ? '' : 'date-field-range'} ${props.className ?? ''}`} data-daterange dir="rtl">
      {which.map((w, i) => (
        <div key={w} className="min-w-0">
          <label id={`${id}-${w}-label`} className="label" htmlFor={`${id}-${w}`}>{labels[i]}</label>
          <input type="hidden" data-dr-value={w} value={values[i] ?? ''} readOnly />
          <button
            type="button"
            id={`${id}-${w}`}
            className="field date-trigger flex items-center justify-between gap-2 text-start"
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-labelledby={`${id}-${w}-label ${id}-${w}-value`}
            data-dr-trigger={w}
            disabled={props.disabled}
          >
            <span id={`${id}-${w}-value`} className="date-trigger-value num-ar" data-dr-display />
            <span className="text-bronze shrink-0"><Calendar /></span>
          </button>
        </div>
      ))}
      <dialog id={`${id}-dp`} className="dp" aria-labelledby={`${id}-dp-title`} data-dr-dialog>
        <div className="dp-panel">
          <div className="dp-head">
            <p id={`${id}-dp-title`} className="dp-heading">{single ? props.label : String(T.datepicker.title)}</p>
            <button type="button" className="dp-x" aria-label="إغلاق" data-dr-close>✕</button>
          </div>
          <div className="dp-sel" style={single ? { gridTemplateColumns: '1fr' } : undefined}>
            {which.map((w, i) => (
              <div key={w} className="dp-sel-item" data-dr-sel={w}>
                <span className="dp-sel-label">{labels[i]}</span>
                <span className="dp-sel-value" data-dr-sel-value>—</span>
              </div>
            ))}
          </div>
          <div className="dp-body">
            <button type="button" className="dp-nav dp-prev" aria-label={String(T.datepicker.prev_month)} data-dr-prev><Chevron /></button>
            <button type="button" className="dp-nav dp-next" aria-label={String(T.datepicker.next_month)} data-dr-next><Chevron /></button>
            <div className="dp-months" data-dr-months />
          </div>
          <div className="dp-foot">
            <p className="dp-status" aria-live="polite" data-dr-status />
            <div className="dp-actions">
              <button type="button" className="dp-clear" data-dr-clear>{single ? 'مسح' : String(T.datepicker.clear)}</button>
              <button type="button" className="dp-done" data-dr-done>{String(T.datepicker.done)}</button>
            </div>
          </div>
        </div>
      </dialog>
      <script type="application/json" data-dr-data dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
    </div>
  );
}
