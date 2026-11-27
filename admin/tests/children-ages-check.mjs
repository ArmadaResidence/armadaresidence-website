// «تسجيل أعمار الأطفال» (Ahmed, 27 Nov 2026 — DECISIONS.md 2026-11-27 «Children's ages required»). OFFLINE — no Supabase
// project is reached: a Vite dev server on a stub Supabase origin and a fake session (as test-delete-check.mjs). The
// database rules live in supabase/tests/children-ages.sql; this checks what the dashboard shows:
//   a request with 2 children, breakfast and no ages (reason needs_ages) — «تسجيل أعمار الأطفال» in the details; the
//   shared Modal with one select per child (0–17, «أقل من سنة» … «17 سنة», Western digits), «حفظ» disabled until every age
//   is chosen, × / Esc with a change → «تعديلات غير محفوظة», «حفظ» → staff_set_children_ages(p_id, p_ages) as numbers, the
//   toast, the details open again on the booking; a confirm refused with needs_ages → the new text; no button on a request
//   with its ages, a request without breakfast, a confirmed booking, or for a bookings: view user.
// 1280 and 375, light. Screenshots in screenshots/children-ages/.
//   node admin/tests/children-ages-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const SHOTS = join(ROOT, 'screenshots', 'children-ages');
mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'bookings', 'audit'];
const meOf = (level) => ({
  role: 'reception', branch: 'airport-road', full_name: 'استقبال الفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: false, backup_codes_left: null,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === 'bookings' ? level : 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const RT = '00000000-0000-4000-8000-0000000000c1';
const now = new Date().toISOString();
const booking = (id, ref, o = {}) => ({
  id, ref, status: 'request', source: 'website', confirmation: null, fallback_reason: 'needs_ages', branch: 'airport-road', room_type_id: RT,
  check_in: '2026-12-01', check_out: '2026-12-03', nights: 2, adults: 2, children: 2, children_ages: null, extra_beds: 0, breakfast: 'with',
  needs_coordination: false, capacity_at_request: 2, guest_name: 'ضيف الفحص', phone: '+966500000000', email: null, notes: null, locale: 'ar',
  room_total: 600, breakfast_total: null, extra_beds_total: 0, total: null, extra_bed_fee_per_night: null, pricing: null,
  offer: null, promo_code: null, base_total: null, discount_total: null, confirmed_at: null, cancelled_at: null, cancel_reason: null, cancel_reason_code: null,
  internal_notes: null, visit: null, payment_status: 'pay_at_hotel', is_test: false, created_at: now, updated_at: now, booking_source: 'website', ...o,
});
const STUCK = booking('00000000-0000-4000-8000-0000000000d1', 'AR-20261201-QA01');
const DONE = { ...booking('00000000-0000-4000-8000-0000000000d2', 'AR-20261201-QA02'), children_ages: [3, 9], fallback_reason: null, breakfast_total: 125, total: 725 };
const WITHOUT = booking('00000000-0000-4000-8000-0000000000d3', 'AR-20261201-QA03', { breakfast: 'without', fallback_reason: 'instant_off', total: 600 });
const CONFIRMED = booking('00000000-0000-4000-8000-0000000000d4', 'AR-20261201-QA04', { status: 'confirmed', confirmation: 'staff', fallback_reason: null });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: now };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};

