// Careers page QA (Ahmed, 28 Oct 2026 — the job-application form of /careers/, DECISIONS.md 2026-10-28).
// Rules (no browser): validateJobApplication from rules.ts — the same function the form and the job-application Edge
// Function run: required fields, the PDF signature (a .txt renamed .pdf is refused), 5 MB, one file, the LinkedIn host
// rule, the 500-character note (CRLF counted once), the city length, the consent, the option keys = careers.json.
// Browser, /careers/ and /en/careers/ at 375 px (touch) and 1440 px, light and dark:
//   - layout: no horizontal scroll, the footer links to the page, one <h1>, the privacy notice under the form;
//   - submit with nothing filled: every required field shows its inline error with aria-invalid, focus moves to the
//     first one (name), no request is sent; inline errors on blur;
//   - then, once per language (375 light / 1440 dark): the consent unticked blocks the submit; the nationality search
//     (page language, English name, ISO code; no dial codes in that list) and a keyboard pick; the phone as E.164;
//     the LinkedIn host rule; the 500-character counter; a .txt renamed .pdf and a file over 5 MB refused; the
//     «متاح للبدء من» picker in single mode; the honeypot travels as `website`; success shows the ref, empties the form
//     and pushes { event: 'job_application', department, branch } and nothing else; a server failure shows the
//     message; a 422 field verdict is shown inline;
//   - no localStorage / sessionStorage write carries any field value.
// The endpoint is stubbed (injected into the page config when the build has none) — nothing is sent.
//   node scripts/careers-form-check.mjs [BASE_URL]
import { mkdirSync, readFileSync } from 'node:fs';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { chromium } from 'playwright';
import { CV_MAX_BYTES, JOB_DEPARTMENTS, JOB_EXPERIENCE, validateJobApplication } from '../supabase/functions/booking-request/rules.ts';
import { addDays, openPicker, press, riyadhToday, tapDay } from './datepicker-helpers.mjs';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
console.log(`careers-form-check: ${BASE}`);
const careers = JSON.parse(readFileSync('content/careers.json', 'utf8'));
const contact = JSON.parse(readFileSync('content/contact.json', 'utf8'));
const STUB = 'https://stub.invalid/functions/v1/job-application';
const SHOTS = 'screenshots/careers';
mkdirSync(SHOTS, { recursive: true });

const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};

