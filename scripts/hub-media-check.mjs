// Guest Hub H7 — voice notes and images (15 Nov 2026; DECISIONS.md 2026-11-15 «Guest Hub H7: voice and images»).
// OFFLINE and fast (FAST_CHECKS): no model, no OpenAI, no file leaves this machine. Every media route of the engine:
//   1. media.ts: the length of a voice note (Ogg Opus exactly, WAV, the size estimate), the transcript's verdict, OpenAI's
//      answers parsed (text, languages, usage.seconds, 401 / 429 / 413 / 400), the vision answer parsed (an identity or
//      payment image keeps its category ONLY; digit runs and emails cut), the problem line's check, the per-minute cost.
//   2. the engine (runTurn with stubs): a voice note answered from its transcript; longer than 5 minutes, past the daily
//      minutes, not downloaded, failed, empty, no language → the hand-off notice and the team, never silence; an identity /
//      payment image → the team, nothing read, no compose call, no caption in any model call; a screenshot answered with its
//      reading; a problem photo → high priority, an acknowledgement + the notice in ONE message, the photo's line as the
//      staff alert's «المطلوب»; a room photo without a caption → one clarifying question; a sticker → like an emoji; a video,
//      a file, a location → the team as before; every switch off → exactly the behaviour before H7.
//   3. the test lab's recorded media (eval.ts bankMedia / fixtureMedia): every token, and a bank conversation graded.
//   node scripts/hub-media-check.mjs
import { audioCost, audioSeconds, mediaLine, oggOpusSeconds, parseTranscription, parseVision, problemLineOk, transcriptVerdict, wavSeconds, VOICE_MAX_SECONDS } from '../supabase/functions/_shared/hub/media.ts';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { decide } from '../supabase/functions/_shared/hub/machine.ts';
import { bankMedia, fixtureMedia, runItem } from '../supabase/functions/_shared/hub/eval.ts';
import { gradeConversation } from '../supabase/functions/_shared/hub/grade.ts';
import { requestBody } from '../supabase/functions/_shared/hub/model.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { CONTENT, claimFor, knowledgeFor } from './hub-fixtures-lib.mjs';
import { readFileSync } from 'node:fs';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ═══ 1. media.ts ═══
function ogg(seconds, preSkip = 312) {
  const page = (granule, body) => {
    const h = new Uint8Array(27 + 1 + body.length);
    h.set([0x4f, 0x67, 0x67, 0x53, 0, 0]);
    let g = BigInt(granule);
    for (let k = 0; k < 8; k++) {
      h[6 + k] = Number(g & 0xffn);
      g >>= 8n;
    }
    h[26] = 1;
    h[27] = body.length;
    h.set(body, 28);
    return h;
  };
  const head = new Uint8Array(19);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1, preSkip & 0xff, preSkip >> 8, 0x80, 0xbb, 0, 0, 0, 0, 0]);
  const p1 = page(0, head);
  const p2 = page(Math.round(seconds * 48000) + preSkip, new Uint8Array(40).fill(7));
  const out = new Uint8Array(p1.length + 300 + p2.length);
  out.set(p1, 0);
  out.set(p2, p1.length + 300);
  return out;
}
{
  check(Math.abs(oggOpusSeconds(ogg(12.5)) - 12.5) < 0.01, `Ogg Opus: the last page's granule less the pre-skip (${oggOpusSeconds(ogg(12.5))})`);
  check(Math.abs(oggOpusSeconds(ogg(301)) - 301) < 0.01, 'Ogg Opus: a 5-minute-and-1-second note');
  check(oggOpusSeconds(new Uint8Array(100)) === null, 'not Ogg: null');
  const wav = new Uint8Array(44 + 32000);
  const dv = new DataView(wav.buffer);
  [..."RIFF"].forEach((c, i) => (wav[i] = c.charCodeAt(0)));
  [..."WAVE"].forEach((c, i) => (wav[8 + i] = c.charCodeAt(0)));
  [..."fmt "].forEach((c, i) => (wav[12 + i] = c.charCodeAt(0)));
  dv.setUint32(16, 16, true);
  dv.setUint32(28, 16000, true);
  [..."data"].forEach((c, i) => (wav[36 + i] = c.charCodeAt(0)));
  dv.setUint32(40, 32000, true);
  check(wavSeconds(wav) === 2, `WAV: data size ÷ byte rate (${wavSeconds(wav)})`);
  const est = audioSeconds(new Uint8Array(20000), 'audio/ogg');
  check(!est.exact && est.seconds === 10, 'an unreadable Ogg file: estimated at 16 kbps (errs long)');
  check(audioSeconds(new Uint8Array(32000), 'audio/mpeg').seconds === 8, 'another format: estimated at 32 kbps');
  check(VOICE_MAX_SECONDS === 300, 'the voice limit is 5 minutes');
  check(audioCost({ 'gpt-transcribe': { per_minute: 0.0045 } }, 'gpt-transcribe', 120) === 0.009, 'two minutes of gpt-transcribe = USD 0.009');
  check(audioCost({}, 'gpt-transcribe', 120) === 0, 'no price: 0 (never a guess)');
}
{
  const ok = (text, languages = []) => ({ ok: true, text, languages, seconds: 10, latency_ms: 1 });
  check(transcriptVerdict(ok('أبغى أحجز غرفة', ['ar'])).ok === true, 'an Arabic transcript: ok');
  check(transcriptVerdict(ok('do you have parking', [])).language === 'en', 'an English transcript with no language: en');
  check(transcriptVerdict(ok('', [])).status === 'empty', 'nothing said: empty');
  check(transcriptVerdict(ok('…  ', [])).status === 'empty', 'only punctuation: empty');
  check(transcriptVerdict(ok('你好你好', [])).status === 'unknown_language', 'no Arabic or Latin letter: unknown language');
  check(transcriptVerdict(ok('bonjour je voudrais', ['fr'])).language === 'fr', 'a third language OpenAI is sure of: kept (the third-language reply follows)');
  const p = parseTranscription(200, JSON.stringify({ text: 'السلام عليكم', languages: [{ code: 'ar' }], usage: { type: 'duration', seconds: 7.4 } }), 5);
  check(p.ok && p.text === 'السلام عليكم' && p.languages[0] === 'ar' && p.seconds === 7.4, 'OpenAI 200: text, languages, usage.seconds');
  check(parseTranscription(401, '{}', 1).error === 'not_configured', '401: not configured');
  check(parseTranscription(429, '{"error":{"code":"insufficient_quota"}}', 1).error === 'quota', '429 quota: quota');
  check(parseTranscription(429, '{}', 1).error === 'rate_limit', '429: rate limit');
  check(parseTranscription(413, '{}', 1).error === 'too_large', '413: too large');
  check(parseTranscription(200, 'not json', 1).ok === false, 'a broken answer: a failure');
}
{
  const v = parseVision('{"category":"id_document","reading":"Ahmed 1234567890","problem_line":"x"}');
  check(v.category === 'id_document' && v.reading === '' && v.problem_line === '', 'an identity image: the category ONLY — the reading thrown away');
  const pay = parseVision('noise {"category":"payment","reading":"card 4111 1111 1111 1111","problem_line":""}');
  check(pay.category === 'payment' && pay.reading === '', 'a payment image: the category only');
  const sc = parseVision('{"category":"screenshot","reading":"Booking at Armada Residence Airport Road 25–27 Nov, call 0501234567, mail a@b.co","problem_line":""}');
  check(sc.category === 'screenshot' && sc.reading.includes('25–27 Nov') && !/0501234567/.test(sc.reading) && !sc.reading.includes('a@b.co'), `a screenshot: read, the phone and the email cut (${sc.reading})`);
  check(parseVision('{"category":"selfie"}') === null && parseVision('nothing') === null, 'an unknown category or no JSON: a failure');
  const pr = parseVision('{"category":"problem","reading":"","problem_line":"تسرّب مياه من سقف الحمام"}');
  check(pr.problem_line === 'تسرّب مياه من سقف الحمام' && problemLineOk(pr.problem_line), 'a problem photo: its staff line');
  check(!problemLineOk('الغرفة 305 فيها تسرب') && !problemLineOk('leak in the bathroom') && !problemLineOk('x'.repeat(130)) && !problemLineOk('شقق مخدومة متسخة', ['شقق مخدومة']),
    'the staff line: no digit, Arabic, ≤ 120, nothing forbidden');
  const body = requestBody({ layer: 'vision', model: 'claude-haiku-5-5', system: 's', user: 'u', images: [{ media_type: 'image/png', data: 'AAAA' }] });
  const content = body.messages.at(-1).content;
  check(Array.isArray(content) && content[0].type === 'image' && content[0].source.type === 'base64' && content[1].type === 'text', 'the vision call: the image block first, then the user text');
  check(typeof requestBody({ layer: 'compose', model: 'claude-sonnet-5-5', system: 's', user: 'u' }).messages.at(-1).content === 'string', 'every other call: plain text (unchanged)');
  for (const k of ['voice_failed', 'voice_too_long', 'voice_capped', 'id_document', 'image_failed', 'problem_photo']) check(/[؀-ۿ]/.test(mediaLine(k)) && mediaLine(k).length <= 120, `copy.md §5.2 ${k}: an Arabic staff line ≤ 120`);
}

