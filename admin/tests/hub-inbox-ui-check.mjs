// «المحادثات» and the guest drawer's «المحادثات» (Guest Hub H3, 13 Nov 2026 — DECISIONS.md 2026-11-13 «Guest Hub H3 — the
// inbox»). OFFLINE — no Supabase project and no YCloud is reached: the dashboard runs on a Vite dev server whose Supabase
// URL is a stub origin, with a fake session (as hub-assistant-ui-check.mjs). The stub answers the inbox RPCs with three
// conversations: A waiting 20 minutes (red), window open; B waiting 7 minutes (amber), window closed, hub_reply_ready
// approved in Arabic only; C closed.
// Checked at 1440 and 375, light and dark, for reception (inbox edit) and management (inbox view):
//   - 1440: the three panes side by side; 375: one pane at a time (list → thread → panel and back);
//   - the tabs and their counts, the timers (red / amber), the sidebar badge, the URL ?c=;
//   - the thread: guest / outbound bubbles, the booking template «قالب», the internal note, the timeline, ticks, a failed
//     message with «إعادة الإرسال» (hub-admin retry), «عرض الوسائط» (a signed hub-media link);
//   - the window switch: open → «إرسال» sends mode text with a key; closed → «إرسال عند رد الضيف» (mode held) and
//     «إرسال قالب» (its dialog: the preview with the unit's name, English disabled — not approved, mode template);
//   - the shortcuts Alt + N / R / T / C; the actions «تولّي المحادثة», «ملاحظة» (the dialog guard: × on a change asks
//     «تعديلات غير محفوظة»), «تحويل» (a note required), «حظر الرقم» (Confirm, then «تراجع» unblocks), the owner;
//   - a viewer sees no action, no composer; Western digits only; no horizontal scroll; axe zero serious / critical;
//   - «العملاء» → a guest's drawer: «المحادثات» with a link into the inbox (inbox view), counts only without inbox view.
// Screenshots in screenshots/hub/.
//   node admin/tests/hub-inbox-ui-check.mjs
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

