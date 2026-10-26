// Partners enquiry form QA (26 Oct 2026, after a form opened with an old test entry in it — «سلقيب» / «112» — restored
// silently from localStorage). /partners/enquiry/ in Arabic and English, at 375 px (touch) and 1440 px:
//   - a fresh visit shows empty fields and no notice; the fields carry the autocomplete tokens (organization, name,
//     email, tel, country-name) so browser autofill lands in the right place;
//   - the contact rules (rules.ts, shared with the booking form and the Edge Function): a digits-only contact name or
//     company, a bad phone or email are refused inline with the right message, aria-invalid, focus, and Continue stays
//     on step 1; valid values (a Saudi national number) pass;
//   - a saved draft comes back only with the notice «استعدنا بيانات أدخلتها سابقًا»; «مسح البيانات» empties the form
//     and deletes the draft; a draft older than 7 days and the old unversioned draft are deleted unread; the URL
//     preselection (?request=) works without a notice;
//   - submit (endpoint stubbed — injected into the page config when the build has none): the body carries E.164 and
//     the draft is gone after the success box.
// Also the server side of the same rules (validatePartnerContact with libphonenumber-js, as the Edge Function runs it).
//   node scripts/partners-form-check.mjs [BASE_URL]
import { readFileSync } from 'node:fs';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { chromium } from 'playwright';
import { validatePartnerContact } from '../supabase/functions/booking-request/rules.ts';
import { addDays, pickRange, riyadhToday } from './datepicker-helpers.mjs';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
console.log(`partners-form-check: ${BASE}`);
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const lp = JSON.parse(readFileSync('content/partners-pages.json', 'utf8'));
const DRAFT_KEY = 'armada_b2b_enquiry_v2';
const STUB = 'https://stub.invalid/functions/v1/booking-request';

const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};

// ── server rules (no browser) ───────────────────────────────────────────────────────────────────────────
const phoneE164 = (raw, country) => {
  const v = String(raw).replace(/[\s\-().]/g, '').replace(/^00/, '+');
  const n = v.startsWith('+') ? parsePhoneNumberFromString(v) : parsePhoneNumberFromString(v, country || 'SA');
  return n && n.isValid() ? n.number : null;
};
const good = { organisation: 'Test Travel', name: 'Sara Al-Otaibi', phone: '0501234567', email: 'agent@example.com' };
const srv = (p) => validatePartnerContact({ ...good, ...p }, phoneE164);
check(srv({}).ok && srv({}).data.phone === '+966501234567', 'server: a valid partner contact (Saudi national number) is refused or not E.164');
check(srv({ name: '112' }).errors?.name === 'name', 'server: digits-only contact name accepted');
check(srv({ name: 'سلقيب' }).ok, 'server: an Arabic contact name is refused');
check(srv({ name: 'Al' }).errors?.name === 'name', 'server: a 2-letter contact name accepted');
check(srv({ organisation: '112' }).errors?.organisation === 'organisation', 'server: digits-only company accepted');
check(srv({ organisation: 'A' }).errors?.organisation === 'organisation', 'server: 1-character company accepted');
check(srv({ organisation: '3M' }).ok, 'server: company "3M" refused');
check(srv({ organisation: '' }).errors?.organisation === 'required', 'server: an empty company accepted');
check(srv({ phone: '12345' }).errors?.phone === 'phone', 'server: phone 12345 accepted');
check(srv({ phone: '+971501234567' }).data?.phone === '+971501234567', 'server: an international number is refused');
check(srv({ email: 'a@b' }).errors?.email === 'email', 'server: email a@b accepted');
check(srv({ email: '' }).errors?.email === 'required', 'server: an empty email accepted');

