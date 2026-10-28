// Partners enquiry form QA (26 Oct 2026, after a form opened with an old test entry in it — «سلقيب» / «112» — restored
// silently from localStorage). /partners/enquiry/ in Arabic and English, at 375 px (touch) and 1440 px:
//   - a fresh visit shows empty fields and no notice; the fields carry the autocomplete tokens (organization, name,
//     email, tel-national, country-name) so browser autofill lands in the right place;
//   - the contact rules (rules.ts, shared with the booking form and the Edge Function): a digits-only contact name or
//     company, a bad phone or email are refused inline with the right message, aria-invalid, focus, and Continue stays
//     on step 1; valid values (a Saudi national number) pass;
//   - a saved draft comes back only with the notice «استعدنا بيانات أدخلتها سابقًا»; «مسح البيانات» empties the form
//     and deletes the draft; a draft older than 7 days and the old unversioned draft are deleted unread; the URL
//     preselection (?request=) works without a notice;
//   - submit (endpoint stubbed — injected into the page config when the build has none): the body carries E.164 and
//     the draft is gone after the success box;
//   - the phone country selector (28 Oct 2026, decision A — the booking form's, shared): Saudi default, flags only from
//     /flags/ and only once the list is open, the same look as the wizard's fields in light and dark, the list not
//     clipped, search by name / English name / ISO / dial code (+ optional, Arabic-Indic digits), keyboard path (Esc,
//     Enter, arrows, Tab), the start-and-end outside press, a pasted +971 number switching to the UAE, Egypt's example
//     number refused under Saudi Arabia and sent as E.164 under Egypt, a draft restoring the country, «مسح البيانات»
//     resetting it, an old draft without a country taking it from the number.
// Also the server side of the same rules (validatePartnerContact with libphonenumber-js, as the Edge Function runs it).
//   node scripts/partners-form-check.mjs [BASE_URL]
import { readFileSync } from 'node:fs';
import { getExampleNumber, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import examples from 'libphonenumber-js/mobile/examples';
import { chromium } from 'playwright';
import { validatePartnerContact } from '../supabase/functions/booking-request/rules.ts';
import { addDays, pickRange, press, riyadhToday } from './datepicker-helpers.mjs';

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
// the selected country (28 Oct 2026): Egypt's example digits are valid for Egypt and refused under Saudi Arabia
const egypt = getExampleNumber('EG', examples);
check(srv({ phone: egypt.nationalNumber, country: 'EG' }).data?.phone === egypt.number, 'server: an Egyptian national number with country EG is not E.164');
check(srv({ phone: egypt.nationalNumber }).errors?.phone === 'phone', 'server: Egypt digits under Saudi Arabia accepted');
check(srv({ phone: egypt.nationalNumber, country: 'eg' }).data?.phone === egypt.number, 'server: a lower-case country code is not accepted');

// ── browser ─────────────────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ channel: 'chrome' });
const CASES = [
  { lang: 'ar', path: '/partners/enquiry/', vp: { width: 375, height: 812, mobile: true } },
  { lang: 'en', path: '/en/partners/enquiry/', vp: { width: 375, height: 812, mobile: true } },
  { lang: 'ar', path: '/partners/enquiry/', vp: { width: 1440, height: 900 } },
  { lang: 'en', path: '/en/partners/enquiry/', vp: { width: 1440, height: 900 } },
];

async function newContext(vp, theme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, colorScheme: 'light' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch {} }, theme);
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

// ── the phone country selector (decision A, 28 Oct 2026) ────────────────────────────────────────────────────────
// Example numbers from libphonenumber-js (getExampleNumber), never real ones. Egypt's example (10 national digits) is
// valid for Egypt and invalid under Saudi Arabia (9 digits), so the same digits prove both paths.
const EX = { AE: getExampleNumber('AE', examples), EG: getExampleNumber('EG', examples), KW: getExampleNumber('KW', examples) };
const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/u; // flag emoji are pairs of regional indicator symbols
const COUNTRY_NAME = { ar: { AE: 'الإمارات', EG: 'مصر' }, en: { AE: 'United Arab', EG: 'Egypt' } };

