// Guest Hub S2 — comments (26 Nov 2026) — the dashboard, offline (a Vite dev server on a stub Supabase origin, a fake
// session; nothing reaches a project or Meta):
//   «المحادثات» → «التعليقات»: the tab, the rows (the post's picture and link, the comment, our public reply, the private
//   message, the state, «إعلان»), the filters (hub_comments_list with the state), «رد علني» (the S4 guard in the dialog: a
//   number or a currency shows the error and disables «نشر الرد»; a clean text → hub-admin comment_reply public), «رسالة
//   خاصة» only where the server allows it, «تمت المراجعة», «حساب تجربة» for the system admin only, a refused reply shown;
//   «إعدادات المساعد» → «السوشيال» → «التعليقات»: the note while Ahmed's texts are missing (the switch disabled), then with
//   the texts the system admin's switch → hub_comment_switch_set and «تراجع» the previous values; anyone else reads the state.
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

const SECTIONS = ['overview', 'inbox', 'assistant', 'reports'];
const me = (role) => ({
  role, branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: { overview: 'view', inbox: 'edit', assistant: role === 'admin' ? 'edit' : 'view', reports: 'view' },
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const ROW = (n, o) => ({
  id: id(n), kind: 'instagram', post_permalink: 'https://www.instagram.com/p/qa/', post_thumb: null, is_ad: false, author_name: 'qa.commenter', body: 'بكم الليلة؟',
  language: 'ar', class: 'price', state: 'replied', skip_reason: null, tester: true, public_body: 'سعدنا بسؤالك، أرسلنا لك التفاصيل في رسالة خاصة.', public_status: 'sent',
  public_error: null, public_at: ago(2), private_body: 'مرحبًا بك، هذه التفاصيل.', private_status: 'sent', private_error: null, private_at: ago(2), conversation_id: null,
  commented_at: ago(3), received_at: ago(3), done_at: ago(2), reviewed_at: null, staff_answered_at: null, can_private: false, can_public: false, ...o,
});
const ROWS = [
  ROW(1, {}),
  ROW(2, { kind: 'facebook', class: 'complaint', state: 'handed_off', body: 'Nobody answered the phone', language: 'en', public_body: 'We are sorry.', private_body: null, private_status: null, can_private: true, is_ad: true }),
  ROW(3, { class: 'spam', state: 'review', body: 'متابعين مجانا', public_body: null, public_status: null, private_body: null, private_status: null, can_public: true, can_private: true, tester: false }),
];
const LIST = { rows: [], more: false, counts: { waiting: 0, assistant: 0, drafts: 0, all: 0, closed: 0 }, units: [], timers: { amber: 5, red: 15, escalate: 30, human_close_hours: 72 }, inbox_on: true, can_edit: true };
const SETTINGS = (ready, on) => ({
  channels: [{ id: id(71), kind: 'instagram', name: 'armadar25', comments_on: on, private_on: false, verified: true }, { id: id(72), kind: 'messenger', name: 'Armada Residence', comments_on: false, private_on: false, verified: true }],
  texts_ready: ready, texts_missing: ready ? [] : ['missing'], system_admin: true,
});
const BUDGET = { day: '2026-11-26', month: '2026-11', alert_pct: 80, daily_budget: 20, monthly_budget: 200, daily_spent: 0.42, monthly_spent: 3.1, unset: false, capped: false,
  daily_capped: false, monthly_capped: false, daily_alert: false, monthly_alert: false, api_credit: false, api_credit_since: null, api_credit_last_try: null };
const unit = (n, key, name, kind, extra = {}) => ({ id: id(n), key, kind, name_ar: name, name_en: key, branch: kind === 'brand' ? null : key, status: 'active', mode: 'live',
  skills: ['shared_knowledge', 'stay_services'], sort: n, persona_published: true, venue: null, channels: [], members: [], gates: [], gates_shadow: [], voice_on: false, images_on: false, voice_used_seconds: 0, ...extra });
const OVERVIEW = (sysAdmin) => ({
  can_edit: sysAdmin, system_admin: sysAdmin, all_branches: true, engine_ready: true, inbox_ready: true, budget: BUDGET,
  units: [unit(11, 'airport-road', 'فرع طريق المطار', 'branch'), unit(12, 'shafa-road', 'فرع طريق الشفا', 'branch'), unit(60, 'social', 'السوشيال', 'brand')],
  staff: [], settings: { hub_assistant_on: true, hub_inbox_on: true, hub_budget_daily_usd: 20, hub_budget_monthly_usd: 200, hub_budget_alert_pct: 80, hub_voice_daily_minutes: 60 },
  switch_gates: { hub_assistant_on: [], hub_inbox_on: [] }, recipients: [], templates: [], alerts: [],
});
const SOCIAL = { unit: { id: id(60), key: 'social', name_ar: 'السوشيال', mode: 'test', social_mode: 'test', standby_minutes: 5, human_agent: false, status: 'active' },
  // S2e: the two Meta channels with their own audience (NULL = the unit's)
  channels: [{ id: id(61), kind: 'instagram', address: '17800000000000001', display_name: 'armada.qa', connected: true, verified_at: ago(60), sending_enabled: true, social_mode: null, audience: 'test' },
             { id: id(62), kind: 'messenger', address: '100000000000001', display_name: 'Armada QA Page', connected: true, verified_at: ago(60), sending_enabled: true, social_mode: null, audience: 'test' }],
  system_admin: true,
  // S2a (A3): an Instagram account with a long name and a Messenger account with none — the two rows must look the same
  accounts: [{ id: id(81), kind: 'instagram', name: 'أحمد محمد حلمي — حساب انستجرام للتجربة', username: 'qa.long.username', tester: true, last_seen_at: ago(30) },
             { id: id(82), kind: 'messenger', name: null, username: null, tester: true, last_seen_at: ago(40) }] };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: id(900), aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
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

const browser = await chromium.launch({ channel: 'chrome' });
for (const role of ['admin', 'management']) {
  const sys = role === 'admin';
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
      let ready = false;
      let on = false;
      let refuseNext = false;
      let hang = false;
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
        if (fn === 'my_staff') return ok(me(role));
        if (fn === 'hub_inbox_list') return ok(LIST);
        if (fn === 'hub_inbox_badge') return ok(0);
        if (fn === 'hub_engine_banner') return ok({ assistant_on: true, capped: false, api_credit: false, alert: false });
        if (fn === 'hub_comments_list') {
          const st = body?.p?.state;
          const rows = st === 'needs_review' ? ROWS.filter((x) => x.state === 'review') : ROWS;
          return ok({ rows, counts: { needs_review: 1, handed_off: 1, all: 3 }, can_edit: true, system_admin: sys });
        }
        if (fn === 'hub_comment_review') return ok({ ok: true, before: false });
        if (fn === 'hub_comment_tester_set') return ok({ ok: true, batch_id: id(901), before: false });
        if (fn === 'hub-admin') {
          if (body?.action === 'comment_reply') {
            if (refuseNext) { refuseNext = false; return ok({ ok: false, status: 'failed', error_code: 'permission' }); }
            return ok({ ok: true, status: 'sent', error_code: null });
          }
          return ok({ ok: true });
        }
        if (fn === 'hub_assistant_overview') return ok(OVERVIEW(sys));
        if (fn === 'hub_social_overview') return ok({ ...SOCIAL, system_admin: sys });
        if (fn === 'hub_data_deletions_list') return ok([]);
        if (fn === 'hub_comment_settings') return ok({ ...SETTINGS(ready, on), system_admin: sys });
        if (fn === 'hub_channel_audience_set') return ok({ ok: true, batch_id: id(903), before: null });
        if (fn === 'hub_comment_switch_set' && hang) return new Promise(() => {}); // S2: a request that never answers
        if (fn === 'hub_comment_switch_set') {
          const before = { comments: on, private: false };
          on = body.p_comments;
          return ok({ ok: true, batch_id: id(902), before });
        }
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

      // ── «المحادثات» → «التعليقات» ──
      await page.goto(`${BASE}/inbox?tab=comments`, { waitUntil: 'load' });
      await page.locator('[data-comments-tab]').waitFor({ timeout: 30000 });
      check(await page.locator('[data-tab="comments"][aria-selected="true"]').count() === 1 && await page.locator('[role="tab"][aria-selected="true"]').count() === 1,
        `${tag}: «التعليقات» is the one selected tab`);
      const items = await page.$$eval('[data-comment]', (a) => a.map((x) => x.getAttribute('data-state')));
      check(items.join() === 'replied,handed_off,review', `${tag}: the three comments with their states — ${items.join()}`);
      const first = await page.locator(`[data-comment="${id(1)}"]`).innerText();
      check(/سؤال عن السعر/.test(first) && /تم الرد/.test(first) && /ردنا العام/.test(first) && /الرسالة الخاصة/.test(first) && /انستجرام/.test(first),
        `${tag}: a row shows the type, the state, our public reply and the private message`);
      check(await page.locator(`[data-comment="${id(1)}"] [data-post-link]`).getAttribute('href') === 'https://www.instagram.com/p/qa/', `${tag}: the post's link`);
      check(await page.locator(`[data-comment="${id(2)}"] [data-ad]`).count() === 1, `${tag}: an ad comment is marked «إعلان»`);
      check(await page.locator(`[data-comment="${id(1)}"] [data-action="reply-public"]`).count() === 0 && await page.locator(`[data-comment="${id(2)}"] [data-action="reply-private"]`).count() === 1,
        `${tag}: «رد علني» / «رسالة خاصة» only where the server allows them`);
      check(await page.locator('[data-action="comment-tester"]').count() === (sys ? 3 : 0), `${tag}: «حساب تجربة» for the system admin only`);
      // the filter
      await page.locator('[data-cfilter="needs_review"]').click();
      await page.waitForTimeout(300);
      check(calls.some((c) => c.fn === 'hub_comments_list' && c.body?.p?.state === 'needs_review') && (await page.$$('[data-comment]')).length === 1,
        `${tag}: «تعليقات تحتاج مراجعة» asks the server with that state`);
      // «تمت المراجعة»
      await page.locator(`[data-comment="${id(3)}"] [data-action="reviewed"]`).click();
      await page.waitForTimeout(300);
      check(calls.some((c) => c.fn === 'hub_comment_review' && c.body?.p_id === id(3) && c.body?.p_done === true), `${tag}: «تمت المراجعة» → hub_comment_review`);
      // «رد علني»: the guard in the dialog, then a clean reply
      await page.locator(`[data-comment="${id(3)}"] [data-action="reply-public"]`).click();
      await page.locator('[data-comment-text]').fill('الليلة 250 ريال');
      check(await page.locator('[data-guard]').count() === 1 && await page.locator('[data-action="comment-send"]').isDisabled(), `${tag}: a number or a currency → the error, «نشر الرد» disabled`);
      await page.locator('[data-comment-text]').fill('شكرًا لتواصلك معنا.');
      check(await page.locator('[data-guard]').count() === 0 && !(await page.locator('[data-action="comment-send"]').isDisabled()), `${tag}: a clean text may be sent`);
      await page.locator('[data-action="comment-send"]').click();
      await page.waitForTimeout(500);
      const sent = calls.filter((c) => c.fn === 'hub-admin' && c.body?.action === 'comment_reply');
      check(sent.length === 1 && sent[0].body.mode === 'public' && sent[0].body.comment === id(3) && sent[0].body.body === 'شكرًا لتواصلك معنا.', `${tag}: «نشر الرد» → hub-admin comment_reply public`);
      check(await page.locator('dialog[open]').count() === 0, `${tag}: the dialog closes after a successful send`);
      // a refused private message stays open with its error (never silent)
      refuseNext = true;
      await page.locator(`[data-comment="${id(3)}"] [data-action="reply-private"]`).click();
      await page.locator('[data-comment-text]').fill('مرحبًا بك');
      await page.locator('[data-action="comment-send"]').click();
      await page.waitForTimeout(500);
      check(await page.locator('dialog[open]').count() === 1 && /الصلاحية غير ممنوحة/.test(await page.evaluate(() => document.body.innerText)), `${tag}: a refused send keeps the dialog open and shows why`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const discard = page.getByRole('button', { name: 'تجاهل التعديلات والإغلاق' });
      if (await discard.count()) await discard.click();
      await sane(page, `${tag} comments`);

      // ── «إعدادات المساعد» → «السوشيال» → «التعليقات» ──
      await page.goto(`${BASE}/assistant?tab=social`, { waitUntil: 'load' });
      await page.locator('[data-comment-switches]').waitFor({ timeout: 30000 });
      if (sys) {
        check(await page.locator('[data-texts-missing]').count() === 1 && await page.locator('[data-comment-channel="instagram"] [data-action="comments-switch"]').isDisabled(),
          `${tag}: without Ahmed's texts the note shows and «التعليقات» cannot be switched on`);
        ready = true;
        await page.reload({ waitUntil: 'load' });
        await page.locator('[data-comment-switches]').waitFor({ timeout: 30000 });
        await page.locator('[data-comment-channel="instagram"] [data-action="comments-switch"]').click();
        await page.getByRole('button', { name: 'تراجع' }).first().click({ timeout: 10000 });
        await page.waitForTimeout(300);
        const sets = calls.filter((c) => c.fn === 'hub_comment_switch_set').map((c) => `${c.body.p_comments}/${c.body.p_private}`);
        check(sets.join() === 'true/false,false/false', `${tag}: the switch, then «تراجع» the previous values — ${sets.join()}`);
      } else {
        check(await page.locator('[data-action="comments-switch"]').count() === 0 && /التعليقات متوقفة/.test(await page.locator('[data-comment-switches]').innerText()),
          `${tag}: anyone else reads the state, no switch`);
      }
      // S2e (Ahmed's §6 «Settings per channel»): each channel's own audience — the system admin's, «تراجع» the previous one
      if (sys) {
        check(await page.locator('[data-channel-audience-select]').count() === 2, `${tag}: «جمهور كل قناة» — one choice per channel`);
        await page.locator('[data-channel-audience-select="instagram"]').selectOption('live');
        await page.getByRole('button', { name: 'تراجع' }).first().click({ timeout: 10000 });
        await page.waitForTimeout(300);
        const aud = calls.filter((c) => c.fn === 'hub_channel_audience_set').map((c) => `${c.body.p_channel === id(61) ? 'ig' : '?'}:${c.body.p_mode}`);
        check(aud.join() === 'ig:live,ig:null', `${tag}: Instagram on «الكل», then «تراجع» back to «مثل الوحدة» — ${aud.join()}`);
      } else {
        check(await page.locator('[data-channel-audience-select]').count() === 0 || await page.locator('[data-channel-audience-select="instagram"]').isDisabled(),
          `${tag}: anyone else cannot change a channel's audience`);
      }
      // S2 (26 Nov 2026, Ahmed: a press must never be silent): a switch request with no answer → the error after 20 s
      if (sys && w === 1440 && scheme === 'light') {
        hang = true;
        await page.locator('[data-comment-channel="messenger"] [data-action="comments-switch"]').click();
        await page.waitForTimeout(21_500);
        const body = await page.locator('body').innerText();
        check(/لم يصل رد من الخادم خلال 20 ثانية/.test(body) && await page.locator('[data-comment-channel="messenger"] [data-action="comments-switch"]').isEnabled(),
          `${tag}: a switch request with no answer shows «لم يصل رد من الخادم…» after 20 s and frees the button`);
        hang = false;
        check(await page.locator('[data-private-note]').count() === 1, `${tag}: «الرسائل الخاصة» says it needs «التعليقات» first`);
      }
      // A3 (S2a): «حسابات التجربة» — every row's button keeps its place beside the name (the Instagram row wrapped under it at 375)
      if (sys) {
        const boxes = await page.$$eval('[data-social-accounts] [data-account]', (rows) => rows.map((r) => {
          const b = r.querySelector('[data-action="tester"]').getBoundingClientRect();
          const rr = r.getBoundingClientRect();
          return { dTop: Math.round(b.top - rr.top), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(rr.height) };
        }));
        check(boxes.length === 2 && Math.abs(boxes[0].left - boxes[1].left) <= 1 && Math.abs(boxes[0].right - boxes[1].right) <= 1
          && boxes.every((x) => x.dTop <= x.h / 2), `${tag}: the two account rows place their button alike — ${JSON.stringify(boxes)}`);
      }
      await sane(page, `${tag} switches`);
      check(!errors.length, `${tag}: no page error — ${errors.join(' ; ').slice(0, 200)}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.log(`✗ hub-comments-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`✓ hub-comments-ui-check: ${checks}/${checks} passed`);
