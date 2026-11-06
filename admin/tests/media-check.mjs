// Dashboard e2e of the media module «الصور» (1 Nov 2026) — Playwright (system Chrome) against the dashboard running on a
// PREVIEW BRANCH with the QA users (internal.qa_users('create'); never production — the script refuses the production
// project). Everything goes through the UI as Ahmed would do it; the database is read with the branch's service role
// only to assert what the UI did, to set the QA users' media level, and to play the deploy workflow's report.
//   node admin/tests/media-check.mjs [BASE_URL=http://127.0.0.1:5174]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / BOOKING_TEST_TOKEN (the branch)
// Covers: the nav and the target picker (home, each branch with its room types, hall and dining venues, then the Discover
// Taif places — 2 Nov 2026; 375 px select); uploads of
// generated photos and a short video through the file inputs (several at once into a gallery, progress to done); the
// checks before upload (portrait and under-2400 warnings, a duplicate refused, a GIF refused, the video's size / audio
// notes); the soft gallery warning; the required-slot and alt validation blocking «نشر» with the exact list; the focal
// point saved with its crop previews; alt texts; reorder («تأخير») and drag; set as cover (the cover hand-over);
// archive and restore; «نشر» creating a job with the dispatch stubbed (reason media + the job id), the job's status
// through queued → published with the build-log link (the workflow's report played with the service role); «نشر الكل»
// with a blocked target («نشر المكتمل فقط»); a user with edit but not publish (no publish button, the RPC refused); view
// only (no upload, read-only dialog); none (no nav); Western digits and no bare «إلغاء» with the dialogs open.
// 2 Nov 2026: «إظهار في المعرض» (on by default, dirty when unticked, the tile chip, carried by «نشر» to the live
// snapshot and the build manifest, not offered for a place cover); «صفحات الشركاء» (the 13 slots after the places, a
// cover only at the slot's own ratio — 4:5 for the Shafa Road card — no sharing crop, nothing required, published).
// 5 Nov 2026: «اختيار صورة موجودة» — a published photo copied into another page's cover (the stored original byte for
// byte at a new path, both alts, the source untouched), the copy already in a page shown as unavailable, a gallery copy
// appended, the article's cover and text photos from «المدونة», no button for the view level.
// 6 Nov 2026: the home hero's choice «فيديو» / «صور متتابعة» — the draft and its note, the photo list (3–8, both
// descriptions), the order, «نشر» → live_mode + the manifest in that order, back to video as a change of its own, audit.
// Before it runs it deletes the media rows and jobs of the branch (test data only — the branch is a throwaway copy).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from '../../node_modules/sharp/dist/index.mjs';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5174').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE || !env.BOOKING_TEST_TOKEN) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and BOOKING_TEST_TOKEN of the preview branch are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
const ARABIC_DIGITS = new RegExp(`[${String.fromCharCode(0x0660)}-${String.fromCharCode(0x0669)}${String.fromCharCode(0x06f0)}-${String.fromCharCode(0x06f9)}]`);

const SHOTS = 'screenshots/media';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: name.endsWith('-full') }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
async function digits(page, label) {
  const text = await page.evaluate(() => document.body.innerText);
  check(!ARABIC_DIGITS.test(text), `digits: ${label}`, text.match(ARABIC_DIGITS)?.[0]);
  const bare = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.trim() === 'إلغاء' && b.dataset.action !== 'dialog-cancel').length);
  check(bare === 0, `no action button reads a bare «إلغاء»: ${label}`);
}

// ── fixtures: unique per run (a new sha256 each time) ──
const RUN = Date.now().toString(36);
const DIR = join(tmpdir(), `armada-media-e2e-${RUN}`);
mkdirSync(DIR, { recursive: true });
async function jpeg(name, w, h, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},50%,40%)"/><stop offset="1" stop-color="hsl(${hue + 50},60%,70%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" font-size="${Math.round(h / 12)}" text-anchor="middle" fill="#fff" font-family="Arial">${name} ${RUN}</text></svg>`;
  const p = join(DIR, `qa-${name}.jpg`);
  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(p);
  return p;
}
const F = {
  cover: await jpeg('cover', 3600, 2400, 20),
  portrait: await jpeg('portrait', 2400, 3600, 200),
  small: await jpeg('small', 1800, 1200, 120),
  third: await jpeg('third', 3600, 2400, 260),
  bcover: await jpeg('branch-cover', 3600, 2400, 300),
  rest: await jpeg('restaurant', 3600, 2400, 40),
  poster: await jpeg('poster', 3840, 2160, 210),
  partner: await jpeg('partner', 3600, 2400, 150),
};
F.gif = join(DIR, 'qa-anim.gif');
writeFileSync(F.gif, Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
F.video = join(DIR, 'qa-hero.mp4');
const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=3`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', F.video], { encoding: 'utf8' });
if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr}`);