// ── rules (no browser) ──────────────────────────────────────────────────────────────────────────────────
const phoneE164 = (raw, country) => {
  const v = String(raw).replace(/[\s\-().]/g, '').replace(/^00/, '+');
  const n = v.startsWith('+') ? parsePhoneNumberFromString(v) : parsePhoneNumberFromString(v, country || 'SA');
  return n && n.isValid() ? n.number : null;
};
const today = riyadhToday();
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const ctx = { branches: ['airport-road', 'shafa-road'], countries: ['SA', 'EG', 'AE', 'IN'], today, phone: phoneE164 };
const good = { name: 'Sara Al-Otaibi', phone: '0501234567', country: 'SA', email: 'sara@example.com', nationality: 'SA', department: 'front-office', branch: 'any', city: 'الطائف', consent: true, files: [{ name: 'cv.pdf', size: 120000, head: PDF }] };
const rule = (p) => validateJobApplication({ ...good, ...p }, ctx);
const errOf = (p, f) => rule(p).errors?.[f];
check(rule({}).ok && rule({}).data.phone === '+966501234567', 'rules: a valid application is refused or the phone is not E.164');
for (const f of ['name', 'phone', 'email', 'nationality', 'department', 'branch', 'city']) check(errOf({ [f]: '' }, f) === 'required', `rules: an empty ${f} is accepted`);
check(errOf({ files: [] }, 'cv') === 'required', 'rules: no CV accepted');
check(errOf({ consent: false }, 'consent') === 'consent', 'rules: an unticked consent accepted');
check(errOf({ consent: '' }, 'consent') === 'consent', 'rules: an empty consent accepted');
check(errOf({ name: '112' }, 'name') === 'name', 'rules: a digits-only name accepted');
check(errOf({ email: 'a@b' }, 'email') === 'email', 'rules: email a@b accepted');
check(errOf({ phone: '12345' }, 'phone') === 'phone', 'rules: phone 12345 accepted');
check(errOf({ nationality: 'XX' }, 'nationality') === 'nationality', 'rules: an unknown nationality accepted');
check(rule({ nationality: 'eg' }).data?.nationality === 'EG', 'rules: a lower-case nationality code is not normalised');
check(errOf({ department: 'spa' }, 'department') === 'department', 'rules: an unknown department accepted');
check(errOf({ branch: 'both' }, 'branch') === 'branch', 'rules: an unknown branch accepted');
check(rule({ branch: 'shafa-road' }).ok, 'rules: a branch slug refused');
check(errOf({ city: 'ط' }, 'city') === 'city', 'rules: a 1-character city accepted');
check(rule({ city: 'جدة' }).ok, 'rules: a 3-letter city refused');
check(errOf({ city: 'م'.repeat(61) }, 'city') === 'city', 'rules: a 61-character city accepted');
check(rule({ city: 'م'.repeat(60) }).ok, 'rules: a 60-character city refused');
// the file: the signature, never the name or the browser's type
const txt = [...Buffer.from('hello, this is not a pdf')];
check(errOf({ files: [{ name: 'cv.pdf', size: 24, head: txt }] }, 'cv') === 'cv_type', 'rules: a .txt renamed .pdf accepted');
check(errOf({ files: [{ name: 'cv.pdf', size: 3, head: [0x25, 0x50, 0x44] }] }, 'cv') === 'cv_type', 'rules: a truncated signature accepted');
check(rule({ files: [{ name: 'CV.txt', size: 9000, head: PDF }] }).ok, 'rules: a real PDF refused because of its name');
check(errOf({ files: [{ name: 'cv.pdf', size: CV_MAX_BYTES + 1, head: PDF }] }, 'cv') === 'cv_size', 'rules: a file over 5 MB accepted');
check(rule({ files: [{ name: 'cv.pdf', size: CV_MAX_BYTES, head: PDF }] }).ok, 'rules: a file of exactly 5 MB refused');
check(errOf({ files: [good.files[0], good.files[0]] }, 'cv') === 'cv_count', 'rules: two files accepted');
// LinkedIn: https and the linkedin.com host only
check(rule({ linkedin: 'https://www.linkedin.com/in/sara' }).data?.linkedin === 'https://www.linkedin.com/in/sara', 'rules: a www.linkedin.com profile refused');
check(rule({ linkedin: 'https://sa.linkedin.com/in/sara' }).ok, 'rules: a country subdomain of linkedin.com refused');
check(rule({ linkedin: 'https://linkedin.com/in/sara' }).ok, 'rules: linkedin.com refused');
for (const bad of ['http://www.linkedin.com/in/sara', 'https://linkedin.com.evil.example/in/sara', 'https://evil.example/linkedin.com/in/sara', 'https://notlinkedin.com/in/sara', 'www.linkedin.com/in/sara', 'javascript:alert(1)', 'https://user@linkedin.com/in/x'])
  check(errOf({ linkedin: bad }, 'linkedin') === 'linkedin', `rules: LinkedIn ${bad} accepted`);
