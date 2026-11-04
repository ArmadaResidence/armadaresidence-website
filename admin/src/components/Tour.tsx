// The guided tour (Ahmed, 4 Nov 2026 — DECISIONS.md 2026-11-04 «Guided tour»; steps and texts in lib/tours.ts).
//   - A card points at one control at a time with an arrow; the page dims behind a spotlight cut out around the target
//     with a 2 px bronze ring. Between steps the card and the spotlight glide (--motion-fast, 200 ms; reduced motion →
//     instant) and the target scrolls into view. Below 640 px the card is a bottom sheet (no arrow).
//   - The card: title, one or two lines, «2 من 5», «السابق», «التالي» («إنهاء» on the last step), «تخطّي» and, on the
//     welcome tour, «لا تعرض الجولة مرة أخرى». Focus moves into the card, Tab cycles its controls, Esc = «تخطّي»; the
//     page behind is inert and an outside press does nothing; focus returns where it was.
//   - The welcome tour starts by itself after a sign-in while public.staff_tours has no 'welcome' row for the user
//     (finished, or skipped with the box ticked = a row; a plain «تخطّي» = nothing, so the next sign-in — a new auth
//     session — shows it again; within one session it shows once). Automated browsers never get it unless
//     localStorage `armada-tour-test` = '1' (the e2e), so the other dashboard checks are unaffected.
//   - «؟» (44 px, «المساعدة») in the top bar next to the search: «شرح هذه الصفحة» (hidden where the screen has none)
//     and «جولة سريعة في اللوحة», at any time, whatever the stored state.
// No library: a portal with a fixed spotlight (box-shadow dim), a click-catcher and the card.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { onOutsidePress } from '../../../src/lib/client';
import { available, openerOf, pageTour, stepCounter, stepElements, WELCOME, type Tour, type TourStep } from '../lib/tours';
import { Icon } from './icons';

interface TourCtl {
  start: (tour: Tour) => void;
  running: boolean;
}
const TourCtx = createContext<TourCtl>({ start: () => {}, running: false });
export const useTour = () => useContext(TourCtx);

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => innerWidth < 640;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAD = 6;

/** the access token's session_id: one welcome tour per sign-in */
function sessionId(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: string };
    return p.session_id ?? null;
  } catch {
    return null;
  }
}

interface Box { x: number; y: number; w: number; h: number }
function unionBox(els: HTMLElement[]): Box | null {
  if (!els.length) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const el of els) {
    const q = el.getBoundingClientRect();
    l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
  }
  // pad, then keep the ring inside the viewport (a target taller than the screen: the grid, the sidebar)
  const x = Math.max(4, l - PAD), y = Math.max(4, t - PAD);
  const x2 = Math.min(innerWidth - 4, r + PAD), y2 = Math.min(innerHeight - 4, b + PAD);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** waits until the steps that can be shown stop changing (lists load after the page), at most 3 s */
