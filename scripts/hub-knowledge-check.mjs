// «قاعدة المعرفة» end to end on a PREVIEW BRANCH (Guest Hub H4, 14 Nov 2026 — DECISIONS.md 2026-11-14 «Guest Hub H4»).
// Every call goes the dashboard's own way — PostgREST with a real signed-in user (password + the email code) — so the
// branch's API roles apply exactly as on production (pg_safeupdate included: an UPDATE / DELETE without a WHERE fails
// here as it did on 13 Nov). Users: the system admin (knowledge publish, content publish), management (knowledge edit,
// no content), sales (knowledge view, no inbox), Airport Road reception (member of its unit).
//   1. the seed: 37 committed cards published, 56 topics, the editor's meta (the rooftop excluded);
//   2. levels: sales cannot save, management cannot publish or archive a published card, no direct write for anyone;
//   3. a card: save (checks in both languages), publish, the engine's read (first on shafa-road, after airport-road's own cards there — H5), an
//      edit pending until «نشر», archive / restore;
//   4. «لم أعرف الإجابة»: two close questions marked by reception → one cluster «سُئل مرتين»; sales sees the count, never
//      the words; a topic for the cluster; management cannot add a FAQ draft; the admin resolves «both» → the card and a
//      FAQ DRAFT (never live);
//   5. the FAQ as read (fees filled), «تنتهي قريبًا» and the daily alert (tick → one row, claim → the list once);
//   6. the page in a browser (the dev server pointed at the branch): the cards, the queue's badge, the editor opens.
// Everything it creates is deleted at the end; «تخزين المحادثات» is put back off.
//   node scripts/hub-knowledge-check.mjs --branch <keys.json> [--base http://127.0.0.1:5173]
import { chromium } from 'playwright';
import { branchKeys, browserLogin, client, dropUsers, harness, unitIds, users } from './hub-branch-lib.mjs';

