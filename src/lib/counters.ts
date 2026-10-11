/**
 * Count-up controller (item 6). One IntersectionObserver per page load (threshold 0.5), each strip animated once:
 * every [data-count] inside runs from 0 to its value over --motion-count with an ease-out cubic (rAF, text only —
 * the span has a reserved width so nothing shifts). Reduced motion or no IO → the final values stay as rendered.
 */
import { bindOnce, onPageLeave, onPageLoad, reducedMotion } from './client';

let io: IntersectionObserver | null = null;
let raf = 0;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function run(strip: Element): void {
  const spans = Array.from(strip.querySelectorAll<HTMLElement>('[data-count]'));
  const targets = spans.map((s) => Number(s.dataset.count) || 0);
  const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-count')) || 0;
  if (!dur) return;
  const t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const e = easeOut(p);
    spans.forEach((s, i) => (s.textContent = String(Math.round(targets[i] * e))));
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  spans.forEach((s) => (s.textContent = '0'));
  raf = requestAnimationFrame(tick);
}

onPageLeave(() => {
  io?.disconnect();
  io = null;
  cancelAnimationFrame(raf);
});

onPageLoad(() => {
  const strips = Array.from(document.querySelectorAll('[data-counters]')).filter((el) => bindOnce(el, 'counted'));
  if (!strips.length || reducedMotion() || !('IntersectionObserver' in window)) return;
  io ??= new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        run(e.target);
        obs.unobserve(e.target);
      }
    },
    { threshold: 0.5 },
  );
  strips.forEach((s) => io!.observe(s));
});