async function settle(tour: Tour, me: ReturnType<typeof useSession>['me']): Promise<TourStep[]> {
  const t0 = Date.now();
  let last = -1, since = Date.now();
  for (;;) {
    const n = tour.steps.filter((s) => available(s, me)).length;
    if (n !== last) { last = n; since = Date.now(); }
    if (n === tour.steps.length) break;
    if (n > 0 && Date.now() - since >= 400 && Date.now() - t0 >= 700) break;
    if (Date.now() - t0 > 3000) break;
    await wait(100);
  }
  return tour.steps.filter((s) => available(s, me));
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { me, session } = useSession();
  const { pathname } = useLocation();
  const [tour, setTour] = useState<Tour | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [dontShow, setDontShow] = useState(false);
  const [ready, setReady] = useState(false); // the current step's target is on screen and measured
  const busy = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const openedDrawer = useRef(false);
  const inerted = useRef<Element[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const els = useRef<HTMLElement[]>([]);
  const pending = useRef<TourStep[] | null>(null);

  // ── inert: everything on <body> but the tour itself (the drawer the tour opens included) ──
  const applyInert = useCallback(() => {
    for (const el of Array.from(document.body.children)) {
      if (el === root.current || el.hasAttribute('inert') || el.tagName === 'SCRIPT') continue;
      el.setAttribute('inert', '');
      inerted.current.push(el);
    }
  }, []);
  const liftInert = useCallback(() => {
    inerted.current.forEach((el) => el.removeAttribute('inert'));
    inerted.current = [];
  }, []);

  const measure = useCallback(() => {
    setBox(unionBox(els.current.filter((e) => e.isConnected)));
  }, []);

  const end = useCallback(async (how: 'finish' | 'skip' | 'abort') => {
    if (!tour) return;
    const store = tour.welcome && (how === 'finish' || (how === 'skip' && dontShow));
    liftInert();
    if (openedDrawer.current) {
      document.querySelector<HTMLElement>('[data-drawer] [data-action="dialog-close"]')?.click();
      openedDrawer.current = false;
    }
    setTour(null);
    setSteps([]);
    setBox(null);
    setReady(false);
    els.current = [];
    const back = opener.current;
    setTimeout(() => {
      const help = document.querySelector<HTMLElement>('[data-tour~="help"]');
      (back && back.isConnected && back.offsetParent !== null ? back : help)?.focus();
    }, 60);
    if (store) {
      const { error } = await supabase.rpc('staff_tour_done', { p_tour: tour.id });
      if (error) console.error('staff_tour_done', error.message);
    }
  }, [tour, dontShow, liftInert]);

  // ── show step `n` of `list`: open what it needs, scroll it into view, measure ──
  const show = useCallback(async (list: TourStep[], n: number) => {
    busy.current = true;
    setReady(false);
    let step = list[n];
    let found = stepElements(step);
    if (!found.length && step.open) {
      const o = openerOf(step);
      if (o) {
        liftInert();
        o.click();
        openedDrawer.current = true;
        const t0 = Date.now();
        while (!found.length && Date.now() - t0 < 3000) {
          await wait(80);
          found = stepElements(step);
        }
        // the drawer slides in: measure once its entrance has finished
        await Promise.race([Promise.all(document.getAnimations().map((x) => x.finished.catch(() => {}))), wait(1200)]);
        applyInert();
      }
    }
    if (!found.length) {
      // gone since the tour started (or nothing to open): drop it and keep the counter true
      const rest = list.filter((_, k) => k !== n);
      busy.current = false;
      if (!rest.length) return void end('abort');
      setSteps(rest);
      return void show(rest, Math.min(n, rest.length - 1));
    }
    step = list[n];
    els.current = found;
    const first = found[0];
    const prevMargin = first.style.scrollMarginTop;
    first.style.scrollMarginTop = phone() ? '72px' : '';
    first.scrollIntoView({ block: phone() ? 'start' : 'center', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    first.style.scrollMarginTop = prevMargin;
    // wait for the scroll to settle (smooth scrolling has no end event everywhere)
    let last = '';
    for (let k = 0; k < 20; k++) {
      await wait(reduced() ? 0 : 50);
      const q = first.getBoundingClientRect();
      const now = `${Math.round(q.left)},${Math.round(q.top)},${Math.round(q.width)}`;
      if (now === last) break;
      last = now;
    }
    setI(n);
    measure();
    setReady(true);
    busy.current = false;
  }, [applyInert, liftInert, measure, end]);

  const start = useCallback(async (t: Tour) => {
    if (busy.current || tour) return;
    busy.current = true;
    opener.current = document.activeElement as HTMLElement | null;
    const list = await settle(t, me);
    busy.current = false;
    if (!list.length) return;
    setDontShow(false);
    pending.current = list;
    setTour(t);
    setSteps(list);
    setI(0);
  }, [tour, me]);
  // the portal is on the page: make the rest inert and show the first step
  useEffect(() => {
    if (!tour || !pending.current) return;
    const list = pending.current;
    pending.current = null;
    applyInert();
    void show(list, 0);
  }, [tour, applyInert, show]);

  // keep the spotlight on the target while anything scrolls or resizes
  useEffect(() => {
    if (!tour) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    addEventListener('scroll', on, true);
    addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('scroll', on, true);
      removeEventListener('resize', on);
    };
  }, [tour, measure]);

  // a route change (the browser's back button) ends the tour without storing anything
  const path0 = useRef(pathname);
  useEffect(() => {
    if (tour && pathname !== path0.current) void end('abort');
    path0.current = pathname;
  }, [pathname, tour, end]);

  const next = useCallback(() => {
    if (busy.current) return;
    if (i >= steps.length - 1) return void end('finish');
    void show(steps, i + 1);
  }, [i, steps, show, end]);
  const prev = useCallback(() => {
    if (busy.current || i === 0) return;
    void show(steps, i - 1);
  }, [i, steps, show]);

  // ── keyboard: Esc = «تخطّي», Tab cycles the card; the page's own shortcuts (Ctrl+K, a drawer's Esc) wait ──
  useEffect(() => {
    if (!tour) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        void end('skip');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === 'Tab') {
        e.stopImmediatePropagation();
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-tour-card] button:not([disabled]), [data-tour-card] input:not([disabled])') ?? []);
        if (!items.length) return;
        e.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLElement);
        const to = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === -1 || at === items.length - 1 ? 0 : at + 1);
        items[to].focus();
      }
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [tour, end]);

  // ── the welcome tour after a sign-in ──
  const sid = sessionId(session?.access_token);
  useEffect(() => {
    if (!me || !sid) return;
    let gone = false;
    let automated = false;
    try {
      automated = navigator.webdriver && localStorage.getItem('armada-tour-test') !== '1';
    } catch { /* private mode */ }
    if (automated) return;
    const key = `armada-tour-welcome:${session?.user.id ?? ''}`;
    try {
      if (localStorage.getItem(key) === sid) return; // already shown in this sign-in
    } catch { /* private mode */ }
    (async () => {
      const { data, error } = await supabase.rpc('staff_tours_done');
      if (gone || error) return;
      if ((data as string[] | null)?.includes(WELCOME.id)) return;
      try {
        localStorage.setItem(key, sid);
      } catch { /* private mode */ }
      // let the landing page draw; never over an open dialog
      for (let k = 0; k < 30 && document.querySelector('dialog[open]'); k++) await wait(200);
      await wait(500);
      if (!gone) void start(WELCOME);
    })();
    return () => {
      gone = true;
    };
  }, [me?.role, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctl = useMemo(() => ({ start: (t: Tour) => void start(t), running: !!tour }), [start, tour]);
  const step = steps[i];
  return (
    <TourCtx.Provider value={ctl}>
      {children}
      {tour && createPortal(
        <div ref={root} className="tour-root" data-tour-root={tour.id}>
          <div className="tour-catch" onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.preventDefault()} aria-hidden="true" data-tour-catch />
          {box && <div className="tour-spot" aria-hidden="true" data-tour-spot style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }} />}
          {step && (
            <TourCard key={tour.id} box={box} ready={ready} title={step.title} text={step.text} count={stepCounter(i, steps.length)}
              first={i === 0} last={i === steps.length - 1} welcome={!!tour.welcome} dontShow={dontShow} setDontShow={setDontShow}
              onNext={next} onPrev={prev} onSkip={() => void end('skip')} stepKey={`${tour.id}:${i}`} />
          )}
        </div>,
        document.body,
      )}
    </TourCtx.Provider>
  );
}

