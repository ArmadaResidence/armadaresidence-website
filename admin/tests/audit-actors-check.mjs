// «السجل»: who made each change (Ahmed, 8 Nov 2026 — DECISIONS.md 2026-11-08 «Post-launch session 1», part 7). OFFLINE —
// no Supabase project is reached: the dashboard runs on a Vite dev server whose Supabase URL is a stub origin; the
// session is a fake one (as admin/tests/sidebar-mobile-check.mjs). The stub answers audit_actors with two staff users
// (one inactive) and audit_log with three entries: one by each user, one with no actor (a migration).
// Checked at 1280 and 375, light: every entry shows the actor's name and email next to the date (the email LTR), the
// entry without an actor shows «—» (with its recorded source), the «المستخدم» filter is a select of the staff users
// («الكل» first, the inactive one marked «(موقوف)», «بلا مستخدم مسجَّل (—)» last) and choosing a user / «—» asks
// audit_log for actor_id=eq.<id> / actor_id=is.null — never actor_label. Screenshots in screenshots/audit/.
//   node admin/tests/audit-actors-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const SHOTS = join(ROOT, 'screenshots', 'audit');
mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'bookings', 'audit', 'users'];
const ME = {
  role: 'admin', branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: true, backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === 'audit' ? 'view' : 'edit'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
};
const A = '00000000-0000-4000-8000-0000000000a1';
const R = '00000000-0000-4000-8000-0000000000b2';
const ACTORS = [
  { user_id: R, full_name: 'استقبال طريق المطار', email: 'reception-airport@example.invalid', active: true, is_staff: true },
  { user_id: A, full_name: 'سارة الموظفة', email: 'sara@example.invalid', active: false, is_staff: true },
];
const now = Date.now();
const ROWS = [
  { id: 3, at: new Date(now - 6e4).toISOString(), actor_id: R, actor_label: 'استقبال طريق المطار', entity: 'inventory_days', entity_id: 'x:2026-12-01', branch: 'airport-road', action: 'update', old: { stop_sell: false }, new: { stop_sell: true }, batch_id: null, reverts_batch: null },
  { id: 2, at: new Date(now - 12e4).toISOString(), actor_id: A, actor_label: 'سارة الموظفة', entity: 'settings', entity_id: 'extra_bed_per_night', branch: null, action: 'update', old: { value: 50 }, new: { value: 60 }, batch_id: null, reverts_batch: null },
  { id: 1, at: new Date(now - 18e4).toISOString(), actor_id: null, actor_label: 'migration', entity: 'settings', entity_id: 'reply_alert_hours', branch: null, action: 'insert', old: null, new: { value: 2 }, batch_id: null, reverts_batch: null },
];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: ME.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};
const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h] of [[1280, 900], [375, 812]]) {
  const tag = `${w}`;
  const asked = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: 'light' });
  await ctx.route(`${STUB}/**`, (r) => {
    const u = r.request().url();
    const cors = { 'access-control-allow-origin': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (/\/rest\/v1\/rpc\/my_staff/.test(u)) return ok(ME);
    if (/\/rest\/v1\/rpc\/audit_actors/.test(u)) return ok(ACTORS);
    if (/\/auth\/v1\/user/.test(u)) return ok(USER);
    if (/\/rest\/v1\/audit_log\?/.test(u)) {
      const q = new URL(u).searchParams;
      if (q.get('select')?.includes('actor_id,actor_label')) asked.push(q.get('actor_id') ?? '');
      if (q.has('actor_label')) asked.push('LABEL:' + q.get('actor_label'));
      const f = q.get('actor_id');
      return ok(q.has('in') || q.has('reverts_batch') ? [] : ROWS.filter((x) => (f === 'is.null' ? x.actor_id === null : f ? `eq.${x.actor_id}` === f : true)));
    }
    if (/\/rest\/v1\/rpc\//.test(u)) return ok(null);
    return ok([]);
  });
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v); localStorage.setItem('armada-tour-test', '0'); } catch {}
  }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION)]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/audit`, { waitUntil: 'load' });
  await page.locator('[data-list="audit"] li').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#a-actor option').length >= 4, null, { timeout: 10000 }).catch(() => {});
  const items = await page.$$eval('[data-list="audit"] > li', (lis) => lis.map((li) => {
    const a = li.querySelector('[data-actor]');
    const email = a?.querySelector('[dir="ltr"]');
    return { actor: a?.getAttribute('data-actor'), text: a?.textContent?.trim() ?? '', email: email?.textContent ?? null, beforeDate: !!a && !!a.previousElementSibling?.classList.contains('num-ar') };
  }));
  check(items.length === 3, `${tag}: 3 entries listed (got ${items.length})`);
  check(items[0]?.actor === R && items[0].text.startsWith('استقبال طريق المطار') && items[0].email === 'reception-airport@example.invalid', `${tag}: entry 1 shows the reception user's name and email — ${JSON.stringify(items[0])}`);
  check(items[1]?.actor === A && items[1].text.startsWith('سارة الموظفة') && items[1].email === 'sara@example.invalid', `${tag}: entry 2 shows the inactive user's name and email — ${JSON.stringify(items[1])}`);
  check(items[2]?.actor === 'none' && items[2].text.startsWith('—') && items[2].email === null && items[2].text.includes('تحديث النظام'), `${tag}: the entry without an actor shows «—» (and its source) — ${JSON.stringify(items[2])}`);
  check(items.every((x) => x.beforeDate), `${tag}: the actor sits next to the date`);
  const opts = await page.$$eval('#a-actor option', (o) => o.map((x) => ({ v: x.value, t: x.textContent.trim() })));
  check((await page.locator('select#a-actor').count()) === 1, `${tag}: «المستخدم» is a select`);
  check(opts[0]?.v === '' && opts[0]?.t === 'الكل', `${tag}: «الكل» first — ${JSON.stringify(opts[0])}`);
  check(opts.some((o) => o.v === R && o.t.includes('استقبال طريق المطار') && o.t.includes('reception-airport@example.invalid')), `${tag}: the reception user is offered with its email`);
  check(opts.some((o) => o.v === A && o.t.includes('(موقوف)')), `${tag}: the inactive user is marked «(موقوف)»`);
  check(opts[opts.length - 1]?.v === 'none' && opts[opts.length - 1]?.t.includes('—'), `${tag}: «بلا مستخدم مسجَّل (—)» last`);
  await page.screenshot({ path: join(SHOTS, `audit-${w}.png`), fullPage: true });
  await page.selectOption('#a-actor', A);
  await page.waitForFunction(() => document.querySelectorAll('[data-list="audit"] > li').length === 1, null, { timeout: 10000 }).catch(() => {});
  check(asked.includes(`eq.${A}`), `${tag}: choosing a user asks for actor_id=eq.<id> — ${JSON.stringify(asked)}`);
  check((await page.locator('[data-list="audit"] > li').count()) === 1, `${tag}: the list shows that user's entry only`);
  await page.selectOption('#a-actor', 'none');
  await page.waitForFunction(() => document.querySelector('[data-list="audit"] > li [data-actor="none"]') && document.querySelectorAll('[data-list="audit"] > li').length === 1, null, { timeout: 10000 }).catch(() => {});
  check(asked.includes('is.null'), `${tag}: «—» asks for actor_id=is.null`);
  check(!asked.some((x) => x.startsWith('LABEL:')), `${tag}: the filter never reads actor_label`);
  await ctx.close();
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`\naudit-actors-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ audit-actors-check: ${checks}/${checks} passed (screenshots in ${SHOTS})`);