async function context(browser, level, w, h) {
  const calls = [];
  const state = { saved: false };
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: 'light' });
  await ctx.route(`${STUB}/**`, async (r) => {
    const u = r.request().url();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    const path = new URL(u).pathname;
    if (/\/rpc\/my_staff$/.test(path)) return ok(meOf(level));
    if (/\/auth\/v1\/user/.test(path)) return ok(USER);
    if (/\/rpc\/staff_set_children_ages$/.test(path)) {
      const body = JSON.parse(r.request().postData() || '{}');
      calls.push({ fn: 'staff_set_children_ages', body });
      state.saved = true;
      return ok({ ok: true, ref: STUCK.ref, batch_id: '00000000-0000-4000-8000-0000000000e1', reason: null, total: 725, breakfast_total: 125 });
    }
    if (/\/functions\/v1\/booking-admin$/.test(path)) {
      const body = JSON.parse(r.request().postData() || '{}');
      calls.push({ fn: 'booking-admin', body });
      return ok(state.saved ? { ok: true, ref: STUCK.ref, low: [] } : { ok: false, reason: 'needs_ages' });
    }
    if (/\/rest\/v1\/reservations$/.test(path) && r.request().method() === 'GET') {
      const stuck = state.saved ? { ...STUCK, children_ages: [5, 0], fallback_reason: null, breakfast_total: 125, total: 725 } : STUCK;
      return ok([stuck, DONE, WITHOUT, CONFIRMED]);
    }
    if (/\/rest\/v1\/room_types$/.test(path)) return ok([{ id: RT, branch: 'airport-road', slug: 'qa-room', name_ar: 'غرفة الفحص', name_en: 'QA room', bookable: true, active: true, sort: 1, base_rate: 300, capacity: 2, extra_beds_max: 0 }]);
    if (/\/rest\/v1\/branches$/.test(path)) return ok([{ slug: 'airport-road', name_ar: 'طريق المطار', name_en: 'Airport Road', sort: 1 }, { slug: 'shafa-road', name_ar: 'طريق الشفا', name_en: 'Shafa Road', sort: 2 }]);
    if (/\/rest\/v1\/rpc\//.test(path)) return ok(null);
    return ok([]);
  });
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v); localStorage.setItem('armada-tour-test', '0'); } catch {}
  }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION)]);
  return { ctx, calls, state };
}

const openBooking = async (page, ref) => {
  if (!page.url().includes('/bookings')) await page.goto(`${BASE}/bookings`, { waitUntil: 'load' });
  await page.locator(`[data-ref="${ref}"]`).waitFor({ timeout: 30000 });
  await page.locator(`[data-ref="${ref}"]`).click();
  await page.locator('[data-action="print"]').waitFor({ timeout: 10000 });
};
const closeDrawer = async (page) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
};

