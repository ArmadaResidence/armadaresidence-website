// The dashboard's printouts as PDFs (Ahmed, 5 Nov 2026 — «التقارير» printed 12 A4 pages, some blank but for Chrome's own
// header and footer). On a PREVIEW BRANCH with the QA users (refuses the production project), against the dashboard:
//   - fixtures (non-test rows, the branch only): confirmed bookings across the last 120 days, requests, a cancellation,
//     a partner enquiry, inventory — enough for every section of «التقارير» to carry data;
//   - «التقارير» printed by Chrome (page.pdf with the browser's own header / footer switched ON, as the print dialog does
//     by default) for the default period (30 days) and a long one (90 days + the same period last year): every page
//     carries report content (not just our header / footer), the page count stays in a sensible range, no URL anywhere
//     (no http, no admin address, no localhost), our header (logo, «تقرير الأداء», the period, the comparison, the branch)
//     and footer («طُبع في …» + «للاستخدام الداخلي») on every page, every section printed with its charts and tables;
//   - the booking print sheet («طباعة» in a booking's details): one A4 page, no URL;
//   - every PDF page rendered with pdf.js in Chromium → screenshots/print/<name>-p<N>.png.
//   node admin/tests/print-check.mjs [BASE_URL=http://127.0.0.1:5173]
//   env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (the branch), BOOKING_TEST_TOKEN, LOGIN_CODE_VIA_SERVICE=1;
//   PDFJS_DIR = a folder holding node_modules/pdfjs-dist (the default: the admin's own node_modules)
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE || !env.BOOKING_TEST_TOKEN) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY of the preview branch and BOOKING_TEST_TOKEN are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const PDFJS = (() => {
  const base = env.PDFJS_DIR ? createRequire(join(env.PDFJS_DIR, 'package.json')) : createRequire(import.meta.url);
  return join(base.resolve('pdfjs-dist/package.json'), '..', 'legacy', 'build');
})();
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};
const SHOTS = 'screenshots/print';
mkdirSync(SHOTS, { recursive: true });
let checks = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const riyadh = (d = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(Date.now() + d * 86400000));
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

