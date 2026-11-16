// Guest Hub H9 (16 Nov 2026) — «قائمة المغادرين», the switches in «الفريق والتقارير» and «حد الإرسال المشترك», offline (a
// Vite dev server on a stub Supabase origin, a fake session; nothing reaches a project):
//   the upload: the synthetic Nazeel export (scripts/fixtures/nazeel-sample.mjs) read IN THE BROWSER — the preview asked
//   with p_dry_run true and only {ref, first_name, phone} (never «الرصيد», «الوحدات», «الحالة»), the rows without a phone as
//   first names; H9 fix 1 (16 Nov 2026): the upload control — the drop zone with «رفع ملف نزيل», «أو اسحب الملف وأفلته هنا»
//   and the hint, the file's name and size with «تغيير» / «إزالة», the inline preview (kept, skipped with reasons and
//   names), the summary line above «حفظ القائمة» (disabled until a valid file), a file that cannot be read → its precise
//   reason inside the card (never a toast), Nazeel's real structure (every element prefixed x:) read in the browser,
//   a dropped file; «حفظ القائمة» → p_dry_run false; the branch and the date (the site's date picker, TODAY by default) —
//   never the date printed in the file; today's list missing → the banner with the reminders; ?hub_d=<branch> opens that
//   branch; screenshots of the control at both widths, light and dark (screenshots/departures/);
//   the list: the dry-run banner while a switch is off, «مجدولة» / «تجربة» / sent / the answers; «استبعاد» and «تمديد» with
//   «تراجع» (the same RPC back); no whole phone number on the page;
//   «الفريق والتقارير» → «قائمة المغادرين»: the system admin's «تشغيل» asks first (Confirm) and has «تراجع»; reception reads;
//   «إعدادات المساعد» → «حد الإرسال المشترك»: used, the limit, the reserve, the deferred.
// admin and reception × 1440 + 375 × light + dark, Western digits, no horizontal scroll, axe. Inside admin-hub-check.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nazeelXlsx, nazeelPrefixedXlsx, EXPECT, X_EXPECT } from '../../scripts/fixtures/nazeel-sample.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['departures', 'hub_team', 'assistant', 'inbox'];
const me = (role, branch, perms) => ({
  role, branch, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, perms[s] ?? 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const at = (h, m) => new Date(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`).toISOString();
const send = (state, over = {}) => ({ state, code: null, at: null, deferred: false, switch: false, planned: at(9, 30), due: at(19, 0), ...over });
const ROW = (n, over = {}) => ({
  id: id(100 + n), branch: 'airport-road', ref: `10090${n}`, first_name: ['Salem', 'عمر', 'John', 'لينا'][n - 1] ?? 'Guest', phone: `•••• 90${n}`, language: n === 2 ? 'ar' : 'en',
  date: today, cycle: 1, excluded: false, answer: null, answer_via: null, answer_at: null, check: send('scheduled'), review: send('scheduled'),
  can_exclude: true, can_extend: true, ...over,
});
const LIST = (on, branch = 'airport-road', empty = false) => ({
  branch, date: today, check_on: on, review_on: on, uploads: empty ? [] : [{ id: id(9), at: new Date().toISOString(), kept: 4, skipped: { no_phone: 1 }, moved: 0, removed: 0, by: 'استقبال طريق المطار' }],
  rows: empty ? [] : [ROW(1), ROW(2, { check: send('delivered', { at: at(9, 31), switch: on }), answer: 'leave', answer_via: 'button' }),
    ROW(3, { check: send('dry_run', { at: at(9, 30), code: 'switch_off' }) }), ROW(4, { answer: 'extend', answer_via: 'staff', review: send('cancelled', { code: 'extended' }) })],
  now: new Date().toISOString(),
});
const PREVIEW = (dry) => ({
  ok: true, dry_run: dry, branch: 'airport-road', date: today, upload_id: dry ? null : id(10),
  counts: { kept: 4, new: 4, same: 0, moved: 0, older: 0, removed: 0 }, kept_names: ['Salem', 'عمر', 'John', 'لينا'], languages: { ar: 2, en: 2 },
  skipped: { no_phone: { count: 1, names: ['فهد'] }, duplicate: { count: 2, names: ['Agent', 'Agent'] }, staff: { count: 0, names: [] }, bad_phone: { count: 0, names: [] }, bad_ref: { count: 0, names: [] } },
});
const OVERVIEW = (sys) => ({ today: today, system_admin: sys, can_edit: true, branches: [
  { branch: 'airport-road', check_on: false, review_on: false, last_upload: { date: today, at: new Date().toISOString(), kept: 4 }, today_uploaded: true, tomorrow_uploaded: false, reminders: [], today: { rows: 0, sent: 0, leave: 0, extend: 0 } },
  { branch: 'shafa-road', check_on: false, review_on: false, last_upload: { date: today, at: new Date().toISOString(), kept: 3 }, today_uploaded: false, tomorrow_uploaded: false,
    reminders: [{ round: 'r1', name: 'سالم', mode: 'session', status: 'sent', code: null, at: at(7, 0) }, { round: 'r2', name: 'سالم', mode: 'none', status: 'skipped', code: 'template_not_approved', at: at(8, 0) }],
    today: { rows: 0, sent: 0, leave: 0, extend: 0 } }] });
const LIMIT = { limit: 2000, reserve: 400, used: 137, checks: 12, reviews: 20, deferred: 0, pct: 7, at: new Date().toISOString(),
  tiers: [{ unit: 'airport-road', tier: 'TIER_2K', quality: 'GREEN' }, { unit: 'shafa-road', tier: 'TIER_2K', quality: 'GREEN' }] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: id(1), aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};
async function sane(page, tag) {
  const text = await page.evaluate(() => document.body.innerText);
  check(!/[٠-٩۰-۹]/.test(text), `${tag}: Western digits only`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal page scroll`);
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  check(v.length === 0, `${tag}: axe zero serious / critical — ${v.join(' ; ')}`);
}

const FILE = Buffer.from(nazeelXlsx({ order: 'nazeel', deflate: true }));
// Nazeel's real structure (H9 fix 1): every element prefixed x:, a BOM before each part, the header on row 12
const XFILE = Buffer.from(nazeelPrefixedXlsx({ prefix: true, deflate: true }));
const XEMPTY = Buffer.from(nazeelPrefixedXlsx({ rows: false }));
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHOTS = join(ROOT, '..', 'screenshots', 'departures');
mkdirSync(SHOTS, { recursive: true });
const ROLES = [['admin', null, { departures: 'edit', hub_team: 'edit', assistant: 'view' }], ['reception', 'airport-road', { departures: 'edit', hub_team: 'view', assistant: 'none' }]];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, branch, perms] of ROLES) {
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
      let on = false;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: scheme });
      await ctx.route(`${STUB}/**`, async (r) => {
        const u = r.request().url();
        const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
        const fn = (u.match(/\/rest\/v1\/rpc\/([a-z_]+)/) ?? [])[1];
        let body = null;
        try { body = r.request().postDataJSON(); } catch { /* none */ }
        if (fn) calls.push({ fn, body });
        if (fn === 'my_staff') return ok(me(role, branch, perms));
        if (fn === 'hub_departures_list') return ok(LIST(on, body?.p_branch ?? 'airport-road', body?.p_branch === 'shafa-road'));
        if (fn === 'hub_departures_upload') return ok(PREVIEW(body?.p_dry_run !== false));
        if (fn === 'hub_departure_exclude') return ok({ ok: true, row: ROW(1, { excluded: !!body?.p_on }) });
        if (fn === 'hub_departure_mark_extend') return ok({ ok: true, row: ROW(1) });
        if (fn === 'hub_departures_overview') return ok(OVERVIEW(role === 'admin'));
        if (fn === 'hub_departure_switch_set') return ok({ ok: true, previous: { check_on: false, review_on: false } });
        if (fn === 'hub_team_get') return ok({ now: new Date().toISOString(), can_edit: role === 'admin', is_system_admin: role === 'admin', branches: [], report: { send_time: '08:00', recipients: [], email_recipients: 0, last: null, staff_users: null } });
        if (/\/rest\/v1\/branches/.test(u)) return ok([{ slug: 'airport-road', name_ar: 'أرمادا ريزيدنس – طريق المطار', active: true, sort: 1 }, { slug: 'shafa-road', name_ar: 'أرمادا ريزيدنس – طريق الشفا', active: true, sort: 2 }]);
        if (/\/auth\/v1\/user/.test(u)) return ok(USER);
        if (fn) return ok(null);
        return ok([]);
      });
      await ctx.addInitScript(([k, v]) => {
        try { localStorage.setItem(k, v); localStorage.setItem('armada-tour-test', '0'); } catch {}
      }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION)]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      // ── «قائمة المغادرين» ──
      await page.goto(`${BASE}/departures`, { waitUntil: 'load' });
      await page.locator('[data-page="departures"] [data-row]').first().waitFor({ timeout: 30000 });
      const lc = calls.filter((c) => c.fn === 'hub_departures_list').at(-1);
      check(lc?.body?.p_branch === 'airport-road' && lc?.body?.p_date === today, `${tag}: the list of today by default (${JSON.stringify(lc?.body)})`);
      check(await page.locator('[data-dry-run]').count() === 1, `${tag}: the dry-run banner while the switches are off`);
      check(/تجربة: كانت ستُرسل 9:30 ص/.test(await page.locator(`[data-row="${id(101)}"] [data-cell="check"]`).innerText()), `${tag}: a scheduled check with the switch off says what WOULD be sent and when`);
      check(/خروج/.test(await page.locator(`[data-row="${id(102)}"] [data-cell="answer"]`).innerText()) && /وصلت/.test(await page.locator(`[data-row="${id(102)}"] [data-cell="check"]`).innerText()), `${tag}: sent / delivered and the answer «خروج»`);
      check(/تجربة بدون إرسال/.test(await page.locator(`[data-row="${id(103)}"] [data-cell="check"]`).innerText()), `${tag}: a dry run at 09:30`);
      check(/تمديد \(من الاستقبال\)/.test(await page.locator(`[data-row="${id(104)}"] [data-cell="answer"]`).innerText()), `${tag}: «تمديد» marked by reception`);
      const pageText = await page.locator('[data-page="departures"]').innerText();
      check(!/\+?\d{9,}/.test(pageText.replace(/\s/g, '')) || !/\+1555|\+9665/.test(pageText), `${tag}: no whole phone number on the page`);
      for (const k of ['dep-date', 'dep-upload', 'dep-table']) check(await page.locator(`[data-tour~="${k}"]`).count() > 0, `${tag}: the tour target ${k}`);
      check(await page.locator('[data-tour~="dep-date"] button').count() > 0 && await page.locator('input[type="date"]').count() === 0, `${tag}: the site's date picker (no native date input)`);

      // ── the upload control (H9 fix 1) ──
      const up = page.locator('[data-tour~="dep-upload"]');
      check(await up.locator('[data-dropzone]').count() === 1 && /أو اسحب الملف وأفلته هنا/.test(await up.innerText()), `${tag}: the drop zone with «أو اسحب الملف وأفلته هنا»`);
      check(/لوحة المعلومات ← الحجوزات ← تبويب «المغادرة» ← «اليوم» ← أيقونة الطباعة ← التنزيل ← Excel Worksheet/.test(await up.locator('[data-hint]').innerText())
        && !/مغادرين اليوم|تصدير إكسل/.test(await up.locator('[data-hint]').innerText()), `${tag}: the hint names Nazeel's real steps (H9 fix 2)`);
      const pick = up.locator('[data-action="pick"]');
      check(await pick.innerText() === 'رفع ملف نزيل' && /btn-primary/.test(await pick.getAttribute('class')), `${tag}: the bronze primary «رفع ملف نزيل» button`);
      check(await pick.getAttribute('aria-describedby') === 'dep-drop-hint' && await page.locator('#dep-file').getAttribute('tabindex') === '-1', `${tag}: keyboard reaches the button (the bare input is out of the tab order), the hint described`);
      const pickBox = await pick.boundingBox();
      check(!!pickBox && pickBox.height >= 40, `${tag}: a button large enough to tap (${pickBox?.height})`);
      check(/ستُحفظ قائمة فرع طريق المطار ليوم /.test(await page.locator('[data-summary-line]').innerText()), `${tag}: the summary line names the branch and the day`);
      check(await page.locator('[data-action="save"]').isDisabled(), `${tag}: «حفظ القائمة» disabled until a valid file`);
      await up.screenshot({ path: join(SHOTS, `upload-empty-${role}-${w}-${scheme}.png`) });
      // a click on the button opens the file picker
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), pick.click()]);
      check(!!chooser, `${tag}: «رفع ملف نزيل» opens the file picker`);
      // a file that cannot be read: its precise reason inside the card — never a toast
      await page.setInputFiles('#dep-file', { name: 'list.xlsx', mimeType: XLSX_MIME, buffer: Buffer.from('not a zip at all') });
      await page.locator('[data-read-error]').waitFor({ timeout: 10000 });
      check(/ليس ملف Excel يمكن قراءته[^]*تبويب «المغادرة» ← «اليوم»/.test(await page.locator('[data-read-error]').innerText()) && await page.locator('[data-toast]').count() === 0, `${tag}: a broken file → its reason in the card, no toast`);
      check(/list\.xlsx/.test(await page.locator('[data-file-name]').innerText()) && /ك\.ب/.test(await page.locator('[data-file-size]').innerText()), `${tag}: the file's name and size`);
      check(await page.locator('[data-action="save"]').isDisabled(), `${tag}: «حفظ القائمة» stays disabled after an unreadable file`);
      await page.locator('[data-action="remove"]').click();
      check(await page.locator('[data-dropzone]').count() === 1 && await page.locator('[data-read-error]').count() === 0, `${tag}: «إزالة» brings the drop zone back`);
      await page.setInputFiles('#dep-file', { name: 'empty.xlsx', mimeType: XLSX_MIME, buffer: XEMPTY });
      await page.locator('[data-read-error]').waitFor({ timeout: 10000 });
      check(/وجدنا صف العناوين لكن لا توجد تحته أي حجوزات/.test(await page.locator('[data-read-error]').innerText()), `${tag}: the header and no booking → «وجدنا صف العناوين لكن لا توجد تحته أي حجوزات»`);
      await sane(page, `${tag} the read error`);
      if (w === 1440) await up.screenshot({ path: join(SHOTS, `upload-error-${role}-${w}-${scheme}.png`) });
      // «تغيير»: Nazeel's real export (prefixed x:) read in the browser
      const [ch2] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.locator('[data-action="change"]').click()]);
      await ch2.setFiles({ name: 'ReservationDashboard.xlsx', mimeType: XLSX_MIME, buffer: XFILE });
      await page.locator('[data-preview]').waitFor({ timeout: 15000 });
      const xv = calls.filter((c) => c.fn === 'hub_departures_upload').at(-1)?.body ?? {};
      check(JSON.stringify((xv.p_rows ?? []).map((x) => ({ ref: x.ref, first_name: x.first_name, phone: x.phone }))) === JSON.stringify(X_EXPECT.kept)
        && JSON.stringify(xv.p_skipped?.no_phone) === JSON.stringify(X_EXPECT.no_phone), `${tag}: Nazeel's prefixed export read in the browser (16 guests, one without a phone)`);
      check(!/1250|75\.50|الفلتر|الطباعة/.test(JSON.stringify(xv)), `${tag}: never the balance, the filter label or the printed date`);
      await page.locator('[data-action="remove"]').click();
      // a dropped file (the synthetic export of H9)
      await page.locator('[data-dropzone]').evaluate(async (el, b64v) => {
        const bin = Uint8Array.from(atob(b64v), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bin], 'nazeel-departures.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, FILE.toString('base64'));
      await page.locator('[data-preview]').waitFor({ timeout: 15000 });
      const pv = calls.filter((c) => c.fn === 'hub_departures_upload').at(-1)?.body ?? {};
      check(pv.p_dry_run === true && pv.p_branch === 'airport-road' && pv.p_date === today, `${tag}: a dropped file — the preview asked first (p_dry_run), for the branch and today`);
      check(JSON.stringify((pv.p_rows ?? []).map((x) => ({ ref: x.ref, first_name: x.first_name, phone: x.phone }))) === JSON.stringify(EXPECT.kept)
        && (pv.p_rows ?? []).every((x) => Object.keys(x).sort().join() === 'first_name,phone,ref'), `${tag}: only booking number, first name and phone leave the browser — ${JSON.stringify(pv.p_rows)}`);
      check(JSON.stringify(pv.p_skipped?.no_phone) === JSON.stringify(EXPECT.no_phone), `${tag}: the rows without a phone as first names only`);
      check(!/1250|75\.5|مغادرة غدًا|2026-11-16 21:40/.test(JSON.stringify(pv)), `${tag}: never the balance, the status, the unit or the date printed in the file`);
      const dlg = await page.locator('[data-preview]').innerText();
      check(/سيُحفظ 4 ضيوف/.test(dlg) && /بلا رقم جوال: ضيف واحد — فهد/.test(dlg) && /رقم مكرر على أكثر من حجز/.test(dlg), `${tag}: the preview — kept, skipped with reasons and first names`);
      check(!(await page.locator('[data-action="save"]').isDisabled()), `${tag}: «حفظ القائمة» enabled with the branch, the date and a valid file`);
      await sane(page, `${tag} the preview`);
      await up.screenshot({ path: join(SHOTS, `upload-preview-${role}-${w}-${scheme}.png`) });
      await page.locator('[data-action="save"]').click();
      await page.locator('[data-preview]').waitFor({ state: 'detached', timeout: 10000 });
      check(calls.filter((c) => c.fn === 'hub_departures_upload').at(-1)?.body?.p_dry_run === false, `${tag}: «حفظ القائمة» saves (p_dry_run false)`);
      check(await page.locator('[data-dropzone]').count() === 1, `${tag}: after saving the drop zone is back`);

      // «استبعاد» → «تراجع»
      await page.locator(`[data-row="${id(101)}"] [data-action="exclude"]`).click();
      await page.locator('[data-toast="undo"]').waitFor({ timeout: 10000 });
      check(calls.filter((c) => c.fn === 'hub_departure_exclude').at(-1)?.body?.p_on === true, `${tag}: «استبعاد»`);
      await page.locator('[data-toast="undo"] [data-action="undo"]').click();
      await page.waitForTimeout(400);
      check(calls.filter((c) => c.fn === 'hub_departure_exclude').at(-1)?.body?.p_on === false, `${tag}: its «تراجع» sends it back`);
      await page.locator(`[data-row="${id(101)}"] [data-action="extend"]`).click();
      await page.locator('[data-toast="undo"]').waitFor({ timeout: 10000 });
      check(calls.filter((c) => c.fn === 'hub_departure_mark_extend').at(-1)?.body?.p_on === true, `${tag}: «تمديد» marked by reception`);
      await sane(page, `${tag} «قائمة المغادرين»`);

      // ── «الفريق والتقارير» → «قائمة المغادرين» ──
      await page.goto(`${BASE}/hub-team?tab=departures`, { waitUntil: 'load' });
      await page.locator('[data-dep-branch="airport-road"]').waitFor({ timeout: 30000 });
      if (role === 'admin') {
        await page.locator('[data-dep-branch="airport-road"] [data-switch="check"] [data-action="switch-on"]').click();
        await page.locator('dialog[open]').waitFor({ timeout: 5000 });
        check(calls.filter((c) => c.fn === 'hub_departure_switch_set').length === 0, `${tag}: «تشغيل» asks first — nothing sent before the confirm`);
        await page.locator('dialog[open] button', { hasText: 'تشغيل' }).last().click();
        await page.locator('[data-toast="undo"]').waitFor({ timeout: 10000 });
        const sw = calls.filter((c) => c.fn === 'hub_departure_switch_set').at(-1)?.body;
        check(sw?.p_branch === 'airport-road' && sw?.p_check === true && sw?.p_review === null, `${tag}: the switch for that branch and that kind only`);
      } else {
        check(await page.locator('[data-action="switch-on"]').count() === 0 && /لمدير النظام وحده/.test(await page.locator('[data-dep-branch="airport-road"]').innerText()), `${tag}: reception reads the switches, never switches`);
      }
      await sane(page, `${tag} «الفريق والتقارير»`);
      // ?hub_d=<branch> (the reminder's link) → «قائمة المغادرين» on that branch; today's list missing → the banner
      if (role === 'admin') {
        await page.goto(`${BASE}/?hub_d=shafa-road`, { waitUntil: 'load' });
        await page.locator('[data-missing-today]').waitFor({ timeout: 30000 });
        check(new URL(page.url()).pathname.endsWith('/departures') && calls.filter((c) => c.fn === 'hub_departures_list').at(-1)?.body?.p_branch === 'shafa-road', `${tag}: ?hub_d=shafa-road opens «قائمة المغادرين» on Shafa Road`);
        const mt = await page.locator('[data-missing-today]').innerText();
        check(/لم تُرفع قائمة اليوم لفرع طريق الشفا بعد/.test(mt) && /7:00 · سالم · رسالة واتساب — أُرسل/.test(mt) && /قالب التذكير لم يُعتمد بعد/.test(mt), `${tag}: the missing banner with today's reminders — ${mt.slice(0, 160)}`);
        await sane(page, `${tag} the missing list`);
      }
      check(errors.length === 0, `${tag}: no page error — ${errors.slice(0, 2).join(' | ')}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`hub-departures-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`hub-departures-ui-check: ${checks} checks passed`);
