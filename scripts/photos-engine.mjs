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
// Hero (approved 30 Oct 2026; quality pass 5 Nov 2026 — Ahmed: the loop looked worse than his original): a 10–15 s loop
// (20 s max: longer clips are cut), muted, audio track removed, 30 fps.
//   desktop: the source's own frame (no crop when it is 16:9 or wider — the browser covers the hero box; a taller source
//            is cut to 16:9 around the focal point), at most 1920 wide, never upscaled; VP9 WebM + H.264 MP4, TWO-PASS at
//            the bitrate the 8 MB budget allows for the clip's length (x264: tune film + aq-mode 3, which keeps the dark
//            night areas free of blocks and banding; VP9: alt-ref frames, 25 frames look-ahead) — each ≤ 8 MB;
//   mobile:  a 4:5 crop around the focal point at the source's height, at most 720 wide; the same encoders, ≤ 3 MB;
//   posters: the FIRST FRAME of each loop (the same crop and scale), so the switch from poster to video does not jump —
//            desktop 800–1920, mobile 480–720 (≤ its width), AVIF + WebP (the home page's LCP image).
// A file over its budget is encoded once more at a bitrate scaled to fit.
export const HERO = {
  width: 1920, loopSeconds: [10, 15], maxSeconds: 20, fps: 30, maxMB: 8,
  mobile: { ratio: 4 / 5, maxWidth: 720, maxMB: 3 },
  posterWidths: [800, 1200, 1600, 1920], mobileRatio: 4 / 5, mobileWidths: [480, 640, 720],
  v: 3,
};
/** 16 px blurred preview (scripts/lqip.mjs: ≈ 300 bytes, base64 WebP) */
export const LQIP = { width: 16, webp: { quality: 40 } };
/** what a change of any spec must invalidate in the build cache (media-build.mjs keys every entry with it) */
export const SPEC_VERSION = JSON.stringify({ PHOTO, OG, HERO, LQIP, v: 1 });

/**
 * A 3:2 photo around the focal point at every approved width the crop can fill (never upscaled): `<base>-<w>.webp` +
 * `.avif` in `dir`. Orientation applied first; without withMetadata() nothing of the original metadata is written.
 * Returns { widths, width, height, files } (files = the names written, in `dir`). Throws under 480 px.
 * `ratio` (2 Nov 2026): another width / height for a slot that keeps its own (the partners pages' legacy photos —
 * content/partners-photos.json); the widths and encoders are the same.
 */
