// The guided tour end to end (Ahmed, 4 Nov 2026 — DECISIONS.md 2026-11-04 «Guided tour») on a PREVIEW BRANCH (refuses
// the production project), with the QA users; every sign-in is a new auth session:
//   - management, sign-in 1: the welcome tour starts by itself («1 من 5», the texts, the spotlight's 2 px bronze ring
//     around the target, focus in the card, Tab cycles the card, the page inert, a press on the dim does nothing),
//     «التالي» / «السابق»; a plain «تخطّي» stores nothing, focus goes back to «؟», a reload in the same sign-in shows
//     nothing; sign-in 2 (a fresh browser) shows it again — the box ticked + Esc stores it; sign-in 3 (a fresh browser)
//     shows nothing; «؟» (44 px, «المساعدة») runs «جولة سريعة في اللوحة» to «إنهاء» anyway and, per screen, «شرح هذه
//     الصفحة» (none on «النظرة العامة»): «الحجوزات» (the confirm steps open the first request and close it after),
//     «المخزون», «الأسعار», «التقارير»; Esc ends a page tour and stores nothing;
//   - admin: the welcome tour to «إنهاء» stores it; «طلبات الشركاء» and «العملاء» tours (steps inside the details);
//     375 (bottom sheet, no arrow, the menu button for the sidebar) + 1440 × light + dark with axe on the open tour;
//     reduced motion → no glide (0 s transitions), otherwise 200 ms;
//   - reception without «النظرة العامة» and with «الحجوزات» view only: the welcome tour skips the two overview steps
//     («1 من 3») and the bookings tour skips the confirm steps («1 من 2»).
// Screenshots in screenshots/tour.
//   node admin/tests/tour-check.mjs [BASE_URL=http://127.0.0.1:5173]
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
const SHOTS = 'screenshots/tour';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const riyadh = (d = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(Date.now() + d * 86400000));

const WELCOME = [
  ['القائمة', 'من هنا تنتقل بين أقسام اللوحة. تظهر لك فقط الأقسام المسموح لك بها.'],
  ['ملخص اليوم', 'الوصول والمغادرة والطلبات المنتظرة. اضغط أي بطاقة لتفتح قائمتها مباشرة.'],
  ['التنبيهات', 'كل ما يحتاج تصرّفًا اليوم في مكان واحد. ابدأ يومك من هنا.'],
  ['الحجوزات', 'كل حجز أو طلب يصل من الموقع يظهر هنا فورًا. فعّل إشعار المتصفح من قائمة حسابك حتى لا يفوتك شيء.'],
  ['المساعدة', 'من هذا الزر تعيد الجولة أو تفتح شرح الصفحة التي أنت فيها، في أي وقت.'],
];

// ── fixtures (this branch only) ──
const staff = await rest('staff?select=user_id,role,full_name,branch,email:user_id&active=eq.true');
const users = await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: S }).then((r) => r.json());
const idOf = (email) => users.users.find((u) => u.email === email)?.id;
const ADMIN = idOf('admin@qa.invalid');
const MGMT = idOf('mgmt@qa.invalid');
const REC = idOf('rec-air@qa.invalid');
if (!ADMIN || !MGMT || !REC || !staff.length) throw new Error('the QA users are missing on the branch');
const setLevel = (user_id, section, level) => rest('staff_permissions?on_conflict=user_id,section', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ user_id, section, level }]) });
for (const s of ['overview', 'reports', 'bookings', 'rates', 'inventory']) await setLevel(MGMT, s, s === 'overview' || s === 'reports' ? 'view' : 'edit');
for (const [s, l] of [['overview', 'view'], ['bookings', 'edit'], ['partners', 'edit'], ['guests', 'edit'], ['reports', 'view'], ['rates', 'edit'], ['inventory', 'edit']]) await setLevel(ADMIN, s, l);
for (const [s, l] of [['overview', 'none'], ['bookings', 'view'], ['reports', 'none'], ['partners', 'none'], ['guests', 'none']]) await setLevel(REC, s, l);
await rest(`staff_tours?user_id=in.(${ADMIN},${MGMT},${REC})`, { method: 'DELETE' });