const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h] of [[1280, 900], [375, 812]]) {
  const tag = `edit @${w}`;
  const { ctx, calls } = await context(browser, 'edit', w, h);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => failures.push(`${tag} page error: ${e.message}`));
  await page.goto(`${BASE}/bookings`, { waitUntil: 'load' });
  for (const [ref, why] of [[DONE.ref, 'a request with its ages'], [WITHOUT.ref, 'a request without breakfast'], [CONFIRMED.ref, 'a confirmed booking']]) {
    await openBooking(page, ref);
    check((await page.locator('[data-action="set-ages"]').count()) === 0, `${tag}: «تسجيل أعمار الأطفال» shown on ${why}`);
    await closeDrawer(page);
  }
  // the confirm before the ages: the new text
  await openBooking(page, STUCK.ref);
  const btn = page.locator('[data-action="set-ages"]');
  check((await btn.count()) === 1 && (await btn.textContent())?.trim() === 'تسجيل أعمار الأطفال', `${tag}: «تسجيل أعمار الأطفال» missing on the stuck request`);
  await page.locator('[data-action="confirm"]').click();
  const cd = page.locator('dialog[open]').filter({ has: page.locator('[data-action="confirm-go"]') });
  await cd.waitFor({ timeout: 10000 });
  await cd.locator('#confirm-rt').selectOption(RT);
  await cd.locator('[data-action="confirm-go"]').click();
  await page.waitForTimeout(800);
  const cdText = (await cd.textContent()) ?? '';
  check(cdText.includes('أعمار الأطفال ناقصة. سجّلها من «تسجيل أعمار الأطفال» ثم أكّد الحجز.'), `${tag}: the confirm's needs_ages text — «${cdText.slice(0, 200)}»`);
  await cd.locator('button', { hasText: 'رجوع' }).click();
  await page.waitForTimeout(400);
  // the dialog
  await btn.click();
  const dlg = page.locator('dialog[open]').filter({ has: page.locator('[data-action="set-ages-go"]') });
  await dlg.waitFor({ timeout: 10000 });
  const sels = dlg.locator('[data-ages-dialog] select');
  check((await sels.count()) === 2, `${tag}: one select per child (${await sels.count()})`);
  const opts = await sels.first().locator('option').allTextContents();
  check(opts.length === 19 && opts[1] === 'أقل من سنة' && opts[2] === 'سنة واحدة' && opts[3] === 'سنتان' && opts[4] === '3 سنوات' && opts[12] === '11 سنة' && opts[18] === '17 سنة', `${tag}: the age labels — ${opts.join(' | ')}`);
  check(!/[٠-٩]/.test(opts.join('')), `${tag}: Arabic-Indic digits in the age labels`);
  const go = dlg.locator('[data-action="set-ages-go"]');
  check(await go.isDisabled(), `${tag}: «حفظ» enabled before any age`);
  await sels.first().selectOption('5');
  check(await go.isDisabled(), `${tag}: «حفظ» enabled with one age of two`);
  // a change, then × → the dirty guard, «متابعة التعديل» keeps the dialog
  await dlg.locator('[data-action="dialog-close"]').first().click();
  const guard = dlg.locator('dialog[open]').filter({ hasText: 'تعديلات غير محفوظة' });
  await guard.waitFor({ timeout: 5000 }).catch(() => {});
  check((await guard.count()) === 1, `${tag}: × with an age chosen does not ask «تعديلات غير محفوظة»`);
  if (await guard.count()) await guard.locator('button', { hasText: 'متابعة التعديل' }).click();
  await page.waitForTimeout(300);
  check(await dlg.isVisible(), `${tag}: the dialog closed after «متابعة التعديل»`);
  // an outside press never closes it
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  check(await dlg.isVisible(), `${tag}: an outside press closed the dialog`);
  await sels.nth(1).selectOption('0');
  check(await go.isEnabled(), `${tag}: «حفظ» disabled with every age chosen`);
  await page.screenshot({ path: join(SHOTS, `ages-dialog-${w}.png`) });
  await go.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOTS, `after-save-${w}.png`) });
  const c = calls.find((x) => x.fn === 'staff_set_children_ages');
  check(c && c.body.p_id === STUCK.id && JSON.stringify(c.body.p_ages) === '[5,0]', `${tag}: staff_set_children_ages called with ${JSON.stringify(c?.body)}`);
  check(!(await dlg.isVisible()), `${tag}: the dialog stays open after a successful save`);
  const toastText = (await page.locator('body').textContent()) ?? '';
  check(toastText.includes(`سُجّلت أعمار الأطفال للحجز ${STUCK.ref}`), `${tag}: no toast after the save`);
  // the details again on the booking, now with its ages and no button
  await page.locator('[data-action="print"]').waitFor({ timeout: 10000 }).catch(() => {});
  const details = (await page.locator('[data-action="print"]').count()) ? ((await page.locator('dialog[open], [role="dialog"]').last().textContent()) ?? '') : '';
  check(details.includes('الأعمار: 5، 0'), `${tag}: the details did not reopen with the ages`);
  check((await page.locator('[data-action="set-ages"]').count()) === 0, `${tag}: the button stays after the ages are recorded`);
  await page.locator('[data-action="confirm"]').click();
  const cd2 = page.locator('dialog[open]').filter({ has: page.locator('[data-action="confirm-go"]') });
  await cd2.waitFor({ timeout: 10000 });
  await cd2.locator('#confirm-rt').selectOption(RT);
  await cd2.locator('[data-action="confirm-go"]').click();
  await page.waitForTimeout(1000);
  check(calls.filter((x) => x.fn === 'booking-admin').length === 2, `${tag}: the confirm after the ages was not sent`);
  check(((await page.locator('body').textContent()) ?? '').includes(`تم تأكيد الحجز ${STUCK.ref}`), `${tag}: the confirm after the ages did not succeed`);
  await ctx.close();

  // ── bookings: view ──
  const tag2 = `view @${w}`;
  const v = await context(browser, 'view', w, h);
  const p2 = await v.ctx.newPage();
  await openBooking(p2, STUCK.ref);
  check((await p2.locator('[data-action="set-ages"]').count()) === 0, `${tag2}: «تسجيل أعمار الأطفال» shown to a bookings: view user`);
  await v.ctx.close();
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`\nchildren-ages-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ children-ages-check: ${checks}/${checks} passed (screenshots in ${SHOTS})`);