const K = branchKeys('hub-knowledge-check');
const c = client(K);
const { check, done } = harness('hub-knowledge-check');
const bi = process.argv.indexOf('--base');
const BASE = (bi > 0 ? process.argv[bi + 1] : 'http://127.0.0.1:5173').replace(/\/$/, '');
const RUN = String(Date.now()).slice(-6);
const PHONES = [`+9665${RUN}91`, `+9665${RUN}92`];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (d) => new Date(Date.parse(`${today}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
const keys = (r) => (r.json?.cards ?? []).map((x) => x.key);
const created = { cards: [], faq: [] };
let U = null;
let inboxBefore = null;

try {
  U = await users(K, c, {
    admin: { role: 'admin' },
    mgmt: { role: 'management', perms: { content: 'none' } },
    sales: { role: 'sales', perms: { inbox: 'none' } },
    recA: { role: 'reception', branch: 'airport-road' },
  }, 'h4k');
  const units = await unitIds(c);
  for (const [who, unit] of [['admin', 'airport-road'], ['admin', 'shafa-road'], ['recA', 'airport-road']]) {
    const m = await c.rest('/rest/v1/hub_unit_members', { method: 'POST', body: { unit_id: units[unit], staff_id: U[who].id } });
    if (m.status >= 300) throw new Error(`member: ${m.text.slice(0, 200)}`);
  }
  const A = U.admin.H, M = U.mgmt.H, Sa = U.sales.H, R = U.recA.H;

  // ── 1. the seed ──
  const lib = await c.rest('/rest/v1/hub_cards_library?select=key,state,check&is_test=eq.false', { headers: Sa });
  const committed = (lib.json ?? []).filter((x) => !/^k-wifi-password/.test(x.key));
  check(lib.status === 200 && committed.filter((x) => x.state === 'published').length >= 37, 'sales reads the 37 published cards', `${lib.status} ${committed.length}`);
  check(committed.every((x) => !x.check.missing.length), 'no seed card has a problem');
  const meta = await c.rpc('hub_knowledge_meta', {}, Sa);
  check(meta.json?.topics?.length === 56 && meta.json.units.find((u) => u.key === 'rooftop')?.knowledge_hidden === true, 'the editor\'s meta: 56 topics, the rooftop excluded', meta.text.slice(0, 200));

  // ── 2 + 3. levels and a card ──
  const card = (o = {}) => ({ key: `k-e2e-${RUN}`, unit_keys: ['shafa-road'], topic_keys: ['facilities'], title_ar: 'لا يوجد مسبح', title_en: 'No pool', text_ar: 'لا يوجد مسبح في فرع طريق الشفا.', text_en: 'There is no pool at the Shafa Road property.', source: 'فحص H4', source_date: today, expires_on: null, ...o });
  const s0 = await c.rpc('hub_card_save', { p_id: null, p: card() }, Sa);
  check(s0.status >= 400 && /42501|not allowed/.test(s0.text), 'sales cannot save a card', `${s0.status} ${s0.text.slice(0, 120)}`);
  const d0 = await c.rest('/rest/v1/hub_knowledge_cards', { method: 'POST', headers: A, body: { key: `k-e2e-direct-${RUN}` } });
  check(d0.status >= 400, 'no direct write, not even for the admin', `${d0.status}`);
  const s1 = await c.rpc('hub_card_save', { p_id: null, p: card({ text_ar: 'لا يوجد مسبح. اتصل على 0551234567' }) }, M);
  check(s1.status === 200 && s1.json?.check?.missing?.some((p) => p.code === 'phone_typed'), 'a typed phone is listed on save; the draft is kept', s1.text.slice(0, 200));
  const cid = s1.json?.id;
  if (cid) created.cards.push(cid);
  const s2 = await c.rpc('hub_card_save', { p_id: cid, p: card() }, M);
  check(s2.status === 200 && s2.json.check.missing.length === 0, 'management fixes it: nothing missing', s2.text.slice(0, 200));
  const p0 = await c.rpc('hub_knowledge_publish', { p_dry_run: false }, M);
  check(p0.status >= 400 && /42501|not allowed/.test(p0.text), 'management cannot publish', `${p0.status}`);
  const p1 = await c.rpc('hub_knowledge_publish', { p_dry_run: false }, A);
  check(p1.status === 200 && p1.json?.ok && p1.json.count >= 1, 'the admin publishes (through PostgREST: every UPDATE has its WHERE)', p1.text.slice(0, 200));
  const k1 = await c.rpc('hub_knowledge_for', { p_unit: 'shafa-road', p_topics: ['facilities'], p_language: 'ar' });
  const k2 = await c.rpc('hub_knowledge_for', { p_unit: 'airport-road', p_topics: ['facilities'], p_language: 'ar' });
  // H5 (Ahmed, 14 Nov 2026): every published card on both branch numbers, the number's own branch first
  check(keys(k1).includes(`k-e2e-${RUN}`) && keys(k2).includes(`k-e2e-${RUN}`), 'the engine reads it on both branch numbers (the order: hub-retrieval-check and the SQL test)', `${keys(k1)} | ${keys(k2)}`);
  const k3 = await c.rpc('hub_knowledge_for', { p_unit: 'shafa-road', p_topics: ['facilities'], p_language: 'ar' }, A);
  check(k3.status >= 400, 'the engine\'s read is refused to staff', `${k3.status}`);
  await c.rpc('hub_card_save', { p_id: cid, p: card({ text_ar: 'لا يوجد مسبح في الفرع.' }) }, M);
  const pend = await c.rest(`/rest/v1/hub_cards_library?select=pending,live&id=eq.${cid}`, { headers: Sa });
  check(pend.json?.[0]?.pending === true && pend.json[0].live.text_ar === 'لا يوجد مسبح في فرع طريق الشفا.', 'an edit waits for «نشر»; the engine keeps the published text');
  const a0 = await c.rpc('hub_card_archive', { p_id: cid }, M);
  check(a0.status >= 400, 'management cannot archive a published card', `${a0.status}`);
  const a1 = await c.rpc('hub_card_archive', { p_id: cid }, A);
  const k4 = await c.rpc('hub_knowledge_for', { p_unit: 'shafa-road', p_topics: ['facilities'], p_language: 'ar' });
  check(a1.json?.changed && !keys(k4).includes(`k-e2e-${RUN}`), 'archived: out of the engine\'s read at once');
  await c.rpc('hub_card_restore', { p_id: cid }, A);
  const k5 = await c.rpc('hub_knowledge_for', { p_unit: 'shafa-road', p_topics: ['facilities'], p_language: 'ar' });
  check(keys(k5).includes(`k-e2e-${RUN}`), '«تراجع» (restore): back in the read');
  const k6 = await c.rpc('hub_knowledge_for', { p_unit: 'shafa-road', p_topics: ['menu', 'cafe_restaurant'], p_language: 'ar' });
  const ONLY = ['k-cafe-menu', 'k-cafe-phone', 'k-cafe-breakfast-menu'];
  check(!keys(k6).some((k) => ONLY.includes(k)), 'the café menu / ordering cards never on shafa-road while no branch is named', keys(k6).join());
  const k6b = await c.rpc('hub_knowledge_for', { p_unit: 'shafa-road', p_topics: ['menu', 'cafe_restaurant'], p_language: 'ar', p_branch: 'airport-road' });
  check(keys(k6b).includes('k-cafe-menu'), '… and on shafa-road when the guest names Airport Road', keys(k6b).join());
  const k7 = await c.rpc('hub_knowledge_for', { p_unit: 'rooftop', p_topics: ['menu'], p_language: 'ar' });
  check(k7.json?.cards?.length === 0, 'the rooftop reads nothing');

  // ── 4. «لم أعرف الإجابة» ──
  const inb = await c.rest('/rest/v1/settings?select=value&key=eq.hub_inbox_on');
  inboxBefore = inb.json?.[0]?.value ?? false;
  // «تخزين المحادثات» on, the dashboard's way (the system admin, assistant: edit)
  const on = await c.rpc('hub_setting_set', { p_key: 'hub_inbox_on', p_value: true }, A);
  check(on.status === 200, '«تخزين المحادثات» switched on by the admin (hub_setting_set)', on.text.slice(0, 160));
  const ids = [];
  for (const [i, body] of [['1', 'هل يوجد مسبح في الفندق؟'], ['2', 'هل في الفندق مسبح ؟']]) {
    const r = await c.rpc('hub_ingest_inbound', { p: { channel: '+966536622277', phone: PHONES[Number(i) - 1], provider_id: `E2E-H4-${RUN}-${i}`, sent_at: new Date().toISOString(), kind: 'text', body, profile_name: 'E2E H4' } });
    check(r.json?.stored, `inbound ${i} stored`, r.text.slice(0, 160));
    ids.push(r.json?.message_id);
  }
  const m1 = await c.rpc('hub_mark_unanswered', { p_message: ids[0] }, R);
  const m2 = await c.rpc('hub_mark_unanswered', { p_message: ids[1] }, R);
  check(m1.json?.changed && m2.json?.cluster_id === m1.json?.cluster_id, 'reception marks both; the close wording joins one cluster', `${m1.text} ${m2.text}`);
  const cluster = m1.json?.cluster_id;
  const qs = await c.rpc('hub_unanswered_list', { p_status: 'open' }, Sa);
  const rowS = qs.json?.rows?.find((x) => x.id === cluster);
  check(rowS?.count === 2 && rowS.excerpts.length === 0 && rowS.hidden_excerpts === 2 && !/مسبح/.test(qs.text), 'sales: «سُئل مرتين», never the guest\'s words', qs.text.slice(0, 200));
  const qa = await c.rpc('hub_unanswered_list', { p_status: 'open' }, A);
  check(qa.json?.rows?.find((x) => x.id === cluster)?.excerpts?.length === 2, 'the admin (in the unit\'s team) reads both wordings');
  const t1 = await c.rpc('hub_unanswered_topic_set', { p_id: cluster, p_topic: 'facilities' }, M);
  check(t1.status === 200, 'management sets the cluster\'s topic', t1.text.slice(0, 120));
  const faq = { category: 'stay', q_ar: 'هل يوجد مسبح؟', q_en: 'Is there a pool?', a_ar: 'لا يوجد مسبح في الفرعين.', a_en: 'There is no pool at either property.' };
  const r0 = await c.rpc('hub_unanswered_resolve', { p_id: cluster, p: { action: 'faq', faq } }, M);
  check(r0.status >= 400 && /42501|not allowed/.test(r0.text), 'management (no content: edit) cannot add a FAQ draft', `${r0.status}`);
  const r1 = await c.rpc('hub_unanswered_resolve', { p_id: cluster, p: { action: 'both', card_id: cid, faq } }, A);
  check(r1.status === 200 && r1.json?.count === 2 && r1.json.faq_id, 'the admin resolves «both»: every entry, the card and a FAQ draft', r1.text.slice(0, 200));
  if (r1.json?.faq_id) created.faq.push(r1.json.faq_id);
  const fd = await c.rest(`/rest/v1/faq_items?select=live,key,q_ar&id=eq.${r1.json?.faq_id}`);
  check(fd.json?.[0]?.live === null && /^hub-[0-9a-f]{8}$/.test(fd.json[0].key), 'the FAQ question is a draft (never live from here)', fd.text.slice(0, 160));

  // ── 5. the FAQ as read, expiry ──
  const fr = await c.rpc('hub_knowledge_faq', {}, Sa);
  const bf = fr.json?.find((x) => x.key === 'breakfast');
  check(bf && !/\{(breakfast|extra_bed)\}/.test(JSON.stringify(fr.json)) && /ريال/.test(bf.a_ar), 'the FAQ as read: the fees filled from Settings', bf?.a_ar?.slice(0, 120));
  const e1 = await c.rpc('hub_card_save', { p_id: null, p: card({ key: `k-e2e-exp-${RUN}`, unit_keys: [], expires_on: plus(5), title_ar: 'بطاقة تنتهي', title_en: 'Ending card' }) }, A);
  if (e1.json?.id) created.cards.push(e1.json.id);
  await c.rpc('hub_knowledge_publish', { p_dry_run: false }, A);
  const ex = await c.rpc('hub_expiring', {}, M);
  check(ex.json?.items?.some((x) => x.key === `k-e2e-exp-${RUN}`), '«تنتهي قريبًا» lists the card ending in 5 days', ex.text.slice(0, 200));
  const tk = await c.rpc('hub_expiry_tick', {});
  const cl = await c.rpc('hub_expiry_claim', {});
  const cl2 = await c.rpc('hub_expiry_claim', {});
  check(tk.json?.new >= 1 && cl.json?.items?.some((x) => x.title === 'بطاقة تنتهي') && (cl.json.recipients ?? []).includes(U.admin.email) && cl2.json?.items?.length === 0,
    'the daily alert: a new row, the list once to the active admins, nothing the second time', `${tk.text} | ${cl.text.slice(0, 200)}`);
  const tk0 = await c.rpc('hub_expiry_tick', {}, A);
  check(tk0.status >= 400, 'the tick is service role only', `${tk0.status}`);

  // ── 6. the page in a browser ──
  let up = false;
  try {
    up = (await fetch(`${BASE}/login`)).ok;
  } catch { /* not running */ }
  check(up, `the dashboard dev server answers at ${BASE} (vite --mode branch)`);
  if (up) {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const { ctx, page } = await browserLogin(browser, K, c, BASE, U.admin);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE}/knowledge`);
      await page.waitForSelector('[data-page="knowledge"] [data-card]', { timeout: 30000 });
      check((await page.locator('[data-card]').count()) >= 37, 'the page lists the cards from the branch');
      await page.locator('[role="tab"][data-tab="faq"]').click();
      await page.waitForSelector('[data-faq-read]', { timeout: 15000 });
      check((await page.locator('[data-faq-read]').count()) >= 10, 'the FAQ tab reads the published FAQ');
      await page.locator('[role="tab"][data-tab="cards"]').click();
      await page.locator(`[data-card="k-e2e-${RUN}"] [data-action="card-edit"]`).click();
      await page.waitForSelector('[data-card-form]', { timeout: 10000 });
      check((await page.locator('#card-title-ar').inputValue()) === 'لا يوجد مسبح', 'the editor opens with the card');
      await page.screenshot({ path: 'screenshots/hub/knowledge-branch.png' }).catch(() => {});
      check(errors.length === 0, 'no page error', errors.join(' | '));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} catch (e) {
  check(false, `setup: ${e.message}`);
} finally {
  for (const id of created.cards) await c.rest(`/rest/v1/hub_knowledge_cards?id=eq.${id}`, { method: 'DELETE' });
  for (const id of created.faq) await c.rest(`/rest/v1/faq_items?id=eq.${id}`, { method: 'DELETE' });
  await c.rest('/rest/v1/hub_alerts?kind=in.(card_expiring,offer_ending)', { method: 'DELETE' });
  for (const p of PHONES) {
    const g = await c.rest(`/rest/v1/guest_profiles?select=id&phone=eq.${encodeURIComponent(p)}`);
    for (const row of g.json ?? []) {
      await c.rest(`/rest/v1/hub_conversations?guest_profile_id=eq.${row.id}`, { method: 'DELETE' });
      await c.rest(`/rest/v1/guest_profiles?id=eq.${row.id}`, { method: 'DELETE' });
    }
  }
  if (inboxBefore !== null && U?.admin?.H) await c.rpc('hub_setting_set', { p_key: 'hub_inbox_on', p_value: inboxBefore }, U.admin.H);
  await dropUsers(c, U);
}
done();
