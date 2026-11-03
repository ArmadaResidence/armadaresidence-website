// Phase 2b session 4 end to end (3 Nov 2026) on a PREVIEW BRANCH (refuses the production project), with the QA users:
//   FAQ «الأسئلة الشائعة» — the four categories and the 19 seeded questions; an edit with the live checks (a forbidden
//     term) and a save; the protected placeholder chip (Backspace / Delete next to it, a selection over it — the chip
//     and {breakfast} stay); «إدراج» of a removable chip and its ×; reorder by «تأخير» and by drag; a new question
//     published (the site-rebuild call, stubbed: reason faq + the job); a hidden question left out of the manifest;
//   partner enquiries «طلبات الشركاء» — a test enquiry through the REAL form (the scratch site build whose endpoint is
//     the branch's booking-request; the browser call is forwarded server-side, so CORS is not in the way), stored as
//     «جديد»; the live badge (+1 without a reload when a new enquiry arrives); the drawer: status change, owner, a note,
//     a quick WhatsApp link (first contact time), a PDF attached (and a .txt renamed .pdf refused by the bytes), the
//     file removed, the timeline; the filters; the CSV export (download, audited);
//   content «المحتوى والظهور» — a text with a forbidden term, without the required «شقق فندقية», with its placeholder
//     chip protected; the blocked publish; a revision restored (diff shown); a clean text published (reason content);
//     a room type hidden → the confirmation names the effect → published → quote_stay not_bookable, the real
//     booking-request answers 422 not_on_site, the manifest lists it; shown again; the announcement bar with a custom
//     text and a link, published; an overlapping one refused;
//   a user without each permission (management: no content, no partners — no sidebar item, the URL lands elsewhere,
//     no badge) and a view-only content user (the Airport Road reception: no add, no publish).
// Screenshots in screenshots/session4.
//   node admin/tests/session4-check.mjs [BASE_URL=http://127.0.0.1:5173] [SITE_URL]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (the branch), LOGIN_CODE_VIA_SERVICE=1
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';
import { addDays, pickRange, riyadhToday } from '../../scripts/datepicker-helpers.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const SITE = (process.argv[3] || 'http://127.0.0.1:4331').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.SUPABASE_ANON_KEY;
if (!URL_ || !SERVICE || !ANON) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY of the preview branch are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const rpc = (fn, args = {}, key = SERVICE) => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) }).then(async (r) => ({ status: r.status, body: JSON.parse((await r.text()) || 'null') }));
const SHOTS = 'screenshots/session4';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

// ── the branch: a clean state for this run ──
const RUN = Date.now().toString(36);
await rest('faq_items?key=like.qa-*', { method: 'DELETE' });
for (const f of await rest('faq_items?select=id,key,live&live=not.is.null')) {
  await rest(`faq_items?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ category: f.live.category, q_ar: f.live.q_ar, q_en: f.live.q_en, a_ar: f.live.a_ar, a_en: f.live.a_en, sort: f.live.sort, hidden: f.live.hidden }) });
}
await rest('content_revisions?id=gt.0', { method: 'DELETE' });
for (const f of await rest('content_fields?select=key,seed_ar,seed_en')) {
  await rest(`content_fields?key=eq.${encodeURIComponent(f.key)}`, { method: 'PATCH', body: JSON.stringify({ draft_ar: f.seed_ar, draft_en: f.seed_en, live_ar: null, live_en: null, published_at: null }) });
}
await rest('site_visibility?key=neq.x', { method: 'PATCH', body: JSON.stringify({ visible: true, live_visible: true }) });
await rest('announcements?id=neq.00000000-0000-0000-0000-000000000000', { method: 'DELETE' });
await rest('partner_enquiries?ref=like.AR-*', { method: 'DELETE' });
const staff = await rest('staff?select=user_id,role,full_name&active=eq.true');
const byRole = (r) => staff.find((s) => s.role === r);
const setLevel = (u, section, level) => rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${section}`, { method: 'PATCH', body: JSON.stringify({ level }) });
const mgmt = byRole('management');
const recAir = staff.find((x) => x.role === 'reception' && x.full_name === 'استقبال طريق المطار') ?? byRole('reception');
await setLevel(mgmt, 'content', 'none');
await setLevel(mgmt, 'partners', 'none');
await setLevel(recAir, 'content', 'view');
await setLevel(recAir, 'partners', 'none');
const manifest = async () => (await rpc('content_site_manifest')).body;

const browser = await chromium.launch({ channel: 'chrome' });
const dispatches = [];
async function login(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar', acceptDownloads: true });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  await ctx.addInitScript(() => { try { localStorage.setItem('armada-test-events', '1'); } catch { /* */ } });
  await ctx.route('**/functions/v1/site-rebuild', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    dispatches.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, dispatched: true }) });
  });
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
const editorValue = (page, id) => page.locator(`input[data-ph-value="${id}"]`).inputValue();