// ═══ 2. the engine ═══
const NOTICE = 'سيكمل معك أحد أفراد فريقنا في هذه المحادثة.';
const MEDIA_NOTICE = 'وصلتنا رسالتك، وسيطّلع عليها أحد أفراد فريقنا ويرد عليك هنا.';
const understanding = (o) => JSON.stringify({ kind: 'hotel_question', sensitive: null, ack_only: false, intents: ['facility_question'], topics: ['parking'], new_topic_hint: null, branch: null,
  check_in: null, check_out: null, nights: null, dates_text: null, dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null,
  rooms_count: null, guest_name: null, booking_ref: null, language: 'ar', complaint: false, confidence: {}, ...o });
const composed = (reply, used = []) => JSON.stringify({ reply, used_card_ids: used, unanswered: [] });
function stubModel(map) {
  const calls = [];
  const fn = async (c) => {
    calls.push(c);
    const v = typeof map[c.layer] === 'function' ? map[c.layer](c) : map[c.layer];
    if (v === undefined) return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' };
    return { ok: true, text: v, input_tokens: 100, output_tokens: 40, latency_ms: 1 };
  };
  return { fn, calls };
}
const transcribeStub = (r) => {
  const calls = [];
  return { calls, fn: async (f, o) => { calls.push({ size: f.bytes.length, model: o.model, languages: o.languages }); return typeof r === 'function' ? r(f, o) : r; } };
};
function setup({ messages, voice = true, images = true, left = 3600, model = {}, transcript = null, load = 'ogg12' }) {
  const c = claimFor({ id: 'h7', unit: 'airport-road', language: 'ar', messages: ['x'] });
  c.turn.mode = 'live';
  // later in an episode (the greeting line of a first reply is checked apart)
  c.conversation.first_reply = false;
  c.messages = messages;
  c.unit.media = { voice, images };
  c.voice = { cap_seconds: left, used_seconds: 0 };
  c.settings.models = { ...c.settings.models, transcribe: 'gpt-transcribe', vision: 'claude-haiku-5-5' };
  const m = stubModel(model);
  const t = transcribeStub(transcript ?? { ok: true, text: 'هل عندكم مواقف للسيارات؟', languages: ['ar'], seconds: 4.2, latency_ms: 1 });
  const loads = [];
  const deps = {
    model: m.fn, knowledge: async (u, tp, L, b) => knowledgeFor(u, tp, L, b), offers: async () => [],
    adapter: { source: 'fixture', roomTypes: async () => [], fromPrice: async () => null, quote: async () => ({ kind: 'not_bookable', reason: 'fixture' }), book: async () => ({ kind: 'not_bookable', reason: 'skill_off' }) },
    content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (x, L) => sarText(x, L),
    media: {
      load: async (msg) => {
        loads.push(msg.id);
        if (load === null) return null;
        if (msg.kind === 'image') return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mime: 'image/png' };
        return { bytes: load === 'long' ? ogg(301) : ogg(12), mime: 'audio/ogg' };
      },
      transcribe: t.fn,
    },
  };
  return { claim: c, deps, model: m, transcribe: t, loads };
}
const voiceMsg = (id = 'm-v') => ({ id, kind: 'audio', body: null, payload: { media_id: 'v' } });
const imageMsg = (id = 'm-i', caption = null) => ({ id, kind: 'image', body: caption, payload: { media_id: 'i' } });
const bodies = (o) => o.finish.messages.map((m) => m.body).join('\n');
const PARKING = understanding({});