function TourCard({ box, ready, title, text, count, first, last, welcome, dontShow, setDontShow, onNext, onPrev, onSkip, stepKey }: {
  box: Box | null; ready: boolean; title: string; text: string; count: string; first: boolean; last: boolean; welcome: boolean;
  dontShow: boolean; setDontShow: (v: boolean) => void; onNext: () => void; onPrev: () => void; onSkip: () => void; stepKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; arrow: 'top' | 'bottom' | 'left' | 'right' | null; ax: number } | null>(null);
  // the first placement is instant (no glide in from the corner); later steps glide
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    if (!pos || placed) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setPlaced(true)));
    return () => cancelAnimationFrame(r);
  }, [pos, placed]);
  const sheet = phone();

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !box) return;
    if (sheet) return setPos({ x: 0, y: 0, arrow: null, ax: 0 });
    const cw = c.offsetWidth, ch = c.offsetHeight, gap = 14, m = 8;
    const vw = innerWidth, vh = innerHeight;
    const cx = box.x + box.w / 2;
    const clampX = (x: number) => Math.min(Math.max(m, x), vw - cw - m);
    let p: typeof pos;
    if (box.y + box.h + gap + ch <= vh - m) {
      const x = clampX(cx - cw / 2);
      p = { x, y: box.y + box.h + gap, arrow: 'top', ax: Math.min(Math.max(18, cx - x), cw - 18) };
    } else if (box.y - gap - ch >= m) {
      const x = clampX(cx - cw / 2);
      p = { x, y: box.y - gap - ch, arrow: 'bottom', ax: Math.min(Math.max(18, cx - x), cw - 18) };
    } else {
      // beside the target (the sidebar, the grid): the side with room, else over the bottom of the screen
      const y = Math.min(Math.max(m, box.y + box.h / 2 - ch / 2), vh - ch - m);
      const cy = box.y + box.h / 2;
      if (box.x - gap - cw >= m) p = { x: box.x - gap - cw, y, arrow: 'right', ax: Math.min(Math.max(18, cy - y), ch - 18) };
      else if (box.x + box.w + gap + cw <= vw - m) p = { x: box.x + box.w + gap, y, arrow: 'left', ax: Math.min(Math.max(18, cy - y), ch - 18) };
      else p = { x: clampX(cx - cw / 2), y: vh - ch - m, arrow: null, ax: 0 };
    }
    setPos(p);
  }, [box, sheet, stepKey, text]);

  // focus into the card once per step, when it is placed and visible (the primary button; the card is labelled by its
  // title and text) — never again on a later re-measure, so Tab within the card is not undone by a scroll
  const focused = useRef('');
  const visible = sheet || !!pos;
  useEffect(() => {
    if (!ready || !visible || focused.current === stepKey) return;
    focused.current = stepKey;
    primary.current?.focus({ preventScroll: true });
  }, [ready, visible, stepKey]);

  const style: React.CSSProperties = sheet ? {} : pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : { visibility: 'hidden' };
  return (
    <div ref={ref} className={`tour-card ${sheet ? 'is-sheet' : ''} ${placed ? 'is-placed' : ''}`} style={style} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text"
      data-tour-card data-ready={ready ? '1' : '0'} data-arrow={pos?.arrow ?? ''}>
      {pos?.arrow && <span className={`tour-arrow is-${pos.arrow}`} aria-hidden="true" style={pos.arrow === 'top' || pos.arrow === 'bottom' ? { left: pos.ax - 7 } : { top: pos.ax - 7 }} />}
      <div aria-live="polite">
        <p className="tour-count num-ar" data-tour-count>{count}</p>
        <h2 id="tour-title" className="tour-title" data-tour-title>{title}</h2>
        <p id="tour-text" className="tour-text" data-tour-text>{text}</p>
      </div>
      {welcome && (
        <label className="tour-check">
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} data-tour-dontshow data-no-dirty />
          <span>لا تعرض الجولة مرة أخرى</span>
        </label>
      )}
      <div className="tour-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip} data-tour-action="skip">تخطّي</button>
        <span className="flex-1" />
        {!first && <button type="button" className="btn btn-ghost btn-sm" onClick={onPrev} data-tour-action="prev">السابق</button>}
        <button ref={primary} type="button" className="btn btn-primary btn-sm" onClick={onNext} data-tour-action={last ? 'finish' : 'next'}>{last ? 'إنهاء' : 'التالي'}</button>
      </div>
    </div>
  );
}

