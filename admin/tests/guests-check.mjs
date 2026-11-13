// Phase 2b session 5 end to end (3 Nov 2026, deploy 2) on a PREVIEW BRANCH (refuses the production project), with the
// QA users and the branch's own functions (booking-request, club) in test mode:
//   - consent from a booking (the real booking-request, box ticked → «موافق» from «نموذج الحجز») and from the club form
//     (the real club function, ?src=breakfast-shafa); an imported club member (internal.club_import over fake
//     club_signups rows) with its source and original consent time;
//   - «العملاء»: search (name, phone), filters (consent, member, source, branch, stays ≥ N, spend), the club totals by
//     source; the guest drawer (stays, spend, consent history); a reception-recorded consent from the booking details
//     (badges «عضو إياب», «ضيف عائد (N)») and its withdrawal; notes / tags; a merge of a duplicate;
//   - «تصدير للإعلانات»: the four platform files — their headers, SHA-256 of the normalised values (Meta / Snapchat
//     without «+», Google / TikTok with it), only consented rows, the audit row; the plain contacts export only with
//     «تصدير العملاء» (a confirmation first, audited);
//   - a member-only offer: its code absent from offers_site_manifest; «إرسال للأعضاء»: preview, the real send refused
//     before a test, the test to the user's address (Resend sink), then the send; the unsubscribe link of a member
//     withdraws the consent;
//   - the booking source: a booking with a visit (utm, gclid presence, referrer, landing) stored and shown in the details;
//   - the top-bar theme toggle in sync with the account menu, after a reload;
//   - a user without each permission (management: no «العملاء», no export; the guests view-only user: no export).
// Screenshots in screenshots/guests.
//   node admin/tests/guests-check.mjs [BASE_URL=http://127.0.0.1:5173]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (the branch), BOOKING_TEST_TOKEN, LOGIN_CODE_VIA_SERVICE=1
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.SUPABASE_ANON_KEY;
const TOKEN = env.BOOKING_TEST_TOKEN;
if (!URL_ || !SERVICE || !ANON || !TOKEN) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY of the preview branch and BOOKING_TEST_TOKEN are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const rpc = (fn, args = {}) => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: S, body: JSON.stringify(args) }).then(async (r) => ({ status: r.status, body: JSON.parse((await r.text()) || 'null') }));
const fn = (name, body, headers = {}) =>
  fetch(`${URL_}/functions/v1/${name}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Origin: 'https://armadaresidence.com', 'x-armada-test': TOKEN, ...headers }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: JSON.parse((await r.text()) || '{}') }));
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const SHOTS = 'screenshots/guests';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const until = async (f, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await f()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const VERSION = JSON.parse(readFileSync('content/club.json', 'utf8')).consent.version;

// ── a clean branch state for this run ──
await rpc('qa_fixture', { p_action: 'purge', p_args: {}, p_token: TOKEN });
await rest('offer_member_sends?id=gt.0', { method: 'DELETE' });
const staff = await rest('staff?select=user_id,role,full_name&active=eq.true');
const byRole = (r) => staff.find((s) => s.role === r);
const setLevel = (u, section, level) => rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${section}`, { method: 'PATCH', body: JSON.stringify({ level }) });
const admin = byRole('admin');
const mgmt = byRole('management');
const recAir = staff.find((x) => x.role === 'reception' && x.full_name === 'استقبال طريق المطار') ?? byRole('reception');
await setLevel(admin, 'guests', 'edit');
await setLevel(admin, 'guests_export', 'view');
await setLevel(mgmt, 'guests', 'none');
await setLevel(mgmt, 'guests_export', 'none');
await setLevel(recAir, 'guests', 'view');
await setLevel(recAir, 'guests_export', 'none');

