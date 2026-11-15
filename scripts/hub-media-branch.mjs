// Guest Hub H7 (15 Nov 2026): the media routes on a PREVIEW BRANCH, through the REAL webhook — each guest voice note /
// image / sticker is a YCloud event signed with the branch's endpoint secret, POSTed to the branch's deployed wa-automation
// (?hook=<token>): the signature, the storage of the message, the DOWNLOAD of the file into hub-media (the link points at a
// synthetic file the setup put in the branch's own storage), hub_turn_queue. Each turn is worked by the engine of
// supabase/functions/_shared/hub in this process (hub_turn_claim → runTurn → hub_turn_finish) with RECORDED model and
// transcription answers (no model, no OpenAI call — this checks the routes, not the models), the file read back from
// the branch's hub-media as hub-agent reads it. Instead of sending, the queued staff alerts are ASSERTED (hub_staff_sends_claim
// → recorded «skipped»). Nothing reaches YCloud (the branch has no YCloud key). No phone number is written here.
// Setup first (F:/armada-scratch/pgtool/h7-setup.mjs): the switches, «الفويس» / «الصور» on at Airport Road, an always-on
// staff slot, the signing secret, the synthetic files and their signed links; hub-agent deleted on the branch (it races).
// PREVIEW BRANCH ONLY (CLAUDE.md §11 «Test targets»; production refused, no production mode).
//   node scripts/hub-media-branch.mjs --branch <keys.json>      keys.json: { url, anon, service, hook, secret, channels, media }
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { branchKeys, harness, client } from './hub-branch-lib.mjs';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { mediaLine } from '../supabase/functions/_shared/hub/media.ts';
import { dashboardAdapter } from '../supabase/functions/_shared/hub/adapter/index.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';

const K = branchKeys('hub-media-branch');
if (!K.hook || !K.secret || !K.media?.ogg || !K.media?.png) {
  console.error('hub-media-branch: the keys file needs the hook token, the webhook secret and the two media links (h7-setup.mjs)');
  process.exit(2);
}
const { check, done } = harness('hub-media-branch');
const c = client(K);
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
};
const NUM = Object.fromEntries((K.channels ?? []).map((x) => [x.key, x.address]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-5);
const guestPhone = (n) => `+9665${RUN}${String(n).padStart(3, '0')}`;
const STAFF = `+1${5550100001}`;

// ── the recorded answers ──
const U = (o = {}) => JSON.stringify({ kind: 'hotel_question', sensitive: null, ack_only: false, intents: ['facility_question'], topics: ['parking'], new_topic_hint: null, branch: null,
  check_in: null, check_out: null, nights: null, dates_text: null, dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null,
  rooms_count: null, guest_name: null, booking_ref: null, language: 'ar', complaint: false, confidence: {}, ...o });
let vision = '';
let transcript = { ok: true, text: 'هل عندكم مواقف للسيارات؟', languages: ['ar'], seconds: 12, latency_ms: 1 };
const calls = [];
const model = async (call) => {
  calls.push(call.layer);
  const text = call.layer === 'vision' ? vision
    : call.layer === 'understand' || call.layer === 'tag' ? U()
    : call.layer === 'compose' ? JSON.stringify({ reply: call.user.includes('problem_ack') ? 'نأسف لذلك، وصلت الصورة إلى فريقنا.' : 'نعم، المواقف مجانية للضيوف.', used_card_ids: [], unanswered: [] })
    : '';
  return text ? { ok: true, text, input_tokens: 100, output_tokens: 30, latency_ms: 1 } : { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' };
};
const loads = [];
const deps = {
  model, knowledge: (u, t, L, b) => svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: L, p_branch: b }), offers: async () => [],
  adapter: dashboardAdapter((fn, args) => svc(fn, args)), content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (n, L) => sarText(n, L),
  media: {
    // as hub-agent reads it: the stored path in the private bucket, with the service role
    load: async (m) => {
      loads.push(m.media_path ?? null);
      if (!m.media_path) return null;
      const r = await fetch(`${K.url}/storage/v1/object/hub-media/${m.media_path}`, { headers: { apikey: K.service, Authorization: `Bearer ${K.service}` } });
      return r.ok ? { bytes: new Uint8Array(await r.arrayBuffer()), mime: String(m.media_mime ?? 'application/octet-stream') } : null;
    },
    transcribe: async () => transcript,
  },
};