// ── fixtures (this branch only) ──
const staff = await rest('staff?select=user_id,role,full_name,branch&active=eq.true');
const admin = staff.find((s) => s.role === 'admin');
for (const s of ['overview', 'reports', 'finance']) await rest(`staff_permissions?user_id=eq.${admin.user_id}&section=eq.${s}`, { method: 'PATCH', body: JSON.stringify({ level: 'view' }) });
await rest('reservations?ref=like.AR-29991231-P*', { method: 'DELETE' });
const types = await rest('room_types?select=id,branch,slug&active=eq.true&bookable=eq.true&is_test=eq.false&order=branch,sort');
const air = types.filter((t) => t.branch === 'airport-road');
const sha = types.filter((t) => t.branch === 'shafa-road');
await rest(`inventory_days?night=gte.${riyadh(-125)}&night=lte.${riyadh(10)}`, { method: 'DELETE' });
const inv = [];
const mod = (x, n) => ((x % n) + n) % n;
for (const t of types) for (let d = -125; d <= 10; d++) inv.push({ room_type_id: t.id, night: riyadh(d), booked: mod(d * 7 + t.slug.length, 4), rooms_to_sell: 3 + mod(d + t.slug.length, 3), stop_sell: false });
for (let i = 0; i < inv.length; i += 500) await rest('inventory_days', { method: 'POST', body: JSON.stringify(inv.slice(i, i + 500)) });
let n = 0;
const resv = async (t, status, ci, co, createdAt, extra = {}) => {
  const ref = `AR-29991231-P${String(++n).padStart(3, '0')}`;
  const [r] = await rest('reservations', { method: 'POST', body: JSON.stringify({
    ref, status, confirmation: status === 'confirmed' ? 'staff' : null, source: 'website', branch: t.branch, room_type_id: t.id,
    check_in: riyadh(ci), check_out: riyadh(co), adults: 2, children: n % 3, extra_beds: 0, breakfast: n % 2 ? 'with' : 'without', guest_name: 'ضيف تجربة الطباعة',
    phone: `+96650091${String(n).padStart(4, '0')}`, locale: n % 4 ? 'ar' : 'en', is_test: false, created_at: createdAt,
    total: status !== 'request' ? 280 * (co - ci) : null, confirmed_at: status !== 'request' ? createdAt : null, ...extra,
  }) });
  await rest('reservation_status_history', { method: 'POST', body: JSON.stringify({ reservation_id: r.id, from_status: null, to_status: status, at: createdAt, actor_label: 'website' }) });
  if (status !== 'request') {
    const nights = [];
    for (let d = ci; d < co; d++) nights.push({ reservation_id: r.id, night: riyadh(d), room_type_id: t.id, price: 280 + mod(d, 5) * 15 });
    await rest('reservation_nights', { method: 'POST', body: JSON.stringify(nights) });
  }
  return r;
};
const SRC = [{ utm_source: 'instagram', utm_campaign: 'winter' }, { gclid: true, landing: '/' }, { utm_source: 'snapchat', utm_campaign: 'umrah' }, { referrer: 'google.com' }, {}];
for (let d = -118; d <= -2; d += 3) {
  const t = [...air, ...sha][Math.abs(d) % types.length];
  await resv(t, 'confirmed', d, d + 1 + (Math.abs(d) % 3), ago(-d * 24 + 30), { visit: SRC[Math.abs(d) % SRC.length] });
}
const cancelled = await resv(air[0], 'confirmed', -20, -18, ago(30 * 24));
await rest(`reservations?id=eq.${cancelled.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', cancelled_at: ago(25 * 24), cancel_reason: 'طلب الضيف' }) });
await resv(sha[0], 'request', 4, 6, ago(3), { needs_coordination: true });
const booking = await resv(air[0], 'confirmed', 2, 5, ago(10), { notes: 'ملاحظة للاستقبال: الوصول متأخرًا بعد منتصف الليل.' });

// ── the browser ──
const browser = await chromium.launch({ channel: 'chrome' });
async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  const page = await ctx.newPage();
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

/** a PDF read and rendered by pdf.js in Chromium: per page its text and a PNG */
async function readPdf(ctx, pdf, name) {
  const viewer = await ctx.newPage();
  await viewer.route('https://pdfjs.local/**', (r) => {
    const f = r.request().url().replace('https://pdfjs.local/', '');
    r.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(join(PDFJS, f)) });
  });
  await viewer.setContent('<!doctype html><html><body style="margin:0;background:#888"></body></html>');
  const pages = await viewer.evaluate(async (b64) => {
    const lib = await import('https://pdfjs.local/pdf.mjs');
    lib.GlobalWorkerOptions.workerSrc = 'https://pdfjs.local/pdf.worker.mjs';
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await lib.getDocument({ data, useSystemFonts: true }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      const vp = p.getViewport({ scale: 1.1 });
      const c = document.createElement('canvas');
      c.width = vp.width;
      c.height = vp.height;
      c.style.display = 'block';
      c.style.margin = '8px';
      document.body.appendChild(c);
      await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const ops = await p.getOperatorList();
      out.push({ text: tc.items.map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim(), items: tc.items.map((x) => ({ s: x.str, y: x.transform[5], h: Math.abs(x.transform[3]) })), size: [p.view[2], p.view[3]], ops: ops.fnArray.length, png: c.toDataURL('image/png') });
    }
    return out;
  }, Buffer.from(pdf).toString('base64'));
  pages.forEach((p, i) => writeFileSync(join(SHOTS, `${name}-p${i + 1}.png`), Buffer.from(p.png.split(',')[1], 'base64')));
  await viewer.close();
  return pages;
}

// pdf.js gives right-to-left text in visual order and in presentation forms: normalise (NFKC, no diacritics) and read it
// both ways when looking for an Arabic phrase
const norm = (t) => t.normalize('NFKC').replace(/[ً-ْـ]/g, '').replace(/\s+/g, '');
const bag = (t) => [...norm(t)].reduce((m, ch) => m.set(ch, (m.get(ch) ?? 0) + 1), new Map());
/** the letters of `phrase` are all among the given items' (pdf.js mixes the order of right-to-left glyphs) */
const hasLetters = (items, phrase) => {
  const have = bag(items.map((x) => x.s).join(''));
  for (const [ch, n] of bag(phrase)) if ((have.get(ch) ?? 0) < n) return false;
  return true;
};
const has = (page, phrase) => hasLetters(page.items, phrase);
// the bands of a landscape page (pt, from the bottom): our running header on top, our footer + the page number at the foot
const top = (p) => p.items.filter((x) => x.s.trim() && x.y > p.size[1] - 70);
const foot = (p) => p.items.filter((x) => x.s.trim() && x.y < 70);
const URL_RE = /https?:\/\/|localhost|127\.0\.0\.1|admin\.armadaresidence|armadaresidence-admin|\.github\.io|\/reports\b/i;
try {
  const { ctx, page } = await login('admin@qa.invalid');
  for (const run of [
    // at least one page per section (each starts a page); at most what the tables of the period can fill
    { name: 'reports-30', period: '30', cmp: 'previous', min: 5, max: 13 },
    { name: 'reports-90', period: '90', cmp: 'last_year', min: 5, max: 18 },
  ]) {
    await page.goto(`${BASE}/reports`);
    await page.waitForSelector('[data-section="club"]', { timeout: 30000 });
    await page.selectOption('[data-period]', run.period);
    await page.selectOption('[data-compare]', run.cmp);
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => document.querySelectorAll('[data-section] .skeleton, [aria-busy="true"]').length === 0, null, { timeout: 30000 }).catch(() => {});
    const header = await page.evaluate(() => document.querySelector('[data-report-scope]')?.textContent ?? '');
    // as the print dialog does by default: Chrome's own header and footer ON (date, title, URL, page numbers)
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true });
    writeFileSync(join(SHOTS, `${run.name}.pdf`), pdf);
    const pages = await readPdf(ctx, pdf, run.name);
    const landscape = pages.every((p) => Math.abs(p.size[0] - 841.89) < 2 && Math.abs(p.size[1] - 595.28) < 2);
    check(landscape, `${run.name}: every page A4 landscape`, pages.map((p) => p.size.map(Math.round).join('×')).join(' '));
    check(pages.length >= run.min && pages.length <= run.max, `${run.name}: a sensible page count (${run.min}–${run.max})`, String(pages.length));
    // a page is real when it holds report text in its body — between our running header (top 80 pt) and footer (bottom 80 pt)
    const body = pages.map((p, i) => ({ i: i + 1, n: p.items.filter((x) => x.s.trim() && x.y > 80 && x.y < p.size[1] - 85).length }));
    const blank = body.filter((x) => x.n < 5);
    check(blank.length === 0, `${run.name}: no blank page — every page carries report content in its body`, JSON.stringify(body));
    const urls = pages.map((p, i) => [i + 1, (p.text.match(URL_RE) || [])[0]]).filter(([, m]) => m);
    check(urls.length === 0, `${run.name}: no URL printed (ours or the browser's)`, JSON.stringify(urls));
    const year = (header.match(/20\d\d/) || [''])[0];
    const heads = pages.map((p, i) => ({ i: i + 1, head: hasLetters(top(p), 'تقرير الأداء الفترة المقارنة الفرع') && top(p).some((x) => x.s.includes(year)),
      // the last page: our footer follows the content (the table footer of the last fragment), wherever that ends
      foot: ((f) => hasLetters(f, 'طبع في للاستخدام الداخلي بتوقيت الرياض') && f.some((x) => /\d{2}:\d{2}/.test(x.s)))(i === pages.length - 1 ? p.items.filter((x) => x.y < p.size[1] - 70) : foot(p)) }));
    check(heads.every((h) => h.head), `${run.name}: our header (logo, «تقرير الأداء», the period, the comparison, the branch) on every page`, JSON.stringify(heads.filter((h) => !h.head)));
    check(heads.every((h) => h.foot), `${run.name}: our footer («طُبع في» + the Riyadh time, «للاستخدام الداخلي») on every page`, JSON.stringify(heads.filter((h) => !h.foot)));
    check(pages.every((p, i) => foot(p).some((x) => x.s.includes(String(pages.length))) && hasLetters(foot(p), 'صفحة من')), `${run.name}: «صفحة N من M» on every page (Chrome page margin box)`);
    // in print media every section, chart and table is laid out (nothing left hidden by scroll, reveal or animation)
    await page.emulateMedia({ media: 'print' });
    const laid = await page.evaluate(() => {
      const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.99; };
      const secs = [...document.querySelectorAll('.reports [data-section]')];
      const charts = [...document.querySelectorAll('.reports [data-chart]')];
      const tables = [...document.querySelectorAll('.reports [data-viz-table]')];
      const anim = [...document.querySelectorAll('.reports *')].filter((el) => getComputedStyle(el).animationName !== 'none').length;
      return { sections: secs.length, secShown: secs.filter(shown).length, charts: charts.length, chartsShown: charts.filter(shown).length, tables: tables.length, tablesShown: tables.filter(shown).length, anim };
    });
    await page.emulateMedia({ media: null });
    check(laid.sections === 5 && laid.secShown === 5 && laid.chartsShown === laid.charts && laid.charts >= 5 && laid.tablesShown === laid.tables && laid.anim === 0,
      `${run.name}: in print every section, chart and table renders in full, with no animation`, JSON.stringify(laid));
    // a section starts a page: the first line under our header is a section heading (15 pt; the page title is 18 pt)
    const firstLine = pages.map((p) => { const body = p.items.filter((x) => x.s.trim() && x.y < p.size[1] - 70 && x.y > 70); const yTop = Math.max(...body.map((x) => x.y)); return body.filter((x) => Math.abs(x.y - yTop) < 2); });
    const starts = firstLine.map((l, i) => (l.some((x) => x.h >= 13.5 && x.h <= 16.5) ? i + 1 : 0)).filter(Boolean);
    const named = ['سلوك الحجز', 'المصادر والحملات', 'الإلغاء والرد', 'إياب والشركاء'].map((t) => starts.find((n) => hasLetters(firstLine[n - 1], t)) ?? 0);
    check(firstLine[0].some((x) => x.h > 16.5) && starts.length === 4 && named.every((n, i) => n > 0 && (i === 0 || n > named[i - 1])),
      `${run.name}: the report opens page 1 and each other section starts a page of its own, in order`, `starts ${starts.join(',')} · sections ${named.join(',')}`);
    console.log(`   ${run.name}: ${pages.length} page(s) → ${SHOTS}/${run.name}-p*.png`);
  }
  // the booking print sheet
  await page.goto(`${BASE}/bookings?ref=${booking.ref}`);
  await page.waitForSelector('[data-action="print"]', { timeout: 30000 }).catch(() => {});
  if (await page.locator('[data-action="print"]').count()) {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true });
    writeFileSync(join(SHOTS, 'booking-sheet.pdf'), pdf);
    const pages = await readPdf(ctx, pdf, 'booking-sheet');
    check(pages.length === 1, 'booking sheet: one A4 page', String(pages.length));
    check(!URL_RE.test(pages[0]?.text ?? ''), 'booking sheet: no URL printed');
    check((pages[0]?.text ?? '').includes(booking.ref) && has(pages[0], 'توقيع الضيف') && has(pages[0], 'توقيع موظف الاستقبال'), 'booking sheet: the ref and both signature blocks');
  } else {
    check(false, 'booking sheet: the booking details opened (print button)');
  }
  await ctx.close();
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split(/\r?\n/).slice(0, 4).join(' ')}`);
} finally {
  await browser.close();
  await rest('reservations?ref=like.AR-29991231-P*', { method: 'DELETE' }).catch(() => {});
}
console.log(`\n${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