const SECTIONS = ['overview', 'inbox', 'assistant', 'guests'];
const me = (role, perms) => ({
  role, branch: role === 'reception' ? 'airport-road' : null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: false, backup_codes_left: 10,
  permissions: { overview: 'view', inbox: 'none', assistant: 'none', guests: 'none', ...perms },
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const ahead = (min) => new Date(NOW + min * 60000).toISOString();
const UNIT_A = id(11);
const row = (n, name, state, waitingMin, windowMin, extra = {}) => ({
  id: id(n), unit_id: UNIT_A, unit_key: 'airport-road', unit_name: 'فرع طريق المطار', channel_kind: 'whatsapp', state, owner_kind: null, owner_staff_id: null, owner_name: null,
  tags: [], topics: [], priority: 'normal', language: 'ar', waiting_since: waitingMin === null ? null : ago(waitingMin), window_expires_at: ahead(windowMin), is_test: false, blocked: false,
  name, phone_last4: '9301', last_at: ago(waitingMin ?? 60), unread: 1, last: { author: 'guest', kind: 'text', line: 'هل يتوفر موقف؟', at: ago(waitingMin ?? 60) }, ...extra,
});
const A = row(1, 'Guest Alpha', 'human', 20, 600);
const B = row(2, 'Guest Beta', 'human', 7, -30);
const Cc = row(3, 'Guest Closed', 'closed', null, -600);
const TIMERS = { amber: 5, red: 15, escalate: 30, human_close_hours: 72 };
const LIST = (tab, edit) => ({
  rows: tab === 'closed' ? [Cc] : tab === 'all' ? [A, B] : tab === 'waiting' ? [A, B] : [],
  more: false, counts: { waiting: 2, assistant: 0, drafts: 0, all: 2, closed: 1 },
  units: [{ id: UNIT_A, key: 'airport-road', kind: 'branch', name: 'فرع طريق المطار', status: 'active' }], timers: TIMERS, inbox_on: true, can_edit: edit,
});
const msg = (k, direction, author, body, extra = {}) => ({ id: id(500 + k), direction, author, staff_id: null, staff_name: author === 'staff' ? 'استقبال المطار' : null, kind: 'text', body, payload: {}, language: 'ar',
  media_path: null, media_mime: null, media_purged: false, status: direction === 'in' ? 'received' : 'delivered', error_code: null, sent_at: ago(30 - k), purged: false, unanswered: false, ...extra });
const THREAD = (r, edit) => ({
  conversation: { id: r.id, unit_id: UNIT_A, unit_key: 'airport-road', unit_kind: 'branch', branch: 'airport-road', unit_name: 'فرع طريق المطار', channel_kind: 'whatsapp', channel_address: '+966536622277',
    sending_enabled: true, state: r.state, owner_kind: null, owner_staff_id: null, owner_name: null, human_reason: 'assistant_off', priority: 'normal', language: 'ar',
    window_expires_at: r.window_expires_at, waiting_since: r.waiting_since, last_guest_at: ago(20), last_staff_at: null, tags: [], topics: [], referral: null, created_at: ago(40), closed_at: null,
    is_test: false, can_edit: edit, templates_approved: ['ar'],
    // H5: the unit's assistant in «بموافقة الفريق» (the stub) — «إعادة للمساعد» and «إيقاف المساعد مؤقتًا» offered
    unit_mode: 'shadow', assistant: { active: true, mode: 'shadow', reason: null }, can_release: edit, can_pause: edit, test_state: null },
  guest: { id: id(900), name: null, wa_name: r.name, label: r.name, phone: '+966500009301', language: 'ar', member: true, consent: 'granted', opted_out: false, blocked: false, marketing_hold: false,
    tags: [], notes: null, stays: 2, last_stay: '2026-10-02', bookings: [{ id: id(800), ref: 'AR-20261020-ABCD', status: 'confirmed', branch: 'airport-road', check_in: '2026-10-20', check_out: '2026-10-22' }] },
  messages: [
    msg(1, 'in', 'guest', 'هل يتوفر موقف؟'),
    msg(2, 'out', 'staff', 'نعم، الموقف مجاني.', { status: 'read' }),
    msg(3, 'out', 'staff', 'رسالة لم تصل', { status: 'failed', error_code: 'rejected' }),
    msg(4, 'out', 'staff', 'اتصلت بالضيف', { kind: 'note', status: 'internal' }),
    msg(5, 'in', 'guest', null, { kind: 'image', media_path: 'airport-road/x/y.jpg', media_mime: 'image/jpeg' }),
    // H5: a draft of the assistant (with its source card), a «تجربة» reply, a guest message in English
    msg(6, 'out', 'assistant', 'نعم، المواقف مجانية في الطابقين B1 وB2.', { status: 'pending_approval', sources: [{ id: id(950), key: 'k-parking-detail', title: 'المواقف' }] }),
    msg(7, 'out', 'assistant', 'مرحبًا بك.', { status: 'test' }),
    msg(8, 'in', 'guest', 'Is breakfast included?', { language: 'en' }),
  ],
  templates: [{ source: 'booking', template: 'booking_confirmed', meta_template: 'booking_confirmed_v2', status: 'read', ref: 'AR-20261020-ABCD', branch: 'airport-road', language: 'ar', at: ago(10000) }],
  events: [{ kind: 'state', from: null, to: 'human', reason: 'assistant_off', at: ago(40), actor: null }],
  episodes: [{ id: id(3), unit_name: 'فرع طريق المطار', state: 'closed', created_at: ago(5000), closed_at: ago(4000) }],
  transfer_units: [{ id: id(12), name: 'فرع طريق الشفا' }],
  team: [{ staff_id: id(1), full_name: 'استقبال المطار' }, { staff_id: id(2), full_name: 'الإدارة' }],
  timers: TIMERS,
});
const GUEST = { id: id(900), phone: '+966500009301', email: null, name: 'ضيف تجربة', language: 'ar', club_joined_at: ago(9000), club_source: 'booking', club_utm: null, member: true, consent: 'granted',
  consent_at: ago(9000), consent_version: '2026-11-06', consent_source: 'booking', notes: null, tags: [], last_activity_at: ago(20), is_test: false, created_at: ago(9000), stays: 2, nights: 4, spend: 740,
  first_stay: '2026-09-01', last_stay: '2026-10-22', branches: ['airport-road'], bookings: 2 };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: id(1), aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};
async function axe(page, tag) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  check(v.length === 0, `${tag}: axe zero serious / critical — ${v.join(' ; ')}`);
}