const types = await rest('room_types?select=id,branch,slug,name_ar&active=eq.true&bookable=eq.true&is_test=eq.false&branch=eq.airport-road&order=sort');
if (!types.length) throw new Error('the branch needs a bookable Airport Road room type');
await rest('reservations?ref=like.AR-29991231-T*', { method: 'DELETE' });
await rest('partner_enquiries?ref=like.AR-29991231-T*', { method: 'DELETE' });
const resv = (ref, status, phone) => rest('reservations', { method: 'POST', body: JSON.stringify({
  ref, status, confirmation: status === 'confirmed' ? 'staff' : null, source: 'website', branch: 'airport-road', room_type_id: types[0].id,
  check_in: riyadh(10), check_out: riyadh(12), adults: 2, children: 0, extra_beds: 0, breakfast: 'without', guest_name: 'ضيف جولة اللوحة',
  phone, locale: 'ar', is_test: false, total: status === 'confirmed' ? 600 : null, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
}) });
await resv('AR-29991231-T701', 'request', '+966500000701');
await resv('AR-29991231-T702', 'confirmed', '+966500000702');
await rest('partner_enquiries', { method: 'POST', body: JSON.stringify({ ref: 'AR-29991231-T7P1', request_type: 'corporate', branch: 'airport-road', status: 'new', organisation: 'شركة تجربة الجولة', contact_name: 'مسؤول التجربة', phone: '+966500000703', email: 'tour-partner@qa.invalid', is_test: false }) });
if (!(await rest('guest_profiles?phone=eq.%2B966500000701&select=id')).length) {
  await rest('guest_profiles', { method: 'POST', body: JSON.stringify({ phone: '+966500000701', name: 'ضيف جولة اللوحة', language: 'ar' }) });
}
const doneRows = async (user) => (await rest(`staff_tours?user_id=eq.${user}&select=tour`)).map((r) => r.tour);

