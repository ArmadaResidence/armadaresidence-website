// «الغرف» — room types managed from the dashboard (10 Nov 2026, DECISIONS.md 2026-11-10 «Room types from the dashboard»).
// OFFLINE — no Supabase project is reached: a Vite dev server on a stub Supabase origin and a fake session (as
// test-delete-check.mjs). The database decides every rule (supabase/tests/room-types.sql; the CI end to end
// scripts/rooms-e2e.mjs on a preview branch); this checks what the page does with them:
//   an editor — both branches with their unit line (the sum, or what is missing); «إضافة نوع غرفة» opens the form, the
//   local checks (no English name) block the save, «شقق مخدومة» is refused before sending, Arabic-Indic digits are sent
//   Western, the payload carries the branch, the features and the equipment in order; a server refusal lists its
//   problems in Arabic and keeps the dialog open; a saved add closes it and offers «تراجع» (revert_batch); «تعديل»
//   shows the fixed address; «إظهار على الموقع» on an incomplete type lists what is missing and calls nothing; «حذف
//   النوع» on a booked type explains why and offers «إخفاء من الموقع», on a never-booked one confirms and calls
//   room_type_delete; ▲ / ▼ send the branch's ids swapped; the site rebuild is asked after a change;
//   reception (rooms: view) — no add / hide / delete / order buttons, «عرض» opens the form read-only.
// 1280 and 375, light.
//   node admin/tests/rooms-page-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'rooms', 'rates', 'inventory', 'audit'];
const meOf = (role) => ({
  role, branch: role === 'reception' ? 'airport-road' : null, full_name: role, active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: false, backup_codes_left: null,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, role === 'reception' ? 'view' : 'edit'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const base = { category: 'standard', size_m2: 50, bed_ar: 'سرير كينج', bed_en: 'King bed', capacity: 2, extra_beds_max: 0, base_rate: 185, features: [], amenities: ['wifi', 'tv'], description_ar: 'وصف', description_en: 'Text', show_home: false, type_code: null, is_test: false, max_inventory: 0, visible: true };
const ROWS = [
  { ...base, id: 'a0000000-0000-4000-8000-000000000001', branch: 'airport-road', slug: 'king-room', name_ar: 'غرفة بسرير كينج', name_en: 'King Room', units: 30, sort: 0, on_site: true, bookable: true, missing: [], booked: true },
  { ...base, id: 'a0000000-0000-4000-8000-000000000002', branch: 'airport-road', slug: 'twin-room', name_ar: 'غرفة سريرين', name_en: 'Twin Room', units: null, sort: 1, on_site: true, bookable: true, missing: ['units'], booked: false },
  { ...base, id: 'a0000000-0000-4000-8000-000000000003', branch: 'airport-road', slug: 'garden-suite', name_ar: 'جناح الحديقة', name_en: 'Garden Suite', units: null, sort: 2, on_site: false, bookable: false, missing: ['units', 'cover'], booked: false, visible: false },
  { ...base, id: 'b0000000-0000-4000-8000-000000000001', branch: 'shafa-road', slug: 'king-room', name_ar: 'غرفة بسرير كينج', name_en: 'King Room', units: 20, sort: 0, on_site: true, bookable: true, missing: [], booked: false },
];
const now = new Date().toISOString();
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

async function context(browser, role, w, h, opts = {}) {
  const calls = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: 'light' });
  await ctx.route(`${STUB}/**`, async (r) => {
    const u = r.request().url();
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    const path = new URL(u).pathname;
    const fn = path.split('/').pop();
    const body = (() => {
      try {
        return JSON.parse(r.request().postData() || '{}');
      } catch {
        return {};
      }
    })();
    if (fn === 'my_staff') return ok(meOf(role));
    if (/\/auth\/v1\/user/.test(path)) return ok(USER);
    if (fn === 'room_types_admin') return ok(ROWS);
    if (/\/rest\/v1\/branches$/.test(path)) return ok([{ slug: 'airport-road', name_ar: 'طريق المطار', name_en: 'Airport Road', sort: 1 }, { slug: 'shafa-road', name_ar: 'طريق الشفا', name_en: 'Shafa Road', sort: 2 }]);
    if (fn === 'site-rebuild') {
      calls.push({ fn });
      return ok({ ok: true, dispatched: true });
    }
    if (['room_type_save', 'room_type_set_on_site', 'room_types_reorder', 'room_type_delete', 'revert_batch'].includes(fn)) {
      calls.push({ fn, body });
      if (fn === 'room_type_save' && opts.refuse && !calls.some((c) => c.refused)) {
        calls[calls.length - 1].refused = true;
        return r.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: '22023', message: 'invalid', details: JSON.stringify([{ field: 'description', code: 'forbidden_term', lang: 'en', term: 'serviced apartment' }]), hint: null }) });
      }
      return ok({ ok: true, batch_id: 'c0000000-0000-4000-8000-000000000001', id: 'a0000000-0000-4000-8000-000000000009', slug: 'new-suite', missing: ['cover'] });
    }
    if (/\/rest\/v1\/rpc\//.test(path)) return ok(null);
    return ok([]);
  });
  await ctx.addInitScript(([k, v]) => {
    try {
      localStorage.setItem(k, v);
      localStorage.setItem('armada-tour-test', '0');
    } catch {}
  }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION)]);
  return { ctx, calls };
}

