/**
 * Booking drawer controller (item 11). Intercepts clicks on links to /booking/ (not the success page, not with
 * modifier keys), prefills the drawer's form from the link's query (branch, room, check_in, check_out), opens the
 * <dialog> with a slide-in, closes it on Esc / backdrop / close button with the reverse slide, locks page scroll
 * while open, and pushes `booking_drawer_open` to the dataLayer. Without JS the links simply go to /booking/.
 *
 * Fix 23 Oct 2026 (A1): the document-level click listener used to be added inside onPageLoad, i.e. once per
 * client-side navigation, each copy holding the dialog of the page it was created on. After a navigation the
 * oldest listener ran first, called preventDefault() and then showModal() on a dialog that was no longer in the
 * document (InvalidStateError); the current page's listener saw defaultPrevented and returned — so no entry point
 * worked until a full reload. Now the document listener is registered once per full load and resolves the
 * dialog of the current page at click time; per-dialog handlers stay bound to their own element.
 *
 * 24 Oct 2026: the drawer opens only a form whose script has run (`data-booking-ready`, set last by BookingForm).
 * When the form's script failed to load on the first page, the ClientRouter never retries it (it records every
 * script of the first load as run), so for the rest of the visit the drawer opened an inert form without the
 * branch / room prefill. The link then loads /booking/?… in full instead: fresh scripts, prefilled from the URL.
 */
import { bindOnce, onPageLeave, onPageLoad, reducedMotion } from './client';

type DL = { dataLayer?: unknown[] };
type Prefill = { branch: string | null; room: string | null; check_in: string | null; check_out: string | null };
type Controller = { open: (p: Prefill) => void };

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
    if (!cur.dialog.querySelector('form[data-booking-ready]')) {
      location.assign(a.href); // the form's script is not running: a full load of the booking page, never an inert form
      return;
    }
    const q = new URL(a.href, location.href).searchParams;
    // the mobile menu may be open behind the link
    document.querySelector<HTMLButtonElement>('[data-menu-toggle][aria-expanded="true"]')?.click();
    cur.ctl.open({ branch: q.get('branch'), room: q.get('room'), check_in: q.get('check_in'), check_out: q.get('check_out') });
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
  const open = (p: Prefill) => {
    if (dialog.open || !dialog.isConnected) return;
    form?.dispatchEvent(new CustomEvent('booking:prefill', { detail: p }));
    dialog.showModal();
    document.documentElement.classList.add('drawer-open');
    // next frame so the slide-in transition runs from the closed position
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('is-open')));
    dialog.querySelector<HTMLElement>('[data-drawer-close]')?.focus();
    const w = window as unknown as DL;
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event: 'booking_drawer_open', branch: p.branch || '', room_type: p.room || '', page_path: location.pathname });
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
