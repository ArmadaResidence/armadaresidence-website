// Guest Hub S1 (25 Nov 2026, Ahmed — DECISIONS.md 2026-11-25 «Guest Hub S1»): Instagram and Messenger direct messages,
// and data deletion on every channel — offline, FAST_CHECKS. No network: every fetch is a stub.
//   A the webhook: the verification challenge, the X-Hub-Signature-256 check on the raw body (valid / tampered / missing /
//     another secret), the events of Messenger and Instagram deliveries (text, quick reply, postback, attachment, echo with
//     and without our app id, delivery, read, deleted, unsupported, changes) — the mid kept for idempotency;
//   B the adapter: the hub's WhatsApp-shaped messages → Send API bodies (text ≤ 1,000 and split, quick replies ≤ 13 and
//     20 characters, a room card as ONE generic template with its postback and the full text before it when it does not
//     fit, the HUMAN_AGENT tag), typing_on alone, the Graph error codes, the Page token from /me/accounts;
//   C «احذف بياناتي» / “Delete my data” and its variants (and what is not one), on WhatsApp's router too, before the opt-out;
//   D the mobile number a guest writes (Saudi local forms, +, 00, Arabic-Indic digits), the machine's T11c and the engine's
//     brand-unit helpers (the branch question only when both branches' cards came back);
//   E the wiring: social-inbound (signature before anything, 200 then the work, our app id's echo ignored, the deletion
//     path with no turn), hub-agent / hub-admin by provider, config.toml, the migration = its generator (a WHERE on every
//     UPDATE / DELETE, no mode or licence set, no phone), the copy (copy.md §4.6 = text.generated.json), the deletion page.
import { readFileSync, existsSync } from 'node:fs';
import {
  GRAPH_VERSION, isDataDelete, metaError, pageToken, parseWebhook, phoneFromText, resetPageTokenCache, sendBodies, sendHub, signBody, typingBody, verifyChallenge, verifySignature,
} from '../supabase/functions/_shared/hub/meta.ts';
import { route } from '../supabase/functions/_shared/hub/webhook.ts';
import { bookingMissing, contactMissing } from '../supabase/functions/_shared/hub/machine.ts';
import { branchButtons, branchDepends } from '../supabase/functions/_shared/hub/engine.ts';
import { migration, OUT_PATH } from './hub-s1-migration.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const fails = [];
const check = (ok, what) => {
  n++;
  if (!ok) fails.push(what);
};