// ── data through the real functions (test mode) ──
const RUN = Date.now().toString().slice(-7);
// two distinct numbers: +96650 + 6 digits of the run + 1 / 2 (13 characters, a valid Saudi mobile shape)
const phoneBook = `+96650${RUN.slice(-6)}1`;
const phoneClub = `+96650${RUN.slice(-6)}2`;
const book = await fn('booking-request', {
  locale: 'ar', branch: 'airport-road', room: '', check_in: day(40), check_out: day(42), adults: '2', children: '0', extra_beds: '0', breakfast: 'without',
  name: 'ضيف الموافقة', phone: phoneBook, country: 'SA', email: 'guest.consent@example.com', notes: '', marketing_consent: true, consent_version: VERSION,
  visit: { utm_source: 'snapchat', utm_medium: 'paid', utm_campaign: 'nov-offer', gclid: false, fbclid: false, ttclid: false, sccid: true, referrer: 'www.snapchat.com', landing: '/airport-road/' },
});
check(book.status === 200 && book.body.ref, 'booking with the box ticked and a visit source stored', JSON.stringify(book.body).slice(0, 160));
const ref = book.body.ref;
const club = await fn('club', { action: 'join', phone: phoneClub, country: 'SA', name: 'عضو اختبار', email: 'member.e2e@example.com', consent: true, consent_version: VERSION, lang: 'ar', src: 'breakfast-shafa', utm: {} });
check(club.status === 200, 'club sign-up through the function', JSON.stringify(club.body));
const res = (await rest(`reservations?ref=eq.${ref}&select=id,visit,profile_id`))[0];
{
  const g = (await rest(`guest_profiles?phone=eq.${encodeURIComponent(phoneBook)}&select=club_source,club_joined_at,consent_version`))[0];
  check(g?.club_source === 'booking' && !!g.club_joined_at && g.consent_version === VERSION, 'the booking box makes the guest a member (source booking) with the current text version', JSON.stringify(g));
}
check(res?.visit?.utm_source === 'snapchat' && res.visit.sccid === true && res.visit.gclid === false && res.visit.referrer === 'www.snapchat.com' && res.visit.landing === '/airport-road/', 'the booking source is stored without personal data', JSON.stringify(res?.visit));

