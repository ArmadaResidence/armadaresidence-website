// «العروض» → «باقات بسعر خاص» and «يظهر في المناسبات» in the dashboard (18 Nov 2026, DECISIONS.md 2026-11-18
// «Celebrations…»). OFFLINE — no Supabase project is reached: a Vite dev server on a stub Supabase origin and a fake
// session (as rooms-page-check.mjs). The database decides every rule (supabase/tests/offer-packages.sql); this checks
// what the page does with them:
//   an editor (offers: publish) — the list names a packages offer «باقات بسعر خاص»; «إضافة عرض» → «باقات بسعر خاص»
//   hides the code, the room types, the minimum nights and the description, shows the short text, the packages, the
//   common note, the WhatsApp message, the live preview, the button «راسلنا على واتساب» / «بلا زر» and «الصورة اختيارية»;
//   «إضافة باقة» up to four; a «بدلًا من» not above the price is refused before sending; Arabic-Indic digits are sent
//   Western; the payload carries kind packages, cta whatsapp, the packages trimmed, no code, no room types,
//   «يظهر في المناسبات»; × with changes asks before closing; an existing packages offer opens with its packages and a
//   removed one leaves the payload; «نشر» calls offers_publish and asks for the site build; «يظهر في المناسبات» on a
//   company offer; the tour's tokens; a single-branch user sees the branch as text.
// 1280 and 375 × light and dark.
//   node admin/tests/offers-packages-ui-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'offers', 'media'];
const meOf = (role, branch = null) => ({
  role, branch, full_name: role, active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: false, backup_codes_left: null,
  permissions: { overview: 'view', offers: 'publish', media: 'view' },
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const pk = (n, price, was) => ({ name_ar: `الباقة ${n}`, name_en: `Package ${n}`, price, was_price: was, items_ar: ['تزيين السرير', 'عصير لشخصين'], items_en: ['Bed decoration', 'Juice for two'], choice_ar: '', choice_en: '' });
const base = {
  category: 'individuals', branches: ['airport-road', 'shafa-road'], venue: null, title_ar: 'باقات العرسان والمناسبات', title_en: 'Wedding & Celebration Packages',
  description_ar: '', description_en: '', terms_ar: '', terms_en: '', valid_from: '2026-11-18', valid_to: '2026-12-31', kind: 'packages', percent: null, fixed_price: null,
  stay_nights: null, stay_pay_mode: 'per_booking', promo_code: null, room_types: [], min_nights: 1, dining_price: null, cta: 'whatsapp', quote_request: null, whatsapp: false,
  whatsapp_prefill_ar: 'أرغب في الاستفسار عن باقات العرسان والمناسبات.', whatsapp_prefill_en: "I'd like to ask about the Wedding & Celebration Packages.",
  show_site: true, show_home: true, show_offers: true, show_branch: true, show_partners: false, show_menu: false, show_bar: false, show_celebrations: true,
  short_ar: 'تزيين الغرف لمناسبة تبقى في الذاكرة.', short_en: 'Room decoration for an occasion to remember.', note_ar: 'الأسعار شاملة الضريبة.', note_en: 'Prices include VAT.',
  packages: [pk(1, 299, 450), pk(2, 450, 600)], audience: 'all', sort: 0, live: null, published_at: null, archived_at: null, is_test: false, pending: false, state: 'draft',
  check: { missing: [], warnings: [] },
};
const ROWS = [
  { ...base, id: 'd0000000-0000-4000-8000-000000000001', slug: 'celebration-packages' },
  { ...base, id: 'd0000000-0000-4000-8000-000000000002', slug: 'qa-percent', kind: 'percent', percent: 15, cta: 'book', packages: [], short_ar: '', short_en: '', note_ar: '', note_en: '',
    show_celebrations: false, description_ar: 'وصف', description_en: 'Text', title_ar: 'عرض الخريف', title_en: 'Autumn', check: { missing: [{ code: 'cover' }], warnings: [] }, sort: 1 },
  { ...base, id: 'd0000000-0000-4000-8000-000000000003', slug: 'umrah-groups', category: 'b2b', kind: 'none', cta: 'quote', packages: [], short_ar: '', short_en: '', note_ar: '', note_en: '',
    show_celebrations: false, description_ar: 'وصف', description_en: 'Text', title_ar: 'أسعار خاصة', title_en: 'Group rates', whatsapp: true, state: 'published', sort: 0 },
];
const now = new Date().toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: now };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};