// ── browser ─────────────────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ channel: 'chrome' });
const CASES = [
  { lang: 'ar', path: '/partners/enquiry/', vp: { width: 375, height: 812, mobile: true } },
  { lang: 'en', path: '/en/partners/enquiry/', vp: { width: 375, height: 812, mobile: true } },
  { lang: 'ar', path: '/partners/enquiry/', vp: { width: 1440, height: 900 } },
  { lang: 'en', path: '/en/partners/enquiry/', vp: { width: 1440, height: 900 } },
];

async function newContext(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
  const posts = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  const fn = (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    try {
      posts.push(JSON.parse(r.request().postData() || '{}'));
    } catch {
      posts.push({});
    }
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true,"ref":"AR-TEST-0000"}' });
  };
  await ctx.route('**/functions/v1/**', fn);
  await ctx.route('https://stub.invalid/**', fn);
  // a local build has no PUBLIC_BOOKING_ENDPOINT: give the page config a stub endpoint so the submit path runs
  await ctx.route(/\/partners\/enquiry\/(index\.html)?$/, async (r) => {
    const res = await r.fetch();
    const html = (await res.text()).replace('"endpoint":""', `"endpoint":"${STUB}"`);
    return r.fulfill({ response: res, body: html });
  });
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
  return { ctx, posts };
}

const fieldState = (page, id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    const fld = el.closest('.fld');
    const msg = document.getElementById(`${id}-err`);
    return { value: el.value, bad: fld.classList.contains('bad'), invalid: el.getAttribute('aria-invalid'), msg: msg && fld.classList.contains('bad') ? msg.textContent.trim() : '', focused: document.activeElement === el, describedby: el.getAttribute('aria-describedby') };
  }, id);
const stepOn = (page) => page.evaluate(() => [...document.querySelectorAll('#enquiry-form .fstep')].findIndex((s) => s.classList.contains('on')));
const draft = (page) => page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY);
const noticeShown = (page) => page.locator('[data-draft-notice]').isVisible();
const ready = (page) => page.locator('#enquiry-form[data-enquiry-bound]').waitFor({ state: 'attached' });

