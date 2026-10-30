// Photo import (30 Oct 2026): the rows marked keep = yes in a manifest from scripts/photos-review.mjs →
//   content/images/rooms/<branch>-<room>-NN-<w>.{avif,webp}   room-type photos, 3:2
//   content/images/branches/<branch>-NN-<w>.{avif,webp}       branch photos, 3:2
//   content/images/branches/<branch>-<slot>-<w>.{avif,webp}   a branch photo with a slot → that BranchStory scene, 3:2
//   content/images/og/<branch>[-<room>].jpg, og/home.jpg       one 1200 × 630 Open Graph crop per page with a photo
//   content/images/hero/hero.mp4 + hero.webm                   the home hero loop (16:9, desktop only)
//   content/images/hero/hero-poster[-m]-<w>.{avif,webp}         its poster: 16:9 desktop + 4:5 mobile crop (the LCP)
//   content/images/hero/hero.json                              what the home page renders (written here, never by hand)
// then the references in content/rooms.json (rooms[].photos, og_image) and content/branches.json (branches[].photos,
// og_image, story[].image) and the 16 px previews in content/lqip.json (scripts/lqip.mjs). NN = order in the folder,
// the cover first. Specs approved by Ahmed on 30 Oct 2026 (CLAUDE.md §3c): widths 480 / 800 / 1200 / 1600 / 2000,
// AVIF q50 + WebP q78, sRGB; hero loop 10–15 s (20 s max), muted, no audio track, 1920 × 1080 H.264 MP4 ≤ 4 MB + WebM.
// Orientation is applied and every byte of metadata (EXIF, XMP, IPTC, ICC → sRGB) is dropped. Crops are centred unless
// the manifest gives a focal point. alt_ar / alt_en are copied as typed — never invented; an empty alt is written
// empty and fails qa.py with the list of what is missing. The originals are only read.
//   node scripts/photos-import.mjs <manifest.csv|json> [--src <photo folder>] [--site <site root>] [--dry-run]
// --site defaults to this repository; the e2e test points it at a scratch copy.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { siteSlugs, readManifest, yes, parseFocal, cropBox, decodable, orientedSize, hasTool, ffprobe, HERO_FOLDER } from './photos-lib.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const manifestPath = args.find((a, i) => !a.startsWith('--') && !['--src', '--site'].includes(args[i - 1]));
if (!manifestPath || !existsSync(manifestPath)) {
  console.error('usage: node scripts/photos-import.mjs <folder>/_review/manifest.csv [--src <folder>] [--site <root>] [--dry-run]');
  process.exit(2);
}
const SRC = resolve(opt('--src') || dirname(dirname(resolve(manifestPath))));
const SITE = resolve(opt('--site') || REPO);
const DRY = args.includes('--dry-run');
const IMAGES = join(SITE, 'content', 'images');

// Sizes (approved 30 Oct 2026, CLAUDE.md §3c / §7): 3:2 photos at 480 / 800 / 1200 / 1600 / 2000 (never upscaled),
// AVIF ≈ q50 + WebP ≈ q78, converted to sRGB (sharp converts through the embedded ICC profile, then strips it).
export const PHOTO = { ratio: 3 / 2, widths: [480, 800, 1200, 1600, 2000], webp: { quality: 78, effort: 5 }, avif: { quality: 50, effort: 4 } };
export const OG = { width: 1200, height: 630, jpeg: { quality: 82, mozjpeg: true } };
// Hero (approved 30 Oct 2026): a 10–15 s loop (20 s max: longer clips are cut), muted, audio track removed, 1920 × 1080
// H.264 MP4 ≤ 4 MB + WebM (VP9, same budget). The bitrate cap follows the clip length so the file fits the budget; a
// file still over it is encoded once more at a fixed lower bitrate. Poster: 16:9 for desktop + an art-directed 4:5
// crop for mobile, both around the manifest's focal point, AVIF + WebP — the home page's LCP image.
export const HERO = {
  width: 1920, height: 1080, loopSeconds: [10, 15], maxSeconds: 20, fps: 30, maxMB: 4, mp4Crf: 24, webmCrf: 34,
  posterWidths: [800, 1200, 1600, 2000], mobileRatio: 4 / 5, mobileWidths: [480, 800, 1200],
};

