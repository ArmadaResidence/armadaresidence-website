// Runtime prices + instant confirmation on the site (phase 2a, DECISIONS.md 2026-10-25) — Playwright against a built
// site (local dist/ server or the live site). Supabase is STUBBED: the two price RPCs and the booking endpoint are
// intercepted, so nothing is sent, no price is read from the real project and the check runs with the production
// switches off. What it asserts, AR + EN, 1440 and 375 px:
//   quote    — no price before a room type + both dates; «أي غرفة متاحة» shows the pick-room hint; with a room the
//              breakdown appears (room × nights, breakfast, extra beds, total) and sums correctly; instant badge +
//              «أكّد الحجز» label; a reason badge when the stub says not instant; children + breakfast asks the ages
//              and no total until they are set; switch off (prices:false) → no price, label back to «أرسل الطلب»
//   instant  — submit → quoted_total sent → confirmed → the success page's confirmed variant with the breakdown and
//              a booking_confirmed dataLayer event carrying value + currency
//   fallback — 409 price_changed → new price shown, nothing navigates; sold_out at submit → the request page with
//              the "another guest" line and booking_request (reason)
//   whatsapp — (task 5 A, 28 Oct 2026) the line under the phone field; whatsapp_sent → &wa=1 and the confirmed /
//              request page says the message was sent; a message YCloud refused (whatsapp_sent false, e.g. a stubbed
//              YCloud error) → today's sentence unchanged
//   room page — the «يبدأ من» line is filled from room_from_prices without moving the booking card (CLS 0), stays
//              hidden for a room without a price, and the static HTML carries no price
//   node scripts/booking-instant-check.mjs [BASE_URL]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pickRange } from './datepicker-helpers.mjs';
import { validateBooking } from '../supabase/functions/booking-request/rules.ts';
import { noteTurnstile, stubTurnstile, turnstileProblem } from './turnstile-stub.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const seo = JSON.parse(readFileSync('content/seo.json', 'utf8'));
const club = JSON.parse(readFileSync('content/club.json', 'utf8'));
const cookieVersion = JSON.parse(readFileSync('content/policies.json', 'utf8')).cookie_consent.version;
const sha = (t) => createHash('sha256').update(t).digest('hex');
// «انضم إلى إياب» (9 Nov 2026): the signed invite the booking function returns for a guest who is not a member
const INVITE = `11111111-2222-4333-8444-555555555555.${'a'.repeat(32)}`;

const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const CI = addDays(riyadhToday(), 20);
const CO = addDays(riyadhToday(), 22);

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

// ── children's ages required (27 Nov 2026 — DECISIONS.md «Children's ages required»): rules.ts, no browser ──
{
  const ctx = {
    branches: ['airport-road'],
    rooms: [{ slug: 'king-room', branch: 'airport-road', name: 'King', capacity: 2, extra_beds_max: 0, availability: 'available' }],
    today: CI,
    phone: () => '+966500000000',
  };
  const good = { branch: 'airport-road', room: 'king-room', check_in: CI, check_out: CO, adults: '2', children: '0', extra_beds: '0', breakfast: 'with', name: 'تجربة النظام', phone: '0500000000' };
  const err = (p) => {
    const r = validateBooking({ ...good, ...p }, ctx);
    return r.ok ? 'ok' : r.errors.children_ages ?? `other:${Object.keys(r.errors).join(',')}`;
  };
  check(err({ children: '2' }) === 'required', 'rules: 2 children + breakfast + no ages → required', err({ children: '2' }));
  check(err({ children: '2', children_ages: [] }) === 'required', 'rules: 2 children + breakfast + an empty list → required');
  check(err({ children: '2', children_ages: ['5'] }) === 'required', 'rules: 2 children + one age → required', err({ children: '2', children_ages: ['5'] }));
  check(err({ children: '2', children_ages: ['5', ''] }) === 'required', 'rules: 2 children + one age and an empty select → required');
  check(err({ children: '2', children_ages: ['5', '11'] }) === 'ok', 'rules: 2 children + both ages → ok', err({ children: '2', children_ages: ['5', '11'] }));
  check(err({ children: '2', children_ages: [0, 17] }) === 'ok', 'rules: ages 0 and 17 (numbers) → ok');
  check(err({ children: '2', children_ages: ['5', '18'] }) === 'children_ages', 'rules: an age above 17 → children_ages');
  check(err({ children: '2', children_ages: ['5', 'x'] }) === 'children_ages', 'rules: a non-number age → children_ages');
  check(err({ children: '2', children_ages: ['5', '6', '7'] }) === 'children_ages', 'rules: more ages than children → children_ages');
  check(err({ children: '2', breakfast: 'without' }) === 'ok', 'rules: 2 children + without breakfast + no ages → ok');
  check(err({ children: '0', breakfast: 'with' }) === 'ok', 'rules: no children + breakfast → ok');
  const okd = validateBooking({ ...good, children: '2', children_ages: ['5', '11'] }, ctx);
  check(okd.ok && okd.data.children_ages.join() === '5,11', 'rules: the ages are kept as numbers', JSON.stringify(okd.ok ? okd.data.children_ages : okd.errors));
  const nod = validateBooking({ ...good, children: '2', breakfast: 'without', children_ages: ['5', '11'] }, ctx);
  check(nod.ok && nod.data.children_ages.length === 0, 'rules: without breakfast the ages are dropped');
}

