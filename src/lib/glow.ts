/**
 * Cursor glow on midnight surfaces (item 9). A 600 px bronze disc at 6 % follows the pointer inside each
 * [data-glow] block with a lerp (0.12 per frame) — transform + opacity only, one rAF loop while the pointer is
 * inside, nothing on touch / coarse pointers or under prefers-reduced-motion.
 */
import { bindOnce, onPageLeave, onPageLoad, reducedMotion } from './client';

const fine = matchMedia('(hover: hover) and (pointer: fine)');
let raf = 0;
const active = new Set<() => void>();

function init(block: HTMLElement): void {
  const glow = block.querySelector<HTMLElement>('.glow');
  if (!glow) return;
  let tx = 0;
  let ty = 0;
  let x = 0;
  let y = 0;
  let inside = false;
  let rect: DOMRect | null = null;
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const tick = () => {
    x += (tx - x) * 0.12;
    y += (ty - y) * 0.12;
    glow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (inside || Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5) raf = requestAnimationFrame(tick);
    else raf = 0;
  };
  const start = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };
  block.addEventListener('pointerenter', (e) => {
    rect = block.getBoundingClientRect();
    x = tx = e.clientX - rect.left;
    y = ty = e.clientY - rect.top;
    inside = true;
    glow.classList.add('is-on');
    start();
  });
  block.addEventListener('pointermove', (e) => {
    if (!rect) rect = block.getBoundingClientRect();
    tx = e.clientX - rect.left;
    ty = e.clientY - rect.top;
    start();
  });
  block.addEventListener('pointerleave', () => {
    inside = false;
    rect = null;
    glow.classList.remove('is-on');
  });
  active.add(stop);
}

onPageLeave(() => {
  active.forEach((stop) => stop());
  active.clear();
});

onPageLoad(() => {
  if (!fine.matches || reducedMotion()) return;
  document.querySelectorAll<HTMLElement>('[data-glow]').forEach((b) => bindOnce(b, 'glow') && init(b));
});
