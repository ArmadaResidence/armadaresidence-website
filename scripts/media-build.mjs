// The site build's media step (1 Nov 2026, dashboard «الصور»): the photos and the hero video PUBLISHED from the
// dashboard become the site's derived files and the data the pages read. Run by build.py before `astro build`.
//
//   1. the manifest: public.media_site_manifest (service role) — every item whose target was published (`live`), or,
//      for a dry job, its targets as they would be published now; or a local fixture (--fixture <dir> / MEDIA_FIXTURE:
//      <dir>/manifest.json + the files next to it — the generated sample set of scripts/media-sample.mjs);
//   2. every item through the one engine (scripts/photos-engine.mjs — the specs of CLAUDE.md §3c: 3:2 at 480–2000,
//      AVIF q50 + WebP q78, sRGB, metadata stripped, LQIP, the 1200 × 630 OG crop of each cover, the hero poster 16:9 +
//      4:5, the hero loop ≤ 20 s / ≤ 4 MB / no audio), with a CACHE keyed by the original's sha256 + the focal point +
//      the recipe + the specs (SPEC_VERSION): an unchanged photo is never downloaded or processed again;
//   3. .media-build/images/media/** (copied to public/images/media/ by build.py — never committed) and
//      content/media.generated.json (gitignored): what src/lib/content.ts merges into the rooms, the branches and their
//      story scenes, what the home hero renders, the section galleries, their LQIPs;
//   4. .media-build/report.json + the GitHub step summary / outputs (manifest_at, items) for the deploy workflow.
// Dining (2 Nov 2026): the published venues of «المطاعم والمقاهي» (public.dining_site_manifest, service role — or the
// fixture's venues.json) go into the same data file (`venues`: active and coming soon only; a hidden venue never), each
// SVG logo as its own content-addressed file; the targets dining (per venue), hall and place (per Discover Taif place,
// cover only) are rendered like the room photos (`dining`, `halls`, `places`). Offers (2 Nov 2026): the target offer
// (one per offer of «العروض», cover only, no OG image) → `offers`.
// Blog (3 Nov 2026): the target blog (one per article of «المدونة», cover + the photos placed in its text, each with
// its OG crop — the editor may pick any of them for sharing) → `articles`: { <slug>: { photos: [{ id, …, og }] } }.
// Partners pages (2 Nov 2026): the target partners (one per photo slot of /partners/, content/partners-photos.json) is
// cropped to that slot's legacy ratio, no OG crop (`partners`: { <slot>: { photos: [one] } }).
// Without SUPABASE_SERVICE_ROLE_KEY (a local build, the check suite) and without a fixture the data file is written
// empty and nothing else changes: the site renders exactly as before (placeholders). WITH the key a failure is fatal —
// a transient error must never publish a site without its photos.
//   node scripts/media-build.mjs [--fixture <dir>] [--out <dir>] [--cache <dir>] [--data <file>] [--plan]
// --plan reads the manifest and the cache only and writes `ffmpeg=true|false` to the GitHub outputs: true when a hero
// video (or a HEIC photo, which sharp's libvips cannot decode) must be processed — the workflow installs ffmpeg then.
// Env: SUPABASE_URL (else the origin of PUBLIC_BOOKING_ENDPOINT), SUPABASE_SERVICE_ROLE_KEY, MEDIA_JOB (+ MEDIA_DRY_RUN
// = true for a dry job), MEDIA_FIXTURE, MEDIA_CACHE.
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { decodable, ffprobe, hasTool, sha256 } from './photos-lib.mjs';
import { cardScrim, heroFrame, heroScrim, loopFrames, lqipOf, MOBILE_COVER, renderHeroVideo, renderOg, renderPhoto, renderPoster, renderPosterFrames, renderSlide, SCRIM, scrimMax, SLIDE, SPEC_VERSION, videoFrame } from './photos-engine.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const FIXTURE = opt('--fixture') || process.env.MEDIA_FIXTURE || '';
const OUT = resolve(opt('--out') || join(ROOT, '.media-build'));
const CACHE = resolve(opt('--cache') || process.env.MEDIA_CACHE || join(ROOT, '.media-cache'));
const DATA = resolve(opt('--data') || join(ROOT, 'content', 'media.generated.json'));
const PUB = '/images/media';
/** the aim for the navy layer behind the text (Ahmed, 7 Nov 2026) — the dashboard's warning (admin/src/lib/scrim.ts) */
const SCRIM_AIM = 0.6;
const IMG = join(OUT, 'images', 'media');
const JOB = process.env.MEDIA_JOB || '';
const DRY = process.env.MEDIA_DRY_RUN === 'true';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const URL_ = (process.env.SUPABASE_URL || (process.env.PUBLIC_BOOKING_ENDPOINT || '').split('/functions/')[0]).replace(/\/$/, '');
const RUN_URL = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
const BUCKET = 'media-originals';
const PLAN = args.includes('--plan');
// the partners pages' photo slots and the ratio each keeps (width / height of its legacy photo)
const PARTNER_RATIO = Object.fromEntries(JSON.parse(readFileSync(join(ROOT, 'content', 'partners-photos.json'), 'utf8')).slots.map((s) => {
  const [w, h] = s.ratio.split(':').map(Number);
  return [s.key, w / h];
}));
const recipeOf = (it) => (it.target === 'partners' ? `photo@${PARTNER_RATIO[it.key]}` : null);
// the hero and the branch photos take the FINE quality and widths (7 Nov 2026)
const fineOf = (it) => it.target === 'branch' || it.target === 'home';
/** the cache recipe an item is rendered with (the build below; --plan asks whether a HEIC one is cached) */
const recipeFor = (it) => {
  if (recipeOf(it)) return recipeOf(it);
  if (it.slot === 'mobile') return it.target === 'home' ? `slide@${SLIDE.v}:mobile` : 'mobile-cover';
  if (it.target === 'home') return it.slot === 'gallery' ? `slide@${SLIDE.v}:desktop` : it.slot === 'hero-poster' ? 'poster' : 'video';
  const og = it.target === 'blog' || (it.slot === 'cover' && it.target !== 'offer');
  return `${og ? 'photo+og' : 'photo'}${fineOf(it) ? ':fine' : ''}`;
};
// the Discover Taif places' built-in photos (6 Nov 2026): a published cover that IS the place's built-in file (the same
// sha256 as content/images/taif/<slug>-1400.webp — the records made from them in «الصور») keeps the page's own
// rendition, so the page is unchanged; any other photo goes through the engine like every cover
const TAIF_BUILTIN = Object.fromEntries(JSON.parse(readFileSync(join(ROOT, 'content', 'taif-guide.json'), 'utf8')).places.map((p) => {
  const f = join(ROOT, 'content', 'images', 'taif', `${p.slug}-1400.webp`);
  return [p.key, existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null];
}));
// libvips keeps the files it read open in its cache; on Windows an open file blocks the cache folder's rename
sharp.cache(false);
const t0 = Date.now();
const log = (s) => console.log(s);
const NOTE = 'Generated by scripts/media-build.mjs from the photos published in the dashboard «الصور». Do not edit.';

