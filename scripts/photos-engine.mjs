// The ONE photo / video engine of the site (1 Nov 2026): every derived file of an approved photo or of the hero video is
// made here, with the specs approved by Ahmed on 30 Oct 2026 (CLAUDE.md §3c). Two callers share it:
//   scripts/photos-import.mjs  the command line (a reviewed folder + manifest → content/images, rooms.json, branches.json)
//   scripts/media-build.mjs    the site build (the photos published from the dashboard «الصور» → .media-build, cached)
// Nothing here knows about folders, manifests or the database: a source buffer / file in, files out, facts back.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { cropBox, orientedSize } from './photos-lib.mjs';

// Sizes (approved 30 Oct 2026, CLAUDE.md §3c / §7): 3:2 photos at 480 / 800 / 1200 / 1600 / 2000 (never upscaled),
// AVIF ≈ q50 + WebP ≈ q78, converted to sRGB (sharp converts through the embedded ICC profile, then strips it).
export const PHOTO = { ratio: 3 / 2, widths: [480, 800, 1200, 1600, 2000], webp: { quality: 78, effort: 5 }, avif: { quality: 50, effort: 4 } };
export const OG = { width: 1200, height: 630, jpeg: { quality: 82, mozjpeg: true } };
// Hero (approved 30 Oct 2026): a 10–15 s loop (20 s max: longer clips are cut), muted, audio track removed, 1920 × 1080
// H.264 MP4 ≤ 4 MB + WebM (VP9, same budget). The bitrate cap follows the clip length so the file fits the budget; a
// file still over it is encoded once more at a fixed lower bitrate. Poster: 16:9 for desktop + an art-directed 4:5
// crop for mobile, both around the focal point, AVIF + WebP — the home page's LCP image.
export const HERO = {
  width: 1920, height: 1080, loopSeconds: [10, 15], maxSeconds: 20, fps: 30, maxMB: 4, mp4Crf: 24, webmCrf: 34,
  posterWidths: [800, 1200, 1600, 2000], mobileRatio: 4 / 5, mobileWidths: [480, 800, 1200],
};
/** 16 px blurred preview (scripts/lqip.mjs: ≈ 300 bytes, base64 WebP) */
export const LQIP = { width: 16, webp: { quality: 40 } };
/** what a change of any spec must invalidate in the build cache (media-build.mjs keys every entry with it) */
export const SPEC_VERSION = JSON.stringify({ PHOTO, OG, HERO, LQIP, v: 1 });

/**
 * A 3:2 photo around the focal point at every approved width the crop can fill (never upscaled): `<base>-<w>.webp` +
 * `.avif` in `dir`. Orientation applied first; without withMetadata() nothing of the original metadata is written.
 * Returns { widths, width, height, files } (files = the names written, in `dir`). Throws under 480 px.
 */
export async function renderPhoto(buf, focal, dir, base, { dry = false } = {}) {
  const { width: w, height: h } = orientedSize(await sharp(buf).metadata());
  const box = cropBox(w, h, PHOTO.ratio, focal);
  if (box.width < PHOTO.widths[0]) throw new Error(`only ${box.width} px wide after the 3:2 crop — at least ${PHOTO.widths[0]} needed`);
  const widths = PHOTO.widths.filter((x) => x <= box.width);
  const pipe = sharp(buf).rotate().extract(box).toColourspace('srgb');
  const files = [];
  if (!dry) mkdirSync(dir, { recursive: true });
  for (const width of widths) {
    const sized = pipe.clone().resize(width, Math.round(width / PHOTO.ratio), { fit: 'fill' });
    if (!dry) {
      await sized.clone().webp(PHOTO.webp).toFile(join(dir, `${base}-${width}.webp`));
      await sized.clone().avif(PHOTO.avif).toFile(join(dir, `${base}-${width}.avif`));
    }
    files.push(`${base}-${width}.webp`, `${base}-${width}.avif`);
  }
  const largest = widths.at(-1);
  return { widths, width: largest, height: Math.round(largest / PHOTO.ratio), files, source: { w, h } };
}

/** The 1200 × 630 Open Graph crop of an image (orientation applied), around the focal point, as `file` (JPEG). */
export async function renderOg(buf, focal, file, { dry = false } = {}) {
  const { width, height } = orientedSize(await sharp(buf).metadata());
  if (!dry) {
    mkdirSync(join(file, '..'), { recursive: true });
    await sharp(buf).rotate().extract(cropBox(width, height, OG.width / OG.height, focal)).resize(OG.width, OG.height).toColourspace('srgb').jpeg(OG.jpeg).toFile(file);
  }
}

