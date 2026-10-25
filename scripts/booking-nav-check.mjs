// Booking form prefill from every entry point (A1 23 Oct 2026; rewritten 24 Oct 2026; context-aware header and
// footer, Ahmed 24 Oct 2026). For both branches and every room (shared slugs king-room, one-bedroom-suite,
// two-bedroom-suite included), in Arabic and English, at 1440 px and 375 px (touch), it opens the booking form from
// every entry point and asserts what the form would actually SUBMIT — new FormData(form).get('branch' | 'room' |
// 'check_in' | 'check_out') — plus the option text the guest sees:
//   - room page: the booking-card CTA and, on phones, the bottom bar (scrolled into view, then tapped) → branch + room
//   - branch page: «اطلب حجزًا في هذا الفرع» → branch, any room
//   - header button (menu link on phones) and the footer link follow the page: room page → that branch + room;
//     sold-out room page (no booking CTA) → that branch, any room; branch page → that branch; every other page
//     (home, offers, contact, policies, blog, an article) → no branch, any room
//   - a link that carries check_in / check_out (no page link does yet: a copy of the page's CTA with the dates
//     appended) → branch, room and both dates
//   - /booking/?branch=&room=&check_in=&check_out= loaded directly → the same values on the page form
// Twice: on direct page loads, and after client-side navigation (ClientRouter: home → branch → each room, sold-out
// ones included → back → home, no reload allowed). Then the booking form's script is made to fail on the first page (the ClientRouter
// never retries it): a room CTA after client-side navigation must load /booking/?branch=&room= in full, prefilled,
// never open an inert form. Fails on a wrong value, an entry point that does not open on the first tap, a full
// reload, and any console / page error. Runs against the local build or the live site (sub-path aware); the
// booking endpoint, wa.me and GTM are stubbed, nothing is ever sent.
//   node scripts/booking-nav-check.mjs [BASE_URL]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { addDays, riyadhToday } from './datepicker-helpers.mjs';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
// the GitHub Pages project site serves under a sub-path; its links carry it
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const roomsJson = JSON.parse(readFileSync('content/rooms.json', 'utf8'));
const branchesJson = JSON.parse(readFileSync('content/branches.json', 'utf8'));
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const ROOMS = roomsJson.rooms.filter((r) => r.show_on_site && r.availability !== 'sold_out');
const SOLD_OUT = roomsJson.rooms.filter((r) => r.show_on_site && r.availability === 'sold_out');
// pages without a branch / room: their header and footer booking links stay empty
const OTHER_PAGES = ['/', '/offers/', '/contact/', '/policies/', '/blog/', '/blog/where-to-stay-in-taif/'];
const BRANCHES = branchesJson.branches.map((b) => b.slug);
const name = (list, slug, branch, lang) => list.find((x) => x.slug === slug && (!branch || x.branch === branch))?.[`name_${lang}`];
const CHECK_IN = addDays(riyadhToday(), 20);
const CHECK_OUT = addDays(riyadhToday(), 23);
const DATES = `&check_in=${CHECK_IN}&check_out=${CHECK_OUT}`;

const fails = [];
const notes = [];
// action timeout (scroll / tap): generous, the suite also runs while the machine builds (another session, CI)
const ACTION = 10000;
let checks = 0;
const browser = await chromium.launch({ channel: 'chrome' });

async function newContext(vp, lang) {
  const mobile = vp.width < 768;
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, locale: lang === 'en' ? 'en-US' : 'ar-SA' });
  // never reach the real endpoint, WhatsApp or analytics
  await ctx.route('**/functions/v1/**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' }));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await ctx.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  return ctx;
}