async function context(browser, role, perms, w, h, scheme) {
  const calls = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: scheme });
  await ctx.route(`${STUB}/**`, async (r) => {
    const u = r.request().url();
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const ok = (body, headers = {}) => r.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, ...headers }, body: JSON.stringify(body) });
    const fn = (u.match(/\/rest\/v1\/rpc\/([a-z_]+)/) ?? u.match(/\/functions\/v1\/([a-z-]+)/) ?? [])[1];
    let body = null;
    try { body = r.request().postDataJSON(); } catch { /* none */ }
    if (fn) calls.push({ fn, body });
    const edit = perms.inbox === 'edit';
    if (fn === 'my_staff') return ok(me(role, perms));
    if (fn === 'hub_inbox_list') return ok(LIST(body?.p?.tab ?? 'waiting', edit));
    if (fn === 'hub_thread') return ok(THREAD(body?.p_conversation === B.id ? B : A, edit));
    if (fn === 'hub_inbox_badge') return ok(2);
    if (fn === 'hub_take_over') return ok({ ok: true, changed: true });
    if (fn === 'hub_note_add') return ok({ ok: true, message_id: id(700) });
    if (fn === 'hub_transfer') return ok({ ok: true, unit: 'shafa-road' });
    if (fn === 'hub_block_number') return ok({ ok: true, batch_id: id(901), blocked: body?.p_blocked });
    if (fn === 'hub_close' || fn === 'hub_assign' || fn === 'hub_mark_unanswered') return ok({ ok: true, changed: true });
    if (fn === 'hub_guest_conversations') {
      const can = perms.inbox !== 'none';
      return ok({ total: 2, open: 1, by_unit: [{ unit_name: 'فرع طريق المطار', count: 2 }], can_open: can,
        episodes: can ? [{ id: A.id, unit_name: 'فرع طريق المطار', state: 'human', created_at: ago(40), closed_at: null, topics: [], closed_reason: null }] : [] });
    }
    if (fn === 'guest_club_totals') return ok({ today: '2026-11-13', week_from: '2026-11-08', all: 1, today_all: 0, week_all: 0, sources: {} });
    if (fn === 'hub_draft_reject' || fn === 'hub_release') return ok({ ok: true, changed: true, state: 'inquiry' });
    if (fn === 'hub_pause_unit') return ok({ ok: true, batch_id: id(903) });
    if (fn === 'hub_engine_banner') return ok({ assistant_on: true, capped: false, api_credit: false, alert: false });
    if (fn === 'hub-admin' && body?.action === 'translate') return ok({ ok: true, translation: 'هل الإفطار مشمول؟' });
    if (fn === 'hub-admin' && body?.action === 'suggest') return ok({ ok: true, suggestions: [{ text: 'نعم، المواقف مجانية.', ok: true, reasons: [] }, { text: 'المواقف 50 ريالًا.', ok: false, reasons: ['number'] }] });
    if (fn === 'hub-admin') return ok({ ok: true, results: [{ id: id(600), kind: body?.mode === 'held' ? 'template' : 'text', status: 'accepted', error_code: null }] });
    if (/\/storage\/v1\/object\/sign\//.test(u)) return ok({ signedURL: '/object/sign/hub-media/x.jpg?token=qa' });
    if (/\/rest\/v1\/hub_units/.test(u)) return ok([{ id: UNIT_A, name_ar: 'فرع طريق المطار' }]);
    if (/\/rest\/v1\/guest_profiles_library/.test(u)) {
      const single = /vnd\.pgrst\.object/.test(r.request().headers().accept ?? '');
      return single ? ok(GUEST) : ok([GUEST], { 'content-range': '0-0/1' });
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
  return { ctx, page, calls, errors };
}
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);

