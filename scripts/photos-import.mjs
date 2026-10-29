// Photo import (30 Oct 2026): the rows marked keep = yes in a manifest from scripts/photos-review.mjs →
//   content/images/rooms/<branch>-<room>-NN-<w>.{avif,webp}   room-type photos, 3:2
//   content/images/branches/<branch>-NN-<w>.{avif,webp}       branch photos, 3:2
//   content/images/og/<branch>[-<room>].jpg, og/home.jpg       one 1200 × 630 Open Graph crop per page with a photo
//   content/images/hero/hero.mp4 + hero.webm + hero-poster*.webp   the home hero video (16:9) and its poster
// then the references in content/rooms.json (rooms[].photos, og_image) and content/branches.json (branches[].photos,
// og_image) and the 16 px previews in content/lqip.json (scripts/lqip.mjs). NN = order in the folder, the cover first.
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
import { siteSlugs, readManifest, yes, parseFocal, cropBox, decodable, orientedSize, hasTool, HERO_FOLDER } from './photos-lib.mjs';

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

// Sizes (CLAUDE.md §7: WebP + srcset, max 1920 wide; §3: 3:2 photos as BranchStory / Placeholder; 16:9 hero).
export const PHOTO = { ratio: 3 / 2, widths: [800, 1400, 1920], webp: { quality: 78, effort: 5 }, avif: { quality: 50, effort: 4 } };
export const OG = { width: 1200, height: 630, jpeg: { quality: 82, mozjpeg: true } };
// Hero video limits — proposed 30 Oct 2026 (CLAUDE.md sets none beyond "home < 1 MB", which the video does not count
// against: it attaches after `load`, desktop only, never with reduced motion / Save-Data).
// Each file ≤ 5 MB: H.264 CRF 26 capped at 2 Mbit/s, VP9 constrained quality (CRF 36, 1.6 Mbit/s) — about 4–5 MB for 20 s.
export const HERO = { width: 1920, height: 1080, maxSeconds: 20, fps: 30, mp4Crf: 26, mp4Max: '2M', webmCrf: 36, webmRate: '1600k', maxMB: 5, posterWidths: [800, 1400, 1920] };

const { folders } = siteSlugs(SITE);
const rows = readManifest(manifestPath).filter((r) => yes(r.keep));
const problems = [];
const missingAlt = [];
const log = (s) => console.log(s);

// ---------- group & order ----------
const groups = new Map();
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
  const photos = list.filter((r) => (r.kind || 'photo') === 'photo');
  const covers = photos.filter((r) => yes(r.cover));
  if (covers.length > 1) problems.push(`${folder}: ${covers.length} rows marked cover — keep one`);
  photos.sort((a, b) => (yes(b.cover) - yes(a.cover)) || a.file.localeCompare(b.file));
  if (!covers.length && photos.length) log(`  ! ${folder}: no cover marked — using ${photos[0].file}`);
  groups.set(folder, photos);
}
if (problems.some((p) => /keep one|not a branch/.test(p))) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const pubPath = (abs) => '/images/' + abs.slice(IMAGES.length + 1).replace(/\\/g, '/');

function clearOld(dir, prefix) {
  if (!existsSync(dir)) return;
  const re = new RegExp(`^${prefix.replace(/[-]/g, '\\-')}-\\d{2}-\\d+\\.(webp|avif)$`);
  for (const f of readdirSync(dir)) if (re.test(f)) rmSync(join(dir, f));
}

async function processPhoto(r, dir, base) {
  const path = join(SRC, r.folder, r.file);
  const { buf } = await decodable(path, readFileSync(path));
  const { width: w, height: h } = orientedSize(await sharp(buf).metadata());
  const focal = parseFocal(r.focal_point);
  const box = cropBox(w, h, PHOTO.ratio, focal);
  if (box.width < PHOTO.widths[0]) throw new Error(`only ${box.width} px wide after the 3:2 crop — at least ${PHOTO.widths[0]} needed`);
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
}

