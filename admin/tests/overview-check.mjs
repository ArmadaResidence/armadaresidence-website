// Phase 2b session 6 end to end (4 Nov 2026) — «النظرة العامة» and «التقارير» on a PREVIEW BRANCH (refuses the production
// project), with the QA users:
//   - fixtures written with the branch's service role (non-test rows, so they count): two arrivals today, a departure,
//     two requests (one 5 h old needing coordination), a partner enquiry «جديد» 4 h old, a flagged rate override, a room
//     type sold out for the week and one stop-sold tonight;
//   - the landing page after sign-in (admin → /overview; a user without «النظرة العامة» → /bookings);
//   - each card shows what its RPC answers and opens its list already filtered; the alerts for the fixtures with their
//     action links; donut and forward-chart tooltips by hover, tap and keyboard, and their clicks; «عرض كجدول»;
//   - a realtime update after a new booking (the arrivals card changes and glows);
//   - reception: «النظرة العامة» without any money and no «التقارير» (link and route);
//   - «التقارير»: the five sections, the scope note, «Excel» (.xlsx with five right-to-left sheets) and «PDF» (A4
//     landscape, every section); a user without «الأرقام المالية» sees no money;
//   - motion: entry only on the first load (≤ 700 ms), none after a filter change; reduced motion → no animation;
//   - 375 + 1440 × light + dark: no horizontal scroll, axe zero serious / critical, Western digits only.
// Screenshots in screenshots/overview.
//   node admin/tests/overview-check.mjs [BASE_URL=http://127.0.0.1:5173]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (the branch), BOOKING_TEST_TOKEN, LOGIN_CODE_VIA_SERVICE=1
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN = env.BOOKING_TEST_TOKEN;
if (!URL_ || !SERVICE || !TOKEN) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY of the preview branch and BOOKING_TEST_TOKEN are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};
const SHOTS = 'screenshots/overview';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const until = async (f, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await f()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const riyadh = (d = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(Date.now() + d * 86400000));
const T = riyadh(0);
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ARABIC_DIGITS = /[٠-٩۰-۹]/;

// ── fixtures (this branch only) ──
const staff = await rest('staff?select=user_id,role,full_name,branch&active=eq.true');
const byRole = (r) => staff.find((s) => s.role === r);
const setLevel = (u, section, level) => rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${section}`, { method: 'PATCH', body: JSON.stringify({ level }) });
const admin = byRole('admin');
const mgmt = byRole('management');
const recAir = staff.find((x) => x.role === 'reception' && x.branch === 'airport-road') ?? byRole('reception');
for (const u of [admin, mgmt]) for (const s of ['overview', 'reports', 'finance']) await setLevel(u, s, 'view');
for (const [s, l] of [['overview', 'view'], ['reports', 'none'], ['finance', 'none']]) await setLevel(recAir, s, l);
await rest('settings?key=eq.reply_alert_hours', { method: 'PATCH', body: JSON.stringify({ value: 2 }) });

await rest('reservations?id=not.is.null', { method: 'DELETE' });
await rest('partner_enquiries?id=not.is.null', { method: 'DELETE' });
await rest('rate_overrides?sanity_flag=not.is.null', { method: 'DELETE' });
const types = await rest('room_types?select=id,branch,slug,name_ar,sort&active=eq.true&bookable=eq.true&is_test=eq.false&order=branch,sort');
const air = types.filter((t) => t.branch === 'airport-road');
const sha = types.filter((t) => t.branch === 'shafa-road');
if (air.length < 2 || sha.length < 1) throw new Error('the branch needs bookable room types at both branches');
await rest(`inventory_days?night=gte.${riyadh(-40)}&night=lte.${riyadh(20)}`, { method: 'DELETE' });
const inv = [];
for (const t of types) for (let d = -35; d <= 14; d++) inv.push({ room_type_id: t.id, night: riyadh(d), booked: 1, rooms_to_sell: 4, stop_sell: false });
const set = (t, d, booked, left, stop = false) => Object.assign(inv.find((x) => x.room_type_id === t.id && x.night === riyadh(d)), { booked, rooms_to_sell: left, stop_sell: stop });
set(air[0], 0, 3, 2);
for (let d = 0; d <= 6; d++) set(air[1], d, 2, 0); // sold out all week → an inventory alert
set(sha[0], 0, 1, 4, true); // stop-sold tonight → «مغلق»
for (let i = 0; i < inv.length; i += 500) await rest('inventory_days', { method: 'POST', body: JSON.stringify(inv.slice(i, i + 500)) });

const resv = async (ref, t, status, ci, co, createdAt, extra = {}) => {
  const [r] = await rest('reservations', { method: 'POST', body: JSON.stringify({
    ref, status, confirmation: status === 'confirmed' ? 'staff' : null, source: 'website', branch: t.branch, room_type_id: t.id,
    check_in: riyadh(ci), check_out: riyadh(co), adults: 2, children: 0, extra_beds: 0, breakfast: 'without', guest_name: 'ضيف تجربة اللوحة',
    phone: `+9665009${ref.slice(-5).replace(/\D/g, '0').padStart(5, '0')}`, locale: 'ar', is_test: false, created_at: createdAt,
    total: status === 'confirmed' ? 300 * (co - ci) : null, confirmed_at: status === 'confirmed' ? createdAt : null, ...extra,
  }) });
  await rest('reservation_status_history', { method: 'POST', body: JSON.stringify({ reservation_id: r.id, from_status: null, to_status: status, at: createdAt, actor_label: 'website' }) });
  if (status === 'confirmed') {
    const nights = [];
    for (let d = ci; d < co; d++) nights.push({ reservation_id: r.id, night: riyadh(d), room_type_id: t.id, price: 300 });
    await rest('reservation_nights', { method: 'POST', body: JSON.stringify(nights) });
  }
  return r;
};
await resv('AR-29991231-E601', air[0], 'confirmed', 0, 2, ago(20), { visit: { utm_source: 'instagram', utm_campaign: 'winter' } });
await resv('AR-29991231-E602', sha[0], 'confirmed', 0, 1, ago(30), { visit: { gclid: true, landing: '/' } });
await resv('AR-29991231-E603', air[0], 'confirmed', -2, 0, ago(60));
await resv('AR-29991231-E604', air[0], 'request', 5, 6, ago(5), { needs_coordination: true });
await resv('AR-29991231-E605', sha[0], 'request', 5, 6, ago(0.5));
await rest('partner_enquiries', { method: 'POST', body: JSON.stringify({ ref: 'AR-29991231-E6P1', request_type: 'umrah-group', branch: 'both', status: 'new', created_at: ago(4), is_test: false }) });
await rest('rate_overrides', { method: 'POST', body: JSON.stringify({ room_type_id: air[0].id, date_from: riyadh(3), date_to: riyadh(4), price: 10, active: true, sanity_flag: 'below_base' }) });

// ── browser ──
const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, { viewport = { width: 1440, height: 900 }, theme = 'light', reduced = false, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ar', acceptDownloads: true, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: touch, isMobile: touch });
  const codes = [];
  await routeLoginCode(ctx, TOKEN, codes);
  await ctx.addInitScript((t) => { try { if (!sessionStorage.getItem('qa-theme-set')) { localStorage.setItem('armada-theme', t); sessionStorage.setItem('qa-theme-set', '1'); } } catch { /* */ } }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error (${email}): ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  let at = await firstOf(page, { code: '#code', app: '#app-main', backup: '[data-action="generate-backup"]' });
  if (at === 'code') {
    await passCode(page, codes);
    at = await firstOf(page, { app: '#app-main', backup: '[data-action="generate-backup"]' });
  }
  if (at === 'backup') {
    await handleBackupCodes(page);
    await page.waitForSelector('#app-main', { timeout: 30000 });
  }
  await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
  return { ctx, page };
}
/** the RPC as the signed-in user (their own session from the page's storage) */
const userRpc = (page, fn, args) => page.evaluate(async ({ url, fn, args, anon }) => {
  const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
  const s = JSON.parse(localStorage.getItem(k));
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json() };
}, { url: URL_, fn, args, anon: env.SUPABASE_ANON_KEY });
const cardValue = async (page, id) => (await page.locator(`[data-card="${id}"] .text-3xl`).innerText()).trim();
const settle = (page) => page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* */ } }));
async function axe(page, label) {
  await settle(page);
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  check(v.length === 0, `axe zero serious / critical — ${label}`, v.join(' ; '));
}

// ════ admin ════
{
  const { ctx, page } = await login('admin@qa.invalid');
  await page.waitForURL(/\/overview$/, { timeout: 15000 }).catch(() => {});
  check(page.url().endsWith('/overview'), 'admin lands on «النظرة العامة» after sign-in', page.url());
  // motion: the entry runs on the first load only, within the tokens
  const drew = await page.waitForSelector('.is-first .donut-seg', { timeout: 20000 }).then(() => true, () => false);
  const firstState = await page.evaluate(() => ({ name: getComputedStyle(document.querySelector('.donut-seg')).animationName, dur: getComputedStyle(document.querySelector('.donut-seg')).animationDuration }));
  check(drew && firstState.name === 'donut-draw' && firstState.dur === '0.7s', 'first load: the donuts draw in within 700 ms', JSON.stringify(firstState));
  await page.waitForSelector('[data-card="arrivals"] .num', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await settle(page);
  const sub = await page.locator('[data-subtitle]').innerText();
  check(sub.includes('من الحجوزات المسجّلة في اللوحة'), 'the subtitle names the data scope', sub);
  const nav = await page.locator('[data-sidebar] [data-nav-group="overview"] [data-nav]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav')));
  const groupTitle = await page.locator('[data-sidebar] [data-nav-group="overview"] .side-group-title').count();
  check(nav.join(',') === 'overview,reports' && groupTitle === 0, 'sidebar: «النظرة العامة» and «التقارير» first, without a group label', nav.join(','));

  const cards = (await userRpc(page, 'overview_cards', { p_branch: null })).body;
  check(cards.arrivals.total === 2 && (await cardValue(page, 'arrivals')) === '2', 'card «الوصول اليوم» = 2 (the RPC and the page)', JSON.stringify(cards.arrivals));
  check(cards.departures.total === 1 && (await cardValue(page, 'departures')) === '1', 'card «المغادرة اليوم» = 1', JSON.stringify(cards.departures));
  const pctText = await cardValue(page, 'tonight');
  check(pctText.replace('٪', '') === String(Math.round(cards.tonight.pct * 10) / 10).replace(/\.0$/, ''), 'card «المباع من مخزون الليلة» = the RPC', `${pctText} vs ${cards.tonight.pct}`);
  check(cards.pending.total === 3 && (await cardValue(page, 'pending')) === '3', 'card «بانتظار الرد» = 2 requests + 1 partner enquiry', JSON.stringify(cards.pending));
  const line = await page.locator('[data-card="arrivals"] [data-branch-line]').innerText();
  check(line.includes('طريق المطار 1') && line.includes('طريق الشفا 1'), 'each card has a per-branch line', line);

  // alerts
  const alertKinds = await page.locator('[data-alert]').evaluateAll((els) => els.map((e) => e.getAttribute('data-alert')));
  for (const k of ['inventory', 'coordination', 'reply', 'partner', 'rate']) check(alertKinds.includes(k), `alert «${k}» appears for its fixture`, alertKinds.join(','));
  const count = (await page.locator('[data-alert-count]').innerText()).trim();
  check(Number(count) === alertKinds.length, 'the alerts card shows its count', `${count} / ${alertKinds.length}`);
  await page.locator('[data-alert="reply"] [data-alert-link]').first().click();
  await page.waitForURL(/\/bookings\?/, { timeout: 10000 }).catch(() => {});
  check(/ref=AR-29991231-E604/.test(page.url()) || /AR-29991231-E604/.test(await page.locator('aside.drawer').innerText().catch(() => '')), 'the reply alert opens that booking', page.url());
  await page.goto(`${BASE}/overview`);
  await page.waitForSelector('[data-card="arrivals"] .num');

  // each card opens its list, filtered
  await page.click('[data-card-link="arrivals"]');
  await page.waitForURL(/\/bookings\?/);
  check(page.url().includes(`arrive=${T}`) && page.url().includes('status=confirmed'), 'arrivals card → bookings filtered by arrival today', page.url());
  await until(async () => (await page.locator('[data-ref]').count()) === 2, 10000);
  const arrRefs = await page.locator('[data-ref]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ref')).sort());
  check(arrRefs.join(',') === 'AR-29991231-E601,AR-29991231-E602', 'the filtered list holds exactly the two arrivals', arrRefs.join(','));
  check(await page.locator('[data-filter-chip="arrive"]').count() === 1, 'the arrival filter shows as a removable chip');
  await page.goBack();
  await page.click('[data-card-link="departures"]');
  await page.waitForURL(/depart=/);
  await until(async () => (await page.locator('[data-ref]').count()) === 1, 10000);
  check((await page.locator('[data-ref]').first().getAttribute('data-ref')) === 'AR-29991231-E603', 'departures card → the one departure', page.url());
  await page.goBack();
  await page.click('[data-card-link="pending"]');
  await page.waitForURL(/status=request/);
  check(true, 'pending card → booking requests');
  await page.goBack();
  await page.click('[data-card-link="tonight"]');
  await page.waitForURL(/\/inventory\?/);
  check(page.url().includes(`from=${T}`), 'tonight card → the inventory at tonight', page.url());
  await page.goto(`${BASE}/overview`);
  await page.waitForSelector('[data-donut="airport-road"] .donut-seg');
  await page.waitForTimeout(1200);

  // donut tooltip (hover, keyboard) and click
  // a point on the first segment's arc (the ring starts at the top and runs clockwise)
  const pt = await page.locator('[data-donut="airport-road"] .donut-seg').first().evaluate((el) => {
    const svg = el.ownerSVGElement.getBoundingClientRect();
    const len = parseFloat(el.getAttribute('stroke-dasharray'));
    const a = len / 2 / 64;
    const k = svg.width / 180;
    return { x: svg.left + (90 + 64 * Math.sin(a)) * k, y: svg.top + (90 - 64 * Math.cos(a)) * k };
  });
  await page.mouse.move(pt.x, pt.y);
  const dtip = await page.locator('[data-donut="airport-road"] [data-viz-tip]').innerText().catch(() => '');
  check(/محجوز: \d+/.test(dtip), 'donut: hover shows the segment count', dtip);
  await page.locator('[data-donut="airport-road"] .donut-seg').first().focus();
  check(await page.locator('[data-donut="airport-road"] [data-viz-tip]').count() === 1, 'donut: keyboard focus shows the tip');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/inventory\?/, { timeout: 10000 }).catch(() => {});
  check(page.url().includes('branch=airport-road') && page.url().includes(`from=${T}`), 'donut: Enter / click opens the inventory at tonight for that branch', page.url());
  await page.goto(`${BASE}/overview`);
  await page.waitForSelector('[data-chart="forward"] [data-mark]');
  await page.waitForTimeout(1200);

  // forward chart: 14 nights × 2 branches, hover / keyboard tips, Thursday and Friday shaded, click → inventory at that date
  const marks = await page.locator('[data-chart="forward"] [data-mark]').count();
  check(marks === 28, 'forward chart: 14 nights × 2 branches', String(marks));
  const shades = await page.locator('[data-chart="forward"] .viz-shade').count();
  check(shades === 4, 'forward chart: Thursday and Friday nights shaded (4 in 14 nights)', String(shades));
  await page.locator('[data-chart="forward"] [data-mark]').nth(2).hover();
  const ftip = await page.locator('[data-chart="forward"] [data-viz-tip]').innerText().catch(() => '');
  check(/محجوز \d+، متبقٍّ \d+/.test(ftip) || ftip.includes('مغلق'), 'forward chart: hover shows booked and left', ftip);
  await page.locator('[data-chart="forward"] [data-mark]').first().focus();
  const t1 = await page.locator('[data-chart="forward"] [data-viz-tip]').innerText();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const t2 = await page.locator('[data-chart="forward"] [data-viz-tip]').innerText();
  check(t1 !== t2, 'forward chart: arrows move between nights', `${t1} → ${t2}`);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/inventory\?/, { timeout: 10000 }).catch(() => {});
  check(page.url().includes(`from=${riyadh(1)}`), 'forward chart: Enter opens the inventory at that night', page.url());
  await page.goto(`${BASE}/overview`);
  await page.waitForSelector('[data-chart="forward"] [data-mark]');

  // «عرض كجدول»
  await page.click('[data-chart="forward"] [data-action="as-table"]');
  const rows = await page.locator('[data-chart="forward"] [data-viz-table] tbody tr').count();
  check(rows === 14, '«عرض كجدول» shows the same 14 nights', String(rows));
  await page.click('[data-chart="forward"] [data-action="as-table"]');
  const aria = await page.locator('[data-chart="forward"] [data-summary]').getAttribute('aria-label');
  check(!!aria && aria.includes('الأربع عشرة'), 'every chart has an aria-label summary', aria ?? '');
  check(await page.locator('[data-kpi="revenue"]').count() === 1 && await page.locator('[data-kpi="adr"]').count() === 1, 'admin (finance) sees revenue and ADR');
  check(await page.locator('[data-recent-row]').count() === 5, '«آخر الطلبات» lists the 5 fixture bookings', String(await page.locator('[data-recent-row]').count()));
  const recentSrc = await page.locator('[data-recent-row="AR-29991231-E601"] td').nth(3).innerText();
  check(recentSrc.includes('ميتا'), 'the first-touch source shows on «آخر الطلبات»', recentSrc);

  // a filter change moves values only (no entry replay)
  await until(async () => (await page.locator('.is-first').count()) === 0, 5000);
  await page.selectOption('#ov-branch', 'airport-road');
  await until(async () => (await cardValue(page, 'arrivals')) === '1', 8000);
  check(await page.locator('.is-first').count() === 0, 'a filter change does not replay the entry animation');
  check((await cardValue(page, 'arrivals')) === '1', 'branch filter: arrivals at Airport Road = 1', await cardValue(page, 'arrivals'));
  await page.selectOption('#ov-branch', '');
  await page.waitForTimeout(600);

  // realtime: a new booking arriving today
  await page.waitForTimeout(2500);
  await resv('AR-29991231-E606', sha[0], 'confirmed', 0, 2, new Date().toISOString());
  const live = await until(async () => (await cardValue(page, 'arrivals')) === '3', 15000);
  check(live, 'realtime: the arrivals card updates after a new booking', await cardValue(page, 'arrivals'));
  check(await page.locator('[data-card="arrivals"] [data-flash]').count() === 1, 'realtime: the changed number gets a bronze highlight');
  await shot(page, 'overview-admin-1440-light');

  // «التقارير»
  await page.click('[data-sidebar] [data-nav="reports"]');
  await page.waitForURL(/\/reports$/);
  await page.waitForSelector('[data-section="performance"] [data-kpi="pct"]', { timeout: 20000 });
  const secs = await page.locator('[data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  check(secs.join(',') === 'performance,behaviour,sources,cancellations,club', 'reports: the five sections in order', secs.join(','));
  const links = await page.locator('[data-report-links] a').allInnerTexts();
  check(links.join('،') === 'الأداء،سلوك الحجز،المصادر والحملات،الإلغاء والرد،إياب والشركاء', 'reports: the section links', links.join('،'));
  check((await page.locator('[data-scope-note]').innerText()).includes('حجوزات المنصات الأخرى تدخل بعد ربط مدير القنوات'), 'reports: the scope note');
  check(await page.locator('[data-kpi="revenue"]').count() === 1, 'reports: revenue with «الأرقام المالية»');
  check(await page.locator('[data-chart="perf-daily"] .viz-line.is-dashed').count() === 1, 'reports: current (solid) against comparison (dashed)');
  check(await page.locator('text=لم يحضر').count() === 0, 'reports: no no-show card (bookings record none)');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="xlsx"]')]);
  const file = await dl.path();
  const buf = readFileSync(file);
  const txt = buf.toString('utf8');
  const sheetNames = [...txt.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  check(dl.suggestedFilename().endsWith('.xlsx') && buf.slice(0, 2).toString() === 'PK', 'Excel: an .xlsx (ZIP) file', dl.suggestedFilename());
  check(sheetNames.join('،') === 'الأداء،سلوك الحجز،المصادر والحملات،الإلغاء والرد،إياب والشركاء', 'Excel: one sheet per section', sheetNames.join('،'));
  check((txt.match(/rightToLeft="1"/g) || []).length >= 6, 'Excel: right-to-left sheets');
  check(txt.includes('الإيراد'), 'Excel: money columns with «الأرقام المالية»');
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  check(boxes.length >= 5 && boxes.every(([w, h]) => Math.abs(w - 841.9) < 3 && Math.abs(h - 595.3) < 3), 'PDF: A4 landscape, at least one page per section', `${boxes.length} pages ${JSON.stringify(boxes[0])}`);
  await shot(page, 'reports-admin-1440-light');
  await ctx.close();
}

// ════ a user without «الأرقام المالية» (management with finance off) ════
{
  await setLevel(mgmt, 'finance', 'none');
  const { ctx, page } = await login('mgmt@qa.invalid');
  await page.goto(`${BASE}/reports`);
  await page.waitForSelector('[data-section="performance"] [data-kpi="pct"]', { timeout: 20000 });
  check(await page.locator('[data-kpi="revenue"], [data-kpi="adr"]').count() === 0, 'without «الأرقام المالية»: no revenue / ADR card in the reports');
  const body = await page.locator('#app-main').innerText();
  check(!/ريال|ريالًا|ريالات/.test(body), 'without «الأرقام المالية»: no amount anywhere in the reports');
  const perf = (await userRpc(page, 'report_performance', { p_branch: null, p_from: riyadh(-29), p_to: T })).body;
  check(!JSON.stringify(perf).match(/"(revenue|adr)"/), 'without «الأرقام المالية»: the RPC itself withholds the money keys');
  await ctx.close();
  await setLevel(mgmt, 'finance', 'view');
}

// ════ reception ════
{
  const { ctx, page } = await login('rec-air@qa.invalid', { viewport: { width: 375, height: 812 }, touch: true });
  await page.waitForURL(/\/overview$/, { timeout: 15000 }).catch(() => {});
  check(page.url().endsWith('/overview'), 'reception lands on «النظرة العامة»', page.url());
  await page.waitForSelector('[data-card="arrivals"] .num', { timeout: 20000 });
  await page.waitForTimeout(1500);
  check(await page.locator('[data-kpi="revenue"], [data-kpi="adr"], [data-chart="trend-adr"]').count() === 0, 'reception: no money card or ADR chart');
  check(!/ريال|ريالًا|ريالات/.test(await page.locator('#app-main').innerText()), 'reception: no amount anywhere on the overview');
  check(await page.locator('[data-branch-static]').count() >= 1, 'reception: the branch filter is read-only');
  const wide = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, vw: document.documentElement.clientWidth,
    over: [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return (r.right > document.documentElement.clientWidth + 1 || r.left < -1) && r.width > 0 && !e.closest('.overflow-x-auto') && ![...e.children].some((c) => { const q = c.getBoundingClientRect(); return q.right > document.documentElement.clientWidth + 1 || q.left < -1; }); }).slice(0, 6).map((e) => `${e.tagName}.${(e.getAttribute('class') || '').slice(0, 40)}:${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)} ${(e.textContent || '').slice(0, 30)}`) }));
  check(wide.sw <= wide.vw + 1, 'reception 375 (touch): no horizontal overflow', JSON.stringify(wide));
  // tap on a donut segment shows its tip (no navigation on the first tap)
  await page.locator('[data-donut="airport-road"]').scrollIntoViewIfNeeded();
  const tp = await page.locator('[data-donut="airport-road"] .donut-seg').first().evaluate((el) => {
    const svg = el.ownerSVGElement.getBoundingClientRect();
    const a = parseFloat(el.getAttribute('stroke-dasharray')) / 2 / 64;
    const k = svg.width / 180;
    return { x: svg.left + (90 + 64 * Math.sin(a)) * k, y: svg.top + (90 - 64 * Math.cos(a)) * k };
  });
  await page.touchscreen.tap(tp.x, tp.y);
  await page.waitForTimeout(300);
  check(await page.locator('[data-donut="airport-road"] [data-viz-tip]').count() === 1 && page.url().endsWith('/overview'), 'donut: a tap shows the tip (and does not navigate)', page.url());
  await page.touchscreen.tap(tp.x, tp.y);
  await page.waitForURL(/\/inventory\?/, { timeout: 8000 }).catch(() => {});
  check(page.url().includes('branch=airport-road'), 'donut: a second tap opens the inventory', page.url());
  await page.goto(`${BASE}/overview`);
  await page.waitForSelector('[data-card="arrivals"] .num', { timeout: 20000 });
  await page.click('[data-action="nav-open"]');
  const items = await page.locator('[data-nav-drawer] [data-nav]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav')));
  check(items[0] === 'overview' && !items.includes('reports'), 'reception: «النظرة العامة» first in the phone menu, no «التقارير»', items.join(','));
  await page.click('[data-action="nav-close"]');
  await page.goto(`${BASE}/reports`);
  await page.waitForURL(/\/overview$/, { timeout: 10000 }).catch(() => {});
  check(!page.url().includes('/reports'), 'reception: /reports is not reachable', page.url());
  const r = await userRpc(page, 'report_performance', { p_branch: null, p_from: riyadh(-6), p_to: T });
  check(r.status === 403 || r.status === 401 || (r.body && r.body.code === '42501'), 'reception: the reports RPC refuses', JSON.stringify(r).slice(0, 120));
  await shot(page, 'overview-reception-375-light');
  await ctx.close();
}

// ════ landing without «النظرة العامة» ════
{
  await setLevel(mgmt, 'overview', 'none');
  const { ctx, page } = await login('mgmt@qa.invalid');
  await page.waitForURL(/\/bookings$/, { timeout: 15000 }).catch(() => {});
  check(page.url().endsWith('/bookings'), 'without «النظرة العامة» sign-in lands on «الحجوزات»', page.url());
  await ctx.close();
  await setLevel(mgmt, 'overview', 'view');
}

// ════ reduced motion, then 375 + 1440 × light + dark (one admin session: the sign-in code is limited per hour) ════
{
  const { ctx, page } = await login('admin@qa.invalid');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}/overview`);
  await page.waitForSelector('[data-card="arrivals"] .num', { timeout: 20000 });
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => ({
    running: document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getTiming().duration) > 0).length,
    seg: getComputedStyle(document.querySelector('.donut-seg')).animationDuration,
  }));
  check(st.running === 0 && st.seg === '0s', 'reduced motion: no animation at all', JSON.stringify(st));
  check((await cardValue(page, 'arrivals')) === '3', 'reduced motion: numbers show their value at once');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate((t) => localStorage.setItem('armada-theme', t), theme);
      for (const path of ['/overview', '/reports']) {
        await page.goto(`${BASE}${path}`);
        await page.waitForSelector(path === '/overview' ? '[data-card="arrivals"] .num' : '[data-section="performance"] [data-kpi="pct"]', { timeout: 20000 });
        await page.waitForTimeout(1500);
        await settle(page);
        const lay = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, theme: document.documentElement.dataset.theme }));
        check(lay.sw <= lay.iw + 1 && lay.theme === theme, `${path} ${viewport.width} ${theme}: no horizontal scroll`, JSON.stringify(lay));
        check(!ARABIC_DIGITS.test(await page.locator('#app-main').innerText()), `${path} ${viewport.width} ${theme}: Western digits only`);
        await axe(page, `${path} ${viewport.width} ${theme}`);
        await shot(page, `${path.slice(1)}-${viewport.width}-${theme}`);
      }
    }
  }
  await ctx.close();
}

await browser.close();
// cleanup of the fixtures (the branch is deleted after the session anyway)
await rest('reservations?ref=like.AR-29991231-E6*', { method: 'DELETE' });
await rest('partner_enquiries?ref=like.AR-29991231-E6*', { method: 'DELETE' });
await rest('rate_overrides?sanity_flag=not.is.null', { method: 'DELETE' });
console.log(`\n${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  console.log('FAILED:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('✓ overview + reports: cards, alerts, donuts, forward chart, realtime, permissions, landing, Excel, PDF, motion, a11y');