export async function renderPhoto(buf, focal, dir, base, { dry = false, ratio = PHOTO.ratio } = {}) {
  const { width: w, height: h } = orientedSize(await sharp(buf).metadata());
  const box = cropBox(w, h, ratio, focal);
  if (box.width < PHOTO.widths[0]) throw new Error(`only ${box.width} px wide after the crop — at least ${PHOTO.widths[0]} needed`);
  const widths = PHOTO.widths.filter((x) => x <= box.width);
  const pipe = sharp(buf).rotate().extract(box).toColourspace('srgb');
  const files = [];
  if (!dry) mkdirSync(dir, { recursive: true });
  for (const width of widths) {
    const sized = pipe.clone().resize(width, Math.round(width / ratio), { fit: 'fill' });
    if (!dry) {
      await sized.clone().webp(PHOTO.webp).toFile(join(dir, `${base}-${width}.webp`));
      await sized.clone().avif(PHOTO.avif).toFile(join(dir, `${base}-${width}.avif`));
    }
    files.push(`${base}-${width}.webp`, `${base}-${width}.avif`);
  }
  const largest = widths.at(-1);
  return { widths, width: largest, height: Math.round(largest / ratio), files, source: { w, h } };
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

/** the crop + scale of each hero variant (shared by the loops and their first-frame posters) */
export function heroFilters(probe, focal) {
  const even = (n) => n - (n % 2);
  // desktop: the source's frame when it is 16:9 or wider (the browser covers the box); a taller one is cut to 16:9
  const dBox = probe.width / probe.height >= 16 / 9 ? { left: 0, top: 0, width: even(probe.width), height: even(probe.height) } : evenBox(probe.width, probe.height, 16 / 9, focal);
  const dW = even(Math.min(HERO.width, dBox.width));
  const dH = even(Math.round((dW * dBox.height) / dBox.width));
  // mobile: 4:5 around the focal point, at most 720 wide (its own position: the crop is already centred on the subject)
  const mBox = evenBox(probe.width, probe.height, HERO.mobile.ratio, focal);
  const mW = even(Math.min(HERO.mobile.maxWidth, mBox.width));
  const mH = even(Math.round((mW * mBox.height) / mBox.width));
  const vf = (b, w, h) => [`crop=${b.width}:${b.height}:${b.left}:${b.top}`, `scale=${w}:${h}:flags=lanczos`, `fps=${HERO.fps}`, 'format=yuv420p'].join(',');
  return {
    desktop: { vf: vf(dBox, dW, dH), width: dW, height: dH, position: focalIn(focal, probe.width, probe.height, dBox) },
    mobile: { vf: vf(mBox, mW, mH), width: mW, height: mH, position: focalIn(focal, probe.width, probe.height, mBox) },
  };
}

/** one two-pass encode of `src` through `vf` at `kbps` (VP9 WebM or H.264 MP4) → `out`; the ffmpeg error, or null */
function encodeTwoPass(src, vf, kind, kbps, out) {
  const log = join(tmpdir(), `armada-2pass-${process.pid}-${Date.now()}`);
  const common = ['-v', 'error', '-y', '-i', src, '-t', String(HERO.maxSeconds), '-an', '-sn', '-dn', '-map_metadata', '-1', '-vf', vf];
  const codec = kind === 'webm'
    ? (pass) => ['-c:v', 'libvpx-vp9', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.45)}k`, '-minrate', '0', '-row-mt', '1', '-tile-columns', '2',
        '-auto-alt-ref', '1', '-lag-in-frames', '25', '-deadline', 'good', '-cpu-used', pass === 1 ? '4' : '2']
    : () => ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`,
        '-x264-params', 'aq-mode=3:aq-strength=1.0', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  try {
    const p1 = spawnSync('ffmpeg', [...common, ...codec(1), '-pass', '1', '-passlogfile', log, '-f', kind === 'webm' ? 'webm' : 'mp4', nul], { encoding: 'utf8' });
    if (p1.status !== 0) return (p1.stderr || '').trim().split('\n').pop() || 'pass 1 failed';
    const p2 = spawnSync('ffmpeg', [...common, ...codec(2), '-pass', '2', '-passlogfile', log, ...(kind === 'mp4' ? ['-movflags', '+faststart'] : []), out], { encoding: 'utf8' });
    if (p2.status !== 0) return (p2.stderr || '').trim().split('\n').pop() || 'pass 2 failed';
    return null;
  } finally {
    for (const f of ['-0.log', '-0.log.mbtree', '-0.log.temp', '-0.log.mbtree.temp']) rmSync(`${log}${f}`, { force: true });
  }
}

/**
 * The hero loops from a source video (`probe` = photos-lib ffprobe()) — see HERO: the desktop loop (`names.mp4` /
 * `names.webm`, ≤ 8 MB each) and, when `names.mobileMp4` / `names.mobileWebm` are given, the mobile 4:5 loop (≤ 3 MB each);
 * 30 fps, no audio / subtitle / data / metadata, ≤ 20 s, two-pass. Returns { seconds, problems, notes, sizes, desktop,
 * mobile } (each variant: its filter `vf`, width, height, position).
 */