for (const c of CASES) {
  const tag = `@${c.vp.width} ${c.lang}`;
  const m = { mobile: !!c.vp.mobile };
  const E = ui[c.lang].form.errors;
  const P = { required: lp.ui.required[c.lang], company: lp.form.errors.company[c.lang], phone: lp.form.errors.phone[c.lang], notice: lp.form.draft.notice[c.lang] };
  const { ctx, posts } = await newContext(c.vp);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && !/Failed to load resource/.test(msg.text()) && errors.push(msg.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  let step = 'fresh visit';
  try {
    const url = `${BASE}${c.path}`;
    await page.goto(url, { waitUntil: 'load' });
    await ready(page);

    // 1. fresh visit: empty, no notice, autocomplete tokens
    const empty = await page.evaluate(() => ['f-company', 'f-person', 'f-email', 'f-phone', 'f-country'].map((id) => document.getElementById(id).value).join(''));
    check(empty === '', `${tag}: fresh visit is prefilled (${empty})`);
    check(!(await noticeShown(page)), `${tag}: the draft notice shows on a fresh visit`);
    const ac = await page.evaluate(() => Object.fromEntries(['f-company', 'f-person', 'f-email', 'f-phone', 'f-country'].map((id) => [id, document.getElementById(id).getAttribute('autocomplete')])));
    const wantAc = { 'f-company': 'organization', 'f-person': 'name', 'f-email': 'email', 'f-phone': 'tel', 'f-country': 'country-name' };
    for (const [id, tok] of Object.entries(wantAc)) check(ac[id] === tok, `${tag}: ${id} autocomplete is ${ac[id]} (want ${tok})`);

    // 2. validation on step 1
    step = '2. validation';
    const fill = async (vals) => {
      for (const [id, v] of Object.entries(vals)) await page.locator(`#${id}`).fill(v);
    };
    await fill({ 'f-company': '112', 'f-person': '112', 'f-email': 'a@b', 'f-phone': '12345' });
    await page.locator('#f-biztype').selectOption({ index: 1 });
    await page.locator('.f-next').click();
    await page.waitForTimeout(400);
    check((await stepOn(page)) === 0, `${tag}: Continue left step 1 with invalid contact fields`);
    const want = { 'f-company': P.company, 'f-person': E.name, 'f-email': E.email, 'f-phone': P.phone };
    for (const [id, msg] of Object.entries(want)) {
      const s = await fieldState(page, id);
      check(s.bad && s.invalid === 'true', `${tag}: ${id}="${s.value}" not marked invalid`);
      check(s.msg === msg, `${tag}: ${id} message «${s.msg}» (want «${msg}»)`);
      check(s.describedby === `${id}-err`, `${tag}: ${id} aria-describedby is ${s.describedby}`);
    }
    check((await fieldState(page, 'f-company')).focused, `${tag}: focus is not on the first invalid field`);
    // digits-only contact name alone is still refused
    await fill({ 'f-company': 'Test Travel', 'f-person': '112', 'f-email': 'agent@example.com', 'f-phone': '0501234567' });
    await page.locator('.f-next').click();
    await page.waitForTimeout(400);
    const nm = await fieldState(page, 'f-person');
    check((await stepOn(page)) === 0 && nm.bad && nm.msg === E.name && nm.focused, `${tag}: digits-only contact name passed step 1`);
    // blur: an invalid email shows its message when the field is left
    await page.locator('#f-email').fill('agent@');
    await page.locator('#f-phone').focus();
    await page.waitForTimeout(150);
    check((await fieldState(page, 'f-email')).msg === E.email, `${tag}: no email message on blur`);
    // empty required field → the required message
    await page.locator('#f-email').fill('');
    await page.locator('.f-next').click();
    await page.waitForTimeout(300);
    check((await fieldState(page, 'f-email')).msg === P.required, `${tag}: empty email message «${(await fieldState(page, 'f-email')).msg}»`);
    // valid values pass
    await fill({ 'f-person': c.lang === 'ar' ? 'سارة العتيبي' : 'Sara Al-Otaibi', 'f-email': 'agent@example.com' });
    await page.locator('.f-next').click();
    await page.waitForTimeout(500);
    check((await stepOn(page)) === 1, `${tag}: valid contact fields did not reach step 2`);

    // 3. draft: restored only with the notice; «مسح البيانات» clears it
    step = '3. draft notice';
    const saved = JSON.parse((await draft(page)) || 'null');
    check(saved && saved.fields?.company === 'Test Travel' && typeof saved.saved_at === 'number' && !('website' in saved.fields), `${tag}: the draft was not saved as expected (${JSON.stringify(saved)})`);
    await page.goto(url, { waitUntil: 'load' });
    await ready(page);
    check(await noticeShown(page), `${tag}: a restored draft shows no notice`);
    check((await page.locator('[data-draft-notice] span').textContent()).trim() === P.notice, `${tag}: notice text`);
    check((await page.locator('#f-company').inputValue()) === 'Test Travel', `${tag}: the draft was not restored behind the notice`);
    check(JSON.parse((await draft(page)) || '{}').saved_at === saved.saved_at, `${tag}: restoring re-saved the draft (its age was reset)`);
    await page.locator('[data-draft-clear]').click();
    await page.waitForTimeout(200);
    const cleared = await page.evaluate(() => ['f-company', 'f-person', 'f-email', 'f-phone', 'f-biztype'].map((id) => document.getElementById(id).value).join(''));
    check(cleared === '', `${tag}: «مسح البيانات» left values (${cleared})`);
    check(!(await noticeShown(page)), `${tag}: the notice stays after «مسح البيانات»`);
    check((await draft(page)) === null, `${tag}: «مسح البيانات» did not delete the draft`);
    check((await fieldState(page, 'f-company')).focused, `${tag}: focus did not move to the first field after clearing`);
    await page.goto(url, { waitUntil: 'load' });
    await ready(page);
    check(!(await noticeShown(page)) && (await page.locator('#f-company').inputValue()) === '', `${tag}: a cleared draft came back`);

    // 4. expired draft and the old unversioned draft are deleted unread
    step = '4. expiry';
    await page.evaluate((k) => {
      localStorage.setItem(k, JSON.stringify({ saved_at: Date.now() - 8 * 86400000, fields: { company: 'Old Co', person: 'Old Name' } }));
      localStorage.setItem('armada_b2b_enquiry_v1', JSON.stringify({ company: 'سلقيب', person: '112' }));
    }, DRAFT_KEY);
    await page.goto(url, { waitUntil: 'load' });
    await ready(page);
    check((await page.locator('#f-company').inputValue()) === '' && !(await noticeShown(page)), `${tag}: an expired / old draft was restored`);
    const left = await page.evaluate((k) => [localStorage.getItem(k), localStorage.getItem('armada_b2b_enquiry_v1')], DRAFT_KEY);
    check(left[0] === null && left[1] === null, `${tag}: expired / old drafts were not deleted`);

    // 5. URL preselection still works, without a notice
    step = '5. URL preselection';
    await page.goto(`${url}?request=umrah-group&guests=40`, { waitUntil: 'load' });
    await ready(page);
    check((await page.locator('#f-reqtype').inputValue()) === 'umrah-group' && (await page.locator('#f-guests').inputValue()) === '40', `${tag}: ?request= / guests= no longer preselect`);
    check(!(await noticeShown(page)), `${tag}: URL preselection shows the draft notice`);

    // 6. submit (endpoint stubbed): E.164 in the body, success, the draft is gone
    step = '6. submit';
    await page.goto(url, { waitUntil: 'load' });
    await ready(page);
    await fill({ 'f-company': 'Test Travel', 'f-person': c.lang === 'ar' ? 'سارة العتيبي' : 'Sara Al-Otaibi', 'f-email': 'agent@example.com', 'f-phone': '050 123 4567' });
    await page.locator('#f-biztype').selectOption({ index: 1 });
    await page.locator('.f-next').click();
    await page.waitForTimeout(500);
    await page.locator('#f-reqtype').selectOption({ index: 1 });
    await page.locator('.f-next').click();
    await page.waitForTimeout(500);
    const form = page.locator('#enquiry-form');
    const S1 = addDays(riyadhToday(), 30);
    await pickRange(page, form, S1, addDays(S1, 3), m);
    await page.locator('#f-guests').fill('20');
    check((await draft(page)) !== null, `${tag}: no draft before the submit`);
    await page.locator('.f-send').click();
    for (let i = 0; i < 40 && !posts.length; i++) await page.waitForTimeout(100);
    check(posts.length === 1, `${tag}: ${posts.length} request(s) sent (want 1)`);
    if (posts[0]) {
      const b = posts[0];
      check(b.phone === '+966501234567' && b.organisation === 'Test Travel' && b.email === 'agent@example.com' && b.check_in === S1, `${tag}: body ${JSON.stringify({ phone: b.phone, organisation: b.organisation, email: b.email, check_in: b.check_in })}`);
    }
    await page.locator('#enquiry-sent').waitFor({ state: 'visible', timeout: 4000 });
    check((await draft(page)) === null, `${tag}: the draft survived a successful submit`);
    await page.goto(url, { waitUntil: 'load' });
    await ready(page);
    check(!(await noticeShown(page)) && (await page.locator('#f-company').inputValue()) === '', `${tag}: the form came back filled after a submit`);

    check(errors.length === 0, `${tag}: console errors: ${errors.join(' | ')}`);
  } catch (e) {
    fails.push(`${tag} [${step}]: ${String(e).split('\n')[0]}`);
    if (process.env.DEBUG) console.log(e);
  }
  await ctx.close();
}
await browser.close();

console.log(`${checks} checks, ${fails.length} failed`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