const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, level] of [['reception', 'edit'], ['management', 'view']]) {
  const edit = level === 'edit';
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const { ctx, page, calls, errors } = await context(browser, role, { inbox: level }, w, h, scheme);
      await page.goto(`${BASE}/inbox`, { waitUntil: 'load' });
      await page.locator('[data-conv-row]').first().waitFor({ timeout: 30000 });
      check((await page.locator('[data-conv-row]').count()) === 2, `${tag}: the waiting tab lists two conversations`);
      check((await page.locator('[data-count="waiting"]').textContent())?.trim() === '2' && (await page.locator('[data-count="closed"]').textContent())?.trim() === '1', `${tag}: the tab counts`);
      check((await page.locator(`[data-conv-row="${A.id}"]`).getAttribute('data-tone')) === 'red' && (await page.locator(`[data-conv-row="${B.id}"]`).getAttribute('data-tone')) === 'amber', `${tag}: the timers — red after 15 minutes, amber after 5`);
      check((await page.locator(`[data-conv-row="${A.id}"] [data-timer]`).textContent())?.includes('ينتظر منذ 20 دقيقة'), `${tag}: «ينتظر منذ 20 دقيقة»`);
      await page.waitForTimeout(500);
      if (w === 1440) check((await page.locator('[data-badge="inbox"]').textContent().catch(() => ''))?.trim() === '2', `${tag}: the sidebar badge counts the waiting conversations`);

      await page.locator(`[data-conv-row="${A.id}"]`).click();
      await page.locator(`[data-thread="${A.id}"]`).waitFor({ timeout: 10000 });
      check(page.url().includes(`c=${A.id}`), `${tag}: the URL carries ?c=`);
      if (w === 1440) {
        const boxes = await Promise.all(['list', 'thread', 'panel'].map((p) => page.locator(`[data-pane="${p}"]`).boundingBox()));
        check(boxes.every((b) => b && b.width > 150) && new Set(boxes.map((b) => Math.round(b.x / 50))).size === 3 && boxes.every((b) => Math.abs(b.y - boxes[0].y) < 4),
          `${tag}: three panes side by side — ${JSON.stringify(boxes.map((b) => b && [Math.round(b.x), Math.round(b.width)]))}`);
      } else {
        check(!(await visible(page, '[data-pane="list"]')) && (await visible(page, '[data-pane="thread"]')) && !(await visible(page, '[data-pane="panel"]')), `${tag}: one pane at a time — the thread after a tap`);
        await page.locator('[data-action="open-panel"]').click();
        check((await visible(page, '[data-pane="panel"]')) && !(await visible(page, '[data-pane="thread"]')), `${tag}: «الضيف» shows the panel`);
        await page.locator('[data-action="back-thread"]').click();
        check(await visible(page, '[data-pane="thread"]'), `${tag}: back to the thread`);
      }
      check((await page.locator('[data-author="guest"]').count()) >= 2 && (await page.locator('[data-author="staff"]').count()) >= 2, `${tag}: guest and outbound bubbles`);
      check((await page.locator('[data-template-log="booking_confirmed"]').textContent())?.includes('قالب'), `${tag}: the booking template from its log, labelled «قالب»`);
      check((await page.locator('[data-kind="note"]').textContent())?.includes('ملاحظة داخلية — لا تصل للضيف'), `${tag}: the internal note and its mark`);
      check((await page.locator('[data-event="state"]').count()) === 1, `${tag}: the timeline`);
      check((await page.locator(`[data-msg="${id(502)}"] [data-msg-status]`).textContent())?.includes('قُرئت'), `${tag}: the delivery ticks`);
      await page.screenshot({ path: join(SHOTS, `inbox-${role}-${w}-${scheme}.png`), fullPage: false });

      if (!edit) {
        check((await page.locator('[data-actions], [data-composer], [data-action="retry"]').count()) === 0, `${tag}: a viewer sees no action and no composer`);
        check(await visible(page, 'text=صلاحيتك هنا للعرض فقط'), `${tag}: «للعرض فقط»`);
      } else {
        check((await page.locator('[data-composer]').getAttribute('data-window-open')) === 'yes' && (await page.locator('[data-window]').textContent())?.includes('تنتهي نافذة الرد خلال'), `${tag}: the window open, its time left`);
        // H5: the draft bubble, its source, the «تجربة» reply, the translation, «إعادة للمساعد»
        check((await page.locator(`[data-msg="${id(506)}"][data-status="pending_approval"] [data-draft-actions] button`).count()) === 3, `${tag}: a draft carries «إرسال» · «تعديل ثم إرسال» · «رفض»`);
        check((await page.locator(`[data-msg="${id(506)}"] [data-msg-sources]`).textContent())?.includes('المواقف'), `${tag}: the draft shows the card it drew from`);
        check((await page.locator(`[data-msg="${id(507)}"] [data-assistant-chip]`).textContent())?.includes('تجربة') && (await page.locator(`[data-msg="${id(507)}"] [data-msg-status]`).textContent())?.includes('لم تُرسل'),
          `${tag}: a «تجربة» reply is marked and never sent`);
        check((await page.locator(`[data-msg="${id(508)}"] [data-action="translate"]`).count()) === 1 && (await page.locator(`[data-msg="${id(501)}"] [data-action="translate"]`).count()) === 0, `${tag}: «الترجمة» on the English message only`);
        check((await page.locator('[data-action="release"]').count()) === 1 && (await page.locator('[data-action="pause"]').count()) === 1, `${tag}: «إعادة للمساعد» and «إيقاف المساعد مؤقتًا»`);
        if (scheme === 'light') {
          await page.locator(`[data-msg="${id(506)}"] [data-action="draft-send"]`).click();
          await page.waitForTimeout(400);
          const ap = calls.find((c) => c.fn === 'hub-admin' && c.body?.action === 'approve');
          check(ap && ap.body.message === id(506) && ap.body.body === null, `${tag}: «إرسال» → hub-admin approve (the draft as written) — ${JSON.stringify(ap?.body)}`);
          await page.locator(`[data-msg="${id(506)}"] [data-action="draft-edit"]`).click();
          await page.locator('[data-draft-edit-dialog]').waitFor({ timeout: 5000 });
          await page.waitForTimeout(450);
          await page.locator('#draft-edit-text').fill('نعم، المواقف مجانية.');
          await page.locator('[data-action="draft-edit-send"]').click();
          await page.waitForTimeout(400);
          const ap2 = calls.filter((c) => c.fn === 'hub-admin' && c.body?.action === 'approve')[1];
          check(ap2 && ap2.body.body === 'نعم، المواقف مجانية.', `${tag}: «تعديل ثم إرسال» → approve with the edited text — ${JSON.stringify(ap2?.body)}`);
          await page.locator(`[data-msg="${id(506)}"] [data-action="draft-reject"]`).click();
          await page.locator('[data-draft-reject-dialog]').waitFor({ timeout: 5000 });
          await page.locator('[data-action="draft-reject-go"]').click();
          check(await visible(page, '[data-draft-reject-dialog] [role="alert"]'), `${tag}: «رفض» without a reason is refused on the page`);
          await page.locator('[data-reject-reason="wrong_info"]').check();
          await page.locator('[data-action="draft-reject-go"]').click();
          await page.waitForTimeout(400);
          const rj = calls.find((c) => c.fn === 'hub_draft_reject');
          check(rj && rj.body.p_message === id(506) && rj.body.p_reason === 'wrong_info', `${tag}: «رفض» → hub_draft_reject with the reason — ${JSON.stringify(rj?.body)}`);
          await page.locator(`[data-msg="${id(508)}"] [data-action="translate"]`).click();
          await page.locator(`[data-msg="${id(508)}"] [data-msg-translation]`).waitFor({ timeout: 5000 }).catch(() => {});
          check((await page.locator(`[data-msg="${id(508)}"] [data-msg-translation]`).textContent().catch(() => ''))?.includes('هل الإفطار مشمول؟'), `${tag}: «الترجمة» shown beside the original`);
          await page.locator('[data-action="suggestions"]').click();
          await page.locator('[data-suggestions]').waitFor({ timeout: 5000 }).catch(() => {});
          check((await page.locator('[data-suggestion-ok="yes"]').count()) === 1 && (await page.locator('[data-suggestion-ok="no"]').count()) === 1, `${tag}: «اقتراحات»: a refused suggestion cannot be used`);
          await page.locator('[data-action="suggestion-use"]').click();
          check((await page.locator('[data-reply]').inputValue()) === 'نعم، المواقف مجانية.', `${tag}: a suggestion fills the composer`);
          await page.locator('[data-action="send"]').click();
          await page.waitForTimeout(400);
          const sg = calls.find((c) => c.fn === 'hub-admin' && c.body?.action === 'send' && c.body?.suggestion === true);
          check(sg && sg.body.body === 'نعم، المواقف مجانية.', `${tag}: a suggestion is sent with suggestion: true (the guard runs on it) — ${JSON.stringify(sg?.body)}`);
          await page.locator('[data-action="release"]').click();
          await page.waitForTimeout(300);
          check(calls.some((c) => c.fn === 'hub_release' && c.body?.p_conversation === A.id), `${tag}: «إعادة للمساعد» → hub_release`);
          for (const c of calls.filter((x) => x.fn === 'hub-admin' && (['approve', 'translate', 'suggest'].includes(x.body?.action) || x.body?.suggestion))) calls.splice(calls.indexOf(c), 1);
        }
        if (scheme === 'light') {
          // send inside the window
          await page.locator('[data-reply]').fill('نعم، الموقف مجاني ومتاح.');
          await page.locator('[data-action="send"]').click();
          await page.waitForTimeout(400);
          const s1 = calls.find((c) => c.fn === 'hub-admin' && c.body?.action === 'send');
          check(s1 && s1.body.mode === 'text' && s1.body.conversation === A.id && UUID.test(s1.body.key) && s1.body.body === 'نعم، الموقف مجاني ومتاح.', `${tag}: «إرسال» → hub-admin send (text, a key) — ${JSON.stringify(s1?.body)}`);
          check((await page.locator('[data-reply]').inputValue()) === '', `${tag}: the composer emptied after a send`);
          // a failed one: «إعادة الإرسال»
          await page.locator(`[data-msg="${id(503)}"] [data-action="retry"]`).click();
          await page.waitForTimeout(300);
          check(calls.some((c) => c.fn === 'hub-admin' && c.body?.action === 'retry' && c.body.message === id(503)), `${tag}: «إعادة الإرسال» → hub-admin retry`);
          // media through a signed link
          await page.locator('[data-action="media"]').first().click();
          await page.locator('[data-media-viewer]').waitFor({ timeout: 5000 }).catch(() => {});
          check(await visible(page, '[data-media-viewer] img'), `${tag}: «عرض الوسائط» opens the viewer (a signed link)`);
          await page.keyboard.press('Escape');
          // shortcuts
          await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
          await page.keyboard.press('Alt+KeyT');
          await page.waitForTimeout(300);
          check(calls.some((c) => c.fn === 'hub_take_over' && c.body?.p_conversation === A.id), `${tag}: Alt + T takes the conversation over`);
          await page.keyboard.press('Alt+KeyR');
          check(await page.evaluate(() => document.activeElement?.hasAttribute('data-reply')), `${tag}: Alt + R puts the cursor in the reply`);
          await page.locator('[data-pane="thread"] h2').click();
          await page.keyboard.press('Alt+KeyC');
          await page.waitForTimeout(200);
          check(await visible(page, 'dialog[open] >> text=إغلاق المحادثة'), `${tag}: Alt + C asks to close`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          // the note dialog and its dirty guard
          await page.locator('[data-action="note"]').click();
          await page.locator('[data-note-dialog]').waitFor({ timeout: 5000 });
          await page.waitForTimeout(500); // the dialog settles (lib/dirty.ts: 400 ms) before a person types
          await page.locator('#note-text').fill('سأتصل بالضيف');
          await page.locator('dialog[open] [data-action="dialog-close"]').click();
          check((await page.locator('dialog[open] dialog[open]', { hasText: 'تعديلات غير محفوظة' }).count()) === 1, `${tag}: × on a written note asks «تعديلات غير محفوظة»`);
          await page.getByRole('button', { name: 'متابعة التعديل' }).click();
          await page.locator('[data-action="note-save"]').click();
          await page.waitForTimeout(300);
          check(calls.some((c) => c.fn === 'hub_note_add' && c.body?.p_text === 'سأتصل بالضيف'), `${tag}: «حفظ الملاحظة» → hub_note_add`);
          // transfer: a note required
          await page.locator('[data-action="transfer"]').click();
          await page.locator('#tr-unit').selectOption(id(12));
          await page.locator('[data-action="transfer-go"]').click();
          check(await visible(page, '[data-transfer-dialog] [role="alert"]'), `${tag}: «تحويل» without a note is refused on the page`);
          await page.locator('#tr-note').fill('الضيف يسأل عن الشفا');
          await page.locator('[data-action="transfer-go"]').click();
          await page.waitForTimeout(300);
          const tr = calls.find((c) => c.fn === 'hub_transfer');
          check(tr && tr.body.p_unit === id(12) && tr.body.p_note === 'الضيف يسأل عن الشفا', `${tag}: «تحويل» → hub_transfer with the note`);
          // block, then «تراجع»
          await page.locator('[data-action="block"]').click();
          await page.locator('dialog[open] [data-action="confirm-go"]').click();
          await page.waitForTimeout(400);
          check(calls.some((c) => c.fn === 'hub_block_number' && c.body?.p_blocked === true), `${tag}: «حظر الرقم» after its confirm`);
          await page.getByRole('button', { name: 'تراجع' }).first().click().catch(() => {});
          await page.waitForTimeout(400);
          check(calls.some((c) => c.fn === 'hub_block_number' && c.body?.p_blocked === false), `${tag}: «تراجع» unblocks`);
          // the owner
          if (w === 1440) {
            await page.locator('#inbox-owner').selectOption(id(2));
            await page.locator('[data-action="assign"]').click();
            await page.waitForTimeout(300);
            check(calls.some((c) => c.fn === 'hub_assign' && c.body?.p_staff === id(2)), `${tag}: «إسناد» → hub_assign`);
          }
          // Alt + N: the next waiting conversation (B)
          if (w === 375) await page.locator('[data-action="back-list"]').click().catch(() => {});
          await page.keyboard.press('Alt+KeyN');
          await page.locator(`[data-thread="${B.id}"]`).waitFor({ timeout: 5000 }).catch(() => {});
          check(page.url().includes(`c=${B.id}`), `${tag}: Alt + N opens the next waiting conversation`);
          // the window closed: held + template
          check((await page.locator('[data-composer]').getAttribute('data-window-open')) === 'no' && (await page.locator('[data-window]').textContent())?.includes('انتهت نافذة الرد'), `${tag}: «انتهت نافذة الرد»`);
          check((await page.locator('[data-action="send"]').count()) === 0 && (await page.locator('[data-action="held"]').count()) === 1, `${tag}: after the window: «إرسال عند رد الضيف» instead of «إرسال»`);
          await page.locator('[data-reply]').fill('الحجز متاح للخميس.');
          await page.locator('[data-action="held"]').click();
          await page.waitForTimeout(400);
          const s2 = calls.find((c) => c.fn === 'hub-admin' && c.body?.mode === 'held');
          check(s2 && s2.body.conversation === B.id && s2.body.body === 'الحجز متاح للخميس.' && UUID.test(s2.body.key), `${tag}: «إرسال عند رد الضيف» → mode held — ${JSON.stringify(s2?.body)}`);
          await page.locator('[data-action="template"]').click();
          await page.locator('[data-template-dialog]').waitFor({ timeout: 5000 });
          check((await page.locator('[data-template-preview]').textContent())?.includes('أرمادا ريزيدنس – طريق المطار'), `${tag}: the template preview names the unit`);
          check(await page.locator('[data-template-dialog] [data-lang="en"]').isDisabled(), `${tag}: English not approved → disabled`);
          await page.locator('[data-action="template-send"]').click();
          await page.waitForTimeout(400);
          const s3 = calls.find((c) => c.fn === 'hub-admin' && c.body?.mode === 'template');
          check(s3 && s3.body.language === 'ar' && s3.body.body === null && s3.body.conversation === B.id, `${tag}: «إرسال القالب» → mode template (ar) — ${JSON.stringify(s3?.body)}`);
          check(!calls.some((c) => c.fn === 'hub-admin' && !['send', 'retry'].includes(c.body?.action)), `${tag}: the inbox calls hub-admin with send / retry only`);
        }
      }
      // the closed tab
      await page.goto(`${BASE}/inbox?tab=closed`, { waitUntil: 'load' });
      await page.locator('[data-conv-row]').first().waitFor({ timeout: 10000 });
      check((await page.locator('[data-conv-row]').count()) === 1 && (await page.locator('[data-tab="closed"]').getAttribute('aria-selected')) === 'true', `${tag}: ?tab=closed`);
      const text = await page.locator('main').innerText();
      check(!/[٠-٩۰-۹]/.test(text), `${tag}: Western digits only`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal page scroll`);
      await page.goto(`${BASE}/inbox?c=${A.id}`, { waitUntil: 'load' });
      await page.locator(`[data-thread="${A.id}"]`).waitFor({ timeout: 10000 });
      await axe(page, tag);
      check(!errors.length, `${tag}: no page error — ${errors.join(' | ').slice(0, 300)}`);
      await ctx.close();
    }
  }
}

// ── «العملاء» → the guest drawer's «المحادثات» ──
for (const [label, inbox] of [['with inbox view', 'view'], ['without inbox', 'none']]) {
  const { ctx, page, errors } = await context(browser, 'management', { guests: 'view', inbox }, 1440, 900, 'light');
  await page.goto(`${BASE}/guests`, { waitUntil: 'load' });
  await page.locator('[data-guest]').first().waitFor({ timeout: 30000 });
  await page.locator('[data-guest]').first().click();
  await page.locator('[data-guest-conversations]').waitFor({ timeout: 10000 }).catch(() => {});
  const box = page.locator('[data-guest-conversations]');
  check((await box.count()) === 1 && (await box.textContent())?.includes('محادثتان'), `guests ${label}: «المحادثات» with the count`);
  if (inbox === 'view') check((await page.locator(`[data-open-thread][href*="inbox?c=${A.id}"]`).count()) === 1, `guests ${label}: the episode opens its thread in «المحادثات»`);
  else check((await page.locator('[data-open-thread]').count()) === 0 && (await page.locator('[data-guest-episode-counts]').count()) === 1, `guests ${label}: counts only, no link`);
  await page.screenshot({ path: join(SHOTS, `guests-drawer-${inbox}.png`) });
  check(!errors.length, `guests ${label}: no page error — ${errors.join(' | ').slice(0, 300)}`);
  await ctx.close();
}

await browser.close();
await server.close();
if (failures.length) {
  console.error(`\nhub-inbox-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ hub-inbox-ui-check: ${checks}/${checks} passed (screenshots in ${SHOTS})`);
