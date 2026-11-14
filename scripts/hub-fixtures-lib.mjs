// Guest Hub H5 (14 Nov 2026): what the recorded model answers (tests/hub-fixtures/) are recorded and replayed with —
// the turn's context built offline from the approved seed (docs/guest-hub/knowledge-seed.json, topics.json,
// faq-topics.json, content/faq.json with the fees of content/fees.generated.json or pricing.json), the knowledge read by
// the TypeScript twin of hub_knowledge_for (retrieval.ts), the room types and «يبدأ من» rates as recorded. No database,
// no network: scripts/hub-fixtures-record.mjs adds the real model calls (Ahmed's OK, a local key); scripts/
// hub-fixtures-check.mjs replays them in CI. A Wi-Fi password card never enters a fixture (its text → its placeholder).
import { readFileSync, existsSync } from 'node:fs';
import { retrieve } from '../supabase/functions/_shared/hub/retrieval.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
export const SEED = JSON.parse(read('docs/guest-hub/knowledge-seed.json')).cards;
export const TOPICS = JSON.parse(read('docs/guest-hub/topics.json')).topics;
export const FAQ_TOPICS = JSON.parse(read('docs/guest-hub/faq-topics.json')).faq_topics;
export const FAQ = JSON.parse(read('content/faq.json')).items;
export const BANK = read('tests/hub-bank/seed.jsonl').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
export const CONTENT = JSON.parse(read('supabase/functions/booking-request/content.generated.json'));
const MIG4 = read('supabase/migrations/20261114100000_guest_hub_knowledge.sql');
const fdef = MIG4.slice(MIG4.indexOf('create function internal.hub_forbidden_terms()'), MIG4.indexOf('$$;', MIG4.indexOf('create function internal.hub_forbidden_terms()')));
export const FORBIDDEN = [...fdef.slice(fdef.indexOf('select array[') + 13, fdef.lastIndexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
const fees = existsSync(new URL('../content/fees.generated.json', import.meta.url)) ? JSON.parse(read('content/fees.generated.json')) : JSON.parse(read('content/pricing.json'));
const breakfast = Number(fees.breakfast?.adult ?? fees.breakfast_adult ?? fees.breakfast?.price ?? 20);
const extraBed = Number(fees.extra_bed_per_night ?? 50);

export const UNITS = [
  { key: 'airport-road', kind: 'branch', branch: 'airport-road', knowledge_hidden: false, name_ar: 'فرع طريق المطار', name_en: 'Airport Road' },
  { key: 'shafa-road', kind: 'branch', branch: 'shafa-road', knowledge_hidden: false, name_ar: 'فرع طريق الشفا', name_en: 'Shafa Road' },
  { key: 'lobby-cafe', kind: 'dining', branch: 'airport-road', knowledge_hidden: false },
  { key: 'rooftop', kind: 'dining', branch: 'airport-road', knowledge_hidden: true },
];
export const PERSONA = { tone: 2, emoji: false, greeting_new_ar: 'مرحبًا بك في {unit_name}.', greeting_new_en: 'Welcome to {unit_name}.', greeting_returning_ar: 'أهلًا بعودتك، {first_name}.', greeting_returning_en: 'Welcome back, {first_name}.' };
export const MODELS = { understand: 'claude-haiku-5-5', tag: 'claude-haiku-5-5', translate: 'claude-haiku-5-5', compose: 'claude-sonnet-5-5', suggest: 'claude-sonnet-5-5' };
export const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, long_from: 100000, long_input: 0.5, long_output: 2.5, read_at: '2026-11-14' },
  'claude-sonnet-5-5': { input: 2, output: 10, read_at: '2026-11-14' },
};
export const TODAY = '2026-11-14';

const fillFees = (t, L) => String(t ?? '').replaceAll('{breakfast}', sarText(breakfast, L)).replaceAll('{extra_bed}', sarText(extraBed, L));
/** the Wi-Fi password cards stay on production: a fixture never holds their text */
const scrubCard = (c) => (/^k-wifi-password-/.test(c.id) ? { ...c, text_ar: `{card:${c.id}}`, text_en: `{card:${c.id}}` } : c);

