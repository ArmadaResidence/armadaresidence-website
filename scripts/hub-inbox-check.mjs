// «المحادثات» end to end on a PREVIEW BRANCH (Guest Hub H3 — the spec's hub-inbox-check, built and run in H4, 14 Nov
// 2026). Real signed-in users through PostgREST and the branch's own hub-admin function; every conversation is a TEST
// conversation (is_test), so hub-admin sends in test mode: nothing reaches YCloud or a guest (the branch holds no
// YCloud key either). Users: Airport Road reception (member), Shafa Road reception (member), management (member of
// Airport Road, inbox edit), a viewer (management with inbox: view).
//   1. scope: each reception lists its own unit only; another unit's thread and actions are refused;
//   2. actions: take over, a note, a transfer (a note required) that the other team then sees, assign, block / unblock,
//      close — each an event in the thread;
//   3. sending through hub-admin: a text inside the window (status test, the waiting cleared, the badge down), the same
//      press twice sends nothing twice, outside the window «إرسال عند رد الضيف» (the template now, the answer held) and
//      the held answer claimed once when the guest writes again; a send with «الإرسال من المركز» off is refused;
//   4. a reply from the phone (whatsapp.smb.message.echoes, H4 step 0b): no longer waiting, out of the badge, no email;
//   5. the viewer: reads, never acts, never sends;
//   6. the page in a browser (the dev server pointed at the branch): the list, the thread, a reply sent from the composer.
// Everything it creates is deleted at the end; «تخزين المحادثات» and the channels' sending are put back as they were.
//   node scripts/hub-inbox-check.mjs --branch <keys.json> [--base http://127.0.0.1:5173]
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { branchKeys, browserLogin, client, dropUsers, harness, unitIds, users } from './hub-branch-lib.mjs';

const K = branchKeys('hub-inbox-check');
const c = client(K);
const { check, done } = harness('hub-inbox-check');
const bi = process.argv.indexOf('--base');
const BASE = (bi > 0 ? process.argv[bi + 1] : 'http://127.0.0.1:5173').replace(/\/$/, '');
const RUN = String(Date.now()).slice(-6);
const phone = (n) => `+9665${RUN}8${n}`;
const PH = { a: phone(1), b: phone(2), d: phone(3), e: phone(4), w: phone(5) };
let U = null;
let restore = null;

const conv = async (p) => (await c.rest(`/rest/v1/hub_conversations?select=*,guest_profiles!inner(phone)&guest_profiles.phone=eq.${encodeURIComponent(p)}&state=neq.closed&order=created_at.desc&limit=1`)).json?.[0];
const inbound = (p, body, ch = '+966536622277') =>
  c.rpc('hub_ingest_inbound', { p: { channel: ch, phone: p, provider_id: `E2E-H3-${randomUUID()}`, sent_at: new Date().toISOString(), kind: 'text', body, profile_name: 'E2E Inbox', is_test: true } });

