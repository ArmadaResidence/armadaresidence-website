// A generated sample set for the media pipeline (1 Nov 2026): never a real photo, never published — it feeds
// scripts/media-build.mjs as a fixture (--fixture <dir>) for scripts/media-pipeline-check.mjs and for the deploy
// workflow's dry run with `media_sample` (the publish time measured on GitHub Actions).
//   node scripts/media-sample.mjs <dir> [--poster white|busy] [--no-video]
// What it holds (a typical publish and the edge cases): Airport Road branch — cover + the 4 story scenes + 6 gallery
// photos (one with a Display P3 profile, one with EXIF orientation 6); its twin room — cover + 3 gallery (one portrait,
// one only 1800 px wide); the restaurant section — 2 photos; the home hero — a poster (pure white or a busy pattern:
// the scrim's two test cases) and a 25 s 2560 × 1440 clip WITH an audio track (cut to 20 s, audio removed, ≤ 4 MB).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { sha256, hasTool } from './photos-lib.mjs';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--poster') || '.media-sample');
const poster = args.includes('--poster') ? args[args.indexOf('--poster') + 1] : 'white';
const video = !args.includes('--no-video');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const svg = (w, h, label, hue) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,38%)"/><stop offset="1" stop-color="hsl(${hue + 40},55%,68%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="${w * 0.3}" cy="${h * 0.4}" r="${Math.min(w, h) * 0.12}" fill="#f4e1c1"/>
<text x="50%" y="55%" font-size="${Math.round(h / 10)}" text-anchor="middle" fill="#fff" font-family="Arial">${label}</text></svg>`);
/** a high-contrast "busy" photo: bright and dark stripes, white blocks, saturated colours — the scrim's worst case */
const busy = (w, h) => {
  const parts = [];
  for (let i = 0; i < 60; i++) parts.push(`<rect x="${(i * 97) % w}" y="${(i * 53) % h}" width="${80 + ((i * 37) % 260)}" height="${60 + ((i * 29) % 200)}" fill="${['#ffffff', '#ffe600', '#00e5ff', '#ff3db8', '#ffffff', '#111111'][i % 6]}"/>`);
  for (let x = 0; x < w; x += 48) parts.push(`<rect x="${x}" y="0" width="16" height="${h}" fill="#ffffff" opacity="0.9"/>`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#7a8b99"/>${parts.join('')}</svg>`);
};
const white = (w, h) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ffffff"/></svg>`);

const items = [];
async function add(file, input, w, h, it, opts = {}) {
  let s = sharp(input(w, h));
  if (opts.p3) s = s.withIccProfile('p3');
  if (opts.orientation) s = s.withMetadata({ orientation: opts.orientation });
  const out = join(dir, file);
  await s.jpeg({ quality: 90 }).toFile(out);
  const buf = readFileSync(out);
  items.push({ id: file, focal_x: 0.5, focal_y: 0.5, sort: 0, kind: 'image', mime: 'image/jpeg', ...it, file, file_name: file, sha256: sha256(buf), bytes: buf.length, width: w, height: h });
}
const lbl = (label, hue) => (w, h) => svg(w, h, label, hue);
const A = { target: 'branch', key: 'airport-road', branch: 'airport-road' };
await add('air-cover.jpg', lbl('Airport Road — cover', 20), 3600, 2400, { ...A, slot: 'cover', alt_ar: 'واجهة أرمادا ريزيدنس طريق المطار ومدخلها الرئيسي', alt_en: 'The front and main entrance of Armada Residence Airport Road' }, { p3: true });
const scenes = [['entrance', 'المدخل والموقف أمام المبنى', 'The entrance and the parking in front of the building'], ['lobby', 'ردهة الاستقبال ومكتب الاستقبال', 'The lobby and the reception desk'], ['rooms', 'غرفة نوم بسرير مزدوج ونافذة واسعة', 'A bedroom with a double bed and a wide window'], ['dining', 'المقهى والمطعم في الطابق الأرضي', 'The café and restaurant on the ground floor']];
for (const [i, [scene, ar, en]] of scenes.entries()) await add(`air-${scene}.jpg`, lbl(`story ${scene}`, 60 + i * 50), 3000, 2000, { ...A, slot: `story-${scene}`, alt_ar: ar, alt_en: en });
for (let i = 0; i < 6; i++) await add(`air-g${i + 1}.jpg`, lbl(`gallery ${i + 1}`, 200 + i * 20), 3600, 2400, { ...A, slot: 'gallery', sort: i, focal_x: 0.3 + i * 0.08, alt_ar: `صورة المعرض ${i + 1} لفرع طريق المطار`, alt_en: `Airport Road gallery photo ${i + 1}` }, i === 2 ? { orientation: 6 } : {});
const R = { target: 'room', key: 'airport-road/twin-room', branch: 'airport-road' };
await add('twin-cover.jpg', lbl('Twin room', 280), 4000, 2667, { ...R, slot: 'cover', focal_y: 0.4, alt_ar: 'غرفة توأم بسريرين منفصلين', alt_en: 'A twin room with two single beds' });
await add('twin-g1.jpg', lbl('Twin bath', 320), 3600, 2400, { ...R, slot: 'gallery', sort: 0, alt_ar: 'دورة مياه الغرفة التوأم', alt_en: 'The twin room bathroom' });
await add('twin-portrait.jpg', lbl('Portrait', 340), 2400, 3600, { ...R, slot: 'gallery', sort: 1, focal_y: 0.7, alt_ar: 'زاوية الجلوس في الغرفة التوأم', alt_en: 'The seating corner of the twin room' });
await add('twin-small.jpg', lbl('Small 1800', 300), 1800, 1200, { ...R, slot: 'gallery', sort: 2, alt_ar: 'منظر من نافذة الغرفة التوأم', alt_en: 'The view from the twin room window' });
const S = { target: 'section', key: 'restaurant', branch: null };
for (let i = 0; i < 2; i++) await add(`rest-${i + 1}.jpg`, lbl(`Restaurant ${i + 1}`, 30 + i * 30), 3600, 2400, { ...S, slot: 'gallery', sort: i, alt_ar: `طاولات المطعم ${i + 1}`, alt_en: `Restaurant tables ${i + 1}` });
const H = { target: 'home', key: 'home', branch: null };
await add('hero-poster.jpg', poster === 'busy' ? busy : white, 3840, 2160, { ...H, slot: 'hero-poster', alt_ar: 'واجهة الفندق مساءً', alt_en: 'The hotel front in the evening' });
if (video && hasTool('ffmpeg')) {
  const out = join(dir, 'hero.mp4');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=2560x1440:rate=30:duration=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=25',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-shortest', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const buf = readFileSync(out);
  items.push({ ...H, id: 'hero.mp4', slot: 'hero-video', sort: 0, focal_x: 0.5, focal_y: 0.5, kind: 'video', mime: 'video/mp4', file: 'hero.mp4', file_name: 'hero.mp4', sha256: sha256(buf), bytes: buf.length, width: 2560, height: 1440, duration: 25, alt_ar: '', alt_en: '' });
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), sample: true, items }, null, 1) + '\n');
console.log(`✓ media sample: ${items.length} item(s) in ${dir} (poster: ${poster}${video ? ', video' : ''})`);
