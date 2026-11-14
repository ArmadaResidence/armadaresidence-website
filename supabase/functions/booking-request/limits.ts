// The per-phone booking limit (4 Nov 2026, Ahmed): ONE rule, read by booking-request (index.ts) and by the Guest Hub's
// inventory adapter (_shared/hub/adapter — the chat's bookings from H8, spec §7.4 «reused, not copied»).
/** bookings per normalised phone (E.164 digits) over 24 h — a guest may try several dates in a day */
export const BOOKING_PHONE_LIMIT = 6;
/** the window of the per-phone and per-email limits */
export const BOOKING_LIMIT_WINDOW_SECONDS = 86400;