const { ctx, page } = await login('admin@qa.invalid');

// ══ the FAQ ══
await page.goto(`${BASE}/faq`);
await page.waitForSelector('[data-faq-category]');
check((await page.locator('[data-faq-category]').count()) === 4 && (await page.locator('[data-faq-row]').count()) === 19, 'faq: four categories, 19 seeded questions');
check((await page.locator('[data-faq-row][data-faq-state="published"]').count()) === 19, 'faq: every seeded question is published');
await shot(page, 'faq-list');
// an edit with the live checks
await page.locator('[data-faq-row="wifi"] [data-action="faq-edit"]').click();
await page.waitForSelector('[data-faq-form]');
await page.locator('#faq-a-ar').click();
await page.keyboard.press('End');
await page.keyboard.type(' وتتوفر شقق مخدومة');
check(await page.locator('[data-faq-problems]').getByText('شقق مخدومة').isVisible(), 'faq: the forbidden term is named while typing');
for (let i = 0; i < ' وتتوفر شقق مخدومة'.length; i++) await page.keyboard.press('Backspace');
await page.keyboard.type(' في كل الطوابق.');
check((await page.locator('[data-faq-problems]').count()) === 0, 'faq: the problems clear once the text is fixed');
await page.click('[data-action="faq-save"]');
await page.waitForSelector('[data-faq-form]', { state: 'detached' });
check(await until(async () => (await rest('faq_items?key=eq.wifi&select=a_ar'))[0].a_ar.endsWith('في كل الطوابق.')), 'faq: the edit is saved as a draft');
check((await page.locator('[data-faq-row="wifi"] [data-pending]').count()) === 1, 'faq: the row shows unpublished changes');
// the protected chip
await page.locator('[data-faq-row="breakfast"] [data-action="faq-edit"]').click();
await page.waitForSelector('[data-faq-form]');
check((await page.locator('#faq-a-ar .ph-chip[data-ph="breakfast"]').count()) === 1 && (await page.locator('#faq-a-ar .ph-chip [data-ph-remove]').count()) === 0, 'faq: {breakfast} shows as a protected chip (no ×)');
await page.evaluate(() => {
  const chip = document.querySelector('#faq-a-ar .ph-chip');
  const r = document.createRange();
  r.setStartAfter(chip);
  r.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  document.getElementById('faq-a-ar').focus();
});
for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
check((await page.locator('#faq-a-ar .ph-chip[data-ph="breakfast"]').count()) === 1 && (await editorValue(page, 'faq-a-ar')).includes('{breakfast}'), 'faq: Backspace next to the protected chip never removes it');
await page.keyboard.press('Control+A');
await page.keyboard.press('Delete');
check((await editorValue(page, 'faq-a-ar')).includes('{breakfast}'), 'faq: a selection over the protected chip keeps it');
await page.click('[data-action="dialog-cancel"]');
const discard = page.locator('[data-action="discard-changes"], button:has-text("تجاهل التعديلات والإغلاق")').first();
if (await discard.isVisible().catch(() => false)) await discard.click();
await page.waitForSelector('[data-faq-form]', { state: 'detached' });
// a new question: inserted (removable) chip, publish
const KEY = `qa-${RUN}`;
await page.click('[data-action="faq-add"]');
await page.waitForSelector('[data-faq-form]');
await page.fill('#faq-key', KEY);
await page.fill('#faq-q-ar', 'هل يوجد مصعد؟');
await page.fill('#faq-q-en', 'Is there a lift?');
await page.locator('#faq-a-ar').click();
await page.keyboard.type('نعم، والسرير الإضافي ');
await page.click('[data-action="faq-insert-extra_bed-ar"]');
check((await page.locator('#faq-a-ar .ph-chip [data-ph-remove]').count()) === 1, 'faq: an inserted chip is removable (×)');
await page.locator('#faq-a-ar [data-ph-remove]').click();
check(!(await editorValue(page, 'faq-a-ar')).includes('{extra_bed}'), 'faq: × removes an inserted chip');
await page.locator('#faq-a-ar').click();
await page.keyboard.press('End');
await page.keyboard.type('متاح.');
await page.locator('#faq-a-en').click();
await page.keyboard.type('Yes, at both properties.');
await page.click('[data-action="faq-save"]');
await page.waitForSelector('[data-faq-form]', { state: 'detached' });
check(await until(async () => (await rest(`faq_items?key=eq.${KEY}&select=id`)).length === 1), 'faq: the new question is saved');
// reorder: «تأخير» on the first booking question, then a drag in «الإقامة والخدمات»
const firstBooking = await page.locator('[data-faq-category="booking"] [data-faq-row]').first().getAttribute('data-faq-row');
await page.locator(`[data-faq-row="${firstBooking}"] [data-action="faq-later"]`).click();
check(await until(async () => (await page.locator('[data-faq-category="booking"] [data-faq-row]').nth(1).getAttribute('data-faq-row')) === firstBooking), 'faq: «تأخير» moves the question one place down');
const stay = page.locator('[data-faq-category="stay"] [data-faq-row]');
const s0 = await stay.nth(0).getAttribute('data-faq-row');
const s2 = await stay.nth(2).getAttribute('data-faq-row');
// the HTML5 drag events in order (dragstart on the row, dragover + drop on the target, dragend)
await page.evaluate(([a, b]) => {
  const src = document.querySelector(`[data-faq-row="${a}"]`);
  const dst = document.querySelector(`[data-faq-row="${b}"]`);
  const dt = new DataTransfer();
  const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  fire(src, 'dragstart');
  return new Promise((r) => setTimeout(() => {
    fire(dst, 'dragenter');
    fire(dst, 'dragover');
    setTimeout(() => {
      fire(dst, 'drop');
      fire(src, 'dragend');
      r();
    }, 50);
  }, 50));
}, [s0, s2]);
check(await until(async () => (await stay.nth(2).getAttribute('data-faq-row')) === s0 || (await stay.nth(1).getAttribute('data-faq-row')) === s2), 'faq: a drag reorders within the category', `${s0} → ${await stay.nth(2).getAttribute('data-faq-row')}`);
// publish
const before = dispatches.length;
await page.click('[data-action="faq-publish"]');
check(await until(() => dispatches.length > before), 'faq: «نشر» asks for the site build');
check(dispatches.at(-1)?.reason === 'faq' && /^[0-9a-f-]{36}$/.test(dispatches.at(-1)?.job ?? ''), 'faq: the build request carries reason faq and the job', JSON.stringify(dispatches.at(-1)));
const fm = (await rpc('faq_site_manifest')).body;
check(fm.items.some((i) => i.key === KEY) && fm.items.find((i) => i.key === 'wifi').a_ar.endsWith('في كل الطوابق.'), 'faq: the manifest holds the new and the edited question');
// hide the new question → out of the manifest
await page.locator(`[data-faq-row="${KEY}"] [data-action="faq-edit"]`).click();
await page.waitForSelector('[data-faq-form]');
await page.check('[data-field="hidden"]');
await page.click('[data-action="faq-save"]');
await page.waitForSelector('[data-faq-form]', { state: 'detached' });
await page.click('[data-action="faq-publish"]');
check(await until(async () => !(await rpc('faq_site_manifest')).body.items.some((i) => i.key === KEY)), 'faq: a hidden question leaves the manifest');
await shot(page, 'faq-after');