const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar', acceptDownloads: true });
  const codes = [];
  await routeLoginCode(ctx, TOKEN, codes);
  await ctx.addInitScript(() => { try { localStorage.setItem('armada-test-events', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error (${email}): ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  let at = await firstOf(page, { code: '#code', app: '#app-main', backup: '[data-action="generate-backup"]' });
  if (at === 'code') {
    await passCode(page, codes);
    at = await firstOf(page, { app: '#app-main', backup: '[data-action="generate-backup"]' });
  }
  if (at === 'backup') {
    await handleBackupCodes(page);
    await page.waitForSelector('#app-main', { timeout: 30000 });
  }
  await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
  return { ctx, page };
}

const { ctx, page } = await login('admin@qa.invalid');

// ══ the theme toggle: top bar ↔ account menu, kept after a reload ══
{
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme || 'light');
  const t0 = await theme();
  const btn = page.locator('[data-action="theme-top"]');
  const box = await btn.boundingBox();
  check(!!box && box.width >= 44 && box.height >= 44, 'theme toggle: a 44 px target in the top bar', JSON.stringify(box));
  check(/التبديل إلى الوضع/.test((await btn.getAttribute('aria-label')) || ''), 'theme toggle: an Arabic aria-label');
  await btn.click();
  const t1 = await theme();
  check(t1 !== t0 && (await btn.getAttribute('aria-pressed')) === String(t1 === 'dark'), 'theme toggle: switches the theme');
  await page.click('[data-action="account-menu"]');
  check((await page.locator('[data-action="theme"]').getAttribute('aria-pressed')) === String(t1 === 'dark'), 'theme toggle: the account menu item follows at once');
  await page.click('[data-action="theme"]');
  check((await theme()) === t0 && (await btn.getAttribute('aria-pressed')) === String(t0 === 'dark'), 'theme toggle: the menu item switches it back and the top bar follows');
  await page.keyboard.press('Escape');
  await btn.click();
  await page.reload();
  await page.waitForSelector('[data-action="theme-top"]');
  check((await theme()) === t1, 'theme toggle: kept after a reload');
  await page.locator('[data-action="theme-top"]').click();
}

// ══ the imported club member (the runner imported a fake club_signups row on the branch: +966500000921, breakfast-airport) ══
{
  const imp = (await rest('guest_profiles_library?phone=eq.%2B966500000921&select=club_source,consent,club_joined_at'))[0];
  check(imp?.club_source === 'breakfast-airport' && imp.consent === 'granted', 'the imported club member: its source and consent', JSON.stringify(imp));
  const c = (await rest('guest_consents?source=eq.club&at=eq.2026-11-03T04:45:00%2B00:00&select=text_version'))[0];
  check(c?.text_version === '2026-11-03', 'the imported consent keeps its original time and its own (first) text version', JSON.stringify(c));
}

// ══ «العملاء» ══
await page.goto(`${BASE}/guests`);
await page.waitForSelector('[data-list="guests"], [data-guests-count]');
await shot(page, 'guests-list');
const totals = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-club-sources] tr[data-source]')].map((tr) => [tr.dataset.source, [...tr.querySelectorAll('td')].map((td) => Number(td.textContent))])));
// test-mode sign-ups are left out of the totals by design: the imported (real) breakfast-airport member is counted
check((totals['breakfast-airport']?.[0] ?? 0) >= 1 && Object.keys(totals).join() === 'breakfast-airport,breakfast-shafa,site,reception,booking,other', 'club totals by source: the imported breakfast-airport member counted', JSON.stringify(totals));
// search
await page.fill('#gf-q', phoneBook.slice(-7));
await until(async () => (await page.locator('[data-list="guests"] [data-guest]').count()) === 1);
check((await page.locator(`[data-guest="${phoneBook}"]`).count()) === 1, 'search by phone finds the booking guest');
check((await page.locator(`[data-guest="${phoneBook}"] [data-consent="granted"]`).count()) === 1, 'the booking guest shows «موافق»');
await page.fill('#gf-q', 'عضو اختبار');
await until(async () => (await page.locator(`[data-guest="${phoneClub}"]`).count()) === 1);
check((await page.locator(`[data-guest="${phoneClub}"] [data-member]`).count()) === 1, 'search by name finds the club member (member chip)');
await page.fill('#gf-q', '');
// filters
await page.selectOption('#gf-source', 'breakfast-shafa');
check(await until(async () => (await page.locator(`[data-guest="${phoneBook}"]`).count()) === 0 && (await page.locator(`[data-guest="${phoneClub}"]`).count()) === 1), 'filter by club source');
await page.selectOption('#gf-source', '');
await page.selectOption('#gf-consent', 'none');
check(await until(async () => (await page.locator(`[data-guest="${phoneBook}"], [data-guest="${phoneClub}"]`).count()) === 0), 'filter by consent hides the consented guests');
await page.selectOption('#gf-consent', '');
await page.fill('#gf-stays', '5');
await until(async () => (await page.locator(`[data-guest="${phoneBook}"]`).count()) === 0);
check(true, 'filter stays ≥ 5 hides a guest without stays');
await page.fill('#gf-stays', '');
// the drawer
await page.fill('#gf-q', phoneBook.slice(-7));
await page.locator(`[data-guest="${phoneBook}"]`).click();
await page.waitForSelector('[data-guest-details]');
check(await until(async () => (await page.locator('[data-consent-event="grant:booking"]').count()) === 1), 'the drawer: the consent history names the booking form');
// Guest Hub H3 (13 Nov 2026): «المحادثات» in the drawer — this booking guest has none (the full check: hub-inbox-ui-check)
check(await until(async () => (await page.locator('[data-guest-conversations]').textContent().catch(() => ''))?.includes('لا محادثات واتساب لهذا العميل')), 'the drawer: «المحادثات» (none for this guest)');
await page.fill('#gd-tags', 'عائلة، شتاء');
await page.click('[data-action="guest-save"]');
check(await until(async () => JSON.stringify((await rest(`guest_profiles?phone=eq.${encodeURIComponent(phoneBook)}&select=tags`))[0].tags) === '["شتاء","عائلة"]'), 'tags saved (trimmed, sorted)');
// withdraw on request, then record again in person
await page.click('[data-action="consent-withdraw"]');
await page.click('[data-action="consent-save"]');
check(await until(async () => { const g = (await rest(`guest_profiles?phone=eq.${encodeURIComponent(phoneBook)}&select=consent,club_joined_at`))[0]; return g.consent === 'withdrawn' && g.club_joined_at === null; }), 'withdrawal on the guest\'s request ends the consent and the membership');
await page.click('[data-action="consent-record"]');
check(await page.locator('[data-consent-text-ar]').isVisible() && await page.locator('[data-consent-text-en]').isVisible(), 'the in-person consent shows the approved text in both languages');
check(await page.locator('[data-action="consent-save"]').isDisabled(), 'record is disabled until the staff member confirms');
await page.check('[data-consent-confirm]');
await page.click('[data-action="consent-save"]');
check(await until(async () => {
  const g = (await rest(`guest_profiles?phone=eq.${encodeURIComponent(phoneBook)}&select=consent,consent_source,club_source`))[0];
  return g.consent === 'granted' && g.consent_source === 'reception' && g.club_source === 'reception';
}), 'a consent recorded in person: source reception, joined the club from reception');
const ev = await rest(`guest_consents?source=eq.reception&order=at.desc&limit=1&select=staff_label,action`);
check(ev[0]?.staff_label && ev[0].action === 'grant', 'the staff member is recorded', JSON.stringify(ev));
await page.keyboard.press('Escape');

// the booking details badges (a returning guest: a second confirmed booking of the same phone)
{
  const prof = (await rest(`guest_profiles?phone=eq.${encodeURIComponent(phoneBook)}&select=id`))[0].id;
  const rt = (await rest('room_types?branch=eq.airport-road&is_test=eq.false&select=id&limit=1'))[0].id;
  await rest('reservations', { method: 'POST', body: JSON.stringify({ ref: `AR-29991231-G${RUN.slice(-3)}`, status: 'confirmed', source: 'website', branch: 'airport-road', room_type_id: rt, check_in: day(-30), check_out: day(-28), adults: 2, children: 0, extra_beds: 0, breakfast: 'without', guest_name: 'ضيف الموافقة', phone: phoneBook, locale: 'ar', is_test: true, total: 370, confirmed_at: new Date().toISOString() }) });
  await page.goto(`${BASE}/bookings?ref=${ref}`);
  await page.waitForSelector('[data-booking-guest]', { timeout: 20000 });
  check((await page.locator('[data-booking-guest] [data-badge="member"]').count()) === 1, 'booking details: «عضو إياب»');
  check((await page.locator('[data-booking-guest] [data-badge="returning"]').textContent())?.includes('(1)'), 'booking details: «ضيف عائد (1)»');
  await shot(page, 'booking-badges');
  void prof;
}

// merge: a duplicate profile (same guest, another phone) into the booking guest's
{
  const dupPhone = `+96655${RUN}9`.slice(0, 13);
  await fn('booking-request', { locale: 'ar', branch: 'shafa-road', room: '', check_in: day(50), check_out: day(51), adults: '1', children: '0', extra_beds: '0', breakfast: 'without', name: 'ضيف الموافقة', phone: dupPhone, country: 'SA', email: '', notes: '' });
  await page.goto(`${BASE}/guests`);
  await page.fill('#gf-q', phoneBook.slice(-7));
  await page.locator(`[data-guest="${phoneBook}"]`).click();
  await page.waitForSelector('[data-guest-details]');
  await page.click('[data-action="guest-merge-open"]');
  await page.fill('#md-q', dupPhone.slice(-7));
  await page.locator('[data-merge-dialog] input[type=radio]').first().check({ timeout: 10000 });
  await page.click('[data-action="merge-go"]');
  check(await until(async () => (await rest(`guest_profiles?merged_into=not.is.null&select=id`)).length >= 1), 'merge: the duplicate points to the kept profile');
  const kept = (await rest(`guest_profiles_library?phone=eq.${encodeURIComponent(phoneBook)}&select=bookings`))[0];
  check(kept?.bookings >= 3, 'merge: the duplicate\'s booking moved', JSON.stringify(kept));
  check((await rest(`audit_log?entity=eq.guest_profiles&new->>merged_into=not.is.null&select=id`)).length >= 1, 'merge: audited');
  await page.keyboard.press('Escape');
}

// ══ exports ══
// test-mode rows are never exported: the booking guest's profile becomes a normal row for these checks (deleted at the end)
const exportGuest = (await rest(`guest_profiles?phone=eq.${encodeURIComponent(phoneBook)}&merged_into=is.null&select=id`))[0].id;
await rest(`guest_profiles?id=eq.${exportGuest}`, { method: 'PATCH', body: JSON.stringify({ is_test: false }) });
{
  await page.goto(`${BASE}/guests`);
  await page.waitForSelector('[data-guests-count]');
  await page.click('[data-action="guests-export-ads"]');
  const consented = (await rest('guest_profiles?consent=eq.granted&merged_into=is.null&is_test=eq.false&select=phone,email'));
  const withdrawnRow = await rest('guest_profiles?consent=neq.granted&merged_into=is.null&is_test=eq.false&select=phone&limit=1');
  for (const [p, h] of [['meta', 'email,phone'], ['google', 'Email,Phone'], ['tiktok', 'Email_SHA256,Phone_SHA256'], ['snapchat', 'EMAIL_SHA256,PHONE_SHA256']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-action="export-${p}"]`)]);
    const text = readFileSync(await dl.path(), 'utf8').trim().split(/\r?\n/);
    check(text[0] === h, `export ${p}: headers ${h}`, text[0]);
    const rows = text.slice(1).map((l) => l.split(','));
    check(rows.length === consented.length, `export ${p}: only the consented profiles (${consented.length})`, String(rows.length));
    check(rows.every(([e, ph]) => (!e || /^[0-9a-f]{64}$/.test(e)) && (!ph || /^[0-9a-f]{64}$/.test(ph))), `export ${p}: SHA-256 hex only`);
    const plus = p === 'google' || p === 'tiktok';
    const wantPhone = sha(plus ? phoneBook : phoneBook.slice(1));
    check(rows.some(([, ph]) => ph === wantPhone), `export ${p}: the phone normalised ${plus ? 'with' : 'without'} «+» then hashed`);
    check(rows.some(([e]) => e === sha('guest.consent@example.com')), `export ${p}: the email lower-cased, trimmed and hashed`);
    check(!text.join('\n').includes(phoneBook) && !text.join('\n').includes('@'), `export ${p}: nothing in plain text`);
    if (withdrawnRow[0]?.phone) check(!rows.some(([, ph]) => ph === sha(plus ? withdrawnRow[0].phone : withdrawnRow[0].phone.slice(1))), `export ${p}: a guest without consent is left out`);
  }
  const audits = await rest(`audit_log?entity=eq.guest_exports&order=at.desc&limit=4&select=new,actor_label`);
  check(audits.length === 4 && audits.every((a) => a.new.kind === 'hashed' && typeof a.new.rows === 'number' && a.actor_label), 'exports: each one audited (who, kind, platform, rows)');
  await page.keyboard.press('Escape');
  // the plain export: confirmation first
  await page.click('[data-action="guests-export-plain"]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="confirm-go"]')]);
  const plain = readFileSync(await dl2.path(), 'utf8');
  check(plain.includes('guest.consent@example.com'), 'plain export: the consented contact in plain text');
  check((await rest(`audit_log?entity=eq.guest_exports&new->>kind=eq.plain&select=id`)).length >= 1, 'plain export: audited');
}

// ══ a member-only offer ══
{
  const o = await rpc('qa_fixture', { p_action: 'offer', p_args: { slug: `qa-members-${RUN}`, branches: ['airport-road'], kind: 'percent', percent: 10, promo_code: `QAM${RUN.slice(-4)}`, show_site: true }, p_token: TOKEN });
  const offerId = o.body.id;
  await rest(`offers?id=eq.${offerId}`, { method: 'PATCH', body: JSON.stringify({ audience: 'members' }) });
  const off = (await rest(`offers?id=eq.${offerId}&select=*`))[0];
  await rest(`offers?id=eq.${offerId}`, { method: 'PATCH', body: JSON.stringify({ live: { ...off.live, audience: 'members' }, published_at: new Date().toISOString() }) });
  const man = (await rpc('offers_site_manifest')).body;
  check(!JSON.stringify(man).includes(`QAM${RUN.slice(-4)}`), 'member offer: the code is not in the site manifest (test offers are left out, the live ones checked)');
  await page.goto(`${BASE}/offers`);
  await page.waitForSelector(`[data-action="offer-members-send"]`, { timeout: 20000 }).catch(() => {});
  await page.locator(`li[data-offer="qa-members-${RUN}"] [data-action="offer-members-send"]`).click();
  await page.waitForSelector('[data-member-recipients]');
  check(await page.locator('[data-action="member-send"]').isDisabled(), 'member send: refused before a test send');
  await page.click('[data-action="member-preview"]');
  await page.waitForSelector('[data-member-preview]');
  const html = await page.locator('[data-member-preview]').getAttribute('srcdoc');
  check(html?.includes(`QAM${RUN.slice(-4)}`) && /unsubscribe|إلغاء الاشتراك/.test(html), 'member send: the preview carries the code and the unsubscribe link');
  await page.click('[data-action="member-test"]');
  await until(async () => (await rest(`offer_member_sends?offer_id=eq.${offerId}&kind=eq.test&select=sent`)).some((x) => x.sent === 1), 20000);
  check((await rest(`offer_member_sends?offer_id=eq.${offerId}&kind=eq.test&select=sent`)).some((x) => x.sent === 1), 'member send: the test reached Resend (sink)');
  await until(async () => !(await page.locator('[data-action="member-send"]').isDisabled()));
  await page.click('[data-action="member-send"]');
  await page.click('[data-action="confirm-go"]');
  check(await until(async () => (await rest(`offer_member_sends?offer_id=eq.${offerId}&kind=eq.send&select=sent,recipients`)).length === 1, 30000), 'member send: recorded');
  const sent = (await rest(`offer_member_sends?offer_id=eq.${offerId}&kind=eq.send&select=sent,recipients,failed`))[0];
  check(sent && sent.recipients >= 1 && sent.sent === sent.recipients, 'member send: every consented test member with an email received it (sink)', JSON.stringify(sent));
  check((await rest(`audit_log?entity=eq.offer_member_sends&entity_id=eq.${offerId}&select=id`)).length === 2, 'member send: test and send audited');
  // the member's unsubscribe link withdraws the consent
  const member = (await rest(`guest_profiles?phone=eq.${encodeURIComponent(phoneClub)}&select=id`))[0];
  const tok = (await rpc('qa_guest_token', { p_id: member.id, p_token: TOKEN })).body;
  if (typeof tok === 'string') {
    const u = await fetch(`${URL_}/functions/v1/club?u=${tok}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    check(u.status === 200 && (await rest(`guest_profiles?id=eq.${member.id}&select=consent`))[0].consent === 'withdrawn', 'the unsubscribe link withdraws the consent');
  } else check(false, 'qa_guest_token unavailable', JSON.stringify(tok));
  await page.keyboard.press('Escape');
}

// ══ the booking source in the details ══
await page.goto(`${BASE}/bookings?ref=${ref}`);
await page.waitForSelector('[data-booking-visit]', { timeout: 20000 }).catch(() => {});
const visitText = (await page.locator('[data-booking-visit]').textContent().catch(() => '')) || '';
check(visitText.includes('snapchat') && visitText.includes('nov-offer') && visitText.includes('www.snapchat.com'), 'booking details: the visit source', visitText);
await ctx.close();

// ══ users without the permissions ══
{
  const { ctx: c2, page: p2 } = await login('mgmt@qa.invalid');
  check((await p2.locator('[data-side-nav] a[data-nav="guests"]').count()) === 0, 'no permission: no «العملاء» in the sidebar');
  await p2.goto(`${BASE}/guests`);
  await p2.waitForURL(APP_PATH, { timeout: 15000, waitUntil: 'commit' });
  await p2.waitForTimeout(800);
  check(!p2.url().endsWith('/guests'), 'no permission: /guests lands elsewhere', p2.url());
  const r = await p2.evaluate(async ([u, k]) => {
    const s = JSON.parse(Object.entries(localStorage).find(([key]) => key.includes('auth-token'))?.[1] || '{}');
    const res = await fetch(`${u}/rest/v1/rpc/guest_export_audience`, { method: 'POST', headers: { apikey: k, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_platform: 'meta', p_filters: {} }) });
    return res.status;
  }, [URL_, ANON]);
  check(r === 403 || r === 401, 'no permission: the hashed export RPC is refused', String(r));
  await c2.close();
  const { ctx: c3, page: p3 } = await login('rec-air@qa.invalid');
  await p3.goto(`${BASE}/guests`);
  await p3.waitForSelector('[data-guests-count]');
  check((await p3.locator('[data-action="guests-export-ads"], [data-action="guests-export-plain"]').count()) === 0, 'view only: no export buttons');
  await c3.close();
}
await browser.close();
await rest(`reservations?profile_id=eq.${exportGuest}`, { method: 'PATCH', body: JSON.stringify({ profile_id: null }) });
await rest(`guest_profiles?id=eq.${exportGuest}`, { method: 'DELETE' });
await rpc('qa_fixture', { p_action: 'purge', p_args: {}, p_token: TOKEN });
console.log(`\n${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('PASS');