/** «؟» in the top bar: «شرح هذه الصفحة» (where the screen has a tour) and «جولة سريعة في اللوحة» */
export function HelpMenu() {
  const { start } = useTour();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const page = pageTour(pathname);
  useEffect(() => onOutsidePress(() => [wrap.current], () => setOpen(false), { active: () => open }), [open]);
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btn.current?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const at = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length) return;
        e.preventDefault();
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open]);
  useEffect(() => setOpen(false), [pathname]);
  const run = (t: Tour) => {
    setOpen(false);
    btn.current?.focus();
    start(t);
  };
  return (
    <div className="relative flex-none" ref={wrap}>
      <button ref={btn} type="button" className="topbar-theme" onClick={() => setOpen((v) => !v)} aria-label="المساعدة" aria-haspopup="menu" aria-expanded={open}
        aria-controls="help-menu" data-tour="help" data-action="help">
        <Icon name="faq" size={20} />
      </button>
      {open && (
        <div id="help-menu" role="menu" aria-label="المساعدة" className="help-menu" data-help-menu>
          {page && <button type="button" role="menuitem" className="account-item" onClick={() => run(page)} data-help="page">شرح هذه الصفحة</button>}
          <button type="button" role="menuitem" className="account-item" onClick={() => run(WELCOME)} data-help="welcome">جولة سريعة في اللوحة</button>
        </div>
      )}
    </div>
  );
}
