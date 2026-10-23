// Email logo (23 Oct 2026): email clients cannot show SVG, so the approved horizontal logo
// (public/brand/logo-horizontal.svg, bronze, transparent) is rasterised unchanged to a 2× PNG for the emails only.
// Displayed at 180 px wide in the email header band → 360 px PNG. The website itself keeps the SVG logos.
// Exception recorded in DECISIONS.md and CLAUDE.md §3 (logos are SVG only on the site).
//   node scripts/email-logo.mjs
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';

const SRC = 'public/brand/logo-horizontal.svg';
const OUT = 'public/email/armada-residence-logo@2x.png';
mkdirSync('public/email', { recursive: true });
const png = await sharp(readFileSync(SRC), { density: 600 })
  .resize({ width: 360, fit: 'inside' })
  .png({ compressionLevel: 9 })
  .toFile(OUT);
console.log(`${OUT} (${png.width}×${png.height}, transparent, from ${SRC})`);
