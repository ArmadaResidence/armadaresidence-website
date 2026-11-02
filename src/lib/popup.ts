/**
 * The offer pop-up in the browser (2 Nov 2026, «العروض»; markup and rules in src/components/OfferPopup.astro).
 * Opens once the delay has passed, only when every rule allows it; a moment when the visitor is busy (the booking
 * drawer, the WhatsApp chooser, another dialog, a focused form field) postpones it — it is never shown over them.
 */
import { onOutsidePress, onPageLoad, reducedMotion } from './client';

interface Config {
  id: string;
  offer: string;
  group: string | null;
  pages: string[];
  starts_at: string | null;
  ends_at: string | null;
  until: string | null;
  frequency: 'visit' | 'days';
  days: number | null;
  delay: number;
  hide_on_mobile: boolean;
}
const SEEN = (id: string) => `armada-popup-${id}`;
const push = (event: string, offer: string) => {
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event, offer_id: offer });
};

/** every rule except «busy»: schedule, offer end, page group, device, frequency */
export function popupAllowed(c: Config, now = Date.now()): boolean {
  if (c.group === 'never') return false;
  if (!c.pages.includes('all') && !(c.group && c.pages.includes(c.group))) return false;
  if (c.starts_at && now < Date.parse(c.starts_at)) return false;
  if (c.ends_at && now >= Date.parse(c.ends_at)) return false;
  if (c.until && new Date(now + 3 * 3600_000).toISOString().slice(0, 10) > c.until) return false;
  if (c.hide_on_mobile && matchMedia('(max-width: 767px)').matches) return false;
  try {
    if (c.frequency === 'visit') return !sessionStorage.getItem(SEEN(c.id));
    const at = Number(localStorage.getItem(SEEN(c.id)) || 0);
    return !at || now - at >= (c.days ?? 1) * 86_400_000;
  } catch {
    return true; // storage unavailable: once per page view at most
  }
}

/** the visitor is in the middle of something: never cover it */
function busy(self: HTMLDialogElement): boolean {
  if (document.documentElement.classList.contains('drawer-open')) return true;
  if (document.querySelector('[data-wa-toggle][aria-expanded="true"]')) return true;
  if (Array.from(document.querySelectorAll('dialog[open]')).some((d) => d !== self)) return true;
  const a = document.activeElement;
  return !!a && a.matches('input, select, textarea, [contenteditable="true"]');
}

/** automated browsers (the check suite, live runs included) never get the pop-up over the page they test — except the
 *  pop-up's own check, which asks for it (localStorage armada-popup-test = 1) */
function automated(): boolean {
  if (!navigator.webdriver) return false;
  try {
    return localStorage.getItem('armada-popup-test') !== '1';
  } catch {
    return true;
  }
}

function init(dialog: HTMLDialogElement) {
  const c = JSON.parse(dialog.querySelector('[data-offer-popup-config]')?.textContent || '{}') as Config;
  if (automated() || !popupAllowed(c)) return;
  let timer = 0;
  let closing = false;
  const markSeen = () => {
    try {
      if (c.frequency === 'visit') sessionStorage.setItem(SEEN(c.id), '1');
      else localStorage.setItem(SEEN(c.id), String(Date.now()));
    } catch {
      /* storage unavailable */
    }
  };
  const close = (event: 'popup_close' | 'popup_click' = 'popup_close') => {
    if (!dialog.open || closing) return;
    closing = true;
    push(event, c.offer);
    dialog.close();
    closing = false;
  };
  const open = () => {
    if (!dialog.isConnected || dialog.open) return;
    if (busy(dialog)) {
      timer = window.setTimeout(open, 2000); // try again once the visitor is free
      return;
    }
    if (!popupAllowed(c)) return;
    const animate = !reducedMotion();
    if (animate) dialog.classList.add('is-entering');
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-offer-popup-close]')?.focus();
    markSeen();
    push('popup_view', c.offer);
    if (animate) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          dialog.classList.add('is-animating');
          dialog.classList.remove('is-entering');
        }),
      );
      dialog.addEventListener('transitionend', () => dialog.classList.remove('is-animating'), { once: true });
    }
  };
  timer = window.setTimeout(open, Math.max(0, c.delay) * 1000);

  const gone = new AbortController();
  dialog.querySelector('[data-offer-popup-close]')?.addEventListener('click', () => close(), { signal: gone.signal });
  dialog.querySelector('[data-offer-popup-cta]')?.addEventListener('click', () => close('popup_click'), { signal: gone.signal });
  // Esc = the close button (the native cancel closes without our event)
  dialog.addEventListener(
    'cancel',
    (e) => {
      e.preventDefault();
      close();
    },
    { signal: gone.signal },
  );
  // a press that starts AND ends on the backdrop closes (the site's one outside-press rule)
  onOutsidePress(() => Array.from(dialog.children), () => close(), { signal: gone.signal, active: () => dialog.open });
  document.addEventListener(
    'astro:before-swap',
    () => {
      window.clearTimeout(timer);
      gone.abort();
      if (dialog.open) dialog.close();
    },
    { once: true },
  );
}

onPageLoad(() => {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-offer-popup]');
  if (dialog && !dialog.hasAttribute('data-bound')) {
    dialog.setAttribute('data-bound', '');
    init(dialog);
  }
});