const { folders } = siteSlugs(SITE);
const rows = readManifest(manifestPath).filter((r) => yes(r.keep));
const problems = [];
const missingAlt = [];
const log = (s) => console.log(s);

// ---------- group & order ----------
const groups = new Map();
const slots = new Map(); // folder → rows with a slot (BranchStory scenes)
for (const r of rows) {
  if (!r.folder || !r.file) continue;
  if (!existsSync(join(SRC, r.folder === '.' ? '' : r.folder, r.file))) {
    problems.push(`${r.folder}/${r.file}: file not found in ${SRC}`);
    continue;
  }
  (groups.get(r.folder) || groups.set(r.folder, []).get(r.folder)).push(r);
}
for (const [folder, list] of groups) {
  if (folder === HERO_FOLDER || folder === '.') continue;
  if (!folders.has(folder)) problems.push(`${folder}: not a branch / room slug in content/ — skipped`);
  const all = list.filter((r) => (r.kind || 'photo') === 'photo');
  // slot rows fill a BranchStory scene (branch folders only) and stay out of the gallery
  const slotted = all.filter((r) => (r.slot || '').trim());
  if (slotted.length && !folder.endsWith('/branch')) problems.push(`${folder}: slot is for branch photos only (<branch>/branch) — ${slotted.map((r) => r.file).join(', ')}`);
  for (const r of slotted) r.slot = r.slot.trim().toLowerCase();
  slots.set(folder, slotted);
  const photos = all.filter((r) => !slotted.includes(r));
  const covers = photos.filter((r) => yes(r.cover));
  if (covers.length > 1) problems.push(`${folder}: ${covers.length} rows marked cover — keep one`);
  photos.sort((a, b) => (yes(b.cover) - yes(a.cover)) || a.file.localeCompare(b.file));
  if (!covers.length && photos.length) log(`  ! ${folder}: no cover marked — using ${photos[0].file}`);
  groups.set(folder, photos);
}
if (problems.some((p) => /keep one|not a branch|slot is for/.test(p))) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const pubPath = (abs) => '/images/' + abs.slice(IMAGES.length + 1).replace(/\\/g, '/');

/** Removes the earlier files of a photo set: `<prefix>-NN-<w>.*` (numbered = a gallery) or `<prefix>-<w>.*` (a story slot). */
function clearOld(dir, prefix, numbered = true) {
  if (!existsSync(dir)) return;
  const re = new RegExp(`^${prefix.replace(/[-]/g, '\\-')}${numbered ? '-\\d{2}' : ''}-\\d+\\.(webp|avif)$`);
  for (const f of readdirSync(dir)) if (re.test(f)) rmSync(join(dir, f));
}

