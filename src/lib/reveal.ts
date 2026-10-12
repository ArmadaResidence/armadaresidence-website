/**
 * Scroll reveal controller (item 2). One IntersectionObserver per page load (thresholds 0 and 0.15: reveal at 15 %
 * visibility, or on entry for elements taller than half the viewport), each element revealed once and unobserved.
 * `.reveal` elements reveal themselves; `.reveal-group` elements (data-reveal-stagger) reveal their direct
 * children with `--i` driving the stagger delay in CSS. Under prefers-reduced-motion everything is shown at once.
 */
import { bindOnce, onPageLeave, onPageLoad, reducedMotion } from './client';

let io: IntersectionObserver | null = null;

function show(el: Element): void {
  el.classList.add('is-in');
}

function prepare(el: Element): void {
  if (el.classList.contains('reveal-group')) {
    Array.from(el.children).forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
  }
}

onPageLeave(() => {
  io?.disconnect();
  io = null;
});

onPageLoad(() => {
  const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal, .reveal-group, .reveal-draw')).filter((el) => bindOnce(el, 'reveal'));
  if (!els.length) return;
  els.forEach(prepare);
  if (reducedMotion() || !('IntersectionObserver' in window)) {
    els.forEach(show);
    return;
  }
  // thresholds 0 and 0.15: an element reveals at 15 % visibility, or as soon as it enters when it is taller than
  // half the viewport (it could never reach 15 %). Sizes come from the entry — no layout read of our own.
  io ??= new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        // a fast fling can jump an element from "barely visible" to "above the viewport" in one step: anything
        // that has passed above is shown too, so no block is ever left hidden
        const passed = !e.isIntersecting && e.boundingClientRect.bottom < 0;
        if (!e.isIntersecting && !passed) continue;
        const tall = e.rootBounds ? e.boundingClientRect.height > e.rootBounds.height * 0.5 : false;
        if (e.isIntersecting && e.intersectionRatio < 0.15 && !tall) continue;
        show(e.target);
        obs.unobserve(e.target);
      }
    },
    { threshold: [0, 0.15] },
  );
  els.forEach((el) => io!.observe(el));
});
