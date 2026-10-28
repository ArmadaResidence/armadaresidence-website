/**
 * Date-range picker (Ahmed, 23 Oct 2026) — the one calendar behind every date field on the site: the booking form
 * (drawer and /booking/) and the partners enquiry form. Markup comes from src/components/DateRangeField.astro.
 *
 * No typing anywhere: the two fields are buttons (the mobile keyboard never opens) and the values live in hidden
 * inputs as ISO YYYY-MM-DD, so the forms and the Edge Function are unchanged. A tap on either field opens a modal
 * <dialog>: under 768 px a full-screen bottom sheet with one month and prev/next, from 768 px a popover with two
 * months side by side, anchored under the fields. First tap = arrival, second tap = departure; a tap before the
 * arrival restarts from that day; the arrival day itself is not a departure. Past days (Asia/Riyadh) are disabled;
 * the range ends on 31 December of next year. Every tap is written to the fields at once ("Done" only closes).
 *
 * Accessibility (WAI-ARIA APG date picker dialog): table grid, roving tabindex, arrows (by screen direction, so
 * RTL mirrors), Home/End = week start/end, PageUp/PageDown = month (Shift = year), Enter/Space picks, Esc closes,
 * focus returns to the field that opened it, full-date aria-label on every day. Motion: transform/opacity on the
 * motion tokens; reduced motion closes at once.
 *
 * Other scripts can set a hidden input and dispatch `change`: the picker re-reads it and drops a past or
 * inconsistent value (the partners form restores a saved draft that way).
 *
 * Dashboard options (phase 2a.1, 26 Oct 2026) in the data JSON, all absent on the website: `mode: 'single'` (one
 * field, one tap picks and closes), `min` (ISO; past dates viewable when it lies in the past — default today) and
 * `max` (ISO; default 31 December of next year).
 */
import { onPageLoad, bindOnce, onOutsidePress, reducedMotion } from './client';
import { addDays, nightsBetween, plural, riyadhToday, type PluralKey } from '../../supabase/functions/booking-request/rules.ts';

