/**
 * The sticky WhatsApp button (WhatsAppButton.astro, decision 22 Oct 2026): the `whatsapp_click` event on every open,
 * and the two-branch chooser (Esc, outside press, focus return). Moved out of the component's own script on
 * 9 Nov 2026 (mobile LCP) and imported by Base.astro's script, so it is not a separate request before the first paint.
 */
import { bindOnce, onOutsidePress, onPageLoad } from './client';

/** GTM: one event per WhatsApp open, whatever the page type. */
function track(destination: string) {
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event: 'whatsapp_click', destination, page_path: location.pathname, page_location: location.href });
}

onPageLoad(() => {
  document.querySelectorAll<HTMLAnchorElement>('[data-wa-link]').forEach((a) => {
    if (!bindOnce(a)) return;
    a.addEventListener('click', () => track(a.dataset.waDestination || ''));
  });

  const root = document.querySelector<HTMLElement>('[data-wa-chooser]');
  const btn = root?.querySelector<HTMLButtonElement>('[data-wa-toggle]');
  const panel = root?.querySelector<HTMLElement>('[data-wa-panel]');
  if (!root || !btn || !panel || !bindOnce(root)) return;
  const closeBtn = panel.querySelector<HTMLButtonElement>('[data-wa-close]');
  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
  const open = () => {
    btn.setAttribute('aria-expanded', 'true');
    panel.classList.remove('hidden');
    panel.querySelector<HTMLElement>('a, button')?.focus();
  };
  const close = (refocus = false) => {
    if (!isOpen()) return;
    btn.setAttribute('aria-expanded', 'false');
    panel.classList.add('hidden');
    if (refocus) btn.focus();
  };
  btn.addEventListener('click', () => (isOpen() ? close(true) : open()));
  closeBtn?.addEventListener('click', () => close(true));
  panel.addEventListener('click', (e) => {
    // a choice opens WhatsApp in a new tab; the chooser closes behind it
    if ((e.target as HTMLElement).closest('[data-wa-link]')) close();
  });
  // document-level listeners belong to this page only: aborted when the next page is swapped in, so they never
  // pile up across client-side navigations (same class of bug as the booking drawer, 23 Oct 2026)
  const ac = new AbortController();
  document.addEventListener('astro:before-swap', () => ac.abort(), { once: true });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        close(true);
      }
    },
    { signal: ac.signal },
  );
  // outside tap / click (28 Oct 2026, decision B8): only a press that starts AND ends outside the chooser closes it
  onOutsidePress(() => [root], () => close(), { signal: ac.signal, active: () => root.isConnected && isOpen() });
});