async function processPhoto(r, dir, base) {
  const path = join(SRC, r.folder, r.file);
  const { buf } = await decodable(path, readFileSync(path));
  const { width: w, height: h } = orientedSize(await sharp(buf).metadata());
  const focal = parseFocal(r.focal_point);
  const box = cropBox(w, h, PHOTO.ratio, focal);
  if (box.width < PHOTO.widths[0]) throw new Error(`only ${box.width} px wide after the 3:2 crop — at least ${PHOTO.widths[0]} needed`);
  // every approved width the crop can fill without upscaling
  const widths = PHOTO.widths.filter((x) => x <= box.width);
  // rotate() applies the EXIF orientation first; without withMetadata() nothing of the original metadata is written
  const pipe = sharp(buf).rotate().extract(box).toColourspace('srgb');
  for (const width of widths) {
    const sized = pipe.clone().resize(width, Math.round(width / PHOTO.ratio), { fit: 'fill' });
    if (!DRY) {
      await sized.clone().webp(PHOTO.webp).toFile(join(dir, `${base}-${width}.webp`));
      await sized.clone().avif(PHOTO.avif).toFile(join(dir, `${base}-${width}.avif`));
    }
  }
  const largest = widths.at(-1);
  return {
    entry: {
      base: pubPath(join(dir, base)),
      widths,
      width: largest,
      height: Math.round(largest / PHOTO.ratio),
      formats: ['avif', 'webp'],
      ...(focal ? { focal: `${Math.round(focal.x * 100)},${Math.round(focal.y * 100)}` } : {}),
      alt_ar: r.alt_ar || '',
      alt_en: r.alt_en || '',
      ...(r.caption_ar ? { caption_ar: r.caption_ar } : {}),
      ...(r.caption_en ? { caption_en: r.caption_en } : {}),
      source_file: `${r.folder}/${r.file}`,
    },
    buf,
    focal,
    size: { w, h },
  };
}

/** 1200 × 630 crop of an image (EXIF orientation applied), centred on the focal point. */
async function writeOg(buf, name, focal) {
  const { width, height } = orientedSize(await sharp(buf).metadata());
  const out = join(IMAGES, 'og', `${name}.jpg`);
  if (!DRY) {
    mkdirSync(dirname(out), { recursive: true });
    await sharp(buf).rotate().extract(cropBox(width, height, OG.width / OG.height, focal)).resize(OG.width, OG.height).toColourspace('srgb').jpeg(OG.jpeg).toFile(out);
  }
  return pubPath(out);
}

// ---------- photos ----------
const roomsFile = join(SITE, 'content', 'rooms.json');
const branchesFile = join(SITE, 'content', 'branches.json');
const roomsText = readFileSync(roomsFile, 'utf8');
const branchesText = readFileSync(branchesFile, 'utf8');
const roomsJson = JSON.parse(roomsText);
const branchesJson = JSON.parse(branchesText);
let written = 0;