// ══ partner enquiries ══
// the real form of the site (scratch build: its endpoint is the branch's booking-request), forwarded server-side
const site = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-SA' });
await site.route(/googletagmanager|google-analytics|wa\.me/, (r) => r.abort());
await site.route(`${URL_}/functions/v1/booking-request`, async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' } });
  const res = await fetch(route.request().url(), { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` }, body: route.request().postData() });
  await route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
});
const sp = await site.newPage();
await sp.goto(`${SITE}/partners/enquiry/`, { waitUntil: 'load' });
await sp.locator('#enquiry-form[data-enquiry-bound]').waitFor({ state: 'attached' });
await sp.fill('#f-company', 'QA شركة الاختبار');
await sp.fill('#f-person', 'QA مسؤول المجموعات');
await sp.fill('#f-email', 'qa-partner@qa.invalid');
await sp.fill('#f-phone', '050 123 4567');
await sp.locator('#f-biztype').selectOption({ index: 1 });
await sp.locator('.f-next').click();
await sp.waitForTimeout(500);
await sp.locator('#f-reqtype').selectOption('umrah-group');
await sp.locator('.f-next').click();
await sp.waitForTimeout(500);
const S1 = addDays(riyadhToday(), 45);
await pickRange(sp, sp.locator('#enquiry-form'), S1, addDays(S1, 3), {});
await sp.locator('#f-guests').fill('40');
const resP = sp.waitForResponse((r) => r.url().includes('/functions/v1/booking-request') && r.request().method() === 'POST');
await sp.locator('.f-send').click();
const res = await resP;
const sent = await res.json().catch(() => ({}));
check(res.status() === 200 && sent.ok && sent.stored && /^AR-/.test(sent.ref ?? ''), 'partners: the real form stores the enquiry through the branch function', JSON.stringify(sent).slice(0, 200));
await sp.locator('#enquiry-sent').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
const stored = (await rest(`partner_enquiries?ref=eq.${sent.ref}&select=*`))[0];
check(stored && stored.status === 'new' && stored.request_type === 'umrah-group' && stored.phone === '+966501234567' && stored.guests === 40 && stored.check_in === S1, 'partners: the stored row (new, umrah-group, E.164 phone, guests, dates)', JSON.stringify(stored ?? {}).slice(0, 200));
await site.close();
// the dashboard list and the live badge
await page.goto(`${BASE}/partners`);
await page.waitForSelector(`[data-enquiry="${sent.ref}"]`);
check((await page.locator(`[data-enquiry="${sent.ref}"]`).getAttribute('data-enquiry-status')) === 'new', 'partners: the enquiry is listed as «جديد»');
const badge = () => page.locator('[data-sidebar] [data-badge="partners"]').textContent().then((t) => Number(t)).catch(() => 0);
check(await until(async () => (await badge()) >= 1), 'partners: the sidebar badge counts the new enquiry');
await page.waitForTimeout(2500); // the Realtime channel subscribes
const b0 = await badge();
await rpc('partner_enquiry_store', { p: { ref: `AR-20991231-Q${RUN.slice(-3).toUpperCase()}`, request_type: 'event', branch: 'airport-road', name: 'QA قاعة', phone: '+966500000009', organisation: 'QA جهة', is_test: true } });
check(await until(async () => (await badge()) === b0 + 1, 20000), 'partners: the badge rises live (Realtime) without a reload', `${b0} → ${await badge()}`);
// filters
await page.selectOption('#pf-type', 'event');
check(await until(async () => (await page.locator('[data-enquiry]').count()) === 1), 'partners: the type filter');
await page.selectOption('#pf-type', '');
await page.selectOption('#pf-status', 'new');
check(await until(async () => (await page.locator('[data-enquiry]').count()) >= 2), 'partners: the status filter');
await page.selectOption('#pf-status', '');
// the drawer
await page.locator(`[data-enquiry="${sent.ref}"]`).click();
await page.waitForSelector(`[data-enquiry-details="${sent.ref}"]`);
await shot(page, 'partners-drawer');
const [popup] = await Promise.all([page.waitForEvent('popup').catch(() => null), page.click('[data-action="enquiry-whatsapp"]')]);
if (popup) await popup.close();
check(await until(async () => (await rest(`partner_enquiries?ref=eq.${sent.ref}&select=first_contact_at`))[0].first_contact_at !== null), 'partners: the quick WhatsApp link records the first contact time');
await page.selectOption('#pe-status', 'contacted');
await page.click('[data-action="enquiry-status"]');
check(await until(async () => (await rest(`partner_enquiries?ref=eq.${sent.ref}&select=status`))[0].status === 'contacted'), 'partners: the status changes to «تم التواصل»');
const admin = staff.find((s) => s.role === 'admin');
await page.selectOption('#pe-owner', admin.user_id);
await page.click('[data-action="enquiry-assign"]');
check(await until(async () => (await rest(`partner_enquiries?ref=eq.${sent.ref}&select=owner`))[0].owner === admin.user_id), 'partners: the owner is assigned');
await page.fill('#pe-note', 'اتصلنا بالمسؤول؛ ننتظر الأعداد النهائية.');
await page.click('[data-action="enquiry-note"]');
check(await until(async () => (await page.locator('[data-enquiry-timeline] [data-event="note"]').count()) === 1), 'partners: the note is in the timeline');
// a PDF, then a .txt renamed .pdf
const dir = join(tmpdir(), `armada-s4-${RUN}`);
mkdirSync(dir, { recursive: true });
const pdf = join(dir, 'quote.pdf');
writeFileSync(pdf, Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'));
const fake = join(dir, 'fake.pdf');
writeFileSync(fake, 'this is not a pdf');
await page.setInputFiles('[data-enquiry-file-input]', pdf);
check(await until(async () => (await page.locator('[data-enquiry-file="quote.pdf"]').count()) === 1), 'partners: a PDF is attached and listed');
await page.setInputFiles('[data-enquiry-file-input]', fake);
check(await until(async () => ((await page.locator('[role="status"], [role="alert"], .toast').allTextContents()).join(' ')).includes('ليس PDF')), 'partners: a .txt renamed .pdf is refused by its bytes');
check((await page.locator('[data-enquiry-file]').count()) === 1, 'partners: the refused file is not listed');
await page.locator('[data-enquiry-file="quote.pdf"] [data-action="file-remove"]').click();
check(await until(async () => (await page.locator('[data-enquiry-file]').count()) === 0), 'partners: the file is removed');
const kinds = await page.locator('[data-enquiry-timeline] [data-event]').evaluateAll((els) => els.map((e) => e.getAttribute('data-event')));
check(['created', 'contact', 'status', 'owner', 'note', 'attachment'].every((k) => kinds.includes(k)), 'partners: the timeline holds every kind of event', kinds.join(','));
await page.click('[data-action="dialog-cancel"]');
// the CSV export
const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="partners-export"]')]);
const csv = readFileSync(await download.path(), 'utf8');
check(csv.startsWith('﻿') && csv.includes('رقم الطلب') && csv.includes(sent.ref), 'partners: the CSV export holds the enquiry (Excel-safe)');
check(await until(async () => (await rest('audit_log?entity=eq.partner_enquiries_export&select=new&order=id.desc&limit=1'))[0]?.new?.rows >= 1), 'partners: the export is audited (rows, filters)');

// ══ content & visibility ══
await page.goto(`${BASE}/content`);
await page.waitForSelector('[data-content-texts]');
check((await page.locator('[data-content-field]').count()) >= 60, 'content: the curated texts are listed');
await page.locator('[data-content-field="branch.airport-road.description"] [data-action="content-edit"]').click();
await page.waitForSelector('[data-content-form]');
await page.evaluate(() => {
  const el = document.getElementById('ct-ar');
  el.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, 'فندق بشقق مخدومة قرب المطار.');
});
const probs = await page.locator('[data-content-problems]').textContent();
check(probs.includes('شقق مخدومة') && probs.includes('شقق فندقية'), 'content: the forbidden term and the missing «شقق فندقية» are named');
await page.click('[data-action="content-save"]');
await page.waitForSelector('[data-content-form]', { state: 'detached' });
await page.click('[data-action="content-publish-all"]');
check(await until(async () => (await page.locator('[data-content-blocked] [data-blocked-field="branch.airport-road.description"]').count()) === 1), 'content: publishing is blocked, naming the field');
await page.click('[data-action="dialog-cancel"]');
// the protected placeholder of the policies' guests text
await page.locator('[data-content-field="policy.guests.body"] [data-action="content-edit"]').click();
await page.waitForSelector('[data-content-form]');
check((await page.locator('#ct-ar .ph-chip[data-ph="extra_bed"]').count()) === 1 && (await page.locator('#ct-ar .ph-chip [data-ph-remove]').count()) === 0, 'content: {extra_bed} is a protected chip');
await page.keyboard.press('Control+A');
await page.locator('#ct-ar').press('Delete');
check((await editorValue(page, 'ct-ar')).includes('{extra_bed}') && (await editorValue(page, 'ct-ar')).includes('{breakfast}'), 'content: deleting everything keeps the protected placeholders');
await page.click('[data-action="dialog-cancel"]');
const d2 = page.locator('button:has-text("تجاهل التعديلات والإغلاق")').first();
if (await d2.isVisible().catch(() => false)) await d2.click();
// restore the original text from the history (with its diff)
await page.locator('[data-content-field="branch.airport-road.description"] [data-action="content-history"]').click();
await page.waitForSelector('[data-content-history]');
await page.locator('[data-revision-kind="original"] [data-action="revision-diff"]').click();
check((await page.locator('[data-revision-kind="original"] [data-diff] del, [data-revision-kind="original"] [data-diff] ins').count()) > 0, 'content: the diff shows the changes');
await page.locator('[data-revision-kind="original"] [data-action="revision-restore"]').click();
await page.locator('[data-action="confirm-go"]').last().click();
check(await until(async () => { const f = (await rest('content_fields?key=eq.branch.airport-road.description&select=draft_ar,seed_ar'))[0]; return f.draft_ar === f.seed_ar; }), 'content: restore puts the original text back as the draft');
// a clean edit published
await page.waitForSelector('[data-content-history]', { state: 'detached' }).catch(() => {});
await page.locator('[data-content-field="home.hero.title"] [data-action="content-edit"]').click();
await page.waitForSelector('[data-content-form]');
await page.evaluate(() => {
  for (const [id, t] of [['ct-ar', 'إقامتك في الطائف تبدأ هنا'], ['ct-en', 'Your stay in Taif starts here']]) {
    const el = document.getElementById(id);
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, t);
  }
});
await page.click('[data-action="content-save"]');
await page.waitForSelector('[data-content-form]', { state: 'detached' });
const dc = dispatches.length;
await page.locator('[data-content-field="home.hero.title"] [data-action="content-publish"]').click();
check(await until(() => dispatches.length > dc), 'content: «نشر» asks for the site build');
check(dispatches.at(-1)?.reason === 'content', 'content: reason content', JSON.stringify(dispatches.at(-1)));
check((await manifest()).texts.some((t) => t.key === 'home.hero.title' && t.ar === 'إقامتك في الطائف تبدأ هنا'), 'content: the manifest holds the published text');
// visibility: hide a room type
await page.click('button:has-text("الظهور على الموقع")');
await page.waitForSelector('[data-content-visibility]');
await page.locator('[data-visibility="room:airport-road/twin-room"] [data-action="visibility-toggle"]').click();
check(await until(async () => (await page.locator('[data-visibility="room:airport-road/twin-room"]').getAttribute('data-visible')) === 'false'), 'visibility: the switch is a draft (hidden, not published)');
check(!(await manifest()).hidden.rooms.length, 'visibility: before publishing the site hides nothing');
await page.click('[data-action="visibility-publish"]');
check(await page.locator('[data-visibility-confirm]').getByText('لا تُحجز من الموقع').isVisible(), 'visibility: the confirmation explains what hiding does');
await shot(page, 'visibility-confirm');
await page.locator('[data-action="confirm-go"]').last().click();
check(await until(async () => (await manifest()).hidden.rooms.includes('airport-road/twin-room')), 'visibility: published — the manifest hides the room');
const q = (await rpc('quote_stay', { p_branch: 'airport-road', p_room: 'twin-room', p_check_in: addDays(riyadhToday(), 10), p_check_out: addDays(riyadhToday(), 12), p_adults: 2 }, ANON)).body;
check(q.reason === 'not_bookable' && q.prices === false, 'visibility: quote_stay refuses the hidden room', JSON.stringify(q));
const b = await fetch(`${URL_}/functions/v1/booking-request`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` }, body: JSON.stringify({ branch: 'airport-road', room: 'twin-room', check_in: addDays(riyadhToday(), 20), check_out: addDays(riyadhToday(), 22), adults: 2, children: 0, extra_beds: 0, breakfast: 'without', name: 'QA ضيف', phone: '+966500000001', country: 'SA', locale: 'ar' }) });
const bj = await b.json().catch(() => ({}));
check(b.status === 422 && bj.fields?.room === 'not_on_site', 'visibility: the real booking-request refuses the hidden room (422 not_on_site)', `${b.status} ${JSON.stringify(bj).slice(0, 160)}`);
await page.locator('[data-visibility="room:airport-road/twin-room"] [data-action="visibility-toggle"]').click();
await page.click('[data-action="visibility-publish"]');
await page.locator('[data-action="confirm-go"]').last().click();
check(await until(async () => !(await manifest()).hidden.rooms.length), 'visibility: shown again after publishing');
check(await page.locator('[data-link="settings"]').isVisible(), 'visibility: the price switches are linked in Settings');
// the announcement bar
await page.click('button:has-text("شريط الإعلان")');
await page.waitForSelector('[data-content-bar]');
await page.click('[data-action="bar-add"]');
await page.waitForSelector('[data-announcement-form]');
await page.fill('#an-text-ar', 'الأسئلة الشائعة متاحة الآن على الموقع');
await page.fill('#an-text-en', 'Our FAQ page is now live');
await page.fill('#an-link', '/faq/');
await page.fill('#an-label-ar', 'اقرأ الأسئلة');
await page.fill('#an-label-en', 'Read the FAQ');
await page.click('[data-action="bar-save"]');
await page.waitForSelector('[data-announcement-form]', { state: 'detached' });
await page.locator('[data-announcement] [data-action="bar-publish"]').first().click();
check(await until(async () => (await manifest()).announcements.some((a) => a.kind === 'custom' && a.link === '/faq/' && a.link_label_en === 'Read the FAQ')), 'bar: the custom announcement is published with its link');
check(await until(async () => (await page.locator('[data-announcement-state="active"]').count()) === 1), 'bar: it shows as «ظاهر الآن»');
await page.click('[data-action="bar-add"]');
await page.waitForSelector('[data-announcement-form]');
await page.fill('#an-text-ar', 'إعلان ثان متداخل');
await page.fill('#an-text-en', 'An overlapping notice');
await page.click('[data-action="bar-save"]');
await page.waitForSelector('[data-announcement-form]', { state: 'detached' });
await page.locator('[data-announcement-state="draft"] [data-action="bar-publish"]').first().click();
check(await until(async () => ((await page.locator('[data-bar-problem]').textContent().catch(() => '')) || '').includes('يتداخل')), 'bar: an overlapping announcement is refused (one at a time)');
await shot(page, 'bar');
await ctx.close();

