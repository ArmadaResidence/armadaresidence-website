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

// Blog (12 Oct 2026): one OG crop per article from its cover (content/articles/<slug>.ar.md → cover = image base under
// public/). Articles whose cover is still the placeholder keep the default image above.
import { existsSync, readdirSync } from 'node:fs';
mkdirSync('public/og/blog', { recursive: true });
let blogOg = 0;
for (const f of existsSync('content/articles') ? readdirSync('content/articles') : []) {
  const m = f.match(/^([a-z0-9-]+)\.ar\.md$/);
  if (!m) continue;
  const cover = (readFileSync(`content/articles/${f}`, 'utf8').match(/^cover:\s*"?([^"\n]+)"?\s*$/m) || [])[1] || '';
  if (!cover || cover.startsWith('[')) continue;
  const base = cover.replace(/^\//, '').replace(/\.webp$/, '');
  const src = [1920, 1400, 800].map((w) => `public/${base}-${w}.webp`).find((p) => existsSync(p));
  if (!src) continue;
  await sharp(src).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toFile(`public/og/blog/${m[1]}.jpg`);
  blogOg++;
}
console.log(`Blog OG images written: ${blogOg}`);
