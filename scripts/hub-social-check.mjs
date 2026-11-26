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
  // S2 (26 Nov 2026): the comment changes are comments.ts's — meta.ts leaves them out (no «not read» line)
  check(ch.length === 0, 'A21 a comment change is left to comments.ts (S2)');
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
  // S2: the messaging fields first (PAGE_FIELDS / IG_FIELDS — no comment field in them), the comment fields in their own steps
  const head = setup.split('async function metaSetup')[0];
  check(!/comments|feed|mention/.test(head.split('// S2 (26 Nov 2026): the comment fields')[0]) && setup.includes("hub_social_overview") && setup.includes('system_admin'),
    'E8 the messaging subscriptions carry no comment field (those are their own steps, S2) and the setup is the system admin\'s');
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
  // S1d (test message 7, 22:56): the acknowledgement's Instagram echo (no app id) was stored as a staff reply
  const s1d = await import('./hub-s1d-migration.mjs');
  const dsql = s1d.migration();
  check(read(s1d.OUT_PATH) === dsql, 'E37 the S1d migration = its generator');
  const si = read('supabase/functions/social-inbound/index.ts');
  const sf = si.slice(si.indexOf('async function sendFixed('), si.indexOf('const langOf'));
  check(sf.indexOf("'hub_social_fixed_begin'") > 0 && sf.indexOf("'hub_social_fixed_begin'") < sf.indexOf('sendHub(') && sf.indexOf("'hub_social_fixed_done'") > sf.indexOf('sendHub('),
    'E38 a fixed social message is recorded before it is sent, its id after');
  const echo = dsql.slice(dsql.indexOf('create or replace function public.hub_ingest_social_echo'), dsql.indexOf('create or replace function public.hub_data_delete'));
  check(echo.indexOf("'reason', 'ours'") > 0 && echo.indexOf("'reason', 'ours'") < echo.indexOf("insert into public.hub_messages") && /x\.author <> 'phone' and x\.provider_message_id is null/.test(echo)
    && /interval '2 minutes'/.test(echo), 'E39 an echo with our own text of the last 2 minutes (no id yet) is ours — before any staff row');
  const dl = dsql.slice(dsql.indexOf('create or replace function public.hub_data_delete'));
  check(/set state = 'closed'[\s\S]*?where guest_profile_id = g\.id and state <> 'closed';/.test(dl) && /'close', x\.state, 'closed', auth\.uid\(\), 'data_delete'/.test(dl)
    && dl.indexOf("set state = 'closed'") > dl.indexOf("'delete:' || v_batch"), 'E40 «حذف بيانات المحادثات» closes the guest\'s open conversations (after the done line is queued)');
  const ups = dsql.match(/\bupdate public\.[a-z_]+[\s\S]*?;/g) ?? [];
  check(ups.length > 0 && ups.every((u) => /\bwhere\b/.test(u)) && !/\+9665\d{8}|\b05\d{8}\b/.test(dsql) && !/assistant_mode|hub_licences/.test(dsql), 'E41 S1d: every UPDATE with a WHERE, no phone, no mode or licence');
}

// ═══ F. the daily report's {{2}} ═══
{
  const { conversationsText } = await import('../supabase/functions/_shared/hub/staff.ts');
  const b = { 'airport-road': { conversations: 20 }, 'shafa-road': { conversations: 5 } };
  check(conversationsText({ branches: b, channels: { whatsapp: 25, instagram: 6, messenger: 3 } }) === 'المطار 20 · الشفا 5 (واتساب 25، انستجرام 6، ماسنجر 3)', 'F1 the split by channel inside {{2}}');
  check(conversationsText({ branches: b, channels: { whatsapp: 25, instagram: 0, messenger: 0 } }) === 'المطار 20 · الشفا 5' && conversationsText({ branches: b }) === 'المطار 20 · الشفا 5',
    'F2 no social conversation → {{2}} exactly as before');
}