// ══ users without the permissions ══
{
  const { ctx: c2, page: p2 } = await login('mgmt@qa.invalid');
  const navs = await p2.locator('[data-side-nav] a[data-nav]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav')));
  check(!navs.includes('content') && !navs.includes('partners'), 'no permission: no «المحتوى» / «الأسئلة الشائعة» / «طلبات الشركاء» in the sidebar', navs.join(','));
  for (const path of ['/content', '/faq', '/partners']) {
    await p2.goto(`${BASE}${path}`);
    await p2.waitForURL(APP_PATH, { timeout: 15000, waitUntil: 'commit' });
    await p2.waitForTimeout(800);
    check(!p2.url().endsWith(path), `no permission: ${path} lands elsewhere`, p2.url());
  }
  check((await p2.locator('[data-badge="partners"]').count()) === 0, 'no permission: no partners badge');
  await c2.close();
}
{
  // the Airport Road reception QA user holds content view here: read-only
  const { ctx: c3, page: p3 } = await login('rec-air@qa.invalid');
  await p3.goto(`${BASE}/faq`);
  await p3.waitForSelector('[data-faq-category]');
  check((await p3.locator('[data-action="faq-add"], [data-action="faq-publish"]').count()) === 0 && (await p3.locator('[data-action="faq-edit"]').first().textContent()).trim() === 'عرض', 'view only: the FAQ has no add / publish, «عرض» instead of «تعديل»');
  await p3.goto(`${BASE}/content`);
  await p3.waitForSelector('[data-content-texts]');
  check((await p3.locator('[data-action="content-publish-all"], [data-action="content-publish"]').count()) === 0, 'view only: no publish on the texts');
  await c3.close();
}
await browser.close();

// leave the branch as it was: the switches shown, the bar off
await rest('announcements?id=neq.00000000-0000-0000-0000-000000000000', { method: 'DELETE' });
console.log(`\n${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('PASS');
