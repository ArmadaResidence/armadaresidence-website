/**
 * The home page's sections (HomeRooms.astro, HomeOffers.astro) — moved out of the components' own scripts on
 * 9 Nov 2026 (mobile LCP) and imported by the home page's script, so they are not separate requests before the paint.
 */
import { afterPaint, bindOnce, onPageLoad } from './client';

// «غرفنا»: the branch tabs — one pressed at a time; a card shows when its branch matches (or «الكل»)
onPageLoad(() => {
  const group = document.querySelector<HTMLElement>('[data-room-tabs]');
  if (!group || !bindOnce(group, 'room-tabs-bound')) return;
  const cards = [...document.querySelectorAll<HTMLElement>('[data-room-card]')];
  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-room-tab]');
    if (!btn) return;
    const key = btn.dataset.roomTab;
    group.querySelectorAll<HTMLButtonElement>('[data-room-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    for (const c of cards) c.hidden = key !== 'all' && c.dataset.roomCard !== key;
  });
});

// «العروض»: the offer cards sit below the first view — their runtime work (expiry, the from-prices) starts after the
// first paint; src/lib/offers.ts runs its own page-load pass when it arrives
afterPaint(() => void import('./offers'));

// «واتساب» on an offer for both branches opens the page's branch chooser (WhatsAppButton.astro)
onPageLoad(() => {
  document.querySelectorAll<HTMLButtonElement>('[data-wa-open]').forEach((b) => {
    if (b.dataset.waOpenBound) return;
    b.dataset.waOpenBound = '1';
    b.addEventListener('click', () => document.querySelector<HTMLButtonElement>('[data-wa-toggle]')?.click());
  });
});
