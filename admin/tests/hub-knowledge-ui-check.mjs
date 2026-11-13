// «قاعدة المعرفة» and «أسعار الخدمات» (Guest Hub H4, 14 Nov 2026 — DECISIONS.md 2026-11-14 «Guest Hub H4 — the knowledge
// base»). OFFLINE — no Supabase project is reached: the dashboard runs on a Vite dev server whose Supabase URL is a stub
// origin, with a fake session (as hub-assistant-ui-check.mjs). The stub answers the knowledge RPCs with a few cards
// (published, a draft with a problem, an expiring one, an archived one), one open question cluster, the published FAQ as
// the engine reads it, one ending offer, and the fees of Settings.
// Checked at 1440 and 375, light and dark, for the system admin (knowledge publish + content edit), management
// (knowledge edit, no content) and sales (knowledge view):
//   - the page, the four tabs (the queue's count badge), the cards with their state chips, units, topics, source;
//   - «إضافة بطاقة»: the shared Modal, the site's date picker for the source date, its dirty guard (× on a typed title
//     asks «تعديلات غير محفوظة»), «حفظ» → hub_card_save with both languages, the units, topics and dates; the problems
//     listed in Arabic;
//   - «نشر» → hub_knowledge_publish, a blocked answer opens «ما يمنع النشر» with the list; «أرشفة» → hub_card_archive
//     and the «تراجع» toast → hub_card_restore;
//   - «لم أعرف الإجابة»: the excerpt and «سُئل 3 مرات»; «إنشاء بطاقة» prefilled with the topic and the question, «وأضفه
//     للأسئلة الشائعة» (content: edit only) → hub_card_save then hub_unanswered_resolve {action both, the FAQ draft};
//   - «الأسئلة الشائعة» read-only (no edit control), «تنتهي قريبًا» the card and the offer;
//   - «أسعار الخدمات»: breakfast (adult + child tiers), the extra bed, late check-out 2 pm / 4 pm, the key card, the hall
//     «عن طريق المبيعات», each with where it is edited; nothing editable;
//   - every data-tour target of both page tours; Western digits only; no horizontal scroll; axe zero serious / critical;
//     sales sees no edit control, management no «نشر» and no «وأضفه للأسئلة الشائعة».
// Screenshots in screenshots/hub/.
//   node admin/tests/hub-knowledge-ui-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const SHOTS = join(ROOT, 'screenshots', 'hub');
mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'knowledge', 'content', 'settings', 'offers', 'inbox'];
const me = (role, perms) => ({
  role, branch: null, full_name: 'مستخدم تجريبي للفحص', active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code',
  verified_at: new Date().toISOString(), email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, perms[s] ?? 'view'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (d) => new Date(Date.parse(`${today}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
const META = {
  units: [
    { key: 'airport-road', kind: 'branch', name_ar: 'فرع طريق المطار', status: 'active', knowledge_hidden: false },
    { key: 'shafa-road', kind: 'branch', name_ar: 'فرع طريق الشفا', status: 'active', knowledge_hidden: false },
    { key: 'lobby-cafe', kind: 'dining', name_ar: 'مقهى ومطعم أرمادا ريزيدنس', status: 'hidden', knowledge_hidden: false },
    { key: 'rooftop', kind: 'dining', name_ar: 'لاريو', status: 'hidden', knowledge_hidden: true },
  ],
  topics: [
    { key: 'parking', label_ar: 'المواقف', parent_key: null, always_handoff: false, faq_keys: ['parking'] },
    { key: 'facilities', label_ar: 'المرافق', parent_key: null, always_handoff: false, faq_keys: [] },
    { key: 'unconfirmed_facilities', label_ar: 'مرافق غير مؤكدة', parent_key: 'facilities', always_handoff: true, faq_keys: [] },
    { key: 'wifi', label_ar: 'الواي فاي', parent_key: null, always_handoff: false, faq_keys: ['wifi'] },
    { key: 'price', label_ar: 'السعر', parent_key: null, always_handoff: false, faq_keys: [] },
  ],
  card_days: 14, offer_days: 7, today,
};
const card = (n, o) => ({
  id: id(n), key: `k-qa-${n}`, unit_keys: ['airport-road', 'shafa-road'], topic_keys: ['parking'], title_ar: 'المواقف', title_en: 'Parking', text_ar: 'المواقف مجانية في الفرعين.', text_en: 'Parking is free at both properties.',
  source: 'branches.json', source_date: '2026-11-02', expires_on: null, status: 'published', state: 'published', pending: false, check: { missing: [] },
  verified_by: id(1), verified_by_name: 'أحمد', verified_at: '2026-11-13T09:00:00Z', published_at: '2026-11-13T09:00:00Z', first_published_at: '2026-11-13T09:00:00Z',
  faq_item_id: null, sort: n, is_test: false, live: { sort: n }, ...o,
});
const CARDS = [
  card(1, {}),
  card(2, { key: 'k-qa-draft', title_ar: 'مسودة فحص', title_en: 'QA draft', unit_keys: ['airport-road'], status: 'draft', state: 'draft', pending: true, live: null, first_published_at: null, check: { missing: [{ part: 'meta', code: 'source_required' }, { part: 'text', code: 'phone_typed', lang: 'ar' }] } }),
  card(3, { key: 'k-direct-price', title_ar: 'السعر المباشر', title_en: 'Direct price', topic_keys: ['price'], expires_on: plus(10) }),
  card(4, { key: 'k-qa-old', title_ar: 'بطاقة مؤرشفة', title_en: 'Archived', status: 'archived', state: 'archived' }),
];
const QUEUE = { open: 1, rows: [{ id: id(50), count: 3, topic_key: 'facilities', topic_label: 'المرافق', first_at: '2026-11-12T08:00:00Z', last_at: '2026-11-13T18:00:00Z', units: ['فرع طريق المطار', 'فرع طريق الشفا'], excerpts: ['هل يوجد مسبح في الفندق؟'], hidden_excerpts: 0, resolved_card_id: null, resolved_faq_id: null, resolved_at: null }] };
const FAQ = [
  { id: id(60), key: 'parking', category: 'stay', q_ar: 'هل يتوفر موقف؟', q_en: 'Is there parking?', a_ar: 'نعم، المواقف مجانية.', a_en: 'Yes, free.', pending: false, topics: ['parking'] },
  { id: id(61), key: 'breakfast', category: 'stay', q_ar: 'كم سعر الإفطار؟', q_en: 'Breakfast?', a_ar: 'الإفطار 20 ريالًا للشخص.', a_en: 'SAR 20.', pending: false, topics: [] },
];
const EXP = { today, card_days: 14, offer_days: 7, items: [{ kind: 'offer', id: id(70), key: 'winter', title: 'عرض الشتاء', ends: plus(5) }, { kind: 'card', id: id(3), key: 'k-direct-price', title: 'السعر المباشر', ends: plus(10) }] };
const PRICES = { breakfast: { adult: 20, child_tiers: [{ max_age: 5, price: 0 }, { max_age: 12, price: 10 }] }, extra_bed_per_night: 50, fees: { breakfast_adult: 20, extra_bed_per_night: 50 } };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: id(1), aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};
async function axe(page, tag) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  check(v.length === 0, `${tag}: axe zero serious / critical — ${v.join(' ; ')}`);
}
async function sane(page, tag) {
  const text = await page.evaluate(() => document.body.innerText);
  check(!/[٠-٩۰-۹]/.test(text), `${tag}: Western digits only`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal page scroll`);
  await axe(page, tag);
}

const ROLES = [
  ['admin', { knowledge: 'publish', content: 'publish', settings: 'edit', offers: 'publish', inbox: 'edit' }],
  ['management', { knowledge: 'edit', content: 'none', settings: 'edit', offers: 'edit', inbox: 'edit' }],
  ['sales', { knowledge: 'view', content: 'none', settings: 'view', offers: 'view', inbox: 'none' }],
];
const browser = await chromium.launch({ channel: 'chrome' });
for (const [role, perms] of ROLES) {
  const edit = perms.knowledge !== 'view';
  const pub = perms.knowledge === 'publish';
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${role} ${w} ${scheme}`;
      const calls = [];
      let publishBlocked = true;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: scheme });
      await ctx.route(`${STUB}/**`, async (r) => {
        const u = r.request().url();
        const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
        const fn = (u.match(/\/rest\/v1\/rpc\/([a-z_]+)/) ?? [])[1];
        let body = null;
        try { body = r.request().postDataJSON(); } catch { /* none */ }
        if (fn) calls.push({ fn, body });
        if (/\/rest\/v1\/hub_cards_library/.test(u)) return ok(CARDS);
        if (fn === 'my_staff') return ok(me(role, perms));
        if (fn === 'hub_knowledge_meta') return ok(META);
        if (fn === 'hub_unanswered_list') return ok(body?.p_status === 'open' ? QUEUE : { open: 1, rows: [] });
        if (fn === 'hub_knowledge_faq') return ok(FAQ);
        if (fn === 'hub_expiring') return ok(EXP);
        if (fn === 'hub_service_prices') return ok(PRICES);
        if (fn === 'hub_card_save') return ok({ ok: true, batch_id: id(900), id: id(99), key: 'k-new', check: { missing: [] } });
        if (fn === 'hub_card_archive' || fn === 'hub_card_restore') return ok({ ok: true, batch_id: id(901), changed: true });
        if (fn === 'hub_unanswered_resolve') return ok({ ok: true, batch_id: id(902), count: 3, card_id: id(99), faq_id: body?.p?.faq ? id(98) : null });
        if (fn === 'hub_unanswered_topic_set') return ok({ ok: true, batch_id: id(903) });
        if (fn === 'hub_knowledge_publish') {
          const blockedNow = publishBlocked;
          publishBlocked = false;
          return ok(blockedNow ? { ok: false, reason: 'blocked', blocked: [{ id: id(2), key: 'k-qa-draft', title_ar: 'مسودة فحص', missing: [{ part: 'meta', code: 'source_required' }] }] } : { ok: true, count: 1, batch_id: id(904) });
        }
        if (/\/auth\/v1\/user/.test(u)) return ok(USER);
        if (fn) return ok(null);
        return ok([]);
      });
      await ctx.addInitScript(([k, v]) => {
        try { localStorage.setItem(k, v); localStorage.setItem('armada-tour-test', '0'); } catch {}
      }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION)]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      // ── «البطاقات» ──
      await page.goto(`${BASE}/knowledge`, { waitUntil: 'load' });
      await page.locator('[data-page="knowledge"] [data-card]').first().waitFor({ timeout: 30000 });
      const tabs = await page.$$eval('[data-page="knowledge"] [role="tab"]', (a) => a.map((x) => x.getAttribute('data-tab')));
      check(tabs.join() === 'cards,queue,faq,expiring', `${tag}: the four tabs — ${tabs.join()}`);
      check((await page.locator('[data-count="queue"]').textContent())?.trim() === '1', `${tag}: «لم أعرف الإجابة» carries its count badge`);
      const states = await page.$$eval('[data-card]', (a) => a.map((x) => x.getAttribute('data-card-state')));
      check(states.join() === 'published,draft,published', `${tag}: the cards not archived by default — ${states.join()}`);
      check((await page.locator('[data-card="k-qa-1"] [data-units]').textContent()).includes('فرع طريق المطار، فرع طريق الشفا') && (await page.locator('[data-card="k-qa-1"]').textContent()).includes('branches.json'), `${tag}: a card shows its units and its source`);
      check(await page.locator('[data-card="k-qa-draft"] [data-missing]').isVisible(), `${tag}: a draft with a problem says so`);
      check((await page.locator('[data-action="card-add"]').count()) === (edit ? 1 : 0), `${tag}: «إضافة بطاقة» for editors only`);
      check((await page.locator('[data-action="kn-publish"]').count()) === (pub ? 1 : 0), `${tag}: «نشر» for publishers only`);
      check((await page.locator('[data-action="card-archive"]').count()) === (pub ? 3 : edit ? 1 : 0), `${tag}: «أرشفة» — a published card needs publish (${await page.locator('[data-action="card-archive"]').count()})`);
      await page.locator('#kn-state').selectOption('archived');
      check((await page.locator('[data-card]').count()) === 1 && (await page.locator('[data-card="k-qa-old"]').isVisible()), `${tag}: the archived filter`);
      await page.locator('#kn-state').selectOption('live');
      const TOUR = ['kn-tabs', 'kn-cards', ...(edit ? ['kn-add'] : []), ...(pub ? ['kn-publish'] : [])];
      for (const t of TOUR) check((await page.locator(`[data-tour~="${t}"]`).count()) >= 1, `${tag}: the page tour target «${t}» exists`);
      if (w === 1440 && role === 'admin') await page.screenshot({ path: join(SHOTS, `knowledge-${scheme}.png`), fullPage: true });
      await sane(page, `${tag} cards`);

      if (edit) {
        // the editor: the shared Modal, its dirty guard, the date picker, the save
        await page.locator('[data-action="card-add"]').click();
        await page.locator('[data-card-form]').waitFor({ timeout: 5000 });
        check((await page.locator('[data-card-form] [data-unit-toggle]').count()) === 3, `${tag}: the editor offers three units (never the rooftop)`);
        check((await page.locator('[data-card-form] [data-dr-display], [data-card-form] [data-dr-trigger], [data-card-form] .dr').count()) >= 1 || (await page.locator('[data-card-form] [data-dr-value]').count()) >= 2, `${tag}: the site's date picker for the dates`);
        check((await page.locator('[data-card-form] input[type="date"]').count()) === 0, `${tag}: no native date input`);
        await page.waitForTimeout(500);
        await page.locator('#card-title-ar').fill('المسبح');
        await page.locator('dialog[open] [data-action="dialog-close"]').click();
        check((await page.locator('dialog[open] dialog[open]', { hasText: 'تعديلات غير محفوظة' }).count()) === 1, `${tag}: × on a typed title asks «تعديلات غير محفوظة»`);
        await page.getByRole('button', { name: 'متابعة التعديل' }).click();
        await page.locator('#card-title-en').fill('Pool');
        await page.locator('#card-text-ar').fill('لا يوجد مسبح في الفرعين.');
        await page.locator('#card-text-en').fill('There is no pool at either property.');
        await page.locator('#card-source').fill('أحمد، 13 نوفمبر 2026');
        await page.locator('[data-card-form] [data-unit-toggle="airport-road"]').click();
        await page.locator('[data-field="topic-add"]').selectOption('facilities');
        check((await page.locator('[data-card-problems]').textContent()).includes('اختر تاريخ المصدر'), `${tag}: the missing source date is said before saving`);
        await page.locator('[data-action="card-save"]').click();
        await page.waitForTimeout(400);
        const save = calls.find((c) => c.fn === 'hub_card_save');
        check(save && save.body.p_id === null && save.body.p.title_ar === 'المسبح' && save.body.p.text_en.startsWith('There is no pool') && JSON.stringify(save.body.p.unit_keys) === '["airport-road"]'
          && JSON.stringify(save.body.p.topic_keys) === '["facilities"]' && save.body.p.source === 'أحمد، 13 نوفمبر 2026', `${tag}: «حفظ» → hub_card_save with both languages, the unit, the topic, the source — ${JSON.stringify(save?.body)}`);
        check(!(await page.locator('[data-card-form]').isVisible().catch(() => false)), `${tag}: the editor closes after a save`);
      }
      if (pub) {
        await page.locator('[data-action="kn-publish"]').click();
        await page.locator('[data-kn-blocked]').waitFor({ timeout: 5000 });
        check((await page.locator('[data-blocked-card="k-qa-draft"]').textContent()).includes('اكتب المصدر'), `${tag}: a blocked «نشر» lists what to fix, in Arabic`);
        await page.locator('dialog[open] [data-action="dialog-cancel"]').click();
        await page.waitForTimeout(300);
        await page.locator('[data-action="kn-publish"]').click();
        await page.waitForTimeout(400);
        check(calls.filter((c) => c.fn === 'hub_knowledge_publish').length === 2, `${tag}: «نشر» → hub_knowledge_publish`);
        await page.locator('[data-card="k-qa-1"] [data-action="card-archive"]').click();
        await page.locator('[data-toast="undo"]').waitFor({ timeout: 5000 });
        check(calls.some((c) => c.fn === 'hub_card_archive' && c.body.p_id === id(1)), `${tag}: «أرشفة» → hub_card_archive`);
        await page.locator('[data-toast="undo"] [data-action="undo"]').click();
        await page.waitForTimeout(400);
        check(calls.some((c) => c.fn === 'hub_card_restore' && c.body.p_id === id(1)), `${tag}: «تراجع» → hub_card_restore`);
      }

      // ── «لم أعرف الإجابة» ──
      await page.locator('[role="tab"][data-tab="queue"]').click();
      await page.locator('[data-queue]').first().waitFor({ timeout: 5000 });
      const qrow = await page.locator('[data-queue]').first().textContent();
      check(qrow.includes('«هل يوجد مسبح في الفندق؟»') && qrow.includes('سُئل 3 مرات'), `${tag}: the question and «سُئل 3 مرات» — ${qrow.slice(0, 120)}`);
      check((await page.locator('[data-action="queue-card"]').count()) === (edit ? 1 : 0) && (await page.locator('[data-queue-topic]').isDisabled()) === !edit, `${tag}: the queue's actions for editors only`);
      if (edit) {
        await page.locator('[data-action="queue-card"]').click();
        await page.locator('[data-card-form] [data-from-queue]').waitFor({ timeout: 5000 });
        check((await page.locator('#card-title-ar').inputValue()) === 'هل يوجد مسبح في الفندق؟' && (await page.locator('[data-topics-selected]').textContent()).includes('المرافق'), `${tag}: «إنشاء بطاقة» prefilled with the question and its topic`);
        check((await page.locator('[data-field="to-faq"]').count()) === (perms.content === 'none' ? 0 : 1), `${tag}: «وأضفه للأسئلة الشائعة» only with content: edit`);
        await page.waitForTimeout(500);
        await page.locator('#card-title-en').fill('Is there a pool?');
        await page.locator('#card-text-ar').fill('لا يوجد مسبح في الفرعين.');
        await page.locator('#card-text-en').fill('There is no pool at either property.');
        await page.locator('#card-source').fill('أحمد، 13 نوفمبر 2026');
        if (perms.content !== 'none') await page.locator('[data-field="to-faq"]').check();
        await page.locator('[data-action="card-save"]').click();
        await page.waitForTimeout(500);
        const res = calls.find((c) => c.fn === 'hub_unanswered_resolve');
        const wantBoth = perms.content !== 'none';
        check(res && res.body.p_id === id(50) && res.body.p.action === (wantBoth ? 'both' : 'card') && res.body.p.card_id === id(99)
          && (!wantBoth || (res.body.p.faq.category === 'stay' && res.body.p.faq.q_en === 'Is there a pool?' && res.body.p.faq.a_ar === 'لا يوجد مسبح في الفرعين.')), `${tag}: the card saved, then the cluster resolved — ${JSON.stringify(res?.body)}`);
      }
      await sane(page, `${tag} queue`);

      // ── «الأسئلة الشائعة» (read-only) and «تنتهي قريبًا» ──
      await page.locator('[role="tab"][data-tab="faq"]').click();
      await page.locator('[data-faq-read]').first().waitFor({ timeout: 5000 });
      check((await page.locator('[data-faq-read]').count()) === 2 && (await page.locator('[data-faq-read="breakfast"]').textContent()).includes('20 ريالًا') && (await page.locator('[data-faq-read="breakfast"] [data-no-topic]').isVisible()), `${tag}: the FAQ as read, the fee filled, a question no topic reads`);
      check((await page.locator('[data-tour~="kn-faq"] input, [data-tour~="kn-faq"] textarea, [data-tour~="kn-faq"] [data-action="faq-edit"]').count()) === 0, `${tag}: the FAQ tab is read-only`);
      await page.locator('[role="tab"][data-tab="expiring"]').click();
      await page.locator('[data-expiring]').first().waitFor({ timeout: 5000 });
      const ex = await page.$$eval('[data-expiring]', (a) => a.map((x) => x.textContent));
      check(ex.length === 2 && ex[0].includes('عرض: عرض الشتاء') && ex[0].includes('بعد 5 أيام') && ex[1].includes('بطاقة: السعر المباشر') && ex[1].includes('بعد 10 أيام'), `${tag}: «تنتهي قريبًا» — ${ex.join(' | ')}`);
      if (w === 375 && role === 'admin') await page.screenshot({ path: join(SHOTS, `knowledge-expiring-375-${scheme}.png`), fullPage: true });
      await sane(page, `${tag} expiring`);

      // ── «أسعار الخدمات» ──
      await page.goto(`${BASE}/service-prices`, { waitUntil: 'load' });
      await page.locator('[data-page="service-prices"] [data-price]').first().waitFor({ timeout: 30000 });
      const prices = Object.fromEntries(await page.$$eval('[data-price]', (a) => a.map((x) => [x.getAttribute('data-price'), x.querySelector('[data-value]').textContent.trim()])));
      check(prices.breakfast_adult === '20 ريالًا' && prices.breakfast_child_5 === 'مجانًا' && prices.breakfast_child_12 === '10 ريالات' && prices.extra_bed === '50 ريالًا'
        && prices.late_2pm === '100 ريال' && prices.late_4pm === '200 ريال' && prices.key_card === '10 ريالات' && prices.hall === 'عن طريق المبيعات', `${tag}: the fees from their sources — ${JSON.stringify(prices)}`);
      const where = await page.$$eval('[data-edit-link]', (a) => a.map((x) => x.getAttribute('data-edit-link')));
      check(where.filter((x) => x === '/settings').length === 4 && where.filter((x) => x === '/content').length === 3, `${tag}: each row says where it is edited`);
      check((await page.locator('[data-page="service-prices"] input, [data-page="service-prices"] textarea, [data-page="service-prices"] select').count()) === 0, `${tag}: nothing is editable here`);
      check((await page.locator('[data-tour~="prices-table"]').count()) === 1, `${tag}: the page tour target exists`);
      if (w === 1440 && role === 'admin') await page.screenshot({ path: join(SHOTS, `service-prices-${scheme}.png`), fullPage: true });
      await sane(page, `${tag} prices`);
      check(errors.length === 0, `${tag}: no page error — ${errors.join(' | ')}`);
      await ctx.close();
    }
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`hub-knowledge-ui-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`hub-knowledge-ui-check: ${checks} checks passed`);
