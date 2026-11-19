/**
 * whatsapp_click on EVERY WhatsApp link of the site (Ahmed, 19 Nov 2026 — DECISIONS.md 2026-11-19 «Tracking for the
 * December campaigns»). One document-level listener (capture phase, click + middle-click) instead of a listener per
 * link, so a link added anywhere — the sticky button and its chooser, a branch or contact page, a venue, an offer, a
 * package on /celebrations/, an article — is counted without its own code:
 *   { event: 'whatsapp_click', destination, page_path, package, page_location }
 * destination: the link's data-wa-destination, else the number it opens — <meta name="armada-wa"> (Base.astro, from
 * content/contact.json and the dining venues): airport-road | shafa-road | sales | cafe; a number the map does not know
 * → 'other'. The map is keyed by waKey(digits) — a short hash, so no page carries a number it does not show (the sales
 * line stays on /offers, /partners and the hall, CLAUDE.md §5). package: the nearest data-wa-package (silver | gold | platinum), else 'none'. No personal data: the
 * prefilled text is never read. The booking form's and the partners form's WhatsApp hand-offs open wa.me with
 * window.open (no link) and push the same event themselves.
 */
type W = Window & { dataLayer?: unknown[] };

let dests: Record<string, string> | null = null;

/** FNV-1a (32 bit, hex) of a number's digits: the meta map's key */
export function waKey(digits: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < digits.length; i++) {
    h ^= digits.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function map(): Record<string, string> {
  if (dests) return dests;
  dests = {};
  const raw = document.querySelector<HTMLMetaElement>('meta[name="armada-wa"]')?.content ?? '';
  for (const pair of raw.split(',')) {
    const [key, dest] = pair.split(':');
    if (key && dest) dests[key] = dest;
  }
  return dests;
}

/** the digits of the number a WhatsApp link opens (wa.me/<digits>, api.whatsapp.com/send?phone=<digits>) */
export function waNumber(href: string): string {
  try {
    const u = new URL(href, location.href);
    if (/(^|\.)wa\.me$/i.test(u.hostname)) return u.pathname.replace(/\D/g, '');
    if (/whatsapp\.com$/i.test(u.hostname)) return (u.searchParams.get('phone') ?? '').replace(/\D/g, '');
  } catch {
    /* not a URL */
  }
  return '';
}

export function isWaHref(href: string): boolean {
  return /^(https?:)?\/\/(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com)\//i.test(href) || href.startsWith('whatsapp:');
}

/** the destination of a number (the meta map) — 'other' when unknown */
export function waDestination(digits: string): string {
  return (digits && map()[waKey(digits)]) || 'other';
}

/** one whatsapp_click (also used by the forms' hand-offs) */
export function pushWhatsAppClick(destination: string, pkg = 'none', extra: Record<string, string> = {}): void {
  const w = window as W;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event: 'whatsapp_click', destination: destination || 'other', page_path: location.pathname, package: pkg || 'none', page_location: location.href, ...extra });
}

function onClick(e: Event): void {
  if (e instanceof MouseEvent && e.type === 'auxclick' && e.button !== 1) return;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (!isWaHref(href)) return;
  const dest = a.dataset.waDestination || waDestination(waNumber(href));
  const pkg = (a.closest('[data-wa-package]') as HTMLElement | null)?.dataset.waPackage || 'none';
  pushWhatsAppClick(dest, pkg);
}

// once per document (an ES module runs once per full load; the listeners on document survive view transitions)
if (typeof document !== 'undefined') {
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('auxclick', onClick, { capture: true });
}
