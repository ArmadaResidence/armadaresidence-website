// Guest Hub H6 (14 Nov 2026 — DECISIONS.md 2026-11-14 «Guest Hub H6»): the new screens OFFLINE (a Vite dev server on a
// stub Supabase origin, a fake session — no project, no model, no YCloud is reached). Run by scripts/admin-hub-check.mjs
// (CI static). For the system admin (assistant edit, radar view, knowledge publish) and for management (assistant view):
//   - «إعدادات المساعد» tabs: «الشخصية» — the five tone steps, emoji, the four greetings, the live sample; «حفظ» →
//     hub_persona_save with the whole persona, a refused greeting shown on its field; «نشر» opens the test lab's gate with
//     its cost; the dirty guard; a viewer sees nothing editable;
//   - «التراخيص» — every topic with its licence and the 30-day counters «للاطلاع فقط — لا يغيّر الترخيص»; «تفعيل الرد
//     التلقائي» for the system admin only, asking a reason (refused under 3 letters), then hub_licence_set and «تراجع»;
//     «للفريق دائمًا» never a button;
//   - «مختبر الاختبار» — the runs and the bank; «تشغيل الآن» shows the estimated cost before hub-admin eval_run; a plan past
//     the cap cannot start; «فجوة معروفة» asks a reason; «إيقاف السؤال» with «تراجع»; a run's results;
//   - «المحاكي» — a message → hub-admin simulate (the unit, the text, the state, test mode — nothing else); the reply in the
//     phone, the understanding, the decision, the sources, the guard and the cost beside it; «حفظ كسؤال اختبار» →
//     hub_test_item_save from the simulator; a viewer gets no simulator;
//   - «رادار الأسئلة» — the ranking (asked, answered, handed off, unanswered, the trend), the spike mark, samples only when the
//     server sends them, «إنشاء بطاقة» to /knowledge?new=<topic>&faq=1, proposed topics accept / merge / dismiss;
//   - «لم أعرف الإجابة» — the draft card from a staff reply with its source and its price apart; «مراجعة ونشر» opens it;
//   - Western digits, no horizontal scroll, axe zero serious / critical, the tour targets — 1440 + 375 × light + dark.
//   node admin/tests/hub-lab-ui-check.mjs
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

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};
async function sane(page, tag) {
  const text = await page.evaluate(() => document.body.innerText);
  check(!/[٠-٩۰-۹]/.test(text), `${tag}: Western digits only`);
  const wide = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth + 1) return null;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if ((r.left < -1 || r.right > window.innerWidth + 1) && !el.parentElement?.closest('.overflow-x-auto')) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`);
      if (out.length > 4) break;
    }
    if (!out.length) {
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 1 && !/auto|scroll|hidden|clip/.test(cs.overflowX) && el.clientWidth > 0 && !el.parentElement?.closest('.overflow-x-auto')) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} ${el.scrollWidth}>${el.clientWidth}`);
        }
      }
      return out.slice(-5).join(' | ') || `unknown sw=${document.documentElement.scrollWidth} iw=${window.innerWidth} cw=${document.documentElement.clientWidth} body=${document.body.scrollWidth} ${[...document.querySelectorAll('.overflow-x-auto')].map((x) => `${x.scrollWidth}/${x.clientWidth}:${getComputedStyle(x).overflowX}`).join(',')}`;
    }
    return out.join(' | ');
  });
  check(wide === null, `${tag}: no horizontal page scroll — ${wide}`);
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  check(v.length === 0, `${tag}: axe zero serious / critical — ${v.join(' ; ')}`);
}

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SECTIONS = ['overview', 'inbox', 'knowledge', 'assistant', 'radar', 'now', 'content'];
const me = (role, perms) => ({
  role, branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code', verified_at: new Date().toISOString(),
  email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10, permissions: Object.fromEntries(SECTIONS.map((s) => [s, perms[s] ?? 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const ROLES = [
  ['admin', { assistant: 'edit', knowledge: 'publish', content: 'edit', inbox: 'edit', radar: 'view' }],
  ['management', { assistant: 'view', knowledge: 'edit', content: 'view', inbox: 'edit', radar: 'view' }],
];
const BUDGET = { day: '2026-11-14', month: '2026-11', alert_pct: 80, daily_budget: 20, monthly_budget: 200, daily_spent: 0.4, monthly_spent: 3, unset: false, capped: false,
  daily_capped: false, monthly_capped: false, daily_alert: false, monthly_alert: false, api_credit: false, api_credit_since: null, api_credit_last_try: null };
const PERSONA = { tone: 2, emoji: false, greeting_new_ar: 'مرحبًا بك في {unit_name}.', greeting_new_en: 'Welcome to {unit_name}.', greeting_returning_ar: 'أهلًا بعودتك، {first_name}.', greeting_returning_en: 'Welcome back, {first_name}.' };
const unit = (n, key, name, branch) => ({ id: id(n), key, kind: 'branch', name_ar: name, name_en: key, branch, status: 'active', mode: key === 'airport-road' ? 'test' : 'off', skills: ['shared_knowledge', 'stay_services'], sort: n,
  persona_published: true, persona: PERSONA, persona_draft: PERSONA, persona_pending: false, knowledge_hidden: false,
  lab: { run_id: id(700), finished_at: '2026-11-14T12:00:00Z', trigger: 'baseline', items: 80, passed: 72, blocking: ['q016'], gaps: ['q021'] },
  venue: null, channels: [], members: [], gates: [], gates_shadow: ['test_lab'] });
const OVERVIEW = (edit, sys) => ({
  can_edit: edit, system_admin: sys, all_branches: true, engine_ready: true, inbox_ready: true, budget: BUDGET,
  units: [unit(11, 'airport-road', 'فرع طريق المطار', 'airport-road'), unit(12, 'shafa-road', 'فرع طريق الشفا', 'shafa-road'),
    { ...unit(14, 'rooftop', 'لاريو', 'airport-road'), kind: 'dining', status: 'hidden', knowledge_hidden: true }],
  staff: [], settings: { hub_assistant_on: true, hub_inbox_on: true }, switch_gates: { hub_assistant_on: [], hub_inbox_on: [] }, recipients: [], templates: [], alerts: [],
});
const LIC = (sys) => ({ unit: { id: id(11), key: 'airport-road', name_ar: 'فرع طريق المطار', mode: 'test' }, system_admin: sys, lab: {}, rows: [
  { topic: 'parking', label_ar: 'المواقف', label_en: 'Parking', parent_key: null, always_handoff: false, mode: 'shadow', since: '2026-11-14T05:00:00Z', set_by_name: null, reason: null, drafts: 12, approved_unedited: 9, edited: 2, rejected: 1, flagged_wrong: 0, approved_pct: 75 },
  { topic: 'wifi', label_ar: 'الواي فاي', label_en: 'Wi-Fi', parent_key: null, always_handoff: false, mode: 'auto', since: '2026-11-14T08:00:00Z', set_by_name: 'أحمد', reason: 'دقيق', drafts: 5, approved_unedited: 5, edited: 0, rejected: 0, flagged_wrong: 0, approved_pct: 100 },
  { topic: 'complaint', label_ar: 'شكوى', label_en: 'Complaint', parent_key: null, always_handoff: true, mode: 'blocked', since: '2026-11-14T05:00:00Z', set_by_name: null, reason: null, drafts: 0, approved_unedited: 0, edited: 0, rejected: 0, flagged_wrong: 0, approved_pct: null },
] });
const ITEMS = { can_edit: true, items: [
  { id: id(301), key: 'q001', unit_key: 'airport-road', language: 'ar', messages: ['عندكم مواقف سيارات؟'], context: {}, expect: { action: 'answer', cards: ['k-parking-detail'] }, note: null, tags: [], status: 'active', added_from: 'seed', known_gap: false, known_gap_reason: null, router_only: false, last: { status: 'pass', reasons: [], at: '2026-11-14T12:00:00Z' } },
  { id: id(302), key: 'q016', unit_key: 'airport-road', language: 'ar', messages: ['أبغى غرفة فيها مطبخ'], context: {}, expect: { action: 'answer', cards: ['k-airport-kitchen'] }, note: null, tags: [], status: 'active', added_from: 'seed', known_gap: false, known_gap_reason: null, router_only: false, last: { status: 'fail', reasons: ['action:answer:handoff'], at: '2026-11-14T12:00:00Z' } },
  { id: id(303), key: 'q081', unit_key: 'airport-road', language: 'ar', messages: ['إلغاء'], context: {}, expect: { action: 'cancel_word_question' }, note: null, tags: [], status: 'active', added_from: 'seed', known_gap: false, known_gap_reason: null, router_only: true, last: null },
] };
const RUNS = { item_cost_usd: 0.0066, runs: [{ id: id(700), trigger: 'baseline', units: ['airport-road', 'shafa-road'], status: 'done', verdict: 'blocked', items_total: 98, items_done: 98, passed: 90, failed: 8, errors: 0,
  est_cost_usd: 0.74, cost_usd: 0.61, blocked: [{ key: 'q016', unit: 'airport-road' }], known_gaps: [], stop_reason: null, requested_by_name: 'أحمد', started_at: '2026-11-14T11:50:00Z', finished_at: '2026-11-14T12:00:00Z', created_at: '2026-11-14T11:50:00Z' }] };
const RUN = { run: { ...RUNS.runs[0], candidate_cards: [], persona_unit: null }, results: [
  { id: id(801), item_key: 'q016', unit: 'airport-road', language: 'ar', messages: ['أبغى غرفة فيها مطبخ'], expect: { action: 'answer' }, known_gap: false, config: 'live', attempt: 2, status: 'fail', reasons: ['action:answer:handoff'], replies: ['شكرًا لتواصلك، سيتابع معك فريقنا هنا.'], outcome: { kind: 'handoff' }, cost_usd: 0.006 },
] };
const SIM = { ok: true, replies: [{ body: 'مرحبًا بك في فرع طريق المطار.\nنعم، المواقف مجانية في الطابقين B1 وB2.', notice: false, kind: 'text', buttons: [] }],
  understanding: { intents: ['facility_question'], topics: ['parking'], branch: 'airport-road', language: 'ar', complaint: false },
  decision: { from: 'new', to: 'inquiry', actions: ['answer'], transitions: ['T5'], reason: null },
  sources: { cards: [{ key: 'k-parking-detail', title: 'المواقف' }], read: [{ key: 'k-parking-detail', title: 'المواقف' }], faq: [{ key: 'parking', q: 'هل يوجد موقف؟' }] },
  guard: { ok: true, refusals: [] }, note: null, cost_usd: 0.0066, credit: 'ok', sim: { state: 'inquiry', first_reply: false, history: [], draft: null, failed_understandings: 0, out_of_scope: 0 } };
const RADAR = { from: '2026-11-08', to: '2026-11-14', previous_from: '2026-11-01', previous_to: '2026-11-07', totals: { turns: 20, with_topic: 18 }, can_decide: true, spike: { factor: 3, min: 5 },
  units: [{ key: 'airport-road', name_ar: 'فرع طريق المطار' }], channels: [{ id: id(101), unit: 'airport-road', address: '+966536622277' }],
  rows: [
    { topic: 'parking', label_ar: 'المواقف', label_en: 'Parking', parent_key: null, always_handoff: false, asked: 9, answered: 6, handed_off: 2, unanswered: 1, previous: 4, trend_pct: 125, spike: true, samples: ['هل يوجد موقف؟', 'وين المواقف'] },
    { topic: 'wifi', label_ar: 'الواي فاي', label_en: 'Wi-Fi', parent_key: null, always_handoff: false, asked: 3, answered: 3, handed_off: 0, unanswered: 0, previous: 0, trend_pct: null, spike: false, samples: [] },
  ],
  proposed: [{ hint: 'pets policy', count: 4, last_at: '2026-11-14T09:00:00Z' }] };
const META = { units: [{ key: 'airport-road', name_ar: 'فرع طريق المطار', kind: 'branch', branch: 'airport-road', knowledge_hidden: false }], card_days: 14, offer_days: 7,
  topics: [{ key: 'parking', label_ar: 'المواقف', label_en: 'Parking', parent_key: null, always_handoff: false }, { key: 'house_rules', label_ar: 'قواعد الإقامة', label_en: 'House rules', parent_key: null, always_handoff: false }] };
const DRAFT = { id: id(401), key: 'k-dr1', unit_keys: [], topic_keys: ['house_rules'], title_ar: 'الحيوانات الأليفة', title_en: 'Pets', text_ar: 'لا نسمح بالحيوانات الأليفة في الغرف.', text_en: 'Pets are not allowed in the rooms.',
  source: 'رد سارة في محادثة 14 نوفمبر 2026 — يحتاج اعتماد', source_date: '2026-11-14', verified_by: null, verified_at: null, verified_by_name: null, expires_on: null, status: 'draft', state: 'draft', live: null, pending: true,
  check: { missing: [] }, price_note: '30 ريال للساعة', draft_origin: { kind: 'staff_reply', job: id(1), unanswered: id(2), cluster: id(2), date: '2026-11-14' }, sort: 1, faq_item_id: null };
const QUEUE = { open: 1, rows: [{ id: id(2), count: 2, topic_key: 'house_rules', topic_label: 'قواعد الإقامة', first_at: '2026-11-13T10:00:00Z', last_at: '2026-11-14T10:00:00Z', units: ['فرع طريق المطار'],
  excerpts: ['هل تسمحون بالحيوانات الأليفة؟'], hidden_excerpts: 0, resolved_card_id: null, resolved_faq_id: null, resolved_at: null,
  draft_card: { id: id(401), key: 'k-dr1', title_ar: 'الحيوانات الأليفة', title_en: 'Pets', source: DRAFT.source, price_note: '30 ريال للساعة', status: 'draft', problems: 0 } }] };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: id(1), aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, perms] of ROLES) {
  const edit = perms.assistant === 'edit';
  const sys = role === 'admin';
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
      let personaRefuse = true;
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
        if (fn === 'my_staff') return ok(me(role, perms));
        if (fn === 'hub_assistant_overview') return ok(OVERVIEW(edit, sys));
        if (fn === 'hub_budget_overview') return ok({ state: BUDGET, system_admin: sys, prices: {}, models: {}, by_unit: [], by_layer: [] });
        if (fn === 'hub_webhook_status') return ok({ system_admin: sys, registered: true, events: [], registered_at: null });
        if (fn === 'hub_persona_save') {
          if (personaRefuse && /المساعد/.test(body?.p?.greeting_new_ar ?? '')) {
            personaRefuse = false;
            return r.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'P0001', message: 'hub_persona_problems', details: JSON.stringify([{ code: 'self_description', field: 'greeting_new_ar' }]) }) });
          }
          return ok({ ok: true, batch_id: id(900), previous: PERSONA, pending: true });
        }
        if (fn === 'hub_licence_rows') return ok(LIC(sys));
        if (fn === 'hub_licence_set') return ok({ ok: true, batch_id: id(901), previous: 'shadow' });
        if (fn === 'hub_test_items_list') return ok({ ...ITEMS, can_edit: edit });
        if (fn === 'hub_eval_runs_list') return ok(RUNS);
        if (fn === 'hub_eval_run') return ok(RUN);
        if (fn === 'hub_test_item_gap' || fn === 'hub_test_item_retire') return ok({ ok: true, changed: true, batch_id: id(902) });
        if (fn === 'hub_test_item_save') return ok({ ok: true, id: id(310), batch_id: id(903) });
        if (fn === 'hub-admin' && body?.action === 'eval_plan') return ok({ ok: true, kind: body.kind, units: ['airport-road', 'shafa-road'], items: 98, est_cost_usd: 0.7438, nothing: false, would_pass_cap: false, busy: false });
        if (fn === 'hub-admin' && body?.action === 'eval_run') return ok({ ok: true, run_id: id(701) });
        if (fn === 'hub-admin' && body?.action === 'simulate') return ok(SIM);
        if (fn === 'hub_radar') return ok(RADAR);
        if (fn === 'hub_topic_hint_decide') return ok({ ok: true, batch_id: id(904), key: 'pets' });
        if (fn === 'hub_knowledge_meta') return ok(META);
        if (fn === 'hub_unanswered_list') return ok(body?.p_status === 'open' ? QUEUE : { open: 1, rows: [] });
        if (fn === 'hub_knowledge_faq') return ok([]);
        if (fn === 'hub_expiring') return ok({ today: '2026-11-14', card_days: 14, offer_days: 7, items: [] });
        if (/\/rest\/v1\/hub_cards_library/.test(u)) return ok([DRAFT]);
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

      // ── «الشخصية» ──
      await page.goto(`${BASE}/assistant?tab=persona`, { waitUntil: 'load' });
      await page.locator('[data-hub-persona]').waitFor({ timeout: 30000 });
      check((await page.locator('[data-tab]').count()) === 5, `${tag}: five tabs`);
      check((await page.locator('[data-hub-persona] .segmented button, [data-hub-persona] [role="radio"]').count()) >= 5 || (await page.locator('[data-hub-persona]').innerText()).includes('دافئ ومهني'), `${tag}: the five tone steps («دافئ ومهني» among them)`);
      check((await page.locator('[data-hub-persona] input[data-field^="greeting_"]').count()) === 4 && (await page.locator('[data-field="greeting_new_ar"]').inputValue()) === 'مرحبًا بك في {unit_name}.', `${tag}: the four greetings, copy.md §1 by default`);
      check(!(await page.locator('[data-hub-persona]').innerText()).match(/اسم المساعد/), `${tag}: no name field`);
      check((await page.locator('[data-persona-sample]').innerText()).includes('مرحبًا بك في فرع طريق المطار.'), `${tag}: the live sample fills the unit's name`);
      check((await page.locator('[data-tour~="hub-persona"]').count()) === 1 && (await page.locator('[data-tour~="hub-tabs"]').count()) === 1, `${tag}: the tour targets of the tab`);
      if (edit) {
        await page.locator('[data-field="greeting_new_ar"]').fill('أنا المساعد الآلي في {unit_name}.');
        await page.locator('[data-action="persona-save"]').click();
        await page.waitForTimeout(500);
        check((await page.locator('#persona-greeting_new_ar ~ [role="alert"], [data-field="greeting_new_ar"] ~ span[role="alert"]').count()) >= 1 || (await page.locator('[data-hub-persona] [role="alert"]').count()) >= 1, `${tag}: a greeting that presents the assistant is refused on its field`);
        await page.locator('[data-field="greeting_new_ar"]').fill('أهلًا وسهلًا بك في {unit_name}.');
        await page.locator('[data-action="persona-save"]').click();
        await page.waitForTimeout(500);
        const saves = calls.filter((c) => c.fn === 'hub_persona_save');
        check(saves.length === 2 && saves[1].body.p_unit === id(11) && saves[1].body.p.greeting_new_ar === 'أهلًا وسهلًا بك في {unit_name}.' && saves[1].body.p.tone === 2 && Object.keys(saves[1].body.p).length === 6,
          `${tag}: «حفظ» → hub_persona_save with the whole persona — ${JSON.stringify(saves.at(-1)?.body)}`);
        check(await page.getByRole('button', { name: 'تراجع' }).first().isVisible().catch(() => false), `${tag}: the «تراجع» toast`);
      } else {
        check((await page.locator('[data-action="persona-save"], [data-action="persona-publish"]').count()) === 0 && (await page.locator('[data-field="greeting_new_ar"]').isDisabled()), `${tag}: a viewer sees nothing editable`);
      }
      await sane(page, `${tag} persona`);
      await page.screenshot({ path: join(SHOTS, `lab-persona-${role}-${w}-${scheme}.png`), fullPage: true });

      // ── «التراخيص» ──
      await page.locator('[data-tab="licences"]').click();
      await page.locator('[data-lic-table]').waitFor({ timeout: 10000 });
      check((await page.locator('[data-lic-row]').count()) === 3 && (await page.locator('[data-lic-info]').innerText()).includes('للاطلاع فقط — لا يغيّر الترخيص'), `${tag}: every topic with the counters «للاطلاع فقط — لا يغيّر الترخيص»`);
      check((await page.locator('[data-lic-row="parking"]').innerText()).includes('75%'), `${tag}: approved without edit 75%`);
      check((await page.locator('[data-lic-row="complaint"] button').count()) === 0 && (await page.locator('[data-lic-row="complaint"]').innerText()).includes('للفريق دائمًا'), `${tag}: «للفريق دائمًا» never a button`);
      check((await page.locator('[data-action="lic-on"]').count()) === (sys ? 1 : 0) && (await page.locator('[data-action="lic-off"]').count()) === (sys ? 1 : 0), `${tag}: the licence buttons for the system admin only`);
      if (sys) {
        await page.locator('[data-lic-row="parking"] [data-action="lic-on"]').click();
        await page.locator('[data-reason-form]').waitFor({ timeout: 5000 });
        await page.locator('[data-field="reason"]').fill('ok');
        await page.locator('[data-action="reason-save"]').click();
        check(await page.locator('[data-reason-form] [role="alert"]').isVisible(), `${tag}: a reason under 3 letters is refused on the page`);
        await page.locator('dialog[open] [data-action="dialog-close"]').click();
        check(await page.getByText('تعديلات غير محفوظة').first().isVisible().catch(() => false), `${tag}: × on a typed reason asks «تعديلات غير محفوظة»`);
        await page.getByRole('button', { name: 'متابعة التعديل' }).click();
        await page.locator('[data-field="reason"]').fill('دقيقة في أسبوعين من الموافقات');
        await page.locator('[data-action="reason-save"]').click();
        await page.waitForTimeout(500);
        const ls = calls.find((c) => c.fn === 'hub_licence_set');
        check(ls && ls.body.p_unit === id(11) && ls.body.p_topic === 'parking' && ls.body.p_mode === 'auto' && ls.body.p_reason === 'دقيقة في أسبوعين من الموافقات', `${tag}: «تفعيل الرد التلقائي» → hub_licence_set with the reason — ${JSON.stringify(ls?.body)}`);
      }
      await sane(page, `${tag} licences`);

      // ── «مختبر الاختبار» ──
      await page.locator('[data-tab="lab"]').click();
      await page.locator('[data-lab-bank] [data-item]').first().waitFor({ timeout: 10000 });
      check((await page.locator('[data-run]').count()) === 1 && (await page.locator('[data-run]').innerText()).includes('0.61 دولار'), `${tag}: the last runs with their cost`);
      check((await page.locator('[data-item="q081"]').innerText()).includes('يعالجه الاستقبال الآلي'), `${tag}: a router question marked as not the engine's`);
      check((await page.locator('[data-item="q016"]').innerText()).includes('المتوقع «يجيب» وحدث «يحوّل للفريق»'), `${tag}: a failing item's reason in Arabic`);
      check((await page.locator('[data-action="lab-run"]').count()) === (edit ? 1 : 0), `${tag}: «تشغيل الآن» for editors only`);
      await page.locator('[data-run] [data-action="run-open"]').click();
      await page.locator('[data-run-detail]').waitFor({ timeout: 5000 });
      check((await page.locator('[data-result="q016"]').innerText()).includes('شكرًا لتواصلك'), `${tag}: a run's results with the reply`);
      await page.locator('dialog[open] [data-action="dialog-cancel"]').first().click();
      if (edit) {
        await page.locator('[data-action="lab-run"]').click();
        await page.locator('[data-plan-cost]').waitFor({ timeout: 5000 });
        check((await page.locator('[data-plan-cost]').innerText()).includes('0.74 دولار'), `${tag}: the estimated cost before the run`);
        check(!calls.some((c) => c.fn === 'hub-admin' && c.body?.action === 'eval_run'), `${tag}: nothing started before «تشغيل»`);
        await page.locator('[data-action="lab-start"]').click();
        await page.waitForTimeout(500);
        check(calls.some((c) => c.fn === 'hub-admin' && c.body?.action === 'eval_run' && c.body?.kind === 'manual'), `${tag}: «تشغيل» → hub-admin eval_run (manual)`);
        await page.locator('[data-item="q016"] [data-action="item-gap"]').click();
        await page.locator('[data-reason-form]').waitFor({ timeout: 5000 });
        await page.locator('[data-field="reason"]').fill('يحتاج حجز المحادثة (H8)');
        await page.locator('[data-action="reason-save"]').click();
        await page.waitForTimeout(400);
        const g = calls.find((c) => c.fn === 'hub_test_item_gap');
        check(g && g.body.p_id === id(302) && g.body.p_gap === true && g.body.p_reason === 'يحتاج حجز المحادثة (H8)', `${tag}: «فجوة معروفة» with a reason — ${JSON.stringify(g?.body)}`);
        await page.locator('[data-item="q001"] [data-action="item-retire"]').click();
        await page.waitForTimeout(400);
        check(calls.some((c) => c.fn === 'hub_test_item_retire' && c.body.p_id === id(301) && c.body.p_retired === true) && await page.getByRole('button', { name: 'تراجع' }).first().isVisible().catch(() => false), `${tag}: «إيقاف السؤال» with «تراجع»`);
      }
      await sane(page, `${tag} lab`);

      // ── «المحاكي» ──
      await page.locator('[data-tab="sim"]').click();
      if (edit) {
        await page.locator('[data-sim-phone]').waitFor({ timeout: 10000 });
        await page.locator('[data-field="sim-text"]').fill('عندكم مواقف؟');
        await page.locator('[data-action="sim-send"]').click();
        await page.locator('[data-sim-reply]').first().waitFor({ timeout: 5000 });
        const sim = calls.find((c) => c.fn === 'hub-admin' && c.body?.action === 'simulate');
        check(sim && sim.body.unit === 'airport-road' && sim.body.text === 'عندكم مواقف؟' && sim.body.sim?.state === 'new' && sim.body.drafts === false && sim.body.persona === null, `${tag}: a message → hub-admin simulate (the unit, the text, the state) — ${JSON.stringify(sim?.body)}`);
        check((await page.locator('[data-sim-reply]').first().innerText()).includes('المواقف مجانية'), `${tag}: the reply in the phone`);
        const det = await page.locator('[data-sim-detail]').innerText();
        check(det.includes('المواقف') && det.includes('استفسار') && det.includes('قبل الرد من أول محاولة') && det.includes('0.01 دولار'), `${tag}: beside it the understanding, the decision, the sources, the guard and the cost — ${det.slice(0, 200)}`);
        await page.locator('[data-action="sim-save"]').click();
        await page.locator('[data-item-form]').waitFor({ timeout: 5000 });
        check((await page.locator('[data-field="messages"]').inputValue()) === 'عندكم مواقف؟' && (await page.locator('[data-field="cards"]').inputValue()) === 'k-parking-detail', `${tag}: «حفظ كسؤال اختبار» prefilled from the exchange`);
        await page.locator('[data-action="item-save"]').click();
        await page.waitForTimeout(400);
        const is = calls.find((c) => c.fn === 'hub_test_item_save');
        check(is && is.body.p.added_from === 'simulator' && is.body.p.expect.action === 'answer' && JSON.stringify(is.body.p.messages) === '["عندكم مواقف؟"]', `${tag}: → hub_test_item_save from the simulator — ${JSON.stringify(is?.body)}`);
        await sane(page, `${tag} simulator`);
        await page.screenshot({ path: join(SHOTS, `lab-sim-${role}-${w}-${scheme}.png`), fullPage: true });
      } else {
        await page.locator('[data-sim-view-only]').waitFor({ timeout: 5000 }).catch(() => {});
        check(await page.locator('[data-sim-view-only]').isVisible() && !calls.some((c) => c.body?.action === 'simulate'), `${tag}: a viewer gets no simulator`);
      }

      // ── «رادار الأسئلة» ──
      await page.goto(`${BASE}/radar`, { waitUntil: 'load' });
      await page.locator('[data-radar-table]').waitFor({ timeout: 20000 });
      const prow = await page.locator('[data-radar-row="parking"]').innerText();
      check(/9/.test(prow) && prow.includes('+125%') && prow.includes('ارتفاع مفاجئ'), `${tag}: the ranking with the trend and the spike mark — ${prow.slice(0, 160)}`);
      check((await page.locator('[data-radar-row="wifi"] [data-action="radar-samples"]').count()) === 0, `${tag}: no samples button where the server sent none`);
      await page.locator('[data-radar-row="parking"] [data-action="radar-samples"]').click();
      check((await page.locator('[data-radar-samples] li').count()) === 2, `${tag}: the samples the server sent`);
      check((await page.locator('[data-radar-row="parking"] [data-action="radar-card"]').getAttribute('href')) === '/knowledge?new=parking&faq=1', `${tag}: «إنشاء بطاقة» → the card editor on the topic with a FAQ draft`);
      check((await page.locator('[data-hint="pets policy"]').count()) === 1, `${tag}: the proposed topic`);
      await page.locator('[data-hint="pets policy"] [data-action="hint-accept"]').click();
      await page.locator('[data-hint-form="accept"]').waitFor({ timeout: 5000 });
      check((await page.locator('[data-field="hint-key"]').inputValue()) === 'pets_policy', `${tag}: the key proposed from the hint`);
      await page.locator('[data-field="hint-ar"]').fill('الحيوانات الأليفة');
      await page.locator('[data-action="hint-save"]').click();
      await page.waitForTimeout(400);
      const hd = calls.find((c) => c.fn === 'hub_topic_hint_decide');
      check(hd && hd.body.p_hint === 'pets policy' && hd.body.p.action === 'accept' && hd.body.p.key === 'pets_policy' && hd.body.p.label_ar === 'الحيوانات الأليفة', `${tag}: accept → hub_topic_hint_decide — ${JSON.stringify(hd?.body)}`);
      for (const t of ['radar-filters', 'radar-table', 'radar-proposed']) check((await page.locator(`[data-tour~="${t}"]`).count()) === 1, `${tag}: the tour target ${t}`);
      await sane(page, `${tag} radar`);
      await page.screenshot({ path: join(SHOTS, `lab-radar-${role}-${w}-${scheme}.png`), fullPage: true });

      // ── «لم أعرف الإجابة»: the draft card from a staff reply ──
      await page.goto(`${BASE}/knowledge?tab=queue`, { waitUntil: 'load' });
      await page.locator('[data-draft-card="k-dr1"]').waitFor({ timeout: 20000 });
      const dr = await page.locator('[data-draft-card="k-dr1"]').innerText();
      check(dr.includes('رد سارة في محادثة 14 نوفمبر 2026 — يحتاج اعتماد') && dr.includes('30 ريال للساعة') && dr.includes('لا يُكتب في البطاقة'), `${tag}: the draft under its question, its source and its price apart`);
      await page.locator('[data-draft-card="k-dr1"] [data-action="draft-review"]').click();
      await page.locator('[data-card-form]').waitFor({ timeout: 5000 });
      check(await page.locator('[data-draft-origin]').isVisible() && (await page.locator('[data-card-form] [data-price-note]').innerText()).includes('30 ريال للساعة')
        && (await page.locator('[data-field="text_ar"]').inputValue()) === 'لا نسمح بالحيوانات الأليفة في الغرف.', `${tag}: «مراجعة ونشر» opens the editor prefilled, the price shown apart`);
      await sane(page, `${tag} draft card`);
      check(!errors.length, `${tag}: no page error — ${errors.join(' | ').slice(0, 300)}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`\nhub-lab-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ hub-lab-ui-check: ${checks}/${checks} passed (screenshots in ${SHOTS})`);
