// «المحادثات» with every tab, state, owner, language, unit and link (Guest Hub H9 fix 4, 18 Nov 2026 — the red bar
// «القيمة غير صالحة.» came from the tab «الفريق» (?tab=team) reaching public.hub_inbox_list, which knows five tabs).
// OFFLINE — the dashboard on a Vite dev server whose Supabase URL is a stub origin, with a fake session. The stub's
// hub_inbox_list REFUSES what the real function refuses: its tab list is read from the latest migration that defines it
// (a tab outside it → 400, code 22023, «hub_tab»), so a page that would send a bad value fails here too.
// Checked for the system admin (the «الفريق» tab shown) at 1440 light for every value, and a sample at 1440 dark, 375 light
// and 375 dark:
//   - every request to hub_inbox_list carries a tab the server knows; no request answers 4xx;
//   - no «القيمة غير صالحة» anywhere on the page, no red box (role=alert);
//   - ?tab=team shows «الفريق» selected (and no other tab), an unknown ?tab= reads «بانتظار موظف»;
//   - a list that cannot load says in plain Arabic what failed and what to do («تعذّر تحميل قائمة المحادثات.» +
//     «مسح عوامل التصفية»), never the bare validation sentence; «مسح عوامل التصفية» brings the list back.
//   node admin/tests/hub-inbox-filters-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = join(ROOT, '..', 'supabase', 'migrations');
// the tabs the server knows: the latest migration that defines public.hub_inbox_list
const latest = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().reverse()
  .find((f) => /create (or replace )?function public\.hub_inbox_list\(/.test(readFileSync(join(MIG, f), 'utf8')));
const SQL = readFileSync(join(MIG, latest), 'utf8');
const def = SQL.slice(SQL.search(/create (or replace )?function public\.hub_inbox_list\(/));
const SERVER_TABS = (def.match(/v_tab not in \(([^)]+)\)/)?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};
check(SERVER_TABS.length >= 5 && SERVER_TABS.includes('waiting'), `the server's tabs read from ${latest}: ${SERVER_TABS.join(', ')}`);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const ahead = (min) => new Date(NOW + min * 60000).toISOString();
const UNITS = [
  { id: id(11), key: 'airport-road', kind: 'branch', name: 'فرع طريق المطار', status: 'active' },
  { id: id(12), key: 'shafa-road', kind: 'branch', name: 'فرع طريق الشفا', status: 'active' },
];
const ROW = { id: id(1), unit_id: id(11), unit_key: 'airport-road', unit_name: 'فرع طريق المطار', channel_kind: 'whatsapp', state: 'human', owner_kind: null, owner_staff_id: null, owner_name: null,
  tags: [], topics: [], priority: 'normal', language: 'ar', waiting_since: ago(3), window_expires_at: ahead(600), is_test: false, blocked: false, standby_until: null,
  name: 'Guest Alpha', phone_last4: '9301', last_at: ago(3), unread: 1, last: { author: 'guest', kind: 'text', line: 'هل يتوفر موقف؟', at: ago(3) } };
const LIST = () => ({ rows: [ROW], more: false, counts: { waiting: 1, assistant: 0, drafts: 0, all: 1, closed: 0 }, units: UNITS,
  timers: { amber: 5, red: 15, escalate: 30, human_close_hours: 72 }, inbox_on: true, can_edit: true });
const me = () => ({
  role: 'admin', branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code', verified_at: new Date().toISOString(),
  email: 'qa@example.invalid', is_admin: true, backup_codes_left: 10,
  permissions: { overview: 'view', inbox: 'edit', assistant: 'edit', hub_team: 'edit', guests: 'view' },
  sections: ['overview', 'inbox', 'assistant', 'hub_team', 'guests'].map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: id(900), aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

async function context(browser, w, h, scheme, opts = {}) {
  const calls = [];
  const bad = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: scheme });
  await ctx.route(`${STUB}/**`, async (r) => {
    const u = r.request().url();
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const ok = (body, headers = {}) => r.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, ...headers }, body: JSON.stringify(body) });
    const refuse = (message, code = '22023') => {
      bad.push(`${message}`);
      return r.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ code, message, details: null, hint: null }) });
    };
    const fn = (u.match(/\/rest\/v1\/rpc\/([a-z_]+)/) ?? u.match(/\/functions\/v1\/([a-z-]+)/) ?? [])[1];
    let body = null;
    try { body = r.request().postDataJSON(); } catch { /* none */ }
    if (fn) calls.push({ fn, body });
    if (fn === 'my_staff') return ok(me());
    if (fn === 'hub_inbox_list') {
      if (opts.fail) return refuse('hub_tab');
      const tab = body?.p?.tab ?? 'waiting';
      if (!SERVER_TABS.includes(tab)) return refuse('hub_tab');
      if (body?.p?.limit !== undefined && !Number.isInteger(Number(body.p.limit))) return refuse('invalid input syntax for type integer', '22P02');
      if (body?.p?.before !== undefined && !Number.isFinite(Date.parse(body.p.before))) return refuse('invalid input syntax for type timestamp', '22007');
      // H10: «عرض المزيد» — 50 rows and more, then the next page by the cursor
      if (opts.paged) {
        if (!body?.p?.before) return ok({ ...LIST(), rows: Array.from({ length: 50 }, (_, i) => ({ ...ROW, id: id(1000 + i), name: `Guest ${i + 1}`, last_at: ago(3 + i) })), more: true });
        return ok({ ...LIST(), rows: Array.from({ length: 7 }, (_, i) => ({ ...ROW, id: id(2000 + i), name: `Guest page2 ${i + 1}`, last_at: ago(60 + i) })), more: false });
      }
      return ok(LIST());
    }
    if (fn === 'hub_thread') return ok(null);
    if (fn === 'hub_inbox_badge') return ok(1);
    if (fn === 'hub_engine_banner') return ok({ assistant_on: true, capped: false, api_credit: false, alert: false });
    if (fn === 'hub_staff_threads') return ok({ rows: [] });
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
  return { ctx, page, calls, bad, errors };
}