// 2.1 a voice note answered from its transcript
{
  const s = setup({ messages: [voiceMsg()], model: { understand: PARKING, compose: composed('نعم، المواقف مجانية للضيوف.', ['k-parking']) } });
  const o = await runTurn(s.claim, s.deps);
  check(s.transcribe.calls.length === 1 && s.transcribe.calls[0].model === 'gpt-transcribe' && s.transcribe.calls[0].languages.join() === 'ar,en', 'voice: gpt-transcribe with the expected languages ar, en');
  const u = s.model.calls.find((c) => c.layer === 'understand');
  check(u && u.user.includes('هل عندكم مواقف للسيارات؟'), 'voice: the transcript is the guest text of the understanding');
  check(o.finish.media?.[0]?.status === 'transcribed' && o.finish.media[0].transcript === 'هل عندكم مواقف للسيارات؟' && Math.abs(o.finish.media[0].seconds - 12) < 0.05, 'voice: transcript and length stored');
  check(o.finish.audio?.[0]?.seconds === 4.2 && o.finish.audio[0].ok, 'voice: the billed seconds are OpenAI\'s usage.seconds');
  check(o.finish.state !== 'human' && bodies(o).includes('المواقف مجانية'), `voice: answered in text (${bodies(o)})`);
  check(!s.model.calls.some((c) => c.layer === 'vision'), 'voice: no vision call');
}
// the first reply of an episode: the greeting line, then the notice (one message)
{
  const s = setup({ messages: [voiceMsg()], load: null });
  s.claim.conversation.first_reply = true;
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.messages.length === 1 && bodies(o).startsWith('مرحبًا بك في') && bodies(o).endsWith(NOTICE), `a failed voice note as the first message: the greeting, then the notice (${bodies(o)})`);
}
// a retried turn reuses the stored transcript (no second OpenAI call)
{
  const m = { ...voiceMsg(), transcript: 'هل عندكم مواقف؟' };
  const s = setup({ messages: [m], model: { understand: PARKING, compose: composed('نعم، المواقف مجانية.') } });
  await runTurn(s.claim, s.deps);
  check(s.transcribe.calls.length === 0 && s.loads.length === 0, 'a retried turn: the stored transcript, no download, no OpenAI call');
}
// 2.2 the failures — never silence, the notice, the team, a staff line, never «لم أعرف الإجابة»
const voiceCases = [
  ['too long', { load: 'long' }, 'too_long', 'voice_too_long', 0],
  ['past the daily minutes', { left: 5 }, 'voice_capped', 'voice_capped', 0],
  ['not downloaded', { load: null }, 'failed_download', 'voice_failed', 0],
  ['the transcription failed', { transcript: { ok: false, text: '', languages: [], seconds: null, latency_ms: 1, error: 'network' } }, 'failed_transcribe', 'voice_failed', 1],
  ['nothing said', { transcript: { ok: true, text: '  ', languages: [], seconds: 3, latency_ms: 1 } }, 'empty', 'voice_failed', 1],
  ['no language', { transcript: { ok: true, text: '你好你好你好', languages: [], seconds: 3, latency_ms: 1 } }, 'unknown_language', 'voice_failed', 1],
];
for (const [label, o2, status, reason, calls] of voiceCases) {
  const s = setup({ messages: [voiceMsg()], ...o2 });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.state === 'human' && o.finish.reason === reason, `voice ${label}: the team (${o.finish.state} ${o.finish.reason})`);
  check(bodies(o) === NOTICE, `voice ${label}: the hand-off notice, never silence (${bodies(o)})`);
  check(o.finish.media?.[0]?.status === status, `voice ${label}: status ${status} stored (${o.finish.media?.[0]?.status})`);
  check(s.transcribe.calls.length === calls, `voice ${label}: ${calls} OpenAI call(s)`);
  check(o.finish.handoff_summary === mediaLine(reason), `voice ${label}: the staff alert's line is copy.md §5.2 ${reason}`);
  check(!(o.finish.unanswered ?? []).length && !s.model.calls.some((c) => c.layer === 'summary'), `voice ${label}: never «لم أعرف الإجابة», no summary model call`);
}
// 2.3 images
{
  const s = setup({ messages: [imageMsg('m-i', 'هذه هويتي للتسجيل')], model: { vision: '{"category":"id_document","reading":"Ahmed 1012345678","problem_line":""}' } });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.state === 'human' && o.finish.reason === 'id_document' && bodies(o) === NOTICE, `an identity image: the team with the hand-off notice (${bodies(o)})`);
  check(o.finish.media?.[0]?.category === 'id_document' && !('transcript' in o.finish.media[0] && o.finish.media[0].transcript), 'an identity image: only the category stored');
  const layers = s.model.calls.map((c) => c.layer);
  check(layers.join() === 'vision', `an identity image: ONE vision call, never understand / compose / summary (${layers})`);
  check(!JSON.stringify(o.finish).includes('1012345678') && !JSON.stringify(o.finish).includes('Ahmed'), 'an identity image: nothing read from it anywhere in the finish');
  check(o.finish.handoff_summary === mediaLine('id_document'), 'an identity image: the staff line of copy.md §5.2');
  const v = s.model.calls[0];
  check(v.images?.length === 1 && v.images[0].media_type === 'image/png' && v.system.includes('id_document'), 'the vision call carries the image and prompts.md §10');
}
{
  const s = setup({ messages: [imageMsg()], model: { vision: '{"category":"payment","reading":"","problem_line":""}' } });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.reason === 'id_document' && bodies(o) === NOTICE && s.model.calls.length === 1, 'a payment receipt: the team, nothing composed');
}
{
  const s = setup({ messages: [imageMsg('m-i', 'كم سعر الإفطار؟')],
    model: { vision: '{"category":"screenshot","reading":"Armada Residence Airport Road — breakfast","problem_line":""}', understand: understanding({ topics: ['breakfast'], intents: ['facility_question'] }), compose: composed('الإفطار متاح.') } });
  const o = await runTurn(s.claim, s.deps);
  const u = s.model.calls.find((c) => c.layer === 'understand');
  check(u && u.user.includes('[لقطة شاشة أرسلها الضيف تُظهر: Armada Residence Airport Road — breakfast]') && u.user.includes('كم سعر الإفطار؟'), 'a screenshot: its reading and the caption read together');
  check(o.finish.state !== 'human' && bodies(o).includes('الإفطار متاح'), 'a screenshot: answered under the normal rules');
  check(o.finish.media?.[0]?.category === 'screenshot' && !JSON.stringify(o.finish.media).includes('breakfast'), 'a screenshot: only the category stored, never the reading');
}
{
  const s = setup({ messages: [imageMsg('m-i', 'المكيف ما يشتغل')], model: { vision: '{"category":"problem","reading":"","problem_line":"جهاز التكييف لا يعمل وتظهر عليه إشارة عطل"}', compose: composed('نأسف لذلك، وصلت صورتك إلى الفريق.') } });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.state === 'human' && o.finish.reason === 'problem_photo' && o.finish.priority === 'high', `a problem photo: the team, high priority (${o.finish.reason} ${o.finish.priority})`);
  check(o.finish.messages.length === 1 && bodies(o).startsWith('نأسف لذلك') && bodies(o).endsWith(NOTICE), `a problem photo: the acknowledgement and the notice in ONE message (${bodies(o)})`);
  check(o.finish.handoff_summary === 'جهاز التكييف لا يعمل وتظهر عليه إشارة عطل', 'a problem photo: the photo\'s line is hub_staff_alert {{5}}');
  const c = s.model.calls.find((x) => x.layer === 'compose');
  check(c && c.user.includes('ACTION: problem_ack') && c.user.includes('جهاز التكييف'), 'a problem photo: compose ACTION problem_ack with the photo\'s line');
}
{
  const s = setup({ messages: [imageMsg()], model: { vision: '{"category":"problem","reading":"","problem_line":"تسرب في الغرفة 305"}' } });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.handoff_summary === mediaLine('problem_photo') && bodies(o).includes('نأسف لذلك، وصلت الصورة إلى فريقنا.') && bodies(o).includes(NOTICE),
    `a problem line with a number, the model unreachable: the fixed staff line and the fixed acknowledgement (${bodies(o)})`);
}
{
  const s = setup({ messages: [imageMsg()], model: { vision: '{"category":"place","reading":"a living room with a sofa","problem_line":""}', understand: understanding({ kind: 'unclear', intents: ['other'], topics: [] }), compose: composed('هل تقصد الاستفسار عن هذه الغرفة أم عن حجز؟') } });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.decision?.chat === 'clarify' && o.finish.state !== 'human' && bodies(o).includes('؟'), `a room photo with no caption: one clarifying question (${o.finish.decision?.chat})`);
}
{
  const s = setup({ messages: [imageMsg()], model: {} });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.reason === 'image_failed' && bodies(o) === NOTICE && o.finish.media?.[0]?.status === 'failed_vision', 'the vision call failed: the notice, the team, failed_vision');
}
{
  const s = setup({ messages: [imageMsg()], load: null });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.reason === 'image_failed' && o.finish.media?.[0]?.status === 'failed_download' && s.model.calls.length === 0, 'an image not downloaded: failed_download, no model call');
}
{
  const s = setup({ messages: [voiceMsg('m-v'), imageMsg('m-i')], model: { vision: '{"category":"id_document","reading":"","problem_line":""}', understand: PARKING, compose: composed('x') } });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.reason === 'id_document' && !s.model.calls.some((c) => c.layer === 'compose' || c.layer === 'understand'), 'a voice note with an identity image: the identity route wins, nothing composed');
}
// 2.4 sticker, video, switches off
{
  const st = { id: 'm-s', kind: 'sticker', body: null, payload: { media_id: 's' } };
  let s = setup({ messages: [st] });
  s.claim.conversation.first_reply = true;
  let o = await runTurn(s.claim, s.deps);
  check(o.finish.state !== 'human' && bodies(o).includes('كيف نساعدك') && bodies(o).includes('مرحبًا بك في') && s.model.calls.length === 0, `a sticker as the first message: the greeting reply, no model call (${bodies(o)})`);
  s = setup({ messages: [st] });
  o = await runTurn(s.claim, s.deps);
  check(o.finish.messages.length === 0 && o.finish.state !== 'human' && !(o.finish.unanswered ?? []).length, 'a sticker later in the episode: nothing, no hand-off, never «لم أعرف الإجابة»');
  s = setup({ messages: [st], images: false });
  o = await runTurn(s.claim, s.deps);
  check(o.finish.state === 'human' && bodies(o) === MEDIA_NOTICE, 'a sticker with «الصور» off: the team as before H7');
}
for (const kind of ['video', 'document', 'location', 'contacts']) {
  const s = setup({ messages: [{ id: 'm-x', kind, body: null, payload: {} }] });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.state === 'human' && o.finish.reason === 'media' && bodies(o) === MEDIA_NOTICE && !o.finish.media && s.loads.length === 0, `a ${kind}: the team with the media notice, as decided`);
}
{
  const s = setup({ messages: [voiceMsg()], voice: false });
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.state === 'human' && o.finish.reason === 'media' && bodies(o) === MEDIA_NOTICE && s.transcribe.calls.length === 0 && s.loads.length === 0 && !o.finish.media,
    '«الفويس» off: the voice note goes to the team exactly as before H7 — no download, no transcription');
  const s2 = setup({ messages: [imageMsg()], images: false });
  const o2 = await runTurn(s2.claim, s2.deps);
  check(o2.finish.reason === 'media' && s2.model.calls.length === 0 && !o2.finish.media, '«الصور» off: the image goes to the team as before H7, no vision call');
  const s3 = setup({ messages: [voiceMsg()] });
  delete s3.deps.media;
  const o3 = await runTurn(s3.claim, s3.deps);
  check(o3.finish.reason === 'media', 'no media deps (an older caller): the team as before');
}
// a tag turn (staff own the conversation) transcribes for the inbox, sends nothing
{
  const s = setup({ messages: [voiceMsg()], model: { tag: PARKING } });
  s.claim.turn.kind = 'tag';
  const o = await runTurn(s.claim, s.deps);
  check(o.finish.messages.length === 0 && o.finish.media?.[0]?.status === 'transcribed', 'a tag turn: transcribed for the team, nothing sent');
}
// the machine alone
{
  const ctx = { unit_kind: 'branch', unit_branch: 'airport-road', skills: [], show_prices: true, window_open: true, failed_understandings: 0, failed_max: 2, out_of_scope: 0, out_of_scope_max: 3,
    group_min_rooms: 5, licences: {}, always_handoff: [], bookings: [], first_reply: false };
  const d = decide({ state: 'inquiry', event: { type: 'guest', understanding: null, kind: 'media', media: { reason: 'problem_photo', priority: 'high', ack: true } }, draft: null, ctx });
  check(d.next === 'human' && d.priority === 'high' && d.actions[0].type === 'chat' && d.actions[0].mode === 'problem_ack' && d.actions[1].type === 'handoff', 'machine: a problem photo → problem_ack then the hand-off, high');
  const w = decide({ state: 'human', event: { type: 'guest', understanding: null, kind: 'media', media: { reason: 'voice_failed' } }, draft: null, ctx: { ...ctx, human_phase: 'waiting', state_before_human: 'inquiry' } });
  check(w.next === 'human' && w.actions.some((a) => a.type === 'handoff_add'), 'machine: a failed voice note while «بانتظار موظف» joins the same hand-off');
}

