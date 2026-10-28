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

/** "1.2s" → 1200, "400ms" → 400, "16px" → 16 (the minifier rewrites 1200ms as 1.2s, so units matter). */
export function cssNumber(value: string): number {
  const v = value.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return /\d\s*s$/i.test(v) && !/ms$/i.test(v) ? n * 1000 : n;
}

/** Motion tokens as numbers (ms / px) read from the CSS custom properties, 0 under reduced motion. */
export function motionToken(name: 'fast' | 'base' | 'slow' | 'count' | 'stagger' | 'shift-sm' | 'shift-lg'): number {
  return cssNumber(getComputedStyle(document.documentElement).getPropertyValue(`--motion-${name}`));
}

/**
 * Outside press = a press that starts AND ends outside the given elements (28 Oct 2026, decision B8 — the one rule for
 * every popover, menu, list, picker and drawer that closes on an outside click, site and dashboard). A drag that
 * starts inside (selecting text in a search field, dragging a scrollbar) and ends outside never counts. Pointer
 * events cover mouse, touch and pen; `click` is not used because the browser dispatches it to the common ancestor
 * of the down and up targets. `inside()` is read on every press (the elements may be re-rendered); `active()` lets a
 * closed popover skip the work. Returns the remover; `signal` removes the listeners too.
 */
export function onOutsidePress(
  inside: () => (Element | null | undefined)[],
  handler: (e: PointerEvent) => void,
  opts: { signal?: AbortSignal; active?: () => boolean } = {},
): () => void {
  let downOutside = false;
  const on = () => !opts.active || opts.active();
  const isInside = (t: EventTarget | null) => t instanceof Node && inside().some((el) => el?.contains(t));
  const down = (e: PointerEvent) => {
    downOutside = on() && !isInside(e.target);
  };
  const up = (e: PointerEvent) => {
    const fire = downOutside && on() && !isInside(e.target);
    downOutside = false;
    if (fire) handler(e);
  };
  const cancel = () => {
    downOutside = false;
  };
  const o = { capture: true, signal: opts.signal };
  document.addEventListener('pointerdown', down, o);
  document.addEventListener('pointerup', up, o);
  document.addEventListener('pointercancel', cancel, o);
  return () => {
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', cancel, true);
  };
}
