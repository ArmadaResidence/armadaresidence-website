/**
 * A manual, swipeable row of cards (7 Nov 2026): the reviews carousel «آراء ضيوفنا» and the branch pages' photo strip.
 * The scrolling is native (overflow-x + scroll-snap, RTL-aware, swipe on touch); this adds the arrows (from 768 px) and,
 * where present, the dots: an arrow moves one card in the reading direction and is disabled at its end; the dots follow
 * the card at the start edge of the row. With prefers-reduced-motion the arrows and dots jump instead of gliding. When
 * every card fits, the controls are hidden.
 * Auto-advance (Ahmed, 7 Nov 2026 — the reviews carousel only, `data-slider-autoplay`): one card every
 * --motion-reviews-hold (6 s) in the reading direction, back to the first after the last (a loop); paused while the
 * mouse is over it, while it is touched, while anything in it has the focus, while it is off screen and while the tab
 * is hidden — then the count starts again from zero; a press of an arrow or a dot restarts the count too. Never under
 * prefers-reduced-motion (the token is 0 there), and nothing moves while every card fits. The branch pages' photo
 * strip stays manual.
 *   [data-slider] > [data-slider-track] (the scroller, its children the cards), [data-slider-prev] / [data-slider-next],
 *   optional [data-slider-dots] with one button per card.
 */
import { bindOnce, isRtl, motionToken, onPageLeave, onPageLoad, reducedMotion } from './client';

const cleanups: (() => void)[] = [];

function init(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>('[data-slider-track]');
  if (!track) return;
  const cards = Array.from(track.children) as HTMLElement[];
  const prev = root.querySelector<HTMLButtonElement>('[data-slider-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-slider-next]');
  const dots = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-slider-dots] button'));
  const behavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');
  // scrollLeft runs negative in RTL (Chromium, WebKit, Firefox): work with the distance from the start edge
  const pos = () => Math.abs(track.scrollLeft);
  const max = () => track.scrollWidth - track.clientWidth;
  const step = () => {
    const a = cards[0]?.getBoundingClientRect();
    const b = cards[1]?.getBoundingClientRect();
    return a && b ? Math.abs(b.left - a.left) : track.clientWidth;
  };
  const update = () => {
    const fits = max() <= 1;
    root.toggleAttribute('data-slider-fits', fits);
    if (prev) prev.disabled = pos() <= 1;
    if (next) next.disabled = pos() >= max() - 1;
    // one dot per position the row can stop at (cards − cards in view + 1); the active one = the card at the start edge
    if (dots.length) {
      const stops = Math.min(dots.length, Math.round(max() / (step() || 1)) + 1);
      dots.forEach((d, i) => (d.hidden = i >= stops));
      setActive(Math.min(stops - 1, Math.round(pos() / (step() || 1))));
    }
  };
  const move = (dir: 1 | -1) => track.scrollBy({ left: dir * step() * (isRtl(track) ? -1 : 1), behavior: behavior() });
  prev?.addEventListener('click', () => move(-1));
  next?.addEventListener('click', () => move(1));

  const setActive = (i: number) =>
    dots.forEach((d, j) => {
      d.classList.toggle('is-active', j === i);
      d.setAttribute('aria-current', j === i ? 'true' : 'false');
    });
  if (dots.length) {
    dots.forEach((d, i) =>
      d.addEventListener('click', () => {
        // scroll the track only (never the page): card i's distance from the first one
        const off = Math.abs(cards[i].getBoundingClientRect().left - cards[0].getBoundingClientRect().left);
        track.scrollBy({ left: (off - pos()) * (isRtl(track) ? -1 : 1), behavior: behavior() });
      }),
    );
    setActive(0);
  }
  let raf = 0;
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  };
  track.addEventListener('scroll', onScroll, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(track);
  update();
  const stopAuto = root.hasAttribute('data-slider-autoplay') ? autoplay(root, track, () => {
    if (max() <= 1) return;
    if (pos() >= max() - 1) track.scrollBy({ left: -pos() * (isRtl(track) ? -1 : 1), behavior: behavior() });
    else move(1);
  }) : null;
  cleanups.push(() => {
    ro.disconnect();
    cancelAnimationFrame(raf);
    stopAuto?.();
  });
}

/** The auto-advance timer: `advance` every --motion-reviews-hold while nothing holds it; returns the remover. */
function autoplay(root: HTMLElement, track: HTMLElement, advance: () => void): () => void {
  const hold = motionToken('reviews-hold');
  if (!hold || reducedMotion()) {
    root.setAttribute('data-slider-auto', 'off');
    return () => {};
  }
  const holds = { hover: false, touch: false, focus: false, offscreen: true, hidden: document.hidden };
  let timer = 0;
  const held = () => Object.values(holds).some(Boolean);
  const arm = () => {
    clearTimeout(timer);
    timer = 0;
    root.setAttribute('data-slider-auto', held() ? 'paused' : 'running');
    if (!held()) timer = window.setTimeout(tick, hold);
  };
  const tick = () => {
    timer = 0;
    if (held() || reducedMotion()) return arm();
    advance();
    arm();
  };
  const set = (k: keyof typeof holds, v: boolean) => {
    if (holds[k] === v) return;
    holds[k] = v;
    arm();
  };
  const ac = new AbortController();
  const o = { signal: ac.signal, passive: true } as const;
  // the mouse only (a tap fires emulated enter events with no leave)
  root.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && set('hover', true), o);
  root.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && set('hover', false), o);
  root.addEventListener('touchstart', () => set('touch', true), o);
  // a finger lifted: the swipe's own scroll settles first, then the count starts again
  const release = () => set('touch', false);
  root.addEventListener('touchend', release, o);
  root.addEventListener('touchcancel', release, o);
  // the focus on a card (its link), or on an arrow / a dot reached by keyboard — not the focus a mouse press leaves on an
  // arrow (that press already restarts the count)
  const focusHolds = (el: EventTarget | null) =>
    el instanceof Element && root.contains(el) && (track.contains(el) || el.matches(':focus-visible'));
  root.addEventListener('focusin', (e) => set('focus', focusHolds(e.target)), o);
  root.addEventListener('focusout', (e) => set('focus', focusHolds(e.relatedTarget)), o);
  // a press of an arrow or a dot: the count restarts from zero
  root.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-slider-prev], [data-slider-next], [data-slider-dots] button')) arm();
  }, o);
  document.addEventListener('visibilitychange', () => set('hidden', document.hidden), o);
  const io = new IntersectionObserver(([en]) => set('offscreen', !en.isIntersecting), { threshold: 0.35 });
  io.observe(track);
  arm();
  return () => {
    clearTimeout(timer);
    ac.abort();
    io.disconnect();
  };
}

onPageLeave(() => {
  cleanups.forEach((f) => f());
  cleanups.length = 0;
});
onPageLoad(() => document.querySelectorAll<HTMLElement>('[data-slider]').forEach((root) => bindOnce(root, 'slider-bound') && init(root)));