// ═══ 3. the test lab's recorded media ═══
{
  check(bankMedia('[voice] متى وقت الفطور؟').transcript === 'متى وقت الفطور؟' && bankMedia('[voice:long]').voice === 'long', 'bank: [voice] and [voice:long]');
  const i = bankMedia('[image:screenshot] Booking 25–27 Nov ‖ هذا حجزي؟');
  check(i.kind === 'image' && i.caption === 'هذا حجزي؟' && i.vision.reading === 'Booking 25–27 Nov', 'bank: [image:screenshot] reading ‖ caption');
  check(bankMedia('[image:id_document] anything').vision.reading === '', 'bank: an identity image keeps nothing');
  check(bankMedia('[sticker]').kind === 'sticker' && bankMedia('مرحبا') === null && bankMedia('[button:hubq:book]') === null, 'bank: [sticker]; text and buttons are not media');
  let threw = false;
  try {
    bankMedia('[image:selfie] x');
  } catch {
    threw = true;
  }
  check(threw, 'bank: an unknown category is refused');
  const fm = fixtureMedia();
  const f = await fm.load({ fixture: bankMedia('[voice:long]') });
  check(f.bytes.length === 602000, 'fixtures: [voice:long] reads longer than 5 minutes');
  check((await fm.classify({ fixture: bankMedia('[image:problem] تسرب') })).problem_line === 'تسرب' && (await fm.classify({ inline: { bytes: new Uint8Array(1) } })) === undefined, 'fixtures: a recorded classification; an upload goes to the real call');
}
{
  // one bank conversation through the real engine with recorded model answers
  const c = claimFor({ id: 'ctx', unit: 'airport-road', language: 'ar', messages: ['x'] });
  const ctx = { unit: c.unit, channel: c.channel, licences: c.licences, topics: c.topics, settings: c.settings, forbidden: c.forbidden, today: c.today };
  const m = stubModel({ understand: PARKING, compose: (call) => (call.user.includes('problem_ack') ? composed('نأسف لذلك، وصلت الصورة للفريق.') : composed('نعم، المواقف مجانية.', ['k-parking'])) });
  const deps = { model: m.fn, knowledge: async (u, tp, L, b) => knowledgeFor(u, tp, L, b), offers: async () => [],
    adapter: { source: 'fixture', roomTypes: async () => [], fromPrice: async () => null, quote: async () => ({ kind: 'not_bookable' }), book: async () => ({ kind: 'not_bookable' }) },
    content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (x, L) => sarText(x, L) };
  const item = { key: 'm-test', unit_key: 'airport-road', language: 'ar', messages: ['[voice] فيه مواقف للسيارات؟', '[image:problem] تسرّب مياه من سقف الحمام'], context: {},
    expect: { action: 'conversation', steps: [{ outcome: 'answer', media: 'transcribed' }, { outcome: 'handoff', priority: 'high', category: 'problem', summary_includes: 'تسرّب مياه' }] } };
  const run = await runItem(ctx, item, deps);
  const g = gradeConversation(item, run.outcome);
  check(g.pass, `bank: a voice question answered, then a problem photo to the team (${g.reasons.join(', ')})`);
  check(!m.calls.some((x) => x.layer === 'vision'), 'bank: the lab never makes a vision call for a recorded image');
}
// the conversation bank's media items are well formed
{
  const rows = readFileSync(new URL('../tests/hub-bank/conversations.jsonl', import.meta.url), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((x) => !x._header);
  const media = rows.filter((r) => (r.tags ?? []).includes('media'));
  check(media.length >= 7, `the conversation bank holds the H7 media conversations (${media.length})`);
  for (const r of media) {
    for (const msg of r.messages) if (/^\[(voice|image|sticker|video)/.test(msg)) check(bankMedia(msg) !== null, `${r.id}: ${msg.slice(0, 30)} parses`);
    check(r.expect?.steps?.length === r.messages.length, `${r.id}: one expectation per message`);
  }
  const need = ['voice_answer', 'voice_fail', 'id_image', 'screenshot', 'problem_photo', 'sticker', 'video'];
  for (const k of need) check(media.some((r) => (r.tags ?? []).includes(k)), `the bank covers ${k}`);
}

// ═══ 4. the report, the email, the migration ═══
{
  const { faultsText } = await import('../supabase/functions/_shared/hub/staff.ts');
  const t = faultsText({ branches: { 'airport-road': { voice_failures: 2, image_failures: 1 }, 'shafa-road': { voice_failures: 1 } } });
  check(t.includes('فشل الصوت 3') && t.includes('فشل الصور 1'), `the daily report's «أعطال»: the voice and image faults (${t})`);
  check(faultsText({ branches: {} }) === 'لا يوجد', 'no fault: «لا يوجد»');
  const { hubVoiceCapMail } = await import('../supabase/functions/booking-request/email.ts');
  const content = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
  const mail = hubVoiceCapMail(content, { unit_name: 'فرع طريق المطار', minutes: 60, at: '2026-11-15T10:00:00Z' });
  check(mail.subject === 'حد الرسائل الصوتية اليومي — فرع طريق المطار — AR-HUB-20261115', `the voice-cap email's subject with AR-HUB- (${mail.subject})`);
  check(mail.text.includes('(60 دقيقة)') && mail.text.includes('دون تفريغ') && !/[٠-٩]/.test(mail.text), 'the voice-cap email: the minutes in words, Western digits');
  check(hubVoiceCapMail(content, { unit_name: 'x', minutes: 5, at: '2026-11-15T10:00:00Z' }).text.includes('(5 دقائق)'), 'the voice-cap email: «5 دقائق»');
  const COPY = readFileSync(new URL('../docs/guest-hub/copy.md', import.meta.url), 'utf8');
  check(COPY.includes(`«${content.staff_email.ar.hub_voice_cap.subject}»`) && COPY.includes(`«${content.staff_email.ar.hub_voice_cap.lead}»`), 'the voice-cap email: ui.json = copy.md §7');
  const { migration, OUT_PATH } = await import('./hub-media-migration.mjs');
  const MIG = readFileSync(new URL(`../${OUT_PATH}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  check(MIG === migration(), 'the H7 migration = its generator (node scripts/hub-media-migration.mjs)');
  const stmts = MIG.split(/;\s*\n/).filter((x) => /^\s*(update|delete)\s/im.test(x.replace(/--.*$/gm, '').trim()));
  check(stmts.every((x) => /\swhere\s/i.test(x)), 'every UPDATE / DELETE of the migration carries a WHERE (pg_safeupdate)');
  check(!/\+966\d{6,}/.test(MIG) && !/9665\d{8}/.test(MIG), 'no phone number in the migration');
  check(MIG.includes('add column voice_on boolean not null default false') && MIG.includes('add column images_on boolean not null default false') && !/set (voice_on|images_on) = true/.test(MIG), 'both switches ship OFF, nothing switches one on');
}

if (fails.length) {
  console.error(`hub-media-check: ${fails.length} of ${n} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`hub-media-check: ${n} checks passed`);
