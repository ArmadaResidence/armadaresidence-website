// Country flags for the phone country-code selector (booking form, 23 Oct 2026).
// Self-hosted, never emoji (Windows does not render flag emoji) and never a runtime CDN: every country that
// libphonenumber-js knows and flag-icons (MIT) draws is rasterised once to a 48×36 PNG (2× of the 24×18 display
// size) in public/flags/<iso2>.png — about 1 KB each instead of SVGs of up to 180 KB. The list markup only loads
// a flag when the country list is open. Also writes public/flags/index.json (the ISO codes that have a flag).
//   node scripts/flags.mjs
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { getCountries } from 'libphonenumber-js/min';

const SRC = 'node_modules/flag-icons/flags/4x3';
const OUT = 'public/flags';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const done = [];
for (const cc of getCountries()) {
  const svg = `${SRC}/${cc.toLowerCase()}.svg`;
  if (!existsSync(svg)) continue;
  await sharp(readFileSync(svg), { density: 144 })
    .resize(48, 36, { fit: 'fill' })
    .png({ compressionLevel: 9, palette: true, colours: 64 })
    .toFile(`${OUT}/${cc.toLowerCase()}.png`);
  done.push(cc);
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(done) + '\n');
console.log(`public/flags: ${done.length} flags (48×36 PNG)`);
