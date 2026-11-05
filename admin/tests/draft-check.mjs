// Dashboard e2e of the reload defect and its fixes (Ahmed, 5 Nov 2026 — «the page reloaded on its own and my text was
// gone»), on a PREVIEW BRANCH with the QA users (refuses the production project), against the dashboard DEV server (the
// test reaches the app's own Supabase client through Vite's module URL to play the auth events):
//   1. a dirty dialog survives the tab going hidden → visible (supabase-js then announces SIGNED_IN for the same user):
//      the same DOM nodes, the same values, the dialog still open, no splash;
//   2. a simulated token refresh (TOKEN_REFRESHED) and a repeated SIGNED_IN leave the form intact;
//   3. a simulated new deploy (version.json answers another build) shows «يوجد تحديث جديد للوحة» with «احفظ تعديلاتك
//      أولًا» while something is unsaved, and does NOT reload; «تحديث الآن» reloads;
//   4. after a reload the dialog offers «استرجاع المسودة» and restores the values exactly (text, the placeholder editor's
//      answer); a page-level form (an article) the same;
//   5. «إلغاء» (discard) and a save clear the draft (sessionStorage), nothing offered afterwards; passwords / codes are
//      never kept.
//   node admin/tests/draft-check.mjs [BASE_URL=http://127.0.0.1:5173]
//   env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / BOOKING_TEST_TOKEN (the branch; LOGIN_CODE_VIA_SERVICE=1 without the secret)
import { chromium } from 'playwright';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
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
let checks = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome' });
async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e.message}`));
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
/** the tab goes to the background and comes back (the events Chrome sends; supabase-js recovers the session on them) */
const hideAndShow = (page) => page.evaluate(async () => {
  let state = 'hidden';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('blur'));
  await new Promise((r) => setTimeout(r, 400));
  state = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  await new Promise((r) => setTimeout(r, 1500));
});
/** the app's own Supabase client (the dev server's module): the auth events, played as supabase-js sends them */
const authEvent = (page, kind) => page.evaluate(async (kind) => {
  const { supabase } = await import('/src/lib/supabase.ts');
  if (kind === 'refresh') return void (await supabase.auth.refreshSession());
  const { data } = await supabase.auth.getSession();
  await supabase.auth._notifyAllSubscribers('SIGNED_IN', data.session);
}, kind);
const draftKeys = (page) => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('armada-draft:')));
const QA = 'سؤال تجريبي عن المسودة: هل تحفظ النصوص؟';
const QE = 'A draft test question: are the texts kept?';
const ANSWER = 'نعم، تبقى النصوص محفوظة في هذا التبويب حتى الحفظ أو الإلغاء.';

try {
  const { page } = await login('admin@qa.invalid');
  // ── the FAQ dialog: text fields + the placeholder editor ──
  await page.goto(`${BASE}/faq`);
  await page.waitForSelector('[data-action="faq-add"]');
  await page.click('[data-action="faq-add"]');
  await page.waitForSelector('#faq-q-ar');
  await page.waitForTimeout(600);
  await page.fill('#faq-q-ar', QA);
  await page.fill('#faq-q-en', QE);
  await page.click('#faq-a-ar');
  await page.keyboard.type(ANSWER);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__armadaMarker = 'same-page';
    document.querySelector('#faq-q-ar').__marker = 'same-node';
  });
  const snap = () => page.evaluate(() => ({
    marker: window.__armadaMarker ?? null,
    node: document.querySelector('#faq-q-ar')?.__marker ?? null,
    qa: document.querySelector('#faq-q-ar')?.value ?? null,
    qe: document.querySelector('#faq-q-en')?.value ?? null,
    a: document.querySelector('[data-ph-value="faq-a-ar"]')?.value ?? null,
    open: !!document.querySelector('dialog[open] #faq-q-ar'),
    splash: !document.querySelector('#app-main'),
  }));
  // 1. hidden → visible
  await hideAndShow(page);
  let s = await snap();
  check(s.marker === 'same-page' && s.node === 'same-node' && s.open && !s.splash, 'hidden → visible: the same page and the same field (no reload, no remount)', JSON.stringify(s));
  check(s.qa === QA && s.qe === QE && s.a === ANSWER, 'hidden → visible: every value kept (both questions, the answer)', JSON.stringify(s));
  // 2. auth events for the same user
  await authEvent(page, 'signed-in');
  await page.waitForTimeout(1200);
  s = await snap();
  check(s.node === 'same-node' && s.open && s.qa === QA && s.a === ANSWER && !s.splash, 'SIGNED_IN for the same user (what supabase-js sends on tab focus): the form untouched', JSON.stringify(s));
  await authEvent(page, 'refresh');
  await page.waitForTimeout(1500);
  s = await snap();
  check(s.node === 'same-node' && s.open && s.qa === QA && s.qe === QE && s.a === ANSWER && !s.splash, 'a token refresh (TOKEN_REFRESHED): the form untouched', JSON.stringify(s));
  // the draft is kept while dirty
  const keys = await draftKeys(page);
  check(keys.length === 1 && keys[0].includes('|modal:faq:new:'), 'the dirty dialog keeps one draft in this tab (per page + record)', keys.join());
  const stored = await page.evaluate((k) => sessionStorage.getItem(k), keys[0]);
  check(!!stored && stored.includes(QE) && stored.includes(ANSWER), 'the draft holds the typed values');
  // 3. a new deploy: the bar, no reload
  await page.route('**/version.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ build: 'a-newer-build' }) }));
  await hideAndShow(page);
  await page.waitForSelector('[data-update-bar]', { timeout: 10000 }).catch(() => {});
  const bar = await page.evaluate(() => ({ text: document.querySelector('[data-update-bar]')?.textContent ?? '', role: document.querySelector('[data-update-bar]')?.getAttribute('role') }));
  check(bar.text.includes('يوجد تحديث جديد للوحة') && bar.text.includes('تحديث الآن') && bar.role === 'status', 'a new deploy: «يوجد تحديث جديد للوحة» with «تحديث الآن» (non-blocking)', JSON.stringify(bar));
  check(bar.text.includes('احفظ تعديلاتك أولًا'), 'with unsaved changes the bar adds «احفظ تعديلاتك أولًا»');
  await page.waitForTimeout(3000);
  s = await snap();
  check(s.marker === 'same-page' && s.node === 'same-node' && s.qa === QA, 'a new deploy never reloads by itself', JSON.stringify(s));
  // 4. a forced reload with the dialog open (what a browser tab discard does to the page) → the draft is offered and
  //    restored exactly. (The bar's button sits behind an open dialog, which makes the page inert: it is pressed below.)
  await page.unroute('**/version.json*');
  page.once('dialog', (d) => d.accept()); // beforeunload while dirty
  await page.reload();
  await page.waitForSelector('[data-action="faq-add"]', { timeout: 30000 });
  check(await page.evaluate(() => window.__armadaMarker === undefined), 'the page was reloaded');
  await page.click('[data-action="faq-add"]');
  await page.waitForSelector('[data-draft-bar]', { timeout: 10000 }).catch(() => {});
  const offer = await page.evaluate(() => document.querySelector('[data-draft-bar]')?.textContent ?? '');
  check(offer.includes('استرجاع المسودة') && offer.includes('تجاهل'), 'after the reload the dialog offers «استرجاع المسودة» / «تجاهل»', offer);
  await page.click('[data-action="draft-restore"]');
  await page.waitForTimeout(800);
  s = await snap();
  check(s.qa === QA && s.qe === QE && s.a === ANSWER, 'the draft is restored exactly (both questions and the answer)', JSON.stringify(s));
  const shown = await page.evaluate(() => document.querySelector('#faq-a-ar')?.textContent ?? '');
  check(shown.includes('تبقى النصوص محفوظة'), 'the restored answer shows in its editor', shown.slice(0, 80));
  check(await page.locator('[data-draft-bar]').count() === 0, 'the offer goes away once answered');
  // 5a. cancel (discard) clears it
  await page.click('dialog[open] [data-action="dialog-cancel"]');
  await page.waitForSelector('text=تجاهل التعديلات والإغلاق');
  await page.click('text=تجاهل التعديلات والإغلاق');
  await page.waitForTimeout(500);
  check((await draftKeys(page)).length === 0, '«إلغاء» → discard clears the draft');
  await page.reload();
  await page.waitForSelector('[data-action="faq-add"]');
  await page.click('[data-action="faq-add"]');
  await page.waitForTimeout(1200);
  check(await page.locator('[data-draft-bar]').count() === 0, '… and nothing is offered after the next reload');
  await page.click('dialog[open] [data-action="dialog-cancel"]');
  // «تجاهل» on an offer drops the draft too
  await page.click('[data-action="faq-add"]');
  await page.waitForSelector('#faq-q-ar');
  await page.waitForTimeout(600);
  await page.fill('#faq-q-ar', QA);
  await page.waitForTimeout(500);
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.waitForSelector('[data-action="faq-add"]');
  await page.click('[data-action="faq-add"]');
  await page.waitForSelector('[data-draft-bar]', { timeout: 10000 });
  await page.click('[data-action="draft-drop"]');
  await page.waitForTimeout(300);
  check((await draftKeys(page)).length === 0 && (await page.inputValue('#faq-q-ar')) === '', '«تجاهل» drops the draft and leaves the form as it was');
  await page.click('dialog[open] [data-action="dialog-cancel"]');

  // ── a page-level form: an article (save clears the draft) ──
  const art = (await rest('articles?slug=eq.where-to-stay-in-taif&select=id,excerpt_ar'))[0];
  await page.goto(`${BASE}/blog/${art.id}`);
  await page.waitForSelector('#b-excerpt-ar');
  await page.waitForTimeout(800);
  const newExcerpt = `${(art.excerpt_ar ?? "").trim() || "مقتطف"} — مسودة`;
  await page.fill('#b-excerpt-ar', newExcerpt);
  await page.waitForTimeout(500);
  await hideAndShow(page);
  await authEvent(page, 'refresh');
  await page.waitForTimeout(1000);
  check((await page.inputValue('#b-excerpt-ar')) === newExcerpt, 'article: the text survives the tab switch and a token refresh');
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.waitForSelector('[data-draft-bar]', { timeout: 15000 }).catch(() => {});
  check(await page.locator('[data-draft-bar]').count() === 1, 'article: after a reload the page offers its draft');
  await page.click('[data-action="draft-restore"]');
  await page.waitForTimeout(600);
  check((await page.inputValue('#b-excerpt-ar')) === newExcerpt, 'article: restored exactly');
  await page.click('[data-action="blog-save"]');
  await page.waitForTimeout(2500);
  check((await draftKeys(page)).length === 0, 'article: the save clears the draft');
  await page.reload();
  await page.waitForSelector('#b-excerpt-ar');
  await page.waitForTimeout(1500);
  const afterSave = { bars: await page.locator('[data-draft-bar]').count(), excerpt: await page.inputValue('#b-excerpt-ar'), stored: (await rest(`articles?id=eq.${art.id}&select=excerpt_ar`))[0].excerpt_ar, keys: await draftKeys(page) };
  check(afterSave.bars === 0 && afterSave.excerpt === newExcerpt, 'article: saved, nothing offered after a reload', JSON.stringify(afterSave));
  // put the excerpt back
  await rest(`articles?id=eq.${art.id}`, { method: 'PATCH', body: JSON.stringify({ excerpt_ar: art.excerpt_ar }) });

  // ── «تحديث الآن»: the reload happens only when pressed ──
  await page.route('**/version.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ build: 'a-newer-build' }) }));
  await page.evaluate(() => (window.__armadaMarker = 'before-update'));
  await hideAndShow(page);
  await page.waitForSelector('[data-update-bar]', { timeout: 10000 });
  check(!(await page.locator('[data-update-dirty]').count()), 'nothing unsaved: the bar has no «احفظ تعديلاتك أولًا»');
  await page.unroute('**/version.json*');
  await Promise.all([page.waitForNavigation({ timeout: 20000 }).catch(() => {}), page.click('[data-action="update-now"]')]);
  await page.waitForSelector('#app-main', { timeout: 30000 });
  check(await page.evaluate(() => window.__armadaMarker === undefined), '«تحديث الآن» reloads the page when pressed');

  // ── never kept: passwords and codes ──
  const leaks = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('armada-draft:')).map((k) => sessionStorage.getItem(k)).filter((v) => /Qa-Armada-2026/.test(v ?? '')));
  check(leaks.length === 0, 'no draft holds a password or a code');
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split(/\r?\n/).slice(0, 4).join(' ')}`);
} finally {
  await browser.close();
}
console.log(`\n${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
