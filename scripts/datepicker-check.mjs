// Calendar range picker QA (Ahmed, 23 Oct 2026) — every date field on the site, at 375 px (touch, iPhone-sized
// bottom sheet) and 1440 px (two-month popover), in Arabic and English:
//   - booking drawer (opened from the header on the home page), the /booking/ page, the partners enquiry form.
// Checks: the fields are buttons and no text input / select / textarea takes focus while dates are picked (no
// keyboard); a tap opens the picker (sheet = the whole viewport with one month; popover = two months side by side,
// under the fields); past days (Asia/Riyadh) are disabled and cannot be picked; the arrival day cannot be the
// departure; a tap before the arrival restarts from that day; the live night count and its Arabic plural (1, 2,
// 3–10, 11+); the field text («الأحد 2 نوفمبر 2026» / "Sun, 2 Nov 2026"); Done / Clear; Esc and focus return; RTL
// grid (Sunday on the right) and mirrored arrow keys; Home / PageDown; the range ends on 31 Dec next year; full-date
// aria-labels and grid semantics; 44 px targets; reduced motion; the submitted values are ISO YYYY-MM-DD (form data,
// and the request body when the build has PUBLIC_BOOKING_ENDPOINT — the Edge Function is stubbed, nothing is sent).
// No console errors.
//   node scripts/datepicker-check.mjs [BASE_URL] [--shots DIR]
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { addDays, done, formatDate, openPicker, press, riyadhToday, tapDay } from './datepicker-helpers.mjs';

const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const SHOTS = shotsAt >= 0 ? args[shotsAt + 1] : null;
const BASE = (args.find((a, i) => !a.startsWith('--') && i !== shotsAt + 1) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const fails = [];
let checks = 0;
let noEndpointNoted = false;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};
const TODAY = riyadhToday();
const LAST = `${Number(TODAY.slice(0, 4)) + 1}-12-31`;
const nightsText = (lang, n) => {
  const P = ui[lang].form.plural.nights;
  const key = n === 1 ? 'one' : n === 2 ? 'two' : n >= 3 && n <= 10 ? 'few' : 'many';
  return ui[lang].form.stay_length.replace('{nights}', P[key].replace('{n}', String(n)));
};

const FORMS = [
  { kind: 'drawer', lang: 'ar', path: '/' },
  { kind: 'drawer', lang: 'en', path: '/en/' },
  { kind: 'booking', lang: 'ar', path: '/booking/' },
  { kind: 'booking', lang: 'en', path: '/en/booking/' },
  { kind: 'partners', lang: 'ar', path: '/partners/enquiry/' },
  { kind: 'partners', lang: 'en', path: '/en/partners/enquiry/' },
];
const VIEWPORTS = [
  { width: 375, height: 812, mobile: true },
  { width: 1440, height: 900 },
];

const browser = await chromium.launch({ channel: 'chrome' });

async function newContext(vp, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, ...extra });
  const posts = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await ctx.route('**/functions/v1/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    try {
      posts.push(JSON.parse(r.request().postData() || '{}'));
    } catch {
      posts.push({});
    }
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true,"ref":"AR-TEST-0000"}' });
  });
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
  return { ctx, posts };
}

