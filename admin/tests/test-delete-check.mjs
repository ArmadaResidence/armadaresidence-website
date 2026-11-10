// «حذف نهائي» of a test booking and «استرجاع الحجز» (Ahmed, 10 Nov 2026 — DECISIONS.md 2026-11-10 «Session 23»). OFFLINE —
// no Supabase project is reached: a Vite dev server on a stub Supabase origin and a fake session (as
// audit-actors-check.mjs). The database refuses everyone but the system admin (supabase/tests/session23.sql,
// scripts/publish-log-check.mjs); this checks what the dashboard shows:
//   the system admin (role admin) — the booking details of a booking cancelled as «حجز تجريبي» show «حذف نهائي», a
//   booking cancelled for another reason does not; the dialog shows the ref, branch, dates and amount, its button stays
//   disabled until the ref is typed back (lower-case and Arabic-Indic digits forgiven), then calls
//   admin_test_booking_delete with the id and the ref; «السجل» shows the delete entry's chip and «استرجاع الحجز», whose
//   dialog calls admin_test_booking_restore with the delete batch; the type filter offers «نشر على الموقع»;
//   management — no «حذف نهائي» on the same booking, no chip or «استرجاع الحجز» in «السجل», no «نشر على الموقع» filter,
//   and the archive is never asked for.
// 1280 and 375, light. Screenshots in screenshots/test-delete/.
//   node admin/tests/test-delete-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const SHOTS = join(ROOT, 'screenshots', 'test-delete');
mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'bookings', 'audit', 'users'];
const meOf = (role) => ({
  role, branch: null, full_name: role === 'admin' ? 'مدير النظام للفحص' : 'الإدارة للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: role === 'admin' ? 10 : null,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === 'audit' ? 'view' : s === 'users' && role !== 'admin' ? 'none' : 'edit'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const RT = '00000000-0000-4000-8000-0000000000c1';
const now = new Date().toISOString();
const booking = (id, ref, code) => ({
  id, ref, status: 'cancelled', source: 'website', confirmation: 'instant', fallback_reason: null, branch: 'airport-road', room_type_id: RT,
  check_in: '2026-12-01', check_out: '2026-12-02', nights: 1, adults: 1, children: 0, children_ages: null, extra_beds: 0, breakfast: 'without',
  needs_coordination: false, capacity_at_request: 2, guest_name: 'ضيف الفحص', phone: '+966500000000', email: null, notes: null, locale: 'ar',
  room_total: 195, breakfast_total: 0, extra_beds_total: 0, total: 195, extra_bed_fee_per_night: null, pricing: { nights: [{ night: '2026-12-01', price: 195 }] },
  offer: null, promo_code: null, base_total: 195, discount_total: null, confirmed_at: now, cancelled_at: now, cancel_reason: null, cancel_reason_code: code,
  internal_notes: null, visit: null, payment_status: 'pay_at_hotel', is_test: false, created_at: now, updated_at: now,
});
const TEST = booking('00000000-0000-4000-8000-0000000000d1', 'AR-20261201-QA01', 'test_booking');
const OTHER = booking('00000000-0000-4000-8000-0000000000d2', 'AR-20261201-QA02', 'duplicate');
const BATCH = '00000000-0000-4000-8000-0000000000e1';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';
const AUDIT = [
  { id: 9, at: now, actor_id: ADMIN_ID, actor_label: 'مدير النظام للفحص', entity: 'reservations', entity_id: TEST.id, branch: 'airport-road', action: 'delete', old: { ref: TEST.ref, status: 'cancelled', cancel_reason_code: 'test_booking', total: 195 }, new: null, batch_id: BATCH, reverts_batch: null, is_test: false },
  { id: 8, at: now, actor_id: null, actor_label: 'system', entity: 'settings', entity_id: 'reply_alert_hours', branch: null, action: 'update', old: { value: 2 }, new: { value: 3 }, batch_id: null, reverts_batch: null, is_test: false },
];
const ARCHIVE = [{ batch_id: BATCH, ref: TEST.ref, branch: 'airport-road', check_in: '2026-12-01', check_out: '2026-12-02', total: 195, deleted_at: now, deleted_by_label: 'مدير النظام للفحص', restored_at: null, restored_by_label: null }];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: ADMIN_ID, aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: now };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};

