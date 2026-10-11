/**
 * Mobile room carousel dots (item 7). The scrolling itself is native (overflow-x + scroll-snap, RTL-aware); this
 * only keeps the dot indicator in sync: an IntersectionObserver with the scroller as root marks the card that is
 * mostly visible, and a dot click scrolls its card into view. Desktop (grid) never initialises.
 */
import { bindOnce, onPageLeave, onPageLoad, reducedMotion } from './client';

const observers: IntersectionObserver[] = [];
const mq = matchMedia('(max-width: 639px)');

function init(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>('[data-carousel-track]');
  const dotsWrap = root.querySelector<HTMLElement>('[data-carousel-dots]');
  if (!track || !dotsWrap) return;
  const cards = Array.from(track.children) as HTMLElement[];
  const dots = Array.from(dotsWrap.querySelectorAll<HTMLButtonElement>('button'));
  const setActive = (i: number) => {
    dots.forEach((d, j) => {
      d.setAttribute('aria-current', j === i ? 'true' : 'false');
      d.classList.toggle('is-active', j === i);
    });
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(cards.indexOf(e.target as HTMLElement));
      }
    },
    { root: track, threshold: [0.6] },
  );
  cards.forEach((c) => io.observe(c));
  observers.push(io);
  dots.forEach((d, i) =>
    d.addEventListener('click', () => {
      cards[i]?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest', inline: 'start' });
    }),
  );
  setActive(0);
}

onPageLeave(() => {
  observers.forEach((o) => o.disconnect());
  observers.length = 0;
});

onPageLoad(() => {
  if (!mq.matches) return;
  document.querySelectorAll<HTMLElement>('[data-carousel]').forEach((root) => bindOnce(root) && init(root));
});