/** hub_knowledge_for, offline: the seed's cards by the retrieval rule, the FAQ by faq-topics.json */
export function knowledgeFor(unit, topics, L, branch) {
  const cards = SEED.map((c, i) => ({ key: c.id, unit_keys: c.unit_keys, topic_keys: c.topic_keys, expires_on: c.expires_on ?? null, sort: i }));
  const got = retrieve(UNITS, TOPICS, cards, unit, topics, TODAY, 5, branch ?? null);
  const byId = Object.fromEntries(SEED.map((c) => [c.id, scrubCard(c)]));
  const rel = new Set(TOPICS.filter((t) => (topics.includes(t.key) && t.parent_key) || (t.parent_key && topics.includes(t.parent_key))).flatMap((t) => [t.parent_key, t.key]).filter(Boolean));
  const u = UNITS.find((x) => x.key === unit);
  const faq = u?.knowledge_hidden ? [] : FAQ.map((f, i) => {
    const t = FAQ_TOPICS[f.id] ?? { topics: [], unit_keys: [] };
    const hits = t.topics.filter((k) => topics.includes(k)).length * 2 + t.topics.filter((k) => rel.has(k)).length;
    return { f, i, hits, mine: t.unit_keys.includes(unit) };
  }).filter((x) => x.hits > 0).sort((a, b) => Number(b.mine) - Number(a.mine) || b.hits - a.hits || a.i - b.i).slice(0, 5)
    .map((x) => ({ key: x.f.id, q: L === 'en' ? x.f.q_en : x.f.q_ar, a: fillFees(L === 'en' ? x.f.a_en : x.f.a_ar, L) }));
  return {
    cards: got.map((c) => {
      const s = byId[c.key];
      return { id: c.key, key: c.key, title: L === 'en' ? s.title_en : s.title_ar, text: L === 'en' ? s.text_en : s.text_ar, unit_keys: s.unit_keys, topic_keys: s.topic_keys,
        branch: UNITS.find((x) => x.key === s.unit_keys[0])?.branch ?? null };
    }),
    faq,
  };
}

/** the context hub_turn_claim hands the engine, for one bank question */
export function claimFor(q) {
  const unit = UNITS.find((u) => u.key === q.unit) ?? UNITS[0];
  const L = q.language === 'en' ? 'en' : 'ar';
  const media = /^\[(voice note|image)\]$/.test(q.messages[0]);
  return {
    claimed: true,
    turn: { id: `fixture-${q.id}`, kind: 'reply', mode: 'test', attempts: 1, is_test: true },
    conversation: { id: `conv-${q.id}`, state: 'new', real_state: 'human', language: L, window_expires_at: '2099-01-01T00:00:00Z', failed_understandings: 0, priority: 'normal',
      topics: [], tags: [], out_of_scope: 0, first_reply: true, is_test: true },
    unit: { id: unit.key, key: unit.key, kind: unit.kind, branch: unit.branch, name_ar: unit.name_ar, name_en: unit.name_en, mode: 'test', skills: ['shared_knowledge', 'stay_services'], persona: PERSONA, venue: null },
    channel: { address: unit.key === 'shafa-road' ? '+966536663030' : '+966536622277', sending_enabled: false },
    guest: { first_name: null, returning: false, language: L },
    messages: q.messages.map((m, i) => (media ? { id: `m-${q.id}-${i}`, kind: m === '[image]' ? 'image' : 'audio', body: null, payload: { media_id: 'x' } } : { id: `m-${q.id}-${i}`, kind: 'text', body: m, payload: {} })),
    history: [],
    draft: null,
    bookings: q.id === 'q047' ? [{ ref: 'AR-20261201-QA47', status: 'confirmed', branch: 'airport-road', check_in: '2026-12-01', check_out: '2026-12-03' }] : [],
    licences: Object.fromEntries(TOPICS.map((t) => [t.key, t.always_handoff ? 'blocked' : 'shadow'])),
    topics: TOPICS.map((t, i) => ({ key: t.key, label_en: t.label_en, parent_key: t.parent_key, always_handoff: t.always_handoff, sort: i })),
    settings: { confidence_floor: 0.7, cards_per_turn: 5, reply_max_chars: 600, failed_max: 2, group_min_rooms: 5, models: MODELS, prices: PRICES, show_prices: true },
    forbidden: FORBIDDEN,
    rate: { phone_hour: 0, replies_hour: 0, repeated: false, phone_max: 30, replies_max: 20 },
    budget: { api_credit: false },
    today: TODAY,
  };
}

/** what the engine should decide for a bank item in H5 (room_booking, hall and group requests OFF → the team) */
export function h5Expect(q) {
  const a = q.expect.action;
  if (['ask', 'send_summary', 'quote'].includes(a)) return 'handoff';
  if (a === 'refuse') return 'out_of_scope';
  if (a === 'greeting') return 'greeting';
  return a;
}
/** the kind of outcome the engine produced */
export function outcomeKind(finish) {
  const acts = finish.decision?.actions ?? [];
  if (acts.includes('handoff') && finish.messages?.some((m) => /third_language/.test(JSON.stringify(m)))) return 'third_language';
  if (finish.state === 'human') return finish.reason === 'third_language' ? 'third_language' : finish.reason === 'out_of_scope' ? 'out_of_scope' : 'handoff';
  if (acts.includes('booking_status')) return 'booking_status';
  if (acts.includes('fixed') && (finish.decision?.transitions ?? []).includes('T4')) return 'greeting';
  if (acts.includes('fixed') && finish.messages?.length && finish.out_of_scope_inc) return 'out_of_scope';
  if (acts.includes('from_price')) return 'answer';
  if (acts.includes('answer')) return 'answer';
  if (acts.includes('noop')) return 'answer';
  return acts[0] ?? 'none';
}

/** the bank items the engine runs (the router's own items — the «إلغاء» word, an opt-out — are not engine turns; the two
 *  Wi-Fi password questions need production-only cards) */
export const engineItems = () => BANK.filter((q) => !q._header && !['cancel_word_question', 'opt_out'].includes(q.expect.action) && !['q033', 'q034'].includes(q.id));