const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', K.secret).update(`${t}.${raw}`).digest('hex')}`;
};
const hook = (raw) => fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(K.hook)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
async function inbound(unit, phone, type, extra) {
  const id = `qm${RUN}${randomUUID().slice(0, 8)}`;
  const msg = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA Media' }, to: NUM[unit], sendTime: new Date().toISOString(), type, ...extra };
  const res = await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: msg }));
  return { status: res.status, id };
}
const wait = async (fn, tries = 25, ms = 700) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(ms);
  }
  return null;
};
const msgRow = (provider) => wait(async () => (await c.rest(`/rest/v1/hub_messages?select=id,conversation_id,created_at,kind,media_path,media_mime,transcript,transcript_seconds,media_category,media_status&provider_message_id=eq.${provider}`)).json?.[0] ?? null);
async function guest(unit, phone, type, extra) {
  const p = await inbound(unit, phone, type, extra);
  if (p.status !== 200) return { error: `webhook ${p.status}` };
  const m = await msgRow(p.id);
  if (!m) return { error: 'not stored' };
  const turn = await wait(async () => (await c.rest(`/rest/v1/hub_turns?select=id,status,kind&first_inbound_id=eq.${m.id}`)).json?.[0] ?? null);
  if (!turn) return { error: 'no turn', m };
  let claim = null;
  for (let i = 0; i < 16; i++) {
    claim = await svc('hub_turn_claim', { p_turn: turn.id });
    if (claim?.claimed) break;
    await sleep(1000);
  }
  if (!claim?.claimed) return { error: `not claimed: ${claim?.reason}`, m };
  calls.length = 0;
  loads.length = 0;
  const out = await runTurn(claim, deps);
  const fin = await c.rpc('hub_turn_finish', { p_turn: turn.id, p: out.finish });
  if (fin.status >= 300) return { error: `finish ${fin.status} ${fin.text.slice(0, 160)}` };
  const after = (await c.rest(`/rest/v1/hub_messages?select=transcript,transcript_seconds,transcript_language,media_category,media_status,media_path&id=eq.${m.id}`)).json?.[0];
  const conv = (await c.rest(`/rest/v1/hub_conversations?select=state,priority,handoff_id&id=eq.${m.conversation_id}`)).json?.[0];
  const replies = (await c.rest(`/rest/v1/hub_messages?select=body,status&conversation_id=eq.${m.conversation_id}&direction=eq.out&author=eq.assistant`)).json ?? [];
  return { m, claim, finish: out.finish, after, conv, replies: replies.map((x) => x.body), calls: [...calls], loads: [...loads] };
}
async function alerts() {
  const items = await svc('hub_staff_sends_claim', { p_limit: 50, p_test: false });
  for (const it of items) await svc('hub_staff_send_finish', { p_send: it.id, p_status: 'skipped', p_provider_id: null, p_error_code: 'qa' });
  return items.filter((i) => i.template === 'hub_staff_alert');
}
const NOTICE = 'سيكمل معك أحد أفراد فريقنا في هذه المحادثة.';
const audio = (link) => ({ audio: { id: `media-${RUN}`, mime_type: 'audio/ogg; codecs=opus', link } });
const image = (link, caption) => ({ image: { id: `media-${RUN}`, mime_type: 'image/png', link, ...(caption ? { caption } : {}) } });

await alerts();

// ── 1. a voice note: downloaded, transcribed, answered in text ──
let r = await guest('airport-road', guestPhone(1), 'audio', audio(K.media.ogg));
check(!r.error, '1 the voice note through the webhook → stored → its turn', r.error);
check(/^airport-road\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.ogg$/.test(r.after?.media_path ?? ''), '1 wa-automation downloaded the file into hub-media', r.after?.media_path);
check(r.claim?.unit?.media?.voice === true && r.claim?.voice?.cap_seconds === 3600, '1 the claim: «الفويس» on, 60 minutes', JSON.stringify(r.claim?.unit?.media));
check(!!r.loads?.[0] && r.loads[0] === r.after?.media_path, '1 the engine read the stored file');
check(r.after?.media_status === 'transcribed' && r.after?.transcript === 'هل عندكم مواقف للسيارات؟' && Number(r.after?.transcript_seconds) > 11, '1 the transcript stored on the message', JSON.stringify(r.after));
check(r.finish?.state !== 'human' && r.replies.some((b) => b.includes('المواقف مجانية')), '1 answered in text, queued (never sent: the branch has no YCloud key)', JSON.stringify(r.replies));
const usage = (await c.rest(`/rest/v1/hub_usage_daily?select=audio_seconds,cost_usd,source&layer=eq.transcribe`)).json ?? [];
check(usage.some((u) => u.source === 'turn' && Number(u.audio_seconds) >= 12 && Number(u.cost_usd) > 0), '1 the transcription counted per minute (layer transcribe)', JSON.stringify(usage));

