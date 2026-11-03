/**
 * The visit's first-touch source (Ahmed, 3 Nov 2026 — DECISIONS.md 2026-11-03 «Phase 2b session 5», part G), kept in
 * sessionStorage from the first page of the visit until a booking is sent, then stored with the booking
 * (reservations.visit, through submit_booking → internal.clean_visit). No personal data: the utm_* values, whether the
 * landing URL carried a gclid / fbclid / ttclid / ScCid (true / false — never the id), the referrer's domain (another
 * site only) and the landing path (no query string). The first page of the session wins; later pages never overwrite.
 */
export interface Visit {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  gclid: boolean;
  fbclid: boolean;
  ttclid: boolean;
  sccid: boolean;
  referrer?: string;
  landing: string;
}
const KEY = 'armada-visit';

/** record the first touch of this browser session (idempotent: the first page wins) */
export function captureVisit(): void {
  try {
    if (sessionStorage.getItem(KEY)) return;
    const q = new URLSearchParams(location.search);
    const v: Visit = { gclid: q.has('gclid'), fbclid: q.has('fbclid'), ttclid: q.has('ttclid'), sccid: q.has('ScCid') || q.has('sccid'), landing: location.pathname.slice(0, 200) };
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const) {
      const x = (q.get(k) ?? '').trim().slice(0, 100);
      if (x) v[k] = x;
    }
    if (document.referrer) {
      const host = new URL(document.referrer).hostname.toLowerCase();
      if (host && host !== location.hostname.toLowerCase()) v.referrer = host.slice(0, 100);
    }
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: no source */
  }
}
/** the first touch recorded for this session (null when none) */
export function firstTouch(): Visit | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Visit) : null;
  } catch {
    return null;
  }
}
