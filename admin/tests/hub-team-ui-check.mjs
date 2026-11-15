// «الفريق والتقارير» (Guest Hub H6c, 15 Nov 2026 — DECISIONS.md 2026-11-15 «Guest Hub H6c»). OFFLINE — no Supabase
// project is reached: the dashboard runs on a Vite dev server whose Supabase URL is a stub origin, with a fake session (as
// the other hub UI checks). Checked at 1440 and 375, light and dark, for the system admin (hub_team edit, every branch),
// a reception manager (hub_team edit, Shafa Road only) and a sales user (hub_team view):
//   - the two tabs; the branch cards in scope (the manager sees Shafa Road only); «في الوردية الآن»; the slots with their
//     role, number, days, hours and chips; «إضافة موظف» / «تعديل» / «حذف الموظف» for editors only;
//   - the slot dialog: the shared Modal and its dirty guard; the phone (the site's rules → E.164); the role; the day chips
//     (aria-pressed, «كل الأيام»); the 24-hour selects and the overnight note; «حفظ» waits for the consent tick;
//     hub_staff_slot_save with the E.164 number; the «تراجع» toast saves the row as it was;
//   - the branch settings (hub_team_branch_save), the delete confirm (hub_staff_slot_delete);
//   - «التقارير»: the recipients, the send time, «إرسال تجربة لي» (a confirm naming the number → hub_report_test) for the
//     system admin only; the day's report — the ten labelled lines, the alerts' breakdown; read-only for everyone else;
//   - ?hub_r=YYYY-MM-DD lands on that day's report; ?hub_c=<token> → hub_alert_open → «المحادثات» with that conversation;
//   - every data-tour target of the page tour; Western digits only; no horizontal scroll; axe zero serious / critical.
// Screenshots in screenshots/hub/.
//   node admin/tests/hub-team-ui-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const SHOTS = join(ROOT, 'screenshots', 'hub');
mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'hub_team', 'inbox', 'assistant'];
const me = (role, branch, perms) => ({
  role, branch, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, perms[s] ?? 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// the example numbers of libphonenumber (never a real person's)
const EX = '+966512345678';
const slot = (n, o) => ({ id: id(n), position: n, name: 'سالم', phone: EX, role: 'staff', days: [0, 1, 2, 3, 4, 5, 6], start_time: '08:00', end_time: '16:00', active: true, test_as_guest: false, consent_at: '2026-11-15T08:00:00Z', on_shift: true, ...o });
const BRANCHES = [
  { slug: 'airport-road', name: 'طريق المطار', can_edit: true, resume_minutes: 15, escalate_minutes: 10, channel: true,
    slots: [slot(1, {}), slot(2, { name: 'هدى', role: 'manager', days: [0, 1, 2, 3, 4], start_time: '23:00', end_time: '07:00', on_shift: false }), slot(3, { name: 'خالد', active: false, on_shift: false, test_as_guest: true })] },
  { slug: 'shafa-road', name: 'طريق الشفا', can_edit: true, resume_minutes: 20, escalate_minutes: 10, channel: false, slots: [] },
];
const REPORT = (day) => ({
  day, stored: true, built_at: '2026-11-15T05:00:00Z', sends: { sent: 2, delivered: 2, read: 1, failed: 0 },
  data: { day, partial: false, cards: 3, budget_alerts: 0, branches: {
    'airport-road': { conversations: 14, assistant: 9, handed: 5, reply_avg_min: 7, replied: 4, bookings: 1, reviews: 3, unanswered: 2, model_failures: 1, send_failures: 0, alerts_sent: 5, alerts_delivered: 5, alerts_read: 4, escalated: 1, opened: 4, opened_link: 3, email_only: 0, reasons: { no_source: 3, complaint: 1, human_request: 1 } },
    'shafa-road': { conversations: 6, assistant: 5, handed: 1, reply_avg_min: null, replied: 0, bookings: 0, reviews: 2, unanswered: 0, model_failures: 0, send_failures: 0, alerts_sent: 0, alerts_delivered: 0, alerts_read: 0, escalated: 0, opened: 0, opened_link: 0, email_only: 1, reasons: { media: 1 } } } },
});

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

const ROLES = [
  ['admin', null, { hub_team: 'edit', inbox: 'edit', assistant: 'edit' }, true],
  ['reception', 'shafa-road', { hub_team: 'edit', inbox: 'edit', assistant: 'none' }, false],
  ['sales', null, { hub_team: 'view', inbox: 'none', assistant: 'none' }, false],
];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, branch, perms, sys] of ROLES) {
  const edit = perms.hub_team === 'edit';
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
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
        if (fn === 'hub_team_get') {
          const bs = (branch ? BRANCHES.filter((b) => b.slug === branch) : BRANCHES).map((b) => ({ ...b, can_edit: edit, slots: b.slots.map((s) => (edit ? s : { ...s, phone: '•••• 678' })) }));
          return ok({ now: new Date().toISOString(), can_edit: edit, is_system_admin: sys, branches: bs,
            report: { send_time: '08:00', recipients: [{ id: id(40), position: 1, name: 'أحمد', phone: sys ? EX : '•••• 678', staff_user_id: id(1), staff_name: 'مستخدم تجريبي للفحص', active: true, test_as_guest: false, consent_at: '2026-11-15T08:00:00Z', mine: true }],
              email_recipients: 1, last: { day: '2026-11-14', built_at: '2026-11-15T05:00:00Z' }, staff_users: sys ? [{ id: id(1), name: 'مستخدم تجريبي للفحص' }] : null } });
        }
        if (fn === 'hub_staff_slot_save') return ok({ ok: true, id: body?.p?.id ?? id(99), batch_id: id(900), previous: body?.p?.id ? { ...slot(1, {}), branch: 'airport-road', consent: true } : null });
        if (fn === 'hub_staff_slot_delete') return ok({ ok: true, batch_id: id(901), previous: { ...slot(1, {}), branch: 'airport-road', consent: true } });
        if (fn === 'hub_team_branch_save') return ok({ ok: true, batch_id: id(902), previous: { resume_minutes: 15, escalate_minutes: 10 } });
        if (fn === 'hub_report_test') return ok({ ok: true, recipient: 'أحمد', mine: true });
        if (fn === 'hub_report_config_save') return ok({ ok: true, batch_id: id(903), previous: '08:00' });
        if (fn === 'hub_report_get') return ok(REPORT(body?.p_day));
        if (fn === 'hub_alert_open') return ok(body?.p_token === 'f'.repeat(32) ? { allowed: true, conversation_id: id(70) } : { allowed: false });
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

      // ── «فريق الاستقبال» ──
      await page.goto(`${BASE}/hub-team`, { waitUntil: 'load' });
      await page.locator('[data-page="hub-team"] [data-team-branch]').first().waitFor({ timeout: 30000 });
      const tabs = await page.$$eval('[data-page="hub-team"] [role="tab"]', (a) => a.map((x) => x.getAttribute('data-tab')));
      check(tabs.join() === 'team,reports', `${tag}: the two tabs — ${tabs.join()}`);
      const branches = await page.$$eval('[data-team-branch]', (a) => a.map((x) => x.getAttribute('data-team-branch')));
      check(branches.join() === (branch ? branch : 'airport-road,shafa-road'), `${tag}: the branches in scope — ${branches.join()}`);
      if (!branch) {
        check((await page.locator('[data-team-branch="airport-road"] [data-on-shift]').textContent()).includes('في الوردية الآن: سالم'), `${tag}: «في الوردية الآن» names the on-shift staff`);
        check((await page.locator('[data-team-branch="airport-road"] [data-slot]').count()) === 3 && (await page.locator('[data-chip="test-as-guest"]').count()) === 1 && (await page.locator('[data-chip="inactive"]').count()) === 1, `${tag}: the slots with their chips`);
        check((await page.locator('[data-team-branch="airport-road"] [data-slot="2"]').textContent()).includes('(إلى صباح اليوم التالي)'), `${tag}: an overnight shift says so`);
        check(await page.locator('[data-team-branch="shafa-road"] [data-channel-off]').isVisible(), `${tag}: a branch whose number does not send says the alerts cannot reach`);
      }
      check((await page.locator('[data-action="slot-add"]').count()) === (edit ? branches.length : 0), `${tag}: «إضافة موظف» for editors only`);
      check((await page.locator('[data-action="slot-delete"]').count()) === (edit && !branch ? 3 : 0), `${tag}: «حذف الموظف» for editors only`);
      check((await page.locator('[data-action="team-settings-save"]').count()) === (edit ? branches.length : 0), `${tag}: the branch settings' «حفظ» for editors only`);
      const TOUR = ['team-tabs', 'team-on-shift', 'team-settings', ...(edit ? ['team-add'] : []), ...(edit && !branch ? ['team-slots'] : [])];
      for (const t of TOUR) check((await page.locator(`[data-tour~="${t}"]`).count()) >= 1, `${tag}: the page tour target «${t}» exists`);
      if (w === 1440 && role === 'admin') await page.screenshot({ path: join(SHOTS, `team-${scheme}.png`), fullPage: true });
      await sane(page, `${tag} team`);

      if (edit) {
        // the slot dialog
        await page.locator('[data-action="slot-add"]').first().click();
        await page.locator('[data-slot-dialog]').waitFor({ timeout: 5000 });
        check((await page.locator('[data-slot-dialog] input[type="date"], [data-slot-dialog] input[type="time"]').count()) === 0, `${tag}: no native date / time input`);
        check(await page.locator('[data-action="slot-save"]').isDisabled(), `${tag}: «حفظ» waits for the name, the number and the consent`);
        await page.locator('#slot-name').fill('ريم');
        // the dirty guard: × on a typed name asks first
        await page.locator('dialog[open] [aria-label="إغلاق"], dialog[open] button.modal-close').first().click().catch(() => {});
        await page.waitForTimeout(300);
        check((await page.locator('text=تعديلات غير محفوظة').count()) >= 1, `${tag}: × on a typed slot asks «تعديلات غير محفوظة»`);
        await page.locator('button:has-text("متابعة التعديل")').click().catch(() => {});
        await page.locator('#slot-phone').fill('0512');
        await page.waitForTimeout(200);
        check((await page.locator('[data-slot-problem]').textContent()).includes('رقم واتساب غير صحيح'), `${tag}: a short number is refused by the site's rules`);
        await page.locator('#slot-phone').fill('0512345678');
        await page.locator('[data-day="all"]').click();
        check((await page.locator('[data-day="0"]').getAttribute('aria-pressed')) === 'false', `${tag}: «كل الأيام» off clears the chips (aria-pressed)`);
        await page.locator('[data-day="0"]').click();
        await page.locator('[data-day="4"]').click();
        await page.locator('#slot-from').selectOption('23:00');
        await page.locator('#slot-to').selectOption('07:00');
        check(await page.locator('[data-overnight]').isVisible(), `${tag}: the overnight note`);
        check(await page.locator('[data-action="slot-save"]').isDisabled(), `${tag}: still no «حفظ» before the consent tick`);
        await page.locator('[data-slot-dialog] [data-field="consent"]').check();
        await page.locator('[data-action="slot-save"]').click();
        await page.waitForTimeout(500);
        const save = calls.find((c) => c.fn === 'hub_staff_slot_save');
        check(save?.body?.p?.phone === EX && save.body.p.consent === true && save.body.p.days.join() === '0,4' && save.body.p.start_time === '23:00' && save.body.p.end_time === '07:00'
          && save.body.p.branch === branches[0] && save.body.p.role === 'staff', `${tag}: hub_staff_slot_save with the E.164 number, the days and the hours — ${JSON.stringify(save?.body ?? null)}`);
        check((await page.locator('[data-toast="undo"]').count()) >= 1, `${tag}: the «تراجع» toast after the save`);
        // the branch settings
        await page.locator(`#resume-${branches[0]}`).fill('25');
        await page.locator(`[data-team-branch="${branches[0]}"] [data-action="team-settings-save"]`).click();
        await page.waitForTimeout(400);
        const bs = calls.find((c) => c.fn === 'hub_team_branch_save');
        check(bs?.body?.p_branch === branches[0] && bs.body.p_resume === 25, `${tag}: hub_team_branch_save — ${JSON.stringify(bs?.body ?? null)}`);
        if (!branch) {
          await page.locator('[data-team-branch="airport-road"] [data-action="slot-delete"]').first().click();
          await page.locator('dialog[open] button:has-text("حذف الموظف")').click();
          await page.waitForTimeout(400);
          check(calls.some((c) => c.fn === 'hub_staff_slot_delete' && c.body?.p_id === id(1)), `${tag}: «حذف الموظف» → hub_staff_slot_delete after the confirm`);
        }
      }

      // ── «التقارير» ──
      await page.goto(`${BASE}/?hub_r=2026-11-14`, { waitUntil: 'load' });
      await page.locator('[data-report-view="2026-11-14"]').waitFor({ timeout: 30000 });
      check(page.url().includes('/hub-team?tab=reports&day=2026-11-14'), `${tag}: ?hub_r= lands on that day's report — ${page.url()}`);
      const lines = await page.$$eval('[data-report-lines] > div', (a) => a.map((x) => [x.querySelector('dt').textContent, x.querySelector('dd').textContent]));
      check(lines.length === 10 && lines[0][1] === 'المطار 14 · الشفا 6' && lines[3][1] === 'المطار 7 دقائق · الشفا —' && lines[5][1] === 'لم يُفعَّل بعد' && lines[9][1] === 'فشل النموذج 1',
        `${tag}: the report's ten lines as on WhatsApp — ${JSON.stringify(lines.slice(0, 4))}`);
      check((await page.locator('[data-report-breakdown] tbody tr').count()) === 2 && (await page.locator('[data-report-reasons]').textContent()).includes('سؤال بلا مصدر 3'), `${tag}: the alerts' breakdown and the reasons`);
      check((await page.locator('[data-report-state]').textContent()).includes('أُرسل إلى 2'), `${tag}: the sends' outcome`);
      check((await page.locator('[data-action="report-test"]').count()) === (sys ? 1 : 0) && (await page.locator('[data-action="recipient-add"]').count()) === (sys ? 1 : 0), `${tag}: the recipients and «إرسال تجربة لي» for the system admin only`);
      check((await page.locator('[data-report-readonly]').count()) === (sys ? 0 : 1), `${tag}: read-only recipients for everyone else`);
      if (sys) {
        for (const t of ['team-recipients', 'team-report-test', 'team-report-time', 'team-report-view']) check((await page.locator(`[data-tour~="${t}"]`).count()) === 1, `${tag}: the page tour target «${t}» exists`);
        await page.locator('[data-action="report-test"]').click();
        check((await page.locator('dialog[open]').textContent()).includes('أحمد (رقمك في القائمة)'), `${tag}: «إرسال تجربة لي» names the number first`);
        await page.locator('dialog[open] button:has-text("إرسال التجربة")').click();
        await page.waitForTimeout(400);
        check(calls.some((c) => c.fn === 'hub_report_test'), `${tag}: … then hub_report_test`);
      }
      if (w === 1440 && role === 'admin') await page.screenshot({ path: join(SHOTS, `team-reports-${scheme}.png`), fullPage: true });
      await sane(page, `${tag} reports`);

      // ── ?hub_c= ──
      if (perms.inbox !== 'none') {
        await page.goto(`${BASE}/?hub_c=${'f'.repeat(32)}`, { waitUntil: 'load' });
        await page.waitForURL(/\/inbox\?c=/, { timeout: 15000 }).catch(() => {});
        check(page.url().includes(`/inbox?c=${id(70)}`) && calls.some((c) => c.fn === 'hub_alert_open' && c.body?.p_token === 'f'.repeat(32)), `${tag}: ?hub_c= → hub_alert_open → the conversation in «المحادثات» — ${page.url()}`);
      }
      check(errors.filter((e) => !/hub_inbox|hub_thread|Cannot read properties of null/.test(e)).length === 0, `${tag}: no page error — ${errors.join(' | ')}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`hub-team-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`hub-team-ui-check: ${checks} checks passed`);