const STATES = ['new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked', 'awaiting_payment', 'human', 'closed'];
const URLS = [
  '', '?tab=assistant', '?tab=drafts', '?tab=all', '?tab=closed', '?tab=orders', '?tab=team', '?tab=xyz', '?tab=',
  ...STATES.map((s) => `?state=${s}`), '?state=standby', '?state=waiting_staff',
  ...['me', 'none', 'phone', 'assistant', id(5)].map((o) => `?owner=${o}`),
  ...['ar', 'en'].map((l) => `?language=${l}`),
  ...['airport-road', 'shafa-road', 'lobby-cafe', 'rooftop'].map((k) => `?unit=${k}`),
  '?blocked=1', '?q=AR-20261118', '?q=9301', `?c=${id(1)}`, `?tab=team&c=${id(1)}`, `?tab=closed&state=human&owner=me&language=en&unit=shafa-road&blocked=1`,
];
const SAMPLE = ['', '?tab=team', '?tab=xyz', '?state=human', '?unit=shafa-road'];

async function visit(page, calls, bad, url, tag) {
  calls.length = 0;
  bad.length = 0;
  await page.goto(`${BASE}/inbox${url}`, { waitUntil: 'load' });
  if (/tab=team/.test(url)) await page.locator('[data-team-tab]').waitFor({ timeout: 30000 });
  else await page.locator('[data-conv-row], [data-pane="list"]').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(350);
  const tabs = calls.filter((c) => c.fn === 'hub_inbox_list').map((c) => c.body?.p?.tab);
  check(tabs.length > 0 && tabs.every((t) => SERVER_TABS.includes(t)), `${tag} ${url || '(none)'}: hub_inbox_list only with a tab the server knows — ${tabs.join(',')}`);
  check(bad.length === 0, `${tag} ${url || '(none)'}: no request refused — ${bad.join(' | ')}`);
  const text = await page.locator('main').innerText();
  check(!/القيمة غير صالحة/.test(text) && (await page.locator('[role="alert"]').count()) === 0, `${tag} ${url || '(none)'}: no red bar, no «القيمة غير صالحة»`);
  if (url === '?tab=team') {
    check((await page.locator('[data-tab="team"]').getAttribute('aria-selected')) === 'true' && (await page.locator('[role="tab"][aria-selected="true"]').count()) === 1,
      `${tag}: «الفريق» is the one selected tab`);
  }
  if (url === '?tab=xyz') check((await page.locator('[data-tab="waiting"]').getAttribute('aria-selected')) === 'true', `${tag}: an unknown tab reads «بانتظار موظف»`);
  check(!/[٠-٩]/.test(text), `${tag} ${url || '(none)'}: Western digits`);
}

