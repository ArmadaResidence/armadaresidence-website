// «شعارات الشركاء» (7 Nov 2026) end to end on a PREVIEW BRANCH (the script refuses the production project), modelled on
// reviews-check.mjs: the sidebar item next to «آراء الضيوف», the strip note; three logos added through the form (two
// SVG, one PNG — the samples of scripts/fixtures/partner-logos-sample.json) with their previews on porcelain and
// midnight and the size read from the file; a refused SVG (a script) and a refused file type; the checks while typing
// («شعار» alone, a short English name), Esc on an edited dialog asks «تعديلات غير محفوظة»; «في الصفحة الرئيسية» off
// (the chip), reorder («تأخير», saved), «نشر» (the rows published, their live snapshots, the site job with target
// partner_logos, the service-only manifest without the hidden logo); «حذف الشعار» only for a never-published draft
// (confirm); a view-only user (content view) sees the list but cannot add, edit, delete or publish; 1280 and 375, light.
//   node admin/tests/partner-logos-check.mjs [BASE_URL=http://127.0.0.1:5173]
//   env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (the branch), LOGIN_CODE_VIA_SERVICE=1
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY of the preview branch are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const SHOTS = 'screenshots/partner-logos';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
};

// ── the sample files (TEST samples only) ──
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../scripts/fixtures/partner-logos-sample.json', import.meta.url)), 'utf8'));
const DIR = mkdtempSync(join(tmpdir(), 'armada-logos-'));
const svgs = FIXTURE.items.filter((i) => i.kind === 'svg');
const pngItem = FIXTURE.items.find((i) => i.kind === 'png');
const FILES = {
  svg1: join(DIR, 'sample-1.svg'),
  svg2: join(DIR, 'sample-2.svg'),
  png: join(DIR, 'sample-3.png'),
  bad: join(DIR, 'bad.svg'),
  gif: join(DIR, 'bad.gif'),
};
writeFileSync(FILES.svg1, `<?xml version="1.0" encoding="UTF-8"?>\n<!-- a sample export -->\n${svgs[0].data}\n`);
writeFileSync(FILES.svg2, svgs[1].data);
writeFileSync(FILES.png, Buffer.from(pngItem.data, 'base64'));
writeFileSync(FILES.bad, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>');
writeFileSync(FILES.gif, Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));

