// Email previews (Part C, 23 Oct 2026): renders the four booking-request emails with the REAL layout
// (supabase/functions/booking-request/email.ts, loaded by Node's type stripping) and the generated content, then
// screenshots each at 600 px and 375 px, light and dark (prefers-color-scheme), with Playwright.
// Sample data only (clearly marked «تجربة» / test). The logo loads from public/ so the preview works before deploy.
//   node scripts/email-preview.mjs            → screenshots/email/*.png + *.html, and a .txt with each text part
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bookingConfirmation, bookingNotification, partnerConfirmation, partnerNotification } from '../supabase/functions/booking-request/email.ts';

const content = JSON.parse(readFileSync('supabase/functions/booking-request/content.generated.json', 'utf8'));
content.email_logo_url = pathToFileURL(resolve('public/email/armada-residence-logo@2x.png')).href;

const OUT = 'screenshots/email';
mkdirSync(OUT, { recursive: true });

const booking = {
  ref: 'AR-20261023-TEST',
  locale: 'ar',
  branch: 'airport-road',
  room: 'one-bedroom-suite',
  check_in: '2026-11-02',
  check_out: '2026-11-05',
  nights: 3,
  adults: 2,
  children: 1,
  breakfast: 'with',
  name: 'تجربة النظام',
  phone: '+966500000000',
  email: 'guest@example.com',
  notes: 'TEST — ignore',
  receivedAt: '2026-10-23 14:05 (Asia/Riyadh)',
};
const partner = {
  ref: 'AR-20261023-PTST',
  locale: 'ar',
  requestType: 'umrah-group',
  organisation: 'شركة تجربة للسفر',
  branch: 'both',
  check_in: '2026-11-10',
  check_out: '2026-11-13',
  nights: 3,
  guests: 40,
  rooms: 20,
  meals: 'breakfast',
  name: 'تجربة النظام',
  phone: '+966500000000',
  email: 'partner@example.com',
  notes: 'TEST — ignore',
  receivedAt: '2026-10-23 14:07 (Asia/Riyadh)',
};

const mails = {
  'booking-notification': bookingNotification(content, booking),
  'booking-confirmation': bookingConfirmation(content, booking),
  'booking-notification-no-email': bookingNotification(content, { ...booking, email: '' }),
  'partner-notification': partnerNotification(content, partner),
  'partner-confirmation': partnerConfirmation(content, partner),
};

const browser = await chromium.launch({ channel: 'chrome' });
const shots = [];
for (const [name, mail] of Object.entries(mails)) {
  writeFileSync(`${OUT}/${name}.html`, mail.html);
  writeFileSync(`${OUT}/${name}.txt`, `Subject: ${mail.subject}\n\n${mail.text}\n`);
  if (!mail.text || mail.text.trim().length < 40) throw new Error(`${name}: text/plain part is empty`);
  for (const width of name.endsWith('no-email') ? [600] : [600, 375]) {
    for (const scheme of name.endsWith('no-email') ? ['light'] : ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(resolve(`${OUT}/${name}.html`)).href, { waitUntil: 'load' });
      const file = `${OUT}/${name}-${width}-${scheme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      shots.push(file);
      await ctx.close();
    }
  }
}
await browser.close();
console.log(`${shots.length} screenshots in ${OUT}/`);
for (const [name, mail] of Object.entries(mails)) console.log(`  ${name}: "${mail.subject}" — html ${mail.html.length} B, text ${mail.text.length} B`);
