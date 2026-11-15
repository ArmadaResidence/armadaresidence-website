// Guest Hub H7 — «الفويس» / «الصور», the voice minutes and «المحاكي»'s upload (15 Nov 2026; DECISIONS.md 2026-11-15
// «Guest Hub H7: voice and images»). OFFLINE — the dashboard on a Vite dev server whose Supabase URL is a stub origin, a
// fake session (as hub-assistant-ui-check). Checked for the system admin and for management (assistant: edit, not the
// system admin), 1440 and 375, light and dark:
//   - each active unit card shows both switches «متوقف»; the café and the rooftop (hidden) show none;
//   - the system admin: «تشغيل» opens a confirm first (× / «إلغاء» close it, nothing sent), then hub_unit_media_set with
//     that switch only; a switch that is on is switched off at once (no confirm) and «تراجع» is offered;
//   - management: a switch that is off cannot be switched on (disabled, the note «يشغّلهما مدير النظام…»); one that is on
//     can be switched off;
//   - «الميزانية»: the voice minutes field (editable by the system admin only, saved with hub_setting_set
//     hub_voice_daily_minutes), the transcription's own line (minutes and dollars), gpt-transcribe priced per minute;
//   - «المحاكي»: a voice note uploaded with the text empty → hub-admin simulate with media {kind audio, mime, data}; the
//     player in the guest bubble, «تفريغ صوتي: …» under it; an image → «تصنيف الصورة: صورة مشكلة», «أولوية عالية» and the
//     staff line in the details; a file of another type refused before any call;
//   - the tour target hub-media exists; Western digits only; no horizontal scroll.
// Screenshots in screenshots/hub/.
//   node admin/tests/hub-media-ui-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const SHOTS = join(ROOT, 'screenshots', 'hub');
mkdirSync(SHOTS, { recursive: true });
// synthetic upload files «نموذج للاختبار» — a few bytes, never a real voice or a real photo
const TMP = join(tmpdir(), 'hub-media-ui');
mkdirSync(TMP, { recursive: true });
const OGG = join(TMP, 'test-voice.ogg');
writeFileSync(OGG, Buffer.from('OggS-test-sample'));
const PNG = join(TMP, 'test-problem.png');
writeFileSync(PNG, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const TXT = join(TMP, 'notes.txt');
writeFileSync(TXT, 'x');

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'audit', 'inbox', 'knowledge', 'assistant', 'radar', 'now'];
const me = (role) => ({
  role, branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === 'assistant' ? 'edit' : 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BUDGET = { day: '2026-11-15', month: '2026-11', alert_pct: 80, daily_budget: 20, monthly_budget: 200, daily_spent: 0.42, monthly_spent: 3.1, unset: false, capped: false,
  daily_capped: false, monthly_capped: false, daily_alert: false, monthly_alert: false, api_credit: false, api_credit_since: null, api_credit_last_try: null };
const unit = (n, key, name, status, extra = {}) => ({ id: id(n), key, kind: key.includes('road') ? 'branch' : 'dining', name_ar: name, name_en: key, branch: 'airport-road', status, mode: status === 'active' ? 'live' : 'off',
  skills: ['shared_knowledge', 'stay_services'], sort: n, persona_published: true, venue: null, channels: [], members: [], gates: [], gates_shadow: [], voice_on: false, images_on: false, voice_used_seconds: 0, ...extra });
const OVERVIEW = (sysAdmin, voiceOn) => ({
  can_edit: true, system_admin: sysAdmin, all_branches: true, engine_ready: true, inbox_ready: true, budget: BUDGET,
  units: [unit(11, 'airport-road', 'فرع طريق المطار', 'active', voiceOn ? { voice_on: true, voice_used_seconds: 420 } : {}), unit(12, 'shafa-road', 'فرع طريق الشفا', 'active'),
    unit(13, 'lobby-cafe', 'مقهى ومطعم أرمادا ريزيدنس', 'hidden'), unit(14, 'rooftop', 'لاريو', 'hidden')],
  staff: [], settings: { hub_assistant_on: true, hub_inbox_on: true, hub_budget_daily_usd: 20, hub_budget_monthly_usd: 200, hub_budget_alert_pct: 80, hub_voice_daily_minutes: 60 },
  switch_gates: { hub_assistant_on: [], hub_inbox_on: [] }, recipients: [], templates: [], alerts: [],
});
const BUDGET_OVERVIEW = (sysAdmin) => ({
  state: BUDGET, system_admin: sysAdmin,
  prices: { 'claude-haiku-5-5': { input: 0.1, output: 0.5, read_at: '2026-11-14' }, 'gpt-transcribe': { per_minute: 0.0045, read_at: '2026-11-15' } },
  models: { understand: 'claude-haiku-5-5', vision: 'claude-haiku-5-5', transcribe: 'gpt-transcribe' },
  by_unit: [{ unit: 'airport-road', name: 'فرع طريق المطار', today: 0.42, month: 3.1 }],
  by_layer: [{ layer: 'transcribe', source: 'turn', calls: 7, today: 0.003, month: 0.03, seconds: 420 }, { layer: 'vision', source: 'turn', calls: 3, today: 0.001, month: 0.004 }],
  audio: { today_seconds: 420, month_seconds: 3000, today_usd: 0.0315, month_usd: 0.225, cap_minutes: 60 },
});
const SIM = (kind) => ({
  ok: true, replies: kind === 'audio' ? [{ body: 'نعم، المواقف مجانية للضيوف.', notice: false, kind: 'text', buttons: [] }] : [{ body: 'نأسف لذلك، وصلت الصورة إلى فريقنا.\n\nسيكمل معك أحد أفراد فريقنا في هذه المحادثة.', notice: false, kind: 'text', buttons: [] }],
  understanding: kind === 'audio' ? { intents: ['facility_question'], topics: ['parking'] } : null, model_errors: [], error_code: null, message_kind: kind,
  media: [kind === 'audio' ? { kind: 'audio', status: 'transcribed', transcript: 'فيه مواقف للسيارات؟', seconds: 4.4, category: null } : { kind: 'image', status: 'classified', transcript: null, seconds: null, category: 'problem' }],
  priority: kind === 'image' ? 'high' : null, staff_line: kind === 'image' ? 'جهاز التكييف لا يعمل' : null,
  decision: { from: 'new', to: kind === 'image' ? 'human' : 'inquiry', actions: kind === 'image' ? ['chat', 'handoff'] : ['answer'], transitions: [], reason: kind === 'image' ? 'problem_photo' : null },
  sources: { cards: [], read: [], faq: [] }, guard: { ok: true, refusals: [] }, note: null, cost_usd: 0.004, credit: 'ok',
  sim: { state: kind === 'image' ? 'human' : 'inquiry', first_reply: false, history: [], draft: null, failed_understandings: 0, out_of_scope: 0 },
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
const browser = await chromium.launch({ channel: 'chrome' });
for (const role of ['admin', 'management']) {
  const sys = role === 'admin';
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
      // management sees Airport Road's voice already on (to switch it off); the system admin sees both off
      let voiceOn = !sys;
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
        if (fn === 'my_staff') return ok(me(role));
        if (fn === 'hub_assistant_overview') return ok(OVERVIEW(sys, voiceOn));
        if (fn === 'hub_budget_overview') return ok(BUDGET_OVERVIEW(sys));
        if (fn === 'hub_webhook_status') return ok({ system_admin: sys, registered: true, events: [], registered_at: null });
        if (fn === 'hub_unit_media_set') {
          if (body?.p_voice !== null && body?.p_voice !== undefined) voiceOn = body.p_voice;
          return ok({ ok: true, batch_id: id(950) });
        }
        if (fn === 'hub_setting_set') return ok({ ok: true, batch_id: id(951) });
        if (fn === 'hub-admin' && body?.action === 'simulate') return ok(SIM(body?.media?.kind ?? 'audio'));
        if (fn === 'hub-admin') return ok({ ok: true, events: [], changed: false });
        if (fn === 'hub_phone_auto_list') return ok({ can_edit: sys, rows: [] });
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
      await page.locator('[data-unit="airport-road"] [data-unit-media]').waitFor({ timeout: 30000 });

      check((await page.locator('[data-unit-media]').count()) === 2 && (await page.locator('[data-unit="rooftop"] [data-unit-media], [data-unit="lobby-cafe"] [data-unit-media]').count()) === 0,
        `${tag}: the switches on the two active units only`);
      check((await page.locator('[data-tour~="hub-media"]').count()) > 0, `${tag}: the tour target hub-media`);
      const sw = (u, k) => page.locator(`[data-unit="${u}"] [data-media-switch="${k}"]`);
      check((await sw('shafa-road', 'voice').getAttribute('aria-checked')) === 'false' && (await sw('shafa-road', 'images').getAttribute('aria-checked')) === 'false', `${tag}: Shafa Road both «متوقف»`);
      if (sys) {
        check(!(await sw('airport-road', 'voice').isDisabled()), `${tag}: the system admin may switch «الفويس» on`);
        if (w === 1440 && scheme === 'light') {
          await sw('airport-road', 'voice').click();
          await page.locator('[role="dialog"], dialog[open]').first().waitFor({ timeout: 5000 });
          check(!calls.some((c) => c.fn === 'hub_unit_media_set'), `${tag}: «تشغيل» asks first — nothing sent yet`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          check(!calls.some((c) => c.fn === 'hub_unit_media_set'), `${tag}: Esc closes the confirm, nothing sent`);
          await sw('airport-road', 'voice').click();
          await page.locator('[data-action="confirm-go"]').click();
          await page.waitForTimeout(500);
          const c = calls.find((x) => x.fn === 'hub_unit_media_set');
          check(c && c.body.p_unit === id(11) && c.body.p_voice === true && c.body.p_images === null, `${tag}: the confirm → hub_unit_media_set (voice only) — ${JSON.stringify(c?.body)}`);
          check((await page.getByText('تراجع').count()) > 0, `${tag}: «تراجع» offered`);
          check((await sw('airport-road', 'voice').getAttribute('aria-checked')) === 'true', `${tag}: «الفويس» now «مفعّل»`);
          // switching off: at once
          const before = calls.filter((x) => x.fn === 'hub_unit_media_set').length;
          await sw('airport-road', 'voice').click();
          await page.waitForTimeout(500);
          const off = calls.filter((x) => x.fn === 'hub_unit_media_set');
          check(off.length === before + 1 && off.at(-1).body.p_voice === false, `${tag}: switching off goes at once`);
        }
      } else {
        check(await sw('airport-road', 'images').isDisabled(), `${tag}: management cannot switch «الصور» on`);
        check((await page.locator('[data-unit="airport-road"] [data-media-admin]').count()) === 1, `${tag}: the note «يشغّلهما مدير النظام…»`);
        check((await sw('airport-road', 'voice').getAttribute('aria-checked')) === 'true' && !(await sw('airport-road', 'voice').isDisabled()), `${tag}: a switch that is on can be switched off by management`);
        check((await page.locator('[data-unit="airport-road"] [data-media-state]').innerText()).includes('7 دقائق'), `${tag}: today's transcribed minutes «7 دقائق»`);
        if (w === 1440 && scheme === 'light') {
          await sw('airport-road', 'voice').click();
          await page.waitForTimeout(500);
          const c = calls.find((x) => x.fn === 'hub_unit_media_set');
          check(c && c.body.p_voice === false, `${tag}: management switched «الفويس» off — ${JSON.stringify(c?.body)}`);
        }
      }
      // «الميزانية»
      await page.locator('[data-budget-audio]').waitFor({ timeout: 10000 }).catch(() => {});
      const audio = await page.locator('[data-budget-audio]').innerText().catch(() => '');
      check(audio.includes('7 دقائق') && audio.includes('50 دقيقة') && audio.includes('60 دقيقة'), `${tag}: the transcription's own line — today, this month, the cap (${audio.replace(/\s+/g, ' ').slice(0, 160)})`);
      check((await page.locator('[data-budget-model="transcribe"]').innerText()).includes('دولار للدقيقة'), `${tag}: gpt-transcribe priced per minute`);
      check((await page.locator('[data-budget="voice-minutes"]').inputValue()) === '60' && (await page.locator('[data-budget="voice-minutes"]').isDisabled()) === !sys, `${tag}: the voice minutes (60), the system admin's only`);
      if (sys && w === 1440 && scheme === 'light') {
        await page.locator('[data-budget="voice-minutes"]').fill('45');
        await page.locator('[data-action="budget-save"]').click();
        await page.waitForTimeout(500);
        const s = calls.filter((x) => x.fn === 'hub_setting_set');
        check(s.length === 1 && s[0].body.p_key === 'hub_voice_daily_minutes' && s[0].body.p_value === 45, `${tag}: saved as hub_voice_daily_minutes 45 only — ${JSON.stringify(s.map((x) => x.body))}`);
      }
      const text = await page.locator('main').innerText();
      check(!/[٠-٩۰-۹]/.test(text), `${tag}: Western digits only`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal page scroll`);
      await page.screenshot({ path: join(SHOTS, `assistant-media-${role}-${w}-${scheme}.png`), fullPage: true });

      // «المحاكي»: a voice note, then an image; another type refused
      await page.goto(`${BASE}/assistant?tab=sim`, { waitUntil: 'load' });
      await page.locator('[data-field="sim-file"]').waitFor({ timeout: 20000 });
      await page.locator('[data-field="sim-file"]').setInputFiles(TXT);
      await page.waitForTimeout(200);
      check((await page.locator('[data-sim-file-chosen]').count()) === 0, `${tag}: a .txt file refused before any call`);
      await page.locator('[data-field="sim-file"]').setInputFiles(OGG);
      check((await page.locator('[data-sim-file-chosen]').innerText()).includes('رسالة صوتية'), `${tag}: the chosen voice note named`);
      check(!(await page.locator('[data-action="sim-send"]').isDisabled()), `${tag}: «إرسال» with a file and no text`);
      await page.locator('[data-action="sim-send"]').click();
      await page.locator('[data-sim-media="transcribed"]').waitFor({ timeout: 10000 }).catch(() => {});
      const sv = calls.find((x) => x.fn === 'hub-admin' && x.body?.action === 'simulate');
      check(sv && sv.body.media?.kind === 'audio' && /^audio\//.test(sv.body.media.mime) && typeof sv.body.media.data === 'string' && sv.body.text === '', `${tag}: simulate with media {audio, mime, data} — ${JSON.stringify({ ...sv?.body, media: sv?.body?.media ? { kind: sv.body.media.kind, mime: sv.body.media.mime } : null, sim: undefined })}`);
      check((await page.locator('[data-sim-audio]').count()) === 1, `${tag}: the player in the guest bubble`);
      check((await page.locator('[data-sim-media="transcribed"]').innerText()).includes('تفريغ صوتي') && (await page.locator('[data-sim-media="transcribed"]').innerText()).includes('فيه مواقف'), `${tag}: «تفريغ صوتي: …» under it`);
      await page.locator('[data-field="sim-file"]').setInputFiles(PNG);
      await page.locator('[data-field="sim-text"]').fill('المكيف');
      await page.locator('[data-action="sim-send"]').click();
      await page.locator('[data-sim-media="classified"]').waitFor({ timeout: 10000 }).catch(() => {});
      check((await page.locator('[data-sim-media="classified"]').innerText()).includes('صورة مشكلة') && (await page.locator('[data-sim-image]').count()) === 1, `${tag}: «تصنيف الصورة: صورة مشكلة» and the image`);
      check((await page.locator('[data-sim-priority]').count()) === 1 && (await page.locator('[data-sim-staff-line]').innerText()).includes('جهاز التكييف'), `${tag}: «أولوية عالية» and the staff line in the details`);
      const st = await page.locator('main').innerText();
      check(!/[٠-٩۰-۹]/.test(st), `${tag}: the simulator — Western digits only`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: the simulator — no horizontal page scroll`);
      await page.screenshot({ path: join(SHOTS, `sim-media-${role}-${w}-${scheme}.png`), fullPage: true });
      check(!errors.length, `${tag}: no page error — ${errors.join(' | ').slice(0, 200)}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.log(`✗ hub-media-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`✓ hub-media-ui-check: ${checks}/${checks} passed (screenshots in ${SHOTS})`);