// ── the branch: the QA users on their presets (management: content view for the view-only part), earlier QA logos out ──
const sections = await rest('sections?select=key,presets');
const staff = await rest('staff?select=user_id,full_name,role,branch,active&active=eq.true');
const byRole = (role) => staff.find((s) => s.role === role);
const admin = byRole('admin');
const mgmt = byRole('management');
for (const u of [admin, mgmt]) {
  for (const x of sections) await rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${x.key}`, { method: 'PATCH', body: JSON.stringify({ level: x.presets[u.role] ?? 'none' }) });
}
await rest(`staff_permissions?user_id=eq.${mgmt.user_id}&section=eq.content`, { method: 'PATCH', body: JSON.stringify({ level: 'view' }) });
await rest('partner_logos?name_en=like.QA*', { method: 'DELETE' });
const before = (await rest('partner_logos?select=id')).length;

const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  // the site build is never dispatched from a check
  await ctx.route('**/functions/v1/site-rebuild', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, dispatched: true }) }));
  await ctx.addInitScript(() => {
    try { localStorage.setItem('armada-test-events', '1'); } catch { /* */ }
  });
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
  await page.waitForSelector('[data-side-nav]', { state: 'attached' });
  return { ctx, page };
}
const rows = (page) => page.locator('[data-logo-row]');
const qa = async () => rest('partner_logos?name_en=like.QA*&select=id,name_ar,name_en,kind,width,height,sort,show_home,live,first_published_at&order=sort');
/** add one logo through the form: the file, both names, save */
async function addLogo(page, file, ar, en) {
  await page.click('[data-action="logo-add"]');
  await page.waitForSelector('[data-logo-form]');
  await page.setInputFiles('[data-logo-input]', file);
  await page.waitForSelector('[data-logo-form] [data-logo-previews]');
  await page.fill('[data-field="name_ar"]', ar);
  await page.fill('[data-field="name_en"]', en);
  await page.click('[data-action="logo-save"]');
  await page.waitForSelector('[data-logo-form]', { state: 'detached' });
}

// ── admin ──
{
  const { ctx, page } = await login('admin@qa.invalid');
  const nav = page.locator('[data-sidebar] a[data-nav="partner-logos"]');
  check(await nav.count() === 1, 'the sidebar lists «شعارات الشركاء»');
  check(await page.evaluate(() => {
    const links = [...document.querySelectorAll('[data-sidebar] a[data-nav]')].map((a) => a.getAttribute('data-nav'));
    return links[links.indexOf('reviews') + 1] === 'partner-logos';
  }), 'the item comes right after «آراء الضيوف»');
  await page.goto(`${BASE}/partner-logos`);
  await page.waitForSelector('h1');
  check(/يظهر الشريط في الصفحة الرئيسية عندما تكون 3 شعارات أو أكثر في الصفحة الرئيسية\./.test(await page.locator('[data-logo-strip-note]').innerText()), 'the note under the heading');
  check(await page.locator('[data-action="logo-publish"]').isDisabled(), '«نشر» waits while nothing is pending');

  // refused files
  await page.click('[data-action="logo-add"]');
  await page.waitForSelector('[data-logo-form]');
  await page.setInputFiles('[data-logo-input]', FILES.bad);
  check(await until(() => page.locator('[data-logo-error]').isVisible(), 5000), 'an SVG with a script is refused in the browser');
  check(await page.locator('[data-logo-form] [data-logo-previews]').count() === 0, 'nothing previewed for the refused file');
  await page.setInputFiles('[data-logo-input]', FILES.gif);
  check(/SVG أو PNG/.test(await page.locator('[data-logo-error]').innerText().catch(() => '')), 'a GIF is refused (SVG or PNG only)');
  await page.click('[data-action="logo-save"]');
  check(await until(() => page.locator('[data-form-error]').isVisible(), 3000), 'save without a file: «اختر ملف الشعار»');
  await page.locator('[data-logo-form] [data-action="dialog-cancel"]').click();
  await page.waitForSelector('[data-logo-form]', { state: 'detached' });

  // the first logo: an SVG with an XML prolog and a comment (cleaned), the checks while typing, Esc
  await page.click('[data-action="logo-add"]');
  await page.waitForSelector('[data-logo-form]');
  await page.setInputFiles('[data-logo-input]', FILES.svg1);
  await page.waitForSelector('[data-logo-form] [data-logo-previews]');
  check(await page.locator('[data-logo-form] [data-logo-previews] img').count() === 2, 'the form previews the logo on porcelain and on midnight');
  check(/SVG · 160 × 60/.test(await page.locator('[data-logo-size]').innerText()), 'the size read from the SVG (160 × 60)', await page.locator('[data-logo-size]').innerText());
  await page.fill('[data-field="name_ar"]', 'شعار');
  await page.fill('[data-field="name_en"]', 'QA');
  const notes = await page.locator('[data-logo-problems]').innerText().catch(() => '');
  check(/عام لا يصف الشعار/.test(notes) && /أقصر من 4 أحرف/.test(notes), 'the checks while typing: «شعار» alone, a short English name', notes.replace(/\s+/g, ' '));
  await page.keyboard.press('Escape');
  check(await until(() => page.getByText('تعديلات غير محفوظة').first().isVisible(), 4000), 'Esc on an edited dialog asks «تعديلات غير محفوظة»');
  await page.getByRole('button', { name: 'متابعة التعديل' }).click();
  await page.fill('[data-field="name_ar"]', 'شريك تجريبي أول');
  await page.fill('[data-field="name_en"]', 'QA sample partner one');
  check(await page.locator('[data-logo-problems]').count() === 0, 'fixed: no problem left');
  await page.click('[data-action="logo-save"]');
  await page.waitForSelector('[data-logo-form]', { state: 'detached' });

  await addLogo(page, FILES.svg2, 'شريك تجريبي ثانٍ', 'QA sample partner two');
  await addLogo(page, FILES.png, 'شريك تجريبي ثالث', 'QA sample partner three');
  const three = await until(async () => {
    const r = await qa();
    return r.length === 3 ? r : null;
  });
  check(!!three, 'three logos saved', JSON.stringify((await qa()).map((r) => r.name_en)));
  check(!!three && three.map((r) => r.kind).join(',') === 'svg,svg,png' && three.every((r) => !r.live), 'saved as drafts in the order added (svg, svg, png)');
  check(!!three && three[2].width === 160 && three[2].height === 60, 'the PNG keeps its own size (160 × 60)');
  check(await until(() => page.locator('[data-logo-row][data-state="draft"]').count().then((n) => n === 3)), 'the rows show «مسودة لم تُنشر»');
  check(await page.locator(`[data-logo-row="${three?.[0].id}"] [data-logo-previews] img`).count() === 2, 'each row previews its logo on both backgrounds');
  check(/\(3\)/.test(await page.locator('[data-action="logo-publish"]').innerText()), '«نشر (3)»');
  await shot(page, 'list-1280');

  // «في الصفحة الرئيسية» off for the second
  const second = three[1].id;
  await page.locator(`[data-logo-row="${second}"] [data-action="logo-edit"]`).click();
  await page.waitForSelector('[data-logo-form]');
  await page.uncheck('[data-field="show_home"]');
  await page.click('[data-action="logo-save"]');
  await page.waitForSelector('[data-logo-form]', { state: 'detached' });
  check(await until(async () => (await qa()).find((r) => r.id === second)?.show_home === false), '«في الصفحة الرئيسية» off saved');
  check(await until(() => page.locator(`[data-logo-row="${second}"]`).innerText().then((t) => /ليس في الصفحة الرئيسية/.test(t))), 'the row says «ليس في الصفحة الرئيسية»');

  // reorder: «تأخير» moves the first after the second
  const first = three[0].id;
  await page.locator(`[data-logo-row="${first}"] [data-action="logo-later"]`).click();
  check(await until(async () => {
    const r = await qa();
    return r[0]?.id === second && r[1]?.id === first;
  }), 'reorder: «تأخير» saved', JSON.stringify((await qa()).map((r) => `${r.name_en}:${r.sort}`)));
  check(await until(async () => (await rows(page).nth(before).getAttribute('data-logo-row')) === second), 'reorder: the list follows');

  // «نشر»
  await page.click('[data-action="logo-publish"]');
  const pub = await until(async () => {
    const r = await qa();
    return r.every((x) => x.live && x.first_published_at) ? r : null;
  });
  check(!!pub, '«نشر»: the three published');
  check(!!pub && pub.find((r) => r.id === second).live.show_home === false && pub.find((r) => r.id === first).live.name_en === 'QA sample partner one', 'the live snapshots hold the names and the switch');
  const jobs = await rest('media_publish_jobs?select=id,targets&order=requested_at.desc&limit=1');
  check(JSON.stringify(jobs[0]?.targets ?? []).includes('"partner_logos"'), 'a site job for the partner logos');
  const manifest = await rest('rpc/partner_logos_site_manifest', { method: 'POST', body: '{}' });
  const mine = (manifest.items ?? []).filter((i) => /^QA /.test(i.name_en));
  check(mine.length === 2 && mine.every((i) => i.id !== second) && mine.every((i) => i.data && i.width && i.height), 'the manifest: the two shown logos with their files, not the hidden one', JSON.stringify(mine.map((i) => i.name_en)));
  check(await until(() => page.locator('[data-logo-row][data-state="draft"]').count().then((n) => n === 0)), 'the rows show «منشور»');
  check(await page.locator('[data-on-home]').count() >= 2, '«يظهر الآن في الصفحة الرئيسية» on the two shown');
  if (before === 0) check(/لا يظهر الشريط بعد/.test(await page.locator('[data-logo-home-count]').innerText()), 'two on the home page (fewer than 3): «لا يظهر الشريط بعد»');
  check(await page.locator('[data-action="logo-delete"]').count() === 0, 'no «حذف الشعار» on a published logo');

  // a draft can be deleted (confirm)
  await addLogo(page, FILES.svg2, 'شريك تجريبي للحذف', 'QA draft partner');
  check(await until(() => page.locator('[data-action="logo-delete"]').count().then((n) => n === 1)), '«حذف الشعار» shows only on the never-published draft');
  await page.click('[data-action="logo-delete"]');
  await page.getByRole('dialog').getByRole('button', { name: 'حذف الشعار' }).click();
  check(await until(async () => (await qa()).every((r) => r.name_en !== 'QA draft partner')), 'the draft is deleted after the confirm');
  await ctx.close();
}

// ── a phone ──
{
  const { ctx, page } = await login('admin@qa.invalid', { width: 375, height: 812 });
  await page.goto(`${BASE}/partner-logos`);
  await page.waitForSelector('[data-logo-row]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, '375: no horizontal scroll', String(overflow));
  await shot(page, 'list-375');
  await ctx.close();
}

// ── management with content view: read only ──
{
  const { ctx, page } = await login('mgmt@qa.invalid');
  check(await page.locator('[data-sidebar] a[data-nav="partner-logos"]').count() === 1, 'content view: «شعارات الشركاء» in the sidebar');
  await page.goto(`${BASE}/partner-logos`);
  await page.waitForSelector('[data-logo-row]');
  check(await rows(page).count() >= 3, 'content view: the list');
  check(await page.locator('[data-action="logo-add"], [data-action="logo-publish"], [data-action="logo-delete"], [data-action="logo-earlier"], [data-action="logo-later"]').count() === 0, 'content view: no add, publish, delete or reorder');
  await rows(page).first().locator('[data-action="logo-edit"]').click();
  await page.waitForSelector('[data-logo-form]');
  check(await page.locator('[data-logo-form] [data-action="logo-save"]').count() === 0 && await page.locator('[data-logo-input]').count() === 0, 'content view: the dialog has no save and no file choice');
  check(await page.locator('[data-field="name_ar"]').isDisabled(), 'content view: the fields are read only');
  await page.locator('[data-logo-form] [data-action="dialog-cancel"]').click();
  await ctx.close();
}

await browser.close();
await rest('partner_logos?name_en=like.QA*', { method: 'DELETE' });
await rest(`staff_permissions?user_id=eq.${mgmt.user_id}&section=eq.content`, { method: 'PATCH', body: JSON.stringify({ level: sections.find((x) => x.key === 'content')?.presets?.management ?? 'none' }) });
console.log(`\n${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