type Which = 'start' | 'end';
type Data = {
  title: string;
  months: string[];
  months_short: string[];
  weekdays: string[];
  weekdays_short: string[];
  field_format: string;
  day_label: string;
  month_title: string;
  list_separator: string;
  pick_check_in: string;
  pick_check_out: string;
  stay_length: string;
  nights: Record<PluralKey, string>;
  labels: Record<Which, string>;
  mode?: 'range' | 'single';
  min?: string | null;
  max?: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WIDE = '(min-width: 768px)';
/** month index (year × 12 + month) of an ISO date */
const monthOf = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function format(tpl: string, iso: string, S: Data): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const wd = weekdayOf(iso);
  const v: Record<string, string> = {
    weekday: S.weekdays[wd],
    weekday_short: S.weekdays_short[wd],
    day: String(Number(iso.slice(8, 10))),
    month: S.months[m],
    month_short: S.months_short[m],
    year: String(y),
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
}

/** "{month} {year}" etc. for a month index */
const monthTitle = (mk: number, S: Data) => format(S.month_title, isoOf(Math.floor(mk / 12), mk % 12, 1), S);

export function initDateRange(root: HTMLElement): void {
  const S = JSON.parse(root.querySelector('[data-dr-data]')?.textContent || '{}') as Data;
  const dialog = root.querySelector<HTMLDialogElement>('[data-dr-dialog]')!;
  const monthsEl = dialog.querySelector<HTMLElement>('[data-dr-months]')!;
  const prevBtn = dialog.querySelector<HTMLButtonElement>('[data-dr-prev]')!;
  const nextBtn = dialog.querySelector<HTMLButtonElement>('[data-dr-next]')!;
  const status = dialog.querySelector<HTMLElement>('[data-dr-status]')!;
  // persistent live region for the month shown after prev / next (the month titles are rebuilt each time)
  const live = document.createElement('p');
  live.className = 'dp-live';
  live.setAttribute('aria-live', 'polite');
  monthsEl.before(live);
  const uid = dialog.id;
  const single = S.mode === 'single';
  // single mode has no departure field: detached stand-ins keep the code below branch-free
  const input: Record<Which, HTMLInputElement> = {
    start: root.querySelector<HTMLInputElement>('[data-dr-value="start"]')!,
    end: root.querySelector<HTMLInputElement>('[data-dr-value="end"]') ?? document.createElement('input'),
  };
  const trigger: Record<Which, HTMLButtonElement> = {
    start: root.querySelector<HTMLButtonElement>('[data-dr-trigger="start"]')!,
    end: root.querySelector<HTMLButtonElement>('[data-dr-trigger="end"]') ?? document.createElement('button'),
  };
  const triggers = () => [trigger.start, trigger.end].filter((t) => t.isConnected);
  const wide = matchMedia(WIDE);

  let today = riyadhToday();
  const defaultMax = () => `${Number(today.slice(0, 4)) + 1}-12-31`;
  let minDate = S.min && ISO.test(S.min) ? S.min : today;
  let maxDate = S.max && ISO.test(S.max) ? S.max : defaultMax();
  let start: string | null = null;
  let end: string | null = null;
  let picking: Which = 'start';
  let focusDate = today;
  let hover: string | null = null;
  let view = monthOf(today); // first month shown
  let shown = 1; // months shown (1 sheet, 2 popover)
  let opener: HTMLButtonElement | null = null;
  let closing = false;
  let writing = false; // our own change events are not re-read

  // ── rules ──────────────────────────────────────────────────────────────────────────────────────────────
  /** a tap on `d` sets the arrival (first tap, a full range, or a day before the arrival) */
  const startsRange = (d: string) => single || picking === 'start' || !start || d < start;
  function disabled(d: string): boolean {
    if (d < minDate || d > maxDate) return true;
    if (single) return false;
    if (startsRange(d)) return d === maxDate; // an arrival needs a departure inside the range
    return d === start; // the arrival day is never the departure
  }
  const clampDate = (d: string) => (d < minDate ? minDate : d > maxDate ? maxDate : d);
  const minView = () => monthOf(minDate);
  const maxView = () => Math.max(minView(), monthOf(maxDate) - shown + 1);

  /** Read the hidden inputs; drop a past, out-of-range or inconsistent value. */
  function sync() {
    const a = input.start.value;
    const b = input.end.value;
    start = ISO.test(a) && a >= minDate && (single ? a <= maxDate : a < maxDate) ? a : null;
    end = !single && start && ISO.test(b) && b > start && b <= maxDate ? b : null;
    if ((start ?? '') !== a || (end ?? '') !== b) write();
    else paintFields();
  }

  // ── fields ─────────────────────────────────────────────────────────────────────────────────────────────
  function write() {
    writing = true;
    for (const w of ['start', 'end'] as Which[]) {
      const v = (w === 'start' ? start : end) ?? '';
      if (input[w].value === v) continue;
      input[w].value = v;
      input[w].dispatchEvent(new Event('input', { bubbles: true }));
      input[w].dispatchEvent(new Event('change', { bubbles: true }));
    }
    writing = false;
    paintFields();
  }
  function paintFields() {
    for (const w of ['start', 'end'] as Which[]) {
      const v = w === 'start' ? start : end;
      const t = trigger[w];
      const out = t.querySelector<HTMLElement>('[data-dr-display]');
      if (out) out.textContent = v ? format(S.field_format, v, S) : '';
      t.classList.toggle('has-value', !!v);
      t.classList.toggle('is-active', dialog.open && !closing && picking === w);
      const sel = dialog.querySelector<HTMLElement>(`[data-dr-sel="${w}"]`);
      if (sel) {
        sel.classList.toggle('is-active', picking === w);
        sel.querySelector<HTMLElement>('[data-dr-sel-value]')!.textContent = v ? format(S.field_format, v, S) : '—';
      }
    }
  }

  // ── grid ───────────────────────────────────────────────────────────────────────────────────────────────
  function build() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < shown; i++) {
      const mk = view + i;
      const y = Math.floor(mk / 12);
      const m = mk % 12;
      const box = document.createElement('div');
      box.className = 'dp-month';
      const title = document.createElement('div');
      title.className = 'dp-title';
      title.id = `${uid}-m${i}`;
      title.textContent = monthTitle(mk, S);
      const table = document.createElement('table');
      table.className = 'dp-grid';
      table.setAttribute('role', 'grid');
      table.setAttribute('aria-labelledby', title.id);
      const head = table.createTHead().insertRow();
      S.weekdays_short.forEach((short, k) => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.abbr = S.weekdays[k];
        th.textContent = short;
        head.append(th);
      });
      const body = table.createTBody();
      const lead = new Date(Date.UTC(y, m, 1)).getUTCDay(); // week starts on Sunday
      const n = daysIn(y, m);
      let row = body.insertRow();
      for (let k = 0; k < lead; k++) row.insertCell().className = 'dp-pad';
      for (let d = 1; d <= n; d++) {
        if (row.cells.length === 7) row = body.insertRow();
        const td = row.insertCell();
        td.dataset.date = isoOf(y, m, d);
        const num = document.createElement('span');
        num.className = 'dp-num';
        num.textContent = String(d);
        td.append(num);
      }
      while (row.cells.length < 7) row.insertCell().className = 'dp-pad';
      box.append(title, table);
      frag.append(box);
    }
    monthsEl.replaceChildren(frag);
    if (dialog.open) live.textContent = Array.from({ length: shown }, (_, i) => monthTitle(view + i, S)).join(' – ');
    prevBtn.setAttribute('aria-disabled', String(view <= minView()));
    nextBtn.setAttribute('aria-disabled', String(view >= maxView()));
  }

  function paint() {
    const preview = picking === 'end' && start && hover && hover > start && !disabled(hover) ? hover : null;
    const rangeEnd = preview ?? end;
    for (const td of monthsEl.querySelectorAll<HTMLTableCellElement>('td[data-date]')) {
      const d = td.dataset.date!;
      const isStart = d === start;
      const isEnd = d === end;
      const inRange = !!(start && rangeEnd && d > start && d < rangeEnd);
      td.classList.toggle('is-start', isStart);
      td.classList.toggle('is-end', isEnd && !preview);
      td.classList.toggle('is-range-start', isStart && !!rangeEnd);
      td.classList.toggle('is-range-end', d === rangeEnd);
      td.classList.toggle('in-range', inRange);
      td.classList.toggle('is-preview', !!preview && (inRange || d === preview));
      td.classList.toggle('is-today', d === today);
      const off = disabled(d);
      if (off) td.setAttribute('aria-disabled', 'true');
      else td.removeAttribute('aria-disabled');
      td.setAttribute('aria-selected', String(isStart || isEnd || !!(start && end && d > start && d < end)));
      if (d === today) td.setAttribute('aria-current', 'date');
      td.tabIndex = d === focusDate ? 0 : -1;
      const role = isStart ? S.labels.start : isEnd ? S.labels.end : '';
      td.setAttribute('aria-label', format(S.day_label, d, S) + (role ? S.list_separator + role : ''));
    }
    const text = single
      ? start ? format(S.field_format, start, S) : S.pick_check_in
      : !start ? S.pick_check_in : !end ? S.pick_check_out : S.stay_length.replace('{nights}', plural(S.nights, nightsBetween(start, end)));
    if (status.textContent !== text) status.textContent = text;
    paintFields();
  }

  /** Bring `focusDate` into view (rebuilding the months when the view moves). */
  function reveal(): boolean {
    const fm = monthOf(focusDate);
    let v = view;
    if (fm < v) v = fm;
    else if (fm > v + shown - 1) v = fm - shown + 1;
    v = Math.min(maxView(), Math.max(minView(), v));
    if (v === view && monthsEl.childElementCount === shown) return false;
    view = v;
    build();
    return true;
  }
  const focusCell = () => monthsEl.querySelector<HTMLElement>(`td[data-date="${focusDate}"]`)?.focus();

  function pick(d: string) {
    if (disabled(d)) return;
    if (startsRange(d)) {
      start = d;
      end = null;
      picking = single ? 'start' : 'end';
    } else {
      end = d;
      picking = 'start';
    }
    focusDate = d;
    hover = null;
    write();
    paint();
    if (single) close();
  }

  /** Same day of month `n` months away, kept inside the selectable range. */
  function shiftMonths(iso: string, n: number): string {
    const mk = monthOf(iso) + n;
    const y = Math.floor(mk / 12);
    const m = mk % 12;
    return clampDate(isoOf(y, m, Math.min(Number(iso.slice(8, 10)), daysIn(y, m))));
  }

  function moveView(n: number) {
    const v = Math.min(maxView(), Math.max(minView(), view + n));
    if (v === view) return;
    focusDate = shiftMonths(focusDate, v - view);
    view = v;
    build();
    paint();
  }

  // ── open / close ───────────────────────────────────────────────────────────────────────────────────────
  /** Popover: scroll the page (or the drawer) just enough for it to open under the fields instead of over them,
      keeping the fields (labels included) clear of the sticky header. */
  function makeRoom() {
    if (!wide.matches) return;
    const top = root.getBoundingClientRect().top;
    const bottom = Math.max(...triggers().map((t) => t.getBoundingClientRect().bottom));
    const need = bottom + 16 + dialog.offsetHeight - window.innerHeight; // least scroll for the popover to fit
    const most = top - 112; // most scroll before the fields slide under the header
    const by = need > 0 ? Math.min(need, most) : most < 0 ? Math.max(most, need) : 0;
    if (Math.abs(by) < 1) return;
    let scroller: Element = document.scrollingElement ?? document.documentElement;
    for (let p = root.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
        scroller = p;
        break;
      }
    }
    scroller.scrollBy({ top: by, behavior: 'instant' });
  }

  function place() {
    if (!wide.matches) {
      dialog.style.removeProperty('top');
      dialog.style.removeProperty('left');
      return;
    }
    const rects = triggers().map((t) => t.getBoundingClientRect());
    const box = { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)), left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    const w = dialog.offsetWidth;
    const h = dialog.offsetHeight;
    const gap = 8;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const rtl = getComputedStyle(root).direction === 'rtl';
    let left = rtl ? box.right - w : box.left;
    left = Math.max(gap, Math.min(left, vw - w - gap));
    let top = box.bottom + gap;
    if (top + h > vh - gap) top = box.top - gap - h >= gap ? box.top - gap - h : Math.max(gap, vh - h - gap);
    // a top-layer dialog with position: absolute sits in document coordinates, so it scrolls with the page
    dialog.style.top = `${Math.round(top + window.scrollY)}px`;
    dialog.style.left = `${Math.round(left + window.scrollX)}px`;
  }
  let raf = 0;
  const onViewport = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const n = wide.matches ? 2 : 1;
      if (n !== shown) {
        shown = n;
        reveal() || build();
        paint();
      }
      place();
    });
  };

  function open(which: Which, from: HTMLButtonElement) {
    if (dialog.open) return;
    today = riyadhToday();
    minDate = S.min && ISO.test(S.min) ? S.min : today;
    maxDate = S.max && ISO.test(S.max) ? S.max : defaultMax();
    sync();
    // the arrival field always starts a new range (first tap = arrival); the departure field edits the departure
    picking = !single && which === 'end' && start ? 'end' : 'start';
    focusDate = clampDate(picking === 'end' ? (end ?? addDays(start!, 1)) : (start ?? today));
    hover = null;
    shown = wide.matches ? 2 : 1;
    // two months: start on the arrival's month when the departure is being picked, unless that hides the focus
    view = monthOf(picking === 'end' && shown === 2 ? start! : focusDate);
    if (monthOf(focusDate) > view + shown - 1) view = monthOf(focusDate) - shown + 1;
    view = Math.min(maxView(), Math.max(minView(), view));
    build();
    opener = from;
    trigger.start.setAttribute('aria-expanded', String(which === 'start'));
    trigger.end.setAttribute('aria-expanded', String(which === 'end'));
    closing = false;
    dialog.showModal();
    paint();
    document.documentElement.classList.add('dp-open');
    makeRoom();
    place();
    focusCell();
    window.addEventListener('resize', onViewport);
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('is-open')));
  }

  let safety = 0;
  function finishClose() {
    if (!closing) return;
    closing = false;
    window.clearTimeout(safety);
    if (dialog.open) dialog.close();
    document.documentElement.classList.remove('dp-open');
    trigger.start.setAttribute('aria-expanded', 'false');
    trigger.end.setAttribute('aria-expanded', 'false');
    paintFields();
    opener?.focus();
  }
  function close() {
    if (!dialog.open || closing) return;
    closing = true;
    window.removeEventListener('resize', onViewport);
    dialog.classList.remove('is-open');
    if (reducedMotion()) return finishClose();
    const done = (e: TransitionEvent) => {
      if (e.target !== dialog) return;
      dialog.removeEventListener('transitionend', done);
      finishClose();
    };
    dialog.addEventListener('transitionend', done);
    safety = window.setTimeout(finishClose, 600); // safety net if no transition fires
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────────────────
  (['start', 'end'] as Which[]).forEach((w) => {
    trigger[w].addEventListener('click', () => open(w, trigger[w]));
    input[w].addEventListener('change', () => {
      if (!writing) sync();
    });
  });
  dialog.querySelector('[data-dr-done]')!.addEventListener('click', close);
  dialog.querySelector('[data-dr-close]')?.addEventListener('click', close);
  dialog.querySelector('[data-dr-clear]')!.addEventListener('click', () => {
    start = end = null;
    picking = 'start';
    hover = null;
    focusDate = clampDate(focusDate);
    write();
    paint();
  });
  prevBtn.addEventListener('click', () => prevBtn.getAttribute('aria-disabled') !== 'true' && moveView(-1));
  nextBtn.addEventListener('click', () => nextBtn.getAttribute('aria-disabled') !== 'true' && moveView(1));
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault(); // Esc: run the close transition, then close
    close();
  });
  // backdrop (28 Oct 2026, decision B8): closes only on a press that starts AND ends outside the panel — a drag that
  // starts on a day or the month strip and ends on the backdrop keeps the picker open (a `click` would close it: the
  // browser dispatches it to the common ancestor, the dialog itself). Site pages end the listener with the page; the
  // dashboard mounts a picker once per field.
  const gone = new AbortController();
  document.addEventListener('astro:before-swap', () => gone.abort(), { once: true });
  onOutsidePress(() => Array.from(dialog.children), () => close(), { signal: gone.signal, active: () => dialog.isConnected && dialog.open && !closing });
  monthsEl.addEventListener('click', (e) => {
    const td = (e.target as Element).closest<HTMLElement>('td[data-date]');
    if (td) pick(td.dataset.date!);
  });
  monthsEl.addEventListener('pointerover', (e) => {
    const td = (e.target as Element).closest<HTMLElement>('td[data-date]');
    const d = td?.dataset.date ?? null;
    if (d !== hover && picking === 'end') {
      hover = d;
      paint();
    }
  });
  monthsEl.addEventListener('pointerleave', () => {
    if (hover) {
      hover = null;
      paint();
    }
  });
  monthsEl.addEventListener('keydown', (e) => {
    if (!(e.target as Element).matches?.('td[data-date]')) return;
    const rtl = getComputedStyle(monthsEl).direction === 'rtl';
    let next: string | null = null;
    switch (e.key) {
      case 'ArrowRight':
        next = addDays(focusDate, rtl ? -1 : 1);
        break;
      case 'ArrowLeft':
        next = addDays(focusDate, rtl ? 1 : -1);
        break;
      case 'ArrowDown':
        next = addDays(focusDate, 7);
        break;
      case 'ArrowUp':
        next = addDays(focusDate, -7);
        break;
      case 'Home':
        next = addDays(focusDate, -weekdayOf(focusDate));
        break;
      case 'End':
        next = addDays(focusDate, 6 - weekdayOf(focusDate));
        break;
      case 'PageUp':
        next = shiftMonths(focusDate, e.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = shiftMonths(focusDate, e.shiftKey ? 12 : 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        pick(focusDate);
        return;
      default:
        return;
    }
    e.preventDefault();
    focusDate = clampDate(next);
    if (picking === 'end') hover = focusDate;
    reveal();
    paint();
    focusCell();
  });

  sync();
}

onPageLoad(() => {
  document.querySelectorAll<HTMLElement>('[data-daterange]').forEach((root) => {
    if (bindOnce(root)) initDateRange(root);
  });
});
