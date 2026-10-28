// Dashboard e2e (docs/phase-2a-plan.md §12.5 + docs/phase-2a1-plan.md §8) — Playwright against a running dashboard (dev
// server or a deployment) with the QA staff users created by internal.qa_users('create') on a PREVIEW BRANCH (never
// production). Addresses end in .qa.invalid; passwords live in that migration and here only.
//
//   node admin/tests/dashboard-check.mjs [BASE_URL]        default http://127.0.0.1:5173
//   env SUPABASE_URL / SUPABASE_ANON_KEY / BOOKING_TEST_TOKEN  (the branch; .env values are the fallback)
//       SUPABASE_SERVICE_ROLE_KEY                             the branch's service role: enables the invite-link checks
//
// Phase 2a.1 coverage: Western digits on every page with every dialog open; the site's picker on every date field
// (no typing, past viewable in filters, edits from today); inventory open / closed per cell, row and bulk + legend;
// the 30 s undo toast and the audit revert (+ a conflict that changes nothing); the permission matrix (view = read-only
// screen, revocation at once in another session, last-admin guard); room availability toggle → site_room_types;
// invite link → fresh context → «متابعة» → password → email code → in, and a prefetch GET that must not consume the link.
// 26 Oct 2026 (password rule): the live checklist on /set-password (lines, ✓/✗ per keystroke, save disabled until every
// line is met, the stubbed weak / leaked refusal, Auth accepting a letters-and-symbols password) and the show / hide
// toggle on every password field (login and both set-password fields: aria-pressed, labels, 44 px, RTL inline-end,
// focus + caret kept, keyboard, never submits, hidden again after a successful sign-in).
// Phase 2a.2 (26 Oct 2026): every sign-in passes the email code (the login-code function answers the code itself in test
// mode for *.qa.invalid users — code-login.mjs); the second-step block covers the code screen, wrong / locked codes,
// remembered devices and their revocation, the admin's backup codes (forced first generation, email failure → backup
// code, regeneration after a fresh code, download), the password-change trigger; then the site defaults (admin only,
// save + undo, the restore dialog with the switch tick, undo of a restore, the audit label, the site-rebuild call).
// 28 Oct 2026 (decision B): every dialog, drawer and confirm of the inventory at 1440 (mouse) and 375 (touch) — outside
// presses and drags never close, clean / dirty close, the unsaved-changes confirm, saving in flight, a failed save,
// beforeunload only while dirty, the page-level forms and the sidebar (admin/tests/dialog-guard.mjs).
// Everything it writes is undone at the end (test room type via qa_fixture, overrides deactivated, settings restored).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { APP_PATH, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';
import { guardChecks, pageGuardChecks } from './dialog-guard.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
// what the invitee sets (26 Oct 2026 rule: ≥ 8 printable ASCII, no spaces, no required classes): letters and symbols only
const INVITEE_PW = 'qa-armada-pass!';
const USERS = {
  rec_air: 'rec-air@qa.invalid',
  rec_shafa: 'rec-shafa@qa.invalid',
  mgmt: 'mgmt@qa.invalid',
  admin: 'admin@qa.invalid',
};
const fileEnv = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const env = { ...fileEnv, ...Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'BOOKING_TEST_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
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
// nights the inventory / rates checks write to: far in the future and different per run, so a previous run's state on
// the branch (real room types, not purged) never pre-satisfies a wait
const SLOT = Math.floor(Date.now() / 60000) % 50;
const INV = 300 + SLOT; // inventory bulk / cell / row checks: nights INV, INV + 1 (king-room, Airport Road)
const RATE = 40 + SLOT; // rates single-night checks (king-room, Shafa Road)
const ARABIC_DIGITS = new RegExp(`[${String.fromCharCode(0x0660)}-${String.fromCharCode(0x0669)}${String.fromCharCode(0x06f0)}-${String.fromCharCode(0x06f9)}]`);

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
/** no Arabic-Indic digit anywhere in the rendered page (dialogs included) */
async function digits(page, label) {
  const text = await page.evaluate(() => document.body.innerText);
  check(!ARABIC_DIGITS.test(text), `digits: ${label}`, text.match(ARABIC_DIGITS)?.[0]);
  const nativeDates = await page.locator('input[type=date], input[type=time]').count();
  check(nativeDates === 0, `no native date/time input: ${label}`, String(nativeDates));
}
/** tap a day inside the open picker, moving months as needed */
async function tapDay(page, iso) {
  const dlg = page.locator('dialog.dp[open]');
  for (let i = 0; i < 30; i++) {
    const cell = dlg.locator(`td[data-date="${iso}"]`);
    if (await cell.count()) {
      await cell.click();
      return;
    }
    const shown = await dlg.locator('.dp-grid td[data-date]').first().getAttribute('data-date');
    await dlg.locator(Date.parse(iso) > Date.parse(shown) ? '[data-dr-next]' : '[data-dr-prev]').click();
  }
  throw new Error(`picker: could not reach ${iso}`);
}
/** single-date field: open from `trigger`, tap the day (the picker closes itself) */
async function pickDate(page, triggerSel, iso) {
  await page.click(triggerSel);
  await page.locator('dialog.dp[open]').waitFor({ timeout: 10000 });
  check((await page.evaluate(() => document.activeElement?.tagName)) !== 'INPUT', 'picker: no text input took focus');
  await tapDay(page, iso);
  await page.locator('dialog.dp[open]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
}
/** range field: open from the start trigger, tap arrival then departure, «تم» */
async function pickRange(page, startSel, a, b) {
  await page.click(startSel);
  const dlg = page.locator('dialog.dp[open]');
  await dlg.waitFor({ timeout: 10000 });
  check((await page.evaluate(() => document.activeElement?.tagName)) !== 'INPUT', 'picker: no text input took focus');
  await tapDay(page, a);
  await tapDay(page, b);
  await dlg.locator('[data-dr-done]').click();
  await dlg.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}

const browser = await chromium.launch({ channel: 'chrome' });
const NO_ACCESS = 'لا صلاحية لهذا الحساب';
/** installed before any script of the page: records every text the body ever showed that must never flash */
const WATCH = `(() => {
  window.__flashes = [];
  const seen = (root) => { const t = root.textContent || ''; if (t.includes(${JSON.stringify(NO_ACCESS)})) window.__flashes.push('no-access'); };
  const mo = new MutationObserver((list) => { for (const m of list) { for (const n of m.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) seen(n); if (m.type === 'characterData') seen(m.target); } });
  const start = () => { if (document.body) { seen(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); } else requestAnimationFrame(start); };
  start();
})();`;
const flashes = (page) => page.evaluate(() => window.__flashes ?? []);
/** the first of these selectors to appear (each wait settles, so no rejection is left unhandled) */
async function firstOf(page, map, timeout = 30000) {
  const waits = Object.entries(map).map(([k, sel]) => page.waitForSelector(sel, { timeout }).then(() => k, () => null));
  const k = await Promise.race(waits.map((w) => w.then((v) => v ?? new Promise(() => {}))).concat(Promise.all(waits).then(() => null)));
  if (!k) throw new Error(`none of ${Object.values(map).join(', ')} appeared`);
  return k;
}
let adminBackup = null; // the QA admin's backup codes, generated on its first sign-in of the run (forced page)
/** sign in with password + email code (test mode). remember → «تذكّر هذا الجهاز». An existing ctx keeps its device token. */
async function login(email, { viewport = { width: 1280, height: 900 }, remember = false, ctx: given = null } = {}) {
  const ctx = given ?? (await browser.newContext({ viewport, locale: 'ar' }));
  const codes = [];
  if (!given) {
    await ctx.addInitScript(WATCH);
    ctx.__codes = codes;
    await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  }
  const sink = ctx.__codes ?? codes;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error (${email}): ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  // by content, not by URL: the app passes through /bookings before the gate sends an unverified session to /code
  let at = await firstOf(page, { code: '#code', app: '#app-main', backup: '[data-action="generate-backup"]' });
  if (at === 'code') {
    await passCode(page, sink, { remember });
    at = await firstOf(page, { app: '#app-main', backup: '[data-action="generate-backup"]' });
  }
  if (at === 'backup') {
    adminBackup = await handleBackupCodes(page);
    await page.waitForSelector('#app-main', { timeout: 30000 });
  }
  await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
  return { ctx, page, codes: sink };
}
const cellText = async (page, night, rt) => (await page.locator(`[data-night="${night}"][data-rt="${rt}"]`).textContent()) ?? '';
const waitCell = (page, night, rt, re) => page.waitForFunction(({ night, rt, src }) => new RegExp(src).test(document.querySelector(`[data-night="${night}"][data-rt="${rt}"]`)?.textContent ?? ''), { night, rt, src: re.source }, { timeout: 25000 });

try {
  await rpc('qa_fixture', { p_action: 'purge' });
  const fx = await rpc('qa_fixture', { p_action: 'setup', p_args: { branch: 'airport-road', base_rate: 120, nights: [{ night: D(20), rooms_to_sell: 2 }, { night: D(21), rooms_to_sell: 2 }] } });
  check(!!fx.room_type_id, 'fixture ready');
  const quote = await rpc('quote_stay', { p_branch: 'airport-road', p_room: 'qa-test-room', p_check_in: D(20), p_check_out: D(22), p_adults: 2, p_children: 0, p_children_ages: null, p_extra_beds: 0, p_breakfast: 'without' });
  const submit = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/booking-request`, { method: 'POST', headers: { ...H, 'x-armada-test-mail': 'none' }, body: JSON.stringify({ locale: 'ar', branch: 'airport-road', room: 'qa-test-room', check_in: D(20), check_out: D(22), adults: '2', children: '0', extra_beds: '0', breakfast: 'without', name: 'تجربة النظام', phone: '0500000000', country: 'SA', email: '', notes: 'dashboard-check', page: 'qa', ...body }) }).then((r) => r.json());
  const r1 = await submit({ quoted_total: quote.quote.total });
  const r2 = await submit({ extra_beds: '1', quoted_total: quote.quote.total + 100 });
  check(r1.status === 'confirmed' && r2.status === 'request', 'seed: one confirmed + one request (extra bed)', JSON.stringify([r1.status, r2.status, r2.reason]));

  // ── reception (Airport Road): no MFA, own branch only; inventory open/close, undo, digits ──
  {
    const { ctx, page } = await login(USERS.rec_air);
    await page.waitForSelector('#f-branch option', { state: 'attached', timeout: 10000 });
    check(await page.locator('#f-branch').isDisabled(), 'reception: branch filter locked');
    check((await page.locator('#f-branch option').count()) === 1, 'reception: only its branch offered');
    check((await page.locator('nav a:has-text("المستخدمون")').count()) === 0, 'reception: no Users nav');
    check((await page.locator('nav a:has-text("الإعدادات")').count()) === 2, 'reception: Settings nav shown (view)'); // top + tab bar
    await page.fill('#f-q', r1.ref);
    await page.waitForTimeout(900);
    check((await page.locator(`[data-ref="${r1.ref}"]`).count()) === 0, 'reception: test booking hidden (is_test)');
    await digits(page, 'bookings (reception)');
    // the stay filter is the site's picker: past dates reachable
    await pickRange(page, '#f-stay-start', D(-3), D(2));
    check((await page.locator('#f-stay-start').textContent()).trim().length > 0, 'bookings: past date picked in the stay filter (no typing)');

    // inventory: own branch grid; bulk set, cell close/open, row close, undo
    await page.goto(`${BASE}/inventory?from=${D(INV)}`);
    await page.waitForSelector('[data-grid="inventory"]');
    check((await page.locator('.legend').count()) === 1, 'inventory: legend shown');
    await digits(page, 'inventory');
    const before = (await cellText(page, D(INV), 'king-room')).trim(); // what the undo must bring back («—» or an earlier state)
    await page.click('[data-action="bulk"]');
    await pickRange(page, '#bulk-dates-start', D(INV), D(INV + 1));
    await page.click('[role=radiogroup][aria-label="الإجراء"] [role=radio]:has-text("تحديد المتبقي")');
    await page.fill('#b-n', '3');
    await digits(page, 'inventory bulk dialog');
    await page.click('[data-action="bulk-save"]');
    const undo = page.locator('[data-toast="undo"] [data-action="undo"]');
    await undo.waitFor({ timeout: 20000 }).catch(() => {});
    await waitCell(page, D(INV), 'king-room', /3 · 0/);
    check(true, 'reception: bulk inventory edit applied (3 rooms on 2 nights)');
    check((await undo.count()) === 1, 'undo toast shown after the bulk edit');
    await undo.click();
    await page.waitForFunction(({ night, rt, before }) => (document.querySelector(`[data-night="${night}"][data-rt="${rt}"]`)?.textContent ?? '').trim() === before, { night: D(INV), rt: 'king-room', before }, { timeout: 25000 });
    check(true, 'undo: the bulk edit was reversed (the night is back to its earlier state)');
    // redo the bulk edit, then single cell → closed
    await page.click('[data-action="bulk"]');
    await pickRange(page, '#bulk-dates-start', D(INV), D(INV + 1));
    await page.click('[role=radiogroup][aria-label="الإجراء"] [role=radio]:has-text("تحديد المتبقي")');
    await page.fill('#b-n', '3');
    await page.click('[data-action="bulk-save"]');
    await waitCell(page, D(INV), 'king-room', /3 · 0/);
    await page.click(`[data-night="${D(INV)}"][data-rt="king-room"]`);
    await page.click('[role=radiogroup][aria-label="البيع على الموقع"] [role=radio]:has-text("مغلق")');
    await page.click('[data-action="cell-save"]');
    await waitCell(page, D(INV), 'king-room', /مغلق/);
    check((await page.locator(`[data-night="${D(INV)}"][data-rt="king-room"][data-closed="true"]`).count()) === 1, 'cell: closed state (hatched) after «مغلق»');
    await page.click(`[data-night="${D(INV)}"][data-rt="king-room"]`);
    await page.click('[role=radiogroup][aria-label="البيع على الموقع"] [role=radio]:has-text("مفتوح")');
    await page.click('[data-action="cell-save"]');
    await waitCell(page, D(INV), 'king-room', /3 · 0/);
    check(true, 'cell: reopened with the kept count');
    // row: close the visible range
    await page.click('[data-row="king-room"] [data-action="row-menu"]');
    await page.click('[data-action="row-close"]');
    await waitCell(page, D(INV + 1), 'king-room', /مغلق/);
    check(true, 'row: close the visible range');
    await page.click('[data-row="king-room"] [data-action="row-menu"]');
    await page.click('[data-action="row-open"]');
    await waitCell(page, D(INV + 1), 'king-room', /3 · 0/);
    check(true, 'row: open the visible range');
    // past nights: viewable, not editable
    await page.goto(`${BASE}/inventory?from=${D(-10)}`);
    await page.waitForSelector('[data-grid="inventory"]');
    check((await page.locator(`[data-night="${D(-10)}"][data-past="true"]`).count()) > 0, 'inventory: past nights viewable');
    check(await page.locator(`[data-night="${D(-10)}"][data-rt="king-room"]`).isDisabled(), 'inventory: past night not editable');
    await digits(page, 'inventory (past)');
    // audit
    await page.goto(`${BASE}/audit`);
    await page.waitForFunction(() => document.querySelector('[data-list="audit"] li') || Array.from(document.querySelectorAll('#app-main p')).some((p) => p.textContent.trim() === 'لا سجلات.'), null, { timeout: 30000 });
    const audit = await page.locator('[data-list="audit"]').textContent().catch(() => '');
    check(audit.includes('استقبال طريق المطار') && audit.includes('تعديل جماعي'), 'reception: audit lists its bulk edit under the shared login');
    check(audit.includes('استرجاع لتغيير سابق'), 'audit: the undo appears as a revert entry');
    await digits(page, 'audit');
    await ctx.close();
  }

  // ── reception (Shafa Road) cannot reach Airport data ──
  {
    const { ctx, page } = await login(USERS.rec_shafa);
    await page.goto(`${BASE}/inventory?branch=airport-road&from=${D(INV)}`);
    await page.waitForSelector('[data-grid="inventory"], [role=alert]');
    const rows = await page.locator('[data-rt]').count();
    const airport = await page.locator('[data-rt="twin-room"]').count();
    check(rows > 0 && airport === 0, 'shafa reception: forced airport URL still shows only Shafa room types', `${rows} cells, airport cells ${airport}`);
    await ctx.close();
  }

  // ── management: email code, both branches, settings save + undo, rates single-night override + revert conflict ──
  {
    const { ctx, page } = await login(USERS.mgmt);
    await page.waitForFunction(() => document.querySelectorAll('#f-branch option').length >= 3, null, { timeout: 10000 }).catch(() => {});
    check((await page.locator('#f-branch option').count()) === 3, 'management: both branches + all');
    await page.goto(`${BASE}/settings`);
    await page.waitForSelector('[data-switch="show_prices:airport-road"]');
    check(!(await page.locator('[data-switch="show_prices:airport-road"]').isChecked()), 'settings: show_prices airport-road is OFF');
    await digits(page, 'settings');
    // extra bed fee: save → undo
    await page.fill('#bed', '55');
    await page.click('[data-action="save-bed"]');
    await page.locator('[data-toast="undo"]').waitFor({ timeout: 15000 });
    check(true, 'settings: undo toast after a save');
    await page.click('[data-toast="undo"] [data-action="undo"]');
    await page.waitForFunction(() => document.querySelector('#bed')?.value === '50', null, { timeout: 15000 });
    check(true, 'settings: undo restored the extra-bed fee');
    // rates: grid, single-night override, revert from the audit with a conflict
    await page.goto(`${BASE}/rates?branch=shafa-road&from=${D(RATE)}`);
    await page.waitForSelector('[data-grid="rates"]');
    check((await page.locator('[data-action="base-rate"]').count()) >= 6, 'management: Shafa rates grid with base-rate editors');
    await digits(page, 'rates');
    await page.click(`[data-night="${D(RATE)}"][data-rt="king-room"]`);
    await page.fill('#night-price', '333');
    await page.click('[data-action="night-save"]');
    await waitCell(page, D(RATE), 'king-room', /333/);
    check(true, 'rates: single-night override applied');
    const toastUndo = page.locator('[data-toast="undo"] [data-action="undo"]');
    await toastUndo.waitFor({ timeout: 5000 });
    // a second edit on the same night (replaces the first in its own batch)
    await page.click(`[data-night="${D(RATE)}"][data-rt="king-room"]`);
    await page.fill('#night-price', '344');
    await page.click('[data-action="night-save"]');
    await waitCell(page, D(RATE), 'king-room', /344/);
    // revert the FIRST batch from the audit → conflict (the night moved on) → nothing changes
    await page.goto(`${BASE}/audit?entity=rate_overrides`);
    await page.waitForSelector('[data-list="audit"]');
    const groups = page.locator('[data-list="audit"] li[data-batch]');
    const n = await groups.count();
    check(n >= 2, 'audit: both rate batches listed');
    await groups.nth(1).locator('[data-action="revert"]').click();
    await page.click('[data-action="revert-go"]');
    await page.locator('[role=alert]').first().waitFor({ timeout: 15000 });
    const alertText = await page.locator('[role=alert]').first().textContent();
    check(/تغيّرت القيم|تعارض|مُسترجَع/.test(alertText), 'audit: reverting a superseded batch reports a conflict', alertText);
    await page.goto(`${BASE}/rates?branch=shafa-road&from=${D(RATE)}`);
    await waitCell(page, D(RATE), 'king-room', /344/);
    check(true, 'audit: the conflict changed nothing (344 stays)');
    // revert the latest batch → the earlier override comes back (333)
    await page.goto(`${BASE}/audit?entity=rate_overrides`);
    await page.waitForSelector('[data-list="audit"]');
    await page.locator('[data-list="audit"] li[data-batch]').first().locator('[data-action="revert"]').click();
    await page.click('[data-action="revert-go"]');
    const outcome = page.locator('[data-toast]');
    await outcome.first().waitFor({ timeout: 20000 }).catch(() => {});
    const outcomeText = (await outcome.first().textContent().catch(() => '')) ?? '';
    check(/استُرجع/.test(outcomeText), 'audit: revert of the latest batch succeeded', outcomeText || 'no toast');
    await page.goto(`${BASE}/rates?branch=shafa-road&from=${D(RATE)}`);
    await waitCell(page, D(RATE), 'king-room', /333/);
    check(true, 'audit: revert of the latest edit restores the earlier override');
    await ctx.close();
  }

  // ── admin: confirm / cancel, rooms toggle, users + matrix, last-admin guard, revocation in another session ──
  {
    const { ctx, page } = await login(USERS.admin);
    await page.fill('#f-q', r2.ref);
    await page.waitForSelector(`[data-ref="${r2.ref}"]`, { timeout: 10000 });
    await page.click(`[data-ref="${r2.ref}"]`);
    await digits(page, 'booking drawer');
    check((await page.locator('aside.drawer').textContent()).includes('لا يمكن التراجع'), 'drawer: says confirm / cancel are not undoable');
    await page.click('[data-action="confirm"]');
    await page.selectOption('#confirm-rt', { label: 'QA test room' }).catch(() => page.selectOption('#confirm-rt', { label: 'غرفة اختبار' }));
    await page.click('[data-action="confirm-go"]');
    const confirmedRow = page.locator(`[data-ref="${r2.ref}"][data-status="confirmed"]`);
    await Promise.race([confirmedRow.waitFor({ timeout: 20000 }), page.locator('dialog[open] [role=alert]').first().waitFor({ timeout: 20000 })]).catch(() => {});
    check((await confirmedRow.count()) === 1, 'admin: confirmed the request from the dashboard', (await page.locator('dialog[open] [role=alert]').first().textContent().catch(() => null)) ?? 'no row and no error shown');
    let st = await rpc('qa_fixture', { p_action: 'state', p_args: { branch: 'airport-road' } });
    const n20 = st.inventory.find((i) => i.night === D(20));
    check(n20.rooms_to_sell === 0 && n20.booked === 2, 'stock after two confirmations: 0 left / 2 booked', JSON.stringify(n20));
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

    // rooms: the accessible room appears, toggle on → site_room_types reflects it → undo
    await page.goto(`${BASE}/rooms`);
    const acc = page.locator('[data-bookable="airport-road/accessible-room"]');
    await acc.waitFor({ timeout: 15000 });
    check(!(await acc.isChecked()), 'rooms: accessible room listed and OFF by default');
    await digits(page, 'rooms');
    await acc.click(); // a controlled checkbox: the state follows the save, not the click
    await page.locator('[data-toast="undo"]').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-bookable="airport-road/accessible-room"]')?.checked, null, { timeout: 15000 });
    const site = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/site_room_types`, { method: 'POST', headers: H, body: '{}' }).then((r) => r.json());
    check(site.find((x) => x.branch === 'airport-road' && x.slug === 'accessible-room')?.bookable === true, 'rooms: site_room_types reports the room bookable');
    await page.click('[data-toast="undo"] [data-action="undo"]');
    await page.waitForFunction(() => !document.querySelector('[data-bookable="airport-road/accessible-room"]')?.checked, null, { timeout: 15000 });
    const site2 = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/site_room_types`, { method: 'POST', headers: H, body: '{}' }).then((r) => r.json());
    check(site2.find((x) => x.branch === 'airport-road' && x.slug === 'accessible-room')?.bookable === false, 'rooms: undo turned it off again');

    // users: list, matrix, last-admin guard
    await page.goto(`${BASE}/users`);
    const recRow = page.locator(`[data-user="${USERS.rec_air}"]`);
    await Promise.race([recRow.waitFor({ timeout: 30000 }), page.locator('[role=alert]').waitFor({ timeout: 30000 })]).catch(() => {});
    check((await recRow.count()) === 1, 'admin: users list loads through admin-users', (await page.locator('[role=alert]').textContent().catch(() => null)) ?? '');
    await digits(page, 'users');
    const adminRow = page.locator(`[data-user="${USERS.admin}"]`);
    check(await adminRow.locator('[data-action="toggle-active"]').isDisabled(), 'users: the only admin cannot be deactivated (button disabled)');
    await adminRow.locator('[data-action="perms"]').click();
    const usersSeg = adminRow.locator('[data-section="users"] [role=radiogroup] [role=radio]');
    check(await usersSeg.first().isDisabled(), 'users: the last admin\'s users level is locked');
    // revoke the Shafa reception's inventory edit → view, while a Shafa session is open → its save button disappears
    const shafa = await login(USERS.rec_shafa);
    await shafa.page.goto(`${BASE}/inventory?from=${D(INV)}`);
    await shafa.page.waitForSelector('[data-grid="inventory"]');
    check((await shafa.page.locator('[data-action="bulk"]').count()) === 1, 'shafa reception: bulk button shown with inventory edit');
    const shafaRow = page.locator(`[data-user="${USERS.rec_shafa}"]`);
    await shafaRow.locator('[data-action="perms"]').click();
    await shafaRow.locator('[data-section="inventory"] [role=radio]:has-text("عرض")').click();
    await shafaRow.locator('[data-action="perms-save"]').click();
    await page.locator('[data-toast="undo"]').waitFor({ timeout: 15000 });
    check(true, 'users: permissions saved with an undo toast');
    await shafa.page.waitForFunction(() => !document.querySelector('[data-action="bulk"]'), null, { timeout: 20000 }).catch(() => {});
    check((await shafa.page.locator('[data-action="bulk"]').count()) === 0, 'revocation: the open Shafa session lost the bulk button without a reload');
    let refused = false;
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/set_inventory`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${await shafa.page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('sb-') && k.endsWith('-auth-token'))?.[1] ?? '{}')?.access_token ?? '')}` }, body: JSON.stringify({ p_room_types: [fx.room_type_id], p_from: D(INV), p_to: D(INV), p_weekdays: 127, p_rooms: 1 }) }).then((r) => (refused = r.status === 403 || r.status === 401 || r.status === 400));
    } catch {
      refused = true;
    }
    check(refused, 'revocation: a direct RPC call as the demoted user is refused');
    await shafa.ctx.close();
    // undo the permission change
    await page.click('[data-toast="undo"] [data-action="undo"]');
    await page.waitForTimeout(1500);
    const perms = await rpc('qa_fixture', { p_action: 'state', p_args: { branch: 'shafa-road' } }).then(() => null).catch(() => null);
    void perms;
    await ctx.close();
  }

  // ── no-access flash (Ahmed, 26 Oct 2026): the splash, never «لا صلاحية», while the session and my_staff resolve ──
  {
    const { ctx, page } = await login(USERS.admin);
    check(!(await flashes(page)).length, 'no-access: never shown to the admin through sign-in and the email code');
    for (const path of ['bookings', 'users', 'audit?x=1']) {
      await page.goto(`${BASE}/${path}`);
      await page.waitForSelector('#app-main h1', { timeout: 20000 });
      await page.waitForTimeout(600);
      check(!(await flashes(page)).length, `no-access: never shown on a direct load of /${path}`);
    }
    await page.reload();
    await page.waitForSelector('#app-main h1', { timeout: 20000 });
    check(!(await flashes(page)).length, 'no-access: never shown on reload');
    await ctx.close();
    const rec = await login(USERS.rec_air);
    await rec.page.goto(`${BASE}/inventory`);
    await rec.page.waitForSelector('#app-main h1', { timeout: 20000 });
    await rec.page.reload();
    await rec.page.waitForSelector('#app-main h1', { timeout: 20000 });
    check(!(await flashes(rec.page)).length, 'no-access: never shown to reception (sign-in, deep link, reload)');
    await rec.ctx.close();
  }
  if (SERVICE) {
    const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
    const mk = async (tag) => {
      const email = `${tag}-${Date.now()}@qa.invalid`;
      const u = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: SH, body: JSON.stringify({ email, password: PW, email_confirm: true }) }).then((r) => r.json());
      return { email, id: u.id };
    };
    const signInExpectNoAccess = async (email, label) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
      await ctx.addInitScript(WATCH);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('#email', email);
      await page.fill('#password', PW);
      await page.click('button[type=submit]');
      await page.waitForSelector('[data-state="no-access"]', { timeout: 20000 });
      check(true, `no-access: shown for ${label}`);
      await ctx.close();
    };
    const unknown = await mk('nostaff');
    await signInExpectNoAccess(unknown.email, 'a signed-in user without a staff row');
    const inactive = await mk('inactive');
    await fetch(`${env.SUPABASE_URL}/rest/v1/staff`, { method: 'POST', headers: { ...SH, Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: inactive.id, full_name: 'QA inactive', role: 'reception', branch: 'airport-road', active: false }) });
    await signInExpectNoAccess(inactive.email, 'an inactive user');
    for (const u of [unknown, inactive]) if (u.id) await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SH });
  }

  // ── login never tells whether an email is registered (copy approval, 26 Oct 2026) ──
  {
    const ctx = await browser.newContext({ locale: 'ar' });
    const page = await ctx.newPage();
    const answer = async (email, pw) => {
      await page.goto(`${BASE}/login`);
      await page.fill('#email', email);
      await page.fill('#password', pw);
      await page.click('button[type=submit]');
      await page.locator('[role=alert]').first().waitFor({ timeout: 20000 });
      return (await page.locator('[role=alert]').first().innerText()).trim();
    };
    const unknown = await answer(`nobody-${Date.now()}@qa.invalid`, PW);
    const wrong = await answer(USERS.rec_air, 'Wrong-password-1');
    check(unknown === 'البريد أو كلمة المرور غير صحيحة.' && unknown === wrong, 'login: an unknown email and a wrong password read the same', `${unknown} | ${wrong}`);
    check(!(await page.evaluate(() => document.body.innerText)).includes('غير مسجّل في اللوحة'), 'login: «غير مسجّل» never shown');
    await ctx.close();
  }

  // ── show / hide toggle on the login password field (26 Oct 2026), 375 px ──
  {
    const ctx = await browser.newContext({ locale: 'ar', viewport: { width: 375, height: 812 } });
    const toggleCodes = [];
    await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, toggleCodes);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push(`page error (login toggle): ${e.message}`));
    await page.goto(`${BASE}/login`);
    await page.fill('#email', USERS.rec_air);
    await page.fill('#password', PW);
    const eye = page.locator('.pw-wrap:has(#password) [data-action="toggle-password"]');
    const eb = await eye.boundingBox();
    const ib = await page.locator('#password').boundingBox();
    check(eb && eb.width >= 44 && eb.height >= 44, 'login toggle: target ≥ 44 px', JSON.stringify(eb));
    check(eb && eb.x + eb.width / 2 < ib.x + ib.width / 2, 'login toggle: at the inline-end of the field in RTL (left)', JSON.stringify({ eb, ib }));
    check((await eye.getAttribute('aria-pressed')) === 'false' && (await eye.getAttribute('aria-label')) === 'إظهار كلمة المرور' && (await page.locator('#password').getAttribute('type')) === 'password', 'login toggle: hidden by default, «إظهار كلمة المرور»');
    const tokenCalls = [];
    page.on('request', (req) => { if (/\/auth\/v1\/token/.test(req.url())) tokenCalls.push(req.url()); });
    await page.focus('#password');
    await page.evaluate(() => document.getElementById('password').setSelectionRange(2, 2));
    await eye.click();
    const shown = await page.evaluate(() => ({ type: document.getElementById('password').type, focused: document.activeElement?.id, caret: document.getElementById('password').selectionStart, label: document.querySelector('[data-action="toggle-password"]').getAttribute('aria-label'), pressed: document.querySelector('[data-action="toggle-password"]').getAttribute('aria-pressed') }));
    check(shown.type === 'text' && shown.pressed === 'true' && shown.label === 'إخفاء كلمة المرور' && shown.focused === 'password' && shown.caret === 2, 'login toggle: shows the password, keeps focus and caret, «إخفاء كلمة المرور»', JSON.stringify(shown));
    check(tokenCalls.length === 0 && /\/login/.test(page.url()), 'login toggle: never submits the form');
    await eye.click();
    check((await page.locator('#password').getAttribute('type')) === 'password' && (await eye.getAttribute('aria-pressed')) === 'false', 'login toggle: hides again');
    // revealed, then a successful sign-in: the field is hidden again (or gone with the page) — never left revealed
    await eye.click();
    await page.click('button[type=submit]');
    await page.waitForFunction(() => { const el = document.querySelector('#password'); return !el || el.type === 'password'; }, null, { timeout: 30000 });
    await passCode(page, toggleCodes);
    await page.waitForSelector('#app-main', { timeout: 30000 });
    check(true, 'login toggle: the password is not left revealed after a successful sign-in');
    await ctx.close();
  }

  // ── invite link (token_hash) in a fresh context: prefetch must not consume it; «متابعة» → password → email code → in ──
  if (SERVICE) {
    const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
    const email = `invitee-${Date.now()}@qa.invalid`;
    const gen = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: SH, body: JSON.stringify({ type: 'invite', email }) }).then((r) => r.json());
    check(!!gen.hashed_token, 'invite: generate_link gave a token_hash', JSON.stringify(gen).slice(0, 200));
    if (gen.hashed_token) {
      // a staff row with the management preset (what admin-users does after the invite)
      await fetch(`${env.SUPABASE_URL}/rest/v1/staff`, { method: 'POST', headers: { ...SH, Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: gen.user?.id ?? gen.id, full_name: 'QA invitee', role: 'management', branch: null, active: true }) });
      const link = `${BASE}/set-password?token_hash=${gen.hashed_token}&type=invite`;
      // 1. a mail scanner opens the link: a plain GET + render, no click
      const scanner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const sp = await scanner.newPage();
      const authCalls = [];
      sp.on('request', (req) => { if (/\/auth\/v1\/(verify|otp)/.test(req.url())) authCalls.push(req.url()); });
      await sp.goto(link);
      await sp.waitForSelector('[data-action="proceed"]', { timeout: 15000 });
      await sp.waitForTimeout(1500);
      check(authCalls.length === 0, 'invite: opening the link verifies nothing (scanner-safe)', authCalls.join(' '));
      await scanner.close();
      // 2. the invitee, another fresh browser: «متابعة» → set password → email code → dashboard
      const fresh = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ar' });
      await fresh.addInitScript(WATCH);
      const inviteeCodes = [];
      await routeLoginCode(fresh, env.BOOKING_TEST_TOKEN, inviteeCodes);
      const fp = await fresh.newPage();
      fp.on('pageerror', (e) => fails.push(`page error (invitee): ${e.message}`));
      await fp.goto(link);
      await fp.click('[data-action="proceed"]');
      await fp.waitForSelector('#p1', { timeout: 20000 });
      check(true, 'invite: «متابعة» verified the token and opened the password form');
      await digits(fp, 'set-password');
      // the live checklist (Ahmed, 26 Oct 2026): three lines under the password, the match line under the confirm
      // field, the leak note; the save button waits for every line, so nothing reaches the service before
      const LINES = ['8 أحرف على الأقل', 'بدون حروف أو أرقام عربية', 'بدون مسافات', 'كلمتا المرور متطابقتان', 'عند الحفظ نتأكد أن كلمة المرور ليست شائعة أو مسرّبة.'];
      const formText = await fp.locator('form').innerText();
      check(LINES.every((l) => formText.includes(l)) && !formText.includes('10 أحرف'), 'set-password: the checklist lines and the leak note are shown, the old hint is gone', formText.slice(0, 300));
      check((await fp.locator('#p1-rules[aria-live="polite"] li .pw-mark').count()) === 3 && (await fp.locator('#p2-rules[aria-live="polite"] li .pw-mark').count()) === 1, 'set-password: aria-live checklists with an icon per line');
      const rules = (sel) => fp.evaluate((sel) => Object.fromEntries([...document.querySelectorAll(`${sel} li`)].map((li) => [li.dataset.rule, li.dataset.met])), sel);
      const saveDisabled = () => fp.locator('[data-action="save-password"]').isDisabled();
      const userCalls = [];
      fp.on('request', (req) => { if (/\/auth\/v1\/user/.test(req.url()) && req.method() === 'PUT') userCalls.push(req.url()); });
      check(JSON.stringify(await rules('#p1-rules')) === JSON.stringify({ length: 'false', ascii: 'true', spaces: 'true' }) && (await rules('#p2-rules')).match === 'false' && (await saveDisabled()), 'set-password: empty → only the length line unmet, save disabled');
      for (const [pw, want] of [
        ['Ab1', { length: 'false', ascii: 'true', spaces: 'true' }],
        ['كلمةمرور2026', { length: 'true', ascii: 'false', spaces: 'true' }],
        ['abcd efgh', { length: 'true', ascii: 'true', spaces: 'false' }],
        ['abcdefgh', { length: 'true', ascii: 'true', spaces: 'true' }], // 8 lowercase letters: no class is required
      ]) {
        await fp.fill('#p1', pw);
        const got = await rules('#p1-rules');
        check(JSON.stringify(got) === JSON.stringify(want), `set-password: «${pw}» → ${JSON.stringify(want)}`, JSON.stringify(got));
        check(await saveDisabled(), `set-password: «${pw}» without a matching confirmation keeps save disabled`);
      }
      await fp.fill('#p2', 'abcdefgX');
      check((await rules('#p2-rules')).match === 'false' && (await saveDisabled()), 'set-password: a different confirmation → «كلمتا المرور متطابقتان» ✗, save disabled');
      await fp.fill('#p2', 'abcdefgh');
      check((await rules('#p2-rules')).match === 'true' && !(await saveDisabled()), 'set-password: matching confirmation → every line met, save enabled');
      check(userCalls.length === 0, 'set-password: nothing reached the service while a line was unmet', userCalls.join(' '));
      // the show / hide toggle on both fields: inside the field at the RTL inline-end (left), ≥ 44 px, aria-pressed,
      // focus and caret stay, never submits
      const eye1 = fp.locator('.pw-wrap:has(#p1) [data-action="toggle-password"]');
      check((await fp.locator('.pw-wrap:has(#p2) [data-action="toggle-password"]').count()) === 1, 'toggle: the confirm field has one too');
      const eb = await eye1.boundingBox();
      const ib = await fp.locator('#p1').boundingBox();
      check(eb.width >= 44 && eb.height >= 44, 'toggle: target ≥ 44 px', JSON.stringify(eb));
      check(eb.x + eb.width / 2 < ib.x + ib.width / 2 && eb.x >= ib.x - 1 && eb.x + eb.width <= ib.x + ib.width + 1, 'toggle: inside the field, at its inline-end in RTL (left)', JSON.stringify({ eb, ib }));
      await fp.focus('#p1');
      await fp.evaluate(() => document.getElementById('p1').setSelectionRange(3, 3));
      await eye1.click();
      const shown = await fp.evaluate(() => ({ type: document.getElementById('p1').type, pressed: document.querySelector('.pw-wrap:has(#p1) [data-action="toggle-password"]').getAttribute('aria-pressed'), label: document.querySelector('.pw-wrap:has(#p1) [data-action="toggle-password"]').getAttribute('aria-label'), focused: document.activeElement?.id, caret: document.getElementById('p1').selectionStart }));
      check(shown.type === 'text' && shown.pressed === 'true' && shown.label === 'إخفاء كلمة المرور', 'toggle: shows the password with «إخفاء كلمة المرور», aria-pressed', JSON.stringify(shown));
      check(shown.focused === 'p1' && shown.caret === 3, 'toggle: focus and caret stay in the field', JSON.stringify(shown));
      check(userCalls.length === 0 && /set-password/.test(fp.url()), 'toggle: never submits the form');
      await eye1.click();
      check((await fp.locator('#p1').getAttribute('type')) === 'password' && (await eye1.getAttribute('aria-pressed')) === 'false' && (await eye1.getAttribute('aria-label')) === 'إظهار كلمة المرور', 'toggle: hides it again with «إظهار كلمة المرور»');
      await fp.focus('#p1');
      await fp.keyboard.press('Tab');
      check(await fp.evaluate(() => document.activeElement?.dataset.action === 'toggle-password'), 'toggle: reachable with Tab after the field');
      await fp.keyboard.press('Space');
      check((await fp.locator('#p1').getAttribute('type')) === 'text', 'toggle: Space toggles from the keyboard');
      await fp.keyboard.press('Space');
      check((await fp.locator('#p1').getAttribute('type')) === 'password', 'toggle: Space again hides');
      // the server's weak / leaked refusal (stubbed: the branch has no leaked-password list) reads as the approved text
      await fp.route('**/auth/v1/user', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'weak_password', error_code: 'weak_password', message: 'Password is known to be weak and easy to guess, please choose a different one.', reasons: ['pwned'] }) }) : route.continue()));
      await fp.fill('#p1', 'password1');
      await fp.fill('#p2', 'password1');
      await fp.click('[data-action="save-password"]');
      await fp.locator('[role=alert]').first().waitFor({ timeout: 10000 });
      check((await fp.locator('[role=alert]').first().innerText()).trim() === 'كلمة المرور هذه شائعة أو ظهرت في تسريبات سابقة، فيسهل تخمينها. اختر كلمة مرور أخرى.', 'set-password: a weak / leaked refusal reads as the approved sentence');
      check(userCalls.length === 1, 'set-password: exactly one call reached the (stubbed) service', String(userCalls.length));
      await fp.unroute('**/auth/v1/user');
      // Auth itself (config push on this branch: minimum 8, no required classes) accepts a letters-and-symbols password
      await fp.fill('#p1', INVITEE_PW);
      await fp.fill('#p2', INVITEE_PW);
      await fp.click('[data-action="save-password"]');
      await fp.waitForURL(/\/code/, { timeout: 30000, waitUntil: 'commit' });
      check(true, 'invite: after the password the email code is asked (no TOTP enrolment)');
      check(!(await fp.locator('img[alt*="QR"], p.latin.select-all').count()), 'invite: no QR / authenticator secret anywhere');
      await passCode(fp, inviteeCodes);
      await fp.waitForURL(/\/(bookings|rates|inventory|rooms|settings|users|audit)/, { timeout: 30000, waitUntil: 'commit' });
      await fp.waitForSelector('#app-main', { timeout: 30000 });
      check(true, 'invite: password set, email code passed, signed in (375 px)');
      check(!(await flashes(fp)).length, 'no-access: never shown to the invitee');
      await digits(fp, 'invitee first screen');
      await fresh.close();
      // 3. the same link again → used
      const again = await browser.newContext({ locale: 'ar' });
      const ap = await again.newPage();
      await ap.goto(link);
      await ap.click('[data-action="proceed"]');
      await ap.waitForSelector('[data-reason]', { timeout: 20000 });
      check(['invalid', 'expired'].includes(await ap.locator('[data-reason]').getAttribute('data-reason')), 'invite: a consumed link is reported as no longer valid, with a request-new-link path');
      check((await ap.locator('[data-action="request-link"]').count()) === 1, 'invite: «اطلب رابطًا جديدًا» offered');
      await again.close();
      // 4. an invalid token_hash → invalid
      const bad = await browser.newContext({ locale: 'ar' });
      const bp = await bad.newPage();
      await bp.goto(`${BASE}/set-password?token_hash=nope&type=recovery`);
      await bp.click('[data-action="proceed"]');
      await bp.waitForSelector('[data-reason]', { timeout: 20000 });
      check(['invalid', 'expired'].includes(await bp.locator('[data-reason]').getAttribute('data-reason')), 'recovery: an invalid link is reported');
      await bad.close();
      // cleanup: the invitee
      const uid = gen.user?.id ?? gen.id;
      if (uid) await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: SH });
    }
  } else console.log('invite checks skipped: SUPABASE_SERVICE_ROLE_KEY not set');

  // ── the second step (phase 2a.2 C, Ahmed 26 Oct 2026) ──
  {
    const CORS = { 'access-control-allow-origin': new URL(BASE).origin, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ar' });
    await ctx.addInitScript(WATCH);
    const codes = [];
    ctx.__codes = codes;
    await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push(`page error (code screen): ${e.message}`));
    const signIn = async (p, email) => {
      await p.goto(`${BASE}/login`);
      await p.fill('#email', email);
      await p.fill('#password', PW);
      await p.click('button[type=submit]');
    };
    await signIn(page, USERS.rec_shafa);
    await page.waitForURL(/\/code/, { timeout: 30000, waitUntil: 'commit' });
    await page.waitForSelector('[data-code-info]', { timeout: 30000 });
    const info = (await page.locator('[data-code-info]').innerText()).trim();
    check(info === 'أرسلنا رمزًا من 6 أرقام إلى r***@qa.invalid. أدخله هنا لإكمال الدخول.', 'code: the screen names the masked address', info);
    const resend = page.locator('[data-action="resend-code"]');
    const resendText = (await resend.innerText()).trim();
    check((await resend.isDisabled()) && /^إعادة الإرسال بعد /.test(resendText), 'code: «إعادة إرسال الرمز» waits with a countdown', resendText);
    check(!(await page.locator('[data-action="use-backup"]').count()), 'code: no backup-code path for a non-admin');
    check(!(await page.locator('[data-remember]').isChecked()), 'code: «تذكّر هذا الجهاز لمدة 30 يومًا» unchecked by default');
    check(!(await page.locator('#app-main').count()), 'code: nothing of the dashboard before the code');
    await digits(page, 'code screen');
    const wrongOf = () => (codes.at(-1) === '000000' ? '111111' : '000000');
    await page.fill('#code', wrongOf());
    await page.click('[data-action="verify-code"]');
    await page.locator('[role=alert]').first().waitFor({ timeout: 10000 });
    let alert = (await page.locator('[role=alert]').first().innerText()).trim();
    check(alert === 'الرمز غير صحيح. بقيت 4 محاولات.', 'code: a wrong code says how many attempts are left', alert);
    await passCode(page, codes, { remember: true });
    await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
    await page.waitForSelector('#app-main', { timeout: 30000 });
    const tokens = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('armada-device:')).map((k) => localStorage.getItem(k)));
    check(tokens.length === 1 && /^[0-9a-f]{64}$/.test(tokens[0] ?? ''), 'code: «تذكّر هذا الجهاز» keeps one device token in this browser');
    await page.goto(`${BASE}/security`);
    await page.waitForSelector('[data-devices] li', { timeout: 20000 });
    check((await page.locator('[data-devices] li').count()) === 1 && (await page.locator('[data-devices]').innerText()).includes('هذا الجهاز'), 'security: the remembered device is listed, marked «هذا الجهاز»');
    check((await page.locator('[data-method]').getAttribute('data-method')) === 'code', 'security: this session passed with the email code');
    await digits(page, 'security');
    // sign out → sign in: the remembered device passes without a new code
    await page.click('button:has-text("خروج")');
    await page.waitForURL(/\/login/, { timeout: 20000, waitUntil: 'commit' });
    const before = codes.length;
    await signIn(page, USERS.rec_shafa);
    await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
    await page.waitForSelector('#app-main', { timeout: 30000 });
    check(codes.length === before, 'device: the remembered browser signs in without a code', `${codes.length - before} new code(s)`);
    // the admin revokes rec_shafa's devices on the users screen → that open session is sent to /code
    const adm = await login(USERS.admin);
    check(Array.isArray(adminBackup) && adminBackup.length === 10 && adminBackup.every((c) => /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(c)), 'backup: the admin generated 10 codes on its first sign-in (forced page)', JSON.stringify(adminBackup));
    await adm.page.goto(`${BASE}/users`);
    const row = adm.page.locator(`[data-user="${USERS.rec_shafa}"]`);
    await row.waitFor({ timeout: 20000 });
    await adm.page.waitForFunction((u) => Number(document.querySelector(`[data-user="${u}"] [data-devices-count]`)?.getAttribute('data-devices-count')) >= 1, USERS.rec_shafa, { timeout: 20000 }).catch(() => {});
    check(Number(await row.locator('[data-devices-count]').getAttribute('data-devices-count')) >= 1, 'users: the remembered device is counted');
    await digits(adm.page, 'users (security line)');
    await row.locator('[data-action="revoke-devices"]').click();
    check((await adm.page.locator('dialog[open]').innerText()).includes('سيُطلب رمز البريد من «استقبال طريق الشفا»'), 'users: the revoke dialog names the user');
    await adm.page.click('[data-action="revoke-devices-go"]');
    await adm.page.waitForFunction((u) => document.querySelector(`[data-user="${u}"] [data-devices-count]`)?.getAttribute('data-devices-count') === '0', USERS.rec_shafa, { timeout: 20000 }).catch(() => {});
    check((await row.locator('[data-devices-count]').getAttribute('data-devices-count')) === '0', 'users: «إلغاء الأجهزة المتذكَّرة» revoked them');
    await page.reload();
    await page.waitForURL(/\/code/, { timeout: 30000, waitUntil: 'commit' });
    check(true, 'device revocation: the user\'s open session is sent to the code screen at once');
    await page.waitForSelector('#code', { timeout: 30000 });
    check(true, 'device revocation: the revoked device no longer passes (a code is asked)');
    // five wrong codes lock the code; a new one can be sent at once and lets in
    for (let i = 0; i < 5; i++) {
      await page.fill('#code', wrongOf());
      await page.click('[data-action="verify-code"]');
      await page.waitForFunction(() => !document.querySelector('[data-action="verify-code"] .animate-spin'), null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    alert = (await page.locator('[role=alert]').first().innerText()).trim();
    check(alert === 'أُدخل رمز خاطئ 5 مرات، فأُلغي هذا الرمز. اطلب رمزًا جديدًا.', 'code: the 5th wrong code locks it', alert);
    const n = codes.length;
    await page.waitForFunction(() => !document.querySelector('[data-action="resend-code"]')?.disabled, null, { timeout: 5000 }).catch(() => {});
    await page.click('[data-action="resend-code"]');
    for (let i = 0; i < 50 && codes.length === n; i++) await page.waitForTimeout(100);
    check(codes.length > n, 'code: after a lock a new code is sent at once');
    await passCode(page, codes);
    await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
    check(true, 'code: the new code lets in');

    // email failure → the admin's backup code lets in; the same code twice is refused
    const fail502 = async (c) => c.route('**/functions/v1/login-code', (r) => (r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: CORS })
      : r.fulfill({ status: 502, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'send_failed' }) })));
    const bctx = await browser.newContext({ locale: 'ar' });
    await fail502(bctx);
    const bp = await bctx.newPage();
    bp.on('pageerror', (e) => fails.push(`page error (backup): ${e.message}`));
    await signIn(bp, USERS.admin);
    await bp.waitForURL(/\/code/, { timeout: 30000, waitUntil: 'commit' });
    await bp.locator('[role=alert]').first().waitFor({ timeout: 20000 });
    check((await bp.locator('[role=alert]').first().innerText()).trim() === 'تعذّر إرسال الرمز بالبريد. أعد المحاولة، وإن تكرر فتواصل مع مدير النظام.', 'backup: an email failure reads in Arabic');
    await bp.click('[data-action="use-backup"]');
    await bp.fill('#backup-code', (adminBackup?.[0] ?? '').toLowerCase().replace('-', ''));
    await bp.click('[data-action="verify-backup"]');
    await bp.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
    await bp.waitForSelector('#app-main', { timeout: 30000 });
    check(true, 'backup: an admin passes the second step with a backup code (any case, no dash)');
    check((await bp.locator('[role=status]').allInnerTexts()).some((t) => t.includes('تم الدخول برمز طوارئ. بقي لديك 9 رموز.')), 'backup: «بقي لديك 9 رموز»');
    await bctx.close();
    const b2 = await browser.newContext({ locale: 'ar' });
    await fail502(b2);
    const b2p = await b2.newPage();
    await signIn(b2p, USERS.admin);
    await b2p.waitForURL(/\/code/, { timeout: 30000, waitUntil: 'commit' });
    await b2p.waitForSelector('[data-action="use-backup"]', { timeout: 20000 });
    await b2p.click('[data-action="use-backup"]');
    await b2p.fill('#backup-code', adminBackup?.[0] ?? '');
    await b2p.click('[data-action="verify-backup"]');
    await b2p.locator('[role=alert]').first().waitFor({ timeout: 10000 });
    alert = (await b2p.locator('[role=alert]').first().innerText()).trim();
    check(alert === 'رمز الطوارئ غير صحيح. بقيت 4 محاولات.', 'backup: a used code is refused', alert);
    await b2.close();

    // regeneration needs a fresh email code: sign in on a remembered device, then «إنشاء رموز جديدة» asks for one
    const rctx = await browser.newContext({ locale: 'ar' });
    const rcodes = [];
    rctx.__codes = rcodes;
    await routeLoginCode(rctx, env.BOOKING_TEST_TOKEN, rcodes);
    const first = await login(USERS.admin, { ctx: rctx, remember: true });
    await first.page.click('button:has-text("خروج")');
    await first.page.waitForURL(/\/login/, { timeout: 20000, waitUntil: 'commit' });
    const rp = (await login(USERS.admin, { ctx: rctx })).page; // a new session in the same browser: the device passes
    await rp.goto(`${BASE}/security`);
    await rp.waitForSelector('[data-action="regenerate-backup"]', { timeout: 20000 });
    check((await rp.locator('[data-method]').getAttribute('data-method')) === 'device', 'backup: this session passed on the remembered device');
    check((await rp.locator('[data-backup-left]').getAttribute('data-backup-left')) === '9', 'security: backup codes left 9 of 10');
    await rp.click('[data-action="regenerate-backup"]');
    await rp.waitForURL(/\/backup-codes\?new=1/, { timeout: 20000, waitUntil: 'commit' });
    const n2 = rcodes.length;
    await rp.click('[data-action="generate-backup"]');
    await rp.waitForSelector('[data-action="verify-stepup"]', { timeout: 20000 });
    check(true, 'backup: regeneration on a remembered device asks for a fresh email code first');
    for (let i = 0; i < 50 && rcodes.length === n2; i++) await rp.waitForTimeout(100);
    await rp.fill('#stepup-code', rcodes.at(-1) ?? '');
    await rp.click('[data-action="verify-stepup"]');
    await rp.waitForSelector('[data-backup-codes] li', { timeout: 20000 });
    const fresh = (await rp.locator('[data-backup-codes] li').allTextContents()).map((s) => s.trim());
    check(fresh.length === 10 && !fresh.some((c) => adminBackup?.includes(c)), 'backup: 10 new codes after the fresh code');
    await digits(rp, 'backup codes');
    const [dl] = await Promise.all([rp.waitForEvent('download', { timeout: 10000 }), rp.click('[data-action="download-backup"]')]);
    const file = readFileSync(await dl.path(), 'utf8');
    check(dl.suggestedFilename() === 'armada-backup-codes.txt' && fresh.every((c) => file.includes(c)) && file.includes('رموز الطوارئ — لوحة أرمادا ريزيدنس'), 'backup: «تنزيل» saves a text file with the 10 codes', dl.suggestedFilename());
    check(await rp.locator('[data-action="backup-continue"]').isDisabled(), 'backup: «متابعة» waits for «حفظتُ الرموز في مكان آمن»');
    await rp.check('[data-backup-saved]');
    await rp.click('[data-action="backup-continue"]');
    await rp.waitForURL(/\/security/, { timeout: 20000, waitUntil: 'commit' });
    const b3 = await browser.newContext({ locale: 'ar' });
    await fail502(b3);
    const b3p = await b3.newPage();
    await signIn(b3p, USERS.admin);
    await b3p.waitForURL(/\/code/, { timeout: 30000, waitUntil: 'commit' });
    await b3p.waitForSelector('[data-action="use-backup"]', { timeout: 20000 });
    await b3p.click('[data-action="use-backup"]');
    await b3p.fill('#backup-code', adminBackup?.[1] ?? '');
    await b3p.click('[data-action="verify-backup"]');
    await b3p.locator('[role=alert]').first().waitFor({ timeout: 10000 });
    check((await b3p.locator('[role=alert]').first().innerText()).startsWith('رمز الطوارئ غير صحيح.'), 'backup: an old unused code stops working after the regeneration');
    await b3.close();
    adminBackup = fresh;
    await rctx.close();

    // a password change clears the remembered devices (trigger on auth.users)
    if (SERVICE) {
      const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
      await page.click('button:has-text("خروج")');
      await page.waitForURL(/\/login/, { timeout: 20000, waitUntil: 'commit' });
      const kept = await login(USERS.rec_shafa, { ctx, remember: true });
      const device = await kept.page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('armada-device:')); return k ? [k, localStorage.getItem(k)] : null; });
      check(!!device, 'password change: a remembered device exists before the change');
      const list = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SH }).then((r) => r.json());
      const uid = (list.users ?? []).find((u) => u.email === USERS.rec_shafa)?.id;
      const upd = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'PUT', headers: SH, body: JSON.stringify({ password: PW }) });
      check(upd.ok, 'password change (Auth admin API) accepted', String(upd.status));
      // a browser that kept only the device token signs in again with the password: the code is asked (the trigger
      // revoked the device), never a silent pass
      const ctx2 = await browser.newContext({ locale: 'ar' });
      const codes2 = [];
      await routeLoginCode(ctx2, env.BOOKING_TEST_TOKEN, codes2);
      if (device) await ctx2.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, device);
      const p2 = await ctx2.newPage();
      await signIn(p2, USERS.rec_shafa);
      const where = await firstOf(p2, { code: '#code', app: '#app-main' });
      // the function's first call on a fresh browser can take a few seconds (cold start): wait up to 20 s
      for (let i = 0; i < 200 && !codes2.length; i++) await p2.waitForTimeout(100);
      check(where === 'code' && codes2.length > 0, 'password change: the remembered device no longer passes (a code is asked)', where);
      check((await p2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('armada-device:')).length)) === 0, 'password change: the refused device token is removed from the browser');
      await ctx2.close();
    } else console.log('password-change check skipped: SUPABASE_SERVICE_ROLE_KEY not set');
    await adm.ctx.close();
    await ctx.close();
  }

  // ── site defaults (phase 2a.2 D): admin only, save + undo, the restore dialog + tick, undo of a restore, audit ──
  {
    const CORS = { 'access-control-allow-origin': new URL(BASE).origin, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
    const { ctx, page } = await login(USERS.admin);
    const tokenOf = (p) => p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); return k ? JSON.parse(localStorage.getItem(k)).access_token : null; });
    const jwt = await tokenOf(page);
    const as = (token) => async (fn, args = {}) => {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const admin = as(jwt);
    const read = async (path) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` } }).then((r) => r.json());
    const setting = async (k) => (await read(`settings?key=eq.${k}&select=value`))[0]?.value;
    const rooms = await read('room_types?select=id,slug,branch,base_rate,bookable&active=eq.true&is_test=eq.false');
    const king = rooms.find((r) => r.branch === 'shafa-road' && r.slug === 'king-room');
    const twin = rooms.find((r) => r.branch === 'airport-road' && r.slug === 'twin-room');
    const orig = { prices: await setting('show_prices'), bed: await setting('extra_bed_per_night'), king: king?.base_rate, twin: twin?.bookable };
    const rebuilds = [];
    await page.route('**/functions/v1/site-rebuild', (r) => (r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS })
      : (rebuilds.push(1), r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true,"dispatched":true}' }))));
    try {
      await admin('set_setting', { p_key: 'show_prices', p_value: { ...orig.prices, 'airport-road': true } });
      await page.goto(`${BASE}/settings`);
      await page.waitForSelector('[data-defaults] [data-current-default]', { timeout: 20000 });
      await digits(page, 'settings + defaults');
      const cardBefore = (await page.locator('[data-current-default]').innerText()).trim();
      await page.click('[data-action="defaults-save"]');
      await page.fill('#d-label', 'QA e2e');
      await page.click('[data-action="defaults-save-go"]');
      await page.waitForFunction(() => document.querySelector('[data-current-default]')?.textContent?.includes('QA e2e'), null, { timeout: 20000 });
      check(true, 'defaults: saved, the card names it');
      await page.click('[data-toast="undo"] [data-action="undo"]');
      await page.waitForFunction((t) => document.querySelector('[data-current-default]')?.textContent?.trim() === t, cardBefore, { timeout: 20000 }).catch(() => {});
      check((await page.locator('[data-current-default]').innerText()).trim() === cardBefore, 'defaults: «تراجع» undoes the save (the previous default returns)');
      await page.click('[data-action="defaults-save"]');
      await page.fill('#d-label', 'QA e2e');
      await page.click('[data-action="defaults-save-go"]');
      await page.waitForFunction(() => document.querySelector('[data-current-default]')?.textContent?.includes('QA e2e'), null, { timeout: 20000 });
      // four changes after the save
      await admin('set_setting', { p_key: 'show_prices', p_value: { ...orig.prices, 'airport-road': false } });
      await admin('set_setting', { p_key: 'extra_bed_per_night', p_value: Number(orig.bed) + 15 });
      await admin('set_base_rate', { p_room_type: king.id, p_rate: 777 });
      await admin('set_room_bookable', { p_room_type: twin.id, p_bookable: !orig.twin });
      await page.reload();
      await page.waitForSelector('[data-action="defaults-restore"]:not([disabled])', { timeout: 20000 });
      await page.click('[data-action="defaults-restore"]');
      await page.waitForSelector('[data-defaults-diff]', { timeout: 20000 });
      const rows = (await page.locator('[data-change-row]').allInnerTexts()).map((s) => s.trim());
      check(rows.length === 4, 'defaults: the dialog lists exactly the 4 changes', rows.join(' | '));
      check(rows.some((r) => r.startsWith('إظهار الأسعار — طريق المطار:') && r.endsWith('متوقف ← مفعّل')), 'defaults: the switch row reads current ← default', rows.join(' | '));
      check(rows.some((r) => r.includes('السرير الإضافي لليلة')) && rows.some((r) => r.includes('777')), 'defaults: the extra-bed and base-rate rows', rows.join(' | '));
      check((await page.locator('[data-group="switches"] h3').innerText()).includes('يؤثر على الموقع فورًا'), 'defaults: the switches group says it acts on the site at once');
      await digits(page, 'defaults dialog');
      check(await page.locator('[data-action="defaults-restore-go"]').isDisabled(), 'defaults: restore waits for the switch tick');
      await page.check('[data-defaults-ack]');
      check((await page.locator('[data-action="defaults-restore-go"]').innerText()).includes('4 تغييرات'), 'defaults: «استعادة 4 تغييرات»');
      await page.click('[data-action="defaults-restore-go"]');
      await page.locator('[data-toast="undo"]').waitFor({ timeout: 20000 });
      check((await page.locator('[data-toast="undo"]').innerText()).includes('استُعيدت الإعدادات الافتراضية'), 'defaults: the restore toast offers «تراجع»');
      for (let i = 0; i < 30 && !rebuilds.length; i++) await page.waitForTimeout(100);
      check(rebuilds.length === 1, 'defaults: the site rebuild is asked once (availability / fee changed)', String(rebuilds.length));
      const kingNow = (await read(`room_types?id=eq.${king.id}&select=base_rate`))[0]?.base_rate;
      check(Number(await setting('extra_bed_per_night')) === Number(orig.bed) && (await setting('show_prices'))['airport-road'] === true && Number(kingNow) === Number(orig.king), 'defaults: the values are back');
      await page.click('[data-toast="undo"] [data-action="undo"]');
      await page.waitForFunction(() => !document.querySelector('[data-toast="undo"]'), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      check(Number(await setting('extra_bed_per_night')) === Number(orig.bed) + 15 && (await setting('show_prices'))['airport-road'] === false, 'defaults: «تراجع» undoes the restore');
      await page.goto(`${BASE}/audit`);
      await page.waitForSelector('[data-restore-batch]', { timeout: 20000 }).catch(() => {});
      check((await page.locator('[data-restore-batch]').count()) >= 1, 'audit: the restore batch is labelled «استعادة الإعدادات الافتراضية»');
      check((await page.locator('[data-list="audit"]').innerText()).includes('أمان الدخول'), 'audit: security events (devices, backup codes) are listed');
      // management: no section, and the database refuses the call
      const m = await login(USERS.mgmt);
      await m.page.goto(`${BASE}/settings`);
      await m.page.waitForSelector('#s-bed', { timeout: 20000 });
      check(!(await m.page.locator('[data-defaults]').count()), 'defaults: management does not see the section');
      const refused = await as(await tokenOf(m.page))('save_site_defaults', { p_label: 'x' });
      check(refused.status === 403 || refused.status === 401, 'defaults: management saving through the API is refused by the database', String(refused.status));
      await m.ctx.close();
    } finally {
      await admin('set_setting', { p_key: 'show_prices', p_value: orig.prices });
      await admin('set_setting', { p_key: 'extra_bed_per_night', p_value: orig.bed });
      if (king) await admin('set_base_rate', { p_room_type: king.id, p_rate: orig.king });
      if (twin) await admin('set_room_bookable', { p_room_type: twin.id, p_bookable: orig.twin });
      await ctx.close();
    }
  }

  // ── dialogs never close by accident (decision B, 28 Oct 2026): every dialog, drawer and confirm of the dashboard at
  // 1440 (mouse) and 375 (touch) — outside presses, a drag from inside, clean / dirty close, the unsaved-changes
  // confirm, saving in flight, a failed save, beforeunload; then the page-level forms (Settings, the permission matrix)
  for (const vp of [{ width: 1440, height: 900 }, { width: 375, height: 812, mobile: true }]) {
    const m = !!vp.mobile;
    const gctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar', isMobile: m, hasTouch: m });
    await gctx.addInitScript(WATCH);
    gctx.__codes = [];
    await routeLoginCode(gctx, env.BOOKING_TEST_TOKEN, gctx.__codes);
    const { page } = await login(USERS.admin, { ctx: gctx });
    const BATCH = '00000000-0000-4000-8000-00000000qa00'.replace('qa', '0a');
    const OK = JSON.stringify({ ok: true, batch_id: BATCH, count: 1 });
    const G = (cfg) => guardChecks(page, check, { ...cfg, mobile: m, vp });
    /** a text / number field: edit types `typed`, restore puts the original back (captured on the first edit) */
    const textField = (sel, typed) => {
      let orig;
      return {
        sel,
        read: () => page.inputValue(sel),
        edit: async () => {
          if (orig === undefined) orig = await page.inputValue(sel);
          await page.fill(sel, typed);
          return typed;
        },
        restore: () => page.fill(sel, orig ?? ''),
      };
    };
    const selectField = (sel, pick) => {
      let orig;
      return {
        sel,
        read: () => page.inputValue(sel),
        edit: async () => {
          if (orig === undefined) orig = await page.inputValue(sel);
          const v = await pick();
          await page.selectOption(sel, v);
          return v;
        },
        restore: () => page.selectOption(sel, orig ?? ''),
      };
    };
    /** a chip / segment with aria-pressed or aria-checked: edit presses it, restore presses it again (or the original) */
    const pressField = (sel, attr = 'aria-pressed', backSel = null) => ({
      sel,
      read: () => page.getAttribute(sel, attr),
      edit: async () => {
        await page.click(sel);
        return (await page.getAttribute(sel, attr)) ?? 'true';
      },
      restore: () => page.click(backSel ?? sel),
    });
    /** at least one weekday and one room type pressed (bulk dialogs start empty since decision C2) */
    const ensureChips = async () => {
      for (const group of ['[aria-label="أيام الأسبوع"]', '[aria-label="أنواع الغرف"]']) {
        const g = page.locator(`dialog[data-modal][open] ${group}`);
        if (!(await g.count())) continue;
        if (!(await g.locator('[aria-pressed="true"]').count())) await g.locator('button[aria-pressed]').first().click();
      }
    };
    const goto = async (path, sel) => {
      await page.goto(`${BASE}${path}`);
      await page.waitForSelector(sel, { timeout: 20000 });
    };
    // a request booking for the drawer and its two confirms
    const r3 = await submit({ extra_beds: '1', quoted_total: quote.quote.total + 100 });
    check(r3.status === 'request', `dialogs @${vp.width}: seed request booking`, JSON.stringify(r3));
    const openDrawer = async () => {
      if (await page.locator('aside[data-drawer]').count()) return;
      if (!/\/bookings/.test(page.url())) await goto('/bookings', '#f-q');
      await page.fill('#f-q', r3.ref);
      await page.waitForSelector(`[data-ref="${r3.ref}"]`, { timeout: 15000 });
      await page.click(`[data-ref="${r3.ref}"]`);
    };
    const closeDrawer = async () => {
      if (!(await page.locator('aside[data-drawer]').count())) return;
      await page.locator('aside[data-drawer] [data-action="dialog-close"]').first().click();
      if (await page.locator('dialog[data-unsaved-confirm][open]').count()) await page.click('dialog[data-unsaved-confirm][open] [data-action="discard-close"]');
      await page.locator('aside[data-drawer]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    };
    await goto('/bookings', '#f-q');
    await G({ label: 'booking details drawer', kind: 'drawer', open: openDrawer, field: textField('#internal-notes', 'QA note'), save: { sel: 'aside[data-drawer] [data-action="save-notes"]', route: '**/rest/v1/reservations?*', ok: '[]', fail: JSON.stringify({ code: '42501', message: 'permission denied for table reservations' }), prepare: async () => { await page.fill('#internal-notes', 'QA note'); return 'QA note'; } } });
    await G({
      label: 'booking confirm modal',
      open: async () => {
        await openDrawer();
        await page.click('aside[data-drawer] [data-action="confirm"]');
      },
      field: selectField('#confirm-rt', async () => page.locator('#confirm-rt option').nth(1).getAttribute('value')),
      save: { sel: '[data-action="confirm-go"]', route: '**/functions/v1/booking-admin', ok: JSON.stringify({ ok: false, reason: 'closed', nights: [] }), fail: JSON.stringify({ error: 'choose a bookable room type' }), prepare: async () => { const v = await page.locator('#confirm-rt option').nth(1).getAttribute('value'); await page.selectOption('#confirm-rt', v); return v; } },
      after: closeDrawer,
    });
    await G({
      label: 'booking cancel confirm',
      open: async () => {
        await openDrawer();
        await page.click('aside[data-drawer] [data-action="cancel"]');
      },
      field: textField('#cancel-reason', 'qa reason'),
      save: { sel: 'dialog[data-modal][open] [data-action="confirm-go"]', route: '**/functions/v1/booking-admin', ok: JSON.stringify({ ok: false, error: 'not a request' }), fail: JSON.stringify({ error: 'a reason is required' }), prepare: async () => { await page.fill('#cancel-reason', 'qa reason'); return 'qa reason'; } },
      after: closeDrawer,
    });
    // inventory
    await goto(`/inventory?from=${D(INV)}`, '[data-grid="inventory"]');
    await G({ label: 'inventory cell', open: () => page.click(`[data-night="${D(INV + 1)}"][data-rt="king-room"]`), field: textField('#cell-rooms', '7'), save: { sel: '[data-action="cell-save"]', route: '**/rest/v1/rpc/set_inventory', ok: OK, fail: JSON.stringify({ code: '22023', message: 'rooms 0–999' }), prepare: async () => { await page.fill('#cell-rooms', '7'); return '7'; } } });
    await G({ label: 'inventory row open/close', open: () => page.click('[data-row="king-room"] [data-action="row-menu"]') });
    await G({ label: 'inventory bulk', open: () => page.click('[data-action="bulk"]'), field: pressField('dialog[data-modal][open] [aria-label="أيام الأسبوع"] button[aria-pressed]:first-child'), save: { sel: '[data-action="bulk-save"]', route: '**/rest/v1/rpc/set_inventory', ok: OK, fail: JSON.stringify({ code: '22023', message: 'range: today … +400 days' }), prepare: ensureChips } });
    // rates
    await goto(`/rates?branch=shafa-road&from=${D(RATE)}`, '[data-grid="rates"]');
    await G({ label: 'rates single night', open: () => page.click(`[data-night="${D(RATE + 2)}"][data-rt="king-room"]`), field: textField('#night-price', '555'), save: { sel: '[data-action="night-save"]', route: '**/rest/v1/rpc/add_rate_override', ok: OK, fail: JSON.stringify({ code: '22023', message: 'price' }), prepare: async () => { await page.fill('#night-price', '555'); return '555'; } } });
    await G({ label: 'rates base rate', open: () => page.click('[data-row="king-room"] [data-action="base-rate"]'), field: textField('#base-price', '444'), save: { sel: '[data-action="base-rate-save"]', route: '**/rest/v1/rpc/set_base_rate', ok: OK, fail: JSON.stringify({ code: '22023', message: 'price' }), prepare: async () => { await page.fill('#base-price', '444'); return '444'; } } });
    await G({ label: 'rates period («سعر لفترة»)', open: () => page.click('[data-action="bulk"]'), field: textField('#b-price', '333'), save: { sel: '[data-action="bulk-save"]', route: '**/rest/v1/rpc/add_rate_override', ok: OK, fail: JSON.stringify({ code: '22023', message: 'price' }), prepare: async () => { await ensureChips(); await page.fill('#b-price', '333'); return '333'; } } });
    // settings: the defaults dialogs
    await goto('/settings', '[data-defaults] [data-current-default]');
    await G({ label: 'defaults save', open: () => page.click('[data-action="defaults-save"]'), field: textField('#d-label', 'QA label'), save: { sel: '[data-action="defaults-save-go"]', route: '**/rest/v1/rpc/save_site_defaults', ok: JSON.stringify({ ok: true, batch_id: BATCH, id: BATCH }), fail: JSON.stringify({ code: '22023', message: 'label 1–80' }), prepare: async () => { await page.fill('#d-label', 'QA label'); return 'QA label'; } } });
    if (!(await page.locator('[data-action="defaults-restore"]').isDisabled())) {
      await G({ label: 'defaults restore', open: async () => { await page.click('[data-action="defaults-restore"]'); await page.waitForSelector('[data-defaults-diff], dialog[data-modal][open] [role=alert]', { timeout: 20000 }); } });
    }
    // users
    await goto('/users', `[data-user="${USERS.rec_air}"]`);
    await G({ label: 'invite user', open: () => page.click('[data-action="invite"]'), field: textField('#u-email', 'qa-guard@qa.invalid'), save: { sel: '[data-action="user-save"]', route: '**/functions/v1/admin-users', ok: JSON.stringify({ ok: true, user_id: BATCH }), fail: JSON.stringify({ error: 'already registered' }), prepare: async () => { await page.fill('#u-email', 'qa-guard@qa.invalid'); await page.fill('#u-name', 'QA Guard'); return 'qa-guard@qa.invalid'; } } });
    await G({ label: 'display name', open: () => page.click(`[data-user="${USERS.rec_air}"] button:has-text("الاسم")`), field: textField('#n-name', 'QA Name'), save: { sel: '[data-action="name-save"]', route: '**/functions/v1/admin-users', ok: JSON.stringify({ ok: true }), fail: JSON.stringify({ error: 'full_name 2–80' }), prepare: async () => { await page.fill('#n-name', 'QA Name'); return 'QA Name'; } } });
    await G({ label: 'revoke devices', open: () => page.click(`[data-user="${USERS.rec_shafa}"] [data-action="revoke-devices"]`) });
    const permsOpen = async () => {
      const b = page.locator(`[data-user="${USERS.rec_air}"] [data-action="perms"]`);
      if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
      await page.waitForSelector(`[data-matrix="${USERS.rec_air}"]`, { timeout: 10000 });
    };
    await G({ label: 'apply preset', open: async () => { await permsOpen(); await page.click(`[data-matrix="${USERS.rec_air}"] [data-action="apply-preset"]`); } });
    // audit
    await goto('/audit', '[data-list="audit"]');
    if (await page.locator('[data-list="audit"] li[data-batch] [data-action="revert"]').count()) {
      await G({ label: 'audit revert', open: () => page.locator('[data-list="audit"] li[data-batch] [data-action="revert"]').first().click() });
    }
    // security
    await goto('/security', '#app-main h1');
    if (await page.locator('[data-action="revoke-my-devices"]').count()) await G({ label: 'revoke my devices', open: () => page.click('[data-action="revoke-my-devices"]') });

    // page-level forms (B5): Settings, then the permission matrix
    const navSel = m ? 'nav.tabbar a[href$="/bookings"]' : 'nav[aria-label="الأقسام"]:not(.tabbar) a[href$="/bookings"]';
    await goto('/settings', '#bed');
    await page.waitForTimeout(600);
    await pageGuardChecks(page, check, { label: 'settings extra bed', vp, linkSel: navSel, read: () => page.inputValue('#bed'), edit: async () => { await page.fill('#bed', '77'); return '77'; }, restore: (orig) => page.fill('#bed', orig) });
    await goto('/settings', '#bed');
    await page.waitForTimeout(600);
    // Arabic-Indic digits equal to the saved value are not a change; an added child tier is
    await page.fill('#bed', String.fromCharCode(0x0665, 0x0660)); // ٥٠
    await page.waitForTimeout(100);
    check(!(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })), `settings @${vp.width}: Arabic-Indic «٥٠» counted as a change`);
    await page.click('[data-scope="breakfast"] button:has-text("+ شريحة")');
    await page.waitForTimeout(100);
    check(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), `settings @${vp.width}: an added child tier is not a change`);
    await page.click(navSel);
    await page.locator('dialog[data-unsaved-confirm][open]').waitFor({ timeout: 3000 }).catch(() => {});
    check((await page.locator('dialog[data-unsaved-confirm][open]').count()) === 1, `settings @${vp.width}: leaving with an added tier did not ask`);
    await page.click('dialog[data-unsaved-confirm][open] [data-action="discard-close"]');
    await page.waitForURL(/\/bookings/, { timeout: 5000, waitUntil: 'commit' }).catch(() => {});
    await goto('/users', `[data-user="${USERS.rec_air}"]`);
    await permsOpen();
    const seg = (lvl) => `[data-matrix="${USERS.rec_air}"] [data-section="rooms"] [role=radio]:has-text("${lvl}")`;
    const origLvl = (await page.getAttribute(seg('تعديل'), 'aria-checked')) === 'true' ? 'تعديل' : 'عرض';
    const otherLvl = origLvl === 'تعديل' ? 'عرض' : 'تعديل';
    await pageGuardChecks(page, check, { label: 'permission matrix', vp, linkSel: navSel, read: () => page.getAttribute(seg(otherLvl), 'aria-checked'), edit: async () => { await page.click(seg(otherLvl)); return 'true'; }, restore: () => page.click(seg(origLvl)) });
    // the matrix is left as it was (the restore clicked the original level; nothing was saved)
    // «تراجع» the display-name change is not needed (the stub never reached the server); the drawer's notes were restored
    await gctx.close();
  }

  // ── 375 px: every screen renders, tab bar fits, digits ──
  {
    const { ctx, page } = await login(USERS.admin, { viewport: { width: 375, height: 812 } });
    for (const path of ['bookings', 'rates', 'inventory', 'rooms', 'settings', 'users', 'audit']) {
      await page.goto(`${BASE}/${path}`);
      await page.waitForSelector('#app-main h1', { timeout: 20000 });
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      check(!overflow || path === 'rates' || path === 'inventory', `375: ${path} has no horizontal page overflow`);
      await digits(page, `${path} at 375`);
    }
    const tabs = await page.locator('nav.tabbar a').count();
    check(tabs === 7, '375: seven tabs in the tab bar', String(tabs));
    await page.goto(`${BASE}/settings`);
    await page.waitForSelector('#app-main h1', { timeout: 20000 });
    check((await page.locator('#app-main').innerText()).includes('آخر وقت للحجز الفوري لوصول اليوم (توقيت الرياض)'), 'settings: cutoff label «آخر وقت للحجز الفوري لوصول اليوم (توقيت الرياض)»');
    // error texts: no function name, SQL or English detail on screen (copy approval, 26 Oct 2026)
    await page.route('**/functions/v1/admin-users', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
    await page.goto(`${BASE}/users`);
    await page.getByText('تعذّر الاتصال بالخادم — تحقق من الشبكة وأعد المحاولة.').first().waitFor({ timeout: 20000 }).catch(() => {});
    let shown = await page.locator('#app-main').innerText();
    check(shown.includes('تعذّر الاتصال بالخادم — تحقق من الشبكة وأعد المحاولة.') && !shown.includes('admin-users'), 'errors: a network failure reads in Arabic without the function name', shown.slice(0, 200));
    await page.unroute('**/functions/v1/admin-users');
    await page.route('**/rest/v1/rpc/staff_calendar', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42P01', message: 'relation "inventory_days_x" does not exist', details: null, hint: null }) }));
    await page.goto(`${BASE}/inventory`);
    await page.getByText('تعذّر إكمال العملية').first().waitFor({ timeout: 20000 }).catch(() => {});
    shown = await page.locator('#app-main').innerText();
    check(shown.includes('تعذّر إكمال العملية، أعد المحاولة.') && !/relation|staff_calendar|inventory_days/.test(shown), 'errors: an SQL error reads as the generic Arabic line, no SQL or function name', shown.slice(0, 200));
    await page.unroute('**/rest/v1/rpc/staff_calendar');
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
console.log('dashboard checks passed');