// ═══ G. S2a (26 Nov 2026): both branches while the branch is unknown; the bathroom amenities card ═══
{
  const s2a = await import('./hub-s2a-migration.mjs');
  const sql = s2a.migration();
  check(read(s2a.OUT_PATH) === sql, 'G1 the S2a migration = its generator');
  const hq = sql.slice(sql.indexOf('create or replace function internal.hub_handoff_queue'), sql.indexOf('create or replace function internal.hub_extra_alert'));
  check(hq.indexOf('hub_tester_conversation(h.conversation_id)') > 0 && hq.indexOf('hub_tester_conversation(h.conversation_id)') < hq.indexOf('if h.both_branches then')
    && hq.indexOf('if h.both_branches then') < hq.indexOf('from public.hub_staff_slots s'), 'G2 a test account first (the system admin only), then both branches, then the one branch');
  const ba = sql.slice(sql.indexOf('create or replace function internal.hub_both_alert'), sql.indexOf('create or replace function internal.hub_social_owner_before'));
  check(/internal\.hub_branch_channel\(s\.branch_slug\)/.test(ba) && /hub_slot_covers\(s, p_now\)/.test(ba) && /s\.role = 'manager'/.test(ba),
    'G3 both branches\' slots on shift, each from its own branch number; nobody on shift → the managers');
  check(/new\.branch_slug := \(select s\.branch from public\.staff s/.test(sql) && /when \(old\.branch_slug is null and new\.branch_slug is not null\)/.test(sql),
    'G4 the first staff member to take it gives it their branch; the branch known ends the both-branches hand-off');
  check(!/internal\.can_unit\(c\.unit_id, 'view'\)\s*\n\s*and \(g\.hub_blocked_at/.test(sql) && /internal\.can_conv\(c, 'edit'\)/.test(sql)
    && /hub_conversations_read on public\.hub_conversations for select to authenticated using \(internal\.can_conv_id\(id, 'view'\)\)/.test(sql),
    'G5 the inbox, the thread, the actions and RLS read the conversation-level check');
  const ups = sql.match(/\bupdate public\.[a-z_]+[\s\S]*?;/g) ?? [];
  check(ups.length > 0 && ups.every((u) => /\bwhere\b/.test(u)) && !/\+9665\d{8}|\b05\d{8}\b/.test(sql) && !/assistant_mode =|hub_licences/.test(sql), 'G6 S2a: every UPDATE with a WHERE, no phone, no mode or licence');
  check(sql.includes(s2a.CARD.text_ar) && sql.includes(s2a.CARD.text_en.replace(/'/g, "''")) && /where not exists \(select 1 from public\.hub_knowledge_cards k where k\.text_ar like '%شامبو%'/.test(sql),
    'G7 the card in Ahmed\'s exact words, never a duplicate');
  const { alertVars, BOTH_BRANCHES_NAME } = await import('../supabase/functions/_shared/hub/staff.ts');
  check(alertVars({ token: 't', branch_name: 'x', guest_name: null, guest_phone: null, ref: null, summary: null, reason: 'handoff', channel_kind: 'instagram', both: true })[0] === BOTH_BRANCHES_NAME,
    'G8 the alert of a both-branches hand-off says so in {{1}}');
}

// ═══ H. S2 (26 Nov 2026): comments ═══
{
  const cm = await import('../supabase/functions/_shared/hub/comments.ts');
  const t = Math.floor(Date.now() / 1000);
  const ig = { object: 'instagram', entry: [{ id: '17800000000000001', time: t, changes: [
    { field: 'comments', value: { from: { id: '5550001', username: 'qa.user' }, id: '18000000000000001', text: 'بكم الليلة؟', media: { id: '18100000000000001', media_product_type: 'FEED' } } },
    { field: 'comments', value: { from: { id: '5550002', username: 'qa.two' }, id: '18000000000000002', parent_id: '18000000000000001', text: 'رد', media: { id: '18100000000000001', ad_id: '77', media_product_type: 'AD' } } },
    { field: 'mentions', value: { media_id: '1' } }] }] };
  const fb = { object: 'page', entry: [{ id: '100000000000001', time: t, changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '200_300', parent_id: '100000000000001_200', post_id: '100000000000001_200', from: { id: '6660001', name: 'QA Person' }, message: 'Do you have parking?', created_time: t } },
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '200_301', parent_id: '200_300', post_id: '100000000000001_200', from: { id: '6660002', name: 'QA Two' }, message: 'me too', created_time: t } },
    { field: 'feed', value: { item: 'reaction', verb: 'add', post_id: '100000000000001_200' } }] }] };
  const a = cm.parseComments(ig);
  check(a.length === 2 && a[0].kind === 'instagram' && a[0].comment_id === '18000000000000001' && !a[0].parent_id && a[0].post_id === '18100000000000001' && a[0].from_name === 'qa.user'
    && a[1].parent_id === '18000000000000001' && a[1].ad, 'H1 Instagram comments: the comment, a reply (parent_id) and an ad comment; mentions left out');
  const b = cm.parseComments(fb);
  check(b.length === 2 && b[0].kind === 'facebook' && !b[0].parent_id && b[0].text === 'Do you have parking?' && b[1].parent_id === '200_300',
    'H2 Page feed comments: a top-level comment (parent = the post) is no reply; a reply to a comment is; reactions left out');
  const { parseWebhook } = await import('../supabase/functions/_shared/hub/meta.ts');
  check(parseWebhook(ig).every((e) => e.type !== 'other' || !/change:comments/.test(e.what)) && parseWebhook(ig).some((e) => e.type === 'other' && e.what === 'change:mentions')
    && !parseWebhook(fb).some((e) => e.type === 'other' && /feed/.test(e.what ?? '') && false), 'H3 meta.ts leaves the comment changes to comments.ts (others logged by field)');
  const base = { channel: '17800000000000001', from_id: '5550001', parent_id: null, created_at: new Date().toISOString(), live: false, verb: 'add', text: 'سؤال' };
  check(cm.codeSkip(base) === null && cm.codeSkip({ ...base, from_id: base.channel }) === 'own' && cm.codeSkip({ ...base, parent_id: '1234567' }) === null
    && cm.codeSkip({ ...base, created_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }) === 'too_old' && cm.codeSkip({ ...base, verb: 'edited' }) === 'not_new'
    && cm.codeSkip({ ...base, live: true }) === 'live' && cm.codeSkip({ ...base, text: ' ' }) === 'empty', 'H4 the code rules: own, older than 7 days, edits, live, empty — a reply in a thread is not skipped by code (S2e, SOCIAL-SPEC §5.1)');
  check(cm.parseClass('{"class":"price","language":"ar","argument":false}')?.class === 'price' && cm.parseClass('{"class":"angry","language":"ar"}') === null
    && cm.parseClass('x') === null && cm.parseClass('{"class":"praise","language":"de"}') === null, 'H5 the classifier\'s answer: known classes and languages only');
  check(cm.publicGuard('سعدنا بسؤالك، أرسلنا لك التفاصيل في رسالة خاصة.') === null && cm.publicGuard('الليلة 250') === 'digit' && cm.publicGuard('الليلة ٢٥٠') === 'digit'
    && cm.publicGuard('بخمسين ريال') === 'price' && cm.publicGuard('From SAR') === 'price' && cm.publicGuard('only $') === 'price' && cm.publicGuard('خصم %') === 'price'
    && cm.publicGuard('يبدأ من') === 'price' && cm.publicGuard('www.x.com') === 'link' && cm.publicGuard('We sent you the prices in a message.') === null,
    'H6 S4 — the public reply\'s guard: no digit of any script, no currency, no «from» price, no link (the word «prices» alone passes)');
  const T = { public: { question: { ar: ['سؤال أ', 'سؤال ب'], en: ['question a'] }, price: { ar: ['سعر أ'], en: ['price a'] }, complaint: { ar: ['شكوى أ'], en: ['complaint a'] },
                        praise: { ar: ['شكر أ', 'شكر ب', 'شكر ج'], en: ['thanks a'] } } };
  check(cm.textsProblems(T).length === 0 && cm.textsProblems(null)[0] === 'missing' && cm.textsProblems({ ...T, public: { ...T.public, price: { ar: ['250 ريال'], en: ['p1'] } } }).some((x) => /price\.ar\.0:digit/.test(x)),
    'H7 the texts\' readiness: every class in both languages, the guard on each variant (no fixed private text — S2e)');
  const q = cm.plan('question', 'ar', false, T, 0, true, false);
  const q2 = cm.plan('question', 'ar', false, T, 1, true, false);
  const pr = cm.plan('price', 'en', false, T, 0, true, false);
  const co = cm.plan('complaint', 'ar', false, T, 0, true, false);
  const pa = cm.plan('praise', 'ar', false, T, 4, true, false);
  const sp = cm.plan('spam', 'ar', false, T, 0, true, false);
  const ot = cm.plan('price', 'other', false, T, 0, true, false);
  const off = cm.plan('question', 'ar', false, T, 0, false, false);
  const ts = cm.plan('question', 'ar', false, T, 0, true, true);
  const notice = (L) => JSON.parse(read('supabase/functions/_shared/hub/text.generated.json')).copy.complaint[L];
  check(q.state === 'replied' && q.public.text === 'سؤال أ' && q.private.source === 'answer' && q.private.language === 'ar' && !q.private.text && !q.handoff && q2.public.text === 'سؤال ب',
    'H8 a question → a public reply (rotating the variants) + the private message = the assistant answer (S2e, SOCIAL-SPEC §5.3)');
  check(pr.public.text === 'price a' && pr.private.source === 'answer' && co.state === 'handed_off' && co.handoff && co.public.text === 'شكوى أ'
    && co.private.source === 'complaint' && co.private.text === notice('ar')
    && pa.public.text === 'شكر ب' && !pa.private && sp.state === 'review' && !sp.public, 'H9 price → the same; complaint → the apology + the hand-off notice in private + the team; praise → thanks only; spam → review, nothing');
  const coOff = cm.plan('complaint', 'ar', false, T, 0, false, false);
  const ours = cm.plan('question', 'ar', false, T, 0, true, false, true);
  check(!ot.public && ot.private.source === 'answer' && ot.private.language === 'en' && off.state === 'review' && off.reason === 'private_off' && !off.public
    && coOff.handoff && !coOff.public && !coOff.private && ts.state === 'test' && cm.plan('question', 'ar', true, T, 0, true, false).state === 'skipped'
    && cm.plan('other', 'ar', false, T, 0, true, false).state === 'skipped' && !ours.public && ours.private.source === 'answer',
    'H10 another language → the private answer in English only; private off → no public text naming a private message (a question to review, a complaint to the team); «تجربة» → planned; an argument / other → skipped; under our own reply → no public reply');
  check(cm.gradeComment({ action: 'comment', class: 'price', public: true, private: true, handoff: false }, { class: 'price', plan: pr }).pass
    && !cm.gradeComment({ action: 'comment', class: 'price' }, { class: 'question', plan: q }).pass && cm.gradeComment({ action: 'comment', skip: 'thread' }, { class: null, plan: null, skip: 'thread' }).pass
    && !cm.gradeComment({ action: 'comment', skip: 'thread' }, { class: 'other', plan: null, skip: null }).pass, 'H11 the lab\'s grading of a comment item');
  // the Graph calls on a stub: the paths, the guard before any call, the private reply's recipient
  const calls = [];
  const f = async (u, init) => { calls.push([String(u), init?.body ? JSON.parse(init.body) : null]); return new Response(JSON.stringify(/messages$/.test(String(u)) ? { recipient_id: '7770001', message_id: 'm1' } : { id: '9990001' }), { status: 200 }); };
  const r1 = await cm.replyPublic('instagram', '18000000000000001', 'شكرًا لك', 'tk', { fetch: f });
  const r2 = await cm.replyPublic('facebook', '200_300', 'Thank you', 'tk', { fetch: f });
  const r3 = await cm.replyPublic('instagram', '18000000000000001', 'الليلة 250', 'tk', { fetch: f });
  const r4 = await cm.replyPrivate('200_300', 'hello', 'tk', { fetch: f });
  check(r1.ok && /\/18000000000000001\/replies$/.test(calls[0][0]) && r2.ok && /\/200_300\/comments$/.test(calls[1][0]) && !r3.ok && r3.code === 'guard_digit' && calls.length === 3
    && r4.ok && r4.recipient === '7770001' && calls[2][1].recipient.comment_id === '200_300' && /\/me\/messages$/.test(calls[2][0]),
    'H12 Graph: Instagram /replies, Facebook /comments, the guard refuses before any call, the private reply by comment_id with its recipient');
  const s2b = await import('./hub-s2b-migration.mjs');
  const sql = s2b.migration();
  check(read(s2b.OUT_PATH) === sql, 'H13 the S2 comments migration = its generator');
  check(/comments_on boolean not null default false/.test(sql) && /comment_private_on boolean not null default false/.test(sql) && /check \(not comment_private_on or comments_on\)/.test(sql)
    && /if not internal\.is_system_admin\(\) then raise exception 'hub_system_admin_only'[\s\S]*?hub_comment_switch_set|hub_comment_switch_set[\s\S]*?if not internal\.is_system_admin\(\)/.test(sql)
    && /if p_comments and not ch\.comments_on and not internal\.hub_comment_texts_ready\(\) then raise exception 'hub_comment_texts'/.test(sql),
    'H14 two switches per channel, both OFF, the system admin\'s; «التعليقات» refused before Ahmed\'s texts');
  check(/insert into public\.hub_comment_texts \(id, texts\) values \(1, null\)/.test(sql) && !/texts\) values \(1, '\{/.test(sql), 'H15 no comment text is written by this migration (Ahmed\'s, word for word, later)');
  check(/elsif u\.social_mode = 'test' and not v_tester then v_skip := 'not_tester'/.test(sql) && /u\.assistant_mode = 'off' then v_skip := 'unit_off'/.test(sql)
    && /c\.staff_answered_at is not null then 'staff_answered'/.test(sql), 'H16 under the unit\'s mode and audience; a thread a staff member answered is skipped');
  check(/hub_tester_conversation\(h\.conversation_id\) or internal\.hub_tester_comment\(h\.comment_id\)/.test(sql) && /'comment_complaint'/.test(sql) && /not c\.tester\);/.test(sql),
    'H17 a complaint → the comment\'s hand-off to both branches; a test account\'s → the system admin only');
  const ups = sql.match(/\bupdate public\.[a-z_]+[\s\S]*?;/g) ?? [];
  check(ups.length > 0 && ups.every((u) => /\bwhere\b/.test(u)) && !/\+9665\d{8}|\b05\d{8}\b/.test(sql) && !/update public\.hub_units|update public\.hub_licences/.test(sql), 'H18 S2: every UPDATE with a WHERE, no phone, no mode, licence or audience changed');
  check(/hide|delete from public\.hub_comments/.test(sql) === false || !/\/hide|is_hidden = true/.test(sql), 'H19 nothing hidden or deleted on Meta');
  const si = read('supabase/functions/social-inbound/index.ts');
  check(/for \(const c of parseComments\(body\)\)/.test(si) && /codeSkip\(e\)/.test(si) && /'hub_comment_ingest'/.test(si) && /action: 'comment', comment: ing\.data\.id/.test(si),
    'H20 social-inbound: the comments stored with the code rules, then hub-agent');
  const ha = read('supabase/functions/hub-agent/index.ts');
  check(/body\.action === 'comment'/.test(ha) && /'hub_comments_due'/.test(ha) && /action === 'comment'\) \{\n\s+const m = String\(ctx\.settings\?\.models\?\.tag/.test(ha), 'H21 hub-agent: the comment, the sweep and the lab\'s comment items');
  const cr = read('supabase/functions/_shared/hub/comment-run.ts');
  check(cr.indexOf("'hub_social_fixed_begin'") > cr.indexOf("'hub_ingest_social'") && /replyPublic\(kind, cm\.comment_id, pl\.public\.text/.test(cr) && !/console\.log\([^)]*body/.test(cr),
    'H22 the private message opens the DM (recorded before its echo — S1d); no comment words logged');
  const adm = read('supabase/functions/hub-admin/index.ts');
  check(/step: `app:\$\{object\}:comments`/.test(adm) && /PAGE_COMMENT_FIELDS = \['feed'\]/.test(adm) && /IG_COMMENT_FIELDS = \['comments'\]/.test(adm)
    && adm.indexOf("if (!steps.every((s) => s.ok)) return json(req, 200, { ok: false, error: 'hub_meta_subscribe', steps });") < adm.indexOf('app:${object}:comments')
    && /const g = publicGuard\(text\);/.test(adm), 'H23 hub-admin: the comment subscriptions after the messaging ones (their own steps); a staff public reply through the guard');
  {
    // S2 (26 Nov 2026, Meta's dashboard test webhook): its sample (account «0») is dropped, but never silently
    const igSample = { object: 'instagram', entry: [{ id: '0', time: 1, changes: [{ field: 'comments', value: { from: { id: '232323232', username: 'test' }, media: { id: '123123123' }, id: '17865799348089039', text: 'This is an example.' } }] }] };
    check(cm.parseComments(igSample).length === 0 && JSON.stringify(cm.unreadComments(igSample)) === '["instagram:ids"]' && cm.unreadComments(ig).length === 0
      && /comment not read', why/.test(read('supabase/functions/social-inbound/index.ts')), 'H31 a comment change that cannot be read is logged by its reason only (the Meta sample with account «0»)');
  }
  // S2 (26 Nov 2026, Ahmed): the app-level comment fields are READ BACK — a step is ✓ only when Meta lists the field
  {
    const fnSrc = adm.slice(adm.indexOf('export function appFieldsListed'), adm.indexOf('async function metaSetup'));
    const appFieldsListed = new Function('j', 'object', 'callback', 'fields', fnSrc.slice(fnSrc.indexOf('{') + 1, fnSrc.lastIndexOf('}')).replace(/: AnyJ/g, ''));
    const cb = 'https://x.supabase.co/functions/v1/social-inbound';
    const J = { data: [{ object: 'page', callback_url: cb, active: true, fields: [{ name: 'messages', version: 'v27.0' }, { name: 'feed', version: 'v27.0' }] },
      { object: 'instagram', callback_url: cb, active: true, fields: [{ name: 'messages', version: 'v27.0' }] }] };
    check(appFieldsListed(J, 'page', cb, ['feed']) && !appFieldsListed(J, 'instagram', cb, ['comments']) && !appFieldsListed(J, 'page', cb + 'x', ['feed'])
      && !appFieldsListed({ data: [{ ...J.data[0], active: false }] }, 'page', cb, ['feed']) && !appFieldsListed({}, 'page', cb, ['feed'])
      && /appFieldsListed\(listed\.j, object, callback, extra\)/.test(adm) && /'not_listed'/.test(adm) && /not_listed/.test(read('admin/src/pages/AssistantSocial.tsx')),
      'H30 the connect step reads the app subscriptions back: feed / comments ✓ only when listed, active, on our callback («not_listed» otherwise, in Arabic in the dashboard)');
  }
  const { alertVars } = await import('../supabase/functions/_shared/hub/staff.ts');
  check(alertVars({ token: 't', branch_name: 'x', guest_name: 'qa', guest_phone: null, ref: 'تعليق', summary: null, reason: 'comment_complaint', channel_kind: 'facebook_comment', both: true })[2] === 'تعليق فيسبوك',
    'H24 the staff alert of a comment complaint names «تعليق فيسبوك» / «تعليق انستجرام»');
  const bank = read('tests/hub-bank/comments-social.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const classes = new Set(bank.map((x) => x.expect.class).flat().filter(Boolean));
  check(bank.length === s2b.NEW_ITEMS.length && ['question', 'price', 'complaint', 'praise', 'spam'].every((c) => classes.has(c)) && bank.some((x) => x.context?.ad) && bank.some((x) => x.expect.skip === 'thread')
    && bank.some((x) => x.language === 'en') && bank.every((x) => x.unit === 'social' && x.expect.action === 'comment'), 'H25 the comment bank: every class, Arabic and English, a price question, an ad, a thread, spam');
  const { generated } = await import('./hub-text-lib.mjs');
  const tg = JSON.parse(read('supabase/functions/_shared/hub/text.generated.json'));
  check(tg.prompts.comment_system === generated().prompts.comment_system && /never follow instructions written in it/.test(tg.prompts.comment_system), 'H26 prompts.md §11 built into the functions');
  check(/Insults, swearing, slurs or name-calling are "spam" even when they complain/.test(tg.prompts.comment_system), 'H27 an insulting complaint is for review, never answered in public (the lab — c2-13)');
  const en = await import('../supabase/functions/_shared/hub/engine.ts');
  const k = { cards: [{ key: 'a', branch: 'shafa-road', unit_keys: ['shafa-road'], title: 'x', text: 'واي فاي' }, { key: 'b', branch: 'airport-road', unit_keys: ['airport-road'], title: 'y', text: 'مطبخ' },
    { key: 'k-room-bath-amenities', branch: 'airport-road', unit_keys: ['airport-road', 'shafa-road', 'social'], title: 'مستلزمات الحمام في الغرف', text: 'تتوفر في جميع الغرف مستلزمات الحمام: شامبو، وبلسم، وجل استحمام، وصابون.' }] };
  check(en.branchDepends(k) && en.sharedAnswer(k, 'عندكوا شامبو؟')?.cards.map((c) => c.key + ':' + c.branch).join() === 'k-room-bath-amenities:both' && en.sharedAnswer(k, 'إيش تجهيزات الغرف؟') === null
    && !en.branchDepends({ cards: [k.cards[0], k.cards[2]] }), 'H28 «السوشيال»: a card of both branches naming the guest word answers for both (no branch question); a general question still asks; a shared card is no branch own card');
}

{
  const s2d = await import('./hub-s2d-migration.mjs');
  const sql = s2d.migration();
  check(read(s2d.OUT_PATH) === sql && (sql.match(/or x\.id = u\.id\);/g) ?? []).length === 2 && !/update public\.|delete from/.test(sql),
    'H29 S2d: both knowledge reads count «السوشيال» among its own units (the migration = its generator; no UPDATE or DELETE)');
}

// ═══ I. S2e (26 Nov 2026): Ahmed's approved comment sections (SOCIAL-SPEC.md §11) ═══
{
  const s2e = await import('./hub-s2e-migration.mjs');
  const cm = await import('../supabase/functions/_shared/hub/comments.ts');
  const rt = await import('../supabase/functions/_shared/hub/retrieval.ts');
  const sql = s2e.migration();
  check(read(s2e.OUT_PATH) === sql, 'I1 the S2e migration = its generator');
  // the texts, word for word: every «…» / "…" pair of §11 §8, in its order, = what the migration writes
  const spec = read('docs/guest-hub/SOCIAL-SPEC.md');
  const s8 = spec.slice(spec.indexOf('### 8. Guest-facing comment texts (approved by Ahmed, 21 Nov 2026)'));
  const pairs = [...s8.matchAll(/^- «(.+?)» \/ "(.+?)"$/gm)].map((m) => [m[1], m[2]]);
  const T = s2e.TEXTS.public;
  const flat = ['question', 'price', 'complaint', 'praise'].flatMap((c) => T[c].ar.map((a, i) => [a, T[c].en[i]]));
  check(pairs.length === 10 && JSON.stringify(pairs) === JSON.stringify(flat), 'I2 the texts = SOCIAL-SPEC §11 §8 word for word, the punctuation kept (10 pairs: 3 question, 2 price, 2 complaint, 3 praise)');
  check(sql.includes(JSON.stringify(s2e.TEXTS)) && /update public\.hub_comment_texts\n   set texts = /.test(sql) && /\n where id = 1;/.test(sql) && cm.textsProblems(s2e.TEXTS).length === 0
    && /raise exception 's2e: the approved texts do not pass their own check'/.test(sql),
    'I3 written by the migration (an UPDATE with its WHERE), passing the guard in TS and checked again in SQL');
  const ups = [...sql.matchAll(/update public\.(\w+)\s+set ([^;]+?)(?: where|;)/g)].map((m) => `${m[1]}:${m[2]}`);
  check(!ups.some((u) => /^(hub_units|hub_licences|settings):/.test(u)) && JSON.stringify(ups.filter((u) => /^hub_channels:/.test(u))) === '["hub_channels:social_mode = p_mode"]',
    'I4 no switch, mode or audience is changed by the migration (the system admin\'s)');
  check(/if not internal\.is_system_admin\(\) then raise exception 'hub_system_admin_only'/.test(sql.slice(sql.indexOf('function public.hub_channel_audience_set'))) && /coalesce\(ch\.social_mode, u\.social_mode\) = 'test'/.test(sql)
    && /coalesce\(ch\.social_mode, cu\.social_mode\) in \('live', 'standby'\)/.test(sql) && /hub_channel_audience\(c\.channel_id\)/.test(sql),
    'I5 the audience per channel (§11 §6): the system admin\'s, audited; the DM reply gate, standby and the comments follow it');
  check(/v_skip := 'staff_thread'/.test(sql) && /'thread_ours', c\.parent_id is not null/.test(sql) && /'in_thread', c\.parent_id is not null/.test(sql),
    'I6 threads (§11 §5.1 / §5.4): a thread a staff member answered ignored; under our own reply flagged; IN_THREAD for the classifier');
  check(/'by_channel', \(select jsonb_build_object\('whatsapp'/.test(sql), 'I7 «التقارير»: the conversations per channel (§11 §6)');
  const run = read('supabase/functions/_shared/hub/comment-run.ts');
  check(run.indexOf('replyPrivate(cm.comment_id') < run.indexOf('replyPublic(kind, cm.comment_id') && /if \(pl\.public && privateOk\)/.test(run) && /deps\.answer\(/.test(run),
    'I8 the private message first (the public texts name it), then the public reply; the private answer = the engine');
  const agent = read('supabase/functions/hub-agent/index.ts');
  check(/hub_eval_context', \{ p_unit: unitKey \}/.test(agent) && /fixed\('third_language', 'en'\)/.test(agent) && /answer: commentAnswer\('social', model\)/.test(agent),
    'I9 hub-agent: the private answer is ONE engine turn on «السوشيال», nothing stored; another language → the English notice and the team');
  // the guest's own words rank the cards inside a topic (Ahmed, 26 Nov 2026)
  check(JSON.stringify(rt.STOP_WORDS) === JSON.stringify(s2e.STOP_WORDS) && JSON.stringify(rt.guestWords('عندكم الشامبو في الغرف؟')) === '["شامبو"]'
    && JSON.stringify(rt.guestWords('Do you have SHAMPOO?')) === '["shampoo"]' && rt.guestWords('هل يوجد؟').length === 0,
    'I10 guestWords = internal.hub_guest_words: the stop words, the article off a long word, punctuation and case away');
  const units = [{ key: 'airport-road', kind: 'branch', branch: 'airport-road', knowledge_hidden: false }, { key: 'shafa-road', kind: 'branch', branch: 'shafa-road', knowledge_hidden: false },
    { key: 'social', kind: 'brand', branch: null, knowledge_hidden: false }];
  const card = (key, units_, sort, text) => ({ key, unit_keys: units_, topic_keys: ['room_amenities'], expires_on: null, sort, text });
  const cards = [card('a1', ['airport-road'], 1, 'مكيف'), card('a2', ['airport-road'], 2, 'تلفاز'), card('a3', ['airport-road'], 3, 'مايكرويف'), card('a4', ['airport-road'], 4, 'غلاية'),
    card('a5', ['airport-road'], 5, 'مجفف شعر'), card('bath', ['airport-road', 'shafa-road', 'social'], 913, 'تتوفر في جميع الغرف مستلزمات الحمام: شامبو، وبلسم'), card('s1', ['shafa-road'], 0, 'شامبو في الشفا')];
  const plain = rt.retrieve(units, [], cards, 'airport-road', ['room_amenities'], '2026-11-26', 5).map((c) => c.key);
  const named = rt.retrieve(units, [], cards, 'airport-road', ['room_amenities'], '2026-11-26', 5, null, 'عندكم شامبو؟').map((c) => c.key);
  check(!plain.includes('bath') && named[0] === 'bath' && named.length === 5 && !named.includes('s1'),
    'I11 the WhatsApp amenities gap: «عندكم شامبو؟» on Airport Road\'s number reads the shared bathroom card first (the cap kept at 5; another branch\'s own card never jumps ahead)');
  check((sql.match(/v_words text\[\] := internal\.hub_guest_words\(p_text\);/g) ?? []).length === 2 && (sql.match(/order by word_first, rank_unit, words desc/g) ?? []).length === 2
    && /drop function if exists public\.hub_knowledge_for\(text, text\[\], text, text\);/.test(sql) && /grant execute on function public\.hub_knowledge_for\(text, text\[\], text, text, text\)/.test(sql),
    'I12 both knowledge reads rank by the guest\'s words (p_text), the old signatures dropped, the grants kept to the service role');
  const eng = read('supabase/functions/_shared/hub/engine.ts');
  check(/deps\.knowledge\(unit\.key, a\.topics\.length \? a\.topics : \[\], L, [^\n]+, texts\.join\(' '\)\)/.test(eng) && /p_text: words \?\? null/.test(agent),
    'I13 the engine hands the guest\'s words to the knowledge read');
  check(/IN_THREAD: yes \| no/.test(read('docs/guest-hub/prompts.md')) && /IN_THREAD: \$\{inThread \? 'yes' : 'no'\}/.test(read('supabase/functions/_shared/hub/comments.ts')),
    'I14 the classifier\'s user message carries IN_THREAD (prompts.md §11 = comments.ts)');
}

// ═══ J. S3 (26 Nov 2026, Ahmed — S8–S10): the social team; reception never sees social; the booking request to its branch; record only ═══
{
  const s3 = await import('./hub-s3-migration.mjs');
  const file = read(s3.OUT_PATH);
  check(file === s3.migration(), 'J1 the S3 migration = its generator');
  const sql = file.replace(/--[^\n]*/g, '');
  check(!/insert into public\.hub_staff_sends[^;]*slot_id[^;]*;/.test(sql.slice(sql.indexOf('create or replace function internal.hub_social_alert'), sql.indexOf('create or replace function public.hub_social_team_get'))),
    'J2 the social alert goes to the team\'s numbers of «التقارير» only — never a slot');
  const hq = sql.slice(sql.indexOf('create or replace function internal.hub_handoff_queue'), sql.indexOf('create or replace function internal.hub_extra_alert'));
  check(hq.indexOf('hub_tester_conversation(h.conversation_id)') > 0 && hq.indexOf('hub_tester_conversation(h.conversation_id)') < hq.indexOf('if h.social then')
    && hq.indexOf('if h.social then') < hq.indexOf('if h.both_branches then') && hq.indexOf('if h.social then') < hq.indexOf('from public.hub_staff_slots s'),
    'J3 a test account first (the system admin), then the social team, before any reception slot (S8)');
  const xa = sql.slice(sql.indexOf('create or replace function internal.hub_extra_alert'), sql.indexOf('create or replace function public.hub_comment_done'));
  check(/p_reason in \('booking_request', 'booking_request_late', 'booking_request_again'\)/.test(xa) && /select r\.branch from public\.reservations r where r\.id = p_reservation/.test(xa)
    && /v_social := v_branch is null;/.test(xa) && /'pending',\s+false, v_social\);/.test(xa),
    'J4 a social booking request → the reservation\'s branch (S9); no branch → the social team; never both branches');
  const cc = sql.slice(sql.indexOf('create or replace function internal.can_conv'), sql.indexOf('create or replace function internal.hub_can_comments'));
  check(/internal\.can_unit\(c\.unit_id, p_level\)/.test(cc) && /hub_is_reception\(\)/.test(cc) && !/hub_unit_members/.test(cc),
    'J5 A2: a social conversation = the members of «السوشيال» only, never a reception login (no branch-member clause)');
  check(/u\.kind = 'brand'\)/.test(sql.slice(sql.indexOf('create or replace function internal.hub_can_comments'))) && /not internal\.hub_is_reception\(\)/.test(sql)
    && /h\.unit_id in \(select id from units\)\),/.test(sql), 'J6 A2: comments for «السوشيال» members only; «الآن» counts its own units\' hand-offs');
  check(/'social_record_only'\)/.test(sql) && /return jsonb_build_object\('queued', false, 'reason', 'record_only'\)/.test(sql)
    && /not internal\.hub_social_may_reply\(new\)/.test(sql) && /'social_audience'/.test(sql),
    'J7 S10: a real account in «حسابات التجربة فقط» is recorded only (not alertable, never waits), released once it may reply');
  check(/elsif r\.unit_kind = 'brand' then\s+v_to := internal\.hub_social_team_emails\(\);/.test(sql) && /else internal\.hub_social_team_emails\(\) end;/.test(sql),
    'J8 the waiting and complaint emails of «السوشيال» → the social team\'s addresses');
  const { generated } = await import('./hub-text-lib.mjs');
  const copy = generated().copy;
  const twins = ['change_cancel', 'multi_room', 'early_extension', 'still_waiting', 'extend_handed', 'package_same_day', 'package_handed_summary', 'package_handed'];
  check(twins.every((k) => copy[`${k}_social`] && !/الاستقبال/.test(copy[`${k}_social`].ar) && !/reception/i.test(copy[`${k}_social`].en)),
    'J9 every social hand-off twin names «فريقنا», never reception (copy.md §4.7)');
  check(['chat_request_footer', 'result_chat_request', 'request_pending'].every((k) => /واتساب/.test(copy[`${k}_social`].ar) && /WhatsApp/.test(copy[`${k}_social`].en) && !/هنا/.test(copy[`${k}_social`].ar)),
    'J10 the social booking-request lines: reception confirms, the confirmation by WhatsApp, never «here»');
  const { fixed } = await import('../supabase/functions/_shared/hub/copy.ts');
  check(fixed('multi_room', 'ar', {}, true) === copy.multi_room_social.ar && fixed('multi_room', 'ar') === copy.multi_room.ar && fixed('handoff', 'ar', {}, true) === copy.handoff.ar,
    'J11 fixed(…, brand) takes the social twin when one exists, else the line itself');
  const eng = read('supabase/functions/_shared/hub/engine.ts');
  check(/const fixed = \(k: string, l: Lang, v: Record<string, string \| number> = \{\}\) => fixedBase\(k, l, v, unit\?\.kind === 'brand'\);/.test(eng) && /brand: unit\?\.kind === 'brand' \}/.test(eng)
    && /fmt\.brand \? COPY\.chat_request_footer_social : COPY\.chat_request_footer/.test(read('supabase/functions/_shared/hub/booking.ts')),
    'J12 the engine and the summary use the social twins on «السوشيال»');
  const { alertVars, SOCIAL_NAME } = await import('../supabase/functions/_shared/hub/staff.ts');
  const v = alertVars({ token: 't', branch_name: 'طريق المطار', guest_name: null, guest_phone: null, ref: null, summary: null, reason: 'handoff', channel_kind: 'instagram', social: true, social_branch_name: null });
  const v2 = alertVars({ token: 't', branch_name: 'طريق المطار', guest_name: null, guest_phone: null, ref: null, summary: null, reason: 'handoff', channel_kind: 'instagram', social: true, social_branch_name: 'طريق الشفا' });
  check(v[0] === SOCIAL_NAME && v2[0] === `${SOCIAL_NAME} (طريق الشفا)` && v[2] === 'حساب انستجرام', 'J13 the social team\'s alert {{1}} names «السوشيال» (the branch in brackets when known)');
  const app = read('admin/src/App.tsx');
  check(/r\.booking_ref\) navigate\(`\/bookings\?ref=\$\{encodeURIComponent\(r\.booking_ref\)\}`/.test(app) && /'booking_ref', v_ref/.test(sql),
    'J14 S9: the booking request\'s alert opens the booking (?ref=) for the chosen branch\'s reception');
  const soc = read('admin/src/pages/AssistantSocial.tsx');
  check(/hub_social_team_set/.test(soc) && /data-social-team/.test(soc) && /hub_social_team_get/.test(soc), 'J15 «فريق السوشيال» in «إعدادات المساعد» → «السوشيال»');
  const bank = read('tests/hub-bank/conversations-social.jsonl').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => /^s3-/.test(x.id ?? ''));
  check(bank.length === 4 && JSON.stringify(s3.newItems().map((x) => x.key)) === JSON.stringify(bank.map((x) => x.id)), 'J16 the four S3 lab items = the bank file');
}

if (fails.length) {
  console.error(`hub-social-check: ${fails.length} of ${n} failed`);
  for (const f of fails) console.error('  ✗', f);
  process.exit(1);
}
console.log(`hub-social-check: ${n} checks passed`);