try {
  U = await users(K, c, {
    recA: { role: 'reception', branch: 'airport-road' },
    recS: { role: 'reception', branch: 'shafa-road' },
    mgmt: { role: 'management', perms: { assistant: 'edit' } },
    viewer: { role: 'management', perms: { inbox: 'view' } },
  }, 'h3i');
  const units = await unitIds(c);
  for (const [who, unit] of [['recA', 'airport-road'], ['recS', 'shafa-road'], ['mgmt', 'airport-road'], ['viewer', 'airport-road']]) {
    const m = await c.rest('/rest/v1/hub_unit_members', { method: 'POST', body: { unit_id: units[unit], staff_id: U[who].id } });
    if (m.status >= 300) throw new Error(`member: ${m.text.slice(0, 200)}`);
  }
  const inb = await c.rest('/rest/v1/settings?select=value&key=eq.hub_inbox_on');
  const chs = await c.rest('/rest/v1/hub_channels?select=id,address,verified_at,sending_enabled&kind=eq.whatsapp');
  restore = { inbox: inb.json?.[0]?.value ?? false, channels: chs.json ?? [] };
  const RA = U.recA.H, RS = U.recS.H, MG = U.mgmt.H, V = U.viewer.H;
  // «تخزين المحادثات» and «الإرسال من المركز», the dashboard's way (assistant: edit); «تحقق من القناة» reads YCloud, so
  // the channels' verified_at is set directly on the branch
  const on = await c.rpc('hub_setting_set', { p_key: 'hub_inbox_on', p_value: true }, MG);
  check(on.status === 200, '«تخزين المحادثات» switched on (hub_setting_set)', on.text.slice(0, 160));
  for (const ch of restore.channels) {
    await c.rest(`/rest/v1/hub_channels?id=eq.${ch.id}`, { method: 'PATCH', body: { verified_at: ch.verified_at ?? new Date().toISOString() } });
    const sw = await c.rpc('hub_channel_sending_set', { p_channel: ch.id, p_on: true }, MG);
    check(sw.status === 200, `«الإرسال من المركز» on ${ch.address} (hub_channel_sending_set)`, sw.text.slice(0, 160));
  }

  // the branch has no template rows (production reads them from YCloud with «تحديث حالة القوالب»): hub_reply_ready
  // APPROVED on both numbers, as production holds them, for this run only
  for (const ch of restore.channels) {
    for (const language of ['ar', 'en']) {
      const t = await c.rest('/rest/v1/hub_templates?on_conflict=channel_id,name,language', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { channel_id: ch.id, name: 'hub_reply_ready', language, category: 'UTILITY', status: 'APPROVED', is_test: true } });
      if (t.status >= 300) throw new Error(`template row: ${t.text.slice(0, 160)}`);
    }
  }
  for (const [k, ch] of [['a', '+966536622277'], ['b', '+966536663030'], ['d', '+966536622277'], ['e', '+966536622277'], ['w', '+966536622277']]) {
    const r = await inbound(PH[k], `سؤال ${k}`, ch);
    check(r.json?.stored, `inbound ${k} stored (test)`, r.text.slice(0, 160));
  }
  const A = await conv(PH.a), B = await conv(PH.b), D = await conv(PH.d), E = await conv(PH.e), W = await conv(PH.w);

  // ── 1. scope ──
  const la = await c.rpc('hub_inbox_list', { p: { tab: 'waiting' } }, RA);
  const ids = (la.json?.rows ?? []).map((x) => x.id);
  check(ids.includes(A.id) && !ids.includes(B.id), 'Airport Road reception lists its unit only', la.text.slice(0, 160));
  const tb = await c.rpc('hub_thread', { p_conversation: B.id }, RA);
  check(tb.status >= 400 && /42501|not allowed/.test(tb.text), 'another unit\'s thread is refused', `${tb.status}`);
  const ls = await c.rpc('hub_inbox_list', { p: { tab: 'all' } }, RS);
  check((ls.json?.rows ?? []).some((x) => x.id === B.id) && !(ls.json?.rows ?? []).some((x) => x.id === A.id), 'Shafa Road reception lists Shafa Road only');

  // ── 2. actions ──
  const t1 = await c.rpc('hub_take_over', { p_conversation: A.id }, RA);
  check(t1.status === 200, '«تولّي المحادثة»', t1.text.slice(0, 120));
  const n1 = await c.rpc('hub_note_add', { p_conversation: A.id, p_text: 'سأتصل بالضيف' }, RA);
  check(n1.status === 200, '«ملاحظة»', n1.text.slice(0, 120));
  const tr0 = await c.rpc('hub_transfer', { p_conversation: E.id, p_unit: units['shafa-road'], p_note: '' }, RA);
  check(tr0.status >= 400, 'a transfer without a note is refused', `${tr0.status}`);
  const tr1 = await c.rpc('hub_transfer', { p_conversation: E.id, p_unit: units['shafa-road'], p_note: 'الضيف يسأل عن الشفا' }, RA);
  const ls2 = await c.rpc('hub_inbox_list', { p: { tab: 'all' } }, RS);
  check(tr1.status === 200 && (ls2.json?.rows ?? []).some((x) => x.id === E.id), 'transferred: the Shafa Road team now sees it', tr1.text.slice(0, 120));
  const as = await c.rpc('hub_assign', { p_conversation: D.id, p_staff: U.mgmt.id }, RA);
  check(as.status === 200, '«إسناد» to a team member', as.text.slice(0, 120));
  const bl = await c.rpc('hub_block_number', { p_conversation: W.id, p_blocked: true }, MG);
  const ub = await c.rpc('hub_block_number', { p_conversation: W.id, p_blocked: false }, MG);
  check(bl.status === 200 && ub.status === 200, '«حظر الرقم» and its undo', `${bl.text.slice(0, 80)} ${ub.text.slice(0, 80)}`);
  const th = await c.rpc('hub_thread', { p_conversation: A.id }, RA);
  const evs = JSON.stringify(th.json ?? {});
  check(th.status === 200 && /سأتصل بالضيف/.test(evs) && /"owner"/.test(evs), 'the thread shows the note and the events', evs.slice(0, 200));

  // ── 3. sending through hub-admin (test mode) ──
  const badge0 = (await c.rpc('hub_inbox_badge', { p_test: true }, RA)).json;
  const key = randomUUID();
  const s1 = await c.fn('hub-admin', { action: 'send', conversation: A.id, mode: 'text', body: 'أهلًا بك، نعم المواقف مجانية.', key }, RA);
  check(s1.status === 200 && s1.json?.ok && s1.json.results?.[0]?.status === 'test', 'a text inside the window: sent in test mode', s1.text.slice(0, 200));
  const s1b = await c.fn('hub-admin', { action: 'send', conversation: A.id, mode: 'text', body: 'أهلًا بك، نعم المواقف مجانية.', key }, RA);
  check(s1b.json?.existing === true, 'the same press twice sends nothing twice', s1b.text.slice(0, 160));
  const A2 = await conv(PH.a);
  const badge1 = (await c.rpc('hub_inbox_badge', { p_test: true }, RA)).json;
  check(A2.waiting_since === null && badge1 === badge0 - 1, 'the reply clears the waiting and the badge', `${A2.waiting_since} ${badge0}→${badge1}`);
  await c.rest(`/rest/v1/hub_conversations?id=eq.${D.id}`, { method: 'PATCH', body: { window_expires_at: new Date(Date.now() - 3600e3).toISOString() } });
  const s2 = await c.fn('hub-admin', { action: 'send', conversation: D.id, mode: 'text', body: 'نص بعد النافذة', key: randomUUID() }, MG);
  check(s2.json?.ok === false && s2.json.error === 'hub_window_closed', 'outside the window a free text is refused', s2.text.slice(0, 160));
  const s3 = await c.fn('hub-admin', { action: 'send', conversation: D.id, mode: 'held', body: 'ردّنا عليك: نعم.', key: randomUUID(), language: 'ar' }, MG);
  const held = await c.rest(`/rest/v1/hub_messages?select=status,kind&conversation_id=eq.${D.id}&author=eq.staff&order=created_at`);
  check(s3.json?.ok && held.json?.some((m) => m.status === 'held') && held.json.some((m) => m.kind === 'template' && m.status === 'test'), '«إرسال عند رد الضيف»: the template now (test), the answer held', `${s3.text.slice(0, 120)} ${held.text.slice(0, 160)}`);
  await inbound(PH.d, 'متابعة المحادثة');
  const hc = await c.rpc('hub_held_claim', { p_conversation: D.id });
  const hc2 = await c.rpc('hub_held_claim', { p_conversation: D.id });
  check((hc.json?.messages ?? []).length === 1 && (hc2.json?.messages ?? []).length === 0, 'the guest writes: the held answer is claimed once', `${hc.text.slice(0, 160)} | ${hc2.text.slice(0, 80)}`);
  const cB = restore.channels.find((x) => x.address === '+966536663030');
  await c.rpc('hub_channel_sending_set', { p_channel: cB.id, p_on: false }, MG);
  const s4 = await c.fn('hub-admin', { action: 'send', conversation: B.id, mode: 'text', body: 'رد', key: randomUUID() }, RS);
  check(s4.json?.ok === false && s4.json.error === 'hub_sending_off', 'a number with «الإرسال من المركز» off sends nothing', s4.text.slice(0, 160));

  // ── 4. a reply from the phone ──
  const W1 = await inbound(PH.w, 'سؤال آخر');
  const before = (await conv(PH.w))?.waiting_since;
  const ec = await c.rpc('hub_ingest_echo', { p: { channel: '+966536622277', phone: PH.w, provider_id: `E2E-ECHO-${RUN}`, sent_at: new Date().toISOString(), kind: 'text', body: 'نعم', is_test: true } });
  const Wn = await conv(PH.w);
  check(W1.json?.stored && before && ec.json?.stored && Wn.waiting_since === null && Wn.owner_kind === 'phone', 'a reply from the phone: no longer waiting, owner «الجوال»', `${ec.text.slice(0, 120)}`);
  const lw = await c.rpc('hub_inbox_list', { p: { tab: 'waiting' } }, RA);
  check(!(lw.json?.rows ?? []).some((x) => x.id === Wn.id), '… out of «بانتظار موظف»');

  // ── 5. the viewer ──
  const vl = await c.rpc('hub_inbox_list', { p: { tab: 'all' } }, V);
  check(vl.status === 200 && (vl.json?.rows ?? []).some((x) => x.id === A.id), 'the viewer reads the list');
  const vt = await c.rpc('hub_take_over', { p_conversation: A.id }, V);
  const vs = await c.fn('hub-admin', { action: 'send', conversation: A.id, mode: 'text', body: 'x', key: randomUUID() }, V);
  check(vt.status >= 400 && (vs.status === 403 || vs.json?.ok === false), 'the viewer never acts, never sends', `${vt.status} ${vs.status} ${vs.text.slice(0, 80)}`);
  const cl = await c.rpc('hub_close', { p_conversation: A.id }, RA);
  check(cl.status === 200 && (await c.rest(`/rest/v1/hub_conversations?select=state&id=eq.${A.id}`)).json?.[0]?.state === 'closed', '«إغلاق المحادثة»');

  // ── 6. the page ──
  let up = false;
  try {
    up = (await fetch(`${BASE}/login`)).ok;
  } catch { /* not running */ }
  check(up, `the dashboard dev server answers at ${BASE} (vite --mode branch)`);
  if (up) {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const { ctx, page } = await browserLogin(browser, K, c, BASE, U.recA);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await inbound(PH.e === PH.a ? PH.a : phone(6), 'سؤال من المتصفح');
      const P = await conv(phone(6));
      await page.goto(`${BASE}/inbox?tab=all&c=${P.id}`);
      await page.waitForSelector('[data-tour~="inbox-thread"]', { timeout: 30000 });
      await page.waitForFunction(() => document.body.innerText.includes('سؤال من المتصفح'), null, { timeout: 15000 });
      check(true, 'the thread opens from the address');
      const box = page.locator('[data-tour~="inbox-composer"] textarea').first();
      await page.waitForTimeout(500);
      await box.fill('أهلًا بك من الاستقبال');
      await page.locator('[data-action="send"]').first().click();
      await page.waitForFunction(() => document.body.innerText.includes('أهلًا بك من الاستقبال'), null, { timeout: 15000 }).catch(() => {});
      const sent = await c.rest(`/rest/v1/hub_messages?select=status&conversation_id=eq.${P.id}&author=eq.staff&kind=eq.text`);
      check(sent.json?.[0]?.status === 'test', 'a reply typed in the composer goes through hub-admin (test)', sent.text.slice(0, 120));
      await page.screenshot({ path: 'screenshots/hub/inbox-branch.png' }).catch(() => {});
      check(errors.length === 0, 'no page error', errors.join(' | '));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} catch (e) {
  check(false, `setup: ${e.message}`);
} finally {
  for (const p of [...Object.values(PH), phone(6)]) {
    const g = await c.rest(`/rest/v1/guest_profiles?select=id&phone=eq.${encodeURIComponent(p)}`);
    for (const row of g.json ?? []) {
      await c.rest(`/rest/v1/hub_conversations?guest_profile_id=eq.${row.id}`, { method: 'DELETE' });
      await c.rest(`/rest/v1/guest_profiles?id=eq.${row.id}`, { method: 'DELETE' });
    }
  }
  await c.rest('/rest/v1/hub_templates?is_test=eq.true', { method: 'DELETE' });
  if (restore) {
    if (U?.mgmt?.H) {
      for (const ch of restore.channels) await c.rpc('hub_channel_sending_set', { p_channel: ch.id, p_on: ch.sending_enabled }, U.mgmt.H);
      await c.rpc('hub_setting_set', { p_key: 'hub_inbox_on', p_value: restore.inbox }, U.mgmt.H);
    }
    for (const ch of restore.channels) await c.rest(`/rest/v1/hub_channels?id=eq.${ch.id}`, { method: 'PATCH', body: { verified_at: ch.verified_at } });
  }
  await dropUsers(c, U);
}
done();
