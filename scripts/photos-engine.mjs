// The ONE photo / video engine of the site (1 Nov 2026): every derived file of an approved photo or of the hero video is
// made here, with the specs approved by Ahmed on 30 Oct 2026 (CLAUDE.md §3c). Two callers share it:
//   scripts/photos-import.mjs  the command line (a reviewed folder + manifest → content/images, rooms.json, branches.json)
//   scripts/media-build.mjs    the site build (the photos published from the dashboard «الصور» → .media-build, cached)
// Nothing here knows about folders, manifests or the database: a source buffer / file in, files out, facts back.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { cropBox, orientedSize } from './photos-lib.mjs';

// Sizes (approved 30 Oct 2026, CLAUDE.md §3c / §7): 3:2 photos at 480 / 800 / 1200 / 1600 / 2000 (never upscaled),
// converted to sRGB (sharp converts through the embedded ICC profile, then strips it). Quality pass (Ahmed, 7 Nov 2026 —
// DECISIONS.md 2026-11-07): every photo at WebP q80 (was 78) + AVIF q55 (was 50; AVIF's scale runs lower than WebP's —
// the pair is kept in step, since a browser that reads AVIF never downloads the WebP);
export const PHOTO = { ratio: 3 / 2, widths: [480, 800, 1200, 1600, 2000], webp: { quality: 80, effort: 5 }, avif: { quality: 55, effort: 4 } };
// the hero and the branch photos (cover, story scenes, gallery): WebP q84 + AVIF q64 and one more width, 2560, for
// retina desktops (never upscaled: only an original at least that wide gets it); phones never download it — every
// <img> carries sizes, and the hero / the «فرعانا» cards give phones their own 4:5 / 9:16 files in a <picture>.
export const FINE = { widths: [480, 800, 1200, 1600, 2000, 2560], webp: { quality: 84, effort: 5 }, avif: { quality: 64, effort: 4 } };
// «صورة الجوال» of a branch cover (7 Nov 2026): 9:16 around its focal point — the «فرعانا» card on a phone (about
// 1:2, the text over its lower half) and the branch page's cover under 768 px (shown 4:5 around the focal point).
export const MOBILE_COVER = { ratio: 9 / 16, widths: [480, 750, 1080] };
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
export const SPEC_VERSION = JSON.stringify({ PHOTO, FINE, MOBILE_COVER, OG, HERO, LQIP, v: 2 });

/**
 * A 3:2 photo around the focal point at every approved width the crop can fill (never upscaled): `<base>-<w>.webp` +
 * `.avif` in `dir`. Orientation applied first; without withMetadata() nothing of the original metadata is written.
 * Returns { widths, width, height, files } (files = the names written, in `dir`). Throws under 480 px.
 * `ratio` (2 Nov 2026): another width / height for a slot that keeps its own (the partners pages' legacy photos —
 * content/partners-photos.json); the widths and encoders are the same.
 */