async function context(browser, w, h, theme, me) {
  const calls = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: theme });
  await ctx.route(`${STUB}/**`, async (r) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    const path = new URL(r.request().url()).pathname;
    const fn = path.split('/').pop();
    let body = {};
    try {
      body = JSON.parse(r.request().postData() || '{}');
    } catch { /* */ }
    if (fn === 'my_staff') return ok(me);
    if (/\/auth\/v1\/user/.test(path)) return ok(USER);
    if (/\/rest\/v1\/offers_library$/.test(path)) return ok(ROWS);
    if (/\/rest\/v1\/branches$/.test(path)) return ok([{ slug: 'airport-road', name_ar: 'طريق المطار', name_en: 'Airport Road', sort: 1 }, { slug: 'shafa-road', name_ar: 'طريق الشفا', name_en: 'Shafa Road', sort: 2 }]);
    if (fn === 'site-rebuild') {
      calls.push({ fn, body });
      return ok({ ok: true, dispatched: true });
    }
    if (['offers_save', 'offers_publish', 'offer_set_audience'].includes(fn)) {
      calls.push({ fn, body });
      if (fn === 'offers_publish') return ok({ ok: true, job_id: 'e0000000-0000-4000-8000-000000000001', published: [], blocked: [] });
      return ok({ ok: true, batch_id: 'c0000000-0000-4000-8000-000000000001', id: 'd0000000-0000-4000-8000-000000000009' });
    }
    if (/\/rest\/v1\/rpc\//.test(path)) return ok(null);
    return ok([]);
  });
  await ctx.addInitScript(([k, v, t]) => {
    try {
      localStorage.setItem(k, v);
      localStorage.setItem('armada-tour-test', '0');
      localStorage.setItem('armada-admin-theme', t);
    } catch { /* */ }
  }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION), theme]);
  return { ctx, calls };
}
const dialog = (page) => page.locator('dialog[open]').filter({ has: page.locator('[data-offer-form]') });
const seg = (form, label) => form.locator('[role="radio"]', { hasText: label });

