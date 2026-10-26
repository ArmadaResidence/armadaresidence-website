// Email logos. Email clients cannot show SVG, so the approved horizontal logo (public/brand/logo-horizontal.svg) is
// rasterised to 2× PNGs for the emails only; the website itself keeps the SVG logos (CLAUDE.md §3).
//   armada-residence-logo@2x.png           bronze, transparent, unchanged artwork (23 Oct 2026) — kept so emails already
//                                          sent keep their image
//   armada-residence-logo-reversed@2x.png  the header logo of every email since 26 Oct 2026 (Ahmed: the bronze wordmark
//                                          was barely legible on the navy band): the same artwork with the wordmark in
//                                          Warm Porcelain #F3EFE7 and the mark (the five arch paths) in Armada Bronze
//                                          #A97C50 — colours only, no shape changed
// Displayed at 180 × 41 in the email header band → 360 px PNGs.
//   node scripts/email-logo.mjs
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';

const SRC = 'public/brand/logo-horizontal.svg';
const BRONZE = '#A97C50';
const PORCELAIN = '#F3EFE7';
mkdirSync('public/email', { recursive: true });
const svg = readFileSync(SRC, 'utf8');

async function render(source, out) {
  const png = await sharp(Buffer.from(source), { density: 600 }).resize({ width: 360, fit: 'inside' }).png({ compressionLevel: 9 }).toFile(out);
  console.log(`${out} (${png.width}×${png.height}, transparent, from ${SRC})`);
}

await render(svg, 'public/email/armada-residence-logo@2x.png');

// reversed: the mark is the group of paths right of the wordmark (their first x ≥ 515 in the artwork's viewBox)
const open = svg.indexOf(`<g fill="${BRONZE}">`);
const close = svg.lastIndexOf('</g>');
if (open < 0 || close < 0) throw new Error(`email-logo: ${SRC} no longer has one <g fill="${BRONZE}"> group — update the reversed split`);
const paths = svg.slice(open + `<g fill="${BRONZE}">`.length, close).match(/<path\b[^>]*\/>/g) ?? [];
const firstX = (p) => Number((p.match(/\bd="\s*M\s*(-?[\d.]+)/) ?? [])[1]);
const mark = paths.filter((p) => firstX(p) >= 515);
const word = paths.filter((p) => firstX(p) < 515);
if (mark.length !== 5 || mark.length + word.length !== paths.length) throw new Error(`email-logo: expected 5 mark paths, found ${mark.length} of ${paths.length}`);
const reversed = `${svg.slice(0, open)}<g fill="${PORCELAIN}">${word.join('')}</g><g fill="${BRONZE}">${mark.join('')}</g>${svg.slice(close + '</g>'.length)}`;
await render(reversed, 'public/email/armada-residence-logo-reversed@2x.png');
