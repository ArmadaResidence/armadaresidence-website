// Guest Hub H8 (16 Nov 2026) — «الآن» and «التقارير» → «المحادثات والمساعد», offline (a Vite dev server on a stub Supabase
// origin, a fake session; nothing reaches a project). Spec group L:
//   «الآن»: counts and times only — no guest name, no message text, no phone anywhere on the page; the assistant's revenue
//   only for a user with «الأرقام المالية» (the stub answers as the server does); live without a reload (the minute's
//   refresh, the clock moving — Playwright's clock); «وضع الشاشة» full screen with the Riyadh clock and no navigation, Esc
//   leaves it; the tour targets;
//   «التقارير»: ?day=YYYY-MM-DD (the daily report's link) → that one day, report_hub asked for it, the section in view; the
//   revenue KPI only with «الأرقام المالية»; the unit table.
// admin (finance) and reception (no finance) × 1440 + 375 × light + dark, Western digits, no horizontal scroll, axe.
// Inside admin-hub-check.
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

const SECTIONS = ['overview', 'reports', 'finance', 'now', 'inbox'];
const me = (role, perms) => ({
  role, branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, perms[s] ?? 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = (money, at) => ({
  at, today: '2026-11-16',
  units: [
    { key: 'airport-road', name_ar: 'فرع طريق المطار', branch: 'airport-road', assistant: 4, collecting: 2, waiting: 1, with_staff: 2, longest_wait_min: 7, orders_waiting: 0 },
    { key: 'shafa-road', name_ar: 'فرع طريق الشفا', branch: 'shafa-road', assistant: 1, collecting: 0, waiting: 0, with_staff: 0, longest_wait_min: null, orders_waiting: 0 },
  ],
  replies_today: 23, handoffs_today: 3,
  bookings_today: { site: 2, assistant: 3, staff: 1, assistant_instant: 2, assistant_request: 1 },
  ...(money ? { revenue: { today: 1850, month: 12400 } } : {}),
  feed: [{ kind: 'hub_booking', unit: 'فرع طريق المطار', branch: 'airport-road', at }, { kind: 'hub_message', unit: 'فرع طريق الشفا', branch: 'shafa-road', at }, { kind: 'hub_handoff', unit: 'فرع طريق المطار', branch: 'airport-road', at }],
});
const HUBR = (money, day) => ({
  period: { from: day, to: day },
  units: [{ key: 'airport-road', name_ar: 'فرع طريق المطار', branch: 'airport-road', conversations: 12, handed_off: 3, assistant_only: 9, ai_median_min: 0.4, ai_p90_min: 1.2, staff_median_min: 6, staff_p90_min: 18, quoted: 5, booked: 2, model_cost_usd: 0.42 }],
  bookings: { instant: 2, request: 1, confirmed: 2, ...(money ? { revenue: 1200 } : {}) },
  sales_requests: { hall: 1, group: 2 }, topics: [{ key: 'parking', label_ar: 'المواقف', count: 4 }], whatsapp: { templates: 6, estimate_usd: 0.08 },
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

const ROLES = [['admin', { finance: 'view', reports: 'view', now: 'view', inbox: 'edit' }], ['reception', { finance: 'none', reports: 'none', now: 'view', inbox: 'edit' }]];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, perms] of ROLES) {
  const money = perms.finance !== 'none';
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
        if (fn) calls.push({ fn, body, t: Date.now() });
        if (fn === 'my_staff') return ok(me(role, perms));
        if (fn === 'hub_now') return ok(NOW(money, new Date().toISOString()));
        if (fn === 'report_hub') return ok(HUBR(money, body?.p_from));
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
      await page.clock.install();

      // ── «الآن» ──
      await page.goto(`${BASE}/now`, { waitUntil: 'load' });
      await page.locator('[data-page="now"] [data-now-unit="airport-road"]').waitFor({ timeout: 30000 });
      const text = await page.evaluate(() => document.querySelector('main')?.innerText ?? document.body.innerText);
      check(!/\+?\d[\d\s]{8,}\d/.test(text.replace(/\d{1,2}:\d{2}(:\d{2})?/g, '')), `${tag}: «الآن» shows no phone number`);
      check(!/مستخدم تجريبي للفحص/.test(await page.locator('[data-page="now"]').innerText()), `${tag}: «الآن» shows no name`);
      check(await page.locator('[data-now-unit="airport-road"] [data-v="waiting"]').innerText() === '1' && /7 دقائق/.test(await page.locator('[data-now-unit="airport-road"] [data-v="longest"]').innerText()), `${tag}: waiting and the longest wait per unit (counted in words)`);
      check(/3/.test(await page.locator('[data-now-stat="assistant"]').innerText()) && /فوري 2 · طلب حجز 1/.test(await page.locator('[data-now-assistant-split]').innerText()), `${tag}: bookings today by source, the assistant's instant / request`);
      check((await page.locator('[data-now-stat="revenue-today"]').count() > 0) === money, `${tag}: the assistant's revenue ${money ? 'shown' : 'hidden'} with${money ? '' : 'out'} «الأرقام المالية»`);
      check((await page.locator('[data-feed-kind]').count()) === 3 && /حجز من المحادثة/.test(await page.locator('[data-now-feed]').innerText()), `${tag}: the live feed — kind, unit and time only`);
      for (const k of ['now-today', 'now-units', 'now-feed', 'now-screen']) check(await page.locator(`[data-tour~="${k}"]`).count() > 0, `${tag}: the tour target ${k}`);
      // live without a reload: the minute's refresh asks hub_now again, the page stays the same document
      const marker = await page.evaluate(() => (window.__h8 = Math.random()));
      const before = calls.filter((c) => c.fn === 'hub_now').length;
      await page.clock.runFor(61_000);
      await page.waitForTimeout(300);
      check(calls.filter((c) => c.fn === 'hub_now').length > before && (await page.evaluate(() => window.__h8)) === marker, `${tag}: refreshed without a reload`);
      await sane(page, `${tag} «الآن»`);
      // «وضع الشاشة»
      await page.locator('[data-action="now-screen"]').click();
      await page.locator('[data-now-screen]').waitFor({ timeout: 5000 });
      check(/^\d{2}:\d{2}:\d{2}$/.test((await page.locator('[data-now-screen] [data-now-clock]').innerText()).trim()), `${tag}: screen mode — the Riyadh clock with seconds`);
      const covered = await page.evaluate(() => {
        const s = document.querySelector('[data-now-screen]').getBoundingClientRect();
        return s.left <= 0 && s.top <= 0 && s.right >= innerWidth - 1 && s.bottom >= innerHeight - 1;
      });
      check(covered, `${tag}: screen mode covers the navigation`);
      await page.keyboard.press('Escape');
      await page.locator('[data-page="now"]').waitFor({ timeout: 5000 });
      check(await page.locator('[data-now-screen]').count() === 0, `${tag}: Esc leaves screen mode`);

      // ── «التقارير» → «المحادثات والمساعد» (?day= from the daily report) ──
      if (perms.reports !== 'none') {
        await page.goto(`${BASE}/reports?day=2026-11-15`, { waitUntil: 'load' });
        await page.locator('[data-section="hub"] [data-hub-units]').waitFor({ timeout: 30000 });
        const rh = calls.filter((c) => c.fn === 'report_hub').at(-1);
        check(rh?.body?.p_from === '2026-11-15' && rh?.body?.p_to === '2026-11-15', `${tag}: ?day= → report_hub for that day`);
        check((await page.locator('[data-kpi="hub-revenue"]').count() > 0) === money, `${tag}: the assistant's revenue KPI only with «الأرقام المالية»`);
        check(/فوري 2 · طلب 1/.test(await page.locator('[data-kpi="hub-bookings"]').innerText()), `${tag}: the assistant's bookings, instant / request`);
        check(/القاعة 1 · المجموعات 2/.test(await page.locator('[data-hub-sales]').innerText()), `${tag}: the hall and group requests sent to sales`);
        check(/0\.42 دولار/.test(await page.locator('[data-hub-units]').innerText()), `${tag}: the model cost per unit`);
        await sane(page, `${tag} «التقارير»`);
      }
      check(errors.length === 0, `${tag}: no page error — ${errors.slice(0, 2).join(' | ')}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`hub-now-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`hub-now-ui-check: ${checks} checks passed`);