/** One (viewport, language) run: direct loads, then client-side navigation. */
async function run(vp, lang) {
  const mobile = vp.width < 768;
  const L = lang === 'en' ? '/en' : '';
  const tag = `@${vp.width} ${lang}`;
  const ctx = await newContext(vp, lang);
  // counts astro:page-load (ClientRouter navigations); registered before the site's own listeners, so once it has
  // counted, the new page's drawer and form are bound
  await ctx.addInitScript(() => document.addEventListener('astro:page-load', () => (window.__loads = (window.__loads || 0) + 1)));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const here = () => new URL(page.url()).pathname.slice(PRE.length) || '/';
  const press = (loc) => (mobile ? loc.tap({ timeout: ACTION }) : loc.click({ timeout: ACTION }));
  let step = ''; // the step in progress, for an abort message
  const bookHref = (q = '') => `${PRE}${L}/booking/${q}`;
  /** ?branch=&room= of a page's booking context ({} = none) */
  const ctxQuery = (c = {}) => (c.branch ? `?branch=${c.branch}${c.room ? `&room=${c.room}` : ''}` : '');

  /** What the drawer's form (or the /booking/ page form) would submit, and what the guest sees. */
  const formState = (sel) =>
    page.evaluate((sel) => {
      const d = document.querySelector('[data-booking-drawer]');
      const f = document.querySelector(sel);
      if (!f) return null;
      const fd = new FormData(f);
      const b = f.querySelector('select[name="branch"]');
      const r = f.querySelector('select[name="room"]');
      return {
        open: !!(d && d.open),
        branch: String(fd.get('branch') ?? ''),
        room: String(fd.get('room') ?? ''),
        check_in: String(fd.get('check_in') ?? ''),
        check_out: String(fd.get('check_out') ?? ''),
        branchText: b.selectedOptions[0]?.textContent.trim() ?? '',
        roomText: r.selectedOptions[0]?.textContent.trim() ?? '',
        noReload: window.__noReload === true,
      };
    }, sel);

  /** Compare a form state with the expected values (FormData + visible option text). */
  function verify(label, s, exp) {
    checks++;
    const want = { branch: exp.branch ?? '', room: exp.room ?? '', check_in: exp.dates ? CHECK_IN : '', check_out: exp.dates ? CHECK_OUT : '' };
    const got = { branch: s.branch, room: s.room, check_in: s.check_in, check_out: s.check_out };
    const bad = Object.keys(want).filter((k) => want[k] !== got[k]);
    if (bad.length) fails.push(`${tag} ${label} @ ${here()}: submits ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    const bText = want.branch ? name(branchesJson.branches, want.branch, null, lang) : ui[lang].form.choose_branch;
    const rText = want.room ? name(ROOMS, want.room, want.branch, lang) : ui[lang].form.any_room;
    if (!bad.length && (s.branchText !== bText || s.roomText !== rText)) fails.push(`${tag} ${label} @ ${here()}: shows «${s.branchText}» / «${s.roomText}», expected «${bText}» / «${rText}»`);
  }

  /** Open the drawer from `loc` (first tap), check the prefill, close it. */
  async function openFrom(label, loc, exp) {
    step = label;
    if (!(await loc.count())) return fails.push(`${tag} ${label} @ ${here()}: entry point not found`);
    await loc.scrollIntoViewIfNeeded({ timeout: ACTION });
    // record whether the tap reaches the link: a tap that reached it and opened nothing is a site failure (the A1
    // bug); a tap that never reached it (the layout moved under the pointer on a slow, busy run) is retried once
    await loc.evaluate((a) => {
      a.__hit = false;
      a.addEventListener('click', () => (a.__hit = true), { once: true, capture: true });
    });
    const tapAndWait = async () => {
      await press(loc);
      return page.waitForFunction(() => document.querySelector('[data-booking-drawer]')?.classList.contains('is-open'), null, { timeout: 6000 }).then(() => true, () => false);
    };
    let opened = await tapAndWait();
    if (!opened && !(await loc.evaluate((a) => a.__hit).catch(() => true))) {
      notes.push(`${tag} ${label} @ ${here()}: the first tap did not reach the link (retried)`);
      opened = await tapAndWait();
    }
    const s = await formState('[data-booking-drawer] form');
    if (!opened || !s?.open) {
      const why = await page.evaluate(() => {
        const d = document.querySelector('[data-booking-drawer]');
        return { url: location.pathname + location.search, open: !!d?.open, isOpen: !!d?.classList.contains('is-open'), ready: !!d?.querySelector('form[data-booking-ready]'), drawerOpenEvents: (window.dataLayer || []).filter((e) => e && e.event === 'booking_drawer_open').length };
      });
      return fails.push(`${tag} ${label} @ ${here()}: the form did not open on the first tap ${JSON.stringify(why)}`);
    }
    verify(label, s, exp);
    if (exp.nav && !s.noReload) fails.push(`${tag} ${label} @ ${here()}: a full page reload happened`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-booking-drawer]')?.open && !document.documentElement.classList.contains('drawer-open'), null, { timeout: 4000 }).catch(() => fails.push(`${tag} ${label} @ ${here()}: the form did not close`));
  }

  /** Header button (menu link on phones) and footer link: they carry the page's booking context `c`. */
  const header = async (nav, c = {}) => {
    const href = bookHref(ctxQuery(c));
    if (!mobile) return openFrom('header', page.locator(`header a[href="${href}"]:visible`).first(), { ...c, nav });
    await press(page.locator('[data-menu-toggle]'));
    await page.locator('#mobile-nav:visible').waitFor({ timeout: 3000 });
    return openFrom('header menu', page.locator(`#mobile-nav a[href="${href}"]`), { ...c, nav });
  };
  const footer = (nav, c = {}) => openFrom('footer', page.locator(`footer a[href="${bookHref(ctxQuery(c))}"]`).first(), { ...c, nav });
  /** A copy of the page's own CTA whose link also carries the dates (no page link carries dates yet). */
  async function dated(label, cta, exp) {
    await cta.evaluate((a, dates) => {
      const c = a.cloneNode(true);
      c.setAttribute('href', a.getAttribute('href') + dates);
      c.setAttribute('data-test-dated', '');
      c.style.cssText = 'position:fixed;top:45%;inset-inline-start:16px;z-index:30';
      document.querySelector('main').append(c);
    }, DATES);
    await openFrom(label, page.locator('[data-test-dated]'), { ...exp, dates: true });
    await page.evaluate(() => document.querySelector('[data-test-dated]')?.remove());
  }

  async function branchPage(b, nav) {
    const cta = page.locator(`main a[href="${bookHref(`?branch=${b}`)}"]`).first();
    await openFrom('branch CTA', cta, { branch: b, nav });
    return cta;
  }
  async function roomPage(b, r, nav) {
    const cta = page.locator(`[data-book-card] a[href="${bookHref(`?branch=${b}&room=${r}`)}"]`);
    await openFrom('room CTA', cta, { branch: b, room: r, nav });
    if (mobile) {
      // the bottom bar slides up once the booking card has scrolled out above the viewport
      const bar = page.locator('[data-room-bar]');
      for (let i = 0; i < 40 && !(await page.locator('[data-room-bar].is-on').count()); i++) await page.mouse.wheel(0, 500), await page.waitForTimeout(80);
      if (!(await page.locator('[data-room-bar].is-on').count())) fails.push(`${tag} bottom bar @ ${here()}: never shown`);
      else {
        await page.waitForTimeout(500); // slide-up transition
        await openFrom('bottom bar', bar.locator(`a[href="${bookHref(`?branch=${b}&room=${r}`)}"]`), { branch: b, room: r, nav });
      }
    }
    return cta;
  }

  // ── 1. direct page loads ─────────────────────────────────────────────────────────────────────────────
  try {
    for (const path of OTHER_PAGES) {
      await page.goto(`${BASE}${L}${path}`, { waitUntil: 'load' });
      await header(false);
      await footer(false);
    }
    for (const b of BRANCHES) {
      await page.goto(`${BASE}${L}/${b}/`, { waitUntil: 'load' });
      const cta = await branchPage(b, false);
      await header(false, { branch: b });
      await footer(false, { branch: b });
      await dated('dated branch link', cta, { branch: b });
    }
    for (const r of SOLD_OUT) {
      await page.goto(`${BASE}${L}/${r.branch}/${r.slug}/`, { waitUntil: 'load' });
      if (await page.locator('main a[href*="/booking/?"]').count()) fails.push(`${tag} sold-out room @ ${here()}: has a booking CTA`);
      await header(false, { branch: r.branch });
      await footer(false, { branch: r.branch });
    }
    for (const r of ROOMS) {
      await page.goto(`${BASE}${L}/${r.branch}/${r.slug}/`, { waitUntil: 'load' });
      const cta = await roomPage(r.branch, r.slug, false);
      await header(false, { branch: r.branch, room: r.slug });
      await footer(false, { branch: r.branch, room: r.slug });
      await dated('dated room link', cta, { branch: r.branch, room: r.slug });
      // the /booking/ page itself, opened with the full query (BASE already carries the sub-path)
      const res = await page.goto(`${BASE}${L}/booking/?branch=${r.branch}&room=${r.slug}${DATES}`, { waitUntil: 'load' });
      // the page itself, never a 404 page (its drawer form would prefill from the same query)
      if (res?.status() !== 200 || (await page.locator('[data-booking-drawer]').count())) {
        fails.push(`${tag} /booking/ page @ ${here()}: HTTP ${res?.status()}, not the booking page`);
        continue;
      }
      await page.locator('form[data-booking-form][data-booking-ready] [data-daterange][data-bound]').waitFor({ state: 'attached', timeout: 8000 });
      verify('/booking/ page', await formState('form[data-booking-form]'), { branch: r.branch, room: r.slug, dates: true });
    }
  } catch (e) {
    fails.push(`${tag} direct loads aborted at ${here()} (${step}): ${String(e).split(/\r?\n/)[0].slice(0, 180)}`);
  }

  // ── 2. client-side navigation (ClientRouter, no reload) ──────────────────────────────────────────────
  let navs = 0;
  async function nav(path) {
    step = `link to ${path}`;
    const sel = `a[href="${PRE}${path}"]`;
    let link = page.locator(`main ${sel}:visible`).first();
    if (!(await link.count())) link = page.locator(`header ${sel}:visible`).first();
    if (!(await link.count())) throw new Error(`no link to ${path} on ${here()}`);
    await link.scrollIntoViewIfNeeded({ timeout: ACTION });
    const loads = await page.evaluate(() => window.__loads || 0);
    await press(link);
    await arrived(path, loads);
  }
  async function back(path) {
    step = `back to ${path}`;
    const loads = await page.evaluate(() => window.__loads || 0);
    await page.goBack();
    await arrived(path, loads);
  }
  async function arrived(path, loads) {
    await page.waitForURL((u) => u.pathname === PRE + path, { timeout: 8000 });
    await page.waitForFunction((n) => (window.__loads || 0) > n, loads, { timeout: 8000 });
    navs++;
  }
  try {
    await page.goto(`${BASE}${L}/`, { waitUntil: 'load' });
    await page.evaluate(() => (window.__noReload = true)); // a full reload would reset this marker
    await header(true);
    for (const b of BRANCHES) {
      await nav(`${L}/${b}/`);
      await branchPage(b, true);
      await header(true, { branch: b });
      await footer(true, { branch: b });
      for (const r of [...ROOMS, ...SOLD_OUT].filter((x) => x.branch === b)) {
        const bookable = r.availability !== 'sold_out';
        await nav(`${L}/${b}/${r.slug}/`);
        if (bookable) await roomPage(b, r.slug, true);
        await header(true, bookable ? { branch: b, room: r.slug } : { branch: b });
        await footer(true, bookable ? { branch: b, room: r.slug } : { branch: b });
        await back(`${L}/${b}/`);
        await header(true, { branch: b });
      }
      await nav(`${L}/`);
      await header(true);
      await footer(true);
    }
  } catch (e) {
    fails.push(`${tag} navigation aborted at ${here()} (${step}): ${String(e).split(/\r?\n/)[0].slice(0, 180)}`);
  }
  for (const e of new Set(errors)) fails.push(`${tag} console: ${e.slice(0, 160)}`);
  console.log(`${tag}: ${navs} client-side navigations`);
  await ctx.close();
}

/** Room select grouped by branch (Ahmed, 25 Oct 2026): with no branch chosen the list offers every bookable room under
    one optgroup per branch; picking a room selects its branch (a Shafa-only room → shafa-road, the Airport Road king
    room → airport-road, shared slug); a branch change that drops the chosen room clears it and shows a note. Asserts
    the submitted FormData at every step. */
async function groupedRooms(vp, lang) {
  const mobile = vp.width < 768;
  const L = lang === 'en' ? '/en' : '';
  const tag = `@${vp.width} ${lang} (grouped rooms)`;
  const ctx = await newContext(vp, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const state = () =>
    page.evaluate(() => {
      const f = document.querySelector('form[data-booking-form]');
      const fd = new FormData(f);
      const r = f.querySelector('select[name="room"]');
      const groups = Array.from(r.querySelectorAll('optgroup')).map((g) => ({ branch: g.dataset.branch, label: g.label, hidden: g.hidden || g.disabled, options: g.querySelectorAll('option').length }));
      const note = f.querySelector('[data-room-note]');
      return { branch: String(fd.get('branch') ?? ''), room: String(fd.get('room') ?? ''), groups, note: note && !note.classList.contains('hidden') ? note.textContent.trim() : '' };
    });
  const expect = (label, got, want) => {
    checks++;
    const bad = Object.keys(want).filter((k) => want[k] !== got[k]);
    if (bad.length) fails.push(`${tag} ${label}: ${JSON.stringify({ branch: got.branch, room: got.room, note: got.note })}, expected ${JSON.stringify(want)}`);
  };
  const shafaOnly = ROOMS.find((r) => r.branch === 'shafa-road' && !ROOMS.some((x) => x.branch === 'airport-road' && x.slug === r.slug));
  try {
    await page.goto(`${BASE}${L}/booking/`, { waitUntil: 'load' });
    await page.locator('form[data-booking-form][data-booking-ready]').waitFor({ state: 'attached', timeout: 8000 });
    let s = await state();
    checks++;
    const labels = BRANCHES.map((b) => ui[lang].branches?.[b]?.short ?? null);
    if (s.groups.length !== BRANCHES.length || s.groups.some((g) => g.hidden) || s.groups.reduce((n, g) => n + g.options, 0) !== ROOMS.length)
      fails.push(`${tag} no branch: groups ${JSON.stringify(s.groups)} — expected ${BRANCHES.length} visible groups with ${ROOMS.length} rooms`);
    void labels;
    // a Shafa-only room → shafa-road
    await page.locator('form[data-booking-form] select[name="room"]').selectOption(shafaOnly.slug);
    s = await state();
    expect(`pick ${shafaOnly.slug}`, s, { branch: 'shafa-road', room: shafaOnly.slug, note: '' });
    checks++;
    if (!s.groups.find((g) => g.branch === 'airport-road')?.hidden) fails.push(`${tag} after picking a Shafa room: the Airport Road group is still offered`);
    // back to no branch, then the Airport Road king room (shared slug) → airport-road
    await page.locator('form[data-booking-form] select[name="branch"]').selectOption('');
    s = await state();
    expect('branch cleared', s, { branch: '', room: shafaOnly.slug, note: '' });
    await page.locator('form[data-booking-form] select[name="room"]').selectOption({ label: name(ROOMS, 'king-room', 'airport-road', lang) });
    s = await state();
    expect('pick Airport Road king room', s, { branch: 'airport-road', room: 'king-room', note: '' });
    // branch → Shafa Road keeps the shared slug (Shafa has a king room), no note
    await page.locator('form[data-booking-form] select[name="branch"]').selectOption('shafa-road');
    s = await state();
    expect('branch → shafa-road keeps king-room', s, { branch: 'shafa-road', room: 'king-room', note: '' });
    // a Shafa-only room, then branch → Airport Road: the room is dropped with the note
    await page.locator('form[data-booking-form] select[name="room"]').selectOption(shafaOnly.slug);
    await page.locator('form[data-booking-form] select[name="branch"]').selectOption('airport-road');
    s = await state();
    expect('branch → airport-road drops a Shafa-only room', s, { branch: 'airport-road', room: '', note: ui[lang].form.room_cleared });
    // «أي غرفة متاحة» stays available with a branch
    checks++;
    if ((await page.locator('form[data-booking-form] select[name="room"] option[value=""]').count()) !== 1) fails.push(`${tag}: the «any room» option is missing`);
  } catch (e) {
    fails.push(`${tag} aborted: ${String(e).split(/\r?\n/)[0].slice(0, 180)}`);
  }
  for (const e of new Set(errors)) fails.push(`${tag} page error: ${e.slice(0, 160)}`);
  void mobile;
  await ctx.close();
}

/** The booking form's script fails on the first page; after client-side navigation a room CTA (shared slug) must
    load the booking page in full, prefilled from its URL. */
async function failedScript(vp, lang) {
  const mobile = vp.width < 768;
  const L = lang === 'en' ? '/en' : '';
  const tag = `@${vp.width} ${lang} (form script failed)`;
  const ctx = await newContext(vp, lang);
  let aborted = 0;
  await ctx.route(/\/_astro\/BookingForm[^/]*\.js(\?|$)/, (r) => (aborted++ ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const press = (loc) => (mobile ? loc.tap({ timeout: ACTION }) : loc.click({ timeout: ACTION }));
  const go = async (path) => {
    const link = page.locator(`main a[href="${PRE}${path}"]:visible`).first();
    await link.scrollIntoViewIfNeeded({ timeout: ACTION });
    await press(link);
    await page.waitForURL((u) => u.pathname === PRE + path, { timeout: 8000 });
    await page.waitForTimeout(600);
  };
  try {
    await page.goto(`${BASE}${L}/`, { waitUntil: 'load' });
    if (aborted !== 1) throw new Error(`the form script was requested ${aborted} times on the first page`);
    await go(`${L}/shafa-road/`);
    await go(`${L}/shafa-road/king-room/`);
    const cta = page.locator(`[data-book-card] a[href="${PRE}${L}/booking/?branch=shafa-road&room=king-room"]`);
    await cta.scrollIntoViewIfNeeded({ timeout: ACTION });
    await press(cta);
    await page.waitForURL((u) => u.pathname === `${PRE}${L}/booking/`, { timeout: 8000 });
    await page.locator('form[data-booking-form][data-booking-ready]').waitFor({ state: 'attached', timeout: 8000 });
    checks++;
    const s = await page.evaluate(() => {
      const fd = new FormData(document.querySelector('form[data-booking-form]'));
      return { branch: String(fd.get('branch') ?? ''), room: String(fd.get('room') ?? '') };
    });
    if (s.branch !== 'shafa-road' || s.room !== 'king-room') fails.push(`${tag}: /booking/ submits ${s.branch}/${s.room}, expected shafa-road/king-room`);
  } catch (e) {
    fails.push(`${tag} aborted at ${new URL(page.url()).pathname}: ${String(e).split(/\r?\n/)[0].slice(0, 180)}`);
  }
  for (const e of new Set(errors)) fails.push(`${tag} page error: ${e.slice(0, 160)}`);
  await ctx.close();
}

// the runs are independent; run them side by side
await Promise.all([
  ...[{ width: 1440, height: 900 }, { width: 375, height: 812 }].flatMap((vp) => ['ar', 'en'].map((lang) => run(vp, lang))),
  failedScript({ width: 1440, height: 900 }, 'ar'),
  failedScript({ width: 375, height: 812 }, 'en'),
  groupedRooms({ width: 1440, height: 900 }, 'ar'),
  groupedRooms({ width: 375, height: 812 }, 'en'),
]);
await browser.close();

for (const n of new Set(notes)) console.log('note: ' + n);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of [...new Set(fails)]) console.log('  - ' + f);
  process.exit(1);
}
console.log(`✓ booking prefill: ${checks} checks — ${BRANCHES.length} branches, ${ROOMS.length} rooms + ${SOLD_OUT.length} sold-out, ${OTHER_PAGES.length} other pages, AR + EN, 1440 + 375, direct loads and client-side navigation`);
