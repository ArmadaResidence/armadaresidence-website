/**
 * Booking drawer controller (item 11). Intercepts clicks on links to /booking/ (not the success page, not with
 * modifier keys), prefills the drawer's form from the link's query, opens the <dialog> with a slide-in, closes it
 * on Esc / backdrop / close button with the reverse slide, locks page scroll while open, and pushes
 * `booking_drawer_open` to the dataLayer. Without JS the links simply go to /booking/.
 *
 * Fix 23 Oct 2026 (A1): the document-level click listener used to be added inside onPageLoad, i.e. once per
 * client-side navigation, each copy holding the dialog of the page it was created on. After a navigation the
 * oldest listener ran first, called preventDefault() and then showModal() on a dialog that was no longer in the
 * document (InvalidStateError); the current page's listener saw defaultPrevented and returned — so no entry point
 * worked until a full reload. Now the document listener is registered once per full load and resolves the
 * dialog of the current page at click time; per-dialog handlers stay bound to their own element.
 */
import { bindOnce, onPageLeave, onPageLoad, reducedMotion } from './client';

type DL = { dataLayer?: unknown[] };
type Controller = { open: (branch: string | null, room: string | null) => void };

const controllers = new WeakMap<HTMLDialogElement, Controller>();

function isBookingLink(a: HTMLAnchorElement): boolean {
  if (a.target && a.target !== '_self') return false;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin) return false;
  return /\/booking\/$/.test(u.pathname) && !/\/booking\/success\/$/.test(u.pathname);
}

/** The drawer of the page currently in the document (a new element after every client-side navigation). */
function currentDrawer(): { dialog: HTMLDialogElement; ctl: Controller } | null {
  const dialog = document.querySelector<HTMLDialogElement>('[data-booking-drawer]');
  const ctl = dialog && dialog.isConnected ? controllers.get(dialog) : undefined;
  return dialog && ctl ? { dialog, ctl } : null;
}

// Once per full page load (this module runs once; the ClientRouter never re-runs it). Capture phase: runs before
// the ClientRouter's own click handler, which skips links whose default is prevented.
document.addEventListener(
  'click',
  (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
    if (!a || !isBookingLink(a)) return;
    const cur = currentDrawer();
    if (!cur || cur.dialog.contains(a)) return; // no drawer on this page (e.g. /booking/ itself): follow the link
    e.preventDefault();
    const q = new URL(a.href, location.href).searchParams;
    // the mobile menu may be open behind the link
    document.querySelector<HTMLButtonElement>('[data-menu-toggle][aria-expanded="true"]')?.click();
    cur.ctl.open(q.get('branch'), q.get('room'));
  },
  true,
);

onPageLeave(() => {
  document.documentElement.classList.remove('drawer-open');
});

onPageLoad(() => {
  const dialog = document.querySelector<HTMLDialogElement>('[data-booking-drawer]');
  if (!dialog || !bindOnce(dialog)) return;
  const form = dialog.querySelector<HTMLFormElement>('form[data-booking-form]');
  let closing = false;

  const finishClose = () => {
    closing = false;
    if (dialog.open) dialog.close();
    document.documentElement.classList.remove('drawer-open');
  };
  const close = () => {
    if (!dialog.open || closing) return;
    closing = true;
    dialog.classList.remove('is-open');
    if (reducedMotion()) return finishClose();
    const done = (e: TransitionEvent) => {
      if (e.target !== dialog) return;
      dialog.removeEventListener('transitionend', done);
      finishClose();
    };
    dialog.addEventListener('transitionend', done);
    window.setTimeout(() => closing && finishClose(), 700); // safety net if no transition fires
  };
  const open = (branch: string | null, room: string | null) => {
    if (dialog.open || !dialog.isConnected) return;
    form?.dispatchEvent(new CustomEvent('booking:prefill', { detail: { branch, room } }));
    dialog.showModal();
    document.documentElement.classList.add('drawer-open');
    // next frame so the slide-in transition runs from the closed position
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('is-open')));
    dialog.querySelector<HTMLElement>('[data-drawer-close]')?.focus();
    const w = window as unknown as DL;
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event: 'booking_drawer_open', branch: branch || '', room_type: room || '', page_path: location.pathname });
  };
  controllers.set(dialog, { open });

  dialog.querySelector('[data-drawer-close]')?.addEventListener('click', close);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(); // backdrop
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault(); // Esc: run the slide-out, then close
    close();
  });
});
