/**
 * A manual, swipeable row of cards (7 Nov 2026): the reviews carousel «آراء ضيوفنا» and the branch pages' photo strip.
 * The scrolling is native (overflow-x + scroll-snap, RTL-aware, swipe on touch); this adds the arrows (from 768 px) and,
 * where present, the dots: an arrow moves one card in the reading direction and is disabled at its end; the dots follow
 * the card at the start edge of the row. Nothing moves by itself; with
 * prefers-reduced-motion the arrows and dots jump instead of gliding. When every card fits, the controls are hidden.
 *   [data-slider] > [data-slider-track] (the scroller, its children the cards), [data-slider-prev] / [data-slider-next],
 *   optional [data-slider-dots] with one button per card.
 */
import { bindOnce, isRtl, onPageLeave, onPageLoad, reducedMotion } from './client';

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
  cleanups.push(() => {
    ro.disconnect();
    cancelAnimationFrame(raf);
  });
}

onPageLeave(() => {
  cleanups.forEach((f) => f());
  cleanups.length = 0;
});
onPageLoad(() => document.querySelectorAll<HTMLElement>('[data-slider]').forEach((root) => bindOnce(root, 'slider-bound') && init(root)));
