/**
 * Ad click IDs (Ahmed, 11 Nov 2026 — DECISIONS.md 2026-11-11 «Ad click IDs»).
 *
 * A visitor who lands from an ad carries the platform's click ID in the URL (?gclid=…, ?fbclid=…). Two things keep it:
 *   1. Base.astro injects the GTM container AT ONCE when the landing URL carries one (CLICK_IDS below, compared
 *      case-insensitively — Snap writes ScCid), instead of 3.5 s after load / the first interaction, so the Conversion
 *      Linker and the pixels read it before the visitor can move on. Every other visit keeps the delay.
 *   2. While advertising consent is not granted (ad_storage denied — no stored choice, or «الضروري فقط»), the click
 *      IDs on the current URL travel with the visitor in the URL only — never in a cookie or in storage: this module
 *      adds them to every same-origin link the visitor follows (pointer-down / click, capture phase, so the decorated
 *      href is what the view-transition router and the browser navigate to) and to the booking form's success URL
 *      (withClickIds, the conversion page). The consent defaults set url_passthrough + ads_data_redaction for Google's
 *      own tags. Once the visitor accepts, Google's tags store the ID as usual and the links stay plain.
 * Nothing here sends anything anywhere.
 */

/** the click IDs that make GTM load at once — lower-case; `_gl` is Google's own linker parameter (url passthrough) */
export const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid', 'ttclid', 'sccid', 'msclkid', '_gl'];
/** carried with them (Google's click source) — never a reason on its own to load GTM early */
const CARRIED = [...CLICK_IDS, 'gclsrc'];

const CONSENT_KEY = 'armada-consent';
const BOUND = 'armadaClickIds';

/** the click-ID parameters of a query string, in their original spelling */
export function clickParams(search: string): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of new URLSearchParams(search)) if (CARRIED.includes(k.toLowerCase()) && v) out.push([k, v]);
  return out;
}

/** advertising consent stored and granted (the banner's choice — src/lib/consent.ts); storage blocked = not granted */
function adsGranted(): boolean {
  try {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null') as { ads?: boolean; v?: string; t?: number } | null;
    const banner = document.querySelector<HTMLElement>('[data-cookie-banner]');
    const days = Number(banner?.dataset.days || 0);
    if (!c || c.ads !== true || typeof c.t !== 'number') return false;
    if (banner?.dataset.version && c.v !== banner.dataset.version) return false;
    return !days || Date.now() - c.t < days * 864e5;
  } catch {
    return false;
  }
}

/** `url` with the current page's click IDs added (those it does not already carry) while ads consent is not granted;
 *  a different origin is left as it is */
export function withClickIds(url: string): string {
  const ids = clickParams(location.search);
  if (!ids.length || adsGranted()) return url;
  let u: URL;
  try {
    u = new URL(url, location.href);
  } catch {
    return url;
  }
  if (u.origin !== location.origin) return url;
  let changed = false;
  for (const [k, v] of ids) {
    if (u.searchParams.has(k)) continue;
    u.searchParams.append(k, v);
    changed = true;
  }
  if (!changed) return url;
  // keep a relative URL relative
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') ? u.href : u.pathname + u.search + u.hash;
}

function decorate(e: Event): void {
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.hasAttribute('download')) return;
  const raw = a.getAttribute('href') || '';
  if (!raw || raw.startsWith('#') || /^(mailto|tel|sms|javascript|whatsapp):/i.test(raw)) return;
  const next = withClickIds(raw);
  if (next !== raw) a.setAttribute('href', next);
}

function init(): void {
  const root = document.documentElement;
  if (root.dataset[BOUND]) return;
  root.dataset[BOUND] = '1';
  // the capture phase on document: before the view-transition router's own click listener reads the href
  for (const type of ['pointerdown', 'click', 'auxclick']) document.addEventListener(type, decorate, { capture: true });
}

// in the browser only (Base.astro also imports CLICK_IDS at build time)
if (typeof document !== 'undefined') {
  init();
  // a view-transition swap replaces the <html> attributes: the listeners stay on document, only the mark is re-set
  document.addEventListener('astro:after-swap', () => (document.documentElement.dataset[BOUND] = '1'));
}
