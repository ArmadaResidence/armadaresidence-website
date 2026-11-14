// Guest Hub — the inventory adapter's contract (14 Nov 2026, session H5; docs/guest-hub/GUEST-HUB-SPEC.md §8.1, §4.2;
// DECISIONS.md 2026-11-14 «Guest Hub H5 — the engine»). OFFLINE and fast (FAST_CHECKS): every implementation runs
// through the same cases — today the dashboard source, on a stubbed RPC shaped like the website's own answers
// (site_room_catalog, room_from_prices, quote_stay): instant, a request with each reason, price changed, sold out on the
// last room, a hidden type, nights without a rate, prices hidden, an error; book() answers not_bookable until H8; the
// per-phone booking limit is booking-request's own (limits.ts), never copied.
//   node scripts/hub-adapter-check.mjs
import { readFileSync } from 'node:fs';
import { dashboardAdapter, quoteResult, BOOKING_LIMIT } from '../supabase/functions/_shared/hub/adapter/index.ts';
import { BOOKING_PHONE_LIMIT, BOOKING_LIMIT_WINDOW_SECONDS } from '../supabase/functions/booking-request/limits.ts';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const CATALOG = [
  { branch: 'airport-road', slug: 'twin-room', on_site: true, name_ar: 'غرفة بسريرين منفصلين', name_en: 'Twin Room', size_m2: 28, bed_ar: 'سريران', bed_en: 'Two beds', capacity: 2, extra_beds_max: 0, sort: 1, bookable: true },
  { branch: 'airport-road', slug: 'one-bedroom-suite', on_site: true, name_ar: 'جناح بغرفة نوم', name_en: 'One-Bedroom Suite', size_m2: 55, bed_ar: 'سرير كبير', bed_en: 'King bed', capacity: 3, extra_beds_max: 1, sort: 2, bookable: true },
  { branch: 'airport-road', slug: 'hidden-type', on_site: false },
  { branch: 'shafa-road', slug: 'double-room', on_site: true, name_ar: 'غرفة مزدوجة', name_en: 'Double Room', size_m2: 24, capacity: 2, extra_beds_max: 1, sort: 1, bookable: true },
];
const FROM = [{ branch: 'airport-road', room_slug: 'twin-room', from_price: 185 }, { branch: 'airport-road', room_slug: 'one-bedroom-suite', from_price: 0 }];
const quote = (o) => ({ ok: true, prices: true, instant: true, reason: null, quote: { nights: [{ night: '2026-12-01', price: 200 }, { night: '2026-12-02', price: 200 }], total: 400, base_total: null, ...o } });
const CASES = {
  instant: quote({}),
  request_closed: { ok: true, prices: true, instant: false, reason: 'closed', quote: { nights: [{ night: '2026-12-01', price: 200 }], total: 200 } },
  request_coord: { ok: true, prices: true, instant: false, reason: 'needs_coordination', quote: { nights: [{ night: '2026-12-01', price: 200 }], total: 200 } },
  offer: quote({ total: 320, base_total: 400, offer: { title_ar: 'عرض الشتاء' } }),
  sold_out: { ok: false, prices: true, instant: false, reason: 'sold_out' },
  no_rate: { ok: true, prices: true, instant: false, reason: 'no_rate', quote: { nights: [], total: 0 } },
  hidden_prices: { ok: true, prices: false, instant: false, reason: null },
};
let calls = [];
const stub = (answer) => async (fn, args) => {
  calls.push([fn, args]);
  if (fn === 'site_room_catalog') return CATALOG;
  if (fn === 'room_from_prices') return FROM;
  if (fn === 'quote_stay') {
    if (answer === 'error') throw new Error('quote_stay 500');
    return CASES[answer];
  }
  throw new Error(`unexpected ${fn}`);
};
const STAY = { branch: 'airport-road', room_type: 'twin-room', check_in: '2026-12-01', check_out: '2026-12-03', adults: 2, children: 0, child_ages: null, extra_beds: 0, breakfast: 'without' };