// the note: 500 characters, CRLF counted once (the browser sends textarea line breaks as CRLF)
check(rule({ note: 'a'.repeat(500) }).ok, 'rules: a 500-character note refused');
check(errOf({ note: 'a'.repeat(501) }, 'note') === 'note', 'rules: a 501-character note accepted');
check(rule({ note: 'ab\r\n'.repeat(125).slice(0, -2) }).ok, 'rules: CRLF line breaks counted twice');
// optional fields
check(errOf({ experience: '10+' }, 'experience') === 'experience', 'rules: an unknown experience accepted');
check(rule({ experience: '3-5' }).ok, 'rules: experience 3-5 refused');
check(rule({ available_from: today }).ok, 'rules: available from today refused');
check(errOf({ available_from: addDays(today, -1) }, 'available_from') === 'available_from', 'rules: a past available-from date accepted');
check(errOf({ available_from: `${Number(today.slice(0, 4)) + 2}-01-01` }, 'available_from') === 'available_from', 'rules: a date after next year accepted');
// the option keys = the labels in careers.json (both languages)
for (const L of ['ar', 'en']) {
  const f = careers[L].form;
  check(JSON.stringify(Object.keys(f.departments)) === JSON.stringify([...JOB_DEPARTMENTS]), `content: careers.json ${L} departments ≠ rules.ts JOB_DEPARTMENTS`);
  check(JSON.stringify(Object.keys(f.experience_options)) === JSON.stringify([...JOB_EXPERIENCE]), `content: careers.json ${L} experience ≠ rules.ts JOB_EXPERIENCE`);
}

// ── browser ─────────────────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ channel: 'chrome' });
const MOBILE = { width: 375, height: 812, mobile: true };
const DESKTOP = { width: 1440, height: 900 };
const CASES = [];
for (const lang of ['ar', 'en']) for (const vp of [MOBILE, DESKTOP]) for (const theme of ['light', 'dark']) CASES.push({ lang, vp, theme, deep: (vp === MOBILE && theme === 'light') || (vp === DESKTOP && theme === 'dark') });

const pdfBuffer = (size) => {
  const b = Buffer.alloc(size, 0x20);
  Buffer.from('%PDF-1.7\n').copy(b);
  return b;
};

async function newContext(c) {
  const ctx = await browser.newContext({ viewport: { width: c.vp.width, height: c.vp.height }, isMobile: !!c.vp.mobile, hasTouch: !!c.vp.mobile, colorScheme: c.theme });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('armada-theme', t);
    } catch {}
    // every storage write after this point is recorded (the theme key above is the test's own)
    const log = [];
    Object.defineProperty(window, '__storageWrites', { value: log });
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      log.push([this === window.sessionStorage ? 'session' : 'local', String(k), String(v)]);
      return orig.call(this, k, v);
    };
  }, c.theme);
  const state = { posts: [], respond: { status: 200, body: { ok: true, ref: 'AR-20991231-TEST' } } };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  const fn = (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    state.posts.push({ url: r.request().url(), body: r.request().postDataBuffer()?.toString('latin1') ?? '', type: r.request().headers()['content-type'] ?? '' });
    return r.fulfill({ status: state.respond.status, headers: cors, contentType: 'application/json', body: JSON.stringify(state.respond.body) });
  };
  await ctx.route('**/functions/v1/**', fn);
  await ctx.route('https://stub.invalid/**', fn);
  // a local build has no PUBLIC_BOOKING_ENDPOINT: give the careers form a stub endpoint so the submit path runs
  await ctx.route(/\/careers\/(index\.html)?$/, async (r) => {
    const res = await r.fetch();
    const html = (await res.text()).split('"endpoint":""').join(`"endpoint":"${STUB}"`);
    return r.fulfill({ response: res, body: html });
  });
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
  return { ctx, state };
}

/** a field's visible inline error, aria-invalid and focus */
const fieldState = (page, name) =>
  page.evaluate((name) => {
    const box = document.querySelector(`[data-careers-form] [data-error-for="${name}"]`);
    const map = { name: '#job-name', phone: '[data-phone-input]', email: '#job-email', nationality: '#job-nationality', department: '#job-department', branch: '#job-branch', city: '#job-city', experience: '#job-experience', available_from: '[data-dr-trigger="start"]', linkedin: '#job-linkedin', note: '#job-note', cv: '#job-cv', consent: '#job-consent' };
    const el = document.querySelector(`[data-careers-form] ${map[name]}`);
    const ids = (el?.getAttribute('aria-describedby') ?? '').split(/\s+/);
    return { msg: box && !box.classList.contains('hidden') ? box.textContent.trim() : '', invalid: el?.getAttribute('aria-invalid'), focused: document.activeElement === el, described: !!box && ids.includes(box.id) };
  }, name);