/** the selector's state as the page shows it */
const selectorState = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('[data-phone-group]');
    const btn = g.querySelector('[data-country-btn]');
    const ph = g.querySelector('[data-phone-input]');
    return {
      value: g.querySelector('[data-country-value]').value,
      code: g.querySelector('[data-country-code]').textContent.trim(),
      flag: g.querySelector('[data-country-flag]').getAttribute('src'),
      label: btn.getAttribute('aria-label'),
      expanded: btn.getAttribute('aria-expanded'),
      btnText: btn.textContent,
      phone: ph.value,
      lang: ph.getAttribute('lang'),
      dir: ph.getAttribute('dir') || getComputedStyle(ph).direction,
      autocomplete: ph.getAttribute('autocomplete'),
      focused: document.activeElement === ph ? 'phone' : document.activeElement === btn ? 'button' : document.activeElement?.matches('[data-country-search]') ? 'search' : document.activeElement?.tagName,
      roles: { haspopup: btn.getAttribute('aria-haspopup'), controls: btn.getAttribute('aria-controls'), listbox: g.querySelector('[data-country-list]')?.getAttribute('role'), listId: g.querySelector('[data-country-list]')?.id },
    };
  });
const visibleOptions = (page) => page.evaluate(() => [...document.querySelectorAll('[data-phone-group] .country-opt')].map((o) => ({ cc: o.dataset.cc, role: o.getAttribute('role'), selected: o.getAttribute('aria-selected'), active: o.classList.contains('is-active'), id: o.id })));
/** dispatch a real paste event with clipboard text on the number field */
const pasteInto = (page, sel, text) =>
  page.evaluate(([sel, text]) => {
    const el = document.querySelector(sel);
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [sel, text]);

/** walk the wizard from step 1 (contact already filled) to the send button and post; returns the last body */
async function walkAndSend(page, c, posts, m) {
  await page.locator('#f-biztype').selectOption({ index: 1 });
  await page.locator('.f-next').click();
  await page.waitForTimeout(500);
  if ((await stepOn(page)) !== 1) return null;
  await page.locator('#f-reqtype').selectOption({ index: 1 });
  await page.locator('.f-next').click();
  await page.waitForTimeout(500);
  const form = page.locator('#enquiry-form');
  const S1 = addDays(riyadhToday(), 40);
  await pickRange(page, form, S1, addDays(S1, 2), m);
  await page.locator('#f-guests').fill('12');
  const n = posts.length;
  await page.locator('.f-send').click();
  for (let i = 0; i < 40 && posts.length === n; i++) await page.waitForTimeout(100);
  return posts.length > n ? posts[posts.length - 1] : null;
}

async function selectorChecks(page, tag, c, posts, { quick = false } = {}) {
  const m = { mobile: !!c.vp.mobile };
  const N = COUNTRY_NAME[c.lang];
  const origin = new URL(BASE).origin;
  const flagRequests = [];
  const foreign = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/flags/')) flagRequests.push(u);
    else if (!u.startsWith(origin) && !/^(data|blob):/.test(u) && !u.startsWith('https://stub.invalid') && !/googletagmanager|google-analytics/.test(u)) foreign.push(u);
  });
  await page.waitForTimeout(300);

  // present, Saudi default, LTR number field, the booking form's roles
  let s = await selectorState(page);
  check(s.value === 'SA' && s.code === '+966' && /\/flags\/sa\.png$/.test(s.flag || ''), `${tag}: selector default is not Saudi Arabia (${JSON.stringify({ value: s.value, code: s.code, flag: s.flag })})`);
  check(s.lang === 'en' && s.dir === 'ltr' && s.autocomplete === 'tel-national', `${tag}: phone input lang/dir/autocomplete ${JSON.stringify({ lang: s.lang, dir: s.dir, autocomplete: s.autocomplete })}`);
  check(s.roles.haspopup === 'listbox' && s.roles.listbox === 'listbox' && s.roles.controls === s.roles.listId && s.expanded === 'false', `${tag}: selector roles ${JSON.stringify(s.roles)}`);
  check(!REGIONAL.test(s.btnText), `${tag}: the button shows a flag emoji`);
  check(/^.+: .+ \+966$/.test(s.label || ''), `${tag}: button accessible name «${s.label}»`);
  // looks like the wizard's other fields: same height, border, radius, font, in this theme
  const look = await page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const btn = document.querySelector('[data-country-btn]');
    const ph = document.querySelector('#f-phone');
    const ref = document.querySelector('#f-email');
    const b = btn.getBoundingClientRect();
    const p = ph.getBoundingClientRect();
    const r = ref.getBoundingClientRect();
    return { hBtn: b.height, hPhone: p.height, hRef: r.height, border: [cs(btn).borderTopColor, cs(ph).borderTopColor, cs(ref).borderTopColor], radius: [cs(btn).borderTopLeftRadius, cs(ph).borderTopLeftRadius, cs(ref).borderTopLeftRadius], bg: [cs(btn).backgroundColor, cs(ph).backgroundColor, cs(ref).backgroundColor], font: [cs(btn).fontSize, cs(ph).fontSize, cs(ref).fontSize], family: [cs(btn).fontFamily.split(',')[0], cs(ref).fontFamily.split(',')[0]], top: [b.top, p.top] };
  });
  check(Math.abs(look.hBtn - look.hRef) <= 1 && Math.abs(look.hPhone - look.hRef) <= 1 && Math.abs(look.top[0] - look.top[1]) <= 1, `${tag}: selector height differs from the wizard's fields ${JSON.stringify({ hBtn: look.hBtn, hPhone: look.hPhone, hRef: look.hRef, top: look.top })}`);
  check(look.border[0] === look.border[2] && look.border[1] === look.border[2] && look.radius[0] === look.radius[2] && look.bg[0] === look.bg[2] && look.font[0] === look.font[2], `${tag}: selector look differs from the wizard's fields ${JSON.stringify(look)}`);
  check(flagRequests.length === 0, `${tag}: flags requested before the list opened: ${flagRequests.slice(0, 3).join(' ')}`);

  // open: search focused, flags from /flags/ only, no foreign request
  await press(page.locator('[data-country-btn]'), m.mobile);
  await page.waitForTimeout(300);
  s = await selectorState(page);
  check(s.expanded === 'true' && s.focused === 'search', `${tag}: list did not open with the search focused (${s.expanded}, ${s.focused})`);
  let opts = await visibleOptions(page);
  check(opts.length > 200 && opts[0].cc === 'SA' && opts[1].cc === 'AE' && opts[0].selected === 'true' && opts.every((o) => o.role === 'option'), `${tag}: list order / roles (${opts.length}, ${opts.slice(0, 3).map((o) => o.cc).join(',')})`);
  await page.waitForTimeout(500);
  check(flagRequests.length > 5 && flagRequests.every((u) => u.startsWith(`${origin}/`) && /\/flags\/[a-z]{2}\.png$/.test(u)), `${tag}: flags not self-hosted (${flagRequests.length}: ${flagRequests.find((u) => !u.startsWith(origin)) ?? ''})`);
  check(foreign.length === 0, `${tag}: external requests ${foreign.slice(0, 3).join(' ')}`);
  // not clipped: the whole list is visible and the last visible option is really on top
  const clip = await page.evaluate(() => {
    const pop = document.querySelector('[data-country-pop]');
    document.querySelector('[data-phone-group]').scrollIntoView({ block: 'start' });
    scrollBy(0, -24);
    const r = pop.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const inView = r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1;
    const list = pop.querySelector('[data-country-list]');
    const lr = list.getBoundingClientRect();
    const probe = (x, y) => document.elementFromPoint(x, y);
    const points = [[r.left + 4, r.top + 4], [r.right - 4, r.bottom - 4], [(lr.left + lr.right) / 2, lr.bottom - 6], [lr.left + 4, (lr.top + lr.bottom) / 2]];
    const covered = points.filter(([x, y]) => !pop.contains(probe(x, y))).map(([x, y]) => `${Math.round(x)},${Math.round(y)}:${probe(x, y)?.tagName}.${String(probe(x, y)?.className).split(' ')[0]}`);
    return { inView, covered: covered.length, by: covered, rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), vh } };
  });
  check(clip.inView && clip.covered === 0, `${tag}: the list is clipped or covered ${JSON.stringify(clip)}`);

  // search: name in the page language, English name, ISO code, dial code with / without +, Arabic-Indic digits
  const search = page.locator('[data-country-search]');
  for (const [q, cc, label] of [[N.AE, 'AE', 'name'], ['United Arab', 'AE', 'English name'], ['ae', 'AE', 'ISO'], ['971', 'AE', 'dial'], ['+971', 'AE', '+dial'], ['٩٧١', 'AE', 'Arabic-Indic dial'], [N.EG, 'EG', 'name 2'], ['eg', 'EG', 'ISO 2']]) {
    await search.fill(q);
    await page.waitForTimeout(80);
    opts = await visibleOptions(page);
    check(opts.length >= 1 && opts[0].cc === cc, `${tag}: search «${q}» (${label}) → ${opts.slice(0, 3).map((o) => o.cc).join(',') || 'nothing'}`);
    if (label === '+dial') check(opts.length === 1, `${tag}: search «${q}» matched ${opts.length} countries`);
  }
  await search.fill('zzzz');
  await page.waitForTimeout(80);
  check((await page.locator('[data-phone-group] .country-empty').count()) === 1 && (await visibleOptions(page)).length === 0, `${tag}: no-results line missing`);
  // keyboard: Esc closes and returns the focus; Enter on the button opens; arrows + Enter pick; Tab closes
  await page.keyboard.press('Escape');
  s = await selectorState(page);
  check(s.expanded === 'false' && s.focused === 'button', `${tag}: Esc did not close the list / return focus (${s.expanded}, ${s.focused})`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  s = await selectorState(page);
  check(s.expanded === 'true' && s.focused === 'search' && (await visibleOptions(page))[0]?.active === true, `${tag}: Enter on the button did not open the list with the first option active`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  opts = await visibleOptions(page);
  const activeDesc = await page.evaluate(() => document.querySelector('[data-country-search]').getAttribute('aria-activedescendant'));
  check(opts[2]?.active === true && activeDesc === opts[2]?.id, `${tag}: arrows do not move the active option (${JSON.stringify(opts[2])}, ${activeDesc})`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  s = await selectorState(page);
  check(s.value === 'KW' && s.code === `+${EX.KW.countryCallingCode}` && /\/flags\/kw\.png$/.test(s.flag) && s.expanded === 'false' && s.focused === 'phone' && /\+965$/.test(s.label), `${tag}: Enter did not pick Kuwait and focus the number (${JSON.stringify({ value: s.value, code: s.code, focused: s.focused, label: s.label })})`);
  await press(page.locator('[data-country-btn]'), m.mobile);
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  s = await selectorState(page);
  check(s.expanded === 'false', `${tag}: Tab did not close the list`);
  // an outside press closes it; a press that starts inside the search and ends outside keeps it open (decision B8)
  await press(page.locator('[data-country-btn]'), m.mobile);
  await page.waitForTimeout(150);
  const pr = await page.locator('[data-country-pop]').boundingBox();
  const sr = await page.locator('[data-country-search]').boundingBox();
  await page.mouse.move(sr.x + sr.width / 2, sr.y + sr.height / 2);
  await page.mouse.down();
  await page.mouse.move(pr.x + pr.width + 60, pr.y + pr.height + 60, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  check((await selectorState(page)).expanded === 'true', `${tag}: a drag that started inside the search closed the list`);
  await page.mouse.click(pr.x + pr.width + 60, pr.y + pr.height + 60);
  await page.waitForTimeout(100);
  check((await selectorState(page)).expanded === 'false', `${tag}: a real outside click did not close the list`);

  if (quick) return;

  // pasting a +971 number switches to the UAE and keeps the national part
  await pasteInto(page, '#f-phone', `+971 ${EX.AE.nationalNumber.slice(0, 2)} ${EX.AE.nationalNumber.slice(2)}`);
  await page.waitForFunction(() => document.querySelector('[data-country-value]').value === 'AE', null, { timeout: 4000 }).catch(() => {});
  s = await selectorState(page);
  check(s.value === 'AE' && s.phone === EX.AE.nationalNumber && s.code === '+971', `${tag}: paste of +971 did not switch to the UAE (${JSON.stringify({ value: s.value, phone: s.phone })})`);
  // the same digits under Saudi Arabia are refused; under Egypt they pass and submit as E.164
  await page.locator('#f-phone').fill(EX.EG.nationalNumber);
  await press(page.locator('[data-country-btn]'), m.mobile);
  await search.fill('sa');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check((await selectorState(page)).value === 'SA', `${tag}: could not switch back to Saudi Arabia`);
  await page.locator('#f-company').fill('Test Travel');
  await page.locator('#f-person').fill(c.lang === 'ar' ? 'سارة العتيبي' : 'Sara Al-Otaibi');
  await page.locator('#f-email').fill('agent@example.com');
  await page.locator('#f-biztype').selectOption({ index: 1 });
  await page.locator('.f-next').click();
  await page.waitForTimeout(400);
  let fs = await fieldState(page, 'f-phone');
  check((await stepOn(page)) === 0 && fs.bad && fs.msg === lp.form.errors.phone[c.lang] && fs.focused, `${tag}: Egypt's digits under Saudi Arabia were not refused (${JSON.stringify(fs)})`);
  await press(page.locator('[data-country-btn]'), m.mobile);
  await search.fill('+20');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  fs = await fieldState(page, 'f-phone');
  check(!fs.bad, `${tag}: switching to Egypt did not clear the phone error`);
  const sent = await walkAndSend(page, c, posts, m);
  check(!!sent && sent.phone === EX.EG.number && sent.country === 'EG', `${tag}: body after an Egyptian number ${JSON.stringify(sent ? { phone: sent.phone, country: sent.country } : null)} (want ${EX.EG.number} / EG)`);
  await page.locator('#enquiry-sent').waitFor({ state: 'visible', timeout: 4000 });

  // drafts: a non-Saudi country comes back; «مسح البيانات» resets to Saudi Arabia; an old draft without a country
  const url = `${BASE}${c.path}`;
  await page.evaluate(([k, phone]) => localStorage.setItem(k, JSON.stringify({ saved_at: Date.now() - 3600000, fields: { company: 'Draft Co', person: 'Draft Name', phone, phone_country: 'EG' } })), [DRAFT_KEY, EX.EG.nationalNumber]);
  await page.goto(url, { waitUntil: 'load' });
  await ready(page);
  s = await selectorState(page);
  check(s.value === 'EG' && s.code === '+20' && /\/flags\/eg\.png$/.test(s.flag) && s.phone === EX.EG.nationalNumber && (await noticeShown(page)), `${tag}: a draft with Egypt did not restore the country (${JSON.stringify({ value: s.value, code: s.code, phone: s.phone })})`);
  await page.locator('[data-draft-clear]').click();
  await page.waitForTimeout(200);
  s = await selectorState(page);
  check(s.value === 'SA' && s.code === '+966' && /\/flags\/sa\.png$/.test(s.flag) && s.phone === '', `${tag}: «مسح البيانات» did not reset the country to Saudi Arabia (${JSON.stringify({ value: s.value, code: s.code, phone: s.phone })})`);
  await page.evaluate(([k, phone]) => localStorage.setItem(k, JSON.stringify({ saved_at: Date.now() - 3600000, fields: { company: 'Old Co', person: 'Old Name', phone } })), [DRAFT_KEY, EX.EG.number]);
  await page.goto(url, { waitUntil: 'load' });
  await ready(page);
  await page.waitForFunction(() => document.querySelector('[data-country-value]').value === 'EG', null, { timeout: 4000 }).catch(() => {});
  s = await selectorState(page);
  const oldDraft = await draft(page);
  check(s.value === 'EG' && s.phone === EX.EG.nationalNumber && JSON.parse(oldDraft || '{}').fields?.phone === EX.EG.number, `${tag}: an old draft with an international number did not set the country (${JSON.stringify({ value: s.value, phone: s.phone })})`);
  await page.evaluate(([k]) => localStorage.setItem(k, JSON.stringify({ saved_at: Date.now() - 3600000, fields: { company: 'Old Co', person: 'Old Name', phone: '0501234567' } })), [DRAFT_KEY]);
  await page.goto(url, { waitUntil: 'load' });
  await ready(page);
  s = await selectorState(page);
  check(s.value === 'SA' && s.phone === '0501234567', `${tag}: an old draft with a national number did not stay Saudi (${JSON.stringify({ value: s.value, phone: s.phone })})`);
  await page.evaluate((k) => localStorage.removeItem(k), DRAFT_KEY);
}

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
    const wantAc = { 'f-company': 'organization', 'f-person': 'name', 'f-email': 'email', 'f-phone': 'tel-national', 'f-country': 'country-name' };
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

    // 7. the phone country selector (28 Oct 2026, decision A): the booking form's selector, shared
    step = '7. country selector';
    await page.goto(url, { waitUntil: 'load' });
    await ready(page);
    await selectorChecks(page, tag, c, posts);
    // the same in dark mode (legacy-dark.css palette)
    step = '7b. country selector (dark)';
    const dark = await newContext(c.vp, 'dark');
    const dp = await dark.ctx.newPage();
    dp.on('console', (msg) => msg.type() === 'error' && !/Failed to load resource/.test(msg.text()) && errors.push(`dark: ${msg.text()}`));
    dp.on('pageerror', (e) => errors.push(`dark: ${String(e)}`));
    await dp.goto(url, { waitUntil: 'load' });
    await ready(dp);
    check((await dp.evaluate(() => document.documentElement.dataset.theme)) === 'dark', `${tag}: dark theme not applied`);
    await selectorChecks(dp, `${tag} dark`, c, dark.posts, { quick: true });
    await dark.ctx.close();

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
