/**
 * Offer cards in the browser (2 Nov 2026, «العروض»): the runtime «من {offer} بدل {base} لليلة» line of per-night offers
 * (public.offer_from_prices, publishable key — like room_from_prices: nothing while the branch hides its prices, and
 * the reserved slot stays empty), an offer that ended since the build is hidden, and the dataLayer events offer_view
 * (once per card and page, when half of it is seen) / offer_click — slug, category, placement and the button kind only.
 * The tabs of /offers/ (roving tabindex, arrows follow the reading direction).
 */
import { bindOnce, onPageLoad } from './client';
import { money } from './prices';

type DL = { dataLayer?: unknown[] };
const push = (o: Record<string, unknown>) => {
  const w = window as unknown as DL;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(o);
};
/** Riyadh's date now (YYYY-MM-DD) */
export const riyadhDate = (): string => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

let fromInflight: Promise<Map<string, { base: number; offer: number }>> | null = null;
function offerFromPrices(url: string, key: string): Promise<Map<string, { base: number; offer: number }>> {
  fromInflight ??= fetch(`${url}/rest/v1/rpc/offer_from_prices`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: { slug: string; base_price: number; offer_price: number }[]) => new Map(rows.map((x) => [x.slug, { base: Number(x.base_price), offer: Number(x.offer_price) }])))
    .catch(() => new Map());
  return fromInflight;
}

function initList(list: HTMLElement) {
  const locale = (document.documentElement.lang === 'en' ? 'en' : 'ar') as 'ar' | 'en';
  const today = riyadhDate();
  const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-offer]'));
  // an offer that ended after this page was built leaves at once (the daily build removes it from the HTML)
  for (const c of cards) if (c.dataset.offerUntil && c.dataset.offerUntil < today) c.hidden = true;
  const slots = Array.from(list.querySelectorAll<HTMLElement>('[data-offer-price]'));
  const url = list.dataset.supaUrl || '';
  const key = list.dataset.supaKey || '';
  if (slots.length && url && key) {
    void offerFromPrices(url, key).then((m) => {
      for (const s of slots) {
        const p = m.get(s.dataset.offerPrice || '');
        if (!p || !(p.offer < p.base)) continue;
        const [before, after] = (s.dataset.template || '').split('{offer}');
        const [mid, end] = (after ?? '').split('{base}');
        const strong = document.createElement('span');
        strong.textContent = money(p.offer, locale);
        const was = document.createElement('s');
        was.className = 'font-normal text-ink-muted';
        was.textContent = money(p.base, locale);
        s.replaceChildren(before ?? '', strong, mid ?? '', was, end ?? '');
      }
    });
  }
  const seen = new Set<string>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const c = e.target as HTMLElement;
        io.unobserve(c);
        const k = `${c.dataset.offer}|${c.dataset.offerPlacement}`;
        if (seen.has(k)) continue;
        seen.add(k);
        push({ event: 'offer_view', offer_id: c.dataset.offer, category: c.dataset.offerCategory, placement: c.dataset.offerPlacement });
      }
    },
    { threshold: 0.5 },
  );
  for (const c of cards) if (!c.hidden) io.observe(c);
  document.addEventListener('astro:before-swap', () => io.disconnect(), { once: true });
  list.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-offer-cta]');
    const c = a?.closest<HTMLElement>('[data-offer]');
    if (!a || !c) return;
    push({ event: 'offer_click', offer_id: c.dataset.offer, category: c.dataset.offerCategory, placement: c.dataset.offerPlacement, cta: a.dataset.offerCta });
  });
}

function initTabs(root: HTMLElement) {
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const select = (t: HTMLButtonElement, focus = false) => {
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(x.getAttribute('aria-controls') || '');
      if (panel) panel.hidden = !on;
    }
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const rtl = document.documentElement.dir === 'rtl';
      const next = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
      const prev = e.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
      let j = -1;
      if (next) j = (i + 1) % tabs.length;
      else if (prev) j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      select(tabs[j], true);
    });
  });
  // a link to an offer in the other tab (/offers/#offer-…, the announcement bar) opens that tab
  const fromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    const panel = target?.closest<HTMLElement>('[role="tabpanel"]');
    const tab = panel && tabs.find((t) => t.getAttribute('aria-controls') === panel.id);
    if (tab && target) {
      select(tab);
      target.scrollIntoView({ block: 'start' });
    }
  };
  fromHash();
  window.addEventListener('hashchange', fromHash);
  document.addEventListener('astro:before-swap', () => window.removeEventListener('hashchange', fromHash), { once: true });
}

onPageLoad(() => {
  document.querySelectorAll<HTMLElement>('[data-offer-list]').forEach((l) => bindOnce(l, 'offers-bound') && initList(l));
  document.querySelectorAll<HTMLElement>('[data-offer-tabs]').forEach((t) => bindOnce(t, 'tabs-bound') && initTabs(t));
});
