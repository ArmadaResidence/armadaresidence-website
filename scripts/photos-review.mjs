// Photo review (30 Oct 2026): reads Ahmed's working folder of new photos and writes, into <folder>/_review/ only,
//   contact-sheet.html   one offline page: per folder, thumbnails with file name, pixel size and flags
//   manifest.csv / .json one row per file — fill keep / cover / focal_point / alt_ar / alt_en / caption_* and hand
//                        the CSV to scripts/photos-import.mjs
// The originals are never modified, moved or renamed. Re-running keeps what was already typed into the manifest
// (matched by folder + file name). Layout of the folder: scripts/photos-lib.mjs.
//   node scripts/photos-review.mjs <folder>
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import {
  siteSlugs, kindOf, sha256, decodable, orientedSize, personalMetadata, dHash, hamming, ffprobe, hasTool,
  toCsv, parseCsv, EDITABLE_COLUMNS, IGNORED_FILES, MIN_LONG_SIDE, HERO_FOLDER,
} from './photos-lib.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SRC = process.argv[2] && resolve(process.argv[2]);
if (!SRC || !existsSync(SRC) || !statSync(SRC).isDirectory()) {
  console.error('usage: node scripts/photos-review.mjs <folder>   (e.g. F:\\armada-photos)');
  process.exit(2);
}
const OUT = join(SRC, '_review');
const { folders, rooms, branches } = siteSlugs(REPO);
const ffmpeg = hasTool('ffmpeg') && hasTool('ffprobe');