const implementations = { dashboard: (answer) => dashboardAdapter(stub(answer)) };
for (const [name, make] of Object.entries(implementations)) {
  const a = make('instant');
  check(a.source === name, `${name}: the source`);
  const rooms = await a.roomTypes('airport-road');
  check(rooms.length === 2 && rooms[0].key === 'twin-room' && !rooms.some((r) => r.key === 'hidden-type'), `${name}: roomTypes — the shown types of the branch, in order, never a hidden one`);
  check((await a.roomTypes('shafa-road')).length === 1, `${name}: roomTypes — per branch`);
  check((await a.fromPrice('airport-road', 'twin-room')) === 185, `${name}: fromPrice — the «يبدأ من» rate`);
  check((await a.fromPrice('airport-road', 'one-bedroom-suite')) === null && (await a.fromPrice('shafa-road', 'double-room')) === null, `${name}: fromPrice — none published → null (never a guess)`);
  let r = await make('instant').quote(STAY);
  check(r.kind === 'quote' && r.total === 400 && r.instant && r.reason === null && r.nights.length === 2, `${name}: quote — instant, the total and the nights`);
  r = await make('request_closed').quote(STAY);
  check(r.kind === 'quote' && !r.instant && r.reason === 'closed', `${name}: quote — a request with its reason (closed)`);
  r = await make('request_coord').quote(STAY);
  check(r.kind === 'quote' && !r.instant && r.reason === 'needs_coordination', `${name}: quote — a request with its reason (needs_coordination)`);
  r = await make('offer').quote(STAY);
  check(r.kind === 'quote' && r.total === 320 && r.base_total === 400 && r.offer === 'عرض الشتاء', `${name}: quote — an offer with its base total (the discount rule)`);
  r = await make('sold_out').quote(STAY);
  check(r.kind === 'sold_out', `${name}: quote — sold out on the last room`);
  r = await make('no_rate').quote(STAY);
  check(r.kind === 'not_bookable' && r.reason === 'no_rate', `${name}: quote — nights without a rate → not bookable`);
  r = await make('hidden_prices').quote(STAY);
  check(r.kind === 'not_bookable' && r.reason === 'prices_hidden', `${name}: quote — prices hidden → not bookable (spec §2.5 rule 11)`);
  calls = [];
  r = await make('instant').quote({ ...STAY, room_type: 'hidden-type' });
  check(r.kind === 'not_bookable' && !calls.some((c) => c[0] === 'quote_stay'), `${name}: a hidden type does not exist for the assistant (no quote asked)`);
  r = await make('error').quote(STAY);
  check(r.kind === 'error', `${name}: an RPC error → error (the executor hands off)`);
  calls = [];
  await make('instant').quote({ ...STAY, promo_code: 'WINTER' });
  const args = calls.find((c) => c[0] === 'quote_stay')?.[1] ?? {};
  check(args.p_branch === 'airport-road' && args.p_room === 'twin-room' && args.p_check_in === '2026-12-01' && args.p_breakfast === 'without' && args.p_promo_code === 'WINTER',
    `${name}: quote_stay receives the booking form's parameters`);
  r = await a.book({ id: 'd', version: 1 });
  check(r.kind === 'not_bookable' && r.reason === 'skill_off', `${name}: book — not_bookable until H8`);
  check(typeof a.modify === 'undefined' && typeof a.cancel === 'undefined', `${name}: modify / cancel are not callable by the assistant in v1`);
}
check(quoteResult(null).kind === 'error' && quoteResult({ ok: false, reason: 'not_bookable' }).kind === 'not_bookable', 'quoteResult: nothing → error; a refusal → not_bookable');

// the per-phone booking rule is booking-request's (reused, never copied — spec §7.4)
check(BOOKING_LIMIT.per_phone === BOOKING_PHONE_LIMIT && BOOKING_PHONE_LIMIT === 6 && BOOKING_LIMIT.window_seconds === BOOKING_LIMIT_WINDOW_SECONDS && BOOKING_LIMIT_WINDOW_SECONDS === 86400, 'the per-phone booking limit: 6 in 24 h, from limits.ts');
const BR = read('supabase/functions/booking-request/index.ts');
check(/const PHONE_LIMIT = BOOKING_PHONE_LIMIT;/.test(BR) && /const DAY_SECONDS = BOOKING_LIMIT_WINDOW_SECONDS;/.test(BR) && /from '\.\/limits\.ts'/.test(BR), 'booking-request reads the same rule');
const AD = read('supabase/functions/_shared/hub/adapter/index.ts');
check(/from '\.\.\/\.\.\/\.\.\/booking-request\/limits\.ts'/.test(AD) && !/=\s*6\b/.test(AD), 'the adapter imports the rule, never a typed number');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-adapter-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-adapter-check: ${n} checks passed`);