// ── 2. a voice note that cannot be transcribed → the notice, the team, a staff alert with the voice line ──
transcript = { ok: false, text: '', languages: [], seconds: null, latency_ms: 1, error: 'network' };
r = await guest('airport-road', guestPhone(2), 'audio', audio(K.media.ogg));
check(!r.error && r.finish?.state === 'human' && r.finish?.reason === 'voice_failed', '2 a failed transcription → the team', r.error ?? r.finish?.reason);
check(r.replies.length === 1 && r.replies[0].endsWith(NOTICE), '2 the guest gets the hand-off notice — never silence', JSON.stringify(r.replies));
check(r.after?.media_status === 'failed_transcribe' && !r.after?.transcript, '2 the fault stored (failed_transcribe)');
let a = await alerts();
check(a.length === 1 && a[0].to === STAFF && a[0].handoff?.summary === mediaLine('voice_failed'), '2 ONE staff alert to the on-shift slot, «المطلوب» = the voice line', JSON.stringify(a.map((x) => x.handoff?.summary)));
transcript = { ok: true, text: 'هل عندكم مواقف للسيارات؟', languages: ['ar'], seconds: 12, latency_ms: 1 };

// ── 3. an identity image → the team, nothing read, no other model call ──
vision = JSON.stringify({ category: 'id_document', reading: 'should never be kept', problem_line: '' });
r = await guest('airport-road', guestPhone(3), 'image', image(K.media.png, 'هذه هويتي'));
check(!r.error && r.finish?.reason === 'id_document' && r.replies.length === 1 && r.replies[0].endsWith(NOTICE), '3 an identity image → the notice and the team', r.error ?? JSON.stringify(r.replies));
check(r.calls.join() === 'vision', '3 ONE vision call — never understand / compose / summary', r.calls.join());
check(r.after?.media_category === 'id_document' && !JSON.stringify(r.after).includes('should never'), '3 only the category stored');
a = await alerts();
check(a.length === 1 && a[0].handoff?.summary === mediaLine('id_document'), '3 the staff alert names a document image', JSON.stringify(a.map((x) => x.handoff?.summary)));

// ── 4. a problem photo → high priority, the acknowledgement and the notice, the photo's line in the alert ──
vision = JSON.stringify({ category: 'problem', reading: '', problem_line: 'تسرّب مياه من سقف الحمام' });
r = await guest('airport-road', guestPhone(4), 'image', image(K.media.png, 'الحمام يخر موية'));
check(!r.error && r.finish?.reason === 'problem_photo' && r.conv?.priority === 'high', '4 a problem photo → the team, the conversation high priority', r.error ?? `${r.finish?.reason} ${r.conv?.priority}`);
check(r.replies.length === 1 && r.replies[0].includes('نأسف') && r.replies[0].endsWith(NOTICE), '4 the acknowledgement and the notice in ONE message', JSON.stringify(r.replies));
a = await alerts();
check(a.length === 1 && a[0].handoff?.summary === 'تسرّب مياه من سقف الحمام', '4 hub_staff_alert {{5}} = the photo\'s line', JSON.stringify(a.map((x) => x.handoff?.summary)));

// ── 5. a sticker as the first message → the short greeting reply, no hand-off ──
r = await guest('airport-road', guestPhone(5), 'sticker', { sticker: { id: `st-${RUN}`, mime_type: 'image/webp', link: K.media.png } });
check(!r.error && r.finish?.state !== 'human' && r.replies.length === 1 && r.replies[0].includes('كيف نساعدك'), '5 a sticker → «كيف نساعدك؟», no hand-off', r.error ?? JSON.stringify(r.replies));
check((await alerts()).length === 0, '5 … and no staff alert');

// ── 6. the daily minutes used up → the team and ONE voice_cap alert ──
await fetch(`${K.url}/rest/v1/settings?key=eq.hub_voice_daily_minutes`, { method: 'PATCH', headers: { apikey: K.service, Authorization: `Bearer ${K.service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 1 }) });
r = await guest('airport-road', guestPhone(6), 'audio', audio(K.media.ogg));
const r2 = await guest('airport-road', guestPhone(7), 'audio', audio(K.media.ogg));
check(!r.error && r.finish?.reason === 'voice_capped' && r2.finish?.reason === 'voice_capped', '6 past the daily minute: voice notes to the team untranscribed', `${r.error ?? r.finish?.reason} ${r2.error ?? r2.finish?.reason}`);
const cap = (await c.rest(`/rest/v1/hub_alerts?select=kind,payload&kind=eq.voice_cap&acknowledged_at=is.null`)).json ?? [];
check(cap.length === 1, '6 ONE voice_cap alert for the unit today (its email by hub-agent)', JSON.stringify(cap));
await fetch(`${K.url}/rest/v1/settings?key=eq.hub_voice_daily_minutes`, { method: 'PATCH', headers: { apikey: K.service, Authorization: `Bearer ${K.service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 60 }) });
await alerts();

// ── 7. «الصور» off at Shafa Road → the image goes to the team as before H7, no vision call ──
r = await guest('shafa-road', guestPhone(8), 'image', image(K.media.png));
check(!r.error && r.finish?.reason === 'media' && !r.calls.includes('vision') && !r.after?.media_status, '7 «الصور» off: the media notice and the team, nothing classified', r.error ?? `${r.finish?.reason} ${r.calls}`);

done();