// ── browser ──
const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, { viewport = { width: 1440, height: 900 }, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ar', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const codes = [];
  await routeLoginCode(ctx, TOKEN, codes);
  // the tour starts by itself only where this flag says so (automated browsers otherwise never get it)
  await ctx.addInitScript(() => { try { localStorage.setItem('armada-tour-test', '1'); if (!sessionStorage.getItem('qa-theme-set')) { localStorage.setItem('armada-theme', 'light'); sessionStorage.setItem('qa-theme-set', '1'); } } catch { /* */ } });
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
const card = '[data-tour-card]';
const waitCard = (page, ms = 15000) => page.waitForSelector(`${card}[data-ready="1"]`, { timeout: ms }).then(() => true, () => false);
const waitStep = async (page, count) => {
  await page.waitForFunction((c) => {
    const el = document.querySelector('[data-tour-card][data-ready="1"] [data-tour-count]');
    return el && el.textContent === c;
  }, count, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(260); // the glide (200 ms)
};
const state = (page) => page.evaluate(() => {
  const c = document.querySelector('[data-tour-card]');
  if (!c) return null;
  const spot = document.querySelector('[data-tour-spot]');
  const sr = spot?.getBoundingClientRect();
  const cs = spot && getComputedStyle(spot);
  return {
    count: c.querySelector('[data-tour-count]')?.textContent, title: c.querySelector('[data-tour-title]')?.textContent, text: c.querySelector('[data-tour-text]')?.textContent,
    arrow: c.getAttribute('data-arrow'), sheet: c.classList.contains('is-sheet'), rect: c.getBoundingClientRect().toJSON(), vh: innerHeight, vw: innerWidth,
    spot: sr && { x: sr.x, y: sr.y, w: sr.width, h: sr.height, border: cs.borderTopWidth, color: cs.borderTopColor, dur: cs.transitionDuration },
    focusIn: !!document.activeElement?.closest('[data-tour-card]'), focus: document.activeElement?.getAttribute('data-tour-action') ?? document.activeElement?.tagName,
    rootInert: document.getElementById('root')?.hasAttribute('inert'), check: !!c.querySelector('[data-tour-dontshow]'),
    primary: c.querySelector('[data-tour-action="next"],[data-tour-action="finish"]')?.textContent,
  };
});
/** the spotlight frames the target: every on-screen match of the selector inside the ring (6 px padding, clamped) */
const frames = (page, sel) => page.evaluate((sel) => {
  const spot = document.querySelector('[data-tour-spot]')?.getBoundingClientRect();
  const els = Array.from(document.querySelectorAll(sel)).filter((e) => e.getClientRects().length);
  if (!spot || !els.length) return false;
  return els.every((e) => {
    const r = e.getBoundingClientRect();
    const t = Math.max(4, r.top - 6), b = Math.min(innerHeight - 4, r.bottom + 6), l = Math.max(4, r.left - 6), rt = Math.min(innerWidth - 4, r.right + 6);
    return l >= spot.left - 1 && rt <= spot.right + 1 && t >= spot.top - 1 && b <= spot.bottom + 1;
  });
}, sel);
/** the card sits next to the spotlight on its arrow's side (14 px gap) — never mid-flight from elsewhere */
const beside = (page) => page.evaluate(() => {
  const c = document.querySelector('[data-tour-card]');
  const a = c?.getAttribute('data-arrow');
  const k = c?.getBoundingClientRect();
  const sp = document.querySelector('[data-tour-spot]')?.getBoundingClientRect();
  if (!k || !sp) return false;
  if (c.classList.contains('is-sheet') || !a) return true;
  const gap = a === 'top' ? k.top - sp.bottom : a === 'bottom' ? sp.top - k.bottom : a === 'right' ? sp.left - k.right : k.left - sp.right;
  return Math.abs(gap - 14) <= 3;
});
const focusIn = (page) => page.waitForFunction(() => !!document.activeElement?.closest('[data-tour-card]'), null, { timeout: 3000 }).catch(() => {});
const focusHelp = (page) => page.waitForFunction(() => document.activeElement?.getAttribute('data-action') === 'help', null, { timeout: 3000 }).then(() => true, () => false);
const next = async (page, count) => { await page.click(`${card} [data-tour-action="next"]`); await waitStep(page, count); };
const helpRun = async (page, which) => {
  await page.click('[data-action="help"]');
  await page.waitForSelector('[data-help-menu]');
  await page.click(`[data-help="${which}"]`);
  return waitCard(page);
};
async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  check(v.length === 0, `axe zero serious / critical — ${label}`, v.join(' ; '));
}
async function pageTour(page, path, want, label) {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('#app-main');
  await page.waitForTimeout(1500);
  const started = await helpRun(page, 'page');
  check(started, `«شرح هذه الصفحة» starts the ${label} tour`);
  const seen = [];
  for (let k = 0; k < want.length; k++) {
    await waitStep(page, `${k + 1} من ${want.length}`);
    const s = await state(page);
    seen.push(s?.title);
    check(s?.count === `${k + 1} من ${want.length}` && s?.title === want[k][0], `${label} step ${k + 1}: «${want[k][0]}» · «${k + 1} من ${want.length}»`, JSON.stringify(s && [s.count, s.title]));
    if (want[k][1]) check(await frames(page, want[k][1]), `${label} step ${k + 1}: the spotlight frames its control`, want[k][1]);
    check(await beside(page), `${label} step ${k + 1}: the card sits next to its target`);
    await shot(page, `${label.replace(/[^a-z]+/gi, '-')}-${k + 1}`);
    if (k === want.length - 1) check(s?.primary === 'إنهاء', `${label}: the last step's button reads «إنهاء»`, s?.primary);
    if (k < want.length - 1) await page.click(`${card} [data-tour-action="next"]`);
  }
  await page.click(`${card} [data-tour-action="finish"]`);
  await page.waitForSelector(card, { state: 'detached', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  check(await page.locator(card).count() === 0, `${label}: «إنهاء» closes the tour`);
  return seen;
}

// ════ management: first sign-in, plain skip, second sign-in, the box + Esc, third sign-in ════
{
  const { ctx, page } = await login('mgmt@qa.invalid');
  check(await waitCard(page), 'welcome tour starts by itself on the first sign-in');
  await focusIn(page);
  let s = await state(page);
  check(s?.count === '1 من 5' && s?.title === WELCOME[0][0] && s?.text === WELCOME[0][1], 'step 1: «القائمة», its text, «1 من 5»', JSON.stringify(s && [s.count, s.title, s.text]));
  check(s?.spot?.border === '2px' && s?.spot?.color === 'rgb(169, 124, 80)', 'the spotlight has a 2 px Armada Bronze ring', JSON.stringify(s?.spot));
  check(await frames(page, '[data-tour~="sidebar"]'), 'step 1 spotlights the sidebar');
  check(s?.focusIn && s?.focus === 'next', 'focus moves into the card («التالي»)', s?.focus);
  check(s?.rootInert, 'the page behind the tour is inert');
  check(s?.check, 'the welcome tour offers «لا تعرض الجولة مرة أخرى»');
  const order = await page.evaluate(() => {
    const el = document.querySelector('[data-tour-count]');
    const r = document.createRange();
    const t = el.firstChild;
    const at = (i) => { r.setStart(t, i); r.setEnd(t, i + 1); return r.getBoundingClientRect().left; };
    const s = t.textContent;
    return { step: at(s.indexOf('1')), of: at(s.indexOf('م')), total: at(s.indexOf('5')) };
  });
  check(order.step > order.of && order.of > order.total, 'the counter reads «1 من 5» right to left', JSON.stringify(order));
  check(['top', 'bottom', 'left', 'right'].includes(s?.arrow ?? ''), 'the card points at its target with an arrow', s?.arrow);
  check(await beside(page), 'the first card is placed next to its target at once (no glide from the corner)');
  await shot(page, 'welcome-1-1440-light');
  // Tab cycles the card's controls (skip, next, the box), Shift+Tab backwards
  const seq = [];
  for (let k = 0; k < 4; k++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => document.activeElement?.getAttribute('data-tour-action') ?? (document.activeElement?.hasAttribute('data-tour-dontshow') ? 'box' : document.activeElement?.tagName))); }
  check(seq.every((x) => ['skip', 'next', 'box', 'prev'].includes(x)) && new Set(seq).size >= 3, 'Tab cycles inside the card', seq.join(','));
  await page.keyboard.press('Shift+Tab');
  check(await page.evaluate(() => !!document.activeElement?.closest('[data-tour-card]')), 'Shift+Tab stays inside the card');
  // a press on the dimmed page does nothing
  await page.mouse.click(1400, 880);
  await page.waitForTimeout(200);
  check((await state(page))?.count === '1 من 5' && page.url().endsWith('/overview'), 'a press outside the card does nothing');
  await page.click(`${card} [data-tour-action="next"]`);
  await waitStep(page, '2 من 5');
  s = await state(page);
  check(s?.title === WELCOME[1][0] && s?.text === WELCOME[1][1], '«التالي» → step 2 «ملخص اليوم»', s?.title);
  check(await frames(page, '[data-tour~="overview-cards"]'), 'step 2 spotlights the four cards');
  await next(page, '3 من 5');
  s = await state(page);
  check(s?.title === WELCOME[2][0] && await frames(page, '[data-tour~="overview-alerts"]'), 'step 3 «التنبيهات» spotlights the alerts card', s?.title);
  await page.click(`${card} [data-tour-action="prev"]`);
  await waitStep(page, '2 من 5');
  check((await state(page))?.title === WELCOME[1][0], '«السابق» goes back to step 2');
  await page.click(`${card} [data-tour-action="skip"]`);
  await page.waitForSelector(card, { state: 'detached', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  check(await page.locator(card).count() === 0, 'a plain «تخطّي» closes the tour');
  check(await focusHelp(page), 'focus returns to «؟» after the tour');
  check(!(await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert'))), 'the page is no longer inert');
  check(!(await doneRows(MGMT)).includes('welcome'), 'a plain «تخطّي» stores nothing');
  await page.reload();
  await page.waitForSelector('#app-main');
  check(!(await waitCard(page, 5000)), 'within the same sign-in the tour does not come back after a reload');
  await ctx.close();
}
{
  const { ctx, page } = await login('mgmt@qa.invalid');
  check(await waitCard(page), 'the next sign-in (a fresh browser) shows the welcome tour again after a plain «تخطّي»');
  await page.check(`${card} [data-tour-dontshow]`);
  await page.keyboard.press('Escape');
  await page.waitForSelector(card, { state: 'detached', timeout: 5000 }).catch(() => {});
  check(await page.locator(card).count() === 0, 'Esc = «تخطّي»');
  await page.waitForTimeout(800);
  check((await doneRows(MGMT)).includes('welcome'), '«تخطّي» with «لا تعرض الجولة مرة أخرى» ticked stores the tour as done');
  await ctx.close();
}
{
  const { ctx, page } = await login('mgmt@qa.invalid');
  check(!(await waitCard(page, 6000)), 'after the box was ticked: no tour at the next sign-in, in a fresh browser');
  const help = await page.locator('[data-action="help"]').evaluate((b) => ({ w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, label: b.getAttribute('aria-label'), next: b.parentElement?.previousElementSibling?.getAttribute('data-action') }));
  check(help.w >= 44 && help.h >= 44 && help.label === 'المساعدة', '«؟»: 44 px, aria-label «المساعدة»', JSON.stringify(help));
  check(help.next === 'quick-search', '«؟» sits next to the search', help.next);
  await page.click('[data-action="help"]');
  const items = await page.locator('[data-help-menu] [data-help]').evaluateAll((els) => els.map((e) => e.textContent));
  check(items.join('|') === 'جولة سريعة في اللوحة', '«النظرة العامة» has no page tour: only «جولة سريعة في اللوحة»', items.join('|'));
  check(await page.evaluate(() => document.activeElement?.getAttribute('data-help') === 'welcome'), 'the menu takes the focus');
  await page.keyboard.press('Escape');
  check(await page.locator('[data-help-menu]').count() === 0 && await page.evaluate(() => document.activeElement?.getAttribute('data-action') === 'help'), 'Esc closes the menu, focus back on «؟»');
  check(await helpRun(page, 'welcome'), '«جولة سريعة في اللوحة» runs the welcome tour although it is stored as done');
  for (let k = 0; k < 5; k++) {
    await waitStep(page, `${k + 1} من 5`);
    const s = await state(page);
    check(s?.title === WELCOME[k][0] && s?.text === WELCOME[k][1], `welcome step ${k + 1} «${WELCOME[k][0]}»`, s?.title);
    if (k < 4) await page.click(`${card} [data-tour-action="next"]`);
  }
  check((await state(page))?.primary === 'إنهاء' && await frames(page, '[data-tour~="help"]'), 'the last step spotlights «؟» and reads «إنهاء»');
  await page.click(`${card} [data-tour-action="finish"]`);
  await page.waitForSelector(card, { state: 'detached', timeout: 5000 }).catch(() => {});
  check(await focusHelp(page), '«إنهاء»: focus back on «؟»');

  // page tours
  await page.goto(`${BASE}/bookings`);
  await page.waitForSelector('[data-list="bookings"]');
  await page.click('[data-action="help"]');
  const items2 = await page.locator('[data-help-menu] [data-help]').evaluateAll((els) => els.map((e) => e.textContent));
  check(items2.join('|') === 'شرح هذه الصفحة|جولة سريعة في اللوحة', '«الحجوزات»: both items', items2.join('|'));
  await page.keyboard.press('Escape');
  await pageTour(page, '/bookings', [['الفلاتر', '[data-tour~="booking-filters"]'], ['تفاصيل الحجز', '[data-tour~="booking-row"]'], ['التأكيد', '[data-tour~="booking-confirm"]'], ['بعد كل حجز مؤكد', '[data-tour~="booking-confirm"]']], 'bookings');
  check(await page.locator('[data-drawer]').count() === 0, 'bookings: the details the tour opened are closed after «إنهاء»');
  await pageTour(page, '/inventory', [['الخانة', '[data-tour~="cal-cell"]'], ['فتح وإغلاق', '[data-tour~="row-open-close"]'], ['تعديل جماعي', '[data-tour~="cal-bulk"]'], ['إذا بِعت خارج الموقع', null]], 'inventory');
  await pageTour(page, '/rates', [['السعر الأساسي', '[data-tour~="base-rate"]'], ['سعر لفترة', '[data-tour~="cal-bulk"]'], ['تنبيه السعر', null]], 'rates');
  await pageTour(page, '/reports', [['الفترة والمقارنة', '[data-tour~="report-period"]'], ['كيف نحسب', '[data-section="performance"] [data-how]'], ['التصدير', '[data-tour~="report-export"]']], 'reports');
  // Esc ends a page tour; page tours store nothing
  await page.goto(`${BASE}/bookings`);
  await page.waitForSelector('[data-list="bookings"]');
  await helpRun(page, 'page');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await page.locator(card).count() === 0 && await page.locator('[data-drawer]').count() === 0, 'Esc ends a page tour');
  check((await doneRows(MGMT)).join(',') === 'welcome', 'page tours store nothing', (await doneRows(MGMT)).join(','));
  await ctx.close();
}

// ════ admin: welcome to «إنهاء», partners + guests tours, 375 / 1440 × light / dark, reduced motion ════
{
  const { ctx, page } = await login('admin@qa.invalid');
  check(await waitCard(page), 'admin: the welcome tour starts on the first sign-in');
  for (let k = 1; k < 5; k++) await next(page, `${k + 1} من 5`);
  await page.click(`${card} [data-tour-action="finish"]`);
  await page.waitForTimeout(800);
  check((await doneRows(ADMIN)).includes('welcome'), '«إنهاء» stores the welcome tour as done');
  await pageTour(page, '/partners', [['حالة الطلب', '[data-tour~="partner-status"]'], ['أول تواصل', '[data-tour~="partner-contact"]'], ['عرض السعر', '[data-tour~="partner-quote"]']], 'partners');
  check(await page.locator('[data-drawer]').count() === 0, 'partners: the enquiry the tour opened is closed after «إنهاء»');
  await pageTour(page, '/guests', [['البحث', '[data-tour~="guest-search"]'], ['ملف الضيف', '[data-tour~="guest-row"]'], ['الموافقة الحضورية', '[data-tour~="guest-consent"]']], 'guests');

  await page.goto(`${BASE}/overview`);
  await page.waitForSelector('[data-cards]');
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.waitForTimeout(300);
      check(await helpRun(page, 'welcome'), `${w} ${theme}: «؟» runs the welcome tour`);
      await waitStep(page, '1 من 5');
      const s = await state(page);
      if (w === 375) {
        check(s?.sheet && Math.abs(s.rect.bottom - s.vh) < 2 && s.rect.left <= 1 && Math.abs(s.rect.right - s.vw) < 2, '375: the card is a bottom sheet', JSON.stringify(s?.rect));
        check(!s?.arrow, '375: the sheet has no arrow');
        check(await frames(page, '[data-tour~="nav-open"]'), '375: the menu button stands in for the sidebar');
        const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        check(!hscroll, '375: no horizontal scroll with the tour open');
      } else {
        check(!s?.sheet && !!s?.arrow, '1440: a popover with an arrow');
      }
      await shot(page, `welcome-${w}-${theme}`);
      await axe(page, `tour open, ${w} ${theme}`);
      await next(page, '2 من 5');
      await shot(page, `welcome-${w}-${theme}-2`);
      await page.click(`${card} [data-tour-action="skip"]`);
      await page.waitForSelector(card, { state: 'detached', timeout: 5000 }).catch(() => {});
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  // motion: 200 ms glide; reduced motion → 0
  await helpRun(page, 'welcome');
  check((await state(page))?.spot?.dur?.split(',').every((d) => d.trim() === '0.2s'), 'the spotlight glides in 200 ms', (await state(page))?.spot?.dur);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  await helpRun(page, 'welcome');
  check((await state(page))?.spot?.dur?.split(',').every((d) => d.trim() === '0s'), 'reduced motion: no glide (0 s)', (await state(page))?.spot?.dur);
  await page.click(`${card} [data-tour-action="next"]`);
  await page.waitForFunction(() => document.querySelector('[data-tour-card][data-ready="1"] [data-tour-count]')?.textContent === '2 من 5', null, { timeout: 5000 }).catch(() => {});
  check(await frames(page, '[data-tour~="overview-cards"]'), 'reduced motion: the spotlight is on the next target at once');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check((await doneRows(ADMIN)).join(',') === 'welcome', 'admin: one row, the welcome tour');
  await ctx.close();
}

// ════ reception without «النظرة العامة», «الحجوزات» view only ════
{
  const { ctx, page } = await login('rec-air@qa.invalid');
  check(await waitCard(page), 'reception: the welcome tour starts on the first sign-in');
  await waitStep(page, '1 من 3');
  const titles = [];
  for (let k = 0; k < 3; k++) {
    await waitStep(page, `${k + 1} من 3`);
    const s = await state(page);
    titles.push(s?.title);
    if (k < 2) await page.click(`${card} [data-tour-action="next"]`);
  }
  check(titles.join('|') === 'القائمة|الحجوزات|المساعدة', 'reception: no step for the overview it cannot see, and the counter says «من 3»', titles.join('|'));
  await page.click(`${card} [data-tour-action="finish"]`);
  await page.waitForTimeout(500);
  await pageTour(page, '/bookings', [['الفلاتر', '[data-tour~="booking-filters"]'], ['تفاصيل الحجز', '[data-tour~="booking-row"]']], 'reception bookings (view only)');
  check(await page.locator('[data-drawer]').count() === 0, 'reception: no details opened for a confirm it cannot do');
  await ctx.close();
}

await browser.close();
await rest('reservations?ref=like.AR-29991231-T*', { method: 'DELETE' });
await rest('partner_enquiries?ref=like.AR-29991231-T*', { method: 'DELETE' });
console.log(`\ntour-check: ${checks - fails.length}/${checks} passed`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