/** The 16 px LQIP data URI of an image file or buffer (the same recipe as scripts/lqip.mjs). */
export async function lqipOf(input) {
  const buf = await sharp(input).resize(LQIP.width).webp(LQIP.webp).toBuffer();
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

/** Even crop box for ffmpeg (yuv420p needs even sizes), the same focal rule as the photos (cropBox). */
export function evenBox(w, h, ratio, focal) {
  const b = cropBox(w, h, ratio, focal);
  const ev = (n) => n - (n % 2);
  return { left: ev(b.left), top: ev(b.top), width: ev(b.width), height: ev(b.height) };
}
/** The focal point as a position inside a crop (object-position), so the subject stays in view at any hero height. */
export function focalIn(focal, w, h, box) {
  if (!focal) return '50% 50%';
  const pct = (v) => Math.min(100, Math.max(0, Math.round(v * 100)));
  return `${pct((focal.x * w - box.left) / box.width)}% ${pct((focal.y * h - box.top) / box.height)}%`;
}

/**
 * The hero loop from a source video (`probe` = photos-lib ffprobe()): 16:9 crop around the focal point, down to 1920 ×
 * 1080, 30 fps, no audio / subtitle / data / metadata, ≤ 20 s, MP4 (H.264) + WebM (VP9) each ≤ 4 MB — `names.mp4` /
 * `names.webm` in `dir`. Returns { seconds, problems, notes, sizes }.
 */
export function renderHeroVideo(src, probe, focal, dir, names = { mp4: 'hero.mp4', webm: 'hero.webm' }, { dry = false } = {}) {
  const problems = [];
  const notes = [];
  const sizes = {};
  const box = evenBox(probe.width, probe.height, 16 / 9, focal);
  const seconds = Math.min(probe.duration || HERO.maxSeconds, HERO.maxSeconds);
  if (probe.duration > HERO.maxSeconds) notes.push(`${probe.duration.toFixed(1)} s — cut to the first ${HERO.maxSeconds} s (the approved loop is ${HERO.loopSeconds.join('–')} s)`);
  else if (probe.duration > HERO.loopSeconds[1]) notes.push(`${probe.duration.toFixed(1)} s — longer than the approved ${HERO.loopSeconds.join('–')} s loop (kept; ${HERO.maxSeconds} s max)`);
  if (box.width < HERO.width) notes.push(`${box.width} × ${box.height} after the 16:9 crop — under ${HERO.width} × ${HERO.height}, kept at its size (never upscaled)`);
  const vf = [`crop=${box.width}:${box.height}:${box.left}:${box.top}`, `scale='min(${HERO.width},iw)':-2:flags=lanczos`, `fps=${HERO.fps}`, 'format=yuv420p'].join(',');
  const common = ['-v', 'error', '-y', '-i', src, '-t', String(HERO.maxSeconds), '-an', '-sn', '-dn', '-map_metadata', '-1', '-vf', vf];
  // bitrate cap that fits the budget for this length (92 % of maxMB; the container takes the rest)
  const kbps = Math.floor((HERO.maxMB * 8 * 1024 * 0.92) / seconds);
  const enc = {
    mp4: (rate) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(HERO.mp4Crf), '-maxrate', `${rate}k`, '-bufsize', `${rate * 2}k`, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    webm: (rate) => ['-c:v', 'libvpx-vp9', '-crf', String(HERO.webmCrf), '-b:v', `${rate}k`, '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2'],
  };
  if (dry) return { seconds, problems, notes, sizes };
  mkdirSync(dir, { recursive: true });
  for (const [kind, args] of Object.entries(enc)) {
    const out = join(dir, names[kind]);
    let rate = kbps;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = spawnSync('ffmpeg', [...common, ...args(rate), out], { encoding: 'utf8' });
      if (r.status !== 0) {
        problems.push(`hero video → ${names[kind]}: ${(r.stderr || '').trim().split('\n').pop()}`);
        break;
      }
      const mb = statSync(out).size / 1048576;
      if (mb <= HERO.maxMB) {
        sizes[kind] = { mb, rate };
        break;
      }
      if (attempt === 1) problems.push(`hero video → ${names[kind]}: ${mb.toFixed(2)} MB, over ${HERO.maxMB} MB — trim the clip`);
      rate = Math.floor((rate * HERO.maxMB * 0.95) / mb); // once more, scaled to the budget
    }
  }
  return { seconds, problems, notes, sizes };
}

/** The first frame of a video as a PNG buffer (the poster when no still was given), or throws. */
export function videoFrame(src) {
  const tmp = join(tmpdir(), `armada-poster-${process.pid}-${Date.now()}.png`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-frames:v', '1', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || 'ffmpeg failed');
  try {
    return readFileSync(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * The hero poster: 16:9 for desktop (800–2000) + the art-directed 4:5 crop for mobile (480–1200), both around the focal
 * point, AVIF + WebP — `<names.poster>-<w>.*` and `<names.mobile>-<w>.*` in `dir`. Returns { poster, poster_mobile, files }
 * with each variant's widths, size and object-position (the focal point inside the crop).
 */
export async function renderPoster(buf, focal, dir, names = { poster: 'hero-poster', mobile: 'hero-poster-m' }, { dry = false } = {}) {
  const { width: pw, height: ph } = orientedSize(await sharp(buf).metadata());
  const out = { files: [] };
  if (!dry) mkdirSync(dir, { recursive: true });
  const variants = [
    ['poster', names.poster, 16 / 9, HERO.posterWidths],
    ['poster_mobile', names.mobile, HERO.mobileRatio, HERO.mobileWidths],
  ];
  for (const [key, name, ratio, list] of variants) {
    const box = cropBox(pw, ph, ratio, focal);
    let widths = list.filter((w) => w <= box.width);
    if (!widths.length) widths = [box.width]; // under the smallest approved width: its own size, never upscaled
    const pipe = sharp(buf).rotate().extract(box).toColourspace('srgb');
    for (const w of widths) {
      out.files.push(`${name}-${w}.webp`, `${name}-${w}.avif`);
      if (dry) continue;
      const sized = pipe.clone().resize(w, Math.round(w / ratio), { fit: 'fill' });
      await sized.clone().webp(PHOTO.webp).toFile(join(dir, `${name}-${w}.webp`));
      await sized.clone().avif(PHOTO.avif).toFile(join(dir, `${name}-${w}.avif`));
    }
    const top = widths.at(-1);
    out[key] = { name, widths, width: top, height: Math.round(top / ratio), position: focalIn(focal, pw, ph, box) };
  }
  return out;
}