// ── the branch: clean media state, the QA users' media levels ──
await rest('media_items?id=not.is.null', { method: 'DELETE' });
await rest('media_publish_jobs?id=not.is.null', { method: 'DELETE' });
const users = Object.fromEntries((await rest('staff?select=user_id,full_name,role')).map((s) => [s.role === 'admin' ? 'admin' : s.role === 'management' ? 'mgmt' : s.full_name, s.user_id]));
const setLevel = (user, level) => rest(`staff_permissions?user_id=eq.${user}&section=eq.media`, { method: 'PATCH', body: JSON.stringify({ level }) });
await setLevel(users.admin, 'publish');
await setLevel(users.mgmt, 'edit');
/** the stored gallery order of a target, polled until `want(order)` (the UI updates first, the save lands after) */
async function galleryOrder(key, want) {
  let order = [];
  for (let i = 0; i < 40; i++) {
    order = (await rest(`media_items?target_key=eq.${key}&slot=eq.gallery&status=neq.archived&upload_state=eq.ready&order=sort&select=id`)).map((r) => r.id);
    if (want(order)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return order;
}
const item = async (fileLike) => (await rest(`media_items?file_name=like.*${fileLike}*&select=*&order=created_at.desc`))[0];

const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error (${email}): ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  let at = await firstOf(page, { code: '#code', app: '#app-main', backup: '[data-action="generate-backup"]' });
  if (at === 'code') {
    await passCode(page, codes);
    at = await firstOf(page, { app: '#app-main', backup: '[data-action="generate-backup"]' });
  }
  if (at === 'backup') {
    await handleBackupCodes(page);
    await page.waitForSelector('#app-main', { timeout: 30000 });
  }
  await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
  return { ctx, page };
}
const dispatches = [];
async function stubRebuild(ctx) {
  await ctx.route('**/functions/v1/site-rebuild', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    dispatches.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, dispatched: true }) });
  });
}
/** the grouped picker (3 Nov 2026): open the phone disclosure and the target's group when they are closed */
const reveal = async (page, id) => {
  const btn = page.locator(`[data-target="${id}"]`);
  if (await btn.isVisible()) return;
  const t = page.locator('[data-action="picker-toggle"]');
  if ((await t.isVisible()) && (await t.getAttribute('aria-expanded')) === 'false') await t.click();
  const g = await btn.evaluate((el) => el.closest('[data-picker-group]')?.getAttribute('data-picker-group'));
  if (g && !(await btn.isVisible())) await page.click(`[data-group="${g}"]`);
};
const target = async (page, id) => {
  await reveal(page, id);
  await page.click(`[data-target="${id}"]`);
  await page.waitForSelector(`[data-current="${id}"]`);
  await page.waitForSelector('[data-slot]');
};
/** the latest row of each named file has finished (done or refused) — the list empties on a reload */
const uploadsDone = (page, names) => page.waitForFunction((names) => names.every((n) => {
  const rows = [...document.querySelectorAll('[data-upload]')].filter((r) => r.getAttribute('data-upload') === n);
  return rows.length && ['done', 'error'].includes(rows.at(-1).getAttribute('data-stage'));
}), names, { timeout: 120000 });
const stageOf = (page, name) => page.locator(`[data-upload="${name}"]`).last().getAttribute('data-stage');
async function openItem(page, id) {
  await page.click(`[data-open="${id}"]`);
  await page.waitForSelector(`[data-media-dialog="${id}"]`);
}
async function fillAlts(page, id, ar, en) {
  await openItem(page, id);
  await page.fill('#alt-ar', ar);
  await page.fill('#alt-en', en);
  await page.click('[data-action="media-save"]');
  await page.waitForSelector(`[data-media-dialog="${id}"]`, { state: 'detached' });
}