const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h, scheme, urls] of [[1440, 900, 'light', URLS], [1440, 900, 'dark', SAMPLE], [375, 812, 'light', SAMPLE], [375, 812, 'dark', SAMPLE]]) {
  const tag = `${w} ${scheme}`;
  const { ctx, page, calls, bad, errors } = await context(browser, w, h, scheme);
  for (const u of urls) await visit(page, calls, bad, u, tag);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal page scroll`);
  check(!errors.length, `${tag}: no page error — ${errors.join(' | ').slice(0, 300)}`);
  await ctx.close();
}

// a list that cannot load: plain Arabic — what failed and what to do; «مسح عوامل التصفية» brings the list back
for (const [w, scheme] of [[1440, 'light'], [375, 'dark']]) {
  const { ctx, page, errors } = await context(browser, w, w === 375 ? 812 : 900, scheme, { fail: true });
  await page.goto(`${BASE}/inbox?state=human`, { waitUntil: 'load' });
  await page.locator('[role="alert"]').first().waitFor({ timeout: 30000 });
  const alert = (await page.locator('[role="alert"]').first().innerText()).trim();
  check(/^تعذّر تحميل قائمة المحادثات\./.test(alert) && !/^القيمة غير صالحة\.?$/.test(alert) && /(حدّث الصفحة|مسح عوامل التصفية)/.test(alert),
    `${w} ${scheme}: the error says what failed and what to do — «${alert}»`);
  check((await page.locator('[data-error-reset] button').count()) === 1, `${w} ${scheme}: «مسح عوامل التصفية» offered`);
  await page.locator('[data-error-reset] button').click();
  await page.waitForTimeout(300);
  check(!new URL(page.url()).search, `${w} ${scheme}: «مسح عوامل التصفية» clears the link's filters`);
  check(!errors.length, `${w} ${scheme}: no page error — ${errors.join(' | ').slice(0, 300)}`);
  await ctx.close();
}

// H10 (Ahmed, 18 Nov 2026): «عرض المزيد» after 50 rows — the next page by the server's cursor, appended, then gone
for (const [w, scheme] of [[1440, 'light'], [1440, 'dark'], [375, 'light'], [375, 'dark']]) {
  const { ctx, page, calls, errors } = await context(browser, w, w === 375 ? 812 : 900, scheme, { paged: true });
  await page.goto(`${BASE}/inbox?tab=all`, { waitUntil: 'load' });
  await page.locator('[data-conv-row]').first().waitFor({ timeout: 30000 });
  check((await page.locator('[data-conv-row]').count()) === 50 && (await page.locator('[data-more]').count()) === 1, `${w} ${scheme}: 50 rows, then «عرض المزيد»`);
  await page.locator('[data-more]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-conv-row]').length === 57, null, { timeout: 15000 }).catch(() => null);
  check((await page.locator('[data-conv-row]').count()) === 57 && (await page.locator('[data-more]').count()) === 0, `${w} ${scheme}: the next page appended, «عرض المزيد» gone at the end`);
  const pages = calls.filter((c) => c.fn === 'hub_inbox_list' && c.body?.p?.before);
  check(pages.length === 1 && pages[0].body.p.tab === 'all', `${w} ${scheme}: the next page asked with the cursor and the same tab`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${w} ${scheme}: no horizontal page scroll with «عرض المزيد»`);
  check(!errors.length, `${w} ${scheme}: no page error — ${errors.join(' | ').slice(0, 300)}`);
  await ctx.close();
}

await browser.close();
await server.close();
if (failures.length) {
  console.error(`\nhub-inbox-filters-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ hub-inbox-filters-check: ${checks}/${checks} passed`);
