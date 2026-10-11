/**
 * Room page bottom bar on phones (item 8). The bar (room name + "request a booking") slides up once the booking
 * card has scrolled out above the viewport and slides away when the card is back in view — one
 * IntersectionObserver on the card, transform only, inert while hidden. The floating WhatsApp button moves up
 * while the bar is shown (body.has-room-bar).
 */
import { bindOnce, onPageLeave, onPageLoad } from './client';

let io: IntersectionObserver | null = null;

onPageLeave(() => {
  io?.disconnect();
  io = null;
  document.body.classList.remove('has-room-bar');
});

onPageLoad(() => {
  const bar = document.querySelector<HTMLElement>('[data-room-bar]');
  const card = document.querySelector<HTMLElement>('[data-book-card]');
  if (!bar || !card || !bindOnce(bar)) return;
  const show = (on: boolean) => {
    bar.classList.toggle('is-on', on);
    bar.toggleAttribute('inert', !on);
    bar.setAttribute('aria-hidden', String(!on));
    document.body.classList.toggle('has-room-bar', on);
  };
  show(false);
  io = new IntersectionObserver(
    ([e]) => {
      // past the card (its bottom is above the viewport) → bar on; card visible or still below → bar off
      show(!e.isIntersecting && e.boundingClientRect.bottom < 0);
    },
    { threshold: 0 },
  );
  io.observe(card);
});
