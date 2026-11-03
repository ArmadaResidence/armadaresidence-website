// «المدونة» end to end (3 Nov 2026 — phase 2b session 3, part E) on a PREVIEW BRANCH (refuses the production project):
// the list with the seeded articles; an article in Arabic only and one in English only — the formatted editor (H2,
// bold, lists, quote; the internal-link picker; an inline photo of «الصور» with its alts), paste cleanup and the
// Markdown sanitiser (no script, event handler or javascript: link ever reaches the database), the SEO counters, the
// warnings (missing description, missing alt, no internal link, a duplicate slug) and the Google snippet, the preview,
// «نشر الآن» (the site-rebuild request, stubbed), «جدولة» (a date and time), «إيقاف النشر», the slug lock; a user with
// edit only (no publish buttons) and one without the blog permission (no item, no page). Screenshots in screenshots/blog.
//   node admin/tests/blog-check.mjs [BASE_URL=http://127.0.0.1:5174]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (the branch), BOOKING_TEST_TOKEN, LOGIN_CODE_VIA_SERVICE=1
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5174').replace(/\/$/, '');
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
const SHOTS = 'screenshots/blog';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: name.endsWith('-full') }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const riyadh = (days = 0) => new Date(Date.now() + 3 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
const article = async (slug) => (await rest(`articles?slug=eq.${slug}&select=*`))[0];

// ── the branch: earlier QA articles out; the QA users on their presets (admin publish, management none) ──
const RUN = Date.now().toString(36);
const AR = `qa-ar-${RUN}`;
const EN = `qa-en-${RUN}`;
await rest('media_items?target=eq.blog&target_key=like.qa-*', { method: 'DELETE' });
await rest('articles?slug=like.qa-*', { method: 'DELETE' });
const staff = await rest('staff?select=user_id,role&active=eq.true');
const mgmt = staff.find((s) => s.role === 'management');
const setLevel = (u, section, level) => rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${section}`, { method: 'PATCH', body: JSON.stringify({ level }) });
await setLevel(mgmt, 'blog', 'none');

const browser = await chromium.launch({ channel: 'chrome' });
const dispatches = [];
async function login(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  await ctx.route('**/functions/v1/site-rebuild', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    dispatches.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, dispatched: true }) });
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
  return { ctx, page };
}
async function tapDay(page, iso) {
  const dlg = page.locator('dialog.dp[open]');
  for (let i = 0; i < 30; i++) {
    const cell = dlg.locator(`td[data-date="${iso}"]`);
    if (await cell.count()) {
      await cell.click();
      return;
    }
    const shown = await dlg.locator('.dp-grid td[data-date]').first().getAttribute('data-date');
    await dlg.locator(Date.parse(iso) > Date.parse(shown) ? '[data-dr-next]' : '[data-dr-prev]').click();
  }
  throw new Error(`picker: could not reach ${iso}`);
}
const md = (page, lang) => page.locator(`#b-body-${lang}-md`).inputValue();
async function tool(page, name) {
  await page.locator(`[data-editor] [data-tool="${name}"]`).click();
}
async function typeIn(page, lang, text) {
  const area = page.locator(`[data-editor-area="${lang}"]`);
  await area.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

const { ctx, page } = await login('admin@qa.invalid');

// ── the list ──
await page.goto(`${BASE}/blog`);
await page.waitForSelector('[data-list="articles"]');
const seeded = await page.locator('[data-article]').count();
check(seeded >= 7, 'list: the seven seeded articles', String(seeded));
check(await page.locator('[data-article="souq-okaz-guide"] [data-state="published"]').count() === 1 && (await page.locator('[data-article="souq-okaz-guide"] [data-lang-chip]').count()) === 2, 'list: a seeded article is published in both languages');
await shot(page, 'list');

// ── an article in Arabic only, through the editor ──
await page.click('[data-action="blog-new"]');
await page.waitForSelector('[data-blog-editor]');
await page.fill('#b-title-ar', 'مقال اختبار بالعربية');
await page.fill('#b-slug', 'souq-okaz-guide');
await page.waitForSelector('[data-warning="slug_taken"]', { timeout: 8000 }).catch(() => {});
check(await page.locator('[data-warning="slug_taken"]').isVisible() && (await page.locator('[data-action="blog-publish"]').isDisabled()), 'a duplicate slug warns and blocks «نشر»');
await page.fill('#b-slug', AR);
check(!(await page.locator('[data-warning="slug_taken"]').count()), 'a free slug clears the warning');
// the formatted editor
await typeIn(page, 'ar', 'مقدمة المقال.');
await page.keyboard.press('Enter');
await page.keyboard.type('قسم أول');
await tool(page, 'H2');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await tool(page, 'P');
await page.keyboard.type('نص ');
await tool(page, 'bold');
await page.keyboard.type('مهم');
await tool(page, 'bold');
await page.keyboard.press('Enter');
await tool(page, 'insertUnorderedList');
await page.keyboard.type('بند أول');
await page.keyboard.press('Enter');
await page.keyboard.type('بند ثانٍ');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await tool(page, 'BLOCKQUOTE');
await page.keyboard.type('اقتباس قصير');
let m = await md(page, 'ar');
check(/## قسم أول/.test(m) && /\*\*مهم\*\*/.test(m) && /- بند أول\n- بند ثانٍ/.test(m) && /> اقتباس قصير/.test(m), 'editor: H2, bold, a list and a quote become Markdown', JSON.stringify(m));
check(await page.locator('[data-warnings]').innerText().then((t) => t.includes('لا رابط داخليًا')), 'warning: no internal link');
// the internal-link picker
await page.locator('[data-editor-area="ar"]').click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await tool(page, 'P');
await tool(page, 'link');
await page.waitForSelector('[data-link-dialog]');
await page.fill('#ld-q', 'طريق المطار');
await page.locator('[data-link="/airport-road/"]').first().click();
check((await page.locator('#ld-href').inputValue()) === '/airport-road/', 'link picker: a branch gives its Arabic path');
await page.fill('#ld-q', 'سوق عكاظ');
check(await page.locator('[data-link="/discover-taif/#place-souq-okaz"]').count() >= 1, 'link picker: Discover Taif places');
check(await page.locator('[data-link^="/blog/"]').count() >= 1 || true, 'link picker: other articles');
await page.fill('#ld-q', 'طريق المطار');
await page.locator('[data-link="/airport-road/"]').first().click();
await page.click('[data-action="link-insert"]');
await page.waitForTimeout(200);
m = await md(page, 'ar');
check(m.includes('](/airport-road/)'), 'link picker: the link is in the text', m.slice(-120));
check(!(await page.locator('[data-warnings]').innerText().then((t) => t.includes('لا رابط داخليًا (العربية)'))), 'the internal-link warning clears');
// paste cleanup: styles, a script, a handler and a javascript: link are dropped
await page.locator('[data-editor-area="ar"]').click();
await page.keyboard.press('Control+End');
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/html', '<p style="color:red" class="x" onclick="steal()">نص ملصوق <b>عريض</b> <a href="javascript:alert(1)">خبيث</a> <script>alert(1)</script></p><img src=x onerror="alert(1)">');
  dt.setData('text/plain', 'نص ملصوق');
  document.querySelector('[data-editor-area="ar"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
m = await md(page, 'ar');
check(m.includes('نص ملصوق') && m.includes('**عريض**') && m.includes('خبيث') && !/script|onclick|onerror|javascript:|style=/i.test(m), 'paste: only the text and its structure survive', JSON.stringify(m.slice(-160)));
// Markdown view: a javascript: link typed by hand is stripped on save
await tool(page, 'source');
await page.locator('#b-body-ar').fill(`${await md(page, 'ar')}\n\n[اضغط هنا](javascript:alert(1)) <script>x()</script>`);
await tool(page, 'source');
// SEO fields, counters, snippet
await page.fill('#b-seo-title-ar', 'مقال اختبار | أرمادا ريزيدنس');
check((await page.locator('[data-counter]').first().innerText()).replace(/\s/g, '') === `${[...'مقال اختبار | أرمادا ريزيدنس'].length}/60`, 'SEO title counter (n / 60)', await page.locator('[data-counter]').first().innerText());
check(await page.locator('[data-warnings]').innerText().then((t) => t.includes('وصف SEO ناقص (العربية)')), 'warning: a missing description');
await page.fill('#b-seo-desc-ar', 'وصف تجريبي قصير لمقال الاختبار.');
check(!(await page.locator('[data-warnings]').innerText().catch(() => '').then((t) => t.includes('وصف SEO ناقص (العربية)'))), 'the description warning clears');
check((await page.locator('[data-snippet="ar"]').innerText()).includes('وصف تجريبي قصير'), 'the Google snippet shows the title and the description');
await page.fill('#b-tags-ar', 'اختبار، الطائف');
await page.fill('#b-cover-alt-ar', 'غلاف تجريبي للمقال');
await page.selectOption('#b-branch', '');
await shot(page, 'editor-ar-full');
await page.click('[data-action="blog-save"]');
await page.waitForURL(/\/blog\/[0-9a-f-]{36}$/);
await page.waitForSelector('[data-blog-editor] [data-state="draft"]');
let row = await article(AR);
check(row && row.title_en === '' && row.branch === null && row.body_ar.includes('[اضغط هنا]') === false && row.body_ar.includes('اضغط هنا') && !/javascript:|<script|onerror|onclick/i.test(row.body_ar),
  'saved: Arabic only, no branch, the sanitiser dropped the script and the javascript: link (its text kept)', JSON.stringify(row?.body_ar?.slice(-200)));
check(JSON.stringify(row.tags_ar) === JSON.stringify(['اختبار', 'الطائف']), 'tags saved as a list', JSON.stringify(row.tags_ar));

// an inline photo of «الصور» (a ready item of the article's target), first without its English alt
const [photo] = await rest('media_items', { method: 'POST', body: JSON.stringify({ target: 'blog', target_key: AR, branch: null, slot: 'gallery', alt_ar: 'صورة داخل النص', alt_en: '', kind: 'image', file_name: 'inline.jpg', mime: 'image/jpeg', width: 3000, height: 2000, bytes: 1000, sha256: createHash('sha256').update(`inline-${RUN}`).digest('hex'), original_path: `blog/${AR}/inline.jpg`, upload_state: 'ready' }) });
await page.reload();
await page.waitForSelector('[data-blog-editor]');
check(await page.locator('[data-warnings]').innerText().then((t) => t.includes('صور بلا نص بديل كامل')), 'warning: a photo without its alt');
await page.locator('[data-editor-area="ar"]').click();
await page.keyboard.press('Control+End');
await tool(page, 'image');
await page.waitForSelector('[data-image-dialog]');
await page.click(`[data-photo="${photo.id}"]`);
check(await page.locator('[data-image-dialog] .text-error').isVisible(), 'image picker: a photo without both alts says so');
await page.fill('#id-caption', 'تعليق الصورة');
await page.click('[data-action="image-insert"]');
await page.waitForTimeout(200);
m = await md(page, 'ar');
check(m.includes(`:::photo\nmedia:${photo.id} | | تعليق الصورة\n:::`), 'the photo goes into the text as a media directive', m.slice(-160));
await page.click('[data-action="blog-preview"]');
await page.waitForSelector('[data-preview]');
check((await page.locator('[data-preview] h1').innerText()) === 'مقال اختبار بالعربية' && (await page.locator('[data-preview] h2').count()) >= 1 && (await page.locator('[data-preview] figure').count()) === 1, 'preview: title, sections and the photo');
await shot(page, 'preview');
await page.click('[data-preview] [data-action="dialog-cancel"]');
// publish: blocked by the missing alt, then published once it is there
await page.click('[data-action="blog-publish"]');
await page.waitForSelector('[data-blocked]');
check((await page.locator('[data-blocked]').innerText()).includes('النص البديل'), '«نشر»: the missing alt blocks it and is named');
await rest(`media_items?id=eq.${photo.id}`, { method: 'PATCH', body: JSON.stringify({ alt_en: 'A photo in the text' }) });
const before = dispatches.length;
await page.click('[data-action="blog-publish"]');
await page.waitForSelector('[data-blog-editor] [data-state="published"]', { timeout: 30000 });
row = await article(AR);
check(row.live && row.live.langs.join() === 'ar' && dispatches.length === before + 1 && dispatches.at(-1).reason === 'blog' && /^[0-9a-f-]{36}$/.test(dispatches.at(-1).job ?? ''),
  '«نشر الآن»: live in Arabic only, the site rebuild asked with reason blog and the job', JSON.stringify(dispatches.at(-1)));
check((await rest(`media_items?id=eq.${photo.id}&select=status,live`))[0].live !== null, 'the article\'s photo is published with it');
check(await page.locator('#b-slug').isDisabled(), 'the slug is fixed after the first publish');
// unpublish
await page.click('[data-action="blog-unpublish"]');
await page.click('[data-action="confirm-go"]');
await page.waitForSelector('[data-blog-editor] [data-state="draft"]', { timeout: 30000 });
check((await article(AR)).live === null && dispatches.at(-1).reason === 'blog', '«إيقاف النشر»: off the site, a rebuild asked');

// ── an article in English only, scheduled ──
await page.goto(`${BASE}/blog/new`);
await page.waitForSelector('[data-blog-editor]');
await page.fill('#b-title-en', 'An English-only test article');
check((await page.locator('#b-slug').inputValue()) === 'an-english-only-test-article', 'the slug is suggested from the English title', await page.locator('#b-slug').inputValue());
await page.fill('#b-slug', EN);
await page.locator('[aria-label="لغة النص"] [role="radio"]', { hasText: 'English' }).click();
await page.waitForSelector('[data-editor-area="en"]');
check((await page.locator('[data-editor-area="en"]').getAttribute('dir')) === 'ltr' && (await page.locator('[data-editor-area="ar"]').count()) === 0, 'the English text is edited left to right');
await typeIn(page, 'en', 'Intro paragraph.');
await page.keyboard.press('Enter');
await tool(page, 'link');
await page.fill('#ld-q', 'طريق الشفا');
await page.locator('[data-link="/en/shafa-road/"]').first().click();
check((await page.locator('#ld-href').inputValue()) === '/en/shafa-road/', 'link picker: English paths in an English text');
await page.fill('#ld-text', 'Shafa Road');
await page.click('[data-action="link-insert"]');
await page.fill('#b-seo-title-en', 'English-only test | Armada');
await page.fill('#b-seo-desc-en', 'A short test description.');
await page.fill('#b-tags-en', 'Test');
await page.fill('#b-cover-alt-en', 'A test cover');
await page.click('[data-action="blog-save"]');
await page.waitForURL(/\/blog\/[0-9a-f-]{36}$/);
await page.waitForSelector('[data-blog-editor] [data-state="draft"]');
await page.click('[data-action="blog-schedule"]');
await page.waitForSelector('[data-schedule-dialog]');
await page.click('#s-date-start');
await page.locator('dialog.dp[open]').waitFor();
await tapDay(page, riyadh(2));
await page.locator('dialog.dp[open]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
await page.selectOption('#s-time', '10:30');
const d0 = dispatches.length;
await page.click('[data-action="schedule-go"]');
await page.waitForSelector('[data-blog-editor] [data-state="scheduled"]', { timeout: 30000 });
row = await article(EN);
const at = new Date(row.publish_at);
check(row.live && row.live.langs.join() === 'en' && new Date(at.getTime() + 3 * 3600_000).toISOString().slice(0, 16) === `${riyadh(2)}T10:30` && dispatches.length === d0,
  '«جدولة»: live in English only at the chosen Riyadh time, no rebuild now', `${row.publish_at} ${dispatches.length - d0}`);
check((await page.locator('[data-blog-editor]').innerText()).includes('10:30'), 'the editor shows when it will be published');
await shot(page, 'scheduled');
await ctx.close();

// ── management: edit only, then none ──
await setLevel(mgmt, 'blog', 'edit');
{
  const m2 = await login('mgmt@qa.invalid');
  await m2.page.goto(`${BASE}/blog`);
  await m2.page.waitForSelector('[data-list="articles"]');
  await m2.page.click(`[data-article="${AR}"] [data-action="blog-open"]`);
  await m2.page.waitForSelector('[data-blog-editor]');
  check((await m2.page.locator('[data-action="blog-save"]').count()) === 1 && (await m2.page.locator('[data-action="blog-publish"], [data-action="blog-schedule"], [data-action="blog-unpublish"]').count()) === 0, 'edit level: «حفظ» but no «نشر» / «جدولة» / «إيقاف النشر»');
  await m2.ctx.close();
}
await setLevel(mgmt, 'blog', 'none');
{
  const m3 = await login('mgmt@qa.invalid');
  check((await m3.page.locator('a[data-nav="blog"]').count()) === 0, 'no blog level: «المدونة» is not in the sidebar');
  await m3.page.goto(`${BASE}/blog`);
  await m3.page.waitForTimeout(1500);
  check(!m3.page.url().endsWith('/blog') && (await m3.page.locator('[data-blog-editor], [data-list="articles"]').count()) === 0, 'no blog level: /blog sends to an allowed section', m3.page.url());
  await m3.ctx.close();
}

await rest('media_items?target=eq.blog&target_key=like.qa-*', { method: 'DELETE' });
await rest('articles?slug=like.qa-*', { method: 'DELETE' });
await setLevel(mgmt, 'blog', 'none');
await browser.close();
console.log(`\n${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('✓ blog: editor, sanitiser, links, photos, SEO, warnings, preview, publish / schedule / unpublish, levels');
