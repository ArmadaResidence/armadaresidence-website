/**
 * When the booking form and the date picker start (9 Nov 2026, mobile LCP) — imported by Base.astro's script, so these
 * few lines are not requests of their own before the first paint; the code they start is fetched only then.
 *
 * Booking form (BookingForm.astro): the drawer's form is not part of the first view, so it starts once the page has
 * painted (afterPaint, 8 Nov 2026). A booking link pressed before that asks for it at once (`booking:init`, dispatched
 * by drawer.ts, which waits for `booking:ready` while the code arrives). The /booking/ page's own form starts
 * immediately. The form's code is a separate module (src/lib/booking-form.ts) imported when the form starts; a failed
 * load marks the form (`booking:failed`) and the drawer's link falls back to the booking page.
 *
 * Date fields (DateRangeField.astro): the picker's code (src/lib/daterange.ts starts every field outside the booking
 * drawer when it loads) is fetched only where such a field exists — the drawer's own fields start with its form, whose
 * module imports the picker itself.
 */
import { afterPaint, bindOnce, onPageLoad } from './client';

onPageLoad(() => {
  document.querySelectorAll<HTMLFormElement>('form[data-booking-form]').forEach((form) => {
    if (!bindOnce(form)) return;
    const start = () => {
      if (!bindOnce(form, 'booking-init')) return;
      form.setAttribute('data-booking-loading', '');
      import('./booking-form')
        // a task of its own after the module's evaluation, so the two never add up to one long task
        .then((m) => new Promise<void>((r) => setTimeout(r, 0)).then(() => m.startBookingForm(form)))
        .catch(() => form.dispatchEvent(new CustomEvent('booking:failed')))
        .finally(() => form.removeAttribute('data-booking-loading'));
    };
    if (form.closest('[data-booking-drawer]')) {
      form.addEventListener('booking:init', start);
      afterPaint(start);
    } else start();
  });

  const fields = document.querySelectorAll<HTMLElement>('[data-daterange]');
  if ([...fields].some((root) => !root.closest('[data-booking-drawer]'))) void import('./daterange');
});