/** Load the page and return the form that holds the date fields (drawer opened, partners wizard on step 3). */
async function openForm(page, c, vp) {
  await page.goto(`${BASE}${c.path}`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  if (c.kind === 'drawer') {
    const href = `${PRE}${c.lang === 'en' ? '/en' : ''}/booking/`;
    let opener = page.locator(`header a[href="${href}"]:visible`).first();
    if (!(await opener.count())) {
      const toggle = page.locator('[data-menu-toggle]:visible').first();
      if (await toggle.count()) await toggle.click(), await page.waitForTimeout(400);
      opener = page.locator(`header a[href="${href}"]:visible, a[href="${href}"]:visible`).first();
    }
    await opener.click();
    await page.waitForTimeout(700);
    return page.locator('[data-booking-drawer] form');
  }
  if (c.kind === 'booking') return page.locator('main form[data-booking-form]');
  const form = page.locator('#enquiry-form');
  await form.locator('#f-company').fill('Test Travel');
  await form.locator('#f-person').fill(c.lang === 'ar' ? 'سارة العتيبي' : 'Sara Al-Otaibi');
  await form.locator('#f-email').fill('agent@example.com');
  await form.locator('#f-phone').fill('+966501234567');
  await form.locator('#f-biztype').selectOption({ index: 1 });
  await form.locator('.f-next').click();
  await page.waitForTimeout(500);
  await form.locator('#f-reqtype').selectOption({ index: 1 });
  await form.locator('.f-next').click();
  await page.waitForTimeout(500);
  return form;
}

const hidden = (form, which) => form.locator(`[data-dr-value="${which}"]`).inputValue();
const status = (dlg) => dlg.locator('[data-dr-status]').textContent();
const focusedDate = (page) => page.evaluate(() => document.activeElement?.closest?.('td[data-date]')?.getAttribute('data-date') ?? null);

for (const vp of VIEWPORTS) {
  for (const c of FORMS) {
    const tag = `@${vp.width} ${c.lang} ${c.kind}`;
    if (process.env.ONLY && !`${vp.width}-${c.lang}-${c.kind}`.includes(process.env.ONLY)) continue;
    const m = { mobile: !!vp.mobile };
    const D = ui[c.lang].datepicker;
    const { ctx, posts } = await newContext(vp);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (msg) => msg.type() === 'error' && !/Failed to load resource/.test(msg.text()) && errors.push(msg.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    let step = 'open the form';
    try {
      const form = await openForm(page, c, vp);

      // fields are buttons; the values are hidden inputs; no native date / text date input is left
      const kinds = await form.evaluate((f) => ({
        triggers: [...f.querySelectorAll('[data-dr-trigger]')].map((b) => b.tagName),
        values: [...f.querySelectorAll('[data-dr-value]')].map((i) => i.type),
        dateInputs: f.querySelectorAll('input[type="date"], [data-date-text]').length,
      }));
      check(kinds.triggers.join() === 'BUTTON,BUTTON', `${tag}: date fields are not buttons (${kinds.triggers})`);
      check(kinds.values.join() === 'hidden,hidden', `${tag}: date values are not hidden inputs (${kinds.values})`);
      check(kinds.dateInputs === 0, `${tag}: a typed date input is still present`);
      if (vp.mobile) {
        const h = await form.locator('[data-dr-trigger="start"]').boundingBox();
        check(h && h.height >= 44, `${tag}: arrival field is ${h?.height}px tall`);
      }

      // focus log: nothing that opens a keyboard may take focus while dates are picked
      await page.evaluate(() => {
        window.__kb = [];
        document.addEventListener('focusin', (e) => {
          const t = e.target;
          if (t.matches?.('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select, [contenteditable="true"]')) window.__kb.push(t.name || t.id || t.tagName);
        });
      });

      // 1. a tap on the arrival field opens the picker
      step = '1. a tap on the arrival field opens the picker';
      let dlg = await openPicker(page, form, 'start', m);
      const box = await dlg.boundingBox();
      const months = await dlg.locator('.dp-month').count();
      if (vp.mobile) {
        check(months === 1, `${tag}: sheet shows ${months} months (want 1)`);
        check(box && Math.abs(box.x) < 1 && Math.abs(box.y) < 1 && Math.abs(box.width - vp.width) < 2 && box.height >= vp.height - 2, `${tag}: sheet is not full-screen (${JSON.stringify(box)})`);
      } else {
        check(months === 2, `${tag}: popover shows ${months} months (want 2)`);
        const [a, b] = await Promise.all([0, 1].map((i) => dlg.locator('.dp-month').nth(i).boundingBox()));
        check(a && b && Math.abs(a.y - b.y) < 1 && Math.abs(a.x - b.x) > 200, `${tag}: months are not side by side`);
        const fieldsBottom = Math.max(...(await Promise.all(['start', 'end'].map((w) => form.locator(`[data-dr-trigger="${w}"]`).boundingBox()))).map((r) => r.y + r.height));
        check(box && box.y >= fieldsBottom - 1 && box.y + box.height <= vp.height, `${tag}: popover is not under the fields inside the viewport (${JSON.stringify(box)}, fields end ${fieldsBottom})`);
        if (c.kind !== 'drawer') {
          const rootTop = await form.locator('[data-daterange]').evaluate((r) => r.getBoundingClientRect().top);
          const headerBottom = await page.locator('header').first().evaluate((h) => h.getBoundingClientRect().bottom);
          check(rootTop >= headerBottom, `${tag}: the date fields sit under the sticky header (${rootTop} < ${headerBottom})`);
        }
      }
      check((await focusedDate(page)) === TODAY, `${tag}: focus is not on today's cell after opening (${await focusedDate(page)})`);

      // grid semantics, Sunday first, RTL / LTR order, full-date labels
      const grid = await dlg.evaluate((d) => {
        const t = d.querySelector('table[role="grid"]');
        const ths = [...t.querySelectorAll('thead th')];
        const cells = [...d.querySelectorAll('td[data-date]')];
        return {
          labelled: !!document.getElementById(t.getAttribute('aria-labelledby') || '')?.textContent,
          heads: ths.map((th) => th.textContent),
          abbr: ths.map((th) => th.getAttribute('abbr')),
          firstX: ths[0].getBoundingClientRect().x,
          lastX: ths[6].getBoundingClientRect().x,
          labels: cells.map((td) => [td.dataset.date, td.getAttribute('aria-label')]),
          small: cells.map((td) => td.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length,
          today: d.querySelector(`td[data-date][aria-current="date"]`)?.dataset.date,
        };
      });
      check(grid.labelled, `${tag}: grid has no month label`);
      check(grid.heads.join() === D.weekdays_short.join() && grid.abbr.join() === D.weekdays.join(), `${tag}: weekday header is not Sunday-first short names (${grid.heads})`);
      check(c.lang === 'ar' ? grid.firstX > grid.lastX : grid.firstX < grid.lastX, `${tag}: Sunday is not on the ${c.lang === 'ar' ? 'right' : 'left'}`);
      check(grid.labels.every(([d, l]) => l && l.startsWith(formatDate(D.day_label, d, D))), `${tag}: a day has no full-date aria-label`);
      check(grid.small === 0, `${tag}: ${grid.small} day cells are smaller than 44 px`);
      check(grid.today === TODAY, `${tag}: today is not marked aria-current`);
      for (const sel of ['[data-dr-prev]', '[data-dr-next]', '[data-dr-done]', '[data-dr-clear]', ...(vp.mobile ? ['[data-dr-close]'] : [])]) {
        const r = await dlg.locator(sel).boundingBox();
        check(r && r.height >= 44 && r.width >= 44, `${tag}: ${sel} target is ${r ? `${Math.round(r.width)}×${Math.round(r.height)}` : 'missing'}`);
      }
      check((await dlg.locator('[data-dr-prev]').getAttribute('aria-disabled')) === 'true', `${tag}: previous month is enabled on the current month`);
      check((await status(dlg)) === D.pick_check_in, `${tag}: status is not «${D.pick_check_in}»`);

      // 2. past days are disabled and cannot be picked
      step = '2. past days are disabled and cannot be picked';
      const yesterday = addDays(TODAY, -1);
      const yCell = dlg.locator(`td[data-date="${yesterday}"]`);
      if (await yCell.count()) {
        check((await yCell.getAttribute('aria-disabled')) === 'true', `${tag}: yesterday is not disabled`);
        await press(yCell, m.mobile, { force: true });
        check((await hidden(form, 'start')) === '', `${tag}: a past day was picked`);
      }

      // 3. arrival; the arrival day is not a departure; a day before it restarts the range; departure
      step = '3. arrival; the arrival day is not a departure; a day before it restarts the range; departure';
      const A = addDays(TODAY, 20);
      await tapDay(dlg, A, m);
      check((await hidden(form, 'start')) === A && (await hidden(form, 'end')) === '', `${tag}: arrival not set to ${A}`);
      check((await status(dlg)) === D.pick_check_out, `${tag}: status after the arrival is not «${D.pick_check_out}»`);
      check((await dlg.locator(`td[data-date="${A}"]`).getAttribute('aria-disabled')) === 'true', `${tag}: the arrival day is selectable as departure`);
      await press(dlg.locator(`td[data-date="${A}"]`), m.mobile, { force: true });
      check((await hidden(form, 'end')) === '', `${tag}: the arrival day was taken as the departure`);
      const A2 = addDays(A, -2);
      await tapDay(dlg, A2, m);
      check((await hidden(form, 'start')) === A2 && (await hidden(form, 'end')) === '', `${tag}: a day before the arrival did not restart the range`);
      const B = addDays(A2, 3);
      await tapDay(dlg, B, m);
      check((await hidden(form, 'start')) === A2 && (await hidden(form, 'end')) === B, `${tag}: range is not ${A2} → ${B}`);
      check((await status(dlg)) === nightsText(c.lang, 3), `${tag}: night count «${await status(dlg)}» ≠ «${nightsText(c.lang, 3)}»`);
      check((await dlg.locator('td.in-range').count()) === 2, `${tag}: the stay band does not cover the 2 nights in between`);
      if (SHOTS) await page.waitForTimeout(300); // let the last day's colour transition settle
      if (SHOTS && vp.mobile && c.lang === 'ar' && c.kind === 'booking') await page.screenshot({ path: `${SHOTS}/375-ar-booking-range.png` });
      if (SHOTS && !vp.mobile && c.lang === 'en' && c.kind === 'booking') await page.screenshot({ path: `${SHOTS}/1440-en-booking-two-months.png` });
      if (SHOTS && c.kind === 'partners') await page.screenshot({ path: `${SHOTS}/${vp.width}-${c.lang}-partners.png` });

      // 4. Done closes, focus returns to the field that opened it, the fields show the dates
      step = '4. Done closes, focus returns to the field that opened it, the fields show the dates';
      await done(form, m);
      check(await form.locator('[data-dr-trigger="start"]').evaluate((b) => b === document.activeElement), `${tag}: focus did not return to the arrival field`);
      const shown = await Promise.all(['start', 'end'].map((w) => form.locator(`[data-dr-trigger="${w}"] [data-dr-display]`).textContent()));
      check(shown[0] === formatDate(D.field_format, A2, D) && shown[1] === formatDate(D.field_format, B, D), `${tag}: fields show «${shown.join(' / ')}»`);

      // 5. plurals (1, 2, 11 nights) and Clear
      step = '5. plurals (1, 2, 11 nights) and Clear';
      dlg = await openPicker(page, form, 'start', m);
      const C = addDays(TODAY, 40);
      for (const n of [1, 2, 11]) {
        await press(dlg.locator('[data-dr-clear]'), m.mobile);
        check((await hidden(form, 'start')) === '' && (await hidden(form, 'end')) === '', `${tag}: Clear did not empty the dates`);
        check((await status(dlg)) === D.pick_check_in, `${tag}: status after Clear`);
        await tapDay(dlg, C, m);
        await tapDay(dlg, addDays(C, n), m);
        check((await status(dlg)) === nightsText(c.lang, n), `${tag}: ${n} nights shows «${await status(dlg)}»`);
      }
      // the end of next year closes the range: navigation stops on December, 31 Dec is no arrival
      for (let i = 0; i < 30 && (await dlg.locator('[data-dr-next]').getAttribute('aria-disabled')) !== 'true'; i++) await press(dlg.locator('[data-dr-next]'), m.mobile);
      const lastTitle = await dlg.locator('.dp-title').last().textContent();
      check(lastTitle === D.month_title.replace('{month}', D.months[11]).replace('{year}', LAST.slice(0, 4)), `${tag}: navigation stops at «${lastTitle}»`);
      check((await dlg.locator(`td[data-date="${LAST}"]`).getAttribute('aria-disabled')) === 'true', `${tag}: 31 Dec next year is selectable as an arrival`);
      await done(form, m);

      // 6. keyboard (desktop): Enter opens on the departure, arrows follow the screen, Home, PageDown, Esc
      step = '6. keyboard (desktop): Enter opens on the departure, arrows follow the screen, Home, PageDown, Esc';
      if (!vp.mobile) {
        await press(form.locator('[data-dr-trigger="start"]'));
        dlg = form.locator('dialog[data-dr-dialog][open]');
        await page.waitForTimeout(400);
        await tapDay(dlg, A2);
        await tapDay(dlg, B);
        await done(form);
        await form.locator('[data-dr-trigger="end"]').focus();
        await page.keyboard.press('Enter');
        await dlg.waitFor();
        await page.waitForTimeout(400);
        check((await focusedDate(page)) === B, `${tag}: Enter on the departure field focuses ${await focusedDate(page)} (want ${B})`);
        await page.keyboard.press('ArrowRight');
        const right = addDays(B, c.lang === 'ar' ? -1 : 1);
        check((await focusedDate(page)) === right, `${tag}: ArrowRight moved to ${await focusedDate(page)} (want ${right})`);
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowDown');
        check((await focusedDate(page)) === addDays(B, 7), `${tag}: ArrowDown did not move one week`);
        await page.keyboard.press('Enter');
        check((await hidden(form, 'end')) === addDays(B, 7) && (await hidden(form, 'start')) === A2, `${tag}: Enter did not pick the departure`);
        check((await status(dlg)) === nightsText(c.lang, 10), `${tag}: 10 nights shows «${await status(dlg)}»`);
        await page.keyboard.press('Home');
        const home = await focusedDate(page);
        check(home && new Date(`${home}T00:00:00Z`).getUTCDay() === 0, `${tag}: Home did not go to Sunday (${home})`);
        const title0 = await dlg.locator('.dp-title').first().textContent();
        await page.keyboard.press('PageDown');
        await page.keyboard.press('PageDown');
        await page.keyboard.press('PageDown');
        check((await dlg.locator('.dp-title').first().textContent()) !== title0, `${tag}: PageDown did not page the months`);
        await page.keyboard.press('Escape');
        await form.locator('dialog[data-dr-dialog][open]').waitFor({ state: 'detached' });
        check(await form.locator('[data-dr-trigger="end"]').evaluate((b) => b === document.activeElement), `${tag}: Esc did not return focus to the departure field`);
        check((await hidden(form, 'end')) === addDays(B, 7), `${tag}: Esc lost the picked departure`);
        // the departure field with a complete range edits the departure only
        await page.keyboard.press('Space');
        await dlg.waitFor();
        await page.waitForTimeout(300);
        await tapDay(dlg, addDays(A2, 5));
        check((await hidden(form, 'start')) === A2 && (await hidden(form, 'end')) === addDays(A2, 5), `${tag}: the departure field did not edit the departure`);
        await done(form);
      }
      const kb = await page.evaluate(() => window.__kb);
      check(kb.length === 0, `${tag}: keyboard fields took focus while picking dates: ${kb.join(', ')}`);

      // 7. submit: the request carries ISO dates (endpoint stubbed)
      step = '7. submit: the request carries ISO dates (endpoint stubbed)';
      const S1 = addDays(TODAY, 30);
      const E1 = addDays(TODAY, 33);
      dlg = await openPicker(page, form, 'start', m);
      await tapDay(dlg, S1, m);
      await tapDay(dlg, E1, m);
      await done(form, m);
      // what the form itself would send (names as in each form), read before submitting
      const names = c.kind === 'partners' ? ['checkin', 'checkout'] : ['check_in', 'check_out'];
      const fd = await form.evaluate((f, n) => n.map((k) => new FormData(f).get(k)), names);
      check(fd[0] === S1 && fd[1] === E1, `${tag}: form data ${fd.join(' → ')} (want ${S1} → ${E1})`);
      if (c.kind === 'partners') {
        await form.locator('#f-guests').fill('20');
        await form.locator('.f-send').click();
      } else {
        await form.locator('select[name="branch"]').selectOption('airport-road');
        await form.locator('label:has(input[name="breakfast"][value="with"])').click();
        await form.locator('input[name="name"]').fill(c.lang === 'ar' ? 'سارة العتيبي' : 'Sara Al-Otaibi');
        await form.locator('[data-phone-input]').fill('501234567');
        await form.locator('[data-submit]').click();
      }
      for (let i = 0; i < 40 && !posts.length; i++) await page.waitForTimeout(100);
      if (posts.length) {
        check(posts[0].check_in === S1 && posts[0].check_out === E1, `${tag}: submitted ${posts[0].check_in} → ${posts[0].check_out} (want ${S1} → ${E1})`);
      } else if (!noEndpointNoted) {
        // a build without PUBLIC_BOOKING_ENDPOINT (local build.py) never posts; the form data above was checked
        noEndpointNoted = true;
        console.log('note: this build has no PUBLIC_BOOKING_ENDPOINT — the submitted values were checked as form data only');
      }
      check(errors.length === 0, `${tag}: console errors: ${errors.join(' | ')}`);
    } catch (e) {
      fails.push(`${tag} [${step}]: ${String(e).split('\n')[0]}`);
      if (process.env.DEBUG) console.log(String(e));
    }
    await ctx.close();
  }
}

// reduced motion: the picker opens and closes at once
for (const vp of VIEWPORTS) {
  const tag = `@${vp.width} reduced-motion`;
  const { ctx } = await newContext(vp, { reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/booking/`, { waitUntil: 'load' });
  const form = page.locator('main form[data-booking-form]');
  await press(form.locator('[data-dr-trigger="start"]'), !!vp.mobile);
  const dlg = form.locator('dialog[data-dr-dialog][open]');
  await dlg.waitFor();
  const t = await dlg.evaluate((d) => getComputedStyle(d).transitionDuration);
  check(t.split(',').every((x) => parseFloat(x) === 0), `${tag}: picker transition is ${t}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  check(!(await form.locator('dialog[data-dr-dialog]').evaluate((d) => d.open)), `${tag}: Esc did not close at once`);
  await ctx.close();
}

await browser.close();
console.log(`datepicker-check: ${checks} checks, ${fails.length} failures`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