const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}` });
async function rpc(fn, body) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

// ---------- the manifest ----------
if (!PLAN) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(IMG, { recursive: true });
}
let manifest;
let source;
if (FIXTURE) {
  manifest = JSON.parse(readFileSync(join(FIXTURE, 'manifest.json'), 'utf8'));
  manifest.at ??= new Date().toISOString();
  source = 'fixture';
} else if (!KEY || !URL_) {
  if (PLAN) {
    output('ffmpeg', 'false');
    process.exit(0);
  }
  writeFileSync(DATA, JSON.stringify({ _note: NOTE, source: 'none' }, null, 1) + '\n');
  log('NOTE: media from the dashboard skipped (no SUPABASE_SERVICE_ROLE_KEY) — content/media.generated.json is empty, the pages keep their placeholders');
  process.exit(0);
} else {
  if (JOB && !PLAN) await rpc('media_job_update', { p_id: JOB, p_status: 'building', p_run_url: RUN_URL }).catch((e) => log(`  ! job report: ${e.message}`));
  manifest = await rpc('media_site_manifest', { p_dry_job: DRY && JOB ? JOB : null });
  source = 'supabase';
}
// the published dining venues (never a hidden one; the fixture may hold one to prove it stays out)
let venues = [];
if (!PLAN) {
  if (FIXTURE) venues = existsSync(join(FIXTURE, 'venues.json')) ? JSON.parse(readFileSync(join(FIXTURE, 'venues.json'), 'utf8')).venues ?? [] : [];
  else venues = (await rpc('dining_site_manifest', {})).venues ?? [];
  venues = venues.filter((v) => v.status === 'active' || v.status === 'coming_soon');
}
const items = manifest.items || [];
const focalOf = (it) => ({ x: Number(it.focal_x ?? 0.5), y: Number(it.focal_y ?? 0.5) });
/** the measured hero scrim of a cache entry (6 Nov 2026), kept beside its files: its own version, so a change of the
 *  measure never re-encodes a loop */
const SCRIM_FILE = `scrim-v${SCRIM.v}.json`;
/** the cache key of one derived set: the specs, what is made, the original and the focal point */
const keyOf = (recipe, it) => {
  const f = focalOf(it);
  return createHash('sha256').update(JSON.stringify([SPEC_VERSION, recipe, it.sha256, f.x.toFixed(4), f.y.toFixed(4)])).digest('hex');
};
if (PLAN) {
  const miss = (recipe, it) => !existsSync(join(CACHE, keyOf(recipe, it), 'meta.json'));
  const home = items.filter((i) => i.target === 'home');
  const poster = home.find((i) => i.slot === 'hero-poster');
  const video = home.find((i) => i.slot === 'hero-video');
  const heroMode = manifest.hero?.mode === 'photos' ? 'photos' : 'video';
  const scrimMiss = (it) => !existsSync(join(CACHE, keyOf('video', it), SCRIM_FILE));
  const needs = (heroMode === 'video' && video && (miss('video', video) || (!poster && miss('poster-from-video', video)) || scrimMiss(video)))
    || items.some((i) => /hei[cf]$/.test(i.mime) && miss(recipeFor(i), i));
  output('ffmpeg', needs ? 'true' : 'false');
  log(`media plan: ${items.length} item(s); ffmpeg ${needs ? 'needed' : 'not needed'}`);
  process.exit(0);
}
output('manifest_at', manifest.at);
output('media_items', String(items.length));
log(`✓ media manifest (${source}): ${items.length} published item(s), read at ${manifest.at}${DRY ? ' — dry job' : ''}`);

// ---------- the cache ----------
mkdirSync(CACHE, { recursive: true });
const stats = { hits: 0, misses: 0, downloaded: 0, download_ms: 0, render_ms: 0 };
const problems = [];
const k8 = (k) => k.slice(0, 10);
const HERO_MODE = manifest.hero?.mode === 'photos' ? 'photos' : 'video';

/** the original's bytes: the fixture file, or the private bucket (service role) */
async function original(it) {
  const t = Date.now();
  let buf;
  if (FIXTURE) buf = readFileSync(join(FIXTURE, it.file));
  else {
    const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${it.original_path.split('/').map(encodeURIComponent).join('/')}`, { headers: headers() });
    if (!res.ok) throw new Error(`download ${it.original_path}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    stats.downloaded += buf.length;
  }
  stats.download_ms += Date.now() - t;
  if (sha256(buf) !== it.sha256) throw new Error(`${it.file_name || it.file}: the stored file does not match its sha256`);
  return buf;
}
/** a temp file of the bytes (ffmpeg / HEIC need a path) */
function tempFile(buf, ext) {
  const p = join(tmpdir(), `armada-media-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  writeFileSync(p, buf);
  return p;
}
const extOf = (mime) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' })[mime] || 'bin';
/**
 * One cache entry: `recipe` decides what is made; the key covers everything that changes the output. On a hit the
 * stored files are copied (renamed to `prefix`); on a miss `make(dir)` renders into a temp folder that is renamed into
 * place only when complete. Returns the entry's meta (what make() returned) and the published names.
 */
