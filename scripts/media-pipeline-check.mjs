// The media pipeline end to end on a generated sample set (1 Nov 2026, dashboard «الصور») — a dry run: nothing is
// published, the repository's content/ and public/ are untouched (everything goes to a temp folder) unless --site.
//   node scripts/media-pipeline-check.mjs [--site [white|busy]]
// 1. scripts/media-sample.mjs → a branch (cover + 4 story scenes + 6 gallery, one P3 profile, one EXIF orientation 6),
//    a room type (cover + portrait + 1800 px photo), the restaurant section, the hero poster + a 25 s 2560 × 1440 clip
//    with audio;
// 2. scripts/media-build.mjs cold: every derived file — 3:2 at the approved widths never upscaled, AVIF + WebP, no
//    metadata, sRGB; the 1200 × 630 OG crop of each cover and of the poster; the poster 16:9 + 4:5; the loop cut to 20 s,
//    1920 × 1080, no audio, ≤ 4 MB each; a 16 px LQIP per photo; the data file's shape (cover first, story scenes);
// 3. warm: every entry from the cache (no miss, byte-identical output, much faster);
// 4. one focal point changed: exactly that entry is made again;
// --site: python build.py with the sample (MEDIA_FIXTURE) then python qa.py — the published pages and the qa gate; the
//    repository's dist/ then holds that build (the next build.py restores the normal one).
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ffprobe } from './photos-lib.mjs';
import { HERO, PHOTO } from './photos-engine.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const SITE = args.includes('--site');
const POSTER = SITE && ['white', 'busy'].includes(args[args.indexOf('--site') + 1]) ? args[args.indexOf('--site') + 1] : 'white';
const T = mkdtempSync(join(tmpdir(), 'armada-media-check-'));
const SAMPLE = join(T, 'sample');
let checks = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(label);
};
const node = (script, extra, env = {}) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...extra], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '', ...env } });
  if (r.status !== 0) throw new Error(`${script} failed:\n${r.stdout}\n${r.stderr}`);
  return { out: r.stdout, seconds: (Date.now() - t) / 1000 };
};
const hashDir = (dir) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')]));

