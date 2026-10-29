// Shared helpers for the photo pipeline (scripts/photos-review.mjs → scripts/photos-import.mjs, 30 Oct 2026).
// Input layout (Ahmed's working folder, outside the repo):
//   <root>/<branch-slug>/branch/…          branch photos (branches.json → photos)
//   <root>/<branch-slug>/<room-slug>/…     room-type photos (rooms.json → photos)
//   <root>/hero/…                          the home page hero video (+ optional poster still)
// A file name starting with "01" is the folder's cover. Folders starting with "_" (e.g. _review) are ignored.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

export const PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif', '.heic', '.heif'];
export const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm'];
export const IGNORED_FILES = /^(\.|thumbs\.db$|desktop\.ini$)/i;
export const MIN_LONG_SIDE = 2400; // review flag: below this the 1920 output has no headroom for the crop
export const HERO_FOLDER = 'hero';

/** Branch and room slugs the site knows (content/branches.json, content/rooms.json). */
export function siteSlugs(root) {
  const branches = JSON.parse(readFileSync(join(root, 'content', 'branches.json'), 'utf8')).branches.map((b) => b.slug);
  const rooms = JSON.parse(readFileSync(join(root, 'content', 'rooms.json'), 'utf8')).rooms.map((r) => ({ branch: r.branch, slug: r.slug }));
  const folders = new Map(); // "airport-road/twin-room" → { branch, room } (room null = branch photos)
  for (const b of branches) folders.set(`${b}/branch`, { branch: b, room: null });
  for (const r of rooms) folders.set(`${r.branch}/${r.slug}`, { branch: r.branch, room: r.slug });
  return { branches, rooms, folders };
}

export function kindOf(file) {
  const e = extname(file).toLowerCase();
  if (PHOTO_EXT.includes(e)) return 'photo';
  if (VIDEO_EXT.includes(e)) return 'video';
  return 'other';
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function hasTool(name) {
  const r = spawnSync(name, ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}

/**
 * Decodable buffer for sharp. sharp's prebuilt libvips reads AVIF but not HEVC-coded HEIC, so a HEIC that sharp
 * refuses goes through ffmpeg (first frame / primary image → PNG). Returns { buf, converted } or throws.
 */
export async function decodable(path, buf) {
  try {
    await sharp(buf).metadata().then((m) => {
      if (!m.width) throw new Error('no size');
    });
    await sharp(buf).resize(8).raw().toBuffer(); // metadata alone can succeed on an undecodable HEIC
    return { buf, converted: false };
  } catch (e) {
    if (!/\.(heic|heif)$/i.test(path) || !hasTool('ffmpeg')) throw e;
    const dir = mkdtempSync(join(tmpdir(), 'armada-heic-'));
    try {
      const out = join(dir, 'frame.png');
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path, '-frames:v', '1', out], { encoding: 'utf8' });
      if (r.status !== 0 || !existsSync(out)) throw new Error(`ffmpeg could not decode: ${(r.stderr || '').trim().split('\n').pop()}`);
      return { buf: readFileSync(out), converted: true };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Width/height as displayed (EXIF orientation 5–8 swaps the axes). */
export function orientedSize(meta) {
  const swap = (meta.orientation || 1) >= 5;
  return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/**
 * Personal metadata in an image: GPS position, owner / author / serial numbers (EXIF), creator or location (XMP),
 * by-line / contact (IPTC). Returns a list of short labels; empty = nothing personal found.
 */
export function personalMetadata(meta) {
  const found = new Set();
  if (meta.exif) for (const f of exifPersonal(meta.exif)) found.add(f);
  if (meta.xmp) {
    const x = meta.xmp.toString('utf8');
    if (/GPS(Latitude|Longitude)/.test(x)) found.add('gps');
    if (/<dc:creator|Iptc4xmpCore:CreatorContactInfo|photoshop:AuthorsPosition|exif(EX)?:CameraOwnerName|aux:SerialNumber/.test(x)) found.add('author/owner (XMP)');
    if (/photoshop:(City|State|Country)|Iptc4xmpCore:Location/.test(x)) found.add('location (XMP)');
  }
  if (meta.iptc) {
    const b = meta.iptc;
    for (let i = 0; i + 2 < b.length; i++) {
      if (b[i] === 0x1c && b[i + 1] === 0x02 && [0x50, 0x55, 0x5a, 0x5c, 0x5f, 0x76].includes(b[i + 2])) {
        found.add('by-line / place (IPTC)');
        break;
      }
    }
  }
  return [...found];
}

function exifPersonal(exif) {
  const out = [];
  try {
    const off = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
    const t = exif.subarray(off);
    const le = t.toString('latin1', 0, 2) === 'II';
    const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
    const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
    const ifd = (o) => {
      const tags = new Map();
      if (!o || o + 2 > t.length) return tags;
      const n = u16(o);
      for (let i = 0; i < n; i++) {
        const e = o + 2 + i * 12;
        if (e + 12 > t.length) break;
        tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8) });
      }
      return tags;
    };
    const ifd0 = ifd(u32(4));
    if (ifd0.has(0x8825)) {
      const gps = ifd(ifd0.get(0x8825).value);
      if (gps.has(2) || gps.has(4)) out.push('gps');
    }
    if (ifd0.has(0x013b) || ifd0.has(0x9c9d)) out.push('author (EXIF)');
    if (ifd0.has(0x8769)) {
      const ex = ifd(ifd0.get(0x8769).value);
      if (ex.has(0xa430)) out.push('camera owner (EXIF)');
      if (ex.has(0xa431) || ex.has(0xa435)) out.push('serial number (EXIF)');
    }
  } catch {
    out.push('unreadable EXIF');
  }
  return out;
}

/** 64-bit difference hash for near-duplicate detection (Hamming distance ≤ 4 ≈ the same shot). */
export async function dHash(buf) {
  const px = await sharp(buf).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
  return bits;
}
export const hamming = (a, b) => [...a].reduce((n, c, i) => n + (c !== b[i] ? 1 : 0), 0);

export function ffprobe(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || 'ffprobe failed').trim());
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!v) throw new Error('no video stream');
  const rot = Math.abs(Number(v.tags?.rotate || (v.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation || 0)) % 180;
  const tags = { ...(j.format?.tags || {}), ...(v.tags || {}) };
  return {
    width: rot === 90 ? v.height : v.width,
    height: rot === 90 ? v.width : v.height,
    duration: Number(j.format?.duration || v.duration || 0),
    codec: v.codec_name,
    audio: (j.streams || []).some((s) => s.codec_type === 'audio'),
    gps: Object.keys(tags).some((k) => /location/i.test(k)),
  };
}