const ready = (page) => page.locator('[data-careers-form][data-careers-ready]').waitFor({ state: 'attached' });

async function fillValid(page, mobile, { consent = true } = {}) {
  await page.fill('#job-name', 'سارة العتيبي');
  await page.fill('[data-careers-form] [data-phone-input]', '0501234567');
  await page.fill('#job-email', 'sara@example.com');
  await press(page.locator('#job-nationality'), mobile);
  await page.fill('[data-country-field="nationality"] [data-country-search]', 'SA');
  await page.keyboard.press('Enter');
  await page.selectOption('#job-department', 'housekeeping');
  await page.selectOption('#job-branch', 'shafa-road');
  await page.fill('#job-city', 'الطائف');
  await page.setInputFiles('#job-cv', { name: 'السيرة.pdf', mimeType: 'application/pdf', buffer: pdfBuffer(40000) });
  if (consent) await page.check('#job-consent');
}

for (const c of CASES) {
  const label = `${c.lang} ${c.vp.width}px ${c.theme}`;
  const { ctx, state } = await newContext(c);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const path = c.lang === 'ar' ? '/careers/' : '/en/careers/';
  await page.goto(BASE + path, { waitUntil: 'load' });
  await ready(page);
  const T = careers[c.lang];
  const E = T.form.errors;
  const mobile = !!c.vp.mobile;

  // layout
  const lay = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    h1: document.querySelectorAll('h1').length,
    footer: [...document.querySelectorAll('footer a')].some((a) => /\/careers\/$/.test(a.getAttribute('href') || '')),
    privacyAfterForm: !!document.querySelector('[data-careers] ~ #privacy'),
    dir: document.documentElement.dir,
    theme: document.documentElement.dataset.theme || 'light',
  }));
  check(lay.overflow <= 0, `${label}: horizontal scroll of ${lay.overflow}px`);
  check(lay.h1 === 1, `${label}: ${lay.h1} h1 elements`);
  check(lay.footer, `${label}: the footer does not link to the careers page`);
  check(lay.privacyAfterForm, `${label}: the privacy notice is not under the form`);
  check(lay.dir === (c.lang === 'ar' ? 'rtl' : 'ltr'), `${label}: dir ${lay.dir}`);
  check(lay.theme === c.theme, `${label}: theme ${lay.theme}, expected ${c.theme}`);
  const notice = await page.locator('#privacy').innerText();
  check(notice.includes(contact.emails.jobs), `${label}: the privacy notice does not name ${contact.emails.jobs}`);

  // empty submit: every required field flagged, focus on the first, nothing sent
  await page.locator('[data-careers-form] [data-submit]').scrollIntoViewIfNeeded();
  await press(page.locator('[data-careers-form] [data-submit]'), mobile);
  await page.waitForTimeout(150);
  const expect = { name: E.required, phone: E.required, email: E.required, nationality: E.required, department: E.required, branch: E.required, city: E.required, cv: E.required, consent: E.consent };
  for (const [f, msg] of Object.entries(expect)) {
    const s = await fieldState(page, f);
    check(s.msg === msg && s.invalid === 'true' && s.described, `${label}: empty submit — ${f} shows ${JSON.stringify(s.msg)} (aria-invalid ${s.invalid}, described ${s.described}), expected ${JSON.stringify(msg)}`);
  }
  for (const f of ['experience', 'available_from', 'linkedin', 'note']) check((await fieldState(page, f)).msg === '', `${label}: the optional ${f} shows an error on an empty submit`);
  check((await fieldState(page, 'name')).focused, `${label}: focus did not move to the first invalid field (name)`);
  check(state.posts.length === 0, `${label}: an invalid form was sent`);
  await page.screenshot({ path: `${SHOTS}/${c.lang}-${c.vp.width}-${c.theme}-errors.png`, fullPage: true });

  if (c.deep) {
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    // inline error on blur
    await page.fill('#job-name', '12');
    await page.locator('#job-email').focus();
    check((await fieldState(page, 'name')).msg === E.name, `${label}: no inline name error on blur`);
    await page.fill('#job-name', 'سارة العتيبي');
    check((await fieldState(page, 'name')).msg === '', `${label}: the name error stays after a fix`);

    // nationality search: page language, English name, ISO; no dial codes; keyboard pick
    const natSearch = page.locator('[data-country-field="nationality"] [data-country-search]');
    await press(page.locator('#job-nationality'), mobile);
    await natSearch.waitFor();
    const firstOpt = () => page.locator('[data-country-field="nationality"] .country-opt').first();
    const opts = await page.locator('[data-country-field="nationality"] .country-opt').evaluateAll((els) => els.slice(0, 7).map((e) => e.dataset.cc));
    check(JSON.stringify(opts) === JSON.stringify(['SA', 'AE', 'KW', 'QA', 'BH', 'OM', opts[6]]), `${label}: nationality list does not start with Saudi Arabia then the GCC: ${opts.join(',')}`);
    const dialShown = await page.locator('[data-country-field="nationality"] .country-opt').first().innerText();
    check(!/\+\d/.test(dialShown), `${label}: the nationality list shows a dial code (${dialShown})`);
    const firstCc = async () => ((await firstOpt().count()) ? firstOpt().getAttribute('data-cc') : null);
    for (const [q, cc] of [[c.lang === 'ar' ? 'مصر' : 'Egypt', 'EG'], ['egypt', 'EG'], ['IN', 'IN'], [c.lang === 'ar' ? 'الهند' : 'India', 'IN']]) {
      await natSearch.fill(q);
      check((await firstCc()) === cc, `${label}: nationality search ${JSON.stringify(q)} does not list ${cc} first (${await firstCc()})`);
    }
    await natSearch.fill('20');
    check((await firstCc()) !== 'EG', `${label}: nationality search matches the dial code 20`);
    await natSearch.fill(c.lang === 'ar' ? 'مصر' : 'Egypt');
    await page.keyboard.press('Enter');
    const nat = await page.evaluate(() => ({ v: document.querySelector('input[name="nationality"]').value, text: document.querySelector('#job-nationality').innerText, flag: document.querySelector('#job-nationality [data-country-flag]').hidden, focus: document.activeElement?.id }));
    check(nat.v === 'EG' && !nat.flag && nat.text.length > 1 && !/\+20/.test(nat.text) && nat.focus === 'job-nationality', `${label}: nationality pick → ${JSON.stringify(nat)}`);
    await press(page.locator('#job-nationality'), mobile);
    await page.keyboard.press('Escape');
    check((await page.locator('#job-nationality').getAttribute('aria-expanded')) === 'false', `${label}: Esc does not close the nationality list`);

    // LinkedIn host rule (inline)
    for (const [v, bad] of [['http://www.linkedin.com/in/sara', true], ['https://linkedin.com.evil.example/in/sara', true], ['https://www.linkedin.com/in/sara', false]]) {
      await page.fill('#job-linkedin', v);
      await page.locator('#job-city').focus();
      const s = await fieldState(page, 'linkedin');
      check(bad ? s.msg === E.linkedin : s.msg === '', `${label}: LinkedIn ${v} → ${JSON.stringify(s.msg)}`);
    }

    // note counter: the 500-character limit, Western digits
    await page.locator('#job-note').fill('م'.repeat(510));
    const note = await page.evaluate(() => ({ len: document.querySelector('#job-note').value.length, count: document.querySelector('[data-note-count]').textContent.trim() }));
    check(note.len === 500 && note.count === '500 / 500', `${label}: note counter ${JSON.stringify(note)}`);
    await page.locator('#job-note').fill('خبرة سنتين في الاستقبال');
    check((await page.locator('[data-note-count]').textContent()).trim() === '23 / 500', `${label}: counter after a short note`);

    // the CV: a .txt renamed .pdf, then a file over 5 MB, then a real one
    await page.setInputFiles('#job-cv', { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('plain text, not a pdf') });
    await page.waitForTimeout(100);
    check((await fieldState(page, 'cv')).msg === E.cv_type, `${label}: a .txt renamed .pdf is not refused (${(await fieldState(page, 'cv')).msg})`);
    await page.setInputFiles('#job-cv', { name: 'big.pdf', mimeType: 'application/pdf', buffer: pdfBuffer(CV_MAX_BYTES + 1) });
    await page.waitForTimeout(150);
    check((await fieldState(page, 'cv')).msg === E.cv_size, `${label}: a file over 5 MB is not refused`);

    // «متاح للبدء من»: the site's picker in single mode — one tap picks and closes; today is selectable
    const scope = page.locator('[data-careers-form]');
    const dlg = await openPicker(page, scope, 'start', { mobile });
    check((await dlg.locator(`td[data-date="${today}"]:not([aria-disabled])`).count()) === 1, `${label}: today is not selectable`);
    const past = dlg.locator(`td[data-date="${addDays(today, -1)}"]`);
    check(!(await past.count()) || (await past.getAttribute('aria-disabled')) === 'true', `${label}: a past day is selectable`);
    await tapDay(dlg, addDays(today, 10), { mobile });
    await scope.locator('dialog[data-dr-dialog][open]').waitFor({ state: 'detached' });
    check((await page.inputValue('input[name="available_from"]')) === addDays(today, 10), `${label}: the start date was not set by one tap`);

    // consent unticked blocks the submit
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await fillValid(page, mobile, { consent: false });
    await page.fill('#job-website', '');
    await press(page.locator('[data-careers-form] [data-submit]'), mobile);
    await page.waitForTimeout(200);
    const cs = await fieldState(page, 'consent');
    check(cs.msg === E.consent && cs.focused && state.posts.length === 0, `${label}: an unticked consent did not block the submit (${JSON.stringify(cs)}, ${state.posts.length} posts)`);
    check(!(await page.isChecked('#job-consent')), `${label}: the consent box is pre-ticked`);

    // summary line: department · property · file
    const sum = await page.locator('[data-careers-form] [data-summary]').innerText();
    check(sum.includes(T.form.departments.housekeeping) && sum.includes('السيرة.pdf'), `${label}: summary line ${JSON.stringify(sum)}`);

    // server failure → the message
    state.respond = { status: 500, body: { ok: false } };
    await page.check('#job-consent');
    await press(page.locator('[data-careers-form] [data-submit]'), mobile);
    await page.locator('[data-careers-form] [data-form-error]:not(.hidden)').waitFor();
    const failMsg = await page.locator('[data-careers-form] [data-form-error]').innerText();
    check(failMsg === E.server.replace('{email}', contact.emails.jobs), `${label}: failure message ${JSON.stringify(failMsg)}`);
    check(!(await page.locator('[data-careers-form] [data-submit]').isDisabled()), `${label}: the button stays disabled after a failure`);

    // a 422 verdict of the server is shown inline
    state.respond = { status: 422, body: { ok: false, fields: { cv: 'cv_type' } } };
    await press(page.locator('[data-careers-form] [data-submit]'), mobile);
    await page.waitForTimeout(300);
    check((await fieldState(page, 'cv')).msg === E.cv_type, `${label}: the server's cv_type verdict is not shown inline`);

    // success: spinner while sending, the ref, the form emptied, the dataLayer event without personal data
    state.respond = { status: 200, body: { ok: true, ref: 'AR-20991231-TEST' } };
    await page.fill('#job-website', 'bot-filled');
    const before = state.posts.length;
    await page.evaluate(() => {
      const btn = document.querySelector('[data-careers-form] [data-submit]');
      window.__busy = false;
      new MutationObserver(() => {
        if (btn.disabled && !btn.querySelector('[data-spinner]').classList.contains('hidden')) window.__busy = true;
      }).observe(btn, { attributes: true, subtree: true });
    });
    await press(page.locator('[data-careers-form] [data-submit]'), mobile);
    await page.locator('[data-careers] [data-success]:not(.hidden)').waitFor();
    const ok = await page.evaluate(() => ({
      text: document.querySelector('[data-success-text]').textContent,
      formHidden: document.querySelector('[data-careers-form]').classList.contains('hidden'),
      focus: document.activeElement?.hasAttribute('data-success'),
      name: document.querySelector('#job-name').value,
      email: document.querySelector('#job-email').value,
      nat: document.querySelector('input[name="nationality"]').value,
      files: document.querySelector('#job-cv').files.length,
      busy: window.__busy,
      dl: (window.dataLayer || []).filter((e) => e && e.event === 'job_application'),
    }));
    check(ok.text === T.success.replace('{ref}', 'AR-20991231-TEST'), `${label}: success text ${JSON.stringify(ok.text)}`);
    check(ok.formHidden && ok.focus, `${label}: success panel not shown / focused`);
    check(!ok.name && !ok.email && !ok.nat && ok.files === 0, `${label}: the form keeps the applicant's data after success`);
    check(ok.busy, `${label}: the button was not disabled with a spinner while sending`);
    check(ok.dl.length === 1 && JSON.stringify(Object.keys(ok.dl[0]).sort()) === JSON.stringify(['branch', 'department', 'event']) && ok.dl[0].department === 'housekeeping' && ok.dl[0].branch === 'shafa-road', `${label}: dataLayer ${JSON.stringify(ok.dl)}`);
    const post = state.posts.at(-1);
    check(state.posts.length === before + 1 && /\/functions\/v1\/job-application$/.test(post?.url ?? ''), `${label}: the application was not posted once to the job-application endpoint`);
    const part = (k) => new RegExp(`name="${k}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(post?.body ?? '')?.[1];
    check(/^multipart\/form-data/.test(post?.type ?? ''), `${label}: not sent as multipart/form-data`);
    check(part('phone') === '+966501234567', `${label}: phone sent as ${part('phone')}, expected E.164`);
    check(part('website') === 'bot-filled', `${label}: the honeypot field is not sent`);
    check(part('nationality') === 'SA' && part('department') === 'housekeeping' && part('branch') === 'shafa-road' && part('consent') === 'yes', `${label}: fields sent ${part('nationality')} ${part('department')} ${part('branch')} ${part('consent')}`);
    check(/name="cv"; filename="[^"]*"\r\nContent-Type: application\/pdf/.test(post?.body ?? ''), `${label}: the CV is not attached as a PDF part`);
    await page.screenshot({ path: `${SHOTS}/${c.lang}-${c.vp.width}-${c.theme}-success.png`, fullPage: true });
  }

  // nothing typed into the form ever reaches localStorage / sessionStorage
  const writes = await page.evaluate(() => window.__storageWrites || []);
  // what the applicant types or picks as a person (option slugs such as a branch are not personal and appear in the
  // site's public room cache, `armada_site_rooms`, written by the booking drawer on a live build)
  const typed = ['سارة', 'sara@example.com', '0501234567', '+966501234567', 'الطائف', 'linkedin.com/in/sara', 'خبرة سنتين', 'السيرة.pdf'];
  const leaked = writes.filter(([, k, v]) => typed.some((t) => k.includes(t) || v.includes(t)));
  check(leaked.length === 0, `${label}: storage writes with form data: ${JSON.stringify(leaked).slice(0, 300)}`);
  check(errors.length === 0, `${label}: page errors: ${errors.join(' | ').slice(0, 300)}`);
  await ctx.close();
}

await browser.close();
if (fails.length) {
  console.log(`✗ careers-form-check: ${fails.length} of ${checks} checks failed`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ careers-form-check: ${checks} checks passed (rules, ${CASES.length} page variants; screenshots in ${SHOTS}/)`);