/** quote_stay answer for the stub, from the request body (prices like the seed: king 185, two-bedroom 240). */
function quoteFor(args, mode) {
  const nightly = args.p_room === 'two-bedroom-suite' ? 240 : 185;
  const n = Math.round((Date.parse(args.p_check_out) - Date.parse(args.p_check_in)) / 86400000);
  const nights = Array.from({ length: n }, (_, i) => ({ night: addDays(args.p_check_in, i), price: nightly, label: null }));
  const kids = args.p_children || 0;
  const ages = args.p_children_ages;
  const needsAges = args.p_breakfast === 'with' && kids > 0 && !(Array.isArray(ages) && ages.length === kids);
  const bf = args.p_breakfast === 'with' && !needsAges ? (args.p_adults * 20 + (ages || []).reduce((s, a) => s + (a <= 5 ? 0 : a <= 12 ? 10 : 20), 0)) * n : args.p_breakfast === 'with' ? null : 0;
  const beds = (args.p_extra_beds || 0) * 50 * n;
  const room_total = nightly * n;
  let total = bf === null ? null : room_total + bf + beds;
  // an offer the server applied (2 Nov 2026, «العروض»): 10 % of the room, its name; the total before it stays visible
  const offer = mode.offer && total !== null ? { id: 'o1', slug: 'qa-autumn-stay', title_ar: 'عرض الخريف', title_en: 'Autumn offer', kind: 'percent', promo_code: null, discount: room_total / 10 } : null;
  const base_total = total;
  if (offer) total -= offer.discount;
  const reason = mode.reason ?? (args.p_extra_beds > 0 ? 'extra_beds' : null);
  return {
    ok: true,
    prices: mode.prices !== false,
    instant: mode.prices !== false && !reason && !needsAges,
    reason: mode.prices === false ? 'instant_off' : reason,
    room: { slug: args.p_room, name_ar: 'x', name_en: 'x' },
    ...(mode.prices !== false ? { quote: { nights, count: n, room_total, breakfast: args.p_breakfast || 'without', breakfast_total: bf, needs_ages: needsAges, breakfast_adult: 20, extra_beds: args.p_extra_beds || 0, extra_bed_fee: 50, extra_beds_total: beds, total, currency: 'SAR', base_total, discount: offer ? offer.discount : 0, offer } } : {}),
  };
}