// ---------- hero video ----------
const heroRows = [...(groups.get(HERO_FOLDER) || []), ...(groups.get('.') || [])];
const heroVideo = heroRows.find((r) => (r.kind || '') === 'video' || /\.(mp4|mov|m4v|webm)$/i.test(r.file));
const heroStill = heroRows.find((r) => r !== heroVideo && !/\.(mp4|mov|m4v|webm)$/i.test(r.file));
if (heroVideo) {
  if (!hasTool('ffmpeg') || !hasTool('ffprobe')) {
    problems.push('hero video: ffmpeg / ffprobe not found — the video step was skipped (install ffmpeg and run again); nothing else depends on it');
  } else {
    const src = join(SRC, heroVideo.folder === '.' ? '' : heroVideo.folder, heroVideo.file);
    const dir = join(IMAGES, 'hero');
    const focal = parseFocal(heroVideo.focal_point);
    const fx = focal ? focal.x : 0.5, fy = focal ? focal.y : 0.5;
    // 16:9 crop around the focal point, then down to 1920 × 1080 (never up), 30 fps, no audio, first 20 s
    const vf = [
      `crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'(iw-min(iw,ih*16/9))*${fx}':'(ih-min(ih,iw*9/16))*${fy}'`,
      `scale='min(${HERO.width},iw)':-2:flags=lanczos`,
      `fps=${HERO.fps}`,
      'format=yuv420p',
    ].join(',');
    const common = ['-v', 'error', '-y', '-i', src, '-t', String(HERO.maxSeconds), '-an', '-map_metadata', '-1', '-vf', vf];
    const runs = [
      ['hero.mp4', ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(HERO.mp4Crf), '-maxrate', HERO.mp4Max, '-bufsize', '4M', '-profile:v', 'high', '-movflags', '+faststart']],
      ['hero.webm', ['-c:v', 'libvpx-vp9', '-b:v', HERO.webmRate, '-crf', String(HERO.webmCrf), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2']],
    ];
    if (!DRY) mkdirSync(dir, { recursive: true });
    for (const [name, codec] of runs) {
      if (DRY) continue;
      const r = spawnSync('ffmpeg', [...common, ...codec, join(dir, name)], { encoding: 'utf8' });
      if (r.status !== 0) problems.push(`hero video → ${name}: ${(r.stderr || '').trim().split('\n').pop()}`);
      else {
        const mb = statSync(join(dir, name)).size / 1048576;
        log(`  ${mb > HERO.maxMB ? '!' : '✓'} hero video → /images/hero/${name} (${mb.toFixed(2)} MB${mb > HERO.maxMB ? ` — over ${HERO.maxMB} MB; trim the clip or lower the CRF` : ''})`);
      }
    }
    // poster: the still in the hero folder if one is kept, else the first frame of the cropped video
    let poster;
    if (heroStill) {
      const p = join(SRC, heroStill.folder === '.' ? '' : heroStill.folder, heroStill.file);
      const { buf } = await decodable(p, readFileSync(p));
      const { width, height } = orientedSize(await sharp(buf).metadata());
      poster = await sharp(buf).rotate().extract(cropBox(width, height, 16 / 9, parseFocal(heroStill.focal_point))).png().toBuffer();
    } else if (!DRY) {
      const tmp = join(tmpdir(), `armada-poster-${process.pid}.png`);
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, 'hero.mp4'), '-frames:v', '1', tmp], { encoding: 'utf8' });
      if (r.status === 0) {
        poster = readFileSync(tmp);
        rmSync(tmp, { force: true });
      } else problems.push(`hero poster: ${(r.stderr || '').trim().split('\n').pop()}`);
    }
    if (poster && !DRY) {
      const pm = await sharp(poster).metadata();
      for (const w of HERO.posterWidths.filter((x) => x <= pm.width)) {
        const name = w === HERO.posterWidths.at(-1) ? 'hero-poster.webp' : `hero-poster-${w}.webp`;
        await sharp(poster).resize(w, Math.round((w * 9) / 16)).toColourspace('srgb').webp(PHOTO.webp).toFile(join(dir, name));
      }
      if (pm.width < HERO.posterWidths.at(-1)) await sharp(poster).toColourspace('srgb').webp(PHOTO.webp).toFile(join(dir, 'hero-poster.webp'));
      await writeOg(poster, 'home', null);
      log('  ✓ hero poster → /images/hero/hero-poster.webp (+ 800 / 1400), og/home.jpg');
    }
  }
}

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
