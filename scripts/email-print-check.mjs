// Internal emails print on ONE A4 page (task 5 B, Ahmed 28 Oct 2026). Renders every email sent to reception / sales /
// management — booking request, confirmed booking (instant and from the dashboard), partner enquiry, low-inventory
// alert — with the REAL layout (email.ts, Node type stripping), every field filled and the notes at the form's maximum
// length (1000 characters, rules.ts / the partner form), then:
//   Chromium — prints to an A4 PDF with the email's own @page rule and counts the pages (must be 1); every visible
//              text in print media is at least 12 px (9 pt); the print header is white with the bronze logo
//   WebKit   — Playwright has no WebKit PDF: the print-media layout at the A4 printable width (190 mm) must fit the
//              printable height (277 mm), the same measure Safari paginates by
// Also: the guest emails carry no print stylesheet (unchanged), and each internal email's screen rendering at 600 px is
// the same with or without it (the print CSS only acts in print media). Static, no network (the logos load from
// public/). If the notes cannot fit at 9 pt, the check reports the longest length that does.
//   node scripts/email-print-check.mjs
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bookingConfirmation, bookingConfirmed, bookingNotification, confirmedNotification, lowInventoryAlert, partnerNotification } from '../supabase/functions/booking-request/email.ts';

const content = JSON.parse(readFileSync('supabase/functions/booking-request/content.generated.json', 'utf8'));
content.email_logo_url = pathToFileURL(resolve('public/email/armada-residence-logo-reversed@2x.png')).href;

const NOTES_MAX = 1000;
const MM = 96 / 25.4;
const PRINT_W = Math.floor(190 * MM); // A4 210 mm − 2 × 10 mm
const PRINT_H = Math.floor(277 * MM); // A4 297 mm − 2 × 10 mm

const notesOf = (n) => {
  const s = 'نصل متأخرين بعد منتصف الليل تقريبًا، ونرجو تجهيز سرير أطفال وغرفة بعيدة عن المصعد إن أمكن، مع موقف قريب للسيارة. ';
  return s.repeat(Math.ceil(n / s.length)).slice(0, n);
};
const nightsList = (from, n, prices) => Array.from({ length: n }, (_, i) => ({ night: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10), price: prices[i % prices.length], label: i % 7 === 4 ? 'عطلة نهاية الأسبوع' : null }));

const booking = (notes) => ({
  ref: 'AR-20261028-PRNT', locale: 'ar', branch: 'airport-road', room: 'two-bedroom-suite', check_in: '2026-11-02', check_out: '2026-11-09', nights: 7,
  adults: 6, children: 3, extraBeds: 2, extraBedFee: 50, needsCoordination: true, capacity: 4, breakfast: 'with',
  name: 'عبدالرحمن بن عبدالعزيز آل عبدالله الأنصاري', phone: '+966500000000', email: 'abdulrahman.alansari.family@example.com', notes, receivedAt: '2026-10-28 23:59 (Asia/Riyadh)',
});
const quote = (n) => {
  const nights = nightsList('2026-11-02', n, [240, 240, 240, 240, 290, 290, 240]);
  const room_total = nights.reduce((s, x) => s + x.price, 0);
  return { nights, count: n, room_total, breakfast: 'with', breakfast_total: 9 * 20 * n, extra_beds: 2, extra_bed_fee: 50, extra_beds_total: 100 * n, total: room_total + 180 * n + 100 * n };
};
const partner = (notes) => ({
  ref: 'AR-20261028-PRTN', locale: 'ar', requestType: 'umrah-group', organisation: 'شركة الرحلات المباركة للسفر والسياحة وخدمات المعتمرين', branch: 'both',
  check_in: '2026-11-10', check_out: '2026-11-24', nights: 14, guests: 240, rooms: 120, meals: 'breakfast', name: 'عبدالرحمن بن عبدالعزيز آل عبدالله الأنصاري',
  phone: '+966500000000', email: 'groups.reservations.department@example.com', notes, receivedAt: '2026-10-28 23:59 (Asia/Riyadh)',
});

/** The internal emails at a given notes length (the confirmed one at the stay length the instant limit allows). */
const internal = (n, stay = 7) => [
  ['booking-notification', bookingNotification(content, booking(notesOf(n)))],
  ['confirmed-notification (website)', confirmedNotification(content, { ...booking(notesOf(n)), nights: stay, check_out: nightsList('2026-11-02', stay + 1, [0]).at(-1).night, quote: quote(stay), confirmedBy: null })],
  ['confirmed-notification (dashboard)', confirmedNotification(content, { ...booking(notesOf(n)), nights: stay, check_out: nightsList('2026-11-02', stay + 1, [0]).at(-1).night, quote: quote(stay), confirmedBy: 'استقبال طريق المطار' })],
  ['partner-notification', partnerNotification(content, partner(notesOf(n)))],
  ['low-inventory', lowInventoryAlert(content, { ref: 'AR-20261028-PRNT', branch: 'airport-road', room: 'two-bedroom-suite', nights: nightsList('2026-11-02', 30, [0]).map((x, i) => ({ night: x.night, left: i % 2 })) })],
];

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const pages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