for (const [folder, list] of groups) {
  if (folder === HERO_FOLDER || folder === '.') continue;
  const { branch, room } = folders.get(folder);
  const dir = join(IMAGES, room ? 'rooms' : 'branches');
  const prefix = room ? `${branch}-${room}` : branch;
  if (!DRY) {
    mkdirSync(dir, { recursive: true });
    clearOld(dir, prefix);
  }
  const target = room ? roomsJson.rooms.find((x) => x.branch === branch && x.slug === room) : branchesJson.branches.find((b) => b.slug === branch);
  const entries = [];
  let ogPath;
  for (const [i, r] of list.entries()) {
    try {
      const res = await processPhoto(r, dir, `${prefix}-${String(i + 1).padStart(2, '0')}`);
      if (i === 0) res.entry.cover = true;
      entries.push(res.entry);
      if (i === 0) ogPath = await writeOg(res.buf, prefix, res.focal);
      if (!res.entry.alt_ar || !res.entry.alt_en) missingAlt.push(`${folder}/${r.file}: ${[!res.entry.alt_ar && 'alt_ar', !res.entry.alt_en && 'alt_en'].filter(Boolean).join(' + ')}`);
      written++;
      log(`  ✓ ${folder}/${r.file} → ${res.entry.base} (${res.entry.widths.join(' / ')} w, from ${res.size.w}×${res.size.h})`);
    } catch (e) {
      problems.push(`${folder}/${r.file}: ${e.message || e}`);
    }
  }
  if (entries.length) {
    target.photos = entries;
    target.og_image = ogPath;
  } else {
    delete target.photos;
    delete target.og_image;
    if (!DRY) rmSync(join(IMAGES, 'og', `${prefix}.jpg`), { force: true });
  }
  // BranchStory scenes (slot column): branches.json → story[].image takes the photo; a scene of this branch without a
  // slot row in the manifest goes back to its placeholder (base null) and loses its files, so a re-import is exact
  if (!room && Array.isArray(target.story)) {
    const rowsBySlot = new Map();
    for (const r of slots.get(folder) || []) {
      if (!target.story.some((sc) => sc.key === r.slot)) problems.push(`${folder}/${r.file}: slot "${r.slot}" is not a story scene (${target.story.map((sc) => sc.key).join(' / ')})`);
      else if (rowsBySlot.has(r.slot)) problems.push(`${folder}: two photos for slot "${r.slot}" — keep one`);
      else rowsBySlot.set(r.slot, r);
    }
    for (const sc of target.story) {
      const name = `${branch}-${sc.key}`;
      if (!DRY) clearOld(dir, name, false);
      const r = rowsBySlot.get(sc.key);
      if (!r) {
        sc.image = { ...sc.image, base: null };
        for (const k of ['width', 'height', 'formats', 'source_file']) delete sc.image[k];
        continue;
      }
      try {
        const { entry } = await processPhoto(r, dir, name);
        sc.image = { ...sc.image, base: entry.base, widths: entry.widths, width: entry.width, height: entry.height, formats: entry.formats, alt_ar: entry.alt_ar, alt_en: entry.alt_en, source_file: entry.source_file };
        if (!entry.alt_ar || !entry.alt_en) missingAlt.push(`${folder}/${r.file} (slot ${sc.key}): ${[!entry.alt_ar && 'alt_ar', !entry.alt_en && 'alt_en'].filter(Boolean).join(' + ')}`);
        written++;
        log(`  ✓ ${folder}/${r.file} → story scene "${sc.key}" ${entry.base} (${entry.widths.join(' / ')} w)`);
      } catch (e) {
        problems.push(`${folder}/${r.file} (slot ${sc.key}): ${e.message || e}`);
      }
    }
  }
}

// ---------- hero (video + poster) ----------
const heroRows = [...(groups.get(HERO_FOLDER) || []), ...(groups.get('.') || [])];
const heroVideo = heroRows.find((r) => (r.kind || '') === 'video' || /\.(mp4|mov|m4v|webm)$/i.test(r.file));
const heroStill = heroRows.find((r) => r !== heroVideo && !/\.(mp4|mov|m4v|webm)$/i.test(r.file));
const heroDir = join(IMAGES, 'hero');
const heroJson = { _note: 'Generated by scripts/photos-import.mjs — what the home hero renders. Do not edit.' };

/** Even crop box for ffmpeg (yuv420p needs even sizes), the same focal rule as the photos (cropBox). */
function evenBox(w, h, ratio, focal) {
  const b = cropBox(w, h, ratio, focal);
  const ev = (n) => n - (n % 2);
  return { left: ev(b.left), top: ev(b.top), width: ev(b.width), height: ev(b.height) };
}
/** The focal point as a position inside a crop (object-position), so the subject stays in view at any hero height. */
function focalIn(focal, w, h, box) {
  if (!focal) return '50% 50%';
  const pct = (v) => Math.min(100, Math.max(0, Math.round(v * 100)));
  return `${pct((focal.x * w - box.left) / box.width)}% ${pct((focal.y * h - box.top) / box.height)}%`;
}

