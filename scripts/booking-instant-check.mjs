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
//   room page — the «يبدأ من» line is filled from room_from_prices without moving the booking card (CLS 0), stays
//              hidden for a room without a price, and the static HTML carries no price
//   node scripts/booking-instant-check.mjs [BASE_URL]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { pickRange } from './datepicker-helpers.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));

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
  const total = bf === null ? null : room_total + bf + beds;
  const reason = mode.reason ?? (args.p_extra_beds > 0 ? 'extra_beds' : null);
  return {
    ok: true,
    prices: mode.prices !== false,
    instant: mode.prices !== false && !reason && !needsAges,
    reason: mode.prices === false ? 'instant_off' : reason,
    room: { slug: args.p_room, name_ar: 'x', name_en: 'x' },
    ...(mode.prices !== false ? { quote: { nights, count: n, room_total, breakfast: args.p_breakfast || 'without', breakfast_total: bf, needs_ages: needsAges, breakfast_adult: 20, extra_beds: args.p_extra_beds || 0, extra_bed_fee: 50, extra_beds_total: beds, total, currency: 'SAR' } } : {}),
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
  const mode = { prices: true, reason: null, submit: 'confirmed' };
  const rpcCalls = [];
  const submits = [];
  await page.route(/\/rest\/v1\/rpc\/quote_stay/, async (route) => {
    const args = route.request().postDataJSON();
    rpcCalls.push(args);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quoteFor(args, mode)) });
  });
  await page.route(/\/rest\/v1\/rpc\/room_from_prices/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ branch: 'airport-road', room_slug: 'king-room', from_price: 185 }]) }),
  );
  // room availability (phase 2a.1, dashboard «الغرف»): the dashboard turned the Shafa jacuzzi studio OFF and the Airport
  // accessible room ON since the last build — the form must drop the first and offer the second
  const SITE_ROOMS = [
    { branch: 'shafa-road', slug: 'jacuzzi-studio', name_ar: 'استوديو جاكوزي', name_en: 'Jacuzzi Studio', bookable: false, capacity: 2, extra_beds_max: 0 },
    { branch: 'airport-road', slug: 'accessible-room', name_ar: 'غرفة مهيأة لذوي الاحتياجات الخاصة', name_en: 'Accessible Room', bookable: true, capacity: 2, extra_beds_max: 0 },
    { branch: 'airport-road', slug: 'king-room', name_ar: 'غرفة كينج', name_en: 'King Room', bookable: true, capacity: 2, extra_beds_max: 0 },
  ];
  await page.route(/\/rest\/v1\/rpc\/site_room_types/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SITE_ROOMS) }));
  await page.route(/\/functions\/v1\/booking-request/, async (route) => {
    const body = route.request().postDataJSON();
    submits.push(body);
    const ref = `AR-20991231-T${submits.length}`.padEnd(16, 'X').slice(0, 16);
    if (mode.submit === 'price_changed') {
      const q = quoteFor({ p_room: body.room, p_check_in: body.check_in, p_check_out: body.check_out, p_adults: Number(body.adults), p_children: Number(body.children), p_children_ages: body.children_ages?.map(Number), p_extra_beds: Number(body.extra_beds), p_breakfast: body.breakfast }, { prices: true }).quote;
      q.nights = q.nights.map((n) => ({ ...n, price: n.price + 15 }));
      q.room_total += 15 * q.count;
      q.total += 15 * q.count;
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'price_changed', status: 'price_changed', quote: q }) });
    }
    if (mode.submit === 'sold_out') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref, stored: true, status: 'request', reason: 'sold_out', quote: null }) });
    // confirmed at exactly the quoted total (the real server refuses any other): the nightly rate follows it
    const q = quoteFor({ p_room: body.room, p_check_in: body.check_in, p_check_out: body.check_out, p_adults: Number(body.adults), p_children: Number(body.children), p_children_ages: body.children_ages?.map(Number), p_extra_beds: Number(body.extra_beds), p_breakfast: body.breakfast }, { prices: true }).quote;
    const quoted = Number(body.quoted_total);
    if (Number.isFinite(quoted) && quoted > 0) {
      const room = quoted - (q.breakfast_total || 0) - q.extra_beds_total;
      q.nights = q.nights.map((n) => ({ ...n, price: room / q.count }));
      q.room_total = room;
      q.total = quoted;
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ref, stored: true, status: 'confirmed', reason: null, quote: q, is_test: false }) });
  });
  // GTM and wa.me never leave the machine
  await page.route(/googletagmanager\.com|wa\.me/, (route) => route.fulfill({ status: 204, body: '' }));
  // a local build has no PUBLIC_BOOKING_ENDPOINT, so the page carries no Supabase origin and would never call the
  // RPCs: give the built HTML a stub origin (the stubs above catch every request to it). A build with a real origin
  // is left as is — the stubs match the paths whatever the host.
  const STUB = 'https://stub.supabase.invalid';
  await page.route((u) => u.origin === new URL(BASE).origin, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    let body = await res.text();
    body = body
      .replace(/"supabaseUrl":""/g, `"supabaseUrl":"${STUB}"`)
      .replace(/"anonKey":""/g, '"anonKey":"stub-key"')
      .replace(/"endpoint":""/g, `"endpoint":"${STUB}/functions/v1/booking-request"`)
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
  await page.goto(`${BASE}${pre}/booking/?branch=airport-road`, { waitUntil: 'networkidle' });
  await page.waitForSelector('form[data-booking-ready]');
  const form = page.locator('form[data-booking-form]').first();
  const quoteBox = form.locator('[data-quote]');
  check(await quoteBox.isHidden(), `${tag} quote: hidden before dates`);
  await pickRange(page, form, CI, CO);
  await page.waitForTimeout(500);
  check((await quoteBox.isVisible()) && (await form.locator('[data-quote-note]').textContent()) === S.quote.pick_room, `${tag} quote: «أي غرفة متاحة» → pick-room hint, no price`);
  check(rpcCalls.length === 0, `${tag} quote: no RPC without a room type`);
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
  await page.waitForFunction(() => document.querySelector('[data-quote-row="total"] td:nth-child(2)')?.textContent === '—', null, { timeout: 8000 });
  check((await form.locator('[data-submit-label]').textContent()) === S.form.submit, `${tag} ages: no instant without the ages`);
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

  // ── fill the guest and submit: price_changed first, then confirmed ──
  await form.locator('input[name="name"]').fill('تجربة النظام');
  await form.locator('[data-phone-input]').fill('0500000000');
  await form.locator('input[name="email"]').fill('guest@example.com');
  mode.submit = 'price_changed';
  await form.locator('[data-submit]').click();
  await page.waitForFunction(() => !document.querySelector('[data-quote-changed]')?.classList.contains('hidden'), null, { timeout: 10000 });
  check(page.url().includes('/booking/'), `${tag} price_changed: stayed on the form`);
  check(submits.at(-1)?.quoted_total === '370', `${tag} price_changed: quoted_total was sent`, String(submits.at(-1)?.quoted_total));
  check((await totalCell()) === money(400), `${tag} price_changed: new total shown (2 × 200)`, await totalCell());
  check(!(await form.locator('[data-submit]').isDisabled()), `${tag} price_changed: submit enabled again`);
  mode.submit = 'confirmed';
  await form.locator('[data-submit]').click();
  await page.waitForURL(/\/booking\/success\//, { timeout: 15000 });
  check(submits.at(-1)?.quoted_total === '400', `${tag} confirm: the re-quoted total was sent`);
  const url = new URL(page.url());
  check(url.searchParams.get('s') === 'confirmed' && !url.search.includes('guest') && !url.search.includes('0500'), `${tag} confirm: success URL carries the status and no personal data`);
  await page.waitForSelector('[data-breakdown]:not(.hidden)', { timeout: 8000 });
  check((await page.locator('[data-heading]').textContent()) === S.success.confirmed_heading, `${tag} success: confirmed heading`);
  check((await page.locator('[data-rows]').textContent()).includes(money(400)), `${tag} success: breakdown total`);
  const dl = await page.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'booking_confirmed'));
  check(dl.length === 1 && dl[0].value === 400 && dl[0].currency === 'SAR' && dl[0].room_type === 'king-room' && !JSON.stringify(dl[0]).includes('guest@'), `${tag} success: booking_confirmed with value, no personal data`, JSON.stringify(dl[0] ?? null));

  // ── sold out at submit → request page with the reason ──
  mode.submit = 'sold_out';
  await page.goto(`${BASE}${pre}/booking/?branch=airport-road&room=king-room`, { waitUntil: 'networkidle' });
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
  check((await page.locator('[data-fallback]').textContent()) === S.success.fallback_line.replace('{reason}', S.success.sold_out_race), `${tag} fallback: sold-out line on the request page`);
  check((await page.locator('[data-heading]').textContent()) === S.success.heading, `${tag} fallback: request heading`);
  const dl2 = await page.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'booking_request'));
  check(dl2.length === 1 && dl2[0].reason === 'sold_out', `${tag} fallback: booking_request with the reason`);

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
console.log(`${checks} checks in ${Math.round((Date.now() - t0) / 1000)}s`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of [...new Set(fails)]) console.log('  - ' + f);
  process.exit(1);
}
console.log('✓ instant-confirmation checks passed (AR + EN, 1440 + 375; Supabase stubbed)');
