// A generated sample set for the media pipeline (1 Nov 2026): never a real photo, never published — it feeds
// scripts/media-build.mjs as a fixture (--fixture <dir>) for scripts/media-pipeline-check.mjs and for the deploy
// workflow's dry run with `media_sample` (the publish time measured on GitHub Actions).
//   node scripts/media-sample.mjs <dir> [--poster white|busy] [--no-video] [--slides]
// --slides (6 Nov 2026): the home hero as «صور متتابعة» — 4 photos (a white, a busy, a dark and a mid one, focal points
// off-centre) in the home gallery and manifest.hero = { mode: 'photos' }; the poster and the clip stay in the manifest
// (the build ignores them in that mode, as the site does).
// What it holds (a typical publish and the edge cases): Airport Road branch — cover + the 4 story scenes + 6 gallery
// photos (one with a Display P3 profile, one with EXIF orientation 6, one with «إظهار في المعرض» off); its twin room — cover + 3 gallery (one portrait,
// one only 1800 px wide); the Airport Road café venue — cover + 2 gallery photos, the hall — cover + 3 gallery, the
// Discover Taif place al-hada-cable-car — its cover (2 Nov 2026, replacing the retired restaurant section); two partners
// pages slots (the hero 16:9, the Shafa Road card 4:5); the home
// hero — a poster (pure white or a busy pattern: the scrim's two test cases) and a 25 s 2560 × 1440 clip WITH an audio
// track (cut to 20 s, audio removed, ≤ 4 MB). venues.json: sample dining venues — the café active (24 hours, the
// internal menu), LARIO coming soon, and a hidden one that must never reach a page (sample copy only, never published).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { sha256, hasTool } from './photos-lib.mjs';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--poster') || '.media-sample');
const poster = args.includes('--poster') ? args[args.indexOf('--poster') + 1] : 'white';
const video = !args.includes('--no-video');
const slidesMode = args.includes('--slides');
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
// the 6th gallery photo has «إظهار في المعرض» off (2 Nov 2026): on the branch page, never on /gallery/
for (let i = 0; i < 6; i++) await add(`air-g${i + 1}.jpg`, lbl(`gallery ${i + 1}`, 200 + i * 20), 3600, 2400, { ...A, slot: 'gallery', sort: i, focal_x: 0.3 + i * 0.08, alt_ar: `صورة المعرض ${i + 1} لفرع طريق المطار`, alt_en: `Airport Road gallery photo ${i + 1}`, ...(i === 5 ? { in_gallery: false } : {}) }, i === 2 ? { orientation: 6 } : {});
const R = { target: 'room', key: 'airport-road/twin-room', branch: 'airport-road' };
await add('twin-cover.jpg', lbl('Twin room', 280), 4000, 2667, { ...R, slot: 'cover', focal_y: 0.4, alt_ar: 'غرفة توأم بسريرين منفصلين', alt_en: 'A twin room with two single beds' });
await add('twin-g1.jpg', lbl('Twin bath', 320), 3600, 2400, { ...R, slot: 'gallery', sort: 0, alt_ar: 'دورة مياه الغرفة التوأم', alt_en: 'The twin room bathroom' });
await add('twin-portrait.jpg', lbl('Portrait', 340), 2400, 3600, { ...R, slot: 'gallery', sort: 1, focal_y: 0.7, alt_ar: 'زاوية الجلوس في الغرفة التوأم', alt_en: 'The seating corner of the twin room' });
await add('twin-small.jpg', lbl('Small 1800', 300), 1800, 1200, { ...R, slot: 'gallery', sort: 2, alt_ar: 'منظر من نافذة الغرفة التوأم', alt_en: 'The view from the twin room window' });
const V = { target: 'dining', key: 'armada-residence-cafe', branch: 'airport-road' };
await add('cafe-cover.jpg', lbl('Café — cover', 30), 3600, 2400, { ...V, slot: 'cover', alt_ar: 'ركن الجلوس في مقهى اللوبي', alt_en: 'The seating corner of the lobby café' });
for (let i = 0; i < 2; i++) await add(`cafe-${i + 1}.jpg`, lbl(`Café ${i + 1}`, 40 + i * 30), 3600, 2400, { ...V, slot: 'gallery', sort: i, alt_ar: `طاولات المقهى ${i + 1}`, alt_en: `Café tables ${i + 1}` });
const HL = { target: 'hall', key: 'events-hall', branch: 'airport-road' };
await add('hall-cover.jpg', lbl('Hall — cover', 210), 3600, 2400, { ...HL, slot: 'cover', alt_ar: 'القاعة مجهزة بطاولات مستديرة', alt_en: 'The hall set with round tables' });
for (let i = 0; i < 3; i++) await add(`hall-${i + 1}.jpg`, lbl(`Hall ${i + 1}`, 220 + i * 20), 3600, 2400, { ...HL, slot: 'gallery', sort: i, alt_ar: `زاوية من القاعة ${i + 1}`, alt_en: `A corner of the hall ${i + 1}` });
await add('place-hada.jpg', lbl('Al Hada — cover', 120), 3000, 2000, { target: 'place', key: 'al-hada-cable-car', branch: null, slot: 'cover', alt_ar: 'عربات التلفريك فوق جبال الهدا', alt_en: 'Cable cars above the Al Hada mountains' });
// two partners slots (2 Nov 2026): the /partners/ hero (16:9) and the Shafa Road card (4:5, from a landscape photo)
const PT = { target: 'partners', branch: null, slot: 'cover' };
await add('partners-hero.jpg', lbl('Partners hero', 160), 3600, 2400, { ...PT, key: 'index-hero', alt_ar: 'واجهة فرع طريق المطار عند الغروب', alt_en: 'The Airport Road front at sunset' });
await add('partners-shafa.jpg', lbl('Shafa card', 170), 3600, 2400, { ...PT, key: 'index-shafa-road', focal_x: 0.7, alt_ar: 'مدخل فرع طريق الشفا', alt_en: 'The Shafa Road entrance' });
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
if (slidesMode) {
  const dark = (w, h) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#1b2430"/><circle cx="${w * 0.7}" cy="${h * 0.3}" r="${h * 0.08}" fill="#3a4656"/></svg>`);
  const shots = [
    ['white', white, 0.5, 0.5, 'واجهة فاتحة اللون تحت سماء صافية', 'A pale front under a clear sky'],
    ['busy', busy, 0.3, 0.4, 'نقوش متداخلة على جدار الردهة', 'Interlaced patterns on the lobby wall'],
    ['dark', dark, 0.7, 0.3, 'الواجهة ليلًا بإضاءة خافتة', 'The front at night under soft light'],
    ['mid', lbl('Hero 4', 25), 0.5, 0.6, 'المدخل الرئيسي ومواقف السيارات', 'The main entrance and the parking'],
  ];
  for (const [i, [name, input, fx, fy, ar, en]] of shots.entries()) {
    await add(`hero-slide-${name}.jpg`, input, 3840, 2160, { ...H, slot: 'gallery', sort: i, focal_x: fx, focal_y: fy, alt_ar: ar, alt_en: en });
  }
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), sample: true, ...(slidesMode ? { hero: { mode: 'photos' } } : {}), items }, null, 1) + '\n');
// sample venues (the shape of public.dining_site_manifest); the logo is a plain SVG, the copy is sample text only
const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><rect width="200" height="60" rx="8" fill="#142A3B"/><circle cx="30" cy="30" r="14" fill="#A97C50"/></svg>';
const venue = (o) => ({ id: o.slug, branch: 'airport-road', kind: 'restaurant_cafe', location: 'lobby', location_note_ar: '', location_note_en: '', hours: null, audience: null, phone: null, whatsapp: null, extension: null, menu: 'none', menu_url: null, description_ar: '', description_en: '', sort: 0, ...o });
writeFileSync(join(dir, 'venues.json'), JSON.stringify({ at: new Date().toISOString(), sample: true, venues: [
  venue({ slug: 'armada-residence-cafe', name_ar: 'مطعم ومقهى أرمادا ريزيدنس', name_en: 'Armada Residence Café & Restaurant', status: 'active', hours: { mode: '24h' }, menu: 'internal', audience: 'public', phone: '+966533798590', whatsapp: '+966533798590', extension: '9', logo_svg: logo,
    description_ar: 'نص تجريبي لوصف المقهى في عينة الاختبار.', description_en: 'Sample text describing the café in the test sample.' }),
  venue({ slug: 'lario', name_ar: 'لاريو — مطعم ومقهى عالمي', name_en: 'LARIO — International Dining & Café', location: 'rooftop', status: 'coming_soon', sort: 1 }),
  venue({ slug: 'sample-hidden', name_ar: 'منشأة مخفية للاختبار', name_en: 'Hidden test venue', status: 'hidden', sort: 2 }),
] }, null, 1) + '\n');
console.log(`✓ media sample: ${items.length} item(s) in ${dir} (poster: ${poster}${video ? ', video' : ''})`);