// ═══ A. the webhook ═══
{
  const q = (o) => new URLSearchParams(o);
  check(verifyChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok-123', 'hub.challenge': '1158201444' }), 'tok-123').challenge === '1158201444', 'A1 the challenge is answered with the right token');
  check(!verifyChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' }), 'tok-123').ok, 'A2 a wrong token is refused');
  check(!verifyChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1' }), undefined).ok, 'A3 no META_VERIFY_TOKEN → refused');
  check(!verifyChallenge(q({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1' }), 'tok').ok, 'A4 another mode is refused');
  check(!verifyChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '<script>' }), 'tok').ok, 'A5 a challenge that is not a token is never echoed');

  const raw = JSON.stringify({ object: 'page', entry: [{ id: '100000000000001', time: 1, messaging: [] }], note: 'äöå عربي' });
  const sig = await signBody(raw, 'app-secret');
  check(await verifySignature(new TextEncoder().encode(raw), sig, 'app-secret'), 'A6 a valid signature on the raw bytes passes');
  check(!(await verifySignature(new TextEncoder().encode(raw + ' '), sig, 'app-secret')), 'A7 one byte changed → refused');
  check(!(await verifySignature(raw, null, 'app-secret')), 'A8 no header → refused');
  check(!(await verifySignature(raw, sig, 'another')), 'A9 another secret → refused');
  check(!(await verifySignature(raw, sig, undefined)), 'A10 no META_APP_SECRET → refused (never let through)');
  check(!(await verifySignature(raw, 'sha1=abc', 'app-secret')), 'A11 a sha1 header is refused');

  const page = '100000000000001', ig = '17800000000000001', u = '9100000000000001', ts = 1764000000000;
  const ms = parseWebhook({ object: 'page', entry: [{ id: page, time: ts, messaging: [
    { sender: { id: u }, recipient: { id: page }, timestamp: ts, message: { mid: 'm_1', text: 'كم سعر الغرفة؟' } },
    { sender: { id: u }, recipient: { id: page }, timestamp: ts, message: { mid: 'm_2', text: 'طريق المطار', quick_reply: { payload: 'hubb:airport-road' } } },
    { sender: { id: u }, recipient: { id: page }, timestamp: ts, postback: { mid: 'm_3', title: 'احجز', payload: 'hub:book:d1:king-room:2' } },
    { sender: { id: u }, recipient: { id: page }, timestamp: ts, message: { mid: 'm_4', attachments: [{ type: 'image', payload: { url: 'https://scontent.example/x.jpg' } }] } },
    { sender: { id: page }, recipient: { id: u }, timestamp: ts, message: { mid: 'm_5', text: 'reply', is_echo: true, app_id: 2403025080470166 } },
    { sender: { id: page }, recipient: { id: u }, timestamp: ts, message: { mid: 'm_6', text: 'from inbox', is_echo: true, app_id: 263902037430900 } },
    { sender: { id: u }, recipient: { id: page }, timestamp: ts, delivery: { mids: ['m_5'], watermark: ts } },
    { sender: { id: u }, recipient: { id: page }, timestamp: ts, read: { watermark: ts } },
    { sender: { id: u }, recipient: { id: page }, timestamp: ts, message: { mid: 'm_7', attachments: [{ type: 'fallback', payload: { url: 'https://x' } }] } },
  ] }] });
  check(ms.length === 9 && ms[0].type === 'message' && ms[0].kind === 'messenger' && ms[0].channel === page && ms[0].user === u && ms[0].mid === 'm_1' && ms[0].msgKind === 'text',
    'A12 a Messenger text: the Page, the PSID, the mid');
  check(ms[1].msgKind === 'interactive' && ms[1].payload.button_id === 'hubb:airport-road' && ms[1].text === 'طريق المطار', 'A13 a quick reply: its payload is our button id, its text the title');
  check(ms[2].type === 'message' && ms[2].msgKind === 'interactive' && ms[2].payload.button_id === 'hub:book:d1:king-room:2' && ms[2].mid === 'm_3', 'A14 a card\'s postback: our id, its mid');
  check(ms[3].msgKind === 'image' && ms[3].media?.url === 'https://scontent.example/x.jpg', 'A15 an image attachment → image with its URL');
  check(ms[4].type === 'echo' && ms[4].appId === '2403025080470166' && ms[4].user === u && ms[5].type === 'echo' && ms[5].appId === '263902037430900', 'A16 echoes: the guest is the recipient, the app id kept (ours vs the inbox)');
  check(ms[6].type === 'status' && ms[6].status === 'delivered' && ms[6].mids[0] === 'm_5' && ms[7].type === 'status' && ms[7].status === 'read' && ms[7].watermark === String(ts),
    'A17 delivery by mids, read by watermark');
  check(ms[8].msgKind === 'unsupported' && ms[8].text === '' && !ms[8].media, 'A18 an attachment type we do not read → unsupported, nothing downloaded');
  const is = parseWebhook({ object: 'instagram', entry: [{ id: ig, time: ts, messaging: [
    { sender: { id: u }, recipient: { id: ig }, timestamp: ts, message: { mid: 'ig_1', text: 'Hello' } },
    { sender: { id: u }, recipient: { id: ig }, timestamp: ts, message: { mid: 'ig_2', is_deleted: true } },
    { sender: { id: u }, recipient: { id: ig }, timestamp: ts, message: { mid: 'ig_3', is_unsupported: true } },
    { sender: { id: ig }, recipient: { id: u }, timestamp: ts, message: { mid: 'ig_4', text: 'from the app', is_echo: true } },
  ] }], changes: [] });
  check(is[0].type === 'message' && is[0].kind === 'instagram' && is[0].channel === ig && is[1].type === 'other' && is[2].msgKind === 'unsupported'
    && is[3].type === 'echo' && is[3].appId === null && is[3].channel === ig, 'A19 Instagram: text, a deleted message ignored, unsupported, an app echo without app id');
  check(parseWebhook({ object: 'whatsapp_business_account', entry: [] })[0].type === 'other', 'A20 another object → other');
  const ch = parseWebhook({ object: 'instagram', entry: [{ id: ig, changes: [{ field: 'comments', value: {} }] }] });
  check(ch.length === 1 && ch[0].type === 'other' && ch[0].what === 'change:comments', 'A21 comments (S2, not subscribed) → logged by field only');
  check(parseWebhook({ object: 'page', entry: [{ id: page, messaging: [{ sender: { id: 'abc' }, recipient: { id: page }, message: { mid: 'x', text: 'y' } }] }] })[0].type === 'other',
    'A22 a sender that is not a numeric id is refused');
}

// ═══ B. the adapter ═══
{
  const u = '9100000000000001';
  const t = sendBodies(u, { body: 'مرحبًا' });
  check(t.length === 1 && t[0].recipient.id === u && t[0].messaging_type === 'RESPONSE' && t[0].message.text === 'مرحبًا', 'B1 text → one RESPONSE message');
  const long = Array.from({ length: 40 }, (_, i) => `سطر رقم ${i} في الرد الطويل.`).join('\n');
  const lp = sendBodies(u, { body: long });
  check(lp.length >= 2 && lp.every((b) => b.message.text.length <= 1000) && lp.map((b) => b.message.text).join('\n').replace(/\s+/g, '') === long.replace(/\s+/g, ''),
    'B2 a long text is split on line ends, every part ≤ 1,000, nothing lost');
  const q = sendBodies(u, { body: 'كيف نساعدك؟', buttons: [{ id: 'hubq:book', title: 'حجز إقامة' }, { id: 'hubq:question', title: 'لدي سؤال طويل جدًا جدًا جدًا' }, { id: 'hubq:team', title: 'التحدث مع موظف' }] });
  check(q.length === 1 && q[0].message.quick_replies.length === 3 && q[0].message.quick_replies[0].payload === 'hubq:book' && q[0].message.quick_replies.every((r) => r.content_type === 'text' && r.title.length <= 20),
    'B3 buttons → quick replies, the id as the payload, titles ≤ 20');
  const many = sendBodies(u, { body: 'x', buttons: Array.from({ length: 20 }, (_, i) => ({ id: `hub${i}`, title: `b${i}` })) });
  check(many[0].message.quick_replies.length === 13, 'B4 at most 13 quick replies');
  const card = sendBodies(u, { body: 'غرفة كينج\nالإجمالي 400 ريال\nتأكيد فوري', buttons: [{ id: 'hub:book:d1:king-room:1', title: 'احجز' }], header_image: 'https://armadaresidence.com/images/og/x.jpg' });
  const el = card[card.length - 1].message.attachment?.payload?.elements?.[0];
  check(card.length === 1 && card[0].message.attachment.payload.template_type === 'generic' && el.title === 'غرفة كينج' && el.subtitle === 'الإجمالي 400 ريال · تأكيد فوري'
    && el.image_url.startsWith('https://') && el.buttons[0].type === 'postback' && el.buttons[0].payload === 'hub:book:d1:king-room:1', 'B5 a room card → ONE generic template (image, title, subtitle, postback)');
  const big = sendBodies(u, { body: 'جناح بغرفتي نوم وصالة\nالإجمالي 1,240 ريالًا لثلاث ليالٍ شامل الضريبة\nطلب حجز — يؤكده الاستقبال لأن الإقامة تحتاج تنسيقًا\n60 م² · سريران', buttons: [{ id: 'hub:book:d1:2br:1', title: 'احجز' }], header_image: 'https://x/y.jpg' });
  check(big.length === 2 && typeof big[0].message.text === 'string' && big[0].message.text.includes('يؤكده الاستقبال') && big[1].message.attachment.payload.elements[0].subtitle.length <= 80,
    'B6 a card longer than 80 characters: the full text first, then the card (nothing of it lost)');
  const tag = sendBodies(u, { body: 'رد الفريق', tag: 'HUMAN_AGENT' });
  check(tag[0].messaging_type === 'MESSAGE_TAG' && tag[0].tag === 'HUMAN_AGENT', 'B7 a staff reply after 24 hours carries MESSAGE_TAG HUMAN_AGENT');
  let threw = false;
  try { sendBodies('+966500000000', { body: 'x' }); } catch { threw = true; }
  check(threw, 'B8 a phone is never a Meta recipient');
  check(JSON.stringify(typingBody(u)) === JSON.stringify({ recipient: { id: u }, sender_action: 'typing_on' }), 'B9 typing_on alone in its own request');
  check(metaError(400, { error: { code: 10, error_subcode: 2018278 } }) === 'window_closed' && metaError(401, { error: { code: 190 } }) === 'token'
    && metaError(403, { error: { code: 200 } }) === 'permission' && metaError(500, {}) === 'meta_down', 'B10 the Graph errors → short codes');
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/me/accounts')) return new Response(JSON.stringify({ data: [{ id: '100000000000001', access_token: 'PAGE-TOKEN' }] }), { status: 200 });
    return new Response(JSON.stringify({ recipient_id: u, message_id: `mid.${calls.length}` }), { status: 200 });
  };
  resetPageTokenCache();
  const tk = await pageToken('SYSTEM-TOKEN', '100000000000001', fake);
  check(tk === 'PAGE-TOKEN' && calls[0].url.includes(`/${GRAPH_VERSION}/me/accounts`), 'B11 the Page token from GET /me/accounts with the system user token');
  calls.length = 0;
  const r = await sendHub(u, { body: 'نص', buttons: [{ id: 'hubq:team', title: 'موظف' }] }, tk, { fetch: fake });
  check(r.accepted && r.messageId === 'mid.1' && calls.length === 1 && calls[0].url.endsWith('/me/messages') && calls[0].init.headers.Authorization === 'Bearer PAGE-TOKEN', 'B12 the send: POST /me/messages with the Page token, the mid kept');
  const t2 = await sendHub(u, { body: 'x' }, tk, { test: true, fetch: () => { throw new Error('no call in test'); } });
  check(t2.status === 'test' && !t2.messageId, 'B13 test mode never calls Meta');
  const nt = await sendHub(u, { body: 'x' }, undefined, { fetch: fake });
  check(!nt.accepted && nt.errorCode === 'no_token', 'B14 no token → failed, never sent');
}

// ═══ C. «احذف بياناتي» ═══
{
  for (const t of ['احذف بياناتي', 'احذفوا بياناتي', 'أرجو حذف بياناتي', 'ممكن تحذف بياناتي؟'.replace('تحذف', 'حذف'), 'امسح كل بياناتي', 'ابغى احذف بياناتي', 'Delete my data', 'please delete my data', 'Remove all my information', 'delete my conversations'])
    check(isDataDelete(t), `C1 a deletion request: ${t}`);
  for (const t of ['كم سعر الغرفة؟', 'احذف الحجز', 'Delete my booking', 'how do I delete my data from the app and also tell me about the parking and the breakfast hours please', 'بياناتي صحيحة', 'إلغاء'])
    check(!isDataDelete(t), `C2 not a deletion request: ${t}`);
  const club = JSON.parse(read('supabase/functions/booking-request/content.generated.json')).club_whatsapp;
  const m = { kind: 'text', text: 'احذف بياناتي', buttonId: null, buttonSource: null };
  check(route(m, club).kind === 'data_delete', 'C3 WhatsApp\'s router: «احذف بياناتي» → data_delete');
  check(route({ ...m, text: 'إيقاف' }, club).kind === 'optout' && route({ ...m, text: 'stop' }, club).kind === 'optout', 'C4 the opt-out words keep their effect');
}

// ═══ D. the phone and the brand unit ═══
{
  const cases = { '0551234567': '+966551234567', '551234567': '+966551234567', '+966 55 123 4567': '+966551234567', '00966551234567': '+966551234567', '٠٥٥١٢٣٤٥٦٧': '+966551234567',
    'رقمي +201001234567': '+201001234567', '12345': null, 'غرفة 205': null, '0123456789': null };
  for (const [t, want] of Object.entries(cases)) check(phoneFromText(t) === want, `D1 the phone of «${t}» → ${want}`);
  const f = { guest_name: 'سالم أحمد', branch: 'airport-road', check_in: '2026-12-10', check_out: '2026-12-12', adults: 2, breakfast: 'without' };
  check(contactMissing(f, { needs_phone: false }) === null && contactMissing(f, { needs_phone: true }) === 'phone' && contactMissing({ ...f, phone: '+966551234567' }, { needs_phone: true }) === null
    && contactMissing({ ...f, guest_name: '' }, { needs_phone: true }) === 'guest_name', 'D2 the name first, then the phone on Instagram / Messenger');
  check(bookingMissing({ check_in: 'x', check_out: 'y', adults: 2, breakfast: 'with' }, 'brand').includes('branch') && !bookingMissing({ check_in: 'x', check_out: 'y', adults: 2, breakfast: 'with' }, 'branch').includes('branch'),
    'D3 «السوشيال» asks the branch with the stay; a branch number never does');
  check(branchDepends({ cards: [{ branch: 'airport-road' }, { branch: 'shafa-road' }] }) && !branchDepends({ cards: [{ branch: null }, { branch: 'airport-road' }] }) && !branchDepends({ cards: [] }),
    'D4 the branch is asked only when both branches\' own cards came back');
  const content = JSON.parse(read('supabase/functions/booking-request/content.generated.json'));
  const bb = branchButtons(content, 'ar');
  check(bb.length === 2 && bb[0].id === 'hubb:airport-road' && bb[1].id === 'hubb:shafa-road' && bb.every((b) => b.title.length <= 20 && !b.title.includes('أرمادا')), 'D5 the branch quick replies: the short names, ≤ 20');
  const tx = JSON.parse(read('supabase/functions/_shared/hub/text.generated.json'));
  const c = tx.copy ?? tx;
  check(c.data_delete_ack.ar === 'وصلنا طلبك لحذف بياناتك، وسنبلغك هنا عند الانتهاء.' && c.data_delete_ack.en === "We've received your request to delete your data; we'll let you know here when it's done."
    && c.data_delete_done.ar === 'تم حذف بيانات محادثاتك معنا.' && c.data_delete_done.en === 'Your conversation data with us has been deleted.', 'D6 the two deletion lines word for word (Ahmed, S1)');
}

// ═══ E. the wiring ═══
{
  const si = read('supabase/functions/social-inbound/index.ts');
  const iv = si.indexOf('verifySignature(raw'), ip = si.indexOf('JSON.parse(new TextDecoder');
  check(iv > 0 && ip > iv, 'E1 social-inbound: the signature before the body is read');
  check(/rt\?\.waitUntil\) rt\.waitUntil\(work\)/.test(si) && si.indexOf('return Json(200, { ok: true });') > si.indexOf('waitUntil'), 'E2 200 at once, the work after it');
  check(/e\.appId && e\.appId === appId\(\)/.test(si), 'E3 our own echo (our app id) is never a staff reply');
  const dd = si.slice(si.indexOf('isDataDelete(e.text)'), si.indexOf('storeMedia(e,'));
  check(dd.includes('hub_data_delete_request') && dd.includes("'data_delete_ack'") && dd.includes('hubDataDeleteMail') && dd.includes('return {') && !dd.includes('queueTurn'),
    'E4 «احذف بياناتي»: the request, the acknowledgement, the email — and no turn');
  check(!/console\.(log|error|warn)\([^)]*(e\.text|e\.user|token|who\.name)/.test(si), 'E5 no log line carries a text, a user id, a name or a token');
  const ha = read('supabase/functions/hub-agent/index.ts');
  check(/ctx\.provider === 'meta'/.test(ha) && /metaSend\(/.test(ha) && /hub_social_branch_set/.test(ha), 'E6 hub-agent sends by provider and keeps the branch');
  const hd = read('supabase/functions/hub-admin/index.ts');
  check(/b\.provider === 'meta'\) return await deliverMeta/.test(hd) && /action === 'meta_setup'/.test(hd) && /action === 'data_delete'/.test(hd), 'E7 hub-admin: Meta delivery, the setup, the deletion');
  const setup = hd.slice(hd.indexOf('const PAGE_FIELDS'), hd.indexOf('async function dataDelete'));
  check(!/comments|feed|mention/.test(setup.split('async function metaSetup')[0]) && setup.includes("hub_social_overview") && setup.includes('system_admin'),
    'E8 the setup subscribes messaging fields only (no comment or feed field) and is the system admin\'s');
  check(!/console\.log\([^)]*(sys|secret|pageTk|verify)\b/.test(setup), 'E9 the setup never logs a token or the secret');
  const cfg = read('supabase/config.toml');
  check(/\[functions\.social-inbound\]\nverify_jwt = false/.test(cfg), 'E10 social-inbound is deployed with verify_jwt = false (its own signature)');
  const wa = read('supabase/functions/wa-automation/index.ts');
  check(wa.indexOf("r.kind === 'data_delete'") > 0 && wa.indexOf("r.kind === 'data_delete'") < wa.indexOf("if (r.kind === 'none' || r.kind === 'hub_button'"), 'E11 WhatsApp: the deletion before the assistant\'s turn');
  // the migration
  const sql = migration();
  check(existsSync(new URL(`../${OUT_PATH}`, import.meta.url)) && read(OUT_PATH) === sql, 'E12 the migration = its generator');
  const src = read('scripts/hub-s1-migration.src.sql');
  const updates = src.match(/\bupdate public\.[a-z_]+[\s\S]*?;/g) ?? [];
  check(updates.length > 0 && updates.every((u) => /\bwhere\b/.test(u)), 'E13 every UPDATE of the new SQL carries a WHERE');
  check(!/\bdelete from public\.(?!guest_profiles where id = g\.id)/.test(src), 'E14 no DELETE but the lost race\'s own new profile');
  check(!/assistant_mode = '(test|shadow|licensed)'|hub_licences\s+set|insert into public\.hub_licences/.test(src) && /'social', 'brand', 'السوشيال', 'Social', null, 'active', 'off'/.test(src),
    'E15 «السوشيال» is created OFF; no licence is written');
  check(!/\+9665\d{8}|\b05\d{8}\b/.test(sql), 'E16 no phone number in the migration');
  check(/hub_social_may_reply\(c\)/.test(sql) && /social_not_tester/.test(sql), 'E17 the turn queue keeps the audience (test accounts only)');
  // the deletion page
  const page = read('src/pages/[...lang]/data-deletion.astro');
  check(page.includes('noindex') && page.includes('contact.emails.info'), 'E18 the deletion page: noindex, the email from contact.json');
  check(read('astro.config.mjs').includes("'/data-deletion/'"), 'E19 the deletion page is out of the sitemap');
  const nav = read('src/components/Header.astro') + read('src/components/Footer.astro');
  check(!nav.includes('data-deletion'), 'E20 the deletion page is in no menu');
  const st = JSON.parse(read('content/site-texts.json')).data_deletion;
  check(st.title_ar === 'طلب حذف البيانات' && st.title_en === 'Data deletion request' && st.ways_ar.length === 2 && st.ways_en[0] === 'Send «Delete my data» in the same conversation.', 'E21 the page copy = Ahmed\'s');
}

// ═══ E2. S1b — «السوشيال» by its own lab and licences ═══
{
  const s1b = await import('./hub-s1b-migration.mjs');
  const sql = s1b.migration();
  check(read(s1b.OUT_PATH) === sql, 'E22 the S1b migration = its generator');
  check(!/kind = 'brand' then coalesce\(\(select bool_and/.test(sql) && !/most restrictive of the active branch units/.test(sql.split('-- S1b: every unit by its OWN licences')[1] ?? 'x'),
    'E23 no brand special case left in the lab gate or the claim\'s licences');
  check(!/insert into public\.hub_licences|update public\.hub_licences|assistant_mode\s*=/.test(sql), 'E24 S1b writes no licence and no mode');
  const items = s1b.socialItems();
  check(items.length === 8 && items.every((i) => i.unit === 'social' && i.expect?.action === 'conversation'), 'E25 the eight social engine conversations become lab items');
  check(/'kind', ch\.kind, 'provider', ch\.provider/.test(sql), 'E26 the lab context carries the channel\'s kind and provider');
  // Ahmed's licences of 25 Nov 2026: 46 auto, booking_status and wifi stay «بموافقة الفريق», the always-team topics untouched
  const lic = read('supabase/migrations/20261125300000_guest_hub_social_licences.sql');
  const keys = [...(lic.match(/v_keys text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  check(keys.length === 46 && new Set(keys).size === 46 && !keys.includes('booking_status') && !keys.includes('wifi'), 'E27 the social licences: 46 topics, never «حالة حجز» or «الواي فاي»');
  check(/where l\.unit_id = v_unit and l\.mode = 'shadow'/.test(lic) && /not exists \(select 1 from public\.hub_topics t where t\.key = l\.topic_key and t\.always_handoff\)/.test(lic)
    && /if v_n <> 46 then raise exception/.test(lic) && !/assistant_mode/.test(lic), 'E28 only the social unit\'s shadow rows, never an always-team topic, exactly 46, no mode change');
}

// ═══ E3. S1c — the Messenger greeting, test accounts' alerts ═══
{
  const { quickReplies } = await import('../supabase/functions/_shared/hub/copy.ts');
  const { alertVars } = await import('../supabase/functions/_shared/hub/staff.ts');
  const q = quickReplies('brand', 'ar');
  check(Array.isArray(q) && q.length === 3 && q[0].id === 'hubq:book', 'E29 «السوشيال» (kind brand) gets the branch\'s three quick replies — the 21:41 crash');
  const v = alertVars({ token: 't', branch_name: 'أرمادا ريزيدنس – طريق المطار', guest_name: null, guest_phone: null, ref: null, summary: null, reason: 'handoff', channel_kind: 'messenger' });
  check(v[2] === 'حساب ماسنجر' && alertVars({ token: 't', branch_name: 'x', guest_name: null, guest_phone: '+966551234567', ref: null, summary: null, reason: 'handoff' })[2] === '+966 55 123 4567',
    'E30 the staff alert names the channel for a social guest; a phone as before');
  const s1c = await import('./hub-s1c-migration.mjs');
  const sql = s1c.migration();
  check(read(s1c.OUT_PATH) === sql, 'E31 the S1c migration = its generator');
  const tq = sql.slice(sql.indexOf('create or replace function internal.hub_handoff_queue'), sql.indexOf('create or replace function internal.hub_extra_alert'));
  check(tq.indexOf('hub_tester_conversation(h.conversation_id)') > 0 && tq.indexOf('hub_tester_conversation(h.conversation_id)') < tq.indexOf('from public.hub_staff_slots s')
    && /return v_n;\n  end if;\n  if p_kind = 'alert' then/.test(tq), 'E32 a test account\'s hand-off alerts the system admin only — before any slot is read');
  check(/if internal\.hub_tester_conversation\(r\.id\) then\n\s+v_to := array\(select u\.email from public\.staff s join auth\.users u/.test(sql), 'E33 its waiting email goes to the active admins only');
  check(/coalesce\(u\.branch_slug, c\.branch_slug, 'airport-road'\)/.test(sql), 'E34 a social chat booking request alerts a branch (it alerted nobody)');
  const ha = read('supabase/functions/hub-agent/index.ts');
  check(/early && claim\.channel\?\.provider !== 'meta' \? typing\(lastIn\)/.test(ha), 'E35 no YCloud typing call for a Meta channel (the 404s of 21:41)');
  const en = read('supabase/functions/_shared/hub/engine.ts');
  const add = en.slice(en.indexOf("case 'handoff_add': {"), en.indexOf("case 'partner_enquiry': {"));
  check(/else if \(!ackDone && !noticeOpen\) push\(fixed\(/.test(add) && add.indexOf('!noticeOpen') < add.indexOf('waitingLine()'),
    'E36 an addition to a hand-off whose notice never went sends the notice (the silent «شامبو» of 21:55)');
}

// ═══ F. the daily report's {{2}} ═══
{
  const { conversationsText } = await import('../supabase/functions/_shared/hub/staff.ts');
  const b = { 'airport-road': { conversations: 20 }, 'shafa-road': { conversations: 5 } };
  check(conversationsText({ branches: b, channels: { whatsapp: 25, instagram: 6, messenger: 3 } }) === 'المطار 20 · الشفا 5 (واتساب 25، انستجرام 6، ماسنجر 3)', 'F1 the split by channel inside {{2}}');
  check(conversationsText({ branches: b, channels: { whatsapp: 25, instagram: 0, messenger: 0 } }) === 'المطار 20 · الشفا 5' && conversationsText({ branches: b }) === 'المطار 20 · الشفا 5',
    'F2 no social conversation → {{2}} exactly as before');
}

if (fails.length) {
  console.error(`hub-social-check: ${fails.length} of ${n} failed`);
  for (const f of fails) console.error('  ✗', f);
  process.exit(1);
}
console.log(`hub-social-check: ${n} checks passed`);