// Flags: "block" ones make keep default to "no"; "warn" ones keep it "yes" but need a look.
const FLAG = {
  'unknown-folder': ['block', 'folder is not a branch / room slug in content/'],
  unsupported: ['block', 'format not supported (could not be decoded)'],
  duplicate: ['block', 'same file as another one (identical bytes)'],
  'near-duplicate': ['warn', 'looks like the same shot as another file'],
  'low-res': ['warn', `long side under ${MIN_LONG_SIDE} px`],
  portrait: ['warn', 'portrait — the 3:2 / 16:9 crop loses most of it'],
  'personal-exif': ['warn', 'GPS or other personal metadata (stripped on import)'],
  'heic-converted': ['warn', 'HEIC — decoded with ffmpeg'],
  'multiple-covers': ['warn', 'more than one file starts with 01'],
  'low-res-video': ['warn', 'video narrower than 1920 × 1080'],
  'long-video': ['warn', 'longer than 20 s (the import keeps the first 20 s)'],
  'audio-track': ['warn', 'has an audio track (removed on import)'],
  'no-ffmpeg': ['block', 'ffmpeg / ffprobe not found — video not read'],
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    if (IGNORED_FILES.test(name) || name.startsWith('_')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = walk(SRC).filter((p) => kindOf(p) !== 'other' || !/\.(txt|md|csv|json|db|ini)$/i.test(p));
const prev = new Map();
if (existsSync(join(OUT, 'manifest.csv'))) for (const r of parseCsv(readFileSync(join(OUT, 'manifest.csv'), 'utf8'))) prev.set(`${r.folder}/${r.file}`, r);

const rows = [];
const byHash = new Map();
for (const path of files) {
  const rel = relative(SRC, path).split(sep);
  const file = rel.pop();
  const folder = rel.join('/') || '.';
  const kind = kindOf(file);
  const row = { folder, file, kind, width: '', height: '', flags: [], sha256: '', bytes: statSync(path).size, thumb: '', note: '' };
  const isHero = folder === HERO_FOLDER || folder === '.';
  if (!(folders.has(folder) || (isHero && (kind === 'video' || folder === HERO_FOLDER)))) row.flags.push('unknown-folder');
  const buf = readFileSync(path);
  row.sha256 = sha256(buf);
  if (byHash.has(row.sha256)) {
    row.flags.push('duplicate');
    row.note = `same as ${byHash.get(row.sha256)}`;
  } else byHash.set(row.sha256, `${folder}/${file}`);

  if (kind === 'photo') {
    try {
      const { buf: dec, converted } = await decodable(path, buf);
      if (converted) row.flags.push('heic-converted');
      const meta = await sharp(buf).metadata().catch(() => ({}));
      const decMeta = await sharp(dec).metadata();
      const { width, height } = converted ? { width: decMeta.width, height: decMeta.height } : orientedSize(decMeta);
      Object.assign(row, { width, height });
      if (Math.max(width, height) < MIN_LONG_SIDE) row.flags.push('low-res');
      if (height > width) row.flags.push('portrait');
      const personal = personalMetadata(meta);
      if (personal.length) {
        row.flags.push('personal-exif');
        row.note = [row.note, personal.join(', ')].filter(Boolean).join('; ');
      }
      row.dhash = await dHash(dec);
      row.thumb = (await sharp(dec).rotate().resize({ width: 360, height: 360, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
    } catch (e) {
      row.flags.push('unsupported');
      row.note = String(e.message || e).slice(0, 160);
    }
  } else if (kind === 'video') {
    if (!ffmpeg) row.flags.push('no-ffmpeg');
    else {
      try {
        const v = ffprobe(path);
        Object.assign(row, { width: v.width, height: v.height });
        row.note = `${v.codec}, ${v.duration.toFixed(1)} s`;
        if (v.height > v.width) row.flags.push('portrait');
        else if (v.width < 1920 || v.height < 1080) row.flags.push('low-res-video');
        if (v.duration > 20) row.flags.push('long-video');
        if (v.audio) row.flags.push('audio-track');
        if (v.gps) row.flags.push('personal-exif');
        const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(Math.min(1, v.duration / 2)), '-i', path, '-frames:v', '1', '-vf', 'scale=360:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], { maxBuffer: 1 << 24 });
        if (r.status === 0 && r.stdout.length) row.thumb = r.stdout.toString('base64');
      } catch (e) {
        row.flags.push('unsupported');
        row.note = String(e.message || e).slice(0, 160);
      }
    }
  } else {
    row.flags.push('unsupported');
  }
  rows.push(row);
  process.stdout.write('.');
}
process.stdout.write('\n');

// near-duplicates (same shot, different file) — only among photos that are not already exact duplicates
const photos = rows.filter((r) => r.dhash && !r.flags.includes('duplicate'));
for (let i = 0; i < photos.length; i++)
  for (let j = i + 1; j < photos.length; j++)
    if (hamming(photos[i].dhash, photos[j].dhash) <= 4) {
      for (const [a, b] of [[photos[i], photos[j]], [photos[j], photos[i]]]) {
        if (!a.flags.includes('near-duplicate')) a.flags.push('near-duplicate');
        a.note = [a.note, `similar to ${b.folder}/${b.file}`].filter(Boolean).join('; ');
      }
    }

// covers: a file starting with 01; more than one → flag them all
const byFolder = new Map();
for (const r of rows) (byFolder.get(r.folder) || byFolder.set(r.folder, []).get(r.folder)).push(r);
for (const list of byFolder.values()) {
  const covers = list.filter((r) => /^01/.test(r.file) && r.kind === 'photo');
  if (covers.length > 1) for (const r of covers) r.flags.push('multiple-covers');
}

// manifest rows: defaults, then whatever was already typed in an earlier run
for (const r of rows) {
  const blocked = r.flags.some((f) => FLAG[f]?.[0] === 'block');
  Object.assign(r, { keep: blocked ? 'no' : 'yes', cover: /^01/.test(r.file) && r.kind === 'photo' ? 'yes' : 'no', focal_point: '', alt_ar: '', alt_en: '', caption_ar: '', caption_en: '' });
  const p = prev.get(`${r.folder}/${r.file}`);
  if (p) for (const c of EDITABLE_COLUMNS) if (p[c] !== undefined) r[c] = p[c];
}

mkdirSync(OUT, { recursive: true });
const manifestRows = rows.map((r) => ({ ...r, flags: r.flags.join(' ') }));
writeFileSync(join(OUT, 'manifest.csv'), toCsv(manifestRows));
writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      _note: 'Generated by scripts/photos-review.mjs. Edit manifest.csv (or this file) and pass it to scripts/photos-import.mjs. Columns to fill: keep (yes/no), cover (yes/no), focal_point (x,y in %), alt_ar, alt_en, caption_ar, caption_en.',
      source: SRC,
      generated: new Date().toISOString(),
      rows: manifestRows.map(({ thumb, dhash, bytes, note, ...r }) => ({ ...r, note })),
    },
    null,
    2,
  ) + '\n',
);

// ---------- contact sheet ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const roomName = new Map(JSON.parse(readFileSync(join(REPO, 'content', 'rooms.json'), 'utf8')).rooms.map((r) => [`${r.branch}/${r.slug}`, `${r.name_ar} · ${r.name_en}`]));
const expected = [...branches.map((b) => `${b}/branch`), ...rooms.map((r) => `${r.branch}/${r.slug}`)];
const missing = expected.filter((f) => !byFolder.has(f));
const flagCounts = {};
for (const r of rows) for (const f of r.flags) flagCounts[f] = (flagCounts[f] || 0) + 1;
const chip = (f) => `<span class="chip ${FLAG[f]?.[0] || 'warn'}" title="${esc(FLAG[f]?.[1] || f)}">${esc(f)}</span>`;
const sections = [...byFolder.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([folder, list]) => {
    const known = folders.has(folder) || folder === HERO_FOLDER || folder === '.';
    const label = folder.endsWith('/branch') ? 'Branch photos' : roomName.get(folder) || (folder === HERO_FOLDER || folder === '.' ? 'Home hero' : 'Unknown folder');
    const cards = list
      .map(
        (r) => `<figure class="${r.keep === 'yes' ? '' : 'off'}">
  <div class="thumb">${r.thumb ? `<img src="data:image/jpeg;base64,${r.thumb}" alt="">` : '<span>no preview</span>'}${r.cover === 'yes' ? '<b class="cover">cover</b>' : ''}${r.kind === 'video' ? '<b class="vid">video</b>' : ''}</div>
  <figcaption><strong dir="auto">${esc(r.file)}</strong><span>${r.width ? `${r.width} × ${r.height}` : '—'} · ${(r.bytes / 1048576).toFixed(1)} MB</span>
  <span class="chips">${r.flags.map(chip).join('') || '<span class="chip ok">ok</span>'}</span>${r.note ? `<small dir="auto">${esc(r.note)}</small>` : ''}</figcaption>
</figure>`,
      )
      .join('\n');
    return `<section><h2><code>${esc(folder)}</code> <span dir="auto">${esc(label)}</span> <em>${list.length} file${list.length === 1 ? '' : 's'}</em>${known ? '' : chip('unknown-folder')}</h2><div class="grid">${cards}</div></section>`;
  })
  .join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Photo review — ${esc(basename(SRC))}</title>
<style>
:root{--midnight:#142A3B;--bronze:#A97C50;--porcelain:#F3EFE7;--ink:#1f2933;--muted:#52606d;--red:#a61b1b;--amber:#8a5a00}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,"Segoe UI",Tahoma,sans-serif;background:var(--porcelain);color:var(--ink)}
header{background:var(--midnight);color:var(--porcelain);padding:20px 24px}header h1{margin:0 0 4px;font-size:20px}header p{margin:0;opacity:.85}
main{padding:16px 24px 48px}.summary{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
section{margin:24px 0}h2{font-size:16px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;border-bottom:2px solid var(--bronze);padding-bottom:6px}
h2 em{font-style:normal;color:var(--muted);font-weight:400}code{background:#fff;padding:1px 6px;border-radius:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
figure{margin:0;background:#fff;border:1px solid #ddd5c8;border-radius:8px;overflow:hidden}figure.off{opacity:.55}
.thumb{position:relative;aspect-ratio:3/2;background:#e7e1d6;display:flex;align-items:center;justify-content:center}
.thumb img{width:100%;height:100%;object-fit:contain}.thumb b{position:absolute;top:6px;inset-inline-start:6px;background:var(--midnight);color:#fff;font-size:11px;padding:2px 6px;border-radius:4px}
.thumb b.vid{inset-inline-start:auto;inset-inline-end:6px;background:var(--bronze)}
figcaption{padding:8px 10px;display:flex;flex-direction:column;gap:4px}figcaption strong{word-break:break-all}figcaption span{color:var(--muted)}
small{color:var(--muted);word-break:break-word}.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:11px;padding:1px 7px;border-radius:10px;border:1px solid}.chip.block{color:var(--red);border-color:var(--red)}
.chip.warn{color:var(--amber);border-color:var(--amber)}.chip.ok{color:#2f6b3a;border-color:#2f6b3a}
.missing{background:#fff;border:1px solid var(--red);border-radius:8px;padding:10px 14px}
</style></head><body>
<header><h1>Photo review — ${esc(basename(SRC))}</h1><p>${rows.length} files · generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} · originals untouched · fill <code style="color:var(--ink)">_review/manifest.csv</code> then run <code style="color:var(--ink)">node scripts/photos-import.mjs …/_review/manifest.csv</code></p></header>
<main>
<div class="summary">${Object.entries(flagCounts).map(([f, n]) => `${chip(f)}<span>${n}</span>`).join(' ') || '<span class="chip ok">no flags</span>'}</div>
${missing.length ? `<div class="missing"><strong>Folders with no photos yet:</strong> ${missing.map((f) => `<code>${esc(f)}</code>`).join(' ')}</div>` : ''}
${sections}
</main></body></html>
`;
writeFileSync(join(OUT, 'contact-sheet.html'), html);

console.log(`✓ ${rows.length} files reviewed → ${join(OUT, 'contact-sheet.html')}`);
console.log(`  manifest: ${join(OUT, 'manifest.csv')} (+ .json)`);
for (const [f, n] of Object.entries(flagCounts)) console.log(`  ${FLAG[f]?.[0] === 'block' ? '✗' : '!'} ${f}: ${n} — ${FLAG[f]?.[1] || ''}`);
if (missing.length) console.log(`  folders with no photos: ${missing.join(', ')}`);
if (!ffmpeg) console.log('  NOTE: ffmpeg / ffprobe not found — videos and HEVC HEIC files cannot be read.');