async function cached(recipe, it, prefix, make) {
  const f = focalOf(it);
  const key = keyOf(recipe, it);
  const dir = join(CACHE, key);
  let meta;
  if (existsSync(join(dir, 'meta.json'))) {
    meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    stats.hits++;
  } else {
    stats.misses++;
    const tmp = `${dir}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const t = Date.now();
    meta = await make(tmp, f);
    stats.render_ms += Date.now() - t;
    writeFileSync(join(tmp, 'meta.json'), JSON.stringify(meta));
    rmSync(dir, { recursive: true, force: true });
    try {
      renameSync(tmp, dir);
    } catch {
      // a handle still open on Windows (an antivirus scan): copy, then drop the temp folder
      cpSync(tmp, dir, { recursive: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  // the entry was used now: kept by the prune below
  writeFileSync(join(dir, 'used'), new Date().toISOString());
  const id = `${prefix}-${k8(key)}`;
  for (const name of meta.files) cpSync(join(dir, name), join(IMG, name.replace(/^x(?=[-.])/, id)));
  return { meta, id, dir };
}
/** the largest file of a variant in a cache entry (`x-poster` + widths → its largest WebP) */
const largestOf = (dir, name, v) => join(dir, `${name}-${v.widths.at(-1)}.webp`);
/**
 * The hero scrim of a cache entry, measured once and kept beside it (SCRIM_FILE): the posters (or a slide's two crops)
 * and, for a video, frames sampled every second over both loops — the highest of them, since the scrim stays put while
 * the video plays. A video entry from before 6 Nov 2026 is measured on the first build that has ffmpeg (--plan asks).
 */
async function scrimOf(dir, desktopFile, mobileFile, loops = [], { pair = '', posY = 0.5 } = {}) {
  // a slide's measure depends on its phone files too (another cache entry, 7 Nov 2026): `pair` names them; posY = the
  // desktop picture's vertical position (the rows the text covers from 1280 px)
  const f = join(dir, pair ? SCRIM_FILE.replace('.json', `-${pair}.json`) : SCRIM_FILE);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const list = [await heroScrim(desktopFile, mobileFile, posY)];
  if (loops.length) {
    if (!hasTool('ffmpeg')) throw new Error('the hero video\'s scrim is measured on its frames: ffmpeg is needed once');
    const [desk, phone] = loops.map((l) => loopFrames(l));
    for (let i = 0; i < Math.max(desk.length, phone.length); i++) {
      list.push(await heroScrim(desk[Math.min(i, desk.length - 1)], phone[Math.min(i, phone.length - 1)]));
    }
  }
  const s = { ...scrimMax(list), samples: list.length };
  writeFileSync(f, JSON.stringify(s));
  return s;
}

/** a photo: the 3:2 widths (+ the OG crop for a cover) and the LQIP of its -800 (else first) WebP; a partners slot keeps
 *  its legacy ratio (recipeOf) */
async function photo(it, prefix, withOg) {
  const ratio = it.target === 'partners' ? PARTNER_RATIO[it.key] : undefined;
  if (it.target === 'partners' && !ratio) throw new Error(`partners slot ${it.key} is not in content/partners-photos.json`);
  const fine = fineOf(it);
  const { meta, id } = await cached(recipeOf(it) ?? `${withOg ? 'photo+og' : 'photo'}${fine ? ':fine' : ''}`, it, prefix, async (dir, focal) => {
    const raw = await original(it);
    const path = tempFile(raw, extOf(it.mime));
    try {
      const { buf } = await decodable(path, raw);
      const r = await renderPhoto(buf, focal, dir, 'x', { ...(ratio ? { ratio } : {}), fine });
      const files = [...r.files];
      if (withOg) {
        await renderOg(buf, focal, join(dir, 'x.og.jpg'));
        files.push('x.og.jpg');
      }
      const lw = r.widths.includes(800) ? 800 : r.widths[0];
      return { widths: r.widths, width: r.width, height: r.height, files, lqip: await lqipOf(readFileSync(join(dir, `x-${lw}.webp`))), lqip_width: lw };
    } finally {
      rmSync(path, { force: true });
    }
  });
  const base = `${PUB}/${id}`;
  return {
    // in_gallery (2 Nov 2026): «إظهار في المعرض» — /gallery/ shows the photo unless it was switched off
    photo: { base, widths: meta.widths, width: meta.width, height: meta.height, formats: ['avif', 'webp'], focal: `${Math.round(focalOf(it).x * 100)},${Math.round(focalOf(it).y * 100)}`, alt_ar: it.alt_ar || '', alt_en: it.alt_en || '', in_gallery: it.in_gallery !== false },
    og: withOg ? `${PUB}/${id}.og.jpg` : undefined,
    lqip: [`${base}-${meta.lqip_width}.webp`, meta.lqip],
  };
}

/** «صورة الجوال» of a branch cover (7 Nov 2026): its 9:16 files around its own focal point; null (with a note) when the
 *  photo is too small for the crop — the phone then keeps the desktop cover */
async function mobileCover(it, prefix) {
  try {
    const { meta, id } = await cached('mobile-cover', it, `${prefix}-m`, async (dir, focal) => {
      const raw = await original(it);
      const path = tempFile(raw, extOf(it.mime));
      try {
        const { buf } = await decodable(path, raw);
        const r = await renderPhoto(buf, focal, dir, 'x', { ratio: MOBILE_COVER.ratio, widths: MOBILE_COVER.widths, fine: true });
        return { widths: r.widths, width: r.width, height: r.height, files: r.files };
      } finally {
        rmSync(path, { force: true });
      }
    });
    return { base: `${PUB}/${id}`, widths: meta.widths, width: meta.width, height: meta.height };
  } catch (e) {
    if (!/after the crop/.test(e.message || '')) throw e;
    log(`  ! ${it.target}:${it.key} phone photo: ${e.message} — the phone keeps the desktop cover`);
    return null;
  }
}
/** the published file of a photo base at a width (WebP), in the output folder */
const pubFile = (base, w) => join(IMG, `${base.slice(PUB.length + 1)}-${w}.webp`);

// ---------- the data the pages read ----------
const data = { _note: NOTE, source, manifest_at: manifest.at, dry_job: DRY ? JOB || true : undefined, rooms: {}, branches: {}, sections: {}, dining: {}, halls: {}, places: {}, partners: {}, offers: {}, articles: {}, home: null, lqip: {}, venues: [] };
for (const v of venues) {
  const { logo_svg: logo, ...rest } = v;
  const entry = { ...rest };
  if (logo) {
    const name = `dining-${v.slug}-logo-${createHash('sha256').update(logo).digest('hex').slice(0, 10)}.svg`;
    writeFileSync(join(IMG, name), logo);
    entry.logo = `${PUB}/${name}`;
  }
  data.venues.push(entry);
}
if (venues.length) log(`✓ dining: ${venues.length} published venue(s) (${venues.map((v) => `${v.slug} ${v.status}`).join(', ')})`);
const byTarget = new Map();
for (const it of items) {
  const k = `${it.target}:${it.key}`;
  (byTarget.get(k) || byTarget.set(k, []).get(k)).push(it);
}
const ordered = (list) => [...list.filter((i) => i.slot === 'cover'), ...list.filter((i) => i.slot === 'gallery').sort((a, b) => a.sort - b.sort)];

for (const [k, list] of byTarget) {
  const [target, key] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
  try {
    const cover = list.find((i) => i.slot === 'cover');
    if (target === 'place' && cover && TAIF_BUILTIN[key] && cover.sha256 === TAIF_BUILTIN[key]) {
      data.places[key] = { photos: [{ builtin: true, cover: true, alt_ar: cover.alt_ar || '', alt_en: cover.alt_en || '' }] };
      log(`  ✓ ${k}: the built-in photo (kept as the page renders it)`);
      continue;
    }
    if (['room', 'branch', 'section', 'dining', 'hall', 'place', 'partners', 'offer', 'blog'].includes(target)) {
      const prefix = ['section', 'dining', 'hall', 'place', 'partners', 'offer', 'blog'].includes(target) ? `${target}-${key}` : key.replace('/', '-');
      const photos = [];
      let og;
      for (const it of ordered(list)) {
        const r = await photo(it, prefix, target === 'blog' || (it.slot === 'cover' && target !== 'partners' && target !== 'offer'));
        // an article's photos carry their id (the text's :::photo media:<id>) and their own OG crop
        if (target === 'blog') Object.assign(r.photo, { id: it.id, og: r.og });
        if (it.slot === 'cover') {
          r.photo.cover = true;
          og = r.og;
        }
        photos.push(r.photo);
        data.lqip[r.lqip[0]] = r.lqip[1];
      }
      const entry = { photos, ...(og ? { og_image: og } : {}) };
      if (target === 'branch' && cover) {
        // «صورة الجوال» (7 Nov 2026) and the «فرعانا» card's measured gradient
        const mob = list.find((i) => i.slot === 'mobile' && i.mobile_of === cover.id);
        const coverPhoto = photos.find((p) => p.cover);
        if (mob && coverPhoto) {
          const m = await mobileCover(mob, key);
          if (m) coverPhoto.mobile = m;
        }
        if (coverPhoto) {
          const d = pubFile(coverPhoto.base, coverPhoto.widths.at(-1));
          const mm = coverPhoto.mobile ? pubFile(coverPhoto.mobile.base, coverPhoto.mobile.widths.at(-1)) : d;
          coverPhoto.card_scrim = await cardScrim(d, mm);
          log(`  ✓ ${k}: card gradient ${coverPhoto.card_scrim.lg} (desktop) / ${coverPhoto.card_scrim.m} (phone)${coverPhoto.mobile ? ', with its phone photo' : ''}`);
          if (Math.max(coverPhoto.card_scrim.lg, coverPhoto.card_scrim.m) > SCRIM_AIM) log(`  ! ${k}: too bright behind the card text — the gradient needs ${Math.max(coverPhoto.card_scrim.lg, coverPhoto.card_scrim.m)} (aim ${SCRIM_AIM})`);
        }
      }
      if (target === 'branch') {
        entry.story = {};
        for (const it of list.filter((i) => i.slot.startsWith('story-'))) {
          const scene = it.slot.slice('story-'.length);
          const r = await photo(it, `${key}-${scene}`, false);
          entry.story[scene] = { base: r.photo.base, widths: r.photo.widths, width: r.photo.width, height: r.photo.height, formats: r.photo.formats, alt_ar: r.photo.alt_ar, alt_en: r.photo.alt_en, in_gallery: r.photo.in_gallery };
          data.lqip[r.lqip[0]] = r.lqip[1];
        }
      }
      data[{ room: 'rooms', branch: 'branches', section: 'sections', dining: 'dining', hall: 'halls', place: 'places', partners: 'partners', offer: 'offers', blog: 'articles' }[target]][key] = entry;
      log(`  ✓ ${k}: ${photos.length} photo(s)${entry.story ? ` + ${Object.keys(entry.story).length} story scene(s)` : ''}`);
    } else if (target === 'home' && HERO_MODE === 'photos') {
      // «صور متتابعة» (6 Nov 2026): 3–8 photos in Ahmed's order, each 16:9 + 4:5 around its focal point, within the
      // deferred-media budget, with its own measured scrim; the first is the LCP image and the sharing image
      const slides = list.filter((i) => i.slot === 'gallery').sort((a, b) => a.sort - b.sort);
      if (slides.length < 3 || slides.length > 8) throw new Error(`the hero slideshow needs 3 to 8 photos, the manifest has ${slides.length}`);
      const home = { mode: 'photos', slides: [] };
      for (const [n, it] of slides.entries()) {
        // the desktop 16:9 files (+ the sharing crop) from the photo; the phone 4:5 files from its «صورة الجوال» when one
        // is published (7 Nov 2026), else from the photo around its focal point — two cache entries
        const mob = list.find((i) => i.slot === 'mobile' && i.mobile_of === it.id);
        const desk = await cached(`slide@${SLIDE.v}:desktop`, it, 'hero-slide', async (dir, focal) => {
          const raw = await original(it);
          const path = tempFile(raw, extOf(it.mime));
          try {
            const { buf } = await decodable(path, raw);
            const r = await renderSlide(buf, focal, dir, { desktop: 'x', mobile: 'x-m' }, { only: 'desktop' });
            await renderOg(buf, focal, join(dir, 'x.og.jpg'));
            return { files: [...r.files, 'x.og.jpg'], desktop: r.desktop, notes: r.notes };
          } finally {
            rmSync(path, { force: true });
          }
        });
        const phoneSrc = mob ?? it;
        const phone = await cached(`slide@${SLIDE.v}:mobile`, phoneSrc, 'hero-slide', async (dir, focal) => {
          const raw = await original(phoneSrc);
          const path = tempFile(raw, extOf(phoneSrc.mime));
          try {
            const { buf } = await decodable(path, raw);
            const r = await renderSlide(buf, focal, dir, { desktop: 'x', mobile: 'x-m' }, { only: 'mobile' });
            return { files: r.files, mobile: r.mobile, notes: r.notes };
          } finally {
            rmSync(path, { force: true });
          }
        });
        const posY = Number(String(desk.meta.desktop.position).split(' ')[1]?.replace('%', '') ?? 50) / 100;
        const scrim = await scrimOf(desk.dir, largestOf(desk.dir, 'x', desk.meta.desktop), largestOf(phone.dir, 'x-m', phone.meta.mobile), [], { pair: phone.id.slice(-10), posY });
        const slide = {
          alt_ar: it.alt_ar || '', alt_en: it.alt_en || '', focal: `${Math.round(focalOf(it).x * 100)},${Math.round(focalOf(it).y * 100)}`,
          scrim: { m: scrim.m, md: scrim.md, lg_ltr: scrim.lg_ltr, lg_rtl: scrim.lg_rtl }, ...(mob ? { phone_photo: true } : {}),
          poster: { base: `${PUB}/${desk.id}`, widths: desk.meta.desktop.widths, width: desk.meta.desktop.width, height: desk.meta.desktop.height, position: desk.meta.desktop.position },
          poster_mobile: { base: `${PUB}/${phone.id}-m`, widths: phone.meta.mobile.widths, width: phone.meta.mobile.width, height: phone.meta.mobile.height, position: phone.meta.mobile.position },
        };
        home.slides.push(slide);
        if (n === 0) home.og_image = `${PUB}/${desk.id}.og.jpg`;
        for (const note of [...(desk.meta.notes || []), ...(phone.meta.notes || [])]) log(`  ! hero photo ${n + 1}: ${note}`);
        // the aim behind the text is 0.6 (Ahmed, 7 Nov 2026): a brighter photo gets what AA needs, and is named here
        const wide = Math.max(scrim.lg_rtl, scrim.lg_ltr);
        if (wide > SCRIM_AIM) log(`  ! hero photo ${n + 1}: too bright behind the text — the scrim needs ${wide} there (aim ${SCRIM_AIM})`);
      }
      Object.assign(home, { poster: home.slides[0].poster, poster_mobile: home.slides[0].poster_mobile, alt_ar: home.slides[0].alt_ar, alt_en: home.slides[0].alt_en, scrim: home.slides[0].scrim });
      data.home = home;
      log(`  ✓ home hero: ${home.slides.length} photos (scrim ${home.slides.map((x) => x.scrim.md).join(' / ')})`);
    } else if (target === 'home') {
      const posterItem = list.find((i) => i.slot === 'hero-poster');
      const videoItem = list.find((i) => i.slot === 'hero-video');
      const home = { alt_ar: posterItem?.alt_ar || videoItem?.alt_ar || '', alt_en: posterItem?.alt_en || videoItem?.alt_en || '' };
      if (videoItem) {
        // the loops (desktop + the mobile 4:5) and their posters = their own first frames (5 Nov 2026: no jump from the
        // poster to the video; the published still keeps its role for sharing — the OG image below)
        const { meta, id, dir: videoDir } = await cached('video', videoItem, 'hero', async (dir, focal) => {
          // a cached loop needs no ffmpeg; a new one does
          if (!hasTool('ffmpeg') || !hasTool('ffprobe')) throw new Error('the hero video needs ffmpeg / ffprobe on the build machine');
          const raw = await original(videoItem);
          const path = tempFile(raw, extOf(videoItem.mime));
          try {
            const v = renderHeroVideo(path, ffprobe(path), focal, dir, { mp4: 'x.mp4', webm: 'x.webm', mobileMp4: 'x-mobile.mp4', mobileWebm: 'x-mobile.webm' });
            if (v.problems.length) throw new Error(v.problems.join('; '));
            const p = await renderPosterFrames(heroFrame(path, v.desktop.vf), heroFrame(path, v.mobile.vf), { desktop: v.desktop.position, mobile: v.mobile.position }, dir, { poster: 'x-poster', mobile: 'x-poster-m' });
            return {
              files: ['x.mp4', 'x.webm', 'x-mobile.mp4', 'x-mobile.webm', ...p.files], seconds: Math.round(v.seconds * 10) / 10, notes: v.notes, sizes: v.sizes,
              size: [v.desktop.width, v.desktop.height], mobile: [v.mobile.width, v.mobile.height], poster: p.poster, poster_mobile: p.poster_mobile,
            };
          } finally {
            rmSync(path, { force: true });
          }
        });
        home.video = {
          mp4: `${PUB}/${id}.mp4`, webm: `${PUB}/${id}.webm`, mobile_mp4: `${PUB}/${id}-mobile.mp4`, mobile_webm: `${PUB}/${id}-mobile.webm`,
          seconds: meta.seconds, width: meta.size[0], height: meta.size[1], mobile_width: meta.mobile[0], mobile_height: meta.mobile[1],
        };
        for (const key of ['poster', 'poster_mobile']) {
          const v = meta[key];
          home[key] = { base: `${PUB}/${id}-poster${key === 'poster' ? '' : '-m'}`, widths: v.widths, width: v.width, height: v.height, position: v.position };
        }
        const scrim = await scrimOf(videoDir, largestOf(videoDir, 'x-poster', meta.poster), largestOf(videoDir, 'x-poster-m', meta.poster_mobile), [join(videoDir, 'x.mp4'), join(videoDir, 'x-mobile.mp4')]);
        home.scrim = { m: scrim.m, md: scrim.md, lg_ltr: scrim.lg_ltr, lg_rtl: scrim.lg_rtl };
        log(`  ✓ hero scrim (poster + ${scrim.samples - 1} frames): phone ${scrim.m}, tablet ${scrim.md}, wide ${scrim.lg_rtl} (ar) / ${scrim.lg_ltr} (en)`);
        for (const n of meta.notes || []) log(`  ! hero video: ${n}`);
        log(`  ✓ hero loops: ${Object.entries(meta.sizes || {}).map(([n, s]) => `${n.replace(/^x/, '')} ${s.mb} MB`).join(', ')}`);
      }
      const posterSrc = posterItem || videoItem;
      if (posterSrc) {
        const { meta, id, dir: posterDir } = await cached(posterItem ? 'poster' : 'poster-from-video', posterSrc, 'hero-poster', async (dir, focal) => {
          let buf;
          if (posterItem) {
            const raw = await original(posterItem);
            const path = tempFile(raw, extOf(posterItem.mime));
            try {
              buf = (await decodable(path, raw)).buf;
            } finally {
              rmSync(path, { force: true });
            }
          } else {
            const raw = await original(videoItem);
            const path = tempFile(raw, extOf(videoItem.mime));
            try {
              buf = videoFrame(path);
            } finally {
              rmSync(path, { force: true });
            }
          }
          const p = await renderPoster(buf, focal, dir, { poster: 'x', mobile: 'x-m' });
          await renderOg(buf, focal, join(dir, 'x.og.jpg'));
          return { files: [...p.files, 'x.og.jpg'], poster: p.poster, poster_mobile: p.poster_mobile };
        });
        // with a video the posters are its own first frames (above); the still is then only the sharing image
        if (!home.video) {
          for (const key of ['poster', 'poster_mobile']) {
            const v = meta[key];
            home[key] = { base: `${PUB}/${id}${key === 'poster' ? '' : '-m'}`, widths: v.widths, width: v.width, height: v.height, position: v.position };
          }
          const scrim = await scrimOf(posterDir, largestOf(posterDir, 'x', meta.poster), largestOf(posterDir, 'x-m', meta.poster_mobile));
          home.scrim = { m: scrim.m, md: scrim.md, lg_ltr: scrim.lg_ltr, lg_rtl: scrim.lg_rtl };
        }
        home.mode = home.video ? 'video' : 'still';
        home.og_image = `${PUB}/${id}.og.jpg`;
        data.home = home;
        log(`  ✓ home hero: poster ${home.poster.widths.join(' / ')} + mobile ${home.poster_mobile.widths.join(' / ')}${home.video ? ` (the loops' first frames), loop ${home.video.seconds} s` : ''}`);
      }
    }
  } catch (e) {
    problems.push(`${k}: ${e.message || e}`);
  }
}

// ---------- the cache prune (entries unused for 30 days), the report ----------
const MONTH = 30 * 24 * 3600 * 1000;
for (const name of readdirSync(CACHE)) {
  const used = join(CACHE, name, 'used');
  try {
    if (name.includes('.tmp-') || !existsSync(used) || Date.now() - statSync(used).mtimeMs > MONTH) rmSync(join(CACHE, name), { recursive: true, force: true });
  } catch { /* another build's folder */ }
}
const files = readdirSync(IMG);
const bytes = files.reduce((n, f) => n + statSync(join(IMG, f)).size, 0);
const report = {
  source, manifest_at: manifest.at, dry: DRY, job: JOB || null, items: items.length, targets: byTarget.size, files: files.length,
  bytes, cache: { hits: stats.hits, misses: stats.misses }, downloaded_bytes: stats.downloaded,
  seconds: { total: (Date.now() - t0) / 1000, download: stats.download_ms / 1000, render: stats.render_ms / 1000 }, problems,
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
for (const k of ['rooms', 'branches', 'sections', 'dining', 'halls', 'places', 'partners', 'offers', 'articles']) if (!Object.keys(data[k]).length) delete data[k];
if (!data.venues.length) delete data.venues;
if (!data.home) delete data.home;
writeFileSync(DATA, JSON.stringify(data, null, 1) + '\n');
log(`✓ media: ${files.length} file(s), ${(bytes / 1048576).toFixed(1)} MB in .media-build/images/media — cache ${stats.hits} hit(s), ${stats.misses} miss(es), ${(stats.downloaded / 1048576).toFixed(1)} MB downloaded, ${report.seconds.total.toFixed(1)} s`);
summary(`### Media (dashboard «الصور»)\n\n| | |\n|---|---|\n| source | ${source}${DRY ? ' (dry job)' : ''} |\n| items | ${items.length} in ${byTarget.size} target(s) |\n| files | ${files.length}, ${(bytes / 1048576).toFixed(1)} MB |\n| cache | ${stats.hits} hit(s), ${stats.misses} miss(es) |\n| downloaded | ${(stats.downloaded / 1048576).toFixed(1)} MB |\n| time | ${report.seconds.total.toFixed(1)} s (render ${report.seconds.render.toFixed(1)} s) |\n${problems.length ? `\n**Problems**\n\n${problems.map((p) => `- ${p}`).join('\n')}\n` : ''}`);
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  if (JOB && source === 'supabase') await rpc('media_job_update', { p_id: JOB, p_status: 'failed', p_run_url: RUN_URL, p_error: problems.join('; ').slice(0, 480) }).catch(() => {});
  process.exit(1);
}
