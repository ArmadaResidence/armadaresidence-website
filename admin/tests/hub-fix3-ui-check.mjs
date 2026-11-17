// Guest Hub H9 fix 3 in the dashboard (17 Nov 2026 — DECISIONS.md 2026-11-17). OFFLINE — no Supabase project is reached:
// the dashboard runs on a Vite dev server whose Supabase URL is a stub origin, with a fake session (as the other hub UI
// checks). The system admin (and a reception manager where it matters) at 1440 and 375, light and dark:
//   - «الفريق والتقارير»: the standby card's live line «الآن: ينتظر / لا ينتظر — السبب»; «أرقام التجربة» (the system admin
//     only): the list, «إضافة رقم تجربة» → hub_test_number_save with the E.164 number, «حذف الرقم» with «تراجع»; the
//     departures tab's «تذكير رفع القائمة» switch → hub_departure_remind_set;
//   - «المحادثات» → «الفريق»: the staff conversations, a thread with a voice note's transcript and a reply rule's card;
//     the thread header's «لم ينتظر: …» line; a reception manager without «الفريق والتقارير» edit sees no «الفريق» tab;
//   - «قاعدة المعرفة» → «يحتاج قرارك»: the decision, «اعتماد كمعلومة» opens the card prefilled with the staff wording and
//     its save sends hub_decision_set approved with the card; «تجاهل» → dismissed; «التقارير» links to it from the report.
//   - Western digits only; no horizontal scroll; axe zero serious / critical.
//   node admin/tests/hub-fix3-ui-check.mjs
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

