// «إعدادات المساعد» (Guest Hub H1, 13 Nov 2026 — DECISIONS.md 2026-11-13 «Guest Hub H1 — foundations»). OFFLINE — no
// Supabase project and no YCloud is reached: the dashboard runs on a Vite dev server whose Supabase URL is a stub origin,
// with a fake session (as admin/tests/audit-actors-check.mjs). The stub answers hub_assistant_overview with the four
// units (the café and the rooftop hidden, every mode off; since H5, 14 Nov 2026, the engine ready, the budgets 20 / 200,
// what «تجربة» lacks = the unverified channel, «بموافقة الفريق» also the test lab), the two branch channels, the
// templates hub_reply_ready ar + en APPROVED on both numbers, no alert, no recipient; hub_budget_overview with the
// prices read on 14 Nov 2026.
// H5: «الميزانية» — the budgets shown, editable by the system admin only (hub_setting_set per changed key), read-only for
// a viewer; the prices with their date; a mode or «المساعد يعمل» asks nothing the server refuses (the test lab, the
// system admin).
// Checked at 1440 and 375, light and dark, for the system admin (assistant edit) and for management (view):
//   - the page, the «not yet» note, four unit cards with the two dining units «مخفية», every mode «متوقف», the gates;
//   - nothing the server refuses is asked: «المساعد يعمل» and every mode but «متوقف» open «لا يُشغَّل…» with the gates and
//     never call hub_setting_set / hub_unit_mode_set; «تخزين المحادثات» (no gate left since H2) goes to hub_setting_set;
//   - «استقبال واتساب» (H2): the four events with their state; «تحديث أحداث الاستقبال» for the system admin only, calling
//     hub-admin update_webhook_events and nothing else;
//   - «تعديل الفريق»: the shared Modal, its dirty guard (× on a change asks «تعديلات غير محفوظة»), «حفظ الفريق» sends the
//     whole list to hub_unit_members_set, then the «تراجع» toast;
//   - «تحقق من القناة» and «تحديث حالة القوالب» call hub-admin with their actions only; the templates table shows «معتمد»;
//   - «ملخص الصباح»: an added address cannot be «مفعّل» before «فلتر البريد مؤكَّد»; «حفظ المستلمين» sends the list;
//   - every data-tour target of the page tour exists; Western digits only; no horizontal scroll; management sees no
//     edit control and the switches disabled.
// Screenshots in screenshots/hub/.
//   node admin/tests/hub-assistant-ui-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const SHOTS = join(ROOT, 'screenshots', 'hub');
mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'audit', 'inbox', 'knowledge', 'assistant', 'radar', 'now'];
const me = (role, level) => ({
  role, branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === 'assistant' ? level : 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STAFF = [
  { staff_id: id(1), full_name: 'أحمد — مدير النظام', role: 'admin', branch: null },
  { staff_id: id(2), full_name: 'الإدارة', role: 'management', branch: null },
  { staff_id: id(3), full_name: 'استقبال طريق المطار', role: 'reception', branch: 'airport-road' },
  { staff_id: id(4), full_name: 'استقبال طريق الشفا', role: 'reception', branch: 'shafa-road' },
];
const member = (s) => ({ ...s, active: true });
const GATES = ['channel'];
const GATES_SHADOW = ['channel', 'test_lab'];
const BUDGET = { day: '2026-11-14', month: '2026-11', alert_pct: 80, daily_budget: 20, monthly_budget: 200, daily_spent: 0.42, monthly_spent: 3.1, unset: false, capped: false,
  daily_capped: false, monthly_capped: false, daily_alert: false, monthly_alert: false, api_credit: false, api_credit_since: null, api_credit_last_try: null };
const ch = (n, address, waba) => ({ id: id(100 + n), kind: 'whatsapp', address, waba_id: waba, display_name: null, connected: true, verified_at: null, provider_status: null, quality_rating: null, messaging_limit: null, sending_enabled: false });
const OVERVIEW = (canEdit, sysAdmin) => ({
  can_edit: canEdit, system_admin: sysAdmin, all_branches: true, engine_ready: true, inbox_ready: true, budget: BUDGET,
  units: [
    { id: id(11), key: 'airport-road', kind: 'branch', name_ar: 'فرع طريق المطار', name_en: 'Airport Road', branch: 'airport-road', status: 'active', mode: 'off', skills: [], sort: 10, persona_published: true, venue: null, channels: [ch(1, '+966536622277', '3187536471439127')], members: [member(STAFF[0]), member(STAFF[1]), member(STAFF[2])], gates: GATES, gates_shadow: GATES_SHADOW },
    { id: id(12), key: 'shafa-road', kind: 'branch', name_ar: 'فرع طريق الشفا', name_en: 'Shafa Road', branch: 'shafa-road', status: 'active', mode: 'off', skills: [], sort: 20, persona_published: true, venue: null, channels: [ch(2, '+966536663030', '329667206894245')], members: [member(STAFF[0]), member(STAFF[1]), member(STAFF[3])], gates: GATES, gates_shadow: GATES_SHADOW },
    { id: id(13), key: 'lobby-cafe', kind: 'dining', name_ar: 'مقهى ومطعم أرمادا ريزيدنس', name_en: 'Armada Residence Café & Restaurant', branch: 'airport-road', status: 'hidden', mode: 'off', skills: [], sort: 30, persona_published: false, venue: { id: id(21), slug: 'armada-residence-cafe', name_ar: 'مقهى ومطعم أرمادا ريزيدنس', name_en: 'Armada Residence Café & Restaurant', status: 'active', menu: 'internal' }, channels: [], members: [member(STAFF[0]), member(STAFF[1])], gates: ['hidden', 'channel', 'persona', 'skills'], gates_shadow: ['hidden', 'channel', 'persona', 'skills', 'test_lab'] },
    { id: id(14), key: 'rooftop', kind: 'dining', name_ar: 'لاريو', name_en: 'LARIO', branch: 'airport-road', status: 'hidden', mode: 'off', skills: [], sort: 40, persona_published: false, venue: { id: id(22), slug: 'lario', name_ar: 'مطعم ومقهى عالمي', name_en: 'International Dining & Café', status: 'hidden', menu: 'none' }, channels: [], members: [member(STAFF[0]), member(STAFF[1])], gates: ['hidden', 'channel', 'persona', 'skills', 'menu_link'], gates_shadow: ['hidden', 'channel', 'persona', 'skills', 'menu_link', 'test_lab'] },
  ],
  staff: STAFF,
  settings: { hub_assistant_on: false, hub_inbox_on: false, hub_summary_time: '08:00', hub_summary_money: false, hub_budget_daily_usd: 20, hub_budget_monthly_usd: 200, hub_budget_alert_pct: 80 },
  switch_gates: { hub_assistant_on: sysAdmin ? ['inbox_on'] : ['inbox_on', 'system_admin'], hub_inbox_on: [] },
  recipients: [],
  templates: ['airport-road', 'shafa-road'].flatMap((u, i) => ['ar', 'en'].map((language) => ({ channel_id: id(101 + i), unit: u, name: 'hub_reply_ready', language, category: 'UTILITY', status: 'APPROVED', reason: null, read_at: '2026-11-13T12:00:00Z' }))),
  alerts: [],
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: id(1), aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };
const TOUR = ['hub-switches', 'hub-budget', 'hub-webhook', 'hub-units', 'hub-verify', 'hub-team', 'hub-mode', 'hub-templates', 'hub-summary', 'hub-alerts'];
const BUDGET_OVERVIEW = (sysAdmin) => ({
  state: BUDGET, system_admin: sysAdmin,
  prices: { 'claude-haiku-5-5': { input: 0.1, output: 0.5, read_at: '2026-11-14' }, 'claude-sonnet-5-5': { input: 2, output: 10, read_at: '2026-11-14' } },
  models: { understand: 'claude-haiku-5-5', tag: 'claude-haiku-5-5', translate: 'claude-haiku-5-5', compose: 'claude-sonnet-5-5', suggest: 'claude-sonnet-5-5' },
  by_unit: [{ unit: 'airport-road', name: 'فرع طريق المطار', today: 0.42, month: 3.1 }],
  by_layer: [{ layer: 'understand', source: 'turn', calls: 12, today: 0.02, month: 0.3 }, { layer: 'compose', source: 'turn', calls: 9, today: 0.4, month: 2.8 }],
});

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};
const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, level] of [['admin', 'edit'], ['management', 'view']]) {
  const edit = level === 'edit';
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: scheme });
      await ctx.route(`${STUB}/**`, async (r) => {
        const u = r.request().url();
        const cors = { 'access-control-allow-origin': '*' };
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
        const fn = (u.match(/\/rest\/v1\/rpc\/([a-z_]+)/) ?? u.match(/\/functions\/v1\/([a-z-]+)/) ?? [])[1];
        let body = null;
        try { body = r.request().postDataJSON(); } catch { /* none */ }
        if (fn) calls.push({ fn, body });
        if (fn === 'my_staff') return ok(me(role, level));
        if (fn === 'hub_assistant_overview') return ok(OVERVIEW(edit, role === 'admin'));
        if (fn === 'hub_budget_overview') return ok(BUDGET_OVERVIEW(role === 'admin'));
        if (fn === 'hub_webhook_status') return ok({ system_admin: role === 'admin', registered: true, events: ['whatsapp.inbound_message.received', 'whatsapp.message.updated'], registered_at: '2026-11-09T07:44:00Z' });
        if (fn === 'hub_setting_set') return ok({ ok: true, batch_id: id(901) });
        if (fn === 'hub-admin' && body?.action === 'update_webhook_events') return ok({ ok: true, added: ['whatsapp.smb.message.echoes', 'whatsapp.phone_number.quality_updated'], events: [] });
        // H3: the page reads the endpoint's events from YCloud on load (GET only, recorded by the server)
        if (fn === 'hub-admin' && body?.action === 'read_webhook_events') return ok({ ok: true, events: ['whatsapp.inbound_message.received', 'whatsapp.message.updated'], changed: false });
        if (fn === 'hub_channel_sending_set') return ok({ ok: true, batch_id: id(902) });
        if (fn === 'hub_unit_members_set' || fn === 'hub_summary_recipients_set') return ok({ ok: true, batch_id: id(900), count: 1 });
        if (fn === 'hub-admin' && body?.action === 'verify_channel') return ok({ ok: true, display_name: 'أرمادا ريزيدنس طريق المطار', status: 'CONNECTED', quality_rating: 'GREEN', messaging_limit: 'TIER_2K' });
        if (fn === 'hub-admin' && body?.action === 'refresh_templates') return ok({ ok: true, results: [{ channel: id(101), ok: true, count: 2 }, { channel: id(102), ok: true, count: 2 }] });
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
      await page.goto(`${BASE}/assistant`, { waitUntil: 'load' });
      await page.locator('[data-page="assistant"] [data-unit]').first().waitFor({ timeout: 30000 });

      const units = await page.$$eval('[data-unit]', (a) => a.map((x) => ({ key: x.getAttribute('data-unit'), status: x.getAttribute('data-unit-status'), chip: x.querySelector('[data-unit-chip]')?.textContent?.trim(), mode: x.querySelector('[data-unit-mode]')?.getAttribute('data-unit-mode') })));
      check(units.length === 4, `${tag}: four unit cards (${units.length})`);
      check(units.filter((x) => x.status === 'hidden').map((x) => x.key).join() === 'lobby-cafe,rooftop' && units.filter((x) => x.chip === 'مخفية').length === 2, `${tag}: the café and the rooftop shown «مخفية» — ${JSON.stringify(units)}`);
      check(units.every((x) => x.mode === 'off'), `${tag}: every mode off`);
      check((await page.locator('[data-unit="lobby-cafe"] h3').textContent())?.includes('مقهى ومطعم أرمادا ريزيدنس'), `${tag}: the café unit carries «مقهى ومطعم أرمادا ريزيدنس»`);
      check(await page.locator('[data-hub-not-yet]').isVisible(), `${tag}: the «switching on comes later» note is on screen`);
      check((await page.locator('[data-unit="airport-road"] [data-unit-gates]').textContent())?.includes('قناة واتساب'), `${tag}: «تجربة» lacks the verified channel only`);
      check((await page.locator('[data-unit="airport-road"] [data-unit-gates-shadow]').textContent())?.includes('مختبر الاختبار'), `${tag}: «بموافقة الفريق» also waits for the test lab`);
      // H5: «الميزانية»
      await page.locator('[data-budget-prices]').waitFor({ timeout: 10000 }).catch(() => {});
      check(await page.locator('[data-hub-budget]').isVisible(), `${tag}: «الميزانية» is on the page`);
      check((await page.locator('[data-budget="daily"]').inputValue()) === '20' && (await page.locator('[data-budget="monthly"]').inputValue()) === '200' && (await page.locator('[data-budget="pct"]').inputValue()) === '80',
        `${tag}: the budgets 20 / 200 and the alert at 80 %`);
      check((await page.locator('[data-budget-spent]').innerText()).includes('0.42 دولار'), `${tag}: spent today in dollars`);
      check((await page.locator('[data-budget-prices]').innerText()).includes('2026-11-14') && (await page.locator('[data-budget-model]').count()) === 5, `${tag}: the five models and their prices with the date read`);
      check((await page.locator('[data-api-credit="ok"]').count()) === 1, `${tag}: the Claude credit «متاح»`);
      check((await page.locator('[data-action="budget-save"]').count()) === (role === 'admin' ? 1 : 0) && (await page.locator('[data-budget="daily"]').isDisabled()) === (role !== 'admin'),
        `${tag}: the budgets editable by the system admin only`);
      check((await page.locator('[data-switch-input]').count()) === 2 && (await page.$$eval('[data-switch-input]', (a) => a.every((x) => !x.checked))), `${tag}: both global switches off`);
      check((await page.locator('[data-template-status="APPROVED"]').count()) === 4 && (await page.locator('[data-templates] tbody').textContent()).includes('معتمد'), `${tag}: hub_reply_ready ar + en «معتمد» on both numbers`);
      check((await page.locator('[data-channel="+966536622277"]').textContent()).includes('+966 53 662 2277'), `${tag}: the Airport Road number spaced`);
      check(await page.locator('[data-alerts-empty]').isVisible(), `${tag}: «لا تنبيهات مفتوحة»`);
      const hookRows = await page.$$eval('[data-webhook-event]', (a) => a.map((x) => x.getAttribute('data-on')));
      check(hookRows.join() === 'yes,yes,no,no', `${tag}: «استقبال واتساب» lists four events, the two hub events not yet on — ${hookRows.join()}`);
      check((await page.locator('[data-action="webhook-events"]').count()) === (role === 'admin' ? 1 : 0), `${tag}: «تحديث أحداث الاستقبال» shown to the system admin only`);
      // H3: the events are read from YCloud on load, once, by those who may read YCloud (a GET — never the update)
      const reads = calls.filter((c) => c.fn === 'hub-admin' && c.body?.action === 'read_webhook_events');
      check(reads.length === (edit ? 1 : 0) && reads.every((c) => Object.keys(c.body).join() === 'action'), `${tag}: read_webhook_events on load (${reads.length}) for an editor only`);
      check(!calls.some((c) => c.fn === 'hub-admin' && c.body?.action === 'update_webhook_events'), `${tag}: nothing is updated at YCloud by opening the page`);
      // H3: «الإرسال من المركز» per channel — off, for every-branch editors only
      check((await page.locator('[data-channel-sending]').count()) === (edit ? 2 : 0) && (await page.$$eval('[data-channel-sending]', (a) => a.every((x) => !x.checked))), `${tag}: «الإرسال من المركز» off on both channels (editors only)`);
      for (const tk of TOUR) {
        if (tk === 'hub-verify' && !edit) continue;
        check((await page.locator(`[data-tour~="${tk}"]`).count()) > 0, `${tag}: the tour target ${tk} exists`);
      }
      const text = await page.locator('main').innerText();
      check(!/[٠-٩۰-۹]/.test(text), `${tag}: Western digits only`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal page scroll`);
      await page.screenshot({ path: join(SHOTS, `assistant-${role}-${w}-${scheme}.png`), fullPage: true });

      if (!edit) {
        check((await page.locator('[data-action="team-edit"], [data-action="channel-verify"], [data-action="templates-refresh"], [data-action="recipients-save"], [data-action="unit-name"]').count()) === 0, `${tag}: no edit control for a viewer`);
        check(await page.$$eval('[data-switch-input]', (a) => a.every((x) => x.disabled)), `${tag}: the switches disabled for a viewer`);
        check(await page.$$eval('[data-mode]', (a) => a.every((x) => x.disabled)), `${tag}: the modes disabled for a viewer`);
      } else if (scheme === 'light') {
        // nothing switches on from the page
        await page.locator('[data-switch-input="hub_assistant_on"]').click();
        await page.locator('[data-hub-blocked]').waitFor({ timeout: 5000 }).catch(() => {});
        check((await page.locator('[data-hub-blocked] [data-gate]').count()) === 1 && (await page.locator('[data-hub-blocked] [data-gate="inbox_on"]').count()) === 1, `${tag}: «المساعد يعمل» opens «لا يُشغَّل…» with its gate («تخزين المحادثات» first)`);
        await page.locator('dialog[open] [data-action="dialog-cancel"]').click();
        await page.locator('[data-unit="airport-road"] [data-mode="shadow"]').click();
        await page.locator('[data-hub-blocked]').waitFor({ timeout: 5000 }).catch(() => {});
        check((await page.locator('[data-hub-blocked] [data-gate="test_lab"]').count()) === 1, `${tag}: «بموافقة الفريق» opens the gates (the test lab of H6 among them)`);
        await page.locator('dialog[open] [data-action="dialog-cancel"]').click();
        await page.locator('[data-unit="airport-road"] [data-mode="test"]').click();
        await page.locator('[data-hub-blocked]').waitFor({ timeout: 5000 }).catch(() => {});
        check((await page.locator('[data-hub-blocked] [data-gate="channel"]').count()) === 1, `${tag}: «تجربة» opens the gates (the channel not verified)`);
        await page.locator('dialog[open] [data-action="dialog-cancel"]').click();
        await page.locator('[data-unit="rooftop"] [data-mode="test"]').click();
        await page.locator('[data-hub-blocked] [data-gate="hidden"]').waitFor({ timeout: 5000 }).catch(() => {});
        check((await page.locator('[data-hub-blocked] [data-gate="hidden"]').count()) === 1, `${tag}: the hidden rooftop says it is never switched on`);
        await page.locator('dialog[open] [data-action="dialog-cancel"]').click();
        check(!calls.some((c) => c.fn === 'hub_setting_set' || c.fn === 'hub_unit_mode_set'), `${tag}: no switch-on request left the page — ${JSON.stringify(calls.map((c) => c.fn))}`);

        // H5: the budget — a changed daily budget goes to hub_setting_set, one key
        await page.locator('[data-budget="daily"]').fill('25');
        await page.locator('[data-action="budget-save"]').click();
        await page.waitForTimeout(500);
        const bset = calls.filter((c) => c.fn === 'hub_setting_set' && /^hub_budget/.test(c.body?.p_key ?? ''));
        check(bset.length === 1 && bset[0].body.p_key === 'hub_budget_daily_usd' && bset[0].body.p_value === 25, `${tag}: «حفظ الميزانية» sends the changed key only — ${JSON.stringify(bset.map((c) => c.body))}`);
        for (const c of bset) calls.splice(calls.indexOf(c), 1);

        // H2: «تخزين المحادثات» has no gate left — the switch asks the server (which audits it; «تراجع» follows)
        await page.locator('[data-switch-input="hub_inbox_on"]').click();
        await page.waitForTimeout(400);
        const inbox = calls.find((c) => c.fn === 'hub_setting_set');
        check(inbox && inbox.body.p_key === 'hub_inbox_on' && inbox.body.p_value === true, `${tag}: «تخزين المحادثات» → hub_setting_set(hub_inbox_on, true) — ${JSON.stringify(inbox?.body)}`);
        check((await page.locator('[data-hub-blocked]').count()) === 0, `${tag}: «تخزين المحادثات» opens no «لا يُشغَّل…»`);

        // H3: «الإرسال من المركز» needs a verified channel (the stub's channels are not verified: disabled)
        check(await page.$$eval('[data-channel-sending]', (a) => a.every((x) => x.disabled)), `${tag}: «الإرسال من المركز» waits for «تحقق من القناة»`);
        check(!calls.some((c) => c.fn === 'hub_channel_sending_set'), `${tag}: no sending switch-on left the page`);

        // H2: «تحديث أحداث الاستقبال» — the system admin only, one call to hub-admin
        await page.locator('[data-action="webhook-events"]').click();
        await page.waitForTimeout(400);
        const wh = calls.filter((c) => c.fn === 'hub-admin' && c.body?.action === 'update_webhook_events');
        check(wh.length === 1 && Object.keys(wh[0].body).join() === 'action', `${tag}: «تحديث أحداث الاستقبال» calls hub-admin update_webhook_events once, with nothing else — ${JSON.stringify(wh)}`);

        // the team dialog and its dirty guard
        await page.locator('[data-unit="shafa-road"] [data-action="team-edit"]').click();
        await page.locator('[data-team-form]').waitFor({ timeout: 5000 });
        const offered = await page.$$eval('[data-team-member]', (a) => a.map((x) => x.getAttribute('data-team-member')));
        check(!offered.includes(STAFF[2].staff_id) && offered.includes(STAFF[3].staff_id), `${tag}: the Shafa Road team offers Shafa and all-branch users only`);
        await page.locator(`[data-team-member="${STAFF[1].staff_id}"]`).uncheck();
        await page.locator('dialog[open] [data-action="dialog-close"]').click();
        check(await page.getByText('تعديلات غير محفوظة').first().isVisible().catch(() => false), `${tag}: × on a changed team asks «تعديلات غير محفوظة»`);
        await page.getByRole('button', { name: 'متابعة التعديل' }).click();
        await page.locator('[data-action="team-save"]').click();
        await page.waitForFunction(() => !document.querySelector('[data-team-form]'), null, { timeout: 5000 }).catch(() => {});
        const team = calls.find((c) => c.fn === 'hub_unit_members_set');
        check(team && team.body.p_unit === id(12) && team.body.p_staff.length === 2 && !team.body.p_staff.includes(STAFF[1].staff_id), `${tag}: «حفظ الفريق» sends the whole list — ${JSON.stringify(team?.body)}`);
        check(await page.getByRole('button', { name: 'تراجع' }).first().isVisible().catch(() => false), `${tag}: the «تراجع» toast`);

        // YCloud reads through hub-admin, read actions only
        await page.locator('[data-channel="+966536622277"] [data-action="channel-verify"]').click();
        await page.waitForFunction(() => true);
        await page.locator('[data-action="templates-refresh"]').click();
        await page.waitForTimeout(500);
        // (the «تحديث أحداث الاستقبال» click above is checked on its own)
        const hub = calls.filter((c) => c.fn === 'hub-admin' && !['update_webhook_events', 'read_webhook_events'].includes(c.body?.action)).map((c) => c.body);
        check(hub.length === 2 && hub[0].action === 'verify_channel' && hub[0].channel === id(101) && hub[1].action === 'refresh_templates', `${tag}: hub-admin called with verify_channel and refresh_templates only — ${JSON.stringify(hub)}`);

        // the morning summary: active only after the filter
        await page.locator('#hub-summary-add').fill('Summary@Example.invalid');
        await page.locator('[data-action="recipient-add"]').click();
        const row = page.locator('[data-recipient="summary@example.invalid"]');
        check((await row.count()) === 1, `${tag}: the address added lower-cased`);
        check(await row.locator('[data-recipient-active]').isDisabled(), `${tag}: «مفعّل» waits for «فلتر البريد مؤكَّد»`);
        await row.locator('[data-recipient-filter]').check();
        await row.locator('[data-recipient-active]').check();
        await page.locator('[data-action="recipients-save"]').click();
        await page.waitForTimeout(400);
        const rec = calls.find((c) => c.fn === 'hub_summary_recipients_set');
        check(rec && JSON.stringify(rec.body.p_recipients) === JSON.stringify([{ email: 'summary@example.invalid', active: true, filter_confirmed: true }]), `${tag}: «حفظ المستلمين» sends the list — ${JSON.stringify(rec?.body)}`);
      }
      check(!errors.length, `${tag}: no page error — ${errors.join(' | ').slice(0, 300)}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`\nhub-assistant-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ hub-assistant-ui-check: ${checks}/${checks} passed (screenshots in ${SHOTS})`);