const cr = await chromium.launch({ channel: 'chrome' });
const wk = await webkit.launch();
const cPage = await cr.newPage();
const wPage = await wk.newPage({ viewport: { width: PRINT_W, height: PRINT_H } });
await wPage.emulateMedia({ media: 'print' });

async function chromiumPages(html) {
  await cPage.setContent(html, { waitUntil: 'load' });
  return pages(await cPage.pdf({ preferCSSPageSize: true }));
}
async function webkitHeight(html) {
  await wPage.setContent(html, { waitUntil: 'load' });
  return wPage.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
}

const t0 = Date.now();
// ── 1. every internal email, every field filled, notes at the maximum ──
const STAY = 30; // the instant limit's default (Settings → instant_limits): the longest per-night list a confirmation carries
let notesFit = NOTES_MAX;
for (const [kind, mail] of internal(NOTES_MAX, STAY)) {
  check(mail.html.includes('@media print'), `${kind}: carries the print stylesheet`);
  const p = await chromiumPages(mail.html);
  const h = await webkitHeight(mail.html);
  check(p === 1, `${kind}: Chromium A4 PDF has ${p} pages (notes ${NOTES_MAX}, ${STAY} nights)`);
  check(h <= PRINT_H, `${kind}: WebKit print layout ${h}px > A4 printable ${PRINT_H}px`);
  if (p !== 1 || h > PRINT_H) {
    // find the longest notes that still fit, for the report
    let lo = 0;
    let hi = NOTES_MAX;
    const builder = internal; // rebuild at each length
    const idx = internal(0, STAY).findIndex(([k]) => k === kind);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const html = builder(mid, STAY)[idx][1].html;
      if ((await chromiumPages(html)) === 1 && (await webkitHeight(html)) <= PRINT_H) lo = mid;
      else hi = mid - 1;
    }
    notesFit = Math.min(notesFit, lo);
  }
  // print media in Chromium: white header with the bronze logo, no text below 12 px, buttons left out
  await cPage.setContent(mail.html, { waitUntil: 'load' });
  await cPage.emulateMedia({ media: 'print' });
  const pr = await cPage.evaluate(() => {
    const hdr = document.querySelector('.hdr');
    const vis = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0; };
    const small = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent.trim() || !vis(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) small.push(`${fs}px «${n.textContent.trim().slice(0, 30)}»`);
    }
    return {
      hdrBg: hdr ? getComputedStyle(hdr).backgroundColor : null,
      screenLogo: hdr ? vis(hdr.querySelector('.screen-logo')) : null,
      printLogo: hdr ? vis(hdr.querySelector('.print-logo')) && /armada-residence-logo@2x\.png$/.test(hdr.querySelector('.print-logo').src) : null,
      buttons: Array.from(document.querySelectorAll('.stack')).filter(vis).length,
      small,
      bands: Array.from(document.querySelectorAll('td, table, body, span')).filter((el) => vis(el) && !/^rgba?\(255, 255, 255|rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(el).backgroundColor)).length,
    };
  });
  await cPage.emulateMedia({ media: null }); // back to the default (page.pdf prints in print media)
  check(pr.hdrBg === 'rgb(255, 255, 255)' && !pr.screenLogo && pr.printLogo, `${kind}: print header white with the bronze logo`, JSON.stringify(pr));
  check(pr.buttons === 0, `${kind}: action buttons left out of the print`);
  check(pr.small.length === 0, `${kind}: text below 9 pt in print`, pr.small.slice(0, 3).join(', '));
  check(pr.bands === 0, `${kind}: a coloured background remains in print`, String(pr.bands));
}

// ── 2. screen unchanged: the internal emails look the same at 600 px with and without the print CSS; guest emails carry none ──
const shot = async (html) => {
  await cPage.setViewportSize({ width: 600, height: 900 });
  await cPage.setContent(html, { waitUntil: 'load' });
  return cPage.screenshot({ fullPage: true });
};
for (const [kind, mail] of internal(200, 7).slice(0, 1)) {
  const noPrint = mail.html
    .replace(/\n  \.print-logo \{ display:none; \}[\s\S]*?\n  \}(?=\n<\/style>)/, '')
    .replace(/<!--\[if !mso\]><!--><img[^>]*class="print-logo"[^>]*><!--<!\[endif\]-->/, '');
  const a = await shot(mail.html);
  const b = await shot(noPrint);
  check(noPrint !== mail.html && Buffer.compare(a, b) === 0, `${kind}: screen rendering changed by the print stylesheet`);
}
const g1 = bookingConfirmation(content, booking('—'));
const g2 = bookingConfirmed(content, { ...booking('—'), quote: quote(7), confirmedBy: null });
check(!g1.html.includes('@media print') && !g2.html.includes('print-logo'), 'guest emails carry no print stylesheet');

await cr.close();
await wk.close();
console.log(`${checks} checks in ${Math.round((Date.now() - t0) / 1000)}s`);
if (notesFit < NOTES_MAX) console.log(`notes: the longest length that fits one A4 page at ≥ 9 pt is ${notesFit} characters (maximum ${NOTES_MAX})`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`✓ internal emails print on one A4 page (Chromium PDF + WebKit print layout; notes ${NOTES_MAX} characters, ${STAY}-night price list, ≥ 9 pt)`);