export async function renderPhoto(buf, focal, dir, base, { dry = false, ratio = PHOTO.ratio, fine = false, widths: list } = {}) {
  const { width: w, height: h } = orientedSize(await sharp(buf).metadata());
  const box = cropBox(w, h, ratio, focal);
  const spec = fine ? FINE : PHOTO;
  list ??= spec.widths;
  if (box.width < list[0]) throw new Error(`only ${box.width} px wide after the crop — at least ${list[0]} needed`);
  const widths = list.filter((x) => x <= box.width);
  const pipe = sharp(buf).rotate().extract(box).toColourspace('srgb');
  const files = [];
  if (!dry) mkdirSync(dir, { recursive: true });
  for (const width of widths) {
    const sized = pipe.clone().resize(width, Math.round(width / ratio), { fit: 'fill' });
    if (!dry) {
      await sized.clone().webp(spec.webp).toFile(join(dir, `${base}-${width}.webp`));
      await sized.clone().avif(spec.avif).toFile(join(dir, `${base}-${width}.avif`));
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
      await sized.clone().avif(FINE.avif).toFile(join(dir, `${name}-${w}.avif`));
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
  // the still (7 Nov 2026): the hero's widths and quality, like a slideshow photo
  const variants = [
    ['poster', names.poster, 16 / 9, SLIDE.widths],
    ['poster_mobile', names.mobile, HERO.mobileRatio, SLIDE.mobileWidths],
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
      await sized.clone().webp(FINE.webp).toFile(join(dir, `${name}-${w}.webp`));
      await sized.clone().avif(FINE.avif).toFile(join(dir, `${name}-${w}.avif`));
    }
    const top = widths.at(-1);
    out[key] = { name, widths, width: top, height: Math.round(top / ratio), position: focalIn(focal, pw, ph, box) };
  }
  return out;
}

// ── the home hero as a slideshow (Ahmed, 6 Nov 2026) ─────────────────────────────────────────────────────────────────
// 3–8 photos, each cropped around its focal point like the hero still: 16:9 for desktop and 4:5 for phones, AVIF + WebP
// at the FINE quality. Widths (7 Nov 2026): desktop 800–1920 + 2560 for retina screens; phones 480 / 640 / 750 / 828 /
// 1080 (750 = a 375 px phone at 2×, which also serves a 412 px one at 1.75×; 1080 = 3× screens) — sizes + the <picture>
// media keep every phone on the phone files. «صورة الجوال» (7 Nov 2026): the 4:5 files come from the photo's own phone
// photo when one is published (renderSlide's `only`), else from the desktop photo around its focal point.
// Deferred-media budget (approved by Ahmed, 6 Nov 2026): every file of a photo ≤ 600 KB on desktop and ≤ 250 KB on
// phones — a variant over it is encoded again at a lower quality (never below q30; the build log names each one).
export const SLIDE = {
  widths: [800, 1200, 1600, 1920, 2560], mobileWidths: [480, 640, 750, 828, 1080], mobileRatio: 4 / 5,
  maxKB: { desktop: 600, mobile: 250 }, minQuality: 30, v: 2,
};
async function encodeWithin(pipe, file, fmt, opts, maxBytes) {
  let q = opts.quality;
  for (;;) {
    const buf = await pipe.clone()[fmt]({ ...opts, quality: q }).toBuffer();
    if (buf.length <= maxBytes || q <= SLIDE.minQuality) {
      writeFileSync(file, buf);
      return { bytes: buf.length, quality: q, over: buf.length > maxBytes };
    }
    q = Math.max(SLIDE.minQuality, q - 8);
  }
}
/**
 * One slide of the hero slideshow: `<names.desktop>-<w>.*` (16:9) and `<names.mobile>-<w>.*` (4:5) around the focal
 * point, each file within its budget. Returns { desktop, mobile, files, notes } with each variant's widths, size and
 * object-position.
 */
export async function renderSlide(buf, focal, dir, names = { desktop: 's', mobile: 's-m' }, { dry = false, only = null } = {}) {
  const { width: pw, height: ph } = orientedSize(await sharp(buf).metadata());
  const out = { files: [], notes: [] };
  if (!dry) mkdirSync(dir, { recursive: true });
  for (const [key, name, ratio, list, kb] of [
    ['desktop', names.desktop, 16 / 9, SLIDE.widths, SLIDE.maxKB.desktop],
    ['mobile', names.mobile, SLIDE.mobileRatio, SLIDE.mobileWidths, SLIDE.maxKB.mobile],
  ].filter(([key]) => !only || key === only)) {
    const box = cropBox(pw, ph, ratio, focal);
    let widths = list.filter((w) => w <= box.width);
    if (!widths.length) widths = [box.width]; // under the smallest approved width: its own size, never upscaled
    const pipe = sharp(buf).rotate().extract(box).toColourspace('srgb');
    for (const w of widths) {
      out.files.push(`${name}-${w}.webp`, `${name}-${w}.avif`);
      if (dry) continue;
      const sized = pipe.clone().resize(w, Math.round(w / ratio), { fit: 'fill' });
      for (const [fmt, opts] of [['webp', FINE.webp], ['avif', FINE.avif]]) {
        const r = await encodeWithin(sized, join(dir, `${name}-${w}.${fmt}`), fmt, opts, kb * 1024);
        if (r.quality !== opts.quality) out.notes.push(`${key} ${w} ${fmt}: q${r.quality} to stay within ${kb} KB`);
        if (r.over) out.notes.push(`${key} ${w} ${fmt}: ${Math.round(r.bytes / 1024)} KB, over ${kb} KB even at q${r.quality}`);
      }
    }
    const top = widths.at(-1);
    out[key] = { name, widths, width: top, height: Math.round(top / ratio), position: focalIn(focal, pw, ph, box) };
  }
  return out;
}

// ── the hero scrim, measured (Ahmed, 6 Nov 2026; narrowed to the text, 7 Nov 2026) ───────────────────────────────────
// The lightest Armada Midnight layer that keeps every hero text at WCAG AA over the brightest pixels behind it: the
// eyebrow (Bronze Bright), the subtitle (Porcelain at 85 %) and the outline button (Porcelain) at 4.5:1, the headline
// (Porcelain, large) at 3:1 — each with a margin of 0.2. Measured on the image as the page shows it, only where the text
// can sit (the text block measured on the page, 7 Nov 2026: from the content edge, 620 px wide in Arabic / 630 in
// English, 24–76 % of the 560 px hero from 1024 px up), per layout:
//   m       phones (< 768 px): the whole 4:5 crop (the text spans the screen and most of its height);
//   md      768–1279 px: the whole 16:9 crop (the text spans most of the width there);
//   lg_rtl / lg_ltr  ≥ 1280 px: the start-side 62 % of the 16:9 crop (the text ends by 56 % of the screen at every
//           width from 1280 px; + the 1.08 zoom of a slideshow around the focal point), between the rows the 560 px
//           hero can show behind the text at 1280 px (the widest band; wider screens show less) around the photo's
//           vertical position `posY`, with a 4 % margin.
// Returns alphas in [0.15, 0.92], two decimals, rounded up. The site sets them on the one scrim layer (global.css).
const SCRIM_COLORS = { midnight: [0x14, 0x2a, 0x3b], porcelain: [0xf3, 0xef, 0xe7], bronzeBright: [0xc9, 0xa2, 0x7a] };
export const SCRIM = { min: 0.15, max: 0.92, margin: 0.2, small: 4.5, large: 3, lgShare: 0.62, lgBand: [0.24, 0.76], lgVisible: 0.78, bandMargin: 0.04, sample: 4000, v: 2 };
// the «فرعانا» cards (7 Nov 2026): the gradient sits under the card's text only; its strength is measured like the
// hero's over the lower part of the photo the text can cover (the card's text: the type in Bronze Bright, the tagline
// at 90 %, the description at 75 % and the phone at 85 % of Porcelain — 4.5:1 —, the name large — 3:1).
//   lg  the desktop cover (≈ 1:1 to 1.16:1 window of the 3:2 photo): the lower 60 %;
//   m   the phone (≈ 1:2 window, its own «صورة الجوال» or the desktop photo): the lower 55 %.
export const CARD = { lgFrom: 0.4, mFrom: 0.45, v: 1 };
const lin = (v) => {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const LIN = Float64Array.from({ length: 256 }, (_, v) => lin(v));
/** the brightest pixels of a region (by luminance), as [r, g, b] triples — the ones that decide the scrim (a
 *  1024-bin histogram finds the threshold of the SCRIM.sample brightest, so no sort of a million pixels) */
function brightest(raw, w, h, x0, x1, y0 = 0, y1 = h) {
  const L = new Float32Array((x1 - x0) * (y1 - y0));
  const hist = new Uint32Array(1024);
  let k = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++, k++) {
      const i = (y * w + x) * 3;
      const v = 0.2126 * LIN[raw[i]] + 0.7152 * LIN[raw[i + 1]] + 0.0722 * LIN[raw[i + 2]];
      L[k] = v;
      hist[Math.min(1023, Math.floor(v * 1024))]++;
    }
  }
  let bin = 1023;
  for (let n = 0; bin > 0 && n + hist[bin] < SCRIM.sample; bin--) n += hist[bin];
  const t = bin / 1024;
  const out = [];
  k = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++, k++) {
      if (L[k] >= t) {
        const i = (y * w + x) * 3;
        out.push([raw[i], raw[i + 1], raw[i + 2]]);
      }
    }
  }
  return out;
}
/** the small texts (each a Porcelain share over the background, or Bronze Bright) that decide the alpha at 4.5:1 */
const HERO_TEXTS = [0.85, 1, 'bronze'];
const CARD_TEXTS = [0.75, 0.85, 0.9, 'bronze'];
function alphaFor(pixels, texts = HERO_TEXTS) {
  const M = SCRIM_COLORS.midnight;
  const P = SCRIM_COLORS.porcelain;
  const LB = lum(...SCRIM_COLORS.bronzeBright);
  const need = SCRIM.small + SCRIM.margin; // the 4.5:1 texts decide; the headline's 3:1 is met with them
  const ok = (a) => pixels.every(([r, g, b]) => {
    const bg = [a * M[0] + (1 - a) * r, a * M[1] + (1 - a) * g, a * M[2] + (1 - a) * b];
    const L = lum(...bg);
    return texts.every((t) => {
      if (t === 'bronze') return contrast(LB, L) >= need;
      return contrast(lum(t * P[0] + (1 - t) * bg[0], t * P[1] + (1 - t) * bg[1], t * P[2] + (1 - t) * bg[2]), L) >= need;
    });
  });
  for (let i = Math.round(SCRIM.min * 100); i <= Math.round(SCRIM.max * 100); i++) if (ok(i / 100)) return i / 100;
  return SCRIM.max;
}
/** the alpha rule alone, for a list of [r, g, b] pixels (the dashboard's copy, admin/src/lib/scrim.ts, is unit-tested
 *  against it — scripts/admin-format-check.mjs) */