// ---------- manifest (CSV for Excel: UTF-8 with BOM, CRLF; JSON alongside) ----------
export const MANIFEST_COLUMNS = [
  'folder', 'file', 'kind', 'width', 'height', 'flags', 'sha256',
  'keep', 'cover', 'focal_point', 'alt_ar', 'alt_en', 'caption_ar', 'caption_en',
];
export const EDITABLE_COLUMNS = ['keep', 'cover', 'focal_point', 'alt_ar', 'alt_en', 'caption_ar', 'caption_en'];

const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows) {
  return '﻿' + [MANIFEST_COLUMNS.join(','), ...rows.map((r) => MANIFEST_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** RFC 4180 reader; the delimiter (comma or semicolon — Excel in some locales) is taken from the header line. */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const d = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!head) return [];
  const cols = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

export function readManifest(path) {
  const text = readFileSync(path, 'utf8');
  return path.toLowerCase().endsWith('.json') ? JSON.parse(text).rows : parseCsv(text);
}

export const yes = (v) => /^(yes|y|true|1|نعم)$/i.test(String(v || '').trim());

/** "x,y" focal point as fractions: "0.5,0.3", "50,30" or "50%,30%" (percent), or top / bottom / left / right / center. */
export function parseFocal(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  const words = { center: [0.5, 0.5], centre: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5] };
  if (words[s]) return { x: words[s][0], y: words[s][1] };
  const m = s.match(/^(-?[\d.]+)\s*%?\s*[,;\s]\s*(-?[\d.]+)\s*%?$/);
  if (!m) throw new Error(`focal point "${v}" — use x,y (e.g. 50,30 for 50 % across, 30 % down)`);
  let x = Number(m[1]), y = Number(m[2]);
  if (x > 1 || y > 1 || s.includes('%')) { x /= 100; y /= 100; }
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new Error(`focal point "${v}" is outside the photo`);
  return { x, y };
}

/** Largest box of `ratio` (w/h) inside w×h, centred on the focal point and kept inside the image. */
export function cropBox(w, h, ratio, focal) {
  let cw = w, ch = Math.round(w / ratio);
  if (ch > h) { ch = h; cw = Math.round(h * ratio); }
  const fx = focal ? focal.x : 0.5, fy = focal ? focal.y : 0.5;
  const left = Math.min(Math.max(Math.round(fx * w - cw / 2), 0), w - cw);
  const top = Math.min(Math.max(Math.round(fy * h - ch / 2), 0), h - ch);
  return { left, top, width: cw, height: ch };
}