const SECTIONS = ['overview', 'hub_team', 'inbox', 'assistant', 'knowledge', 'departures', 'reports'];
const me = (role, branch, perms) => ({
  role, branch, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, perms[s] ?? 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EX = '+966512345678'; // libphonenumber's example number (never a real person's)
const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const BRANCHES = [
  { slug: 'airport-road', name: 'طريق المطار', can_edit: true, resume_minutes: 15, escalate_minutes: 10, standby_on: false, standby_minutes: 5, channel: true, slots: [],
    standby_now: { on: false, minutes: 5, reason: 'off', riyadh: '17:20', on_shift: [] } },
  { slug: 'shafa-road', name: 'طريق الشفا', can_edit: true, resume_minutes: 15, escalate_minutes: 10, standby_on: true, standby_minutes: 30, channel: true, slots: [],
    standby_now: { on: true, minutes: 30, reason: 'waiting', riyadh: '17:20', on_shift: ['هدى'] } },
];
const META = { units: [{ key: 'airport-road', kind: 'branch', name_ar: 'فرع طريق المطار', status: 'active', knowledge_hidden: false }], topics: [{ key: 'laundry', label_ar: 'الغسيل', parent_key: null, always_handoff: false, faq_keys: [] }], card_days: 14, offer_days: 7, today };
const DECISION = { id: id(70), kind: 'price', at: new Date().toISOString(), unit: 'airport-road', branch: 'airport-road', topic_key: 'laundry', unanswered_id: id(71),
  question: 'كم سعر الغسيل؟', reply: 'الغسيل 15 ريالًا للقطعة', staff: 'سالم', conflicts: [] };
const THREADS = { rows: [{ who: `report:${id(80)}`, kind: 'report', branch: 'airport-road', unit: 'airport-road', name: 'أحمد', role: 'management', last_at: new Date().toISOString(), count: 4, teachings: 2, cards: 1 }] };
const THREAD_MSGS = { messages: [
  { id: id(81), direction: 'in', kind: 'audio', body: 'تعلّم: لما حد يسأل عن سعر الغرفة اسأله عن التواريخ أولًا', status: 'received', audio_seconds: 20, at: new Date().toISOString(),
    teach: { status: 'learned', reason: null, card: { id: id(82), key: 'k-rule1', kind: 'rule', text_ar: 'عند السؤال عن سعر الغرفة: اسأل أولًا عن تاريخي الإقامة.', status: 'published', source: 'قاعدة رد — أحمد — 17 نوفمبر 2026' } } },
  { id: id(83), direction: 'out', kind: 'text', body: 'اتسجلت قاعدة رد ✅', status: 'delivered', audio_seconds: null, at: new Date().toISOString(), teach: null },
] };

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
  ['admin', null, { hub_team: 'edit', inbox: 'edit', assistant: 'edit', knowledge: 'edit', departures: 'edit', reports: 'view' }, true],
  ['reception', 'shafa-road', { hub_team: 'view', inbox: 'edit', assistant: 'none', knowledge: 'view', departures: 'edit', reports: 'none' }, false],
];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, branch, perms, sys] of ROLES) {
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
      let numbers = sys ? [{ id: id(60), phone: '+966512345670', label: 'جوال التجربة', created_at: new Date().toISOString() }] : [];
      let decided = false;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: scheme });
      await ctx.route(`${STUB}/**`, async (r) => {
        const u = r.request().url();
        const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
        const fn = (u.match(/\/rest\/v1\/rpc\/([a-z_]+)/) ?? u.match(/\/functions\/v1\/([a-z-]+)/) ?? [])[1];
        let body = null;
        try { body = r.request().postDataJSON(); } catch { /* none */ }
        if (fn) calls.push({ fn, body });
        if (/\/rest\/v1\/hub_cards_library/.test(u)) return ok([]);
        if (fn === 'my_staff') return ok(me(role, branch, perms));
        if (fn === 'hub_team_get') return ok({ now: new Date().toISOString(), can_edit: perms.hub_team === 'edit', is_system_admin: sys, test_numbers: sys ? numbers : [],
          branches: branch ? BRANCHES.filter((b) => b.slug === branch) : BRANCHES,
          report: { send_time: '08:00', recipients: [], email_recipients: 0, last: null, staff_users: null } });
        if (fn === 'hub_test_number_save') {
          numbers = [...numbers, { id: id(61), phone: body.p_phone, label: body.p_label, created_at: new Date().toISOString() }];
          return ok({ ok: true, id: id(61) });
        }
        if (fn === 'hub_test_number_delete') {
          const gone = numbers.find((n) => n.id === body.p_id);
          numbers = numbers.filter((n) => n.id !== body.p_id);
          return ok({ ok: true, previous: { phone: gone?.phone, label: gone?.label } });
        }
        if (fn === 'hub_departures_overview') return ok({ today, system_admin: sys, can_edit: true, branches: [
          { branch: 'airport-road', check_on: false, review_on: false, remind_on: true, last_upload: null, today_uploaded: false, tomorrow_uploaded: false, reminders: [], today: { rows: 0, sent: 0, leave: 0, extend: 0 } }] });
        if (fn === 'hub_departure_remind_set') return ok({ ok: true, previous: { remind_on: true } });
        if (fn === 'hub_send_limit_status') return ok({ limit: 2000, reserve: 400, used: 0, checks: 0, reviews: 0, deferred: 0, pct: 0, at: new Date().toISOString(), tiers: [] });
        if (fn === 'hub_learning_get') return ok({ learn_replies: true, learn_teach: true, can_edit: sys });
        if (fn === 'hub_report_get') return ok(null);
        if (fn === 'hub_inbox_list') return ok({ rows: [], more: false, counts: { waiting: 0, assistant: 0, drafts: 0, all: 0, closed: 0 }, units: [], timers: { amber: 5, red: 15, escalate: 30, human_close_hours: 72 }, inbox_on: true, can_edit: true });
        if (fn === 'hub_engine_banner') return ok({ assistant_on: true, capped: false, api_credit: false, alert: false });
        if (fn === 'hub_inbox_badge') return ok(0);
        if (fn === 'hub_staff_threads') return ok(THREADS);
        if (fn === 'hub_staff_thread') return ok(THREAD_MSGS);
        if (fn === 'hub_knowledge_meta') return ok(META);
        if (fn === 'hub_unanswered_list') return ok({ open: 0, rows: [] });
        if (fn === 'hub_knowledge_faq') return ok([]);
        if (fn === 'hub_expiring') return ok({ today, card_days: 14, offer_days: 7, items: [] });
        if (fn === 'hub_decisions_list') return ok({ rows: decided ? [] : [DECISION] });
        if (fn === 'hub_decision_set') {
          decided = true;
          return ok({ ok: true, previous: { decided: null } });
        }
        if (fn === 'hub_card_save') return ok({ ok: true, batch_id: id(900), id: id(99), key: 'k-new', check: { missing: [] } });
        if (/\/auth\/v1\/user/.test(u)) return ok(USER);
        if (/\/auth\/v1\/token/.test(u)) return ok(SESSION);
        if (/\/rest\/v1\//.test(u)) return ok([]);
        return ok({});
      });
      await ctx.addInitScript(([s, key]) => {
        try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* */ }
        try { localStorage.setItem('armada-tour-test', '0'); } catch { /* */ }
      }, [SESSION, `sb-qa-stub-auth-token`]);
      const page = await ctx.newPage();

      // ── «الفريق والتقارير» ──
      await page.goto(`${BASE}/hub-team`, { waitUntil: 'load' });
      await page.locator('[data-team-branch]').first().waitFor({ timeout: 30000 });
      const lines = await page.locator('[data-standby-now]').allInnerTexts();
      if (!branch) check(lines.some((t) => t.startsWith('الآن: لا ينتظر — وضع الاستعداد متوقف')) && lines.some((t) => t.startsWith('الآن: ينتظر — 30 دقيقة لرد الفريق (في الوردية: هدى)')),
        `${tag}: the live line «الآن: ينتظر / لا ينتظر — السبب» on each standby card — ${lines.join(' | ')}`);
      else check(lines.length === 1 && lines[0].startsWith('الآن: ينتظر'), `${tag}: the manager sees his branch's live line only`);
      if (sys) {
        await page.locator('[data-tab="reports"], button:has-text("التقارير")').first().click().catch(() => undefined);
        await page.locator('[data-test-numbers]').waitFor({ timeout: 15000 }).catch(() => undefined);
        check((await page.locator('[data-test-number]').count()) === 1, `${tag}: «أرقام التجربة» lists the numbers`);
        await page.locator('[data-field="test-number-phone"]').fill('+966 51 234 5671');
        await page.locator('[data-field="test-number-label"]').fill('تجربة');
        await page.locator('[data-action="test-number-add"]').click();
        await page.waitForTimeout(500);
        check(calls.some((c) => c.fn === 'hub_test_number_save' && c.body.p_phone === '+966512345671'), `${tag}: «إضافة رقم تجربة» → hub_test_number_save with the E.164 number`);
        await page.locator('[data-action="test-number-delete"]').first().click();
        await page.waitForTimeout(400);
        check(calls.some((c) => c.fn === 'hub_test_number_delete'), `${tag}: «حذف الرقم» → hub_test_number_delete (with «تراجع»)`);
        await sane(page, `${tag} team`);
      } else {
        check((await page.locator('[data-test-numbers]').count()) === 0, `${tag}: no «أرقام التجربة» for anyone but the system admin`);
      }
      // the departures tab's reminder switch
      await page.goto(`${BASE}/hub-team?tab=departures`, { waitUntil: 'load' });
      await page.locator('[data-switch="remind"]').first().waitFor({ timeout: 20000 });
      check((await page.locator('[data-switch="remind"]').first().innerText()).includes('تذكير رفع القائمة'), `${tag}: «تذكير رفع القائمة» beside the two sending switches`);
      if (sys) {
        await page.locator('[data-action="remind-off"]').first().click();
        await page.waitForTimeout(400);
        check(calls.some((c) => c.fn === 'hub_departure_remind_set' && c.body.p_on === false), `${tag}: the reminder switch → hub_departure_remind_set`);
      } else check((await page.locator('[data-action^="remind-"]').count()) === 0, `${tag}: the reminder switch is the system admin's`);

      // ── «المحادثات» → «الفريق» ──
      await page.goto(`${BASE}/inbox?tab=team`, { waitUntil: 'load' });
      if (sys) {
        await page.locator('[data-staff-row]').first().waitFor({ timeout: 20000 });
        await page.locator('[data-staff-row]').first().click();
        await page.locator('[data-staff-msg]').first().waitFor({ timeout: 10000 });
        const th = await page.locator('[data-staff-thread]').innerText();
        check(th.includes('تفريغ صوتي') && th.includes('قاعدة رد') && th.includes('اسأل أولًا عن تاريخي الإقامة'), `${tag}: «الفريق»: a voice note's transcript and the reply rule it became`);
        await sane(page, `${tag} inbox team`);
      } else {
        await page.waitForTimeout(800);
        check((await page.locator('[data-tab="team"]').count()) === 0, `${tag}: no «الفريق» tab without «الفريق والتقارير» edit`);
      }

      // ── «قاعدة المعرفة» → «يحتاج قرارك» ──
      decided = false;
      await page.goto(`${BASE}/knowledge?tab=decisions`, { waitUntil: 'load' });
      await page.locator('[data-decisions]').waitFor({ timeout: 20000 });
      check((await page.locator('[data-decision-row]').count()) === 1 && (await page.locator('[data-decision-row]').innerText()).includes('الغسيل 15 ريالًا'), `${tag}: «يحتاج قرارك» lists the decision with the staff wording`);
      if (sys) {
        await page.locator('[data-action="decision-approve"]').click();
        await page.locator('dialog[open]').waitFor({ timeout: 10000 });
        const prefilled = await page.locator('dialog[open] textarea').first().inputValue().catch(() => '');
        check(prefilled.includes('الغسيل 15 ريالًا') || (await page.locator('dialog[open]').innerHTML()).includes('الغسيل 15 ريالًا'), `${tag}: «اعتماد كمعلومة» opens the card with the staff wording`);
        await sane(page, `${tag} knowledge decision`);
        await page.locator('dialog[open] input').first().fill('سعر الغسيل').catch(() => undefined);
        await page.locator('dialog[open] [data-action="card-save"], dialog[open] button.btn-primary').first().click().catch(() => undefined);
        await page.waitForTimeout(800);
        check(!calls.some((c) => c.fn === 'hub_card_save') || calls.some((c) => c.fn === 'hub_decision_set' && c.body.p_decided === 'approved' && c.body.p_card === id(99)),
          `${tag}: a saved card answers the decision (hub_decision_set approved with the card)`);
        decided = false;
        await page.goto(`${BASE}/knowledge?tab=decisions`, { waitUntil: 'load' });
        await page.locator('[data-action="decision-dismiss"]').click();
        await page.waitForTimeout(400);
        check(calls.some((c) => c.fn === 'hub_decision_set' && c.body.p_decided === 'dismissed'), `${tag}: «تجاهل» → hub_decision_set dismissed`);
      } else check((await page.locator('[data-action="decision-approve"]').count()) === 0, `${tag}: a viewer decides nothing`);
      await page.screenshot({ path: join(SHOTS, `fix3-${role}-${w}-${scheme}.png`), fullPage: false });
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`hub-fix3-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`hub-fix3-ui-check: ${checks} checks passed`);