export const scrimAlphaOf = (pixels, kind = 'hero') => alphaFor(pixels, kind === 'card' ? CARD_TEXTS : HERO_TEXTS);
const rawOf = async (input, width) => sharp(input).resize(width).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
/** the rows of a 16:9 image behind the text at ≥ 1280 px for a vertical position `posY` (0–1) */
export function lgRows(posY = 0.5) {
  const v = SCRIM.lgVisible;
  const top = (1 - v) * posY + SCRIM.lgBand[0] * v - SCRIM.bandMargin;
  const bottom = (1 - v) * posY + SCRIM.lgBand[1] * v + SCRIM.bandMargin;
  return [Math.max(0, top), Math.min(1, bottom)];
}
/** the scrim alphas of one hero picture: `desktop` = the 16:9 image, `mobile` = the 4:5 one (buffers or file paths);
 *  `posY` = the desktop picture's vertical object-position (0–1) */
export async function heroScrim(desktop, mobile, posY = 0.5) {
  const d = await rawOf(desktop, 1440);
  const m = await rawOf(mobile, 720);
  const dw = d.info.width;
  const dh = d.info.height;
  const share = Math.round(dw * SCRIM.lgShare);
  const [r0, r1] = lgRows(posY).map((f) => Math.round(f * dh));
  return {
    m: alphaFor(brightest(m.data, m.info.width, m.info.height, 0, m.info.width)),
    md: alphaFor(brightest(d.data, dw, dh, 0, dw)),
    lg_ltr: alphaFor(brightest(d.data, dw, dh, 0, share, r0, r1)),
    lg_rtl: alphaFor(brightest(d.data, dw, dh, dw - share, dw, r0, r1)),
  };
}
/** the «فرعانا» card gradient of a branch cover: `desktop` = its 3:2 photo, `mobile` = its phone photo (or the desktop
 *  photo again) */