if (heroVideo && !(hasTool('ffmpeg') && hasTool('ffprobe'))) {
  problems.push('hero video: ffmpeg / ffprobe not found — the video step was skipped (install ffmpeg and run again); nothing else depends on it');
} else if (heroVideo) {
  const src = join(SRC, heroVideo.folder === '.' ? '' : heroVideo.folder, heroVideo.file);
  const v = ffprobe(src);
  const focal = parseFocal(heroVideo.focal_point);
  const box = evenBox(v.width, v.height, 16 / 9, focal);
  const seconds = Math.min(v.duration || HERO.maxSeconds, HERO.maxSeconds);
  if (v.duration > HERO.maxSeconds) log(`  ! hero video: ${v.duration.toFixed(1)} s — cut to the first ${HERO.maxSeconds} s (the approved loop is ${HERO.loopSeconds.join('–')} s)`);
  else if (v.duration > HERO.loopSeconds[1]) log(`  ! hero video: ${v.duration.toFixed(1)} s — longer than the approved ${HERO.loopSeconds.join('–')} s loop (kept; ${HERO.maxSeconds} s max)`);
  if (box.width < HERO.width) log(`  ! hero video: ${box.width} × ${box.height} after the 16:9 crop — under ${HERO.width} × ${HERO.height}, kept at its size (never upscaled)`);
  // 16:9 crop around the focal point (the posters' rule), then down to 1920 × 1080, 30 fps, no audio / subtitle / data, ≤ 20 s
  const vf = [`crop=${box.width}:${box.height}:${box.left}:${box.top}`, `scale='min(${HERO.width},iw)':-2:flags=lanczos`, `fps=${HERO.fps}`, 'format=yuv420p'].join(',');
  const common = ['-v', 'error', '-y', '-i', src, '-t', String(HERO.maxSeconds), '-an', '-sn', '-dn', '-map_metadata', '-1', '-vf', vf];
  // bitrate cap that fits the budget for this length (92 % of maxMB; the container takes the rest)
  const kbps = Math.floor((HERO.maxMB * 8 * 1024 * 0.92) / seconds);
  const enc = {
    'hero.mp4': (rate) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(HERO.mp4Crf), '-maxrate', `${rate}k`, '-bufsize', `${rate * 2}k`, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    'hero.webm': (rate) => ['-c:v', 'libvpx-vp9', '-crf', String(HERO.webmCrf), '-b:v', `${rate}k`, '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2'],
  };
  if (!DRY) mkdirSync(heroDir, { recursive: true });
  for (const [name, args] of Object.entries(enc)) {
    if (DRY) continue;
    const out = join(heroDir, name);
    let rate = kbps;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = spawnSync('ffmpeg', [...common, ...args(rate), out], { encoding: 'utf8' });
      if (r.status !== 0) {
        problems.push(`hero video → ${name}: ${(r.stderr || '').trim().split('\n').pop()}`);
        break;
      }
      const mb = statSync(out).size / 1048576;
      if (mb <= HERO.maxMB) {
        log(`  ✓ hero video → /images/hero/${name} (${mb.toFixed(2)} MB, ${seconds.toFixed(1)} s, cap ${rate} kbit/s)`);
        break;
      }
      if (attempt === 1) problems.push(`hero video → ${name}: ${mb.toFixed(2)} MB, over ${HERO.maxMB} MB — trim the clip`);
      rate = Math.floor((rate * HERO.maxMB * 0.95) / mb); // once more, scaled to the budget
    }
  }
  heroJson.video = { mp4: '/images/hero/hero.mp4', webm: '/images/hero/hero.webm', seconds: Math.round(seconds * 10) / 10 };
}

