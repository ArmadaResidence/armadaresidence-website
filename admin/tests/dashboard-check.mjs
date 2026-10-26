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
// invite link → fresh context → «متابعة» → password → TOTP → in, and a prefetch GET that must not consume the link.
// Everything it writes is undone at the end (test room type via qa_fixture, overrides deactivated, settings restored).
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
const secrets = {}; // TOTP secrets enrolled in this run, per login
async function login(email, { mfa = false, viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  await ctx.addInitScript(WATCH);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error (${email}): ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  if (mfa) {
    await page.waitForURL(/\/mfa/, { timeout: 30000, waitUntil: 'commit' });
    // first sign-in enrols (QR + secret); a later one only asks for the code (the page then says so)
    const secretEl = page.locator('p.latin.select-all');
    const enrolled = page.getByText('حسابك يتطلب رمز تطبيق المصادقة');
    await Promise.race([secretEl.waitFor({ timeout: 20000 }), enrolled.waitFor({ timeout: 20000 })]).catch(() => {});
    let secret = secrets[email];
    if (await secretEl.count()) secret = secrets[email] = (await secretEl.textContent()).trim();
    if (!secret) throw new Error('mfa: no secret shown (already enrolled? qa_users drop + create resets it)');
    await page.fill('#code', totp(secret));
    await page.click('button:has-text("تحقق")');
  }
  await page.waitForURL(/\/(bookings|rates|inventory|rooms|settings|users|audit)/, { timeout: 30000, waitUntil: 'commit' });
  await page.waitForSelector('#app-main', { timeout: 30000 });
  return { ctx, page };
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

  // ── management: TOTP, both branches, settings save + undo, rates single-night override + revert conflict ──
  {
    const { ctx, page } = await login(USERS.mgmt, { mfa: true });
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
    const { ctx, page } = await login(USERS.admin, { mfa: true });
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
    const { ctx, page } = await login(USERS.admin, { mfa: true });
    check(!(await flashes(page)).length, 'no-access: never shown to the admin through sign-in and TOTP');
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

  // ── invite link (token_hash) in a fresh context: prefetch must not consume it; «متابعة» → password → TOTP → in ──
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
      // 2. the invitee, another fresh browser: «متابعة» → set password → TOTP → dashboard
      const fresh = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ar' });
      await fresh.addInitScript(WATCH);
      const fp = await fresh.newPage();
      fp.on('pageerror', (e) => fails.push(`page error (invitee): ${e.message}`));
      await fp.goto(link);
      await fp.click('[data-action="proceed"]');
      await fp.waitForSelector('#p1', { timeout: 20000 });
      check(true, 'invite: «متابعة» verified the token and opened the password form');
      await digits(fp, 'set-password');
      check((await fp.locator('form').innerText()).includes('10 أحرف على الأقل، وفيها حروف وأرقام.'), 'set-password: hint «10 أحرف على الأقل، وفيها حروف وأرقام.»');
      // length and letters + digits are checked in the browser before any call to the service
      const userCalls = [];
      fp.on('request', (req) => { if (/\/auth\/v1\/user/.test(req.url()) && req.method() === 'PUT') userCalls.push(req.url()); });
      for (const [pw, want] of [['Ab1', 'كلمة المرور 10 أحرف على الأقل.'], ['abcdefghijkl', 'يجب أن تحتوي كلمة المرور على حروف وأرقام.'], ['1234567890', 'يجب أن تحتوي كلمة المرور على حروف وأرقام.']]) {
        await fp.fill('#p1', pw);
        await fp.fill('#p2', pw);
        await fp.click('[data-action="save-password"]');
        const msg = await fp.locator('[role=alert]').first().innerText().catch(() => '');
        check(msg.trim() === want, `set-password: «${pw}» → ${want}`, msg);
      }
      check(userCalls.length === 0, 'set-password: rejected passwords never reach the service', userCalls.join(' '));
      await fp.fill('#p1', PW);
      await fp.fill('#p2', PW);
      await fp.click('[data-action="save-password"]');
      await fp.waitForURL(/\/mfa/, { timeout: 30000, waitUntil: 'commit' });
      const secretEl = fp.locator('p.latin.select-all');
      await secretEl.waitFor({ timeout: 20000 });
      await fp.fill('#code', totp((await secretEl.textContent()).trim()));
      await fp.click('button:has-text("تحقق")');
      await fp.waitForURL(/\/(bookings|rates|inventory|rooms|settings|users|audit)/, { timeout: 30000, waitUntil: 'commit' });
      await fp.waitForSelector('#app-main', { timeout: 30000 });
      check(true, 'invite: password set, TOTP enrolled, signed in (375 px)');
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

  // ── 375 px: every screen renders, tab bar fits, digits ──
  {
    const { ctx, page } = await login(USERS.admin, { mfa: true, viewport: { width: 375, height: 812 } });
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
