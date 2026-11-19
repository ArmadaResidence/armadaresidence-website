/**
 * The landing's ad click IDs and UTMs, kept first-party for the visit and handed to the ad pixels only after
 * advertising consent (Ahmed, 19 Nov 2026 — DECISIONS.md 2026-11-19 «Tracking for the December campaigns»).
 *
 * Why: a visitor from an ad usually moves on before accepting the banner, and the pixels only read a click ID from
 * the URL of the page they start on. So:
 *   - capture: a page whose URL carries fbclid, ttclid, ScCid, gclid, gbraid, wbraid or a utm_* value writes them to
 *     sessionStorage `armada-ad-click` { ids, utm, t: the landing time, handed: false } — sessionStorage only (gone with
 *     the tab), never a cookie, never sent anywhere by this module. A newer landing replaces it. Not written at all
 *     when the stored choice already denies advertising.
 *   - any choice that denies advertising («الضروري فقط», or «تخصيص» with ads off) deletes it (src/lib/consent.ts).
 *   - hand-off, once, when ad_storage is granted (at «قبول الكل» / «حفظ» on this page, or on a later page whose stored
 *     choice grants ads): the Meta `_fbc` cookie when there is none (fb.1.<landing ms>.<fbclid>, 90 days, the site's
 *     domain), and ttclid / ScCid put back on the current URL (history.replaceState, the router's state kept) when it
 *     no longer carries them — the TikTok and Snap pixels take the click ID from the URL of the page they start on and
 *     store their own first-party cookie. Google keeps url passthrough (src/lib/click-ids.ts).
 * The first-touch source saved with a booking (src/lib/visit.ts) is separate and unchanged.
 */
const KEY = 'armada-ad-click';
const CONSENT_KEY = 'armada-consent';
/** URL parameter (lower case) → the name kept */
const IDS: Record<string, string> = { fbclid: 'fbclid', ttclid: 'ttclid', sccid: 'ScCid', gclid: 'gclid', gbraid: 'gbraid', wbraid: 'wbraid' };
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
/** the pixels that read their click ID from the page URL */
const URL_HANDOFF = ['ttclid', 'ScCid'];
const FBC_DAYS = 90;

export interface AdClick {
  ids: Record<string, string>;
  utm: Record<string, string>;
  t: number;
  handed: boolean;
}

/** the stored banner choice: true / false for advertising, null when there is none */
function storedAds(): boolean | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null') as { ads?: boolean; v?: string; t?: number } | null;
    if (!c || typeof c.t !== 'number') return null;
    const banner = document.querySelector<HTMLElement>('[data-cookie-banner]');
    if (banner?.dataset.version && c.v !== banner.dataset.version) return null;
    const days = Number(banner?.dataset.days || 0);
    if (days && Date.now() - c.t >= days * 864e5) return null;
    return c.ads === true;
  } catch {
    return null;
  }
}

export function readAdClick(): AdClick | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(KEY) || 'null') as AdClick | null;
    return r && typeof r === 'object' && r.ids && r.utm ? r : null;
  } catch {
    return null;
  }
}

function write(r: AdClick): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable: the URL path (click-ids.ts) still carries the IDs */
  }
}

export function clearAdClick(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** the click IDs and UTMs of a query string ({} when none) */
export function parseLanding(search: string): { ids: Record<string, string>; utm: Record<string, string> } {
  const ids: Record<string, string> = {};
  const utm: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) {
    const val = v.trim().slice(0, 500);
    if (!val) continue;
    const id = IDS[k.toLowerCase()];
    if (id) ids[id] = val;
    else if (UTM.includes(k.toLowerCase())) utm[k.toLowerCase()] = val.slice(0, 100);
  }
  return { ids, utm };
}

/** record this page's landing parameters (a newer landing replaces the stored one) */
export function captureAdClick(): void {
  const { ids, utm } = parseLanding(location.search);
  if (!Object.keys(ids).length && !Object.keys(utm).length) return;
  if (storedAds() === false) return;
  // a link decorated before consent (src/lib/click-ids.ts) carries the same click IDs and no UTMs: not a new landing
  const prev = readAdClick();
  if (prev) {
    const newIds = Object.entries(ids).some(([k, v]) => prev.ids[k] !== v);
    const newUtm = Object.entries(utm).some(([k, v]) => prev.utm[k] !== v);
    if (!newIds && !newUtm) return;
  }
  write({ ids, utm, t: Date.now(), handed: false });
}

function hasCookie(name: string): boolean {
  return document.cookie.split(/;\s*/).some((c) => c.startsWith(`${name}=`));
}

/** the cookie domain: the registrable domain on the real site (www included), the host itself elsewhere */
function cookieDomain(): string {
  const h = location.hostname;
  return /(^|\.)armadaresidence\.com$/.test(h) ? '; domain=.armadaresidence.com' : '';
}

/** hand the stored click IDs to the ad pixels — only ever called once advertising consent is granted */
export function handOffAdClick(): void {
  const r = readAdClick();
  if (!r || r.handed) return;
  if (r.ids.fbclid && !hasCookie('_fbc')) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `_fbc=fb.1.${r.t}.${encodeURIComponent(r.ids.fbclid)}; max-age=${FBC_DAYS * 86400}; path=/${cookieDomain()}; SameSite=Lax${secure}`;
  }
  const missing = URL_HANDOFF.filter((k) => r.ids[k] && !new URLSearchParams(location.search).has(k));
  if (missing.length) {
    const u = new URL(location.href);
    for (const k of missing) u.searchParams.set(k, r.ids[k]);
    try {
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch {
      /* history unavailable */
    }
  }
  write({ ...r, handed: true });
}

function onPage(): void {
  captureAdClick();
  if (storedAds() === true) handOffAdClick();
}

// in the browser only: once now, then after each client-side navigation
if (typeof document !== 'undefined') {
  onPage();
  document.addEventListener('astro:page-load', () => onPage());
}
