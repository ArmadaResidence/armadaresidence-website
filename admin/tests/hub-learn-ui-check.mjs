// Guest Hub H7b «التعلّم» (15 Nov 2026) — the dashboard, offline (a Vite dev server on a stub Supabase origin, a fake
// session; nothing reaches a project):
//   «قاعدة المعرفة»: the filter «المصدر» → «تعلّمها المساعد» shows only the learned cards (?source=learned too), each with
//   its chip («تعليم واتساب» / «من رد الفريق», the report's number), who and when; «إيقاف» archives with «تراجع»;
//   «لم أعرف الإجابة» shows «يحتاج قرارك» with the staff wording;
//   «الفريق والتقارير» → «التقارير»: the section «التعلّم» — the system admin switches each switch (hub_learning_set with
//   both values) and «تراجع» saves the previous ones; anyone else reads «يعمل» / «متوقف» with no button; the report's
//   «بطاقات معرفة جديدة» line as WhatsApp writes it.
// admin and management × 1440 + 375 × light + dark, Western digits, no horizontal scroll, axe. Inside admin-hub-check.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'knowledge', 'hub_team', 'inbox'];
const me = (role, perms) => ({
  role, branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, perms[s] ?? 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const META = {
  units: [{ key: 'airport-road', kind: 'branch', name_ar: 'فرع طريق المطار', status: 'active', knowledge_hidden: false }, { key: 'shafa-road', kind: 'branch', name_ar: 'فرع طريق الشفا', status: 'active', knowledge_hidden: false }],
  topics: [{ key: 'parking', label_ar: 'المواقف', parent_key: null, always_handoff: false, faq_keys: [] }, { key: 'facilities', label_ar: 'المرافق', parent_key: null, always_handoff: false, faq_keys: [] }],
  card_days: 14, offer_days: 7, today,
};
const card = (n, o) => ({
  id: id(n), key: `k-qa-${n}`, unit_keys: [], topic_keys: ['parking'], title_ar: 'المواقف', title_en: 'Parking', text_ar: 'المواقف مجانية في الفرعين.', text_en: 'Parking is free.',
  source: 'branches.json', source_date: '2026-11-02', expires_on: null, status: 'published', state: 'published', pending: false, check: { missing: [] },
  verified_by: id(1), verified_by_name: 'أحمد', verified_at: '2026-11-13T09:00:00Z', published_at: '2026-11-13T09:00:00Z', first_published_at: '2026-11-13T09:00:00Z',
  faq_item_id: null, sort: n, is_test: false, live: { sort: n }, learn_kind: null, ...o,
});
const CARDS = [
  card(1, {}),
  card(2, { key: 'k-learn-a', title_ar: 'ميكروويف في اللوبي', topic_keys: ['facilities'], unit_keys: ['airport-road'], text_ar: 'يوجد ميكروويف في لوبي الفرع للضيوف.',
    source: `تعليم واتساب — أحمد — ${today}`, learn_kind: 'teach', learn_scope: 'airport-road', learn_by_name: 'أحمد', learn_day: today, learn_no: 1, learned_at: new Date().toISOString() }),
  card(3, { key: 'k-learn-b', title_ar: 'شواحن الجوال', topic_keys: ['facilities'], unit_keys: ['shafa-road'], text_ar: 'شواحن الجوال متوفرة للاستعارة من الاستقبال.',
    source: `رد الفريق — سالم — ${today}`, learn_kind: 'staff_reply', learn_scope: 'shafa-road', learn_by_name: 'سالم', learn_day: today, learn_no: 2, learned_at: new Date().toISOString() }),
];
const QUEUE = { open: 1, rows: [{ id: id(50), count: 1, topic_key: 'facilities', topic_label: 'المرافق', first_at: '2026-11-15T08:00:00Z', last_at: '2026-11-15T09:00:00Z', units: ['فرع طريق الشفا'],
  excerpts: ['كم سعر الكواية؟'], hidden_excerpts: 0, resolved_card_id: null, resolved_faq_id: null, resolved_at: null, draft_card: null,
  decision: { kind: 'price', at: '2026-11-15T09:05:00Z', reply: 'الكواية بـ 15 ريال للقطعة', conflicts: [] } }] };
const REPORT = (day) => ({ day, stored: true, built_at: `${day}T05:00:00Z`, sends: { sent: 1, delivered: 1, read: 1, failed: 0 },
  data: { day, partial: false, cards: 0, budget_alerts: 0, decisions: 1, learned: [{ n: 1, short: 'يوجد ميكروويف في لوبي فرع طريق المطار', branch: 'airport-road', kind: 'teach', by: 'أحمد' }, { n: 2, short: 'شواحن الجوال متوفرة للاستعارة من الاستقبال', branch: 'shafa-road', kind: 'staff_reply', by: 'سالم' }],
    branches: Object.fromEntries(['airport-road', 'shafa-road'].map((b) => [b, { conversations: 3, assistant: 2, handed: 1, reply_avg_min: 4, replied: 1, bookings: 0, reviews: 0, unanswered: 1, model_failures: 0, send_failures: 0,
      alerts_sent: 1, alerts_delivered: 1, alerts_read: 1, escalated: 0, opened: 1, opened_link: 1, email_only: 0, reasons: {} }])) } });

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

const ROLES = [['admin', { knowledge: 'publish', hub_team: 'edit', inbox: 'edit' }], ['management', { knowledge: 'publish', hub_team: 'edit', inbox: 'edit' }]];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, perms] of ROLES) {
  const sys = role === 'admin';
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
      let cfg = { learn_replies: true, learn_teach: true };
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
        if (/\/rest\/v1\/hub_cards_library/.test(u)) return ok(CARDS);
        if (fn === 'my_staff') return ok(me(role, perms));
        if (fn === 'hub_knowledge_meta') return ok(META);
        if (fn === 'hub_unanswered_list') return ok(body?.p_status === 'open' ? QUEUE : { open: 1, rows: [] });
        if (fn === 'hub_knowledge_faq') return ok([]);
        if (fn === 'hub_expiring') return ok({ today, card_days: 14, offer_days: 7, items: [] });
        if (fn === 'hub_card_archive' || fn === 'hub_card_restore') return ok({ ok: true, batch_id: id(901), changed: true });
        if (fn === 'hub_team_get') return ok({ now: new Date().toISOString(), can_edit: true, is_system_admin: sys, branches: [],
          report: { send_time: '08:00', recipients: [], email_recipients: 1, last: null, staff_users: sys ? [] : null } });
        if (fn === 'hub_learning_get') return ok({ ...cfg, updated_at: new Date().toISOString(), updated_by: null, can_edit: sys });
        if (fn === 'hub_learning_set') {
          const previous = { ...cfg };
          cfg = { learn_replies: body.p_replies, learn_teach: body.p_teach };
          return ok({ ok: true, batch_id: id(910), previous });
        }
        if (fn === 'hub_report_get') return ok(REPORT(body?.p_day));
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

      // ── «قاعدة المعرفة» → «تعلّمها المساعد» ──
      await page.goto(`${BASE}/knowledge?source=learned`, { waitUntil: 'load' });
      await page.locator('[data-page="knowledge"] [data-card]').first().waitFor({ timeout: 30000 });
      const shown = await page.$$eval('[data-card]', (a) => a.map((x) => x.getAttribute('data-card')));
      check(shown.join() === 'k-learn-a,k-learn-b', `${tag}: ?source=learned lists only the learned cards — ${shown.join()}`);
      check(await page.locator('#kn-source').inputValue() === 'learned', `${tag}: the filter «المصدر» reads «تعلّمها المساعد»`);
      const chipA = (await page.locator('[data-card="k-learn-a"] [data-learned]').textContent()).replace(/\s+/g, ' ');
      const chipB = (await page.locator('[data-card="k-learn-b"] [data-learned]').textContent()).replace(/\s+/g, ' ');
      check(/تعليم واتساب/.test(chipA) && /رقم 1/.test(chipA) && /من رد الفريق/.test(chipB) && /رقم 2/.test(chipB), `${tag}: the chips name how it was learned and its number — ${chipA} / ${chipB}`);
      check(/تعلّمها المساعد من أحمد/.test(await page.locator('[data-card="k-learn-a"] [data-learned-by]').innerText()), `${tag}: who taught it and when`);
      await page.selectOption('#kn-source', 'dashboard');
      check((await page.$$eval('[data-card]', (a) => a.map((x) => x.getAttribute('data-card')))).join() === 'k-qa-1', `${tag}: «من اللوحة» shows the other cards only`);
      await page.selectOption('#kn-source', 'learned');
      const stop = page.locator('[data-card="k-learn-a"] [data-action="card-archive"]');
      check((await stop.innerText()).trim() === 'إيقاف', `${tag}: a learned card's button is «إيقاف»`);
      await stop.click();
      await page.getByRole('button', { name: 'تراجع' }).first().click({ timeout: 10000 });
      await page.waitForTimeout(300);
      const seq = calls.filter((c) => ['hub_card_archive', 'hub_card_restore'].includes(c.fn)).map((c) => `${c.fn}:${c.body?.p_id}`);
      check(seq.join() === `hub_card_archive:${id(2)},hub_card_restore:${id(2)}`, `${tag}: «إيقاف» then «تراجع» — ${seq.join()}`);
      await sane(page, `${tag} learned cards`);
      // «لم أعرف الإجابة» → «يحتاج قرارك»
      await page.locator('[data-tab="queue"]').click();
      await page.locator('[data-decision="price"]').waitFor({ timeout: 15000 });
      const dec = await page.locator('[data-decision="price"]').innerText();
      check(/يحتاج قرارك/.test(dec) && /الكواية بـ 15 ريال للقطعة/.test(dec), `${tag}: «يحتاج قرارك» with the staff wording`);
      await sane(page, `${tag} queue`);

      // ── «الفريق والتقارير» → «التقارير» → «التعلّم» ──
      await page.goto(`${BASE}/hub-team?tab=reports&day=${today}`, { waitUntil: 'load' });
      await page.locator('[data-learning]').waitFor({ timeout: 30000 });
      const states = await page.$$eval('[data-learn-switch] [data-state]', (a) => a.map((x) => x.textContent.trim()));
      check(states.join() === 'يعمل,يعمل', `${tag}: both switches «يعمل» — ${states.join()}`);
      const buttons = await page.locator('[data-learning] [data-action^="learn-"]').count();
      if (sys) {
        check(buttons === 2, `${tag}: the system admin has a button per switch`);
        await page.locator('[data-action="learn-learn_replies"]').click();
        await page.getByRole('button', { name: 'تراجع' }).first().click({ timeout: 10000 });
        await page.waitForTimeout(300);
        const sets = calls.filter((c) => c.fn === 'hub_learning_set').map((c) => `${c.body.p_replies}/${c.body.p_teach}`);
        check(sets.join() === 'false/true,true/true', `${tag}: «إيقاف» sends both values, «تراجع» the previous ones — ${sets.join()}`);
      } else check(buttons === 0 && /لمدير النظام وحده/.test(await page.locator('[data-learning]').innerText()), `${tag}: anyone else reads the switches, no button`);
      const line = await page.locator('[data-report-lines] div', { hasText: 'بطاقات معرفة جديدة' }).locator('dd').innerText();
      check(line === '2: 1) يوجد ميكروويف في لوبي فرع طريق المطار · 2) شواحن الجوال متوفرة للاستعارة من الاستقبال · يحتاج قرارك: 1', `${tag}: the report's line as WhatsApp writes it — ${line}`);
      check(await page.locator('[data-link="learned-cards"]').getAttribute('href') === '/knowledge?source=learned', `${tag}: «ما تعلّمه المساعد» opens the learned cards`);
      await sane(page, `${tag} learning`);
      check(!errors.length, `${tag}: no page error — ${errors.join(' ; ').slice(0, 200)}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
// imported by scripts/admin-hub-check.mjs after the other hub checks: exit only on a failure
if (failures.length) {
  console.log(`✗ hub-learn-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`✓ hub-learn-ui-check: ${checks}/${checks} passed`);
