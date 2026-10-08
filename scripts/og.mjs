// Generates the default Open Graph image (1200×630) from the approved SVG logo.
// TODO(photo): replace with real branch/room photos per page once the approved set arrives (seo.json → default_og_image).
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';

const MIDNIGHT = '#142A3B'; // brand token (mirrors --color-midnight in src/styles/global.css)
const out = 'public/og/armada-residence.png';

mkdirSync('public/og', { recursive: true });
const logo = readFileSync('public/brand/logo-horizontal.svg');
const logoPng = await sharp(logo, { density: 400 }).resize({ width: 760 }).png().toBuffer();
const { width = 760, height = 170 } = await sharp(logoPng).metadata();

await sharp({ create: { width: 1200, height: 630, channels: 4, background: MIDNIGHT } })
  .composite([{ input: logoPng, left: Math.round((1200 - width) / 2), top: Math.round((630 - height) / 2) }])
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`OG image written: ${out}`);
