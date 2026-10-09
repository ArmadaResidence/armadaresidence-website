// Discover Taif photos: legacy JPEGs (Armada-owned) → WebP at 800 and 1400 widths in content/images/taif/.
// Source folder is the extracted legacy export (gitignored); run once, commit the WebP output.
import sharp from 'sharp';
import { readdirSync, copyFileSync, mkdirSync } from 'node:fs';
const src = process.argv[2] || 'legacy-sites/discover-taif-src/discover-taif/assets/img';
const out = 'content/images/taif';
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src).filter((n) => /-(800|1400)\.jpg$/.test(n))) {
  const name = f.replace(/-v1-/, '-').replace(/\.jpg$/, '.webp');
  const info = await sharp(`${src}/${f}`).webp({ quality: 78 }).toFile(`${out}/${name}`);
  console.log(name, `${info.width}x${info.height}`, `${Math.round(info.size / 1024)}KB`);
}
copyFileSync(`${src}/og-discover-taif.jpg`, `${out}/og-discover-taif.jpg`);
console.log('og-discover-taif.jpg copied');