async function context(browser, role, w, h) {
  const calls = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: 'light' });
  await ctx.route(`${STUB}/**`, async (r) => {
    const u = r.request().url();
    const cors = { 'access-control-allow-origin': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    const path = new URL(u).pathname;
    if (/\/rpc\/my_staff$/.test(path)) return ok(meOf(role));
    if (/\/auth\/v1\/user/.test(path)) return ok(USER);
    if (/\/rpc\/admin_test_booking_(delete|restore)$/.test(path)) {
      calls.push({ fn: path.split('/').pop(), body: JSON.parse(r.request().postData() || '{}') });
      return ok({ ok: true, ref: TEST.ref, batch_id: BATCH, profile_deleted: false });
    }
    if (/\/rpc\/audit_actors$/.test(path)) return ok([{ user_id: ADMIN_ID, full_name: 'مدير النظام للفحص', email: 'qa@example.invalid', active: true, is_staff: true }]);
    if (/\/rest\/v1\/deleted_test_bookings$/.test(path)) {
      calls.push({ fn: 'archive' });
      return ok(role === 'admin' ? ARCHIVE : []);
    }
    if (/\/rest\/v1\/reservations$/.test(path) && r.request().method() === 'GET') return ok([TEST, OTHER]);
    if (/\/rest\/v1\/room_types$/.test(path)) return ok([{ id: RT, branch: 'airport-road', slug: 'qa-room', name_ar: 'غرفة الفحص', name_en: 'QA room', bookable: true, active: true, sort: 1, base_rate: 195, capacity: 2, extra_beds_max: 0 }]);
    if (/\/rest\/v1\/branches$/.test(path)) return ok([{ slug: 'airport-road', name_ar: 'طريق المطار', name_en: 'Airport Road', sort: 1 }, { slug: 'shafa-road', name_ar: 'طريق الشفا', name_en: 'Shafa Road', sort: 2 }]);
    if (/\/rest\/v1\/audit_log$/.test(path)) {
      const q = new URL(u).searchParams;
      return ok(q.has('reverts_batch') ? [] : AUDIT);
    }
    if (/\/rest\/v1\/rpc\//.test(path)) return ok(null);
    return ok([]);
  });
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v); localStorage.setItem('armada-tour-test', '0'); } catch {}
  }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION)]);
  return { ctx, calls };
}

const openBooking = async (page, ref) => {
  await page.goto(`${BASE}/bookings`, { waitUntil: 'load' });
  await page.locator(`[data-ref="${ref}"]`).waitFor({ timeout: 30000 });
  await page.locator(`[data-ref="${ref}"]`).click();
  await page.locator('[data-action="print"]').waitFor({ timeout: 10000 });
};