try {
  // ── admin: nav, picker ──
  const { ctx, page } = await login('admin@qa.invalid');
  await stubRebuild(ctx);
  check(await page.locator('nav a[href$="/media"]').count() > 0, 'nav: «الصور» shows for media publish');
  await page.click('nav a[href$="/media"] >> nth=0');
  await page.waitForSelector('[data-target]');
  const ids = await page.locator('[data-target]').evaluateAll((els) => els.map((e) => e.getAttribute('data-target')));
  const venueCount = (await rest('dining_venues?select=id')).length;
  const partnerKeys = JSON.parse(readFileSync('content/partners-photos.json', 'utf8')).slots.map((s) => `partners:${s.key}`);
  // the offers' covers and (3 Nov 2026) the articles' photos follow the partners slots, in groups of their own
  const tail = ids.filter((x) => x.startsWith('offer:') || x.startsWith('blog:'));
  const articleCount = (await rest('articles?select=id')).length;
  const core = ids.filter((x) => !tail.includes(x));
  check(tail.filter((x) => x.startsWith('blog:')).length === articleCount && JSON.stringify(ids.slice(-tail.length)) === JSON.stringify(tail) && ids.at(-1).startsWith('blog:'),
    'picker: the offers then every article («المدونة») come last', tail.join(' '));
  check(core.length === 33 + venueCount + partnerKeys.length && core[0] === 'home:home' && core[1] === 'branch:airport-road' && core.includes('hall:events-hall') && core.includes('dining:armada-residence-cafe') && core.includes('dining:lario')
    && core.at(-1 - partnerKeys.length) === 'place:taif-zoo' && JSON.stringify(core.slice(-partnerKeys.length)) === JSON.stringify(partnerKeys) && !core.some((x) => x.startsWith('section:')),
    'picker: home, each branch with its 12 room types, the hall and every venue, the 17 places, then the 13 partners slots in content/partners-photos.json order — no retired section', core.join(' '));
  check(await page.locator('nav[aria-label="صفحات الموقع"]').textContent().then((t) => t.includes('صفحات الشركاء')), 'picker: the «صفحات الشركاء» group');
  check(ids.filter((x) => x.startsWith('room:')).includes('room:airport-road/accessible-room'), 'picker: the accessible rooms are targets');
  await digits(page, 'media page');

  // ── the grouped picker (3 Nov 2026): header bands, chips, collapse, remembered state, search, keyboard ──
  {
    const heads = await page.locator('[data-group]').evaluateAll((els) => els.map((e) => ({ g: e.getAttribute('data-group'), exp: e.getAttribute('aria-expanded'), tag: e.tagName, title: e.textContent.trim() })));
    check(heads.length >= 5 && heads.every((h) => h.tag === 'BUTTON' && (h.exp === 'true' || h.exp === 'false')) && ['home', 'branch:airport-road', 'branch:shafa-road', 'places', 'partners'].every((g) => heads.some((h) => h.g === g)),
      'picker: every group header is a button with aria-expanded (home, both branches, Discover Taif, partners)', JSON.stringify(heads));
    const chips = await page.locator('[data-group] [data-chip]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
    check(chips.length === heads.length && chips.every((c) => /^ناقص \d+$/.test(c) || c === 'مكتمل ✓'), 'picker: each group shows «ناقص N» or «مكتمل ✓»', chips.join(' | '));
    const bar = await page.locator('[data-group="branch:airport-road"]').evaluate((el) => { const cs = getComputedStyle(el); return { b: cs.borderInlineStartWidth, w: cs.fontWeight }; });
    check(parseFloat(bar.b) >= 2 && Number(bar.w) >= 700, 'picker: the header band carries the bronze start bar and a bold label', JSON.stringify(bar));
    const subs = await page.locator('[data-picker-group="branch:airport-road"] .picker-subhead').allTextContents();
    check(JSON.stringify(subs) === JSON.stringify(['الفرع', 'الغرف والأجنحة', 'القاعة والمطاعم']), 'picker: the branch sub-headers «الفرع»، «الغرف والأجنحة»، «القاعة والمطاعم»', subs.join(' | '));
    // collapse a group that does not hold the current target, then expand it from the keyboard
    const places = page.locator('[data-group="places"]');
    if ((await places.getAttribute('aria-expanded')) === 'true') await places.click();
    check((await places.getAttribute('aria-expanded')) === 'false' && !(await page.locator('[data-target="place:taif-zoo"]').isVisible()), 'picker: a group collapses (its items hidden)');
    await places.focus();
    await page.keyboard.press('Enter');
    check((await places.getAttribute('aria-expanded')) === 'true' && (await page.locator('[data-target="place:taif-zoo"]').isVisible()), 'picker: Enter on the focused header expands it');
    await page.keyboard.press('Space');
    check((await places.getAttribute('aria-expanded')) === 'false', 'picker: Space collapses it again');
    const cur = page.locator('[data-group="home"]');
    await cur.click();
    check((await cur.getAttribute('aria-expanded')) === 'true', 'picker: the group holding the selected target stays open');
    await page.reload();
    await page.waitForSelector('[data-group="places"]');
    check((await page.locator('[data-group="places"]').getAttribute('aria-expanded')) === 'false', 'picker: the open state is remembered after a reload');
    // search
    await page.fill('[data-picker-search]', 'عكاظ');
    await page.waitForTimeout(150);
    const found = await page.locator('[data-target]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-target')));
    check(found.includes('place:souq-okaz') && found.length <= 3 && found.every((x) => x.startsWith('place:') || x.startsWith('blog:')), 'picker: the search filters by name and opens the matching group', found.join(' '));
    await page.fill('[data-picker-search]', 'zzzz');
    check(await page.getByText('لا نتائج لـ«zzzz»').isVisible(), 'picker: no match says so');
    await page.fill('[data-picker-search]', '');
    // sticky header inside the scrolling list
    const sticky = await page.locator('.picker-head-wrap').first().evaluate((el) => getComputedStyle(el).position);
    check(sticky === 'sticky', 'picker: the group header is sticky while the list scrolls', sticky);
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await shot(page, 'picker-1280-dark');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await shot(page, 'picker-1280-light');
  }

  // ── a room type: uploads and their checks ──
  await target(page, 'room:airport-road/twin-room');
  check(await page.locator('[data-action="media-publish"]').isDisabled(), 'publish: disabled with nothing to publish');
  await page.setInputFiles('[data-file-input="cover"]', F.cover);
  await uploadsDone(page, ['qa-cover.jpg']);
  check((await stageOf(page, 'qa-cover.jpg')) === 'done', 'upload: the cover reaches «تم الرفع»');
  await page.waitForSelector('[data-slot="cover"] [data-open]');
  check(await page.locator('[data-slot="cover"] [data-required]').textContent() === 'مطلوبة', 'cover slot: filled, still marked required');
  await page.setInputFiles('[data-file-input="gallery"]', [F.portrait, F.small]);
  await uploadsDone(page, ['qa-portrait.jpg', 'qa-small.jpg']);
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="gallery"] [data-open]').length === 2, null, { timeout: 15000 }).catch(() => {});
  const warns = (await page.locator('[data-upload-warning]').allTextContents()).join(' | ');
  check(/طولية/.test(warns), 'upload: a portrait photo warns with the reason', warns);
  check(/1800 بكسل، أقل من 2400/.test(warns), 'upload: a long side under 2400 px warns with its size', warns);
  const tiles = await page.locator('[data-slot="gallery"] [data-open]').count();
  check(tiles === 2, 'gallery: two photos uploaded at once', `${tiles} tile(s); uploads: ${(await page.locator('[data-upload]').allTextContents()).join(' | ').slice(0, 300)}`);
  check(await page.locator('[data-gallery-warning="gallery_low"]').count() === 1 && /المقترح من 3 إلى 8/.test(await page.locator('[data-gallery-warning]').textContent()), 'gallery: the soft warning below 3');
  await page.setInputFiles('[data-file-input="gallery"]', F.cover);
  await uploadsDone(page, ['qa-cover.jpg']);
  check(/مرفوع هنا من قبل/.test(await page.locator('[data-upload="qa-cover.jpg"]').last().textContent()), 'upload: the same file twice in a target is refused');
  await page.setInputFiles('[data-file-input="gallery"]', F.gif);
  await uploadsDone(page, ['qa-anim.gif']);
  check(/نوع الملف غير مقبول/.test(await page.locator('[data-upload="qa-anim.gif"]').textContent()), 'upload: a GIF is refused before any upload');
  const cover = await item('qa-cover');
  check(cover && cover.upload_state === 'ready' && cover.width === 3600 && cover.height === 2400 && cover.thumb_path && cover.preview_path, 'database: the cover is a ready draft with its size and both previews', JSON.stringify(cover && { s: cover.upload_state, w: cover.width, t: !!cover.thumb_path }));

  // ── publish blocked: missing alts ──
  await page.click('[data-action="media-publish"]');
  await page.waitForSelector('[data-blocked]');
  const blockedText = await page.locator('[data-blocked]').textContent();
  check(/الصورة الرئيسية: النص البديل بالعربية/.test(blockedText) && /صورة المعرض رقم 2: النص البديل بالإنجليزية/.test(blockedText), 'publish: blocked with the exact missing alts', blockedText.slice(0, 200));
  await digits(page, 'blocked dialog');
  await shot(page, 'blocked-1280');
  await page.click('[data-blocked] [data-action="dialog-cancel"]');
  check((await rest('media_publish_jobs?select=id')).length === 0, 'publish: a blocked publish creates no job');

  // ── the dialog: focal point, crops, alts ──
  await openItem(page, cover.id);
  await page.waitForSelector('[data-focal] img');
  check(await page.locator('[data-crop]').count() === 2, 'dialog: a cover shows its 3:2 and sharing crops');
  const box = await page.locator('[data-focal]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
  check(/25% · 75%/.test(await page.locator('[data-focal-value]').textContent()), 'dialog: the focal point follows the click');
  await shot(page, 'dialog-1280');
  await page.fill('#alt-ar', 'غرفة التوأم بسريرين وإضاءة نهارية');
  await page.fill('#alt-en', 'The twin room with two beds in daylight');
  await digits(page, 'item dialog');
  await page.click('[data-action="media-save"]');
  await page.waitForSelector(`[data-media-dialog="${cover.id}"]`, { state: 'detached' });
  const saved = await item('qa-cover');
  check(Math.abs(saved.focal_x - 0.25) < 0.02 && Math.abs(saved.focal_y - 0.75) < 0.02 && saved.alt_en === 'The twin room with two beds in daylight', 'database: the focal point and the alts are saved', `${saved.focal_x},${saved.focal_y}`);
  const portrait = await item('qa-portrait');
  const small = await item('qa-small');
  await fillAlts(page, portrait.id, 'ركن الجلوس في الغرفة', 'The seating corner of the room');
  await fillAlts(page, small.id, 'منظر من نافذة الغرفة', 'The view from the room window');

  // ── order, cover hand-over, archive / restore ──
  await page.locator(`[data-item="${portrait.id}"] [data-action="move-later"]`).click();
  let order = await galleryOrder('airport-road/twin-room', (o) => o[0] === small.id);
  check(order[0] === small.id && order[1] === portrait.id, 'reorder: «تأخير» moves the photo and the order is stored', order.join(','));
  await page.waitForFunction((id) => document.querySelector('[data-slot="gallery"] [data-item]')?.getAttribute('data-item') === id, small.id);
  await page.waitForTimeout(500);
  await page.locator(`[data-item="${portrait.id}"]`).dragTo(page.locator(`[data-item="${small.id}"]`));
  order = await galleryOrder('airport-road/twin-room', (o) => o[0] === portrait.id);
  check(order[0] === portrait.id, 'reorder: dragging a tile onto another stores the new order', order.join(','));
  await page.waitForFunction((id) => document.querySelector('[data-slot="gallery"] [data-item]')?.getAttribute('data-item') === id, portrait.id);
  await openItem(page, small.id);
  await page.selectOption('#media-slot', 'cover');
  await page.click('[data-action="media-save"]');
  await page.waitForSelector(`[data-media-dialog="${small.id}"]`, { state: 'detached' });
  check((await item('qa-small')).slot === 'cover' && (await item('qa-cover')).slot === 'gallery', 'set as cover: the gallery photo becomes the cover and the cover moves to the gallery');
  await page.setInputFiles('[data-file-input="gallery"]', F.third);
  await uploadsDone(page, ['qa-third.jpg']);
  const third = await item('qa-third');
  await openItem(page, third.id);
  await page.click('[data-action="media-archive"]');
  await page.waitForSelector(`[data-media-dialog="${third.id}"]`, { state: 'detached' });
  check((await item('qa-third')).status === 'archived' && (await page.locator(`[data-item="${third.id}"]`).count()) === 0, 'archive: the photo leaves the gallery (no hard delete)');
  await page.click('[data-action="toggle-archived"]');
  await page.click(`[data-archived="${third.id}"] [data-action="media-restore"]`);
  await page.waitForSelector(`[data-item="${third.id}"]`);
  check((await item('qa-third')).status === 'draft', 'restore: back in the gallery as a draft');
  await fillAlts(page, third.id, 'دورة مياه الغرفة', 'The room bathroom');

  // ── publish: job, dispatch, the workflow's report ──
  await page.click('[data-action="media-publish"]');
  await page.waitForSelector('[data-job]');
  const jobs = await rest('media_publish_jobs?select=*');
  check(jobs.length === 1 && jobs[0].status === 'queued' && JSON.stringify(jobs[0].targets) === '[{"key":"airport-road/twin-room","target":"room"}]', 'publish: one queued job for the room type', JSON.stringify(jobs));
  check(dispatches.length === 1 && dispatches[0].reason === 'media' && dispatches[0].job === jobs[0].id, 'publish: the site build is asked with reason media and the job id (stubbed)', JSON.stringify(dispatches));
  check((await rest('media_items?target_key=eq.airport-road/twin-room&status=neq.archived&select=live,status')).every((r) => r.live && r.status === 'published'), 'publish: every photo of the target is live');
  check(/في الانتظار/.test(await page.locator(`[data-job="${jobs[0].id}"]`).textContent()), 'jobs: «في الانتظار» with the time');
  await shot(page, 'room-1280-full');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await shot(page, 'room-1280-dark-full');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  check(await page.locator('[data-target="room:airport-road/twin-room"] .media-dot-live').count() === 1, 'picker: the room type is now «منشورة»');
  const man = await rpc('media_site_manifest', {});
  await rpc('media_job_update', { p_id: jobs[0].id, p_status: 'building', p_run_url: 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/1' });
  await rpc('media_jobs_settle', { p_manifest_at: man.at, p_ok: true, p_run_url: 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/2' });
  await page.reload();
  await page.waitForSelector(`[data-job="${jobs[0].id}"][data-job-status="published"]`, { timeout: 30000 });
  check(/منشور/.test(await page.locator(`[data-job="${jobs[0].id}"]`).textContent()) && (await page.locator(`[data-job="${jobs[0].id}"] [data-run-link]`).getAttribute('href')).endsWith('/runs/2'), 'jobs: «منشور» with the build-log link after the workflow report');

  // ── «إظهار في المعرض» (2 Nov 2026): on by default, off reaches the site only at «نشر» ──
  check((await rest('media_items?target_key=eq.airport-road/twin-room&status=neq.archived&select=in_gallery,live')).every((r) => r.in_gallery === true && r.live?.in_gallery === true), 'gallery switch: every photo starts shown in the gallery (column and live snapshot)');
  await openItem(page, third.id);
  check(await page.locator('#media-in-gallery').isChecked(), 'gallery switch: on in the dialog by default');
  await page.uncheck('#media-in-gallery');
  await page.click('[data-action="dialog-cancel"]');
  await page.waitForSelector('dialog[data-unsaved-confirm][open]', { timeout: 3000 }).catch(() => {});
  check(await page.locator('dialog[data-unsaved-confirm][open]').count() > 0, 'gallery switch: unticking it makes the dialog dirty (cancel asks first)');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-unsaved-confirm][open]', { state: 'detached', timeout: 3000 }).catch(() => {});
  await page.click('[data-action="media-save"]');
  await page.waitForSelector(`[data-media-dialog="${third.id}"]`, { state: 'detached' });
  const off = await item('qa-third');
  check(off.in_gallery === false && off.live?.in_gallery === true, 'gallery switch: saved off; the site keeps it until «نشر»', JSON.stringify({ c: off.in_gallery, l: off.live?.in_gallery }));
  await page.waitForSelector(`[data-item="${third.id}"] [data-off-gallery]`);
  check(/خارج المعرض/.test(await page.locator(`[data-item="${third.id}"] [data-off-gallery]`).textContent()), 'gallery switch: the tile says «خارج المعرض»');
  check(await page.locator('[data-action="media-publish"]').isEnabled(), 'gallery switch: the target has a change to publish');
  await page.click('[data-action="media-publish"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-job]').length === 2, null, { timeout: 30000 });
  check((await item('qa-third')).live?.in_gallery === false, 'gallery switch: «نشر» carries it to the live snapshot');
  const man2 = await rpc('media_site_manifest', {});
  check(man2.items.find((x) => x.id === third.id)?.in_gallery === false && man2.items.filter((x) => x.key === 'airport-road/twin-room' && x.id !== third.id).every((x) => x.in_gallery === true), 'gallery switch: the build manifest carries it');
  await rpc('media_jobs_settle', { p_manifest_at: man2.at, p_ok: true, p_run_url: 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/3' });

  // ── a branch: required story scenes; «نشر الكل» with a blocked target ──
  await target(page, 'branch:airport-road');
  await page.setInputFiles('[data-file-input="cover"]', F.bcover);
  await uploadsDone(page, ['qa-branch-cover.jpg']);
  const bcover = await item('qa-branch-cover');
  await fillAlts(page, bcover.id, 'واجهة الفرع ومدخله', 'The branch front and its entrance');
  await page.click('[data-action="media-publish"]');
  await page.waitForSelector('[data-blocked]');
  const bt = await page.locator('[data-blocked]').textContent();
  check(['المدخل والموقع', 'اللوبي والاستقبال', 'الغرف والأجنحة', 'المطعم والخدمات'].every((s) => bt.includes(s)), 'branch: publishing is blocked until the 4 story scenes are there', bt.slice(0, 200));
  await page.click('[data-blocked] [data-action="dialog-cancel"]');
  // a Discover Taif place: its cover only, nothing required (2 Nov 2026 — the retired restaurant section's step)
  await target(page, 'place:al-hada-cable-car');
  check(await page.locator('[data-file-input="gallery"]').count() === 0, 'place: a cover only, no gallery');
  await page.setInputFiles('[data-file-input="cover"]', F.rest);
  await uploadsDone(page, ['qa-restaurant.jpg']);
  const rest1 = await item('qa-restaurant');
  await openItem(page, rest1.id);
  check(await page.locator('#media-in-gallery').count() === 0, 'gallery switch: not offered for a Discover Taif place cover');
  await page.click('[data-action="dialog-cancel"]');
  await page.waitForSelector(`[data-media-dialog="${rest1.id}"]`, { state: 'detached' });
  await fillAlts(page, rest1.id, 'طاولات المطعم', 'The restaurant tables');
  await page.click('[data-action="media-publish-all"]');
  await page.waitForSelector('[data-blocked-target="branch:airport-road"]');
  check(await page.locator('[data-action="media-publish-ready"]').textContent().then((t) => /نشر المكتمل فقط \(1\)/.test(t)), '«نشر الكل»: lists the blocked branch and offers the complete ones');
  await page.click('[data-action="media-publish-ready"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-job]').length === 3, null, { timeout: 30000 });
  check((await item('qa-restaurant')).live !== null && (await item('qa-branch-cover')).live === null, '«نشر المكتمل فقط»: the place cover is published, the blocked branch is not');

  // ── «صفحات الشركاء» (2 Nov 2026): the Shafa Road card keeps its 4:5 legacy ratio ──
  await target(page, 'partners:index-shafa-road');
  check(await page.locator('[data-file-input="gallery"]').count() === 0 && (await page.locator('[data-slot="cover"] [data-required]').count()) === 0, 'partners slot: a cover only, not required');
  await page.setInputFiles('[data-file-input="cover"]', F.partner);
  await uploadsDone(page, ['qa-partner.jpg']);
  const partner = await item('qa-partner');
  check(partner?.target === 'partners' && partner.target_key === 'index-shafa-road' && partner.branch === null && partner.upload_state === 'ready', 'partners slot: uploaded as a ready draft with no branch scope');
  await openItem(page, partner.id);
  await page.waitForSelector('[data-focal] img', { timeout: 15000 }).catch(() => {});
  const crops = await page.locator('[data-crop]').evaluateAll((els) => els.map((e) => e.getAttribute('data-crop')));
  check(crops.join() === '0.800', 'partners slot: one crop at the slot\'s own ratio (4:5), no sharing crop', crops.join());
  check(await page.locator('#media-in-gallery').count() === 0, 'partners slot: «إظهار في المعرض» is not offered');
  await page.click('[data-action="dialog-cancel"]');
  await page.waitForSelector(`[data-media-dialog="${partner.id}"]`, { state: 'detached' });
  await page.click('[data-action="media-publish"]');
  await page.waitForSelector('[data-blocked]');
  check(/الصورة الرئيسية: النص البديل بالعربية/.test(await page.locator('[data-blocked]').textContent()), 'partners slot: publishing waits for both alts');
  await page.click('[data-blocked] [data-action="dialog-cancel"]');
  await fillAlts(page, partner.id, 'واجهة فرع طريق الشفا مساءً', 'The Shafa Road front in the evening');
  await page.click('[data-action="media-publish"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-job]').length === 4, null, { timeout: 30000 });
  const man3 = await rpc('media_site_manifest', {});
  check(man3.items.some((x) => x.target === 'partners' && x.key === 'index-shafa-road' && x.slot === 'cover' && x.alt_en === 'The Shafa Road front in the evening'), 'partners slot: published into the build manifest');

  // ── «اختيار صورة موجودة» (5 Nov 2026): a photo already in the dashboard fills another slot without an upload ──
  {
    const bytesOf = async (path) => {
      const r = await fetch(`${URL_}/storage/v1/object/media-originals/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    };
    const sha = (b) => (b ? createHash('sha256').update(b).digest('hex') : null);
    const before = (await rest(`media_items?id=eq.${partner.id}&select=*`))[0];
    await target(page, 'partners:index-final');
    const btn = page.locator('[data-slot="cover"] [data-action="choose-existing"]');
    check(await btn.isVisible(), 'existing: every photo slot offers «اختيار صورة موجودة»');
    await btn.click();
    await page.waitForSelector('[data-existing-picker="partners:index-final:cover"]');
    await page.waitForSelector('[data-existing]');
    await page.fill('[data-existing-search]', 'واجهة فرع طريق الشفا');
    await page.waitForTimeout(150);
    const listed = await page.locator('[data-existing]').evaluateAll((els) => els.map((e) => e.getAttribute('data-existing')));
    check(listed.includes(partner.id) && listed.length <= 3, 'existing: the search finds the photo by its description', listed.join());
    await page.click(`[data-existing="${partner.id}"]`);
    check((await page.locator('[data-existing-chosen]').textContent()).includes('qa-partner.jpg'), 'existing: the chosen photo is named (file and page)');
    await page.click('[data-action="existing-use"]');
    await page.waitForSelector('[data-existing-picker]', { state: 'detached', timeout: 60000 });
    await page.waitForSelector('[data-slot="cover"] [data-open]');
    const copy = (await rest(`media_items?target=eq.partners&target_key=eq.index-final&status=neq.archived&select=*`))[0];
    check(copy && copy.upload_state === 'ready' && copy.status === 'draft' && copy.slot === 'cover' && copy.id !== partner.id, 'existing: a ready draft in the new slot', JSON.stringify(copy).slice(0, 160));
    check(copy && copy.sha256 === before.sha256 && copy.bytes === before.bytes && copy.file_name === before.file_name && copy.width === before.width && copy.height === before.height,
      'existing: the copy is the same file (sha256, size, name, dimensions)');
    check(copy && copy.alt_ar === before.alt_ar && copy.alt_en === before.alt_en, 'existing: both descriptions copied');
    check(copy && copy.original_path !== before.original_path && copy.original_path.startsWith('partners/index-final/'), 'existing: stored at its own path', copy?.original_path);
    const srcB = await bytesOf(before.original_path);
    const dstB = copy ? await bytesOf(copy.original_path) : null;
    check(!!dstB && sha(dstB) === sha(srcB) && sha(dstB) === before.sha256, 'existing: the stored original copied byte for byte (full size, not a preview)');
    check(!!copy?.thumb_path && !!(await bytesOf(copy.thumb_path)), 'existing: the dashboard previews copied too');
    const after = (await rest(`media_items?id=eq.${partner.id}&select=*`))[0];
    check(['status', 'slot', 'original_path', 'thumb_path', 'alt_ar', 'alt_en', 'updated_at', 'target_key'].every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k])) && JSON.stringify(after.live) === JSON.stringify(before.live) && !!srcB,
      'existing: the source is untouched (row and file)');
    // the same photo again: shown as already here
    await btn.click();
    await page.waitForSelector(`[data-existing="${partner.id}"]`);
    check(await page.locator(`[data-existing="${partner.id}"]`).isDisabled(), 'existing: a photo already in this page cannot be chosen again');
    await shot(page, 'existing-picker');
    await page.click('[data-existing-picker] [data-action="dialog-cancel"]');
    await page.waitForSelector('[data-existing-picker]', { state: 'detached' });
    // a gallery: the copy goes to the end of the order
    await target(page, 'room:airport-road/twin-room');
    const galBefore = await rest(`media_items?target=eq.room&target_key=eq.airport-road/twin-room&slot=eq.gallery&status=neq.archived&select=id,sort&order=sort`);
    await page.click('[data-slot="gallery"] [data-action="choose-existing"]');
    await page.waitForSelector(`[data-existing="${partner.id}"]`);
    await page.click(`[data-existing="${partner.id}"]`);
    await page.click('[data-action="existing-use"]');
    await page.waitForSelector('[data-existing-picker]', { state: 'detached', timeout: 60000 });
    const galAfter = await rest(`media_items?target=eq.room&target_key=eq.airport-road/twin-room&slot=eq.gallery&status=neq.archived&select=id,sort,sha256&order=sort`);
    check(galAfter.length === galBefore.length + 1 && galAfter.at(-1).sha256 === before.sha256, 'existing: a gallery copy is added at the end of the order');
    // «المدونة»: the article's cover and its text photos
    const art = (await rest(`articles?slug=eq.where-to-stay-in-taif&select=id`))[0];
    await page.goto(`${BASE}/blog/${art.id}`);
    await page.waitForSelector('[data-action="blog-existing-cover"]', { timeout: 20000 });
    await page.click('[data-action="blog-existing-cover"]');
    await page.waitForSelector(`[data-existing-picker="blog:where-to-stay-in-taif:cover"] [data-existing="${partner.id}"]`);
    await page.click(`[data-existing="${partner.id}"]`);
    await page.click('[data-action="existing-use"]');
    await page.waitForSelector('[data-existing-picker]', { state: 'detached', timeout: 60000 });
    const bcover = (await rest(`media_items?target=eq.blog&target_key=eq.where-to-stay-in-taif&slot=eq.cover&status=neq.archived&select=*`))[0];
    check(bcover && bcover.sha256 === before.sha256 && bcover.alt_en === before.alt_en && bcover.upload_state === 'ready', 'existing (blog): the article cover from an existing photo, with its descriptions');
    await page.waitForSelector('[data-cover] img', { timeout: 15000 }).catch(() => {});
    check(await page.locator('[data-cover] img').isVisible(), 'existing (blog): the editor shows the new cover');
    await page.click('[data-action="blog-existing-gallery"]');
    await page.waitForSelector('[data-existing-picker="blog:where-to-stay-in-taif:gallery"] [data-existing]');
    check(await page.locator(`[data-existing="${partner.id}"]`).isDisabled(), 'existing (blog): the cover photo is already in this article');
    const other = await page.locator('[data-existing]:not([disabled])').first().getAttribute('data-existing');
    await page.click(`[data-existing="${other}"]`);
    await page.click('[data-action="existing-use"]');
    await page.waitForSelector('[data-image-dialog]', { timeout: 60000 });
    await page.waitForTimeout(300);
    const pre = await page.locator('[data-image-dialog] [aria-checked="true"]').getAttribute('data-photo').catch(() => null);
    const bgal = (await rest(`media_items?target=eq.blog&target_key=eq.where-to-stay-in-taif&slot=eq.gallery&status=neq.archived&select=id&order=created_at.desc`))[0];
    check(!!bgal && pre === bgal.id, 'existing (blog): a text photo is added and preselected in «إدراج صورة»', `${pre} / ${bgal?.id}`);
    check(await page.locator('[data-image-dialog] [data-action="image-existing"]').isVisible(), 'existing (blog): «إدراج صورة» offers «اختيار صورة موجودة»');
    await page.click('[data-image-dialog] [data-action="dialog-cancel"]');
    await page.goto(`${BASE}/media`);
    await page.waitForSelector('[data-current]');
  }


  // ── the hero: video + poster ──
  await target(page, 'home:home');
  await page.setInputFiles('[data-file-input="hero-video"]', F.video);
  await uploadsDone(page, ['qa-hero.mp4']);
  const vw = (await page.locator('[data-upload="qa-hero.mp4"] [data-upload-warning]').allTextContents()).join(' | ');
  check((await stageOf(page, 'qa-hero.mp4')) === 'done' && /1280 × 720/.test(vw) && /الصوت يُحذف/.test(vw), 'video: uploaded through the UI with its size and audio notes', vw);
  const vid = await item('qa-hero');
  check(vid.kind === 'video' && Math.abs(Number(vid.duration) - 3) < 0.5 && vid.thumb_path, 'database: the video with its duration and a frame preview', JSON.stringify({ d: vid.duration, t: !!vid.thumb_path }));
  await page.click('[data-action="media-publish"]');
  await page.waitForSelector('[data-blocked]');
  check(/صورة الواجهة \(مطلوبة مع الفيديو\)/.test(await page.locator('[data-blocked]').textContent()), 'hero: a video without a poster is blocked');
  await page.click('[data-blocked] [data-action="dialog-cancel"]');
  await page.setInputFiles('[data-file-input="hero-poster"]', F.poster);
  await uploadsDone(page, ['qa-poster.jpg']);
  const poster = await item('qa-poster');
  await openItem(page, poster.id);
  await page.waitForSelector('[data-focal] img', { timeout: 15000 }).catch(() => {});
  check(await page.locator('[data-crop]').count() === 3, 'dialog: the hero poster shows 16:9, 4:5 and the sharing crop');
  await page.click('[data-action="dialog-cancel"]');
  await fillAlts(page, poster.id, 'واجهة الفندق مساءً', 'The hotel front in the evening');
  await fillAlts(page, vid.id, 'لقطات من الفندق', 'Scenes from the hotel');
  await page.click('[data-action="media-publish"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-job]').length === 5, null, { timeout: 30000 });
  check((await item('qa-poster')).live && (await item('qa-hero')).live, 'hero: poster + video published together');

  // ── the home hero: «فيديو» or «صور متتابعة» (6 Nov 2026) ──
  await rest('media_hero?id=eq.home', { method: 'PATCH', body: JSON.stringify({ mode: 'video', live_mode: 'video' }) });
  await page.goto(`${BASE}/media?t=home:home`);
  await page.waitForSelector('[data-current="home:home"] [data-hero-mode]');
  check((await page.locator('[data-hero-mode]').getAttribute('data-hero-mode')) === 'video' && (await page.locator('[data-hero-mode-option="video"]').getAttribute('aria-pressed')) === 'true', 'hero: «فيديو» chosen by default (pressed)');
  check(await page.locator('[data-current="home:home"] [data-slot="hero-video"]').count() === 1 && (await page.locator('[data-current="home:home"] [data-slot="gallery"]').count()) === 0, 'hero, video mode: the poster and video slots, no photo list');
  await page.click('[data-hero-mode-option="photos"]');
  await page.waitForSelector('[data-hero-mode="photos"]');
  check(await page.locator('[data-hero-mode-pending]').isVisible() && /حتى «نشر هذه الصفحة»/.test(await page.locator('[data-hero-mode-pending]').textContent()), 'hero: the new choice is a draft until «نشر» (the note says what the site shows now)');
  check(/صور الواجهة المتتابعة/.test(await page.locator('[data-current="home:home"] [data-slot="gallery"] h3').textContent()) && (await page.locator('[data-current="home:home"] [data-slot="hero-video"]').count()) === 0, 'hero, photos mode: «صور الواجهة المتتابعة» instead of the video slots');
  check(/المطلوب من 3 إلى 8/.test(await page.locator('[data-hero-slides-missing]').textContent()), 'hero, photos mode under 3 photos: «المطلوب من 3 إلى 8»', await page.locator('[data-hero-slides-missing]').textContent());
  let hero = (await rest('media_hero?select=mode,live_mode'))[0];
  check(hero.mode === 'photos' && hero.live_mode === 'video', 'hero: the draft is stored, the site keeps the video', JSON.stringify(hero));
  const slides = [await jpeg('slide-a', 3840, 2160, 10), await jpeg('slide-b', 3840, 2160, 90), await jpeg('slide-c', 3840, 2160, 170)];
  await page.setInputFiles('[data-current="home:home"] [data-file-input="gallery"]', slides);
  await uploadsDone(page, ['qa-slide-a.jpg', 'qa-slide-b.jpg', 'qa-slide-c.jpg']);
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="gallery"] [data-open]').length === 3, null, { timeout: 20000 }).catch(() => {});
  check(await page.locator('[data-slot="gallery"] [data-open]').count() === 3, 'hero: three photos uploaded into the slideshow');
  check(/الوصف|النص البديل/.test(await page.locator('[data-target-state]').textContent()), 'hero: publishing waits for both descriptions of each photo');
  for (const [n, f] of ['a', 'b', 'c'].entries()) {
    const it = await item(`slide-${f}`);
    await fillAlts(page, it.id, `صورة الواجهة رقم ${n + 1} للاختبار`, `Hero test photo ${n + 1}`);
  }
  await page.waitForFunction(() => !document.querySelector('[data-hero-slides-missing]'), null, { timeout: 15000 }).catch(() => {});
  check(await page.locator('[data-hero-slides-missing]').count() === 0, 'hero: three photos with their descriptions — nothing missing');
  // Ahmed's order: the third first
  const ids3 = await galleryOrder('home', (o) => o.length === 3);
  await page.locator(`[data-item="${ids3[2]}"] [data-action="move-earlier"]`).click();
  await page.locator(`[data-item="${ids3[2]}"] [data-action="move-earlier"]`).click();
  const ord = await galleryOrder('home', (o) => o[0] === ids3[2]);
  check(ord[0] === ids3[2], 'hero: the order is set by «تقديم»', JSON.stringify(ord));
  const before = dispatches.length;
  await page.click('[data-action="media-publish"]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-job]').length > 0, before, { timeout: 15000 });
  await page.waitForTimeout(800);
  hero = (await rest('media_hero?select=mode,live_mode'))[0];
  check(hero.live_mode === 'photos', 'hero: «نشر هذه الصفحة» puts the slideshow on the site (live_mode photos)', JSON.stringify(hero));
  check(dispatches.length === before + 1 && dispatches.at(-1).reason === 'media', 'hero: the site build is asked (stubbed)', JSON.stringify(dispatches.at(-1)));
  const manHero = await rpc('media_site_manifest', {});
  check(manHero.hero?.mode === 'photos' && manHero.items.filter((i) => i.target === 'home' && i.slot === 'gallery').map((i) => i.id).join() === ord.join(), 'hero: the manifest carries photos mode and the three photos in Ahmed\'s order');
  await shot(page, 'home-hero-photos-1280');
  // back to the video: the choice alone is a change to publish
  await page.click('[data-hero-mode-option="video"]');
  await page.waitForSelector('[data-hero-mode="video"]');
  check(await page.locator('[data-action="media-publish"]').isEnabled(), 'hero: switching back is a change of its own («نشر» enabled)');
  await page.click('[data-action="media-publish"]');
  await page.waitForTimeout(1500);
  hero = (await rest('media_hero?select=mode,live_mode'))[0];
  check(hero.live_mode === 'video' && hero.mode === 'video', 'hero: back on video after «نشر»', JSON.stringify(hero));
  const audit = await rest(`audit_log?entity=eq.media_hero&select=actor_label,new&order=id`);
  check(audit.length >= 4 && audit.every((a) => ['QA admin', 'migration', 'system'].includes(a.actor_label)) && audit.some((a) => a.actor_label === 'QA admin'), 'hero: every change of the choice is audited with its actor', JSON.stringify(audit.slice(-3)));

  // 375 px: the picker in its disclosure, no horizontal scroll
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  check(await page.locator('[data-action="picker-toggle"]').isVisible() && (await page.locator('[data-action="picker-toggle"]').getAttribute('aria-expanded')) === 'false', '375 px: the picker is a disclosure under the current page name');
  await page.click('[data-action="picker-toggle"]');
  check(await page.locator('[data-picker-search]').isVisible() && (await page.locator('[data-group="home"]').isVisible()), '375 px: the disclosure opens the same grouped list');
  await shot(page, 'picker-375');
  await page.click('[data-action="picker-toggle"]');
  await shot(page, 'home-375-full');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '375 px: no horizontal scroll');
  await ctx.close();

  // ── edit without publish ──
  const m = await login('mgmt@qa.invalid');
  await stubRebuild(m.ctx);
  await m.page.goto(`${BASE}/media?t=room:airport-road/king-room`);
  await m.page.waitForSelector('[data-current="room:airport-road/king-room"] [data-slot="cover"]');
  check(await m.page.locator('[data-action="media-publish"], [data-action="media-publish-all"]').count() === 0, 'edit level: no «نشر» button');
  check(await m.page.locator('[data-file-input="cover"]').count() === 1, 'edit level: uploads are offered');
  const token = await m.page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token'));
    return k ? JSON.parse(localStorage.getItem(k)).access_token : null;
  });
  const res = await fetch(`${URL_}/rest/v1/rpc/media_publish`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_targets: null }) });
  const body = await res.json().catch(() => ({}));
  check(res.status === 403 || body.code === '42501', 'edit level: the publish RPC is refused by the database', `${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  // view only
  await setLevel(users.mgmt, 'view');
  await m.page.reload();
  await m.page.waitForSelector('[data-current]');
  check(await m.page.locator('[data-file-input]').count() === 0, 'view level: no upload');
  check(await m.page.locator('[data-action="choose-existing"]').count() === 0, 'view level: no «اختيار صورة موجودة»');
  await reveal(m.page, 'room:airport-road/twin-room');
  await m.page.click('[data-target="room:airport-road/twin-room"]');
  await m.page.waitForSelector('[data-slot="cover"] [data-open]');
  await m.page.locator('[data-slot="cover"] [data-open]').click();
  await m.page.waitForSelector('[data-media-dialog]');
  check(await m.page.locator('#alt-ar').isDisabled() && (await m.page.locator('[data-action="media-save"]').count()) === 0, 'view level: the dialog is read-only («إغلاق»)');
  await m.page.click('[data-action="dialog-cancel"]');
  // none
  await setLevel(users.mgmt, 'none');
  await m.page.reload();
  await m.page.waitForSelector('#app-main');
  await m.page.waitForTimeout(800);
  check(await m.page.locator('nav a[href$="/media"]').count() === 0, 'none: «الصور» is not in the nav');
  await m.ctx.close();
} catch (e) {
  // the error and its first frames, without Playwright's call log
  fails.push(`crash: ${String(e.stack || e).split(/\r?\n/).filter((l) => !/^\s*-/.test(l) && !l.includes(String.fromCharCode(27))).slice(0, 4).join(' ')}`);
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: join(DIR, `crash-${Date.now()}.png`), fullPage: true }).catch(() => {});
  console.log(`screenshots in ${DIR}`);
} finally {
  await setLevel(users.mgmt, 'none').catch(() => {});
  await browser.close();
}
console.log(`\n${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
