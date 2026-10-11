/**
 * Client-side helpers shared by every component script (view transitions, item 1 — 11 Oct 2026).
 *
 * Hoisted component scripts are ES modules: the browser runs each one once per full page load, and Astro's
 * ClientRouter never re-runs a module that is already on the page. So every script registers an idempotent
 * `init` through `onPageLoad`: it runs now (the module is deferred, the DOM is parsed) and again after each
 * client-side navigation (`astro:page-load`). Elements mark themselves bound with a data attribute so a second
 * pass over the same page is a no-op. Pages without the router (legacy sections) simply get the first run.
 */
export function onPageLoad(init: () => void): void {
  init();
  document.addEventListener('astro:page-load', init);
}

/** Run before the next page is swapped in (clear timers, observers, rAF loops). */
export function onPageLeave(cleanup: () => void): void {
  document.addEventListener('astro:before-swap', cleanup);
}

/** Bind once per element: returns false when `el` was already initialised by an earlier pass. */
export function bindOnce(el: Element, key = 'bound'): boolean {
  const name = `data-${key}`;
  if (el.hasAttribute(name)) return false;
  el.setAttribute(name, '');
  return true;
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isRtl = (el: Element = document.documentElement): boolean => getComputedStyle(el).direction === 'rtl';

/** Motion tokens as numbers (ms / px) read from the CSS custom properties, 0 under reduced motion. */
export function motionToken(name: 'fast' | 'base' | 'slow' | 'stagger' | 'shift-sm' | 'shift-lg'): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`).trim();
  return parseFloat(v) || 0;
}
