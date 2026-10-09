// Favicons from the approved symbol SVG (transparent background): favicon.svg stays the primary icon;
// PNG copies for older browsers (32), iOS home screen (180) and the web manifest (512).
import sharp from 'sharp';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';

const svg = readFileSync('public/brand/symbol.svg');
mkdirSync('public/icons', { recursive: true });
copyFileSync('public/brand/symbol.svg', 'public/favicon.svg');
for (const [size, name] of [[32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [512, 'icon-512.png']]) {
  // keep the symbol inside a square with ~8% padding so iOS masks do not clip it
  const inner = Math.round(size * 0.84);
  const glyph = await sharp(svg, { density: 600 }).resize({ height: inner, fit: 'inside' }).png().toBuffer();
  const meta = await sharp(glyph).metadata();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyph, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) }])
    .png()
    .toFile(`public/icons/${name}`);
  console.log(`public/icons/${name} (${size}×${size})`);
}
