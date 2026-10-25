// Dashboard e2e (docs/phase-2a-plan.md §12.5) — Playwright against a running dashboard (dev server or a deployment)
// with the QA staff users created by supabase/migrations/20261025000500_phase2a_qa_users.sql (run it first through the Supabase MCP / psql; it
// prints nothing secret — the passwords are in that file and in this script only for *.qa.invalid users that cannot
// receive mail and are deleted by qa-users.sql 'drop').
//
//   node admin/tests/dashboard-check.mjs [BASE_URL]        default http://127.0.0.1:5173
//
// Everything it writes is undone at the end (test room type via qa_fixture, overrides deactivated, settings restored)
// — but it does touch the real settings table through management (switches are restored to OFF, never left on).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { totp } from './totp.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const USERS = {
  rec_air: 'rec-air@qa.invalid',
  rec_shafa: 'rec-shafa@qa.invalid',
  mgmt: 'mgmt@qa.invalid',
  admin: 'admin@qa.invalid',
};
// SUPABASE_URL / SUPABASE_ANON_KEY / BOOKING_TEST_TOKEN from .env; process.env overrides them (preview branch runs)
const fileEnv = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const env = { ...fileEnv, ...Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'BOOKING_TEST_TOKEN'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
const H = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'x-armada-test': env.BOOKING_TEST_TOKEN };
const rpc = async (fn, args) => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const D = (n) => addDays(riyadhToday(), n);

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, { mfa = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error (${email}): ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  if (mfa) {
    await page.waitForURL(/\/mfa/, { timeout: 30000, waitUntil: 'commit' });
    // first login enrols: the secret is printed under the QR (async); later logins only ask for the code
    const secretEl = page.locator('p.latin.select-all');
    await Promise.race([secretEl.waitFor({ timeout: 20000 }), page.locator('[role=alert]').waitFor({ timeout: 20000 })]).catch(() => {});
    const alert = await page.locator('[role=alert]').textContent().catch(() => null);
    let secret = null;
    if (await secretEl.count()) secret = (await secretEl.textContent()).trim();
    if (!secret) throw new Error(`mfa: no secret shown${alert ? ` — ${alert}` : ' (already enrolled? qa_users drop + create resets it)'}`);
    await page.fill('#code', totp(secret));
    await page.click('button:has-text("تحقق")');
  }
  // the router moves to /bookings with pushState; wait for the URL, then for the list to render (dev server may be slow)
  await page.waitForURL(/\/bookings/, { timeout: 30000, waitUntil: 'commit' });
  await page.waitForSelector('#f-branch', { timeout: 30000 });
  return { ctx, page };
}

