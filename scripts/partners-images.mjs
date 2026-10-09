// Approved legacy B2B photos (Ahmed, 9 Oct 2026) → WebP at 800 and 1400 widths in content/images/partners/.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const src = process.argv[2] || 'legacy-sites/b2b-src/armada-residence-b2b/assets/img';
const out = 'content/images/partners';
const names = ['airport-exterior', 'shafa-exterior', 'suite-living', 'umrah-room', 'function-hall'];
mkdirSync(out, { recursive: true });
for (const n of names) {
  for (const w of [800, 1400]) {
    const info = await sharp(`${src}/${n}.jpg`).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(`${out}/${n}-${w}.webp`);
    console.log(`${n}-${w}.webp ${info.width}x${info.height} ${Math.round(info.size / 1024)}KB`);
  }
}
