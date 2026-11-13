// Guest Hub — the webhook router (13 Nov 2026, session H2; docs/guest-hub/GUEST-HUB-SPEC.md §3.7, §6.1, §2.5 rule 13,
// T23, T32–T35, §10 row A; DECISIONS.md 2026-11-13 «Guest Hub H2 — inbound messages»). OFFLINE and fast (FAST_CHECKS):
// no database, no network — the router module and the sender run under Node on YCloud-shaped payloads
// (scripts/fixtures/ycloud-webhook-events.json, the documented examples' shapes), and the function / migration are read.
//   1. signatures: valid, tampered, stale, missing; the endpoint refuses before handling and answers 200 at once;
//   2. parsing: text, a button reply, a template quick reply, media, location, the referral (known keys only), echo,
//      status, quality, an unknown event;
//   3. the routing order: a hub button by its id first, then the opt-out words, then the typed «إلغاء», then the typed
//      button titles — every opt-out case exactly as before (button «إلغاء الاشتراك», «إيقاف», stop, unsubscribe, a typed
//      «إلغاء» without an active booking);
//   4. the «إلغاء» flow: the question = copy.md §5.1 (AR + EN), its buttons ≤ 20 characters and never an opt-out word,
//      its timer (hub_cancel_word_wait_hours 12, 1–23, the 5-minute job), the hand-off notice = copy.md §5, the answer
//      typed counts only while it waits, a repeated tap never sends twice;
//   5. the sender: reply buttons within WhatsApp's limits, the 24-hour window refused, test mode never calls YCloud,
//      a timeout never retried;
//   6. dedupe, echo → staff, statuses forward only, quality below High, storage off = nothing stored (the SQL side);
//   7. «تحديث أحداث الاستقبال»: the merge never removes an event, our endpoint only, the answer checked.
//   node scripts/hub-webhook-check.mjs
import { readFileSync } from 'node:fs';
import {
  CANCEL_BUTTON_IDS, EVENT_ECHO, EVENT_QUALITY, HUB_EVENTS, cancelQuestion, cancelTitles, describe, e164, mediaExt, parseEcho, parseInbound, parseQuality, parseStatus,
  qualityLow, route,
} from '../supabase/functions/_shared/hub/webhook.ts';
import { isOptOut, verifySignature } from '../supabase/functions/wa-automation/templates.ts';
import { BUTTON_TITLE_MAX, buttonsPayload, sendSession, textPayload, windowOpen } from '../supabase/functions/booking-request/whatsapp-send.ts';
import { hubQualityMail } from '../supabase/functions/booking-request/email.ts';
import { HUB_ADD_EVENTS, eventsKept, eventsOf, eventsPatchBody, isOurEndpoint, mergeEvents, webhookEndpointUrl } from '../supabase/functions/hub-admin/ycloud.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const EV = JSON.parse(read('scripts/fixtures/ycloud-webhook-events.json'));
const C = JSON.parse(read('supabase/functions/booking-request/content.generated.json'));
const CLUB = C.club_whatsapp;
const FN = read('supabase/functions/wa-automation/index.ts');
const MIG = read('supabase/migrations/20261113200000_guest_hub_inbound.sql');
const MIG1 = read('supabase/migrations/20261113100000_guest_hub_foundation.sql');
const COPY = read('docs/guest-hub/copy.md');
const CONFIG = read('supabase/config.toml');
const TESTS = read('supabase/tests/guest_hub_ingest.sql') + read('supabase/tests/guest_hub_retention.sql');
const WF = read('.github/workflows/server-checks.yml');

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const fnOf = (src, name) => {
  const i = src.indexOf(`create function public.${name}(`) >= 0 ? src.indexOf(`create function public.${name}(`) : src.indexOf(`create or replace function public.${name}(`);
  if (i < 0) return '';
  return src.slice(i, src.indexOf('\n$$;', i) + 4);
};