const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [w, h] of [[1280, 900], [375, 812]]) {
    for (const theme of ['light', 'dark']) {
      const tag = `editor @${w} ${theme}`;
      const { ctx, calls } = await context(browser, w, h, theme, meOf('admin'));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => failures.push(`${tag}: page error ${e.message}`));
      await page.goto(`${BASE}/offers`, { waitUntil: 'load' });
      await page.locator('[data-action="offer-add"]').waitFor({ timeout: 30000 });
      const text = (await page.locator('main').textContent()) ?? '';
      check(text.includes('باقات بسعر خاص'), `${tag}: the list names the packages offer «باقات بسعر خاص»`);
      check(!/[٠-٩]/.test(text), `${tag}: Arabic-Indic digits on the page`);
      check((await page.locator('[data-tour~="offer-add"]').count()) === 1, `${tag}: the tour token offer-add`);

      // a new packages offer
      await page.locator('[data-action="offer-add"]').click();
      const form = dialog(page);
      await form.waitFor({ timeout: 10000 });
      check((await form.locator('[data-tour~="offer-type"]').count()) === 1 && (await form.locator('[data-tour~="offer-celebrations"]').count()) === 1, `${tag}: the tour tokens offer-type / offer-celebrations`);
      await seg(form, 'باقات بسعر خاص').click();
      check((await form.locator('#o-code').count()) === 0 && (await form.locator('[data-rooms]').count()) === 0 && (await form.locator('#o-min').count()) === 0, `${tag}: no code, room types or minimum nights for packages`);
      check((await form.locator('#o-desc-ar').count()) === 0 && (await form.locator('#o-short-ar').count()) === 1, `${tag}: the short text replaces the description`);
      check((await form.locator('[data-packages-editor]').count()) === 1 && (await form.locator('[data-packages-preview]').count()) === 1, `${tag}: the packages editor and its live preview`);
      const ctas = await form.locator('[role="radiogroup"][aria-label="زر الإجراء"] [role="radio"]').allTextContents();
      check(JSON.stringify(ctas) === JSON.stringify(['راسلنا على واتساب', 'بلا زر']), `${tag}: the button «راسلنا على واتساب» / «بلا زر» — ${ctas.join(' | ')}`);
      check((await form.locator('[role="radiogroup"][aria-label="زر الإجراء"] [aria-checked="true"]').textContent()) === 'راسلنا على واتساب', `${tag}: «راسلنا على واتساب» chosen with the type`);
      check((await form.locator('[data-cover-optional]').count()) === 1, `${tag}: the photo is optional for packages`);
      await form.locator('#o-title-ar').fill('باقات العرسان والمناسبات');
      await form.locator('#o-title-en').fill('Wedding & Celebration Packages');
      await form.locator('#o-short-ar').fill('تزيين الغرف لمناسبة تبقى في الذاكرة.');
      await form.locator('#o-short-en').fill('Room decoration for an occasion to remember.');
      for (let i = 0; i < 4; i++) await form.locator('[data-action="package-add"]').click();
      check((await form.locator('[data-package-row]').count()) === 4 && (await form.locator('[data-action="package-add"]').count()) === 0, `${tag}: four packages at most`);
      await form.locator('[data-action="package-remove"]').nth(3).click();
      await form.locator('[data-action="package-remove"]').nth(2).click();
      await form.locator('[data-action="package-remove"]').nth(1).click();
      await form.locator('#o-pk0-name-ar').fill('الباقة الفضية');
      await form.locator('#o-pk0-name-en').fill('Silver Package');
      await form.locator('#o-pk0-price').fill('٢٩٩');
      await form.locator('#o-pk0-was').fill('299');
      await form.locator('#o-pk0-items-ar').fill('تزيين السرير بالورود الطبيعية\n\n  عصير لشخصين  ');
      await form.locator('#o-pk0-items-en').fill('Bed decorated with fresh roses\nJuice for two');
      await form.locator('[data-placement="show_celebrations"]').click();
      await form.locator('[data-action="offer-save"]').click();
      await page.waitForTimeout(300);
      check(((await form.locator('[data-form-error]').textContent().catch(() => '')) ?? '').includes('بدلًا من'), `${tag}: «بدلًا من» not above the price is refused`);
      check(!calls.some((c) => c.fn === 'offers_save'), `${tag}: a refused form was sent`);
      await form.locator('#o-pk0-was').fill('450');
      const preview = (await form.locator('[data-packages-preview]').textContent()) ?? '';
      check(preview.includes('الباقة الفضية') && /299/.test(preview) && /450/.test(preview) && preview.includes('عصير لشخصين'), `${tag}: the preview follows the form — ${preview.slice(0, 80)}`);
      await form.locator('[data-action="offer-save"]').click();
      await page.waitForTimeout(600);
      const save = calls.find((c) => c.fn === 'offers_save');
      const p = save?.body?.p ?? {};
      check(!!save && p.kind === 'packages' && p.cta === 'whatsapp' && p.promo_code === null && JSON.stringify(p.room_types) === '[]' && p.min_nights === 1, `${tag}: the payload is a packages offer with no booking effect — ${JSON.stringify({ kind: p.kind, cta: p.cta, code: p.promo_code, rooms: p.room_types })}`);
      const p0 = p.packages?.[0] ?? {};
      check(p.packages?.length === 1 && p0.price === 299 && p0.was_price === 450 && JSON.stringify(p0.items_ar) === JSON.stringify(['تزيين السرير بالورود الطبيعية', 'عصير لشخصين']), `${tag}: the package as sent (Western digits, trimmed items) — ${JSON.stringify(p0)}`);
      check(p.show_celebrations === true && p.short_en === 'Room decoration for an occasion to remember.' && p.description_ar === '', `${tag}: «يظهر في المناسبات» and the short text sent`);
      check((await dialog(page).count()) === 0, `${tag}: the dialog closes after a save`);

      // an existing packages offer: its packages, a removed one, the dirty guard
      await page.locator('[data-offer="celebration-packages"] [data-action="offer-edit"]').click();
      const edit = dialog(page);
      await edit.waitFor({ timeout: 10000 });
      check((await edit.locator('[data-package-row]').count()) === 2 && (await edit.locator('#o-pk1-price').inputValue()) === '450', `${tag}: an existing offer opens with its packages`);
      await page.waitForTimeout(800); // the dirty guard's baseline settles 400 ms after the last DOM change
      await edit.locator('[data-action="package-remove"]').nth(1).click();
      await edit.locator('[data-action="dialog-close"]').first().click();
      await page.waitForTimeout(300);
      check((await page.getByRole('button', { name: 'متابعة التعديل' }).count()) === 1, `${tag}: closing with changes asks first`);
      await page.getByRole('button', { name: 'متابعة التعديل' }).click();
      const n = calls.filter((c) => c.fn === 'offers_save').length;
      await edit.locator('[data-action="offer-save"]').click();
      await page.waitForTimeout(600);
      const s2 = calls.filter((c) => c.fn === 'offers_save')[n];
      check(!!s2 && s2.body.p_id === ROWS[0].id && s2.body.p.packages.length === 1 && s2.body.p.kind === 'packages', `${tag}: the edit saves the remaining package — ${JSON.stringify(s2?.body?.p?.packages?.length)}`);

      // «نشر» of the packages draft (no photo needed) → offers_publish + the site build
      const pub = page.locator('[data-action="offer-publish"]').first();
      if (await pub.count()) {
        await pub.click();
        await page.waitForTimeout(600);
        check(calls.some((c) => c.fn === 'offers_publish') && calls.some((c) => c.fn === 'site-rebuild' && c.body?.reason === 'offers'), `${tag}: «نشر» calls offers_publish and asks for the site build`);
      } else check(false, `${tag}: no «نشر» button on the packages draft`);

      // «يظهر في المناسبات» on a company offer
      await page.getByRole('tab', { name: 'الشركات والشركاء' }).click();
      await page.locator('[data-action="offer-add"]').click();
      const b2b = dialog(page);
      await b2b.waitFor({ timeout: 10000 });
      check((await b2b.locator('[data-placement="show_celebrations"]').count()) === 1, `${tag}: «يظهر في المناسبات» on a company offer`);
      check((await b2b.locator('[data-packages-editor]').count()) === 0, `${tag}: no packages editor for a company offer`);
      await page.keyboard.press('Escape');
      await ctx.close();
    }
  }
  // a single-branch user: the branch is text
  {
    const { ctx } = await context(browser, 1280, 900, 'light', meOf('reception', 'airport-road'));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/offers`, { waitUntil: 'load' });
    await page.locator('[data-action="offer-add"]').waitFor({ timeout: 30000 });
    await page.locator('[data-action="offer-add"]').click();
    const form = dialog(page);
    await form.waitFor({ timeout: 10000 });
    check((await form.locator('[data-branch-static="airport-road"]').count()) === 1 && (await form.locator('[data-branch-chip]').count()) === 0, 'single branch: the branch as text, no chips');
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`offers-packages-ui-check: ${checks - failures.length}/${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