const open = async (page) => {
  await page.goto(`${BASE}/rooms`, { waitUntil: 'load' });
  await page.locator('[data-room="airport-road/king-room"]').waitFor({ timeout: 30000 });
};
const dialog = (page, sel) => page.locator('dialog[open]').filter({ has: page.locator(sel) });

const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h] of [[1280, 900], [375, 812]]) {
  const tag = `editor @${w}`;
  const { ctx, calls } = await context(browser, 'management', w, h, { refuse: true });
  const page = await ctx.newPage();
  await open(page);
  const unitsA = (await page.locator('[data-units-total="airport-road"]').textContent()) ?? '';
  const unitsS = (await page.locator('[data-units-total="shafa-road"]').textContent()) ?? '';
  check(/30/.test(unitsA) && /ينقص/.test(unitsA), `${tag}: Airport Road's unit line should give the sum so far and what is missing — «${unitsA}»`);
  check(/20/.test(unitsS) && /يعرضه الموقع/.test(unitsS), `${tag}: Shafa Road's unit line should be the complete total — «${unitsS}»`);
  check((await page.locator('[data-room="airport-road/garden-suite"] [data-room-missing]').count()) === 1, `${tag}: the hidden incomplete type does not say what it lacks`);
  check(((await page.locator('[data-room="airport-road/twin-room"] [data-room-slug]').textContent()) ?? '').includes('/airport-road/twin-room/'), `${tag}: the page address is not shown`);

  // add: local checks, the forbidden term, digits, the payload, a server refusal, then the save
  await page.locator('[data-rooms-branch="airport-road"] [data-action="room-add"]').click();
  const form = dialog(page, '[data-room-form]');
  await form.waitFor({ timeout: 10000 });
  await form.locator('[data-field="name_ar"]').fill('جناح جديد');
  await form.locator('[data-action="room-save"]').click();
  await page.waitForTimeout(300);
  check(((await form.locator('[data-room-problems]').textContent()) ?? '').includes('الاسم بالإنجليزية'), `${tag}: saving without an English name is not refused in the form`);
  check(!calls.some((c) => c.fn === 'room_type_save'), `${tag}: an incomplete form was sent`);
  await form.locator('[data-field="name_en"]').fill('New Suite');
  await form.locator('[data-field="description_ar"]').fill('شقق مخدومة فاخرة');
  await form.locator('[data-action="room-save"]').click();
  await page.waitForTimeout(300);
  check(((await form.locator('[data-room-problems]').textContent()) ?? '').includes('شقق مخدومة'), `${tag}: «شقق مخدومة» is not refused in the form`);
  check(!calls.some((c) => c.fn === 'room_type_save'), `${tag}: a forbidden term was sent`);
  await form.locator('[data-field="description_ar"]').fill('جناح بغرفة وصالة.');
  await form.locator('[data-field="units"]').fill('٤');
  await form.locator('[data-field="size_m2"]').fill('٧٠٫٥');
  await form.locator('[data-feature="kitchen"]').check();
  await form.locator('[data-amenity="iron"]').uncheck();
  await form.locator('[data-action="room-save"]').click();
  await page.waitForTimeout(800);
  const first = calls.find((c) => c.fn === 'room_type_save');
  check(first && first.body.p_id === null && first.body.p.branch === 'airport-road' && first.body.p.units === 4 && first.body.p.size_m2 === 70.5
    && JSON.stringify(first.body.p.features) === '["kitchen"]' && !first.body.p.amenities.includes('iron') && first.body.p.amenities[0] === 'wifi',
  `${tag}: the add payload — ${JSON.stringify(first?.body)}`);
  check(((await form.locator('[data-room-problems]').textContent()) ?? '').includes('serviced apartment') && (await form.count()) === 1, `${tag}: a server refusal is not listed in Arabic in the open dialog`);
  await form.locator('[data-field="description_en"]').fill('A suite with a bedroom and a living room.');
  await form.locator('[data-action="room-save"]').click();
  await page.waitForTimeout(1000);
  check((await dialog(page, '[data-room-form]').count()) === 0, `${tag}: the dialog stays open after a saved add`);
  check(calls.some((c) => c.fn === 'site-rebuild'), `${tag}: no site rebuild asked after the add`);
  const undo = page.getByRole('button', { name: 'تراجع' });
  check((await undo.count()) >= 1, `${tag}: no «تراجع» after the add`);
  if (await undo.count()) {
    await undo.first().click();
    await page.waitForTimeout(600);
    check(calls.some((c) => c.fn === 'revert_batch' && c.body.p_batch === 'c0000000-0000-4000-8000-000000000001'), `${tag}: «تراجع» did not call revert_batch with the batch`);
  }

  // edit: the fixed address
  await page.locator('[data-room="airport-road/twin-room"] [data-action="room-edit"]').click();
  const ed = dialog(page, '[data-room-form]');
  await ed.waitFor({ timeout: 10000 });
  check(((await ed.textContent()) ?? '').includes('/airport-road/twin-room/') && ((await ed.textContent()) ?? '').includes('لا الرابط'), `${tag}: the edit dialog does not say the address is fixed`);
  await ed.locator('[data-action="dialog-cancel"]').click();
  await page.waitForTimeout(300);

  // show an incomplete type: the missing list, no call
  const before = calls.length;
  await page.locator('[data-room="airport-road/garden-suite"] [data-action="room-show"]').click();
  const miss = dialog(page, '[data-room-missing-dialog]');
  await miss.waitFor({ timeout: 10000 });
  const items = await miss.locator('[data-missing]').evaluateAll((els) => els.map((e) => e.getAttribute('data-missing')));
  check(JSON.stringify(items) === '["units","cover"]' && ((await miss.textContent()) ?? '').includes('صورة غلاف'), `${tag}: the missing list — ${JSON.stringify(items)}`);
  check(!calls.slice(before).some((c) => c.fn === 'room_type_set_on_site'), `${tag}: «إظهار» was sent for an incomplete type`);
  await miss.locator('[data-action="dialog-cancel"]').click();
  await page.waitForTimeout(300);

  // delete: booked → explained + hide offered; never booked → confirm + call
  await page.locator('[data-room="airport-road/king-room"] [data-action="room-delete"]').click();
  await page.waitForTimeout(300);
  const no = page.locator('dialog[open]').filter({ hasText: 'لا يُحذف هذا النوع' });
  check((await no.count()) === 1 && ((await no.textContent()) ?? '').includes('إخفاء من الموقع'), `${tag}: a booked type's delete does not explain why or offer «إخفاء»`);
  await no.getByRole('button', { name: 'إخفاء من الموقع' }).click();
  await page.waitForTimeout(800);
  check(calls.some((c) => c.fn === 'room_type_set_on_site' && c.body.p_id === ROWS[0].id && c.body.p_on === false), `${tag}: «إخفاء من الموقع» from the delete dialog was not sent`);
  check(!calls.some((c) => c.fn === 'room_type_delete' && c.body.p_id === ROWS[0].id), `${tag}: a booked type was deleted`);
  await page.locator('[data-room="airport-road/twin-room"] [data-action="room-delete"]').click();
  const conf = page.locator('dialog[open]').filter({ hasText: 'حذف نوع الغرفة' });
  await conf.waitFor({ timeout: 10000 });
  await conf.getByRole('button', { name: 'حذف نوع الغرفة' }).click();
  await page.waitForTimeout(800);
  check(calls.some((c) => c.fn === 'room_type_delete' && c.body.p_id === ROWS[1].id), `${tag}: room_type_delete not called for a never-booked type`);

  // order
  await page.locator('[data-room="airport-road/twin-room"] [data-action="room-up"]').click();
  await page.waitForTimeout(800);
  const ord = calls.find((c) => c.fn === 'room_types_reorder');
  check(ord && ord.body.p_branch === 'airport-road' && JSON.stringify(ord.body.p_ids) === JSON.stringify([ROWS[1].id, ROWS[0].id, ROWS[2].id]), `${tag}: ▲ sent ${JSON.stringify(ord?.body)}`);
  check((await page.locator('[data-room="airport-road/king-room"] [data-action="room-up"]').isDisabled()), `${tag}: ▲ enabled on the first type`);
  await ctx.close();

  // reception: view only
  const tag2 = `reception @${w}`;
  const rc = await context(browser, 'reception', w, h);
  const p2 = await rc.ctx.newPage();
  await open(p2);
  check((await p2.locator('[data-action="room-add"], [data-action="room-delete"], [data-action="room-hide"], [data-action="room-show"], [data-action="room-up"]').count()) === 0, `${tag2}: editing controls shown to reception`);
  await p2.locator('[data-room="airport-road/king-room"] [data-action="room-edit"]').click();
  const ro = dialog(p2, '[data-room-form]');
  await ro.waitFor({ timeout: 10000 });
  check((await ro.locator('[data-field="name_ar"]').isDisabled()) && (await ro.locator('[data-action="room-save"]').count()) === 0, `${tag2}: the form is not read-only`);
  await rc.ctx.close();
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`\nrooms-page-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ rooms-page-check: ${checks}/${checks} passed`);