// ── 1. signatures ──
const secret = 'whsec_test_secret';
const raw = JSON.stringify(EV.text);
const now = Date.UTC(2026, 10, 13, 10, 0, 0);
const t = Math.floor(now / 1000);
const { createHmac } = await import('node:crypto');
const sig = (ts, body, key = secret) => `t=${ts},s=${createHmac('sha256', key).update(`${ts}.${body}`).digest('hex')}`;
check(await verifySignature(secret, sig(t, raw), raw, now), 'signature: a valid one passes');
check(!(await verifySignature(secret, sig(t, raw), raw.replace('موقف', 'مواقف'), now)), 'signature: a tampered body is refused');
check(!(await verifySignature(secret, sig(t, raw, 'whsec_other'), raw, now)), 'signature: another secret is refused');
check(!(await verifySignature(secret, sig(t - 301, raw), raw, now)), 'signature: older than 5 minutes is refused');
check(!(await verifySignature(secret, null, raw, now)) && !(await verifySignature('', sig(t, raw), raw, now)), 'signature: none / no secret is refused');
const wh = FN.slice(FN.indexOf('async function webhook('), FN.indexOf('// ───', FN.indexOf('async function webhook(')));
check(/if \(!v\.data\.secret \|\| !\(await verifySignature\(v\.data\.secret, req\.headers\.get\('ycloud-signature'\), raw\)\)\) \{[\s\S]{0,120}status: 401/.test(wh)
  && wh.indexOf('verifySignature') < wh.indexOf('handleEvent'), 'the endpoint refuses an unsigned call (401) before handling anything');
check(/rt\.waitUntil\(work\)/.test(wh) && /return new Response\('\{"ok":true\}', \{ status: 200/.test(wh), 'the endpoint answers 200 at once; the event runs after (EdgeRuntime.waitUntil)');
check(/\[functions\.wa-automation\]\nverify_jwt = false/.test(CONFIG), 'wa-automation: verify_jwt = false (YCloud signs, the gateway does not)');
check(!/hub-inbound/.test(CONFIG) && !/functions\/v1\/hub-/.test(FN), 'one endpoint: no second webhook function, the URL unchanged (wa-automation?hook=…)');

// ── 2. parsing ──
const txt = parseInbound(EV.text.whatsappInboundMessage);
check(txt.id === '63f5d1e0a1b2c3d4e5f60001' && txt.from === '+966500009901' && txt.to === '+966536622277' && txt.kind === 'text' && txt.text === 'هل يتوفر موقف سيارات؟'
  && txt.profileName === 'Guest QA' && txt.sentAt === '2026-11-13T10:00:00.000Z' && !txt.buttonId && !txt.media && !txt.referral, `text parsed — ${JSON.stringify(txt)}`);
const br = parseInbound(EV.button_reply.whatsappInboundMessage);
check(br.kind === 'button_reply' && br.buttonId === 'hubcw:booking' && br.buttonSource === 'interactive' && br.text === 'إلغاء حجزي' && br.payload.button_id === 'hubcw:booking', 'an interactive button reply: its id and title');
const qr = parseInbound(EV.template_quick_reply.whatsappInboundMessage);
check(qr.kind === 'button_reply' && qr.buttonSource === 'template' && qr.text === 'إلغاء الاشتراك' && qr.to === '+966536663030', 'a template quick reply (type button)');
const img = parseInbound(EV.image.whatsappInboundMessage);
check(img.kind === 'image' && img.media?.id === '1234567890' && img.media?.mime === 'image/jpeg' && img.media?.link?.startsWith('https://api.ycloud.com/') && img.text === 'صورة الغرفة' && img.payload.media_id === '1234567890', 'an image: media id, MIME, link, caption');
const loc = parseInbound(EV.location.whatsappInboundMessage);
check(loc.kind === 'location' && loc.payload.latitude === 21.437 && loc.payload.longitude === 40.512 && !('name' in loc.payload), 'a location: coordinates in the payload, words in the text only');
const ref = parseInbound(EV.referral.whatsappInboundMessage);
check(ref.referral && ref.referral.ctwa_clid === 'ARAkLkA8rmlFeiCktEJQ' && ref.referral.source_type === 'ad', 'the referral object is read');
const d = describe(EV.referral);
check(d === 'whatsapp.inbound_message.received kind=text referral_keys=ctwa_clid,headline,image_url,media_type,source_id,source_type,source_url', `the log line names the referral's KEYS only — ${d}`);
check(!/ARAk|fb\.me|عرض|966500009903|أريد/.test(d), 'the log line holds no referral value, no text, no phone');
const refFn = MIG.slice(MIG.indexOf('create function internal.hub_clean_referral'), MIG.indexOf('$$;', MIG.indexOf('create function internal.hub_clean_referral')));
check(['source_url', 'source_type', 'source_id', 'headline', 'media_type', 'image_url', 'ctwa_clid'].every((k) => refFn.includes(`'${k}'`)), 'the database keeps the documented referral keys (spec §6.1) and only known ones');
const ech = parseEcho(EV.echo.whatsappMessage);
check(ech.id === '64a1b2c3d4e5f6a7b8c90001' && ech.from === '+966536622277' && ech.to === '+966500009901' && ech.kind === 'text' && ech.text === 'نعم، الموقف مجاني.', 'an echo: from = our number, to = the guest');
const st = parseStatus(EV.status.whatsappMessage);
check(st.id === '64a1b2c3d4e5f6a7b8c90001' && st.status === 'delivered' && st.price === 0 && st.currency === 'USD' && st.errorCode === null, 'a status with Meta\'s price (0 kept as 0)');
const sf = parseStatus(EV.status_failed.whatsappMessage);
check(sf.status === 'failed' && sf.errorCode === '131047' && sf.price === null, 'a failed status with its error code, no price');
const q = parseQuality(EV.quality.whatsappPhoneNumber);
check(q.phone === '+966536622277' && q.rating === 'YELLOW' && q.limit === 'TIER_1K', 'quality: the number, its rating, its limit');
check(qualityLow('YELLOW') && qualityLow('red') && qualityLow('FLAGGED') && !qualityLow('GREEN') && !qualityLow('HIGH') && !qualityLow('UNKNOWN') && !qualityLow(null), 'below High: YELLOW / RED / FLAGGED, not GREEN, HIGH or unknown');
const lowSql = (MIG.match(/create function internal\.hub_quality_low[\s\S]*?in \(([^)]*)\)/) ?? [])[1] ?? '';
check(JSON.stringify(lowSql.match(/'[A-Z]+'/g)?.map((x) => x.slice(1, -1))) === JSON.stringify(['YELLOW', 'MEDIUM', 'RED', 'LOW', 'FLAGGED']), 'the database and the router name the same low ratings');
check(describe(EV.other) === 'contact.attributes_changed' && /console\.log\('wa-automation: event acknowledged', describe\(ev\)\);\s+return \{ kind: 'ignored' \};/.test(FN), 'any other event: acknowledged and logged by its type only');
check(e164('966536622277') === '+966536622277' && e164('+966 53 662 2277') === '+966536622277' && e164('12') === null && e164(null) === null, 'e164 normalises the YCloud numbers');
check(mediaExt('image/jpeg') === 'jpg' && mediaExt('audio/ogg; codecs=opus') === 'ogg' && mediaExt('application/x-unknown') === 'bin', 'the media file extension from the MIME type');
check(JSON.stringify(HUB_EVENTS) === JSON.stringify(['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes', 'whatsapp.phone_number.quality_updated']), 'the four events the router handles');

// ── 3. the routing order ──
const mk = (patch) => ({ ...parseInbound(EV.text.whatsappInboundMessage), ...patch });
const R = (m) => route(m, CLUB);
check(R(mk({ kind: 'button_reply', buttonId: 'hubcw:offers', buttonSource: 'interactive', text: 'إلغاء' })).kind === 'cancel_answer', 'a hub button is routed by its id even when its title is an opt-out word');
check(JSON.stringify(R(br)) === JSON.stringify({ kind: 'cancel_answer', choice: 'booking', typed: false }), '«إلغاء حجزي» (button) → the booking answer');
check(JSON.stringify(R(mk({ kind: 'button_reply', buttonId: CANCEL_BUTTON_IDS.offers, buttonSource: 'interactive', text: 'Stop offer messages' }))) === JSON.stringify({ kind: 'cancel_answer', choice: 'offers', typed: false }), '«إيقاف رسائل العروض» (button) → the offers answer');
check(R(mk({ kind: 'button_reply', buttonId: 'hub:later', buttonSource: 'interactive', text: 'stop' })).kind === 'hub_button', 'another hub button never reaches the opt-out matcher');
check(R(qr).kind === 'optout', 'the templates\' «إلغاء الاشتراك» button: the immediate opt-out, unchanged');
check(R(mk({ kind: 'button_reply', buttonSource: 'template', buttonId: 'Unsubscribe', text: 'Unsubscribe' })).kind === 'optout', '"Unsubscribe" (button): the immediate opt-out');
for (const w of ['إيقاف', 'ايقاف', 'STOP', 'stop.', 'Unsubscribe', 'إلغاء الاشتراك', 'الغاء الاشتراك']) check(R(mk({ text: w })).kind === 'optout', `typed «${w}»: the immediate opt-out, unchanged`);
for (const w of ['إلغاء', 'الغاء', 'إلغاء.', ' إلغاء ', 'إلـغاء', 'إلغَاء']) check(R(mk({ text: w })).kind === 'cancel_word', `typed «${w}»: the «إلغاء» flow (the question when a booking is active)`);
check(R(mk({ kind: 'button_reply', buttonSource: 'template', buttonId: 'x', text: 'إلغاء' })).kind === 'optout', 'a «إلغاء» that is a template button (not typed) stays the immediate opt-out');
check(JSON.stringify(R(mk({ text: 'إيقاف رسائل العروض' }))) === JSON.stringify({ kind: 'cancel_answer', choice: 'offers', typed: true }) && R(mk({ text: 'cancel my booking' })).kind === 'cancel_answer', 'the button titles typed out → an answer, counted only while it waits (typed)');
for (const w of ['إلغاء الحجز', 'أريد الإلغاء', 'شكرا', 'stop please', 'Hello', '']) check(R(mk({ text: w })).kind === 'none', `«${w}»: nothing to route`);
check(isOptOut('إلغاء') && isOptOut('الغاء'), 'the matcher still accepts «إلغاء» (the flow keeps the same words)');
const hi = FN.slice(FN.indexOf('async function handleInbound('), FN.indexOf('async function handleEcho('));
check(hi.indexOf("'hub_ingest_inbound'") < hi.indexOf('route(m, content.club_whatsapp)'), 'storage first (the RPC decides), then the route');
check(/if \(!s\.data\.active\) return \{ \.\.\.\(await optOut\(m, branch, test\)\), stored, cancel_word: 'no_active_booking' \};/.test(hi), 'a typed «إلغاء» without an active booking: today\'s opt-out');
check(/if \(!s\.ok\) \{[\s\S]{0,200}return \{ \.\.\.\(await optOut\(m, branch, test\)\), stored \};/.test(hi), 'the question cannot be stored → today\'s opt-out (a «إلغاء» is never lost)');
check(/if \(r\.kind === 'optout'\) return \{ \.\.\.\(await optOut\(m, branch, test\)\), stored \};/.test(hi), 'the opt-out words → the opt-out');
const oo = FN.slice(FN.indexOf('async function optOut('), FN.indexOf('/** a media file'));
check(/rpc<\{ ok: boolean; changed: boolean; profile_id: string \}>\('wa_opt_out', \{ p_phone: m\.from, p_test: test \}\)/.test(oo) && /if \(!r\.data\.changed\) return \{ kind: 'optout', ok: true, changed: false \};/.test(oo)
  && /text: \{ body: cleanParam\(content\.club_whatsapp\[L\]\.optout_reply\) \}/.test(oo) && /template: 'optout_reply'/.test(oo), 'the opt-out: wa_opt_out, ONE plain reply the first time (club.json → optout_reply), from the number written to');

// ── 4. the «إلغاء» flow ──
const cq = (s) => (COPY.match(/\*\*5\.1[\s\S]*?```\n([^\n]+)\n```\n```\n([^\n]+)\n```/) ?? []).slice(1);
const [qAr, qEn] = cq();
check(CLUB.ar.cancel_question === qAr && CLUB.en.cancel_question === qEn, `the question = copy.md §5.1 (AR + EN) — ${CLUB.ar.cancel_question}`);
check(/Buttons: «إيقاف رسائل العروض» · «إلغاء حجزي» \/ “Stop offer messages” · “Cancel my booking”/.test(COPY) && CLUB.ar.cancel_button_offers === 'إيقاف رسائل العروض' && CLUB.ar.cancel_button_booking === 'إلغاء حجزي'
  && CLUB.en.cancel_button_offers === 'Stop offer messages' && CLUB.en.cancel_button_booking === 'Cancel my booking', 'the button titles = copy.md §5.1');
const notice = COPY.match(/\| Change or cancel an existing booking \| «([^»]+)» \| “([^”]+)” \|/) ?? [];
check(CLUB.ar.cancel_booking_notice === notice[1] && CLUB.en.cancel_booking_notice === notice[2], 'the hand-off notice = copy.md §5 «Change or cancel an existing booking»');
for (const L of ['ar', 'en']) {
  const qq = cancelQuestion(CLUB, L);
  check(qq.buttons.length === 2 && qq.buttons.every((b) => [...b.title].length <= BUTTON_TITLE_MAX && !isOptOut(b.title) && b.id.startsWith('hubcw:')), `${L}: two buttons, ≤ ${BUTTON_TITLE_MAX} characters, never an opt-out word (spec §2.5 rule 12)`);
  const p = buttonsPayload('+966536622277', '+966500009901', qq.body, qq.buttons, 'log-1');
  check(p.type === 'interactive' && p.interactive.type === 'button' && p.interactive.body.text === qq.body && p.interactive.action.buttons.map((b) => b.reply.id).join() === 'hubcw:offers,hubcw:booking' && p.externalId === 'log-1' && p.from === '+966536622277', `${L}: the YCloud reply-buttons body`);
}
const tt = cancelTitles(CLUB);
check(tt.offers.has('ايقاف رسائل العروض') && tt.booking.has('cancel my booking'), 'the typed titles are matched normalised');
check(/when 'hub_cancel_word_wait_hours' then array\[1, 23\]/.test(MIG1) && /\('hub_cancel_word_wait_hours', '12'\)/.test(MIG1), 'the wait: 12 hours by default, 1–23 (inside the window)');
const tick = fnOf(MIG, 'hub_cancel_word_tick');
check(/internal\.hub_setting_int\('hub_cancel_word_wait_hours', 12\)/.test(tick) && /cancel_word_pending_at <= p_now - make_interval\(hours => v_wait\)/.test(tick), 'the job reads the wait from the setting');
check(/wa_opt_out_at = case when v_changed then p_now/.test(tick) && /marketing_hold_at = null, cancel_word_pending_at = null/.test(tick) && /'optout_reply', g\.id, q\.language, q\.branch, 'queued'/.test(tick), 'no answer: the opt-out as today, the hold ended, the existing reply queued from the question\'s number and language');
check(/select cron\.schedule\('hub-cancel-word', '\*\/5 \* \* \* \*', 'select public\.hub_cancel_word_tick\(\)'\);/.test(MIG), 'the 5-minute job hub-cancel-word');
const start = fnOf(MIG, 'hub_cancel_word_start');
check(/if not internal\.hub_active_booking\(p_phone, p_test\) then return jsonb_build_object\('active', false\); end if;/.test(start) && /marketing_hold_at = coalesce\(marketing_hold_at, now\(\)\), cancel_word_pending_at = now\(\)/.test(start)
  && /return jsonb_build_object\('active', true, 'started', false/.test(start), 'start: the hold at once, the question once (a second «إلغاء» sends nothing)');
const act = MIG.slice(MIG.indexOf('create function internal.hub_active_booking'), MIG.indexOf('$$;', MIG.indexOf('create function internal.hub_active_booking')));
check(/r\.status in \('request', 'confirmed'\)/.test(act) && /r\.check_out >= \(now\(\) at time zone 'Asia\/Riyadh'\)::date/.test(act) && /r\.phone = p_phone/.test(act), 'active booking = request or confirmed, same phone, check-out today or later (Asia/Riyadh)');
check(!/hub_inbox_on/.test(start) && !/hub_inbox_on/.test(tick), 'the «إلغاء» flow does not depend on «تخزين المحادثات» (its state is on the profile)');
const res = fnOf(MIG, 'hub_cancel_word_resolve');
check(/if p_only_pending and not v_pending then return/.test(res) && /if not v_pending then return jsonb_build_object\('ok', true, 'resolved', false, 'choice', 'booking'/.test(res), 'a typed answer counts only while waiting; a repeated «إلغاء حجزي» sends nothing twice');
check(/v_out := public\.wa_opt_out\(p_phone, p_test\);/.test(res), '«إيقاف رسائل العروض» = the opt-out exactly as today (wa_opt_out)');
check(/if \(!a\.data\.resolved \|\| !a\.data\.log_id\) return/.test(hi) && /textPayload\(m\.to!, m\.from, String\(content\.club_whatsapp\[L\]\.cancel_booking_notice\), a\.data\.log_id\)/.test(hi), 'the notice goes once, only when the question was waiting');
check(/'eyab_welcome', 'eyab_offer', 'optout_reply', 'cancel_question', 'cancel_booking_notice'/.test(MIG), 'the question and the notice are logged with the opt-out reply (no text, no phone)');

// ── 5. the sender ──
const noFetch = [];
globalThis.Deno = { env: { get: (k) => (k === 'YCLOUD_API_KEY' ? 'test-key' : undefined) } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  noFetch.push(String(u));
  throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
};
const pl = textPayload('+966536622277', '+966500009901', 'نص', 'x');
const closed = await sendSession({ payload: pl, windowExpiresAt: new Date(Date.now() - 1000).toISOString(), test: false, log: null });
check(closed.status === 'failed' && closed.errorCode === 'window_closed' && noFetch.length === 0, 'the window closed: nothing sent, «window_closed»');
const tm = await sendSession({ payload: pl, windowExpiresAt: Date.now() + 3600e3, test: true, log: null });
check(tm.status === 'test' && tm.accepted && noFetch.length === 0, 'test mode: built and logged as test, YCloud never called');
const to = await sendSession({ payload: pl, windowExpiresAt: Date.now() + 3600e3, test: false, log: null });
check(to.errorCode === 'timeout' && noFetch.filter((u) => u.includes('sendDirectly')).length === 1, 'a timeout: failed once, never retried (the first may still arrive)');
globalThis.fetch = realFetch;
check(windowOpen(Date.now() + 1000) && !windowOpen(null) && !windowOpen('') && !windowOpen('x'), 'windowOpen: future only');
let threw = 0;
for (const bad of [[], [{ id: 'a', title: 'x' }, { id: 'b', title: 'y' }, { id: 'c', title: 'z' }, { id: 'd', title: 'w' }], [{ id: 'a', title: 'x'.repeat(21) }], [{ id: 'a', title: 'x' }, { id: 'a', title: 'y' }], [{ id: 'A B', title: 'x' }]]) {
  try {
    buttonsPayload('+966536622277', '+966500009901', 'body', bad);
  } catch {
    threw++;
  }
}
check(threw === 5, 'reply buttons: 1–3, titles ≤ 20, unique ids — anything else refused before YCloud');
check(/sendSession\(\{\s+payload: buttonsPayload\(m\.to!, m\.from, q\.body, q\.buttons, s\.data\.log_id\),\s+windowExpiresAt: windowOf\(m\.sentAt\),/.test(hi), 'the question goes through the one sender, inside the window the «إلغاء» opened');

// ── 6. dedupe, echo, statuses, quality, storage off ──
const ing = fnOf(MIG, 'hub_ingest_inbound');
check(/if not internal\.hub_setting_bool\('hub_inbox_on'\) then return jsonb_build_object\('stored', false, 'reason', 'inbox_off'\); end if;/.test(ing.split('\n').slice(0, 20).join('\n')), 'storage off: the first thing the ingest checks — nothing stored');
check(/create unique index hub_messages_provider on public\.hub_messages \(channel_id, provider_message_id\) where provider_message_id is not null;/.test(MIG) && /idempotency_key text not null unique/.test(MIG), 'dedupe: the YCloud id unique per channel, the idempotency key unique');
check(/return \{ kind: 'inbound', stored: false, duplicate: true \};/.test(hi), 'a repeated delivery stops before the route (nothing runs twice)');
const echo = fnOf(MIG, 'hub_ingest_echo');
check(/'out', 'phone'/.test(echo) && /state = 'human',\s+owner_kind = 'phone'/.test(echo) && /waiting_since = null/.test(echo), 'echo: a «من الجوال» message; the conversation to staff, owner «الجوال» (T23)');
check(/handleEcho\(ev\.whatsappMessage, test\)/.test(FN) && new RegExp(`'${EVENT_ECHO.replace(/\./g, '\\.')}'`).test(read('supabase/functions/_shared/hub/webhook.ts')), 'the router sends echoes to hub_ingest_echo');
const stat = fnOf(MIG, 'wa_status_update');
check(/update public\.whatsapp_messages/.test(stat) && /update public\.eyab_messages/.test(stat) && /update public\.hub_messages/.test(stat) && /w\.direction = 'out'/.test(stat), 'statuses: all three logs, forward only (an inbound row never moves)');
const qual = fnOf(MIG, 'hub_quality_update');
check(/insert into public\.hub_alerts \(kind, unit_id, payload\)\s+values \('quality_drop'/.test(qual) && /on conflict do nothing/.test(qual) && /site_deploy_alert_recipients/.test(qual), 'quality below High: one open alert, the active admins\' addresses');
check(new RegExp(`'${EVENT_QUALITY.replace(/\./g, '\\.')}'`).test(read('supabase/functions/_shared/hub/webhook.ts')) && /if \(test \|\| !q\.phone\) return/.test(FN) && /hubQualityMail\(content,/.test(FN), 'quality: a QA event never writes the channel; the email from the shared layout');

const qm = hubQualityMail(C, { unit_name: 'فرع طريق المطار', address: '+966536622277', rating: 'YELLOW', at: '2026-11-13T10:10:00Z' });
// the wording approved by Ahmed on 13 Nov 2026 (copy.md §7 row 4) — every detail in scripts/hub-email-check.mjs
check(qm.subject === 'جودة رقم واتساب — فرع طريق المطار — AR-HUB-20261113' && /AR-HUB-/.test(qm.subject), `the quality email: its subject carries AR-HUB- (the mailbox filter) — ${qm.subject}`);
check(qm.text.includes('«متوسط»') && qm.text.includes('/assistant') && /<html[^>]*lang="ar"/.test(qm.html) && /@media print/.test(qm.html), 'the quality email: the rating in Arabic, the link to «إعدادات المساعد», the shared layout and its print sheet');

// ── 7. «تحديث أحداث الاستقبال» ──
const two = ['whatsapp.inbound_message.received', 'whatsapp.message.updated'];
const mm = mergeEvents(two);
check(JSON.stringify(mm.events) === JSON.stringify([...two, ...HUB_ADD_EVENTS]) && JSON.stringify(mm.added) === JSON.stringify(HUB_ADD_EVENTS), 'the merge adds the two hub events and keeps both it had');
check(mergeEvents([...two, ...HUB_ADD_EVENTS]).added.length === 0, 'already there: nothing to add (no update)');
check(mergeEvents(['x.custom', ...two]).events.includes('x.custom'), 'an event added by hand at YCloud is kept');
check(eventsKept(two, [...two, ...HUB_ADD_EVENTS]) && !eventsKept(two, HUB_ADD_EVENTS) && !eventsKept(two, two) && !eventsKept(two, null), 'the answer must keep every event and hold the new ones');
check(JSON.stringify(eventsOf({ enabledEvents: ['a.b', 'a.b', 'c.d'] })) === '["a.b","c.d"]' && JSON.stringify(eventsOf({ enabledEvents: [{ type: 'a.b' }] })) === '["a.b"]' && eventsOf({}) === null, 'eventsOf: strings or objects; none → null');
check(isOurEndpoint({ url: 'https://wwzxwettsuwtakwwbfly.supabase.co/functions/v1/wa-automation?hook=0123456789abcdef0123456789abcdef' }) && !isOurEndpoint({ url: 'https://example.com/hook' }), 'only our endpoint (wa-automation) is ever changed');
check(JSON.stringify(eventsPatchBody(['a'])) === '{"enabledEvents":["a"]}' && webhookEndpointUrl('we_1') === 'https://api.ycloud.com/v2/webhookEndpoints/we_1', 'the PATCH carries the events only, to that endpoint');
const store = fnOf(MIG, 'hub_webhook_events_store');
check(/if not \(coalesce\(p_after, '\{\}'\) @> coalesce\(p_before, '\{\}'\)\) then raise exception 'hub_webhook_events_removed'/.test(store) && /insert into public\.audit_log/.test(store), 'the database refuses a removed event and audits the change');

// ── the SQL proof exists and runs in CI ──
for (const name of ['N6 a repeated event', 'E1 an echo', 'S2 read stays read', 'C8 after 12 hours', 'H2 a queued «إياب» offer to a held member', 'I1 «تخزين المحادثات» off', 'T1 text older than 12 months', 'R2 Airport Road reception sees Airport Road only']) {
  check(TESTS.includes(name), `the SQL test «${name}» exists`);
}
check(/guest_hub_ingest\.sql/.test(WF) && /guest_hub_retention\.sql/.test(WF), 'server-checks.yml runs guest_hub_ingest.sql and guest_hub_retention.sql');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-webhook-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-webhook-check: ${n} checks passed`);