async function run(width, lang) {
  const tag = `${lang}@${width}`;
  const L = lang === 'en' ? 'en' : 'ar';
  const S = ui[L];
  // BASE already carries the Pages sub-path (PRE); only the language prefix is added to it
  const pre = lang === 'en' ? '/en' : '';
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: L === 'ar' ? 'ar-SA' : 'en-US', hasTouch: width < 768, isMobile: width < 768 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`${tag} page error: ${e.message}`));

  // ── stubs ──
  const mode = { prices: true, reason: null, submit: 'confirmed', wa: true, offer: false };
  const rpcCalls = [];
  const submits = [];
  await ctx.route(/\/rest\/v1\/rpc\/quote_stay/, async (route) => {
    const args = route.request().postDataJSON();
    rpcCalls.push(args);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quoteFor(args, mode)) });
  });
  await ctx.route(/\/rest\/v1\/rpc\/room_from_prices/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ branch: 'airport-road', room_slug: 'king-room', from_price: 185 }]) }),
  );
  // room availability (phase 2a.1, dashboard «الغرف»): the dashboard turned the Shafa jacuzzi studio OFF and the Airport
  // accessible room ON since the last build — the form must drop the first and offer the second. The two room types the
  // quote steps use (king-room, two-bedroom-suite) are declared bookable here too, so the check never depends on what
  // «الغرف» holds on the day of the build (24 Nov 2026: the Airport two-bedroom suite was switched off in the dashboard,
  // the build left it out of the form, and three deploys failed on selectOption('two-bedroom-suite') — DECISIONS.md
  // 2026-11-24 «The deploys of 23–24 Nov»). When the build already offers it, the row changes nothing.
  const SITE_ROOMS = [
    { branch: 'airport-road', slug: 'two-bedroom-suite', name_ar: 'جناح بغرفتي نوم وصالة', name_en: 'Two-Bedroom Suite', bookable: true, capacity: 4, extra_beds_max: 1 },
    { branch: 'shafa-road', slug: 'jacuzzi-studio', name_ar: 'استوديو جاكوزي', name_en: 'Jacuzzi Studio', bookable: false, capacity: 2, extra_beds_max: 0 },
    { branch: 'airport-road', slug: 'accessible-room', name_ar: 'غرفة مهيأة لذوي الاحتياجات الخاصة', name_en: 'Accessible Room', bookable: true, capacity: 2, extra_beds_max: 0 },
    { branch: 'airport-road', slug: 'king-room', name_ar: 'غرفة بسرير كينج', name_en: 'King Room', bookable: true, capacity: 2, extra_beds_max: 0 },
  ];
  await ctx.route(/\/rest\/v1\/rpc\/site_room_types/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SITE_ROOMS) }));
  await ctx.route(/\/functions\/v1\/booking-request/, async (route) => {
    const body = route.request().postDataJSON();
    submits.push(body);
    noteTurnstile(body);
    const ref = `AR-20991231-T${submits.length}`.padEnd(16, 'X').slice(0, 16);
    if (mode.submit === 'price_changed') {
      const q = quoteFor({ p_room: body.room, p_check_in: body.check_in, p_check_out: body.check_out, p_adults: Number(body.adults), p_children: Number(body.children), p_children_ages: body.children_ages?.map(Number), p_extra_beds: Number(body.extra_beds), p_breakfast: body.breakfast }, { prices: true }).quote;
      q.nights = q.nights.map((n) => ({ ...n, price: n.price + 15 }));
      q.room_total += 15 * q.count;
      q.total += 15 * q.count;
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'price_changed', status: 'price_changed', quote: q }) });
    }
    // an older page that sends no ages (27 Nov 2026): the server refuses with 422 fields.children_ages, nothing stored
    if (mode.submit === 'ages_422') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'invalid', fields: { children_ages: 'required' } }) });
    if (mode.submit === 'sold_out') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref, stored: true, status: 'request', reason: 'sold_out', quote: null, whatsapp_sent: mode.wa, ...(body.marketing_consent ? {} : { eyab_invite: INVITE }) }) });
    // confirmed at exactly the quoted total (the real server refuses any other): the nightly rate follows it
    const q = quoteFor({ p_room: body.room, p_check_in: body.check_in, p_check_out: body.check_out, p_adults: Number(body.adults), p_children: Number(body.children), p_children_ages: body.children_ages?.map(Number), p_extra_beds: Number(body.extra_beds), p_breakfast: body.breakfast }, { prices: true }).quote;
    const quoted = Number(body.quoted_total);
    if (Number.isFinite(quoted) && quoted > 0) {
      const room = quoted - (q.breakfast_total || 0) - q.extra_beds_total;
      q.nights = q.nights.map((n) => ({ ...n, price: room / q.count }));
      q.room_total = room;
      q.total = quoted;
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref, stored: true, status: 'confirmed', reason: null, quote: q, is_test: false, whatsapp_sent: mode.wa, ...(body.marketing_consent ? {} : { eyab_invite: INVITE }) }) });
  });
  // the club function (the success page's «انضم إلى إياب» card): recorded, never sent
  const clubCalls = [];
  await ctx.route(/\/functions\/v1\/club/, async (route) => {
    const body = route.request().postDataJSON();
    clubCalls.push(body);
    if (body.consent !== true) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'invalid', fields: { consent: 'consent' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  // GTM and wa.me never leave the machine
  await ctx.route(/googletagmanager\.com|wa\.me/, (route) => route.fulfill({ status: 204, body: '' }));
  await stubTurnstile(ctx);
  // a local build has no PUBLIC_BOOKING_ENDPOINT, so the page carries no Supabase origin and would never call the
  // RPCs: give the built HTML a stub origin (the stubs above catch every request to it). A build with a real origin
  // is left as is — the stubs match the paths whatever the host.
  const STUB = 'https://stub.supabase.invalid';
  await ctx.route((u) => u.origin === new URL(BASE).origin, async (route) => {
    // the documents, and the pages the view-transition router fetches (19 Nov 2026: the ad flow navigates in the page)
    const rt = route.request().resourceType();
    if (rt !== 'document' && rt !== 'fetch') return route.continue();
    const res = await route.fetch();
    if (!/text\/html/.test(res.headers()['content-type'] || '')) return route.fulfill({ response: res });
    let body = await res.text();
    body = body
      .replace(/"supabaseUrl":""/g, `"supabaseUrl":"${STUB}"`)
      .replace(/"anonKey":""/g, '"anonKey":"stub-key"')
      .replace(/"endpoint":""/g, `"endpoint":"${STUB}/functions/v1/booking-request"`)
      .replace(/"clubEndpoint":""/g, `"clubEndpoint":"${STUB}/functions/v1/club"`)
      // Astro renders an empty attribute bare: data-supabase-url (no value)
      .replace(/data-supabase-url(?=[\s>])/g, `data-supabase-url="${STUB}"`)
      .replace(/data-supabase-key(?=[\s>])/g, 'data-supabase-key="stub-key"');
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });

  // ── room page: from-price fills without a layout shift; static HTML carries no price ──
  await page.goto(`${BASE}${pre}/airport-road/king-room/`, { waitUntil: 'networkidle' });
  const html = await page.content();
  check(!/\d\s*(?:ريال|ر\.س|SAR)\b/.test(html.replace(/السرير الإضافي 50 ريالًا|Extra bed: SAR 50/g, '')), `${tag} room page: no static price in the HTML`);
  const slot = page.locator('[data-from-price]');
  check((await slot.count()) === 1, `${tag} room page: one from-price slot`);
  const line = page.locator('[data-from-line]');
  await line.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  const lineText = (await line.textContent().catch(() => '')) || '';
  const expectedAmount = L === 'ar' ? '185 ريالًا' : 'SAR 185';
  check(lineText.includes(expectedAmount) && lineText === S.price.from_line.replace('{amount}', expectedAmount), `${tag} room page: from-price line = template with ${expectedAmount}`, lineText);
  const cardTop = await page.locator('[data-book-card]').boundingBox();
  check(!!cardTop, `${tag} room page: booking card present`);
  // a room without a published price keeps the static line
  await page.goto(`${BASE}${pre}/airport-road/twin-room/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check((await page.locator('[data-from-line]').isHidden()) && (await page.locator('[data-from-static]').isVisible()), `${tag} room page: no price → static line stays`);

  // ── booking page: room availability follows the dashboard at runtime ──
  await page.goto(`${BASE}${pre}/booking/?branch=shafa-road&room=jacuzzi-studio`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form[data-booking-ready]');
  {
    const f0 = page.locator('form[data-booking-form]').first();
    await page.waitForFunction(() => !document.querySelector('form[data-booking-form] select[name="room"] option[value="jacuzzi-studio"]'), null, { timeout: 8000 }).catch(() => {});
    check((await f0.locator('select[name="room"] option[value="jacuzzi-studio"]').count()) === 0, `${tag} rooms: a room turned off in the dashboard leaves the form`);
    check((await f0.locator('select[name="room"]').inputValue()) === '', `${tag} rooms: its prefilled selection cleared to «أي غرفة متاحة»`);
    check((await f0.locator('[data-room-note]').textContent()).trim() === S.form.room_cleared, `${tag} rooms: the room-cleared note is shown`);
    const added = f0.locator('select[name="room"] optgroup[data-branch="airport-road"] option[value="accessible-room"]');
    check((await added.count()) === 1 && (await added.textContent()) === (L === 'ar' ? 'غرفة مهيأة لذوي الاحتياجات الخاصة' : 'Accessible Room'), `${tag} rooms: a room turned on since the build is offered under its branch`);
  }
  await page.goto(`${BASE}${pre}/booking/?branch=airport-road&room=accessible-room`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form[data-booking-ready]');
  await page.waitForFunction(() => document.querySelector('form[data-booking-form] select[name="room"]')?.value === 'accessible-room', null, { timeout: 8000 }).catch(() => {});
  check((await page.locator('form[data-booking-form] select[name="room"]').first().inputValue()) === 'accessible-room', `${tag} rooms: a link to the newly offered room preselects it`);

  // ── booking page: quote flow ──
  // an ad landing (11 Nov 2026): ?gclid= on the form's page; advertising consent is granted before the submit below
  await page.goto(`${BASE}${pre}/booking/?branch=airport-road&gclid=qa-granted`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form[data-booking-ready]');
  const form = page.locator('form[data-booking-form]').first();
  const quoteBox = form.locator('[data-quote]');
  check(await quoteBox.isHidden(), `${tag} quote: hidden before dates`);
  await pickRange(page, form, CI, CO);
  await page.waitForTimeout(500);
  check((await quoteBox.isVisible()) && (await form.locator('[data-quote-note]').textContent()) === S.quote.pick_room, `${tag} quote: «أي غرفة متاحة» → pick-room hint, no price`);
  // «أي غرفة متاحة» quotes nothing for the guest; the availability check behind it (no_availability, 19 Nov 2026)
  // asks each room type of the branch by name — never a quote without one
  check(rpcCalls.every((c) => c.p_room), `${tag} quote: no quote without a room type`, JSON.stringify(rpcCalls.map((c) => c.p_room)));
  rpcCalls.length = 0;
  await form.locator('select[name="room"]').selectOption('king-room');
  const breakfast = (f, v) => f.locator(`label:has(input[name="breakfast"][value="${v}"])`).click();
  await breakfast(form, 'without');
  await page.waitForFunction(() => document.querySelector('[data-quote-table]:not(.hidden)'), null, { timeout: 8000 });
  const money = (n) => (L === 'ar' ? `${n} ${n % 100 >= 3 && n % 100 <= 10 ? 'ريالات' : n % 100 === 0 || (n % 100 <= 2 && n > 100) ? 'ريال' : 'ريالًا'}` : `SAR ${n}`);
  const totalCell = () => form.locator('[data-quote-row="total"] td').nth(1).textContent();
  check((await totalCell()) === money(370), `${tag} quote: total = 2 × 185`, await totalCell());
  check((await form.locator('[data-quote-badge]').textContent()) === S.quote.instant_badge, `${tag} quote: instant badge`);
  check((await form.locator('[data-submit-label]').textContent()) === S.quote.submit_instant, `${tag} quote: submit label «أكّد الحجز»`);
  check(await form.locator('[data-quote-pay]').isVisible(), `${tag} quote: pay-at-hotel note`);
  // breakfast with a child → ages asked, no total until set
  await form.locator('input[name="children"]').fill('1');
  await form.locator('input[name="children"]').dispatchEvent('blur');
  await breakfast(form, 'with');
  await page.waitForTimeout(600);
  check(await form.locator('[data-ages]').isVisible(), `${tag} ages: asked with children + breakfast`);
  check((await form.locator('[data-ages] select').count()) === 1, `${tag} ages: one select per child`);
  check((await form.locator('[data-ages-hint]').isVisible()) && (await form.locator('[data-ages-hint]').textContent()) === S.quote.ages_hint, `${tag} ages: the hint says why the ages are needed`);
  check((await form.locator('[data-ages] select').first().evaluate((x) => x.required && (x.getAttribute('aria-describedby') || '').split(' ').every((id) => document.getElementById(id)))), `${tag} ages: the select is required and described by the hint and its error line`);
  await page.waitForFunction(() => document.querySelector('[data-quote-row="total"] td:nth-child(2)')?.textContent === '—', null, { timeout: 8000 });
  check((await form.locator('[data-submit-label]').textContent()) === S.form.submit, `${tag} ages: no instant without the ages`);
  check(await form.locator('[data-quote-badge]').isHidden(), `${tag} ages: no badge (neither instant nor «طلب حجز») while an age is missing`);
  await form.locator('[data-ages] select').first().selectOption('8');
  await page.waitForFunction((t) => document.querySelector('[data-quote-row="total"] td:nth-child(2)')?.textContent === t, money(370 + (40 + 10) * 2), { timeout: 8000 });
  check(true, `${tag} ages: breakfast priced with the child tier (2 × 20 + 10) × 2`);
  check(rpcCalls.at(-1)?.p_children_ages?.[0] === 8, `${tag} ages: sent to quote_stay`);
  // back to a simple instant stay
  await breakfast(form, 'without');
  await form.locator('input[name="children"]').fill('0');
  await form.locator('input[name="children"]').dispatchEvent('blur');
  await page.waitForFunction((t) => document.querySelector('[data-quote-row="total"] td:nth-child(2)')?.textContent === t, money(370), { timeout: 8000 });
  check(await form.locator('[data-ages]').isHidden(), `${tag} ages: hidden again without breakfast`);
  // extra bed → request with the reason
  await form.locator('select[name="room"]').selectOption('two-bedroom-suite');
  await form.locator('input[name="extra_beds"]').fill('1');
  await form.locator('input[name="extra_beds"]').dispatchEvent('blur');
  await page.waitForFunction((t) => document.querySelector('[data-quote-badge]')?.textContent?.includes(t), S.quote.reasons.extra_beds, { timeout: 8000 });
  check((await totalCell()) === money(480 + 100), `${tag} quote: extra bed priced (2 × 240 + 2 × 50)`, await totalCell());
  check((await form.locator('[data-submit-label]').textContent()) === S.form.submit, `${tag} quote: request label with a reason`);
  await form.locator('input[name="extra_beds"]').fill('0');
  await form.locator('input[name="extra_beds"]').dispatchEvent('blur');
  await form.locator('select[name="room"]').selectOption('king-room');
  await page.waitForFunction((t) => { const b = document.querySelector('[data-quote-badge]'); return b && !b.classList.contains('hidden') && b.textContent === t; }, S.quote.instant_badge, { timeout: 8000 });
  // switch off → no price at all
  mode.prices = false;
  await form.locator('select[name="room"]').selectOption('two-bedroom-suite');
  await page.waitForFunction(() => document.querySelector('[data-quote]')?.classList.contains('hidden'), null, { timeout: 8000 });
  check((await form.locator('[data-submit-label]').textContent()) === S.form.submit, `${tag} quote: switch off → no price, request label`);
  mode.prices = true;
  await form.locator('select[name="room"]').selectOption('king-room');
  await page.waitForFunction((t) => { const b = document.querySelector('[data-quote-badge]'); return b && !b.classList.contains('hidden') && b.textContent === t; }, S.quote.instant_badge, { timeout: 8000 });

  // ── an offer applied by the server: its name and discount, the total before it struck through ──
  mode.offer = true;
  await form.locator('select[name="room"]').selectOption('two-bedroom-suite');
  await page.waitForFunction(() => !document.querySelector('[data-quote-row="discount"]')?.classList.contains('hidden'), null, { timeout: 8000 });
  {
    const cells = await form.locator('[data-quote-row="discount"] td').allTextContents();
    check(cells[0] === S.quote.offer_line.replace('{title}', L === 'ar' ? 'عرض الخريف' : 'Autumn offer') && cells[1] === `− ${money(48)}`, `${tag} offer: the line names the offer and its discount`, cells.join(' | '));
    const was = await form.locator('[data-quote-row="total"] td').nth(1).locator('s').textContent().catch(() => '');
    check(was === money(480) && (await totalCell()).endsWith(money(432)), `${tag} offer: the total before the offer struck through next to the offer total`, `${was} / ${await totalCell()}`);
  }
  mode.offer = false;
  await form.locator('select[name="room"]').selectOption('king-room');
  await page.waitForFunction(() => document.querySelector('[data-quote-row="discount"]')?.classList.contains('hidden'), null, { timeout: 8000 });
  await page.waitForFunction((t) => document.querySelector('[data-quote-row="total"] td:nth-child(2)')?.textContent === t, money(370), { timeout: 8000 });
  check((await form.locator('[data-quote-row="total"] s').count()) === 0, `${tag} offer: no struck-through total without an offer`);

  // ── fill the guest and submit: price_changed first, then confirmed ──
  const hint = (await form.locator('[data-phone-input]').evaluate((i) => (i.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' | '))) || '';
  check(hint.includes(S.form.phone_hint), `${tag} whatsapp: the line under the phone field`, hint);
  await form.locator('input[name="name"]').fill('تجربة النظام');
  await form.locator('[data-phone-input]').fill('0500000000');
  await form.locator('input[name="email"]').fill('guest@example.com');
  // the marketing consent (3 Nov 2026): one optional box, unticked, labelled; not sent as a consent until ticked
  const mc = form.locator('[data-marketing-consent]');
  check((await mc.count()) === 1 && !(await mc.isChecked()), `${tag} consent: the marketing box exists and is unticked`);
  check((await mc.evaluate((i) => i.labels?.[0]?.textContent?.trim() ?? '')) === club.consent[L], `${tag} consent: its label is the approved text`);
  check((await form.locator('[data-consent-details]').textContent())?.trim() === club.consent[`link_${L}`] && ((await form.locator('[data-consent-details]').getAttribute('href')) || '').endsWith('/policies/#club'), `${tag} consent: «${club.consent[`link_${L}`]}» links the privacy section`);
  mode.submit = 'price_changed';
  await form.locator('[data-submit]').click();
  await page.waitForFunction(() => !document.querySelector('[data-quote-changed]')?.classList.contains('hidden'), null, { timeout: 10000 });
  check(page.url().includes('/booking/'), `${tag} price_changed: stayed on the form`);
  check(submits.at(-1)?.quoted_total === '370', `${tag} price_changed: quoted_total was sent`, String(submits.at(-1)?.quoted_total));
  check(submits.at(-1)?.marketing_consent === false && !('consent_version' in submits.at(-1)), `${tag} consent: unticked → marketing_consent false, no version`, JSON.stringify({ m: submits.at(-1)?.marketing_consent, v: submits.at(-1)?.consent_version }));
  check((await totalCell()) === money(400), `${tag} price_changed: new total shown (2 × 200)`, await totalCell());
  check(!(await form.locator('[data-submit]').isDisabled()), `${tag} price_changed: submit enabled again`);
  mode.submit = 'confirmed';
  // advertising consent granted (a stored «قبول الكل»): the conversion carries the HASHED email / phone (9 Nov 2026)
  await page.evaluate((v) => {
    localStorage.setItem('armada-consent', JSON.stringify({ v, t: Date.now(), analytics: true, ads: true }));
    window.gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
  }, cookieVersion);
  // ticked from the keyboard
  await mc.focus();
  await page.keyboard.press('Space');
  check(await mc.isChecked(), `${tag} consent: Space ticks the box`);
  await form.locator('[data-submit]').click();
  await page.waitForURL(/\/booking\/success\//, { timeout: 15000 });
  check(submits.at(-1)?.quoted_total === '400', `${tag} confirm: the re-quoted total was sent`);
  check(submits.at(-1)?.marketing_consent === true && submits.at(-1)?.consent_version === club.consent.version, `${tag} consent: ticked → marketing_consent true with the text version`);
  check(new URL(page.url()).searchParams.get('mc') === '1' && (await page.locator('[data-eyab-invite]').isHidden()), `${tag} consent: ticked → mc=1, no «انضم إلى إياب» card on the success page`);
  check(!(await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.startsWith('armada_invite_')))), `${tag} invite: ticked → no invite kept for the page`);
  const url = new URL(page.url());
  // ads consent granted: Google's own cookie keeps the click ID — the success URL stays plain (src/lib/click-ids.ts)
  check(!url.searchParams.has('gclid'), `${tag} click ID: ads consent granted → the success URL carries no gclid`, url.search);
  check(url.searchParams.get('s') === 'confirmed' && !url.search.includes('guest') && !url.search.includes('0500'), `${tag} confirm: success URL carries the status and no personal data`);
  await page.waitForSelector('[data-breakdown]:not(.hidden)', { timeout: 8000 });
  check((await page.locator('[data-heading]').textContent()) === S.success.confirmed_heading, `${tag} success: confirmed heading`);
  check((await page.title()) === seo.pages['booking-success'][`title_confirmed_${L}`], `${tag} success: confirmed document title`, await page.title());
  check((await page.locator('[data-rows]').textContent()).includes(money(400)), `${tag} success: breakdown total`);
  const dl = await page.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'booking_confirmed'));
  const confRef = url.searchParams.get('ref');
  check(dl.length === 1 && dl[0].value === 400 && dl[0].currency === 'SAR' && dl[0].room_type === 'king-room' && !JSON.stringify(dl[0]).includes('guest@') && !JSON.stringify(dl[0]).includes('500000000"'), `${tag} success: booking_confirmed with value, no personal data`, JSON.stringify(dl[0] ?? null));
  check(dl[0]?.transaction_id === confRef && dl[0]?.event_id === confRef && typeof dl[0]?.value === 'number' && !('lead_type' in dl[0]), `${tag} success: transaction_id = event_id = the booking ref, value a number`, JSON.stringify(dl[0] ?? null));
  const ud = dl[0]?.user_data ?? {};
  check(ud.email_sha256 === sha('guest@example.com') && ud.phone_sha256 === sha('966500000000') && ud.phone_e164_sha256 === sha('+966500000000') && Object.keys(ud).length === 3, `${tag} success: user_data = the normalised email / phone, SHA-256 (advertising consent granted)`, JSON.stringify(ud));
  // once per booking: a reload of the confirmation page pushes nothing (the one-shot ticket is gone, the ref remembered)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-heading]');
  check((await page.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'booking_confirmed' || e.event === 'booking_request').length)) === 0, `${tag} success: a reload pushes no second booking_confirmed`);
  await page.evaluate(() => localStorage.removeItem('armada-consent'));
  check(url.searchParams.get('wa') === '1', `${tag} whatsapp: accepted → &wa=1 on the success URL`);
  const confSteps = await page.locator('[data-steps]').textContent();
  check(confSteps.includes(S.success.whatsapp_sent_confirmed), `${tag} whatsapp: confirmed page says the confirmation went to WhatsApp`);

  // ── the request page's WhatsApp sentence: accepted (email given) → the new sentence next to the email step ──
  await page.goto(`${BASE}${pre}/booking/success/?ref=AR-20991231-WAOK&branch=airport-road&s=request&c=email&wa=1`, { waitUntil: 'networkidle' });
  const waLi = page.locator('[data-next="whatsapp"]');
  check((await waLi.isVisible()) && (await waLi.textContent()).trim() === S.success.whatsapp_sent_request, `${tag} whatsapp: request page, accepted → «${S.success.whatsapp_sent_request.slice(0, 24)}…»`);
  check(await page.locator('[data-next="email"]').isVisible(), `${tag} whatsapp: request page keeps the email step when an email was given`);
  check((await page.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'booking_request' || e.event === 'booking_confirmed').length)) === 0, `${tag} success: a success URL opened without the booking form's ticket pushes no conversion`);

  // ── sold out at submit → request page with the reason; the WhatsApp message failed (stubbed YCloud error) ──
  mode.submit = 'sold_out';
  mode.wa = false;
  // an ad landing with no consent stored (11 Nov 2026): the click ID must reach the success page — the conversion page
  await page.goto(`${BASE}${pre}/booking/?branch=airport-road&room=king-room&gclid=test`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form[data-booking-ready]');
  const f2 = page.locator('form[data-booking-form]').first();
  await pickRange(page, f2, CI, CO);
  await breakfast(f2, 'without');
  await page.waitForFunction((t) => { const b = document.querySelector('[data-quote-badge]'); return b && !b.classList.contains('hidden') && b.textContent === t; }, S.quote.instant_badge, { timeout: 8000 });
  await f2.locator('input[name="name"]').fill('تجربة النظام');
  await f2.locator('[data-phone-input]').fill('0500000000');
  await f2.locator('[data-submit]').click();
  await page.waitForURL(/\/booking\/success\//, { timeout: 15000 });
  await page.waitForSelector('[data-fallback]:not(.hidden)', { timeout: 8000 });
  {
    const u = new URL(page.url());
    check(u.searchParams.get('gclid') === 'test' && u.searchParams.get('s') === 'request' && u.searchParams.get('ref')?.startsWith('AR-'), `${tag} click ID: consent not granted → the success URL keeps gclid=test (url passthrough)`, u.search);
  }
  check((await page.locator('[data-fallback]').textContent()) === S.success.fallback_line.replace('{reason}', S.success.sold_out_race), `${tag} fallback: sold-out line on the request page`);
  check((await page.locator('[data-heading]').textContent()) === S.success.heading, `${tag} fallback: request heading`);
  check((await page.title()) === seo.pages['booking-success'][`title_${L}`], `${tag} fallback: request keeps today's document title`, await page.title());
  const dl2 = await page.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'booking_request'));
  check(dl2.length === 1 && dl2[0].reason === 'sold_out', `${tag} fallback: booking_request with the reason`);
  check(typeof dl2[0]?.value === 'number' && dl2[0].value > 0 && dl2[0]?.currency === 'SAR' && dl2[0]?.event_id === new URL(page.url()).searchParams.get('ref') && dl2[0]?.lead_type === 'booking_request' && !('user_data' in (dl2[0] ?? {})), `${tag} fallback: booking_request (Lead, lead_type) with the quoted total, SAR, event_id = ref; no user_data without advertising consent`, JSON.stringify(dl2[0] ?? null));
  check(!new URL(page.url()).searchParams.has('wa'), `${tag} whatsapp: not accepted → no &wa on the success URL`);
  check(new URL(page.url()).searchParams.get('mc') === '0' && (await page.locator('[data-eyab-invite]').isVisible()), `${tag} consent: unticked → the «انضم إلى إياب» card on the success page`);
  {
    // the card (9 Nov 2026): the approved copy, the ONE consent, no join without it, then invite-join with the token only
    const I = club[L].invite;
    const card = page.locator('[data-eyab-invite]');
    check((await card.locator('h2').textContent()).trim() === I.title && (await card.locator('p').first().textContent()).trim() === I.text, `${tag} invite: the card's title and text are the approved copy`);
    check((await card.locator('[data-invite-submit] [data-label]').textContent()).trim() === I.button, `${tag} invite: the button «${I.button}»`);
    const box = card.locator('[data-invite-consent]');
    check(!(await box.isChecked()) && (await box.evaluate((i) => i.labels?.[0]?.textContent?.trim() ?? '')) === club.consent[L], `${tag} invite: the consent box is unticked and carries the approved text`);
    check(((await card.locator('[data-consent-details]').getAttribute('href')) || '').endsWith('/policies/#club'), `${tag} invite: the privacy link`);
    check(!new URL(page.url()).search.includes(INVITE.slice(0, 8)), `${tag} invite: the token is not in the URL`);
    const before = clubCalls.length;
    await card.locator('[data-invite-submit]').click();
    await page.waitForTimeout(200);
    check(clubCalls.length === before && (await card.locator('[data-invite-error]').isVisible()) && (await box.getAttribute('aria-invalid')) === 'true', `${tag} invite: without the consent nothing is sent and the error shows`);
    check((await page.evaluate(() => document.activeElement?.hasAttribute('data-invite-consent'))) === true, `${tag} invite: focus moves to the consent box`);
    await box.check();
    await card.locator('[data-invite-submit]').click();
    await page.waitForSelector('[data-invite-done]:not(.hidden)', { timeout: 8000 });
    const sent = clubCalls.at(-1) ?? {};
    check(sent.action === 'invite-join' && sent.token === INVITE && sent.consent === true && sent.consent_version === club.consent.version && sent.lang === L, `${tag} invite: invite-join with the token, the consent and its version`, JSON.stringify(sent));
    check(!('phone' in sent) && !('name' in sent) && !('email' in sent), `${tag} invite: the page sends no personal data (the function reads the booking)`);
    check((await page.locator('[data-invite-done]').textContent()).trim() === I.welcome && (await page.locator('[data-invite-form]').isHidden()), `${tag} invite: «${I.welcome}» replaces the card's form`);
    const cj = await page.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'club_join'));
    check(cj.length === 1 && cj[0].source === 'booking-page' && cj[0].currency === 'SAR' && Object.keys(cj[0]).length === 3, `${tag} invite: dataLayer club_join { source: booking-page, currency } only`, JSON.stringify(cj));
    check(!(await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.startsWith('armada_invite_')))), `${tag} invite: the invite is dropped after joining`);
  }
  check((await page.locator('[data-next="whatsapp"]').textContent()).trim() === S.success.next_whatsapp && (await page.locator('[data-next="whatsapp"]').isVisible()), `${tag} whatsapp: not accepted → today's sentence unchanged`);
  check(!(await page.locator('[data-steps]').textContent()).includes(S.success.whatsapp_sent_request), `${tag} whatsapp: not accepted → no "sent" sentence`);
  // a success page opened without this booking's invite (a member, a reload in another tab): no card
  await page.goto(`${BASE}${pre}/booking/success/?ref=AR-20991231-NOIN&branch=airport-road&s=request&c=email&mc=0`, { waitUntil: 'networkidle' });
  check(await page.locator('[data-eyab-invite]').isHidden(), `${tag} invite: no invite for the booking → no card`);
  // a confirmed booking whose WhatsApp failed: the confirmed steps exactly as before
  await page.goto(`${BASE}${pre}/booking/success/?ref=AR-20991231-WANO&branch=airport-road&s=confirmed`, { waitUntil: 'networkidle' });
  check(!(await page.locator('[data-steps]').textContent()).includes(S.success.whatsapp_sent_confirmed) && (await page.locator('[data-steps] li').count()) === S.success.confirmed_steps.length, `${tag} whatsapp: confirmed, not accepted → steps unchanged`);

  // ── an ad landing → «قبول الكل» → an internal navigation → the language switch → an instant booking (19 Nov 2026 —
  // DECISIONS.md 2026-11-19 «Tracking for the December campaigns»); then a sold-out search (no_availability) ──
  {
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => fails.push(`${tag} ad flow page error: ${e.message}`));
    await p2.addInitScript(() => {
      try { localStorage.setItem('armada-consent-test', '1'); } catch { /* */ }
    });
    const other = lang === 'en' ? '' : '/en';
    const AD = '?utm_source=meta&utm_medium=paid_social&utm_campaign=dec26_bookings_airport&utm_content=qa1&fbclid=FBIQA';
    await p2.goto(`${BASE}${pre}/airport-road/${AD}`, { waitUntil: 'load' });
    await p2.evaluate(() => localStorage.removeItem('armada-consent'));
    await p2.reload({ waitUntil: 'load' });
    check(await p2.locator('[data-cookie-accept]').isVisible(), `${tag} ad flow: the banner on the landing`);
    await p2.click('[data-cookie-accept]');
    const g = await p2.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'consent_granted'));
    check(g.length === 1 && g[0].consent_new === 'analytics,ads', `${tag} ad flow: «قبول الكل» → consent_granted`, JSON.stringify(g));
    await p2.locator('main a[href$="/airport-road/king-room/"]').first().click();
    await p2.waitForURL(/king-room/);
    await p2.waitForTimeout(300);
    const vpv = await p2.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'virtual_page_view').map((e) => e.page_view_id));
    check(JSON.stringify(vpv) === '[2]', `${tag} ad flow: the room page → virtual_page_view { page_view_id: 2 }`, JSON.stringify(vpv));
    await p2.locator(`header a[hreflang="${lang === 'en' ? 'ar' : 'en'}"]`).first().click();
    await p2.waitForURL((u) => u.pathname.startsWith(`${PRE}${other}/airport-road/king-room/`));
    await p2.waitForLoadState('load');
    const visit = await p2.evaluate(() => JSON.parse(sessionStorage.getItem('armada-visit') || 'null'));
    check(visit?.utm_source === 'meta' && visit?.utm_campaign === 'dec26_bookings_airport' && visit?.fbclid === true && visit?.landing === `${PRE}${pre}/airport-road/`, `${tag} ad flow: the first-touch source survives the navigation and the language switch`, JSON.stringify(visit));
    const S2 = ui[lang === 'en' ? 'ar' : 'en'];
    await p2.locator(`main a[href="${PRE}${other}/booking/?branch=airport-road&room=king-room"]`).first().click();
    await p2.waitForSelector('form[data-booking-ready]', { timeout: 10000 });
    const f3 = p2.locator('form[data-booking-form]:visible').first();
    await pickRange(p2, f3, CI, CO);
    await f3.locator('label:has(input[name="breakfast"][value="without"])').click();
    await p2.waitForFunction((t) => [...document.querySelectorAll('[data-quote-badge]')].some((b) => !b.classList.contains('hidden') && b.textContent === t), S2.quote.instant_badge, { timeout: 8000 });
    await f3.locator('input[name="name"]').fill('تجربة النظام');
    await f3.locator('[data-phone-input]').fill('0500000000');
    mode.submit = 'confirmed';
    mode.wa = true;
    await f3.locator('[data-submit]').click();
    await p2.waitForURL(/\/booking\/success\//, { timeout: 15000 });
    const sent = submits.at(-1) ?? {};
    check(sent.visit?.utm_source === 'meta' && sent.visit?.utm_medium === 'paid_social' && sent.visit?.utm_campaign === 'dec26_bookings_airport' && sent.visit?.fbclid === true && !JSON.stringify(sent.visit).includes('FBIQA'), `${tag} ad flow: the booking carries the campaign source (booleans for the click IDs, never the ID)`, JSON.stringify(sent.visit));
    await p2.waitForSelector('[data-heading]');
    const conf = await p2.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'booking_confirmed'));
    check(conf.length === 1 && conf[0].value > 0, `${tag} ad flow: one booking_confirmed on the success page`, JSON.stringify(conf));
    const fbc = (await ctx.cookies()).find((k) => k.name === '_fbc');
    check(!!fbc && fbc.value.endsWith('.FBIQA'), `${tag} ad flow: _fbc kept to the booking`, fbc?.value);
    check(!new URL(p2.url()).searchParams.has('fbclid'), `${tag} ad flow: ads consent granted → the success URL is plain`, p2.url());

    // sold out: the chosen type on a night of the stay, then every type («أي غرفة متاحة»)
    await p2.evaluate(() => localStorage.removeItem('armada-consent'));
    await p2.goto(`${BASE}${pre}/booking/?branch=airport-road&room=king-room`, { waitUntil: 'networkidle' });
    await p2.waitForSelector('form[data-booking-ready]');
    const f4 = p2.locator('form[data-booking-form]').first();
    mode.reason = 'sold_out';
    await pickRange(p2, f4, CI, CO);
    await f4.locator('label:has(input[name="breakfast"][value="without"])').click();
    await p2.waitForFunction((t) => document.querySelector('[data-quote-badge]')?.textContent?.includes(t), S.quote.reasons.sold_out, { timeout: 8000 });
    let na = await p2.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'no_availability'));
    check(na.length === 1 && na[0].property === 'airport-road' && na[0].room_type === 'king-room' && na[0].check_in === CI && na[0].nights === 2 && na[0].utm_source === 'meta' && na[0].utm_campaign === 'dec26_bookings_airport', `${tag} no_availability: the room type sold out → one event`, JSON.stringify(na));
    check(na.every((e) => Object.keys(e).sort().join() === 'check_in,event,nights,property,room_type,utm_campaign,utm_source'), `${tag} no_availability: no personal data`, JSON.stringify(na[0] ?? {}));
    await f4.locator('select[name="room"]').selectOption('');
    await p2.waitForFunction(() => (window.dataLayer || []).filter((e) => e.event === 'no_availability').length >= 2, null, { timeout: 8000 }).catch(() => {});
    na = await p2.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'no_availability'));
    check(na.length === 2 && na[1].room_type === 'any' && na[1].property === 'airport-road', `${tag} no_availability: «أي غرفة متاحة» with every type sold out → room_type any`, JSON.stringify(na));
    mode.reason = null;
    await f4.locator('select[name="room"]').selectOption('king-room');
    await p2.waitForFunction((t) => { const b = document.querySelector('[data-quote-badge]'); return b && !b.classList.contains('hidden') && b.textContent === t; }, S.quote.instant_badge, { timeout: 8000 });
    check((await p2.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'no_availability').length)) === 2, `${tag} no_availability: an available search pushes nothing`);
    await p2.close();
  }

  // ── children's ages required (27 Nov 2026): the submit is blocked on the first empty age; the server's 422 shows on the
  // ages; complete ages → the normal (instant) decision ──
  {
    const p3 = await ctx.newPage();
    p3.on('pageerror', (e) => fails.push(`${tag} ages page error: ${e.message}`));
    await p3.goto(`${BASE}${pre}/booking/?branch=airport-road&room=king-room`, { waitUntil: 'networkidle' });
    await p3.waitForSelector('form[data-booking-ready]');
    const f5 = p3.locator('form[data-booking-form]').first();
    await pickRange(p3, f5, CI, CO);
    await f5.locator('input[name="children"]').fill('2');
    await f5.locator('input[name="children"]').dispatchEvent('blur');
    await f5.locator('label:has(input[name="breakfast"][value="with"])').click();
    await f5.locator('input[name="name"]').fill('تجربة النظام');
    await f5.locator('[data-phone-input]').fill('0500000000');
    await p3.waitForFunction(() => document.querySelectorAll('form[data-booking-form] [data-ages] select').length === 2, null, { timeout: 8000 });
    await p3.waitForFunction(() => document.querySelector('[data-quote-row="total"] td:nth-child(2)')?.textContent === '—', null, { timeout: 8000 });
    check(await f5.locator('[data-quote-badge]').isHidden(), `${tag} ages required: no badge before the ages`);
    const n0 = submits.length;
    await f5.locator('[data-submit]').click();
    await p3.waitForTimeout(400);
    const ageErr = f5.locator('[data-error-for="children_ages"]');
    check(submits.length === n0, `${tag} ages required: nothing sent without the ages`);
    check((await p3.evaluate(() => document.activeElement?.getAttribute('name') === 'children_ages' && document.activeElement?.id.endsWith('-age-0'))), `${tag} ages required: focus on the first empty age`);
    check((await ageErr.isVisible()) && (await ageErr.textContent()) === S.form.errors.children_ages, `${tag} ages required: the inline error`, await ageErr.textContent());
    check((await f5.locator('[data-ages] select[aria-invalid="true"]').count()) === 2, `${tag} ages required: both empty ages marked aria-invalid`);
    await f5.locator('[data-ages] select').first().selectOption('8');
    await f5.locator('[data-submit]').click();
    await p3.waitForTimeout(400);
    check(submits.length === n0 && (await p3.evaluate(() => document.activeElement?.id.endsWith('-age-1'))), `${tag} ages required: one age left → focus on the second, nothing sent`);
    check((await f5.locator('[data-ages] select[aria-invalid="true"]').count()) === 1, `${tag} ages required: only the empty age stays marked`);
    await f5.locator('[data-ages] select').nth(1).selectOption('3');
    await p3.waitForFunction((t) => { const b = document.querySelector('form[data-booking-form] [data-quote-badge]'); return b && !b.classList.contains('hidden') && b.textContent === t; }, S.quote.instant_badge, { timeout: 8000 });
    check(await ageErr.isHidden(), `${tag} ages required: the error clears once every age is chosen`);
    // the server refuses the ages (an older page's request, or a stale form): shown on the ages, nothing navigates
    mode.submit = 'ages_422';
    await f5.locator('[data-submit]').click();
    await p3.waitForFunction(() => !document.querySelector('form[data-booking-form] [data-error-for="children_ages"]')?.classList.contains('hidden'), null, { timeout: 10000 });
    check(p3.url().includes('/booking/') && (await ageErr.textContent()) === S.form.errors.children_ages, `${tag} ages required: the server's 422 shown inline on the ages`);
    check(await p3.evaluate(() => document.activeElement?.getAttribute('name') === 'children_ages'), `${tag} ages required: focus moved to the ages after the 422`);
    check(JSON.stringify(submits.at(-1)?.children_ages) === '["8","3"]', `${tag} ages required: the ages were sent`, JSON.stringify(submits.at(-1)?.children_ages));
    mode.submit = 'confirmed';
    await f5.locator('[data-submit]').click();
    await p3.waitForURL(/\/booking\/success\//, { timeout: 15000 });
    check(new URL(p3.url()).searchParams.get('s') === 'confirmed', `${tag} ages required: complete ages → instant booking`, p3.url());
    await p3.close();
  }

  await browser.close();
}


const t0 = Date.now();
for (const width of [1440, 375]) for (const lang of ['ar', 'en']) {
  try {
    await run(width, lang);
  } catch (e) {
    fails.push(`${lang}@${width} exception: ${e?.stack || e}`);
  }
}
checks++;
if (turnstileProblem()) fails.push(`Turnstile: ${turnstileProblem()}`);
console.log(`${checks} checks in ${Math.round((Date.now() - t0) / 1000)}s`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of [...new Set(fails)]) console.log('  - ' + f);
  process.exit(1);
}
console.log('✓ instant-confirmation checks passed (AR + EN, 1440 + 375; Supabase stubbed)');