// poster: the still in the hero folder if one is kept, else the video's first frame (uncropped, so both crops use the
// focal point); 16:9 for desktop + 4:5 for mobile, AVIF + WebP, and og/home.jpg
let posterBuf = null;
let posterFocal = null;
const posterRow = heroStill || heroVideo;
if (heroStill) {
  const p = join(SRC, heroStill.folder === '.' ? '' : heroStill.folder, heroStill.file);
  posterBuf = (await decodable(p, readFileSync(p))).buf;
  posterFocal = parseFocal(heroStill.focal_point);
} else if (heroVideo && hasTool('ffmpeg')) {
  const tmp = join(tmpdir(), `armada-poster-${process.pid}.png`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(SRC, heroVideo.folder === '.' ? '' : heroVideo.folder, heroVideo.file), '-frames:v', '1', tmp], { encoding: 'utf8' });
  if (r.status === 0) {
    posterBuf = readFileSync(tmp);
    rmSync(tmp, { force: true });
    posterFocal = parseFocal(heroVideo.focal_point);
  } else problems.push(`hero poster: ${(r.stderr || '').trim().split('\n').pop()}`);
}
if (posterBuf) {
  const { width: pw, height: ph } = orientedSize(await sharp(posterBuf).metadata());
  if (!DRY) {
    mkdirSync(heroDir, { recursive: true });
    for (const n of readdirSync(heroDir)) if (/^hero-poster/.test(n)) rmSync(join(heroDir, n));
  }
  const variants = [
    ['poster', 'hero-poster', 16 / 9, HERO.posterWidths],
    ['poster_mobile', 'hero-poster-m', HERO.mobileRatio, HERO.mobileWidths],
  ];
  for (const [key, name, ratio, list] of variants) {
    const box = cropBox(pw, ph, ratio, posterFocal);
    let widths = list.filter((w) => w <= box.width);
    if (!widths.length) widths = [box.width]; // under the smallest approved width: its own size, never upscaled
    const pipe = sharp(posterBuf).rotate().extract(box).toColourspace('srgb');
    for (const w of widths) {
      if (DRY) continue;
      const sized = pipe.clone().resize(w, Math.round(w / ratio), { fit: 'fill' });
      await sized.clone().webp(PHOTO.webp).toFile(join(heroDir, `${name}-${w}.webp`));
      await sized.clone().avif(PHOTO.avif).toFile(join(heroDir, `${name}-${w}.avif`));
    }
    const top = widths.at(-1);
    heroJson[key] = { base: `/images/hero/${name}`, widths, width: top, height: Math.round(top / ratio), position: focalIn(posterFocal, pw, ph, box) };
  }
  heroJson.alt_ar = posterRow.alt_ar || '';
  heroJson.alt_en = posterRow.alt_en || '';
  if (!heroJson.alt_ar || !heroJson.alt_en) missingAlt.push(`${posterRow.folder}/${posterRow.file} (hero poster): ${[!heroJson.alt_ar && 'alt_ar', !heroJson.alt_en && 'alt_en'].filter(Boolean).join(' + ')}`);
  await writeOg(posterBuf, 'home', posterFocal);
  log(`  ✓ hero poster → /images/hero/hero-poster[-m]-*.{avif,webp} (16:9: ${heroJson.poster.widths.join(' / ')}; 4:5: ${heroJson.poster_mobile.widths.join(' / ')}), og/home.jpg`);
}
if (heroJson.poster) {
  if (!DRY) writeFileSync(join(heroDir, 'hero.json'), JSON.stringify(heroJson, null, 2) + '\n');
} else if (heroJson.video) problems.push('hero: a video without a poster is never shown — the poster is the LCP');

// ---------- content + previews ----------
const keepNewline = (orig, s) => (orig.endsWith('\n') ? s + '\n' : s);
if (!DRY) {
  writeFileSync(roomsFile, keepNewline(roomsText, JSON.stringify(roomsJson, null, 2)));
  writeFileSync(branchesFile, keepNewline(branchesText, JSON.stringify(branchesJson, null, 2)));
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'lqip.mjs'), SITE], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`lqip: ${r.stderr.trim()}`);
  else log(`  ${r.stdout.trim()}`);
}

log(`\n${DRY ? '(dry run) ' : ''}${written} photo(s) imported into ${IMAGES}`);
if (missingAlt.length) {
  log(`\n✗ ${missingAlt.length} photo(s) without alt text — qa.py fails until they are filled in the manifest and imported again:`);
  for (const m of missingAlt) log(`  - ${m}`);
}
for (const p of problems) console.error(`✗ ${p}`);
process.exit(problems.length ? 1 : 0);