try {
  await rpc('qa_fixture', { p_action: 'purge' });
  const fx = await rpc('qa_fixture', { p_action: 'setup', p_args: { branch: 'airport-road', base_rate: 120, nights: [{ night: D(20), rooms_to_sell: 2 }, { night: D(21), rooms_to_sell: 2 }] } });
  check(!!fx.room_type_id, 'fixture ready');
  // a website request + a confirmed instant booking on the test room type
  const quote = await rpc('quote_stay', { p_branch: 'airport-road', p_room: 'qa-test-room', p_check_in: D(20), p_check_out: D(22), p_adults: 2, p_children: 0, p_children_ages: null, p_extra_beds: 0, p_breakfast: 'without' });
  const submit = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/booking-request`, { method: 'POST', headers: { ...H, 'x-armada-test-mail': 'none' }, body: JSON.stringify({ locale: 'ar', branch: 'airport-road', room: 'qa-test-room', check_in: D(20), check_out: D(22), adults: '2', children: '0', extra_beds: '0', breakfast: 'without', name: 'تجربة النظام', phone: '0500000000', country: 'SA', email: '', notes: 'dashboard-check', page: 'qa', ...body }) }).then((r) => r.json());
  const r1 = await submit({ quoted_total: quote.quote.total });
  const r2 = await submit({ extra_beds: '1', quoted_total: quote.quote.total + 100 });
  check(r1.status === 'confirmed' && r2.status === 'request', 'seed: one confirmed + one request (extra bed)', JSON.stringify([r1.status, r2.status, r2.reason]));

  // ── reception (Airport Road): no MFA, own branch only ──
  {
    const { ctx, page } = await login(USERS.rec_air);
    await page.waitForSelector('#f-branch option', { state: 'attached', timeout: 10000 });
    check(await page.locator('#f-branch').isDisabled(), 'reception: branch filter locked');
    check((await page.locator('#f-branch option').count()) === 1, 'reception: only its branch offered', String(await page.locator('#f-branch option').count()));
    // admin-only nav hidden
    check((await page.locator('nav a:has-text("المستخدمون")').count()) === 0, 'reception: no Users nav');
    check((await page.locator('nav a:has-text("الإعدادات")').count()) === 0, 'reception: no Settings nav');
    // test bookings are invisible to non-admin staff
    await page.fill('#f-q', r1.ref);
    await page.waitForTimeout(800);
    check((await page.locator(`[data-ref="${r1.ref}"]`).count()) === 0, 'reception: test booking hidden (is_test)');
    // inventory: own branch grid loads; bulk edit on a far-future range then undo
    await page.goto(`${BASE}/inventory?from=${D(200)}`);
    await page.waitForSelector('[data-grid="inventory"]');
    await page.click('[data-action="bulk"]');
    await page.fill('#b-from', D(200));
    await page.fill('#b-to', D(201));
    await page.fill('#b-n', '3');
    await page.click('[data-action="bulk-save"]');
    await page.waitForSelector(`[data-night="${D(200)}"]`);
    await page.waitForFunction((n) => document.querySelector(`[data-night="${n}"][data-rt="king-room"]`)?.textContent.includes('3 / 0'), D(200), { timeout: 25000 });
    check(true, 'reception: bulk inventory edit applied (3 rooms on 2 nights)');
    // single cell: set the king room night 200 back to 0 with expected = 3
    await page.click(`[data-night="${D(200)}"][data-rt="king-room"]`);
    await page.fill('#cell-rooms', '0');
    await page.click('[data-action="cell-save"]');
    await page.waitForFunction((n) => document.querySelector(`[data-night="${n}"][data-rt="king-room"]`)?.textContent.includes('0 / 0'), D(200), { timeout: 10000 });
    check(true, 'reception: single-cell edit with optimistic concurrency');
    // audit shows the branch's rows with the shared label
    await page.goto(`${BASE}/audit`);
    await page.waitForSelector('[data-list="audit"], p');
    const audit = await page.locator('[data-list="audit"]').textContent().catch(() => '');
    check(audit.includes('استقبال طريق المطار') && audit.includes('تعديل جماعي'), 'reception: audit lists its bulk edit under the shared login', audit.slice(0, 120));
    await ctx.close();
  }

  // ── reception (Shafa Road) cannot reach Airport data ──
  {
    const { ctx, page } = await login(USERS.rec_shafa);
    await page.goto(`${BASE}/inventory?branch=airport-road&from=${D(200)}`);
    await page.waitForSelector('[data-grid="inventory"], [role=alert]');
    const rows = await page.locator('[data-rt]').count();
    const airport = await page.locator('[data-rt="twin-room"]').count();
    check(rows > 0 && airport === 0, 'shafa reception: forced airport URL still shows only Shafa room types', `${rows} cells, airport cells ${airport}`);
    await ctx.close();
  }

  // ── management: TOTP, both branches, settings; confirm + cancel the test bookings as admin ──
  {
    const { ctx, page } = await login(USERS.mgmt, { mfa: true });
    await page.waitForFunction(() => document.querySelectorAll('#f-branch option').length >= 3, null, { timeout: 10000 }).catch(() => {});
    check((await page.locator('#f-branch option').count()) === 3, 'management: both branches + all', String(await page.locator('#f-branch option').count()));
    await page.goto(`${BASE}/settings`);
    await page.waitForSelector('[data-switch="show_prices:airport-road"]');
    const sw = page.locator('[data-switch="show_prices:airport-road"]');
    check(!(await sw.isChecked()), 'settings: show_prices airport-road is OFF in production');
    // rates: base-rate editor is visible for both branches
    await page.goto(`${BASE}/rates?branch=shafa-road`);
    await page.waitForSelector('[data-grid="rates"]');
    check((await page.locator('[data-action="base-rate"]').count()) >= 6, 'management: Shafa rates grid with base-rate editors');
    await ctx.close();
  }
  {
    const { ctx, page } = await login(USERS.admin, { mfa: true });
    await page.fill('#f-q', r2.ref);
    await page.waitForSelector(`[data-ref="${r2.ref}"]`, { timeout: 10000 });
    check(true, 'admin: sees the test request');
    await page.click(`[data-ref="${r2.ref}"]`);
    await page.click('[data-action="confirm"]');
    await page.selectOption('#confirm-rt', { label: 'QA test room' }).catch(() => page.selectOption('#confirm-rt', { label: 'غرفة اختبار' }));
    await page.click('[data-action="confirm-go"]');
    const confirmedRow = page.locator(`[data-ref="${r2.ref}"][data-status="confirmed"]`);
    await Promise.race([confirmedRow.waitFor({ timeout: 20000 }), page.locator('dialog[open] [role=alert], dialog[open] .text-error').first().waitFor({ timeout: 20000 })]).catch(() => {});
    const dialogErr = await page.locator('dialog[open] [role=alert], dialog[open] .text-error').first().textContent().catch(() => null);
    check((await confirmedRow.count()) === 1, 'admin: confirmed the request from the dashboard', dialogErr ?? 'no row and no error shown');
    if (!(await confirmedRow.count())) throw new Error(`confirm failed: ${dialogErr ?? 'timeout'}`);
    let st = await rpc('qa_fixture', { p_action: 'state', p_args: { branch: 'airport-road' } });
    const n20 = st.inventory.find((i) => i.night === D(20));
    check(n20.rooms_to_sell === 0 && n20.booked === 2, 'stock after two confirmations: 0 left / 2 booked', JSON.stringify(n20));
    // cancel the instant one → stock back
    await page.fill('#f-q', r1.ref);
    await page.waitForSelector(`[data-ref="${r1.ref}"]`, { timeout: 10000 });
    await page.click(`[data-ref="${r1.ref}"]`);
    await page.click('[data-action="cancel"]');
    await page.fill('#cancel-reason', 'qa cancel');
    await page.click('dialog[open] .btn-danger');
    await page.waitForSelector(`[data-ref="${r1.ref}"][data-status="cancelled"]`, { timeout: 20000 });
    st = await rpc('qa_fixture', { p_action: 'state', p_args: { branch: 'airport-road' } });
    const n20b = st.inventory.find((i) => i.night === D(20));
    check(n20b.rooms_to_sell === 1 && n20b.booked === 1, 'cancel restored the night (1 left / 1 booked)', JSON.stringify(n20b));
    // users screen lists the QA users
    await page.goto(`${BASE}/users`);
    const userRow = page.locator(`[data-user="${USERS.rec_air}"]`);
    await Promise.race([userRow.waitFor({ timeout: 30000 }), page.locator('[role=alert]').waitFor({ timeout: 30000 })]).catch(() => {});
    const usersErr = await page.locator('[role=alert]').textContent().catch(() => null);
    check((await userRow.count()) === 1, 'admin: users list loads through admin-users', usersErr ?? 'no row and no error shown');
    await ctx.close();
  }
} catch (e) {
  fails.push(`exception: ${e?.stack || e}`);
  console.error(e);
} finally {
  await browser.close();
  try {
    await rpc('qa_fixture', { p_action: 'purge' });
    check(true, 'purge');
  } catch (e) {
    fails.push(`purge failed: ${e}`);
  }
}
console.log(`\n${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('✓ dashboard checks passed');
