// Guest Hub — a model call that fails (H6 pass 3 / 4, Ahmed 14 Nov 2026; DECISIONS.md 2026-11-14). OFFLINE and fast
// (FAST_CHECKS): every failure is forced and the guest always gets something.
//   1. model.ts retries a rate limit (429), an overload (529 / 503), another 5xx and a network error with backoff (the
//      provider's retry-after honoured, capped), a timeout once; a credit, a bad request or a refusal never; the workspace
//      usage limit is the credit.
//   2. the engine: when understand or compose cannot reach the model, the turn goes to the team with the no-source notice
//      and the error kind — never «كيف نساعدك؟», never silence, never «لم أعرف الإجابة»; the credit sends the notice too;
//      the repeat rule and the rate limits hand off with the general notice.
//   3. the salaam (copy.md §1.5) and the thanks reply (§1.6); a greeting mid-episode.
//   node scripts/hub-failure-check.mjs
import { anthropicModel, backoffMs } from '../supabase/functions/_shared/hub/model.ts';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { CONTENT, claimFor, knowledgeFor } from './hub-fixtures-lib.mjs';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ── 1. the retry rule ──
const resp = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const OK = { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
async function calls(script, opts = {}) {
  const waits = [];
  let i = 0;
  const fetchFn = async () => {
    const s = script[Math.min(i++, script.length - 1)];
    if (s === 'timeout') throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    if (s === 'network') throw new TypeError('network');
    return s;
  };
  const m = anthropicModel('k', fetchFn, 1000, { sleep: async (ms) => { waits.push(ms); }, ...opts });
  const r = await m({ layer: 'understand', model: 'claude-haiku-5-5', system: 's', user: 'u' });
  return { r, n: i, waits };
}
{
  let x = await calls([resp(429, '{}', { 'retry-after': '2' }), resp(429, '{}'), resp(200, OK)]);
  check(x.r.ok && x.n === 3 && x.waits[0] === 2000 && x.waits.length === 2, `429 twice then 200: retried with backoff, retry-after honoured (${x.n} calls, waits ${x.waits})`);
  x = await calls([resp(429, '{}'), resp(429, '{}'), resp(429, '{}'), resp(200, OK)]);
  check(!x.r.ok && x.r.error === 'rate_limit' && x.n === 3, `429 every time: three calls at most, then rate_limit (${x.n})`);
  x = await calls([resp(529, '{"error":{"type":"overloaded_error"}}'), resp(200, OK)]);
  check(x.r.ok && x.n === 2, '529 (overloaded) then 200: retried');
  x = await calls([resp(503, '{}'), resp(502, '{}'), resp(200, OK)]);
  check(x.r.ok && x.n === 3, '503, 502 then 200: retried');
  x = await calls([resp(500, '{}'), resp(500, '{}'), resp(500, '{}')]);
  check(!x.r.ok && x.r.error === 'other' && x.n === 3, '500 every time: three calls, then other');
  x = await calls(['network', resp(200, OK)]);
  check(x.r.ok && x.n === 2, 'a network error then 200: retried');
  x = await calls(['timeout', 'timeout', resp(200, OK)]);
  check(!x.r.ok && x.r.error === 'timeout' && x.n === 2, `a timeout is retried once only (${x.n})`);
  x = await calls(['timeout', resp(200, OK)]);
  check(x.r.ok && x.n === 2, 'a timeout then 200: retried');
  x = await calls([resp(400, '{"error":{"type":"invalid_request_error","message":"You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."}}'), resp(200, OK)]);
  check(!x.r.ok && x.r.error === 'credit' && x.n === 1, 'the workspace usage limit: the credit, never retried');
  x = await calls([resp(400, '{"error":{"message":"Your credit balance is too low"}}'), resp(200, OK)]);
  check(!x.r.ok && x.r.error === 'credit' && x.n === 1, 'a low credit balance: never retried');
  x = await calls([resp(400, '{"error":{"type":"invalid_request_error","message":"messages: bad"}}'), resp(200, OK)]);
  check(!x.r.ok && x.r.error === 'bad_request' && x.n === 1, 'another 400: never retried');
  check(backoffMs(0, '30') === 8000 && backoffMs(3, null) <= 8000 && backoffMs(0, null) >= 1000, 'the wait is capped at 8 seconds');
  check(!('retry' in x.r), 'the result carries no internal retry field');
}

// ── 2 and 3. the engine ──
const FX = { rooms: { 'airport-road': [], 'shafa-road': [] }, from: {} };
const deps = (model) => ({
  model, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [],
  adapter: { source: 'fixture', roomTypes: async () => [], fromPrice: async () => null, quote: async () => ({ kind: 'not_bookable', reason: 'fixture' }), book: async () => ({ kind: 'not_bookable', reason: 'skill_off' }) },
  content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (x, L) => sarText(x, L),
});
const err = (e) => async () => ({ ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: e });
const understanding = (o) => JSON.stringify({ intents: ['greeting'], topics: ['greeting'], new_topic_hint: null, branch: null, check_in: null, check_out: null, nights: null, dates_text: null,
  dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null, guest_name: null, booking_ref: null,
  language: 'ar', complaint: false, confidence: {}, ...o });
const layered = (map) => async (c) => {
  const v = map[c.layer];
  if (typeof v === 'string' && v.startsWith('err:')) return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: v.slice(4) };
  return v ? { ok: true, text: v, input_tokens: 100, output_tokens: 50, latency_ms: 1 } : { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' };
};
const Q = (id, msg, lang = 'ar', unit = 'airport-road') => ({ id, unit, language: lang, messages: [msg], expect: { action: 'answer' } });
const claim = (q, o = {}) => {
  const c = claimFor(q);
  c.turn.mode = 'live';
  c.conversation = { ...c.conversation, ...(o.conversation ?? {}) };
  if (o.rate) c.rate = { ...c.rate, ...o.rate };
  return c;
};
const NO_SOURCE_AR = 'سنتأكد من الفريق، وسيكمل معك أحدهم في هذه المحادثة.';
const HANDOFF_AR = 'سيكمل معك أحد أفراد فريقنا في هذه المحادثة.';
const bodies = (o) => o.finish.messages.map((m) => m.body);

for (const kind of ['rate_limit', 'overloaded', 'other', 'timeout', 'network', 'bad_request']) {
  const o = await runTurn(claim(Q(`f-${kind}`, 'هل المواقف مجانية؟')), deps(err(kind)));
  const b = bodies(o).join('\n');
  check(o.finish.state === 'human' && o.finish.reason === 'model_error' && o.model_error === kind && o.finish.error === `model_error:${kind}`,
    `understand ${kind}: the team, the error kind recorded (${o.finish.state} ${o.finish.reason} ${o.finish.error})`);
  check(b.includes(NO_SOURCE_AR) && !b.includes('كيف نساعدك') && o.finish.messages.every((m) => m.notice), `understand ${kind}: the no-source notice, never «كيف نساعدك؟» (${b})`);
  check(!(o.finish.unanswered ?? []).length, `understand ${kind}: never «لم أعرف الإجابة»`);
}
{
  const o = await runTurn(claim(Q('f-credit', 'هل المواقف مجانية؟')), deps(err('credit')));
  check(o.credit === 'exhausted' && o.finish.state === 'human' && bodies(o).join('').includes(NO_SOURCE_AR), 'the credit: the team AND the no-source notice (never silence)');
  const tag = claim(Q('f-tag', 'هل المواقف مجانية؟'));
  tag.turn.kind = 'tag';
  const ot = await runTurn(tag, deps(err('overloaded')));
  check(ot.finish.messages.length === 0 && ot.model_error === 'overloaded', 'a tag turn (with staff) sends nothing and records the error');
}
for (const kind of ['rate_limit', 'overloaded', 'timeout']) {
  const o = await runTurn(claim(Q(`c-${kind}`, 'هل المواقف مجانية؟')), deps(layered({ understand: understanding({ intents: ['facility_question'], topics: ['parking'] }), compose: `err:${kind}` })));
  const b = bodies(o).join('\n');
  check(o.finish.state === 'human' && b.includes(NO_SOURCE_AR) && o.model_error === kind, `compose ${kind}: the no-source notice and the team (${o.finish.state}: ${b})`);
  check(!(o.finish.unanswered ?? []).length, `compose ${kind}: never «لم أعرف الإجابة»`);
}
{
  const o = await runTurn(claim(Q('r-rep', 'السلام عليكم'), { rate: { repeated: true } }), deps(err('other')));
  check(o.finish.status === 'skipped' && !o.finish.state && bodies(o).length === 0 && o.finish.models.length === 0,
    'a repeat the assistant already answered (the database decides, guest_hub_pass4.sql A): suppressed — no model call, nothing sent, the state kept');
  const fresh = await runTurn(claim(Q('r-fresh', 'السلام عليكم'), { rate: { repeated: false } }), deps(layered({ understand: understanding({}) })));
  check(bodies(fresh)[0]?.startsWith('وعليكم السلام') && fresh.finish.status === 'done', 'the same text whose earlier copies got no reply (not «repeated»): answered as any message');
  const r = await runTurn(claim(Q('r-rate', 'سؤال'), { rate: { phone_hour: 99 } }), deps(err('other')));
  check(r.finish.state === 'human' && bodies(r).join('') === HANDOFF_AR, 'a rate limit: the hand-off notice — never silence');
}

// the salaam, the greeting mid-episode, thanks
{
  const g = understanding({});
  let o = await runTurn(claim(Q('s1', 'السلام عليكم ورحمة الله وبركاته')), deps(layered({ understand: g })));
  check(bodies(o)[0] === 'وعليكم السلام، مرحبًا بك في أرمادا ريزيدنس – طريق المطار.\nكيف نساعدك؟' && o.finish.messages[0].kind === 'interactive',
    `the first reply to a salaam: «وعليكم السلام، مرحبًا بك في …» then «كيف نساعدك؟» with the quick replies (${JSON.stringify(bodies(o)[0])})`);
  o = await runTurn(claim(Q('s1s', 'السلام عليكم', 'ar', 'shafa-road')), deps(layered({ understand: g })));
  check(bodies(o)[0] === 'وعليكم السلام، مرحبًا بك في أرمادا ريزيدنس – طريق الشفا.\nكيف نساعدك؟', `Shafa Road too (${JSON.stringify(bodies(o)[0])})`);
  o = await runTurn(claim(Q('s2', 'السلام عليكم ورحمة الله وبركاته'), { conversation: { first_reply: false, state: 'inquiry' } }), deps(layered({ understand: g })));
  check(bodies(o)[0] === 'وعليكم السلام، كيف نساعدك؟' && o.finish.messages[0].kind === 'interactive', `a salaam later in the episode: «وعليكم السلام، كيف نساعدك؟» with the quick replies (${JSON.stringify(bodies(o)[0])})`);
  o = await runTurn(claim(Q('s3', 'مرحبا'), { conversation: { first_reply: false, state: 'inquiry' } }), deps(layered({ understand: g })));
  check(bodies(o)[0] === 'كيف نساعدك؟' && o.finish.messages[0].kind === 'interactive', 'a greeting with no salaam later: «كيف نساعدك؟» with the quick replies');
  o = await runTurn(claim(Q('s4', 'Hello', 'en'), { conversation: { language: 'en' } }), deps(layered({ understand: understanding({ language: 'en' }) })));
  check(bodies(o)[0] === 'Welcome to Armada Residence – Airport Road.\nHow can we help?', `English unchanged (${JSON.stringify(bodies(o)[0])})`);
  o = await runTurn(claim(Q('s5', 'شكرًا'), { conversation: { first_reply: false, state: 'inquiry' } }), deps(layered({ understand: understanding({ intents: ['thanks_or_closing'], topics: ['thanks_closing'] }) })));
  check(bodies(o)[0] === 'العفو، يسعدنا خدمتك في أي وقت.' && !(o.finish.unanswered ?? []).length, `thanks: the thanks reply, never «لم أعرف الإجابة» (${JSON.stringify(bodies(o)[0])})`);
  o = await runTurn(claim(Q('s6', 'thanks', 'en'), { conversation: { first_reply: false, state: 'inquiry', language: 'en' } }), deps(layered({ understand: understanding({ intents: ['thanks_or_closing'], topics: ['thanks_closing'], language: 'en' }) })));
  check(bodies(o)[0] === 'You’re welcome — we are happy to help any time.', 'thanks in English');
  // a salaam with a question later in the episode: the line, then the answer
  o = await runTurn(claim(Q('s7', 'السلام عليكم، هل المواقف مجانية؟'), { conversation: { first_reply: false, state: 'inquiry' } }),
    deps(layered({ understand: understanding({ intents: ['greeting', 'facility_question'], topics: ['parking'] }), compose: JSON.stringify({ reply: 'نعم، المواقف مجانية.', used_card_ids: ['k-parking-detail'], unanswered: [] }) })));
  check(bodies(o)[0] === 'وعليكم السلام.\nنعم، المواقف مجانية.', `a salaam with a question later: «وعليكم السلام.» then the answer (${JSON.stringify(bodies(o)[0])})`);
  // the guest's own «حجز إقامة» (H6 pass 5, Ahmed 15 Nov 2026): the booking conversation — the dates and the guests asked;
  // the model down → the fixed question of copy.md §4.0, never the team, never silence
  const tap = claim(Q('f-book', 'حجز إقامة'), { conversation: { first_reply: false, state: 'inquiry' } });
  tap.messages = [{ id: 'm-tap', kind: 'button_reply', body: 'حجز إقامة', payload: { button_id: 'hubq:book' } }];
  o = await runTurn(tap, deps(err('other')));
  check(o.finish.state === 'collecting' && bodies(o).join('') === 'متى موعد وصولك ومغادرتك، وكم عدد الضيوف؟', `«حجز إقامة»: the dates and guests asked (fallback when the model is down) (${JSON.stringify(bodies(o))})`);
}

// Ahmed's rule (22:55): only a real button payload is a button reply — any typed text goes through understanding, also the
// text right after the greeting with its quick replies; an unsupported message kind gets the media notice
{
  const seen = [];
  const spy = async (c) => { seen.push(c.layer); return { ok: true, text: understanding({ intents: ['other'], topics: [] }), input_tokens: 10, output_tokens: 5, latency_ms: 1 }; };
  const c = claim(Q('t-after-quick', 'كيف الحال'), { conversation: { first_reply: false, state: 'inquiry' } });
  c.history = [{ author: 'guest', body: 'هلا' }, { author: 'us', body: 'مرحبًا بك في أرمادا ريزيدنس – طريق المطار. كيف نساعدك؟' }];
  const o = await runTurn(c, deps(spy));
  check(seen[0] === 'understand' && o.finish.understanding, `a typed text after the quick replies is understood (calls: ${seen.join(',')})`);
  const typedTitle = claim(Q('t-typed-title', 'حجز إقامة'), { conversation: { first_reply: false, state: 'inquiry' } });
  seen.length = 0;
  await runTurn(typedTitle, deps(spy));
  check(!seen.includes('understand'), 'the title of a quick reply typed as text gets the button\'s result (H6 pass 5, Ahmed 15 Nov 2026)');
  const un = claim(Q('t-unsupported', ''), { conversation: { first_reply: false, state: 'inquiry' } });
  un.messages = [{ id: 'm-un', kind: 'unsupported', body: null, payload: {} }];
  const ou = await runTurn(un, deps(err('other')));
  check(ou.finish.state !== 'human' && !bodies(ou).length && ou.finish.models.length === 0, `an unsupported message kind or a reaction: nothing, never the team (H6 pass 5) (${ou.finish.reason})`);
}

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-failure-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-failure-check: ${n} checks passed`);