export async function cardScrim(desktop, mobile) {
  const d = await rawOf(desktop, 1200);
  const m = await rawOf(mobile, 720);
  return {
    lg: alphaFor(brightest(d.data, d.info.width, d.info.height, 0, d.info.width, Math.round(d.info.height * CARD.lgFrom)), CARD_TEXTS),
    m: alphaFor(brightest(m.data, m.info.width, m.info.height, 0, m.info.width, Math.round(m.info.height * CARD.mFrom)), CARD_TEXTS),
  };
}
/** the highest of several measures (a video: its posters and frames sampled over the loop) */
export const scrimMax = (list) => list.reduce((a, s) => ({ m: Math.max(a.m, s.m), md: Math.max(a.md, s.md), lg_ltr: Math.max(a.lg_ltr, s.lg_ltr), lg_rtl: Math.max(a.lg_rtl, s.lg_rtl) }), { m: 0, md: 0, lg_ltr: 0, lg_rtl: 0 });
/** frames of a loop, one every `every` seconds (ffmpeg), as PNG buffers — for the scrim of a video hero */
export function loopFrames(src, every = 1) {
  const d = join(tmpdir(), `armada-frames-${process.pid}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  try {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `fps=1/${every}`, join(d, 'f%03d.png')], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || 'ffmpeg failed');
    return readdirSync(d).sort().map((f) => readFileSync(join(d, f)));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
