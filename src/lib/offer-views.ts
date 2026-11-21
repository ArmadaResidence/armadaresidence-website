/**
 * offer_view once per visit (Ahmed, 21 Nov 2026 — DECISIONS.md 2026-11-21 «offer_view of the bar once per visit»).
 * The announcement bar is on every page, so its offer_view counted page loads, not views. It now goes once per visit
 * per offer AND placement: the key is `<slug>|<placement>`, so the bar's view of an offer never suppresses a card's
 * view of the same offer (the cards keep theirs — src/lib/offers.ts, once per card and page).
 * The visit = the tab's sessionStorage (`armada-offer-views`: the keys only — a slug and a placement, nothing personal);
 * without storage, once per full page load (the module's own set also covers client-side navigations).
 */
const KEY = 'armada-offer-views';
const MAX = 50;
const mem = new Set<string>();

/** true the first time this offer is seen at this placement in this visit (and records it) */
export function firstOfferView(offer: string, placement: string): boolean {
  const k = `${offer}|${placement}`;
  if (mem.has(k)) return false;
  mem.add(k);
  let seen: string[] = [];
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    if (Array.isArray(v)) seen = v.filter((x): x is string => typeof x === 'string');
  } catch {
    /* storage unavailable or unreadable: once per page load */
  }
  if (seen.includes(k)) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...seen, k].slice(-MAX)));
  } catch {
    /* storage unavailable: once per page load */
  }
  return true;
}