export function renderHeroVideo(src, probe, focal, dir, names = { mp4: 'hero.mp4', webm: 'hero.webm' }, { dry = false } = {}) {
  const problems = [];
  const notes = [];
  const sizes = {};
  const f = heroFilters(probe, focal);
  const seconds = Math.min(probe.duration || HERO.maxSeconds, HERO.maxSeconds);
  if (probe.duration > HERO.maxSeconds) notes.push(`${probe.duration.toFixed(1)} s — cut to the first ${HERO.maxSeconds} s (the approved loop is ${HERO.loopSeconds.join('–')} s)`);
  else if (probe.duration > HERO.loopSeconds[1]) notes.push(`${probe.duration.toFixed(1)} s — longer than the approved ${HERO.loopSeconds.join('–')} s loop (kept; ${HERO.maxSeconds} s max)`);
  if (f.desktop.width < HERO.width) notes.push(`${f.desktop.width} × ${f.desktop.height} — under ${HERO.width} wide, kept at its size (never upscaled)`);
  const jobs = [
    ['mp4', names.mp4, f.desktop, HERO.maxMB],
    ['webm', names.webm, f.desktop, HERO.maxMB],
    ...(names.mobileMp4 ? [['mp4', names.mobileMp4, f.mobile, HERO.mobile.maxMB]] : []),
    ...(names.mobileWebm ? [['webm', names.mobileWebm, f.mobile, HERO.mobile.maxMB]] : []),
  ];
  const result = { seconds, problems, notes, sizes, desktop: f.desktop, mobile: names.mobileMp4 ? f.mobile : null };
  if (dry) return result;
  mkdirSync(dir, { recursive: true });
  for (const [kind, name, v, maxMB] of jobs) {
    const out = join(dir, name);
    // the bitrate the budget allows for this length (92 %: the container and the rate control's margin take the rest)
    let rate = Math.floor((maxMB * 8 * 1024 * 0.92) / seconds);
    for (let attempt = 0; attempt < 2; attempt++) {
      const err = encodeTwoPass(src, v.vf, kind, rate, out);
      if (err) {
        problems.push(`hero video → ${name}: ${err}`);
        break;
      }
      const mb = statSync(out).size / 1048576;
      if (mb <= maxMB) {
        sizes[name] = { mb: Math.round(mb * 100) / 100, kbps: rate };
        break;
      }
      if (attempt === 1) problems.push(`hero video → ${name}: ${mb.toFixed(2)} MB, over ${maxMB} MB — trim the clip`);
      rate = Math.floor((rate * maxMB * 0.95) / mb); // once more, scaled to the budget
    }
  }
  return result;
}

/** the first frame of a hero loop variant (its `vf`) as a lossless PNG buffer — the poster that matches the loop exactly */
export function heroFrame(src, vf) {
  const tmp = join(tmpdir(), `armada-heroframe-${process.pid}-${Date.now()}.png`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', vf.replace(/,format=yuv420p$/, ''), '-frames:v', '1', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || 'ffmpeg failed');
  try {
    return readFileSync(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * The hero posters from the loops' first frames (already cropped and scaled like the loops): desktop at HERO.posterWidths,
 * mobile at HERO.mobileWidths (≤ the frame's width; its own width when it falls between two), AVIF + WebP —
 * `<names.poster>-<w>.*` / `<names.mobile>-<w>.*`. Returns the same shape as renderPoster.
 */
export async function renderPosterFrames(desktopBuf, mobileBuf, positions, dir, names = { poster: 'hero-poster', mobile: 'hero-poster-m' }, { dry = false } = {}) {
  const out = { files: [] };
  if (!dry) mkdirSync(dir, { recursive: true });
  for (const [key, name, buf, list, pos] of [
    ['poster', names.poster, desktopBuf, HERO.posterWidths, positions.desktop],
    ['poster_mobile', names.mobile, mobileBuf, HERO.mobileWidths, positions.mobile],
  ]) {
    const { width: fw, height: fh } = await sharp(buf).metadata();
    // the listed widths it can fill, its own width when it falls between two (one within 48 px of it is dropped for it)
    let widths = list.filter((w) => w <= fw);
    if (!widths.length || (widths.at(-1) < fw && fw < list.at(-1))) widths = [...widths.filter((w) => fw - w >= 48), fw];
    const pipe = sharp(buf).toColourspace('srgb');
    for (const w of widths) {
      out.files.push(`${name}-${w}.webp`, `${name}-${w}.avif`);
      if (dry) continue;
      const sized = pipe.clone().resize(w, Math.round((w * fh) / fw), { fit: 'fill' });
      await sized.clone().webp({ ...PHOTO.webp, quality: 86 }).toFile(join(dir, `${name}-${w}.webp`));
      await sized.clone().avif({ ...PHOTO.avif, quality: 62 }).toFile(join(dir, `${name}-${w}.avif`));
    }
    const top = widths.at(-1);
    out[key] = { name, widths, width: top, height: Math.round((top * fh) / fw), position: pos };
  }
  return out;
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
