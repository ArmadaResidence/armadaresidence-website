// Booking form → «أرسل الطلب عبر واتساب» / "Send via WhatsApp" (23 Oct 2026).
// From a room page, a branch page and the home page, in Arabic and English: opens the booking drawer, fills every
// field and clicks the WhatsApp button. Asserts the popup is wa.me with the branch's number (content/contact.json)
// and a text holding every filled value, that the current page did not navigate, and that `whatsapp_click`
// { destination: <branch>, source: "booking_form" } was pushed. Also: no branch → the branch error and no popup;
// an invalid phone / email → the inline error and no popup; and the same button after a failed submit (the
// endpoint is stubbed to fail — no request ever reaches the real function, and wa.me is stubbed too).
//   node scripts/booking-whatsapp-check.mjs [BASE_URL]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
// the GitHub Pages project site serves under a sub-path; its links carry it
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const contact = JSON.parse(readFileSync('content/contact.json', 'utf8'));
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const rooms = JSON.parse(readFileSync('content/rooms.json', 'utf8'));
const branchesJson = JSON.parse(readFileSync('content/branches.json', 'utf8'));
const digits = (b) => contact.branches[b].whatsapp.replace(/\D/g, '');
const fails = [];
let checks = 0;

const iso = (d) => d.toISOString().slice(0, 10);
const riyadhNow = new Date(Date.now() + 3 * 3600e3);
const CHECK_IN = iso(new Date(riyadhNow.getTime() + 20 * 86400e3));
const CHECK_OUT = iso(new Date(riyadhNow.getTime() + 23 * 86400e3));

const roomList = Array.isArray(rooms) ? rooms : rooms.rooms;
const branchList = Array.isArray(branchesJson) ? branchesJson : branchesJson.branches;
const roomName = (branch, slug, lang) => {
  const r = roomList.find((x) => x.slug === slug && (x.branch === branch || x.branch_slug === branch));
  return r ? r[`name_${lang}`] : null;
};
const branchName = (b, lang) => branchList.find((x) => x.slug === b)[`name_${lang}`];

const CASES = [
  { lang: 'ar', path: '/airport-road/king-room/', open: `main a[href="${PRE}/booking/?branch=airport-road&room=king-room"]`, branch: 'airport-road', room: 'king-room' },
  { lang: 'ar', path: '/shafa-road/', open: `main a[href="${PRE}/booking/?branch=shafa-road"]`, branch: 'shafa-road', room: null },
  { lang: 'ar', path: '/', open: `header a[href="${PRE}/booking/"]`, branch: null, pick: 'shafa-road', room: null },
  { lang: 'en', path: '/en/shafa-road/king-room/', open: `main a[href="${PRE}/en/booking/?branch=shafa-road&room=king-room"]`, branch: 'shafa-road', room: 'king-room' },
  { lang: 'en', path: '/en/airport-road/', open: `main a[href="${PRE}/en/booking/?branch=airport-road"]`, branch: 'airport-road', room: null },
  { lang: 'en', path: '/en/', open: `header a[href="${PRE}/en/booking/"]`, branch: null, pick: 'airport-road', room: null },
];

const browser = await chromium.launch({ channel: 'chrome' });