node('media-sample.mjs', [SAMPLE, '--poster', POSTER]);
const manifest = JSON.parse(readFileSync(join(SAMPLE, 'manifest.json'), 'utf8'));
const build = (name, env = {}) => {
  const out = join(T, name);
  const r = node('media-build.mjs', ['--fixture', SAMPLE, '--out', out, '--cache', join(T, 'cache'), '--data', join(T, `${name}.json`)], env);
  return { ...r, out, img: join(out, 'images', 'media'), report: JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')), data: JSON.parse(readFileSync(join(T, `${name}.json`), 'utf8')) };
};

// ── cold ──
const cold = build('cold');
console.log(`cold build: ${cold.seconds.toFixed(1)} s, ${cold.report.files} files, ${(cold.report.bytes / 1048576).toFixed(1)} MB`);
check(cold.report.problems.length === 0, 'cold: no problem', cold.report.problems.join('; '));
check(cold.report.cache.misses > 0 && cold.report.cache.hits === 0, 'cold: every entry made', JSON.stringify(cold.report.cache));
const d = cold.data;
const twin = d.rooms?.['airport-road/twin-room'];
check(twin?.photos.length === 4 && twin.photos[0].cover && twin.og_image, 'data: the room type — cover first, 3 gallery photos, its OG image');
const air = d.branches?.['airport-road'];
check(air?.photos.length === 7 && Object.keys(air.story || {}).sort().join() === 'dining,entrance,lobby,rooms', 'data: the branch — cover + 6 gallery, the 4 story scenes');
check(d.sections?.restaurant?.photos.length === 2, 'data: the restaurant section gallery');
const all = [...Object.values(d.rooms), ...Object.values(d.branches), ...Object.values(d.sections)].flatMap((e) => [...e.photos, ...Object.values(e.story || {})]);
const file = (ref) => join(cold.img, ref.replace(/^\/images\/media\//, ''));
let sizeOk = true, metaOk = true, fmtOk = true;
for (const p of all) {
  for (const w of p.widths) {
    for (const ext of ['webp', 'avif']) {
      const m = await sharp(file(`${p.base}-${w}.${ext}`)).metadata().catch(() => null);
      if (!m) { fmtOk = false; continue; }
      if (m.width !== w || m.height !== Math.round(w / PHOTO.ratio)) sizeOk = false;
      if (m.exif || m.xmp || m.iptc) metaOk = false;
    }
  }
}
check(fmtOk, 'photos: AVIF + WebP at every listed width');
check(sizeOk, 'photos: every file is the exact 3:2 size of its width');
check(metaOk, 'photos: no EXIF / XMP / IPTC left');
check(all.every((p) => p.widths.every((w) => PHOTO.widths.includes(w))), 'photos: only the approved widths (480 / 800 / 1200 / 1600 / 2000)');
const small = twin.photos.find((p) => p.alt_en.includes('window'));
check(small && Math.max(...small.widths) === 1600, 'photos: an 1800 px photo is never upscaled (largest 1600)', small?.widths.join());
const portrait = twin.photos.find((p) => p.alt_en.includes('seating'));
check(portrait && Math.max(...portrait.widths) === 2000, 'photos: a portrait photo is cropped to 3:2 at full width', portrait?.widths.join());
const rotated = air.photos.find((p) => p.alt_en.endsWith('photo 3'));
check(rotated && Math.max(...rotated.widths) === 2000, 'photos: EXIF orientation 6 applied before the crop (2400 wide once upright)', rotated?.widths.join());
const p3 = air.photos[0];
const st = await sharp(file(`${p3.base}-800.webp`)).metadata();
check(!st.icc || st.space === 'srgb', 'photos: a Display P3 original comes out sRGB', `${st.space} icc:${!!st.icc}`);
for (const og of [twin.og_image, air.og_image, d.home?.og_image]) {
  const m = og && (await sharp(file(og)).metadata().catch(() => null));
  check(m && m.width === 1200 && m.height === 630 && m.format === 'jpeg', `OG: ${og ?? '?'} is a 1200 × 630 JPEG`);
}
check(all.every((p) => d.lqip[`${p.base}-${p.widths.includes(800) ? 800 : p.widths[0]}.webp`]?.startsWith('data:image/webp;base64,')), 'LQIP: a 16 px WebP preview per photo');
const h = d.home;
check(h?.poster.widths.join() === HERO.posterWidths.join() && h.poster_mobile.widths.join() === HERO.mobileWidths.join(), 'hero: poster 16:9 at 800–2000, 4:5 at 480–1200', JSON.stringify(h && [h.poster.widths, h.poster_mobile.widths]));
const pm = await sharp(file(`${h.poster_mobile.base}-1200.avif`)).metadata();
const pd = await sharp(file(`${h.poster.base}-2000.avif`)).metadata();
check(pm.width === 1200 && pm.height === 1500 && pd.width === 2000 && pd.height === 1125, 'hero: the 4:5 and 16:9 crops have their exact sizes');
for (const ext of ['mp4', 'webm']) {
  const v = ffprobe(file(h.video[ext]));
  const mb = readFileSync(file(h.video[ext])).length / 1048576;
  check(v.width === 1920 && v.height === 1080 && v.duration <= HERO.maxSeconds + 0.2 && !v.audio && mb <= HERO.maxMB, `hero video ${ext}: 1920 × 1080, cut to ${HERO.maxSeconds} s, no audio, ≤ ${HERO.maxMB} MB`, `${v.width}×${v.height} ${v.duration.toFixed(1)} s audio:${v.audio} ${mb.toFixed(2)} MB`);
}
check(h.video.seconds === 20, 'hero video: the 25 s source is cut to 20 s', String(h.video.seconds));

// ── warm: everything from the cache ──
const warm = build('warm');
console.log(`warm build: ${warm.seconds.toFixed(1)} s`);
check(warm.report.cache.misses === 0 && warm.report.cache.hits === cold.report.cache.misses, 'warm: every entry from the cache, nothing made again', JSON.stringify(warm.report.cache));
check(JSON.stringify(hashDir(warm.img)) === JSON.stringify(hashDir(cold.img)), 'warm: byte-identical output');
check(warm.seconds < cold.seconds / 3, 'warm: much faster than cold', `${warm.seconds.toFixed(1)} vs ${cold.seconds.toFixed(1)} s`);

// ── one focal point changed ──
const it = manifest.items.find((x) => x.file === 'twin-g1.jpg');
it.focal_x = 0.1;
writeFileSync(join(SAMPLE, 'manifest.json'), JSON.stringify(manifest));
const moved = build('moved');
check(moved.report.cache.misses === 1, 'focal point changed: exactly that photo is made again', JSON.stringify(moved.report.cache));
writeFileSync(join(T, 'timings.json'), JSON.stringify({ cold: cold.seconds, warm: warm.seconds, moved: moved.seconds, items: manifest.items.length, files: cold.report.files, bytes: cold.report.bytes }, null, 2));

// ── --site: the pages and the qa gate ──
if (SITE) {
  it.focal_x = 0.5;
  writeFileSync(join(SAMPLE, 'manifest.json'), JSON.stringify(manifest));
  const env = { ...process.env, MEDIA_FIXTURE: SAMPLE, MEDIA_CACHE: join(T, 'cache'), SUPABASE_SERVICE_ROLE_KEY: '', PYTHONUTF8: '1' };
  const t = Date.now();
  const b = spawnSync('python', ['build.py'], { cwd: ROOT, env, encoding: 'utf8' });
  check(b.status === 0, 'site: build.py with the sample', b.status ? (b.stderr || b.stdout).slice(-600) : '');
  console.log(`site build: ${((Date.now() - t) / 1000).toFixed(0)} s`);
  const q = spawnSync('python', ['qa.py'], { cwd: ROOT, env, encoding: 'utf8' });
  check(q.status === 0, 'site: qa.py passes with published media', q.status ? q.stdout.split('\n').filter((l) => /✗|FAIL|media/.test(l)).slice(0, 15).join('\n') : '');
  const home = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  check(home.includes('hero-scrim') && home.includes('text-bronze-bright') && /rel="preload"[^>]+imagesrcset="\/images\/media\/hero-poster-/.test(home), 'site: the home hero renders the poster with the scrim, Bronze Bright and the preload');
  const room = readFileSync(join(ROOT, 'dist', 'airport-road', 'twin-room', 'index.html'), 'utf8');
  check(/\/images\/media\/airport-road-twin-room-[0-9a-f]+-800\.(avif|webp)/.test(room) && room.includes('og:image') && room.includes('/images/media/airport-road-twin-room-'), 'site: the room page shows its photos and the OG image');
  const branch = readFileSync(join(ROOT, 'dist', 'airport-road', 'index.html'), 'utf8');
  check(/\/images\/media\/airport-road-lobby-[0-9a-f]+-/.test(branch), 'site: the branch story scenes use the published photos');
  // keep the built sample site for the scrim check
  cpSync(join(ROOT, 'dist'), join(T, 'dist'), { recursive: true });
  console.log(`sample site copied to ${join(T, 'dist')}`);
}
console.log(`\n${checks} checks, ${fails.length} failed — artefacts in ${T}`);
if (!SITE) rmSync(SAMPLE, { recursive: true, force: true });
process.exit(fails.length ? 1 : 0);