const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h] of [[1280, 900], [375, 812]]) {
  // ── the system admin ──
  const tag = `admin @${w}`;
  const { ctx, calls } = await context(browser, 'admin', w, h);
  const page = await ctx.newPage();
  await openBooking(page, OTHER.ref);
  check((await page.locator('[data-action="delete-test"]').count()) === 0, `${tag}: «حذف نهائي» shown on a booking cancelled for another reason`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await openBooking(page, TEST.ref);
  const del = page.locator('[data-action="delete-test"]');
  check((await del.count()) === 1 && (await del.textContent())?.trim() === 'حذف نهائي', `${tag}: «حذف نهائي» missing on the test booking`);
  await del.click();
  const dlg = page.locator('dialog[open]').filter({ has: page.locator('[data-action="delete-test-go"]') });
  await dlg.waitFor({ timeout: 10000 });
  const summary = (await dlg.locator('[data-delete-summary]').textContent()) ?? '';
  check(summary.includes(TEST.ref) && summary.includes('طريق المطار') && /195/.test(summary) && /ديسمبر/.test(summary), `${tag}: the dialog summary lacks the ref / branch / dates / amount — «${summary}»`);
  const go = dlg.locator('[data-action="delete-test-go"]');
  check(await go.isDisabled(), `${tag}: the delete button is enabled before the ref is typed`);
  await dlg.locator('#delete-ref').fill('AR-20261201-QA02');
  check(await go.isDisabled(), `${tag}: the delete button is enabled with another booking's ref`);
  await dlg.locator('#delete-ref').fill('ar-٢٠٢٦١٢٠١-qa01');
  check(await go.isEnabled(), `${tag}: the ref typed lower-case with Arabic-Indic digits does not enable the button`);
  await page.screenshot({ path: join(SHOTS, `delete-dialog-${w}.png`) });
  await go.click();
  await page.waitForTimeout(800);
  const d = calls.find((c) => c.fn === 'admin_test_booking_delete');
  check(d && d.body.p_id === TEST.id && d.body.p_ref === TEST.ref, `${tag}: admin_test_booking_delete called with ${JSON.stringify(d?.body)}`);
  // «السجل»
  await page.goto(`${BASE}/audit`, { waitUntil: 'load' });
  await page.locator('[data-list="audit"] li').first().waitFor({ timeout: 30000 });
  await page.locator('[data-deleted-test]').waitFor({ timeout: 10000 }).catch(() => {});
  check((await page.locator(`[data-deleted-test="${TEST.ref}"]`).count()) === 1, `${tag}: «السجل» shows no delete chip`);
  const opt = await page.$$eval('#a-entity option', (o) => o.map((x) => x.value));
  check(opt.includes('media_publish_jobs'), `${tag}: the type filter lacks «نشر على الموقع» for the admin`);
  const restore = page.locator('[data-action="restore-test"]');
  check((await restore.count()) === 1, `${tag}: «استرجاع الحجز» missing`);
  if (await restore.count()) {
    await restore.click();
    const rd = page.locator('dialog[open]').filter({ has: page.locator('[data-action="restore-test-go"]') });
    await rd.waitFor({ timeout: 10000 });
    check(((await rd.textContent()) ?? '').includes(TEST.ref), `${tag}: the restore dialog does not name the booking`);
    await page.screenshot({ path: join(SHOTS, `restore-dialog-${w}.png`) });
    await rd.locator('[data-action="restore-test-go"]').click();
    await page.waitForTimeout(800);
    const r = calls.find((c) => c.fn === 'admin_test_booking_restore');
    check(r && r.body.p_batch === BATCH, `${tag}: admin_test_booking_restore called with ${JSON.stringify(r?.body)}`);
  }
  await ctx.close();

  // ── management ──
  const tag2 = `management @${w}`;
  const m = await context(browser, 'management', w, h);
  const p2 = await m.ctx.newPage();
  await openBooking(p2, TEST.ref);
  check((await p2.locator('[data-action="delete-test"]').count()) === 0, `${tag2}: «حذف نهائي» shown to management`);
  check((await p2.locator('[data-action="cancel"]').count()) === 0, `${tag2}: the details are not those of a cancelled booking`);
  await p2.goto(`${BASE}/audit`, { waitUntil: 'load' });
  await p2.locator('[data-list="audit"] li').first().waitFor({ timeout: 30000 });
  await p2.waitForTimeout(800);
  check((await p2.locator('[data-deleted-test], [data-action="restore-test"]').count()) === 0, `${tag2}: the delete chip or «استرجاع الحجز» shown to management`);
  check(!m.calls.some((c) => c.fn === 'archive'), `${tag2}: the archive was asked for`);
  const opt2 = await p2.$$eval('#a-entity option', (o) => o.map((x) => x.value));
  check(!opt2.includes('media_publish_jobs'), `${tag2}: the type filter offers «نشر على الموقع» to management`);
  check((await p2.locator('a[href*="github.com"]').count()) === 0, `${tag2}: a GitHub link on «السجل»`);
  await m.ctx.close();
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`\ntest-delete-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ test-delete-check: ${checks}/${checks} passed (screenshots in ${SHOTS})`);