for (const vp of [{ width: 1440, height: 900 }, { width: 375, height: 812, mobile: true }]) {
  for (const c of CASES) {
    const tag = `@${vp.width} ${c.lang} ${c.path}`;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
    // never reach the real endpoint or WhatsApp
    await ctx.route('**/functions/v1/**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' }));
    await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
    await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    const popups = [];
    page.on('popup', (p) => popups.push(p));

    const S = ui[c.lang].form;
    try {
      await page.goto(`${BASE}${c.path}`, { waitUntil: 'load' });
      await page.evaluate(() => (window.__noReload = true));
      let opener = page.locator(`${c.open}:visible`).first();
      if (!(await opener.count())) {
        const toggle = page.locator('[data-menu-toggle]:visible').first();
        if (await toggle.count()) await toggle.click(), await page.waitForTimeout(400);
        opener = page.locator(`${c.open}:visible`).first();
      }
      await opener.scrollIntoViewIfNeeded({ timeout: 4000 });
      await opener.click();
      await page.waitForTimeout(600);
      const form = page.locator('[data-booking-drawer] form');
      const wa = form.locator('[data-wa-send]');
      const startUrl = page.url();

      const clickWa = async () => {
        const before = popups.length;
        await wa.scrollIntoViewIfNeeded();
        await wa.click();
        // up to 3 s for a popup; a click that must open nothing waits the full time too
        for (let i = 0; i < 30 && popups.length === before; i++) await page.waitForTimeout(100);
        await page.waitForTimeout(200);
        return popups.slice(before);
      };
      const errVisible = (f) => form.locator(`[data-error-for="${f}"]:not(.hidden)`).count();

      // 1. no branch → branch error, nothing opens
      if (!c.branch) {
        const opened = await clickWa();
        checks++;
        if (opened.length) fails.push(`${tag}: opened ${opened[0].url()} with no branch`);
        if (!(await errVisible('branch'))) fails.push(`${tag}: no branch error shown`);
        await form.locator('select[name="branch"]').selectOption(c.pick);
      }
      const branch = c.branch ?? c.pick;

      // 2. fill everything
      await form.locator('input[name="check_in"]').fill(CHECK_IN);
      await form.locator('input[name="check_out"]').fill(CHECK_OUT);
      await form.locator('input[name="check_out"]').blur();
      const inc = form.locator('[data-stepper="adults"] [data-step="1"]');
      await inc.click();
      await form.locator('[data-stepper="children"] [data-step="1"]').click();
      await form.locator('label:has(input[name="breakfast"][value="with"])').click();
      const ADULTS = await form.locator('input[name="adults"]').inputValue();
      const NAME = c.lang === 'ar' ? 'سارة العتيبي' : 'Sara Al-Otaibi';
      await form.locator('input[name="name"]').fill(NAME);
      await form.locator('input[name="email"]').fill('guest@example.com');
      const NOTE = c.lang === 'ar' ? 'وصول متأخر بعد العاشرة مساءً' : 'Late arrival after 10 pm';
      await form.locator('textarea[name="notes"]').fill(NOTE);

      // 3. invalid phone → phone error, nothing opens
      await form.locator('[data-phone-input]').fill('12');
      await form.locator('[data-phone-input]').blur();
      await page.waitForTimeout(300);
      let opened = await clickWa();
      checks++;
      if (opened.length) fails.push(`${tag}: opened WhatsApp with an invalid phone`);
      if (!(await errVisible('phone'))) fails.push(`${tag}: no phone error for an invalid phone`);

      // 4. invalid email → email error, nothing opens
      await form.locator('[data-phone-input]').fill('501234567');
      await form.locator('input[name="email"]').fill('guest@');
      opened = await clickWa();
      checks++;
      if (opened.length) fails.push(`${tag}: opened WhatsApp with an invalid email`);
      if (!(await errVisible('email'))) fails.push(`${tag}: no email error for an invalid email`);
      await form.locator('input[name="email"]').fill('guest@example.com');

      const expected = [
        branchName(branch, c.lang),
        c.room ? roomName(branch, c.room, c.lang) : S.any_room,
        CHECK_IN,
        CHECK_OUT,
        c.lang === 'ar' ? '3 ليالٍ' : '3 nights',
        `${S.adults}: ${ADULTS}`,
        `${S.children}: 1`,
        `${S.extra_beds}: 0`,
        S.breakfast_with,
        NAME,
        '+966501234567',
        'guest@example.com',
        NOTE,
      ];
      const verify = async (label, list) => {
        checks++;
        if (list.length !== 1) return fails.push(`${tag} ${label}: ${list.length} popup(s), expected 1`);
        const u = new URL(list[0].url());
        if (u.origin !== 'https://wa.me' || u.pathname !== `/${digits(branch)}`) fails.push(`${tag} ${label}: opened ${u.origin}${u.pathname}, expected wa.me/${digits(branch)}`);
        const text = u.searchParams.get('text') || '';
        for (const v of expected) if (v && !text.includes(v)) fails.push(`${tag} ${label}: message lacks «${v}»`);
        const st = await page.evaluate(() => ({ url: location.href, noReload: window.__noReload === true, open: !!document.querySelector('[data-booking-drawer]')?.open, dl: (window.dataLayer || []).filter((e) => e && e.event === 'whatsapp_click') }));
        if (st.url !== startUrl || !st.noReload) fails.push(`${tag} ${label}: the current page navigated (${st.url})`);
        if (!st.open) fails.push(`${tag} ${label}: the booking form closed`);
        const ev = st.dl[st.dl.length - 1];
        if (!ev || ev.destination !== branch || ev.source !== 'booking_form') fails.push(`${tag} ${label}: whatsapp_click ${JSON.stringify(ev)}`);
        await list[0].close();
      };

      // 5. valid → one popup, wa.me/<branch number>, every value in the text
      await verify('hand-off', await clickWa());

      // 6. failed submit → error line, then the same button still hands off
      await form.locator('[data-submit]').click();
      await page.waitForTimeout(1200);
      checks++;
      if (!(await form.locator('[data-form-error]:not(.hidden)').count())) fails.push(`${tag}: no error line after a failed submit`);
      await verify('after failed submit', await clickWa());
    } catch (e) {
      fails.push(`${tag} aborted: ${String(e).split(/\r?\n/)[0].slice(0, 180)}`);
    }
    for (const e of errors) fails.push(`${tag} console: ${e.slice(0, 160)}`);
    await ctx.close();
  }
}
await browser.close();

if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of [...new Set(fails)]) console.log('  - ' + f);
  process.exit(1);
}
console.log(`✓ WhatsApp hand-off: ${checks} checks on ${CASES.length} pages × 2 viewports (AR + EN), incl. after a failed submit`);
