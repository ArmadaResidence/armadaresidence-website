// Guest Hub — the knowledge read (14 Nov 2026, session H4; docs/guest-hub/GUEST-HUB-SPEC.md §1.7, §4.6; DECISIONS.md
// 2026-11-14 «Guest Hub H4 — the knowledge base»). OFFLINE and fast (FAST_CHECKS): the rule of
// supabase/functions/_shared/hub/retrieval.ts runs on the approved seed (docs/guest-hub/knowledge-seed.json, topics.json)
// and the four units of H1; the database function hub_knowledge_for is read to prove it states the same rule (the SQL
// test guest_hub_knowledge.sql runs it on a real database in CI).
//   1. ranking by unit and topic: the unit's own cards first, then the shared ones, then the untagged; exact topics
//      before related ones (a parent / child);
//   2. at most 5 cards (hub_cards_per_turn);
//   3. an expired card is excluded (one ending today still counts);
//   4. the rooftop restaurant (knowledge_hidden) is never returned — alone or tagged with another unit — on any number,
//      and its unit reads nothing;
//   5. (14 Nov 2026) every card on both branch numbers, the number's own first; the Airport Road café menu and ordering
//      cards reach the Shafa Road number only when the guest named Airport Road; the lobby café unit reads its branch's;
//   6. the SQL function: service role only, the same filters and order, the FAQ read live with the fees filled.
//   node scripts/hub-retrieval-check.mjs
import { readFileSync } from 'node:fs';
import { BRANCH_ONLY, relatedTopics, retrieve, unitReadKeys } from '../supabase/functions/_shared/hub/retrieval.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SEED = JSON.parse(read('docs/guest-hub/knowledge-seed.json')).cards;
const TOPICS = JSON.parse(read('docs/guest-hub/topics.json')).topics;

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

const UNITS = [
  { key: 'airport-road', kind: 'branch', branch: 'airport-road', knowledge_hidden: false },
  { key: 'shafa-road', kind: 'branch', branch: 'shafa-road', knowledge_hidden: false },
  { key: 'lobby-cafe', kind: 'dining', branch: 'airport-road', knowledge_hidden: false },
  { key: 'rooftop', kind: 'dining', branch: 'airport-road', knowledge_hidden: true },
];
const TODAY = '2026-11-14';
const cards = SEED.map((c, i) => ({ key: c.id, unit_keys: c.unit_keys, topic_keys: c.topic_keys, expires_on: c.expires_on, sort: i }));
// the test cards of the SQL test, the same shapes
const extra = [
  { key: 'k-qa-rooftop', unit_keys: ['rooftop'], topic_keys: ['menu', 'cafe_restaurant'], expires_on: null, sort: 0 },
  { key: 'k-qa-rooftop-both', unit_keys: ['airport-road', 'rooftop'], topic_keys: ['menu', 'cafe_restaurant'], expires_on: null, sort: 0 },
  { key: 'k-qa-expired', unit_keys: ['airport-road'], topic_keys: ['menu', 'cafe_restaurant'], expires_on: '2026-11-13', sort: 0 },
  { key: 'k-qa-today', unit_keys: ['airport-road'], topic_keys: ['menu', 'cafe_restaurant'], expires_on: TODAY, sort: 0 },
];
const all = [...cards, ...extra];
const keys = (u, t, list = all, lim = 5) => retrieve(UNITS, TOPICS, list, u, t, TODAY, lim).map((c) => c.key);

// ── 1. ranking (14 Nov 2026: every card on both branch numbers, the number's own branch first) ──
const loc = keys('airport-road', ['location_directions', 'distances', 'nearby_attractions', 'umrah', 'branch_info', 'branch_compare', 'parking', 'reception_contact']);
check(loc.length === 5, `at most 5 cards — ${loc.length}`);
const unitOf = (k) => all.find((c) => c.key === k).unit_keys;
check(loc.every((k) => JSON.stringify(unitOf(k)) === '["airport-road"]'), `the number's own branch first — ${loc.join(', ')}`);
const park = keys('airport-road', ['parking', 'location_directions']);
check(park[0] === 'k-airport-address' && park.includes('k-parking-detail'), `own (k-airport-address) before shared (k-parking-detail) — ${park.join(', ')}`);
const exactFirst = keys('airport-road', ['menu']);
check(exactFirst.indexOf('k-cafe-menu') < exactFirst.indexOf('k-cafe-airport') || !exactFirst.includes('k-cafe-airport'), `an exact topic before a related one — ${exactFirst.join(', ')}`);
check(JSON.stringify(relatedTopics(TOPICS, ['cafe_restaurant']).sort()) === JSON.stringify(['cafe_ordering', 'menu']), 'a parent topic relates to its children');
check(relatedTopics(TOPICS, ['menu']).includes('cafe_restaurant'), 'a child topic relates to its parent');
check(keys('airport-road', ['cafe_restaurant']).includes('k-cafe-menu'), "a parent topic reads its children's cards");
check(keys('airport-road', []).length === 0, 'no topic → nothing');
check(keys('shafa-road', ['parking']).includes('k-parking-detail') && keys('airport-road', ['parking']).includes('k-parking-detail'), 'a card tagged with both branches is read on both');
// the other branch's cards ARE read now — after the number's own
const jac = keys('airport-road', ['jacuzzi_balcony']);
check(jac.includes('k-shafa-jacuzzi-balcony'), `a Shafa Road card is answerable on the Airport Road number — ${jac.join(', ')}`);
const kit = keys('shafa-road', ['kitchen', 'room_amenities']);
check(kit.includes('k-shafa-amenities') && kit.includes('k-airport-kitchen') && kit.indexOf('k-shafa-amenities') < kit.indexOf('k-airport-kitchen'),
  `the number's own card before the other branch's (prompts.md §2.3 example 2) — ${kit.join(', ')}`);
const addr = keys('shafa-road', ['location_directions']);
check(addr[0] && JSON.stringify(unitOf(addr[0])) === '["shafa-road"]', `the own branch's address first on the Shafa Road number — ${addr.join(', ')}`);
const named = retrieve(UNITS, TOPICS, all, 'shafa-road', ['location_directions'], TODAY, 5, 'airport-road').map((c) => c.key);
check(named[0] && JSON.stringify(unitOf(named[0])) === '["airport-road"]', `the branch the guest named ranks first — ${named.join(', ')}`);

// ── 2. the limit ──
check(keys('airport-road', ['location_directions', 'distances', 'nearby_attractions', 'umrah', 'parking'], all, 3).length === 3, 'the limit follows hub_cards_per_turn');
for (const u of ['airport-road', 'shafa-road', 'lobby-cafe']) {
  const big = keys(u, TOPICS.map((t) => t.key));
  check(big.length <= 5, `${u}: never more than 5 cards, whatever the topics (${big.length})`);
}

// ── 3. expiry ──
const menu = keys('airport-road', ['menu', 'cafe_restaurant']);
check(!menu.includes('k-qa-expired') && menu.includes('k-qa-today'), `an expired card is excluded; one ending today counts — ${menu.join(', ')}`);

// ── 4. the rooftop ──
for (const u of ['airport-road', 'shafa-road', 'lobby-cafe']) {
  check(!keys(u, ['menu', 'cafe_restaurant', 'rooftop']).some((k) => k.startsWith('k-qa-rooftop')), `${u}: a rooftop card is never returned (alone or with another unit)`);
}
check(keys('rooftop', ['menu', 'cafe_restaurant']).length === 0, 'the rooftop unit reads nothing');
check(!SEED.some((c) => c.unit_keys.includes('rooftop')), 'no seed card is tagged rooftop');

// ── 5. the café: its menu and ordering cards reach another branch's number only when the guest named Airport Road ──
check(keys('airport-road', ['menu']).includes('k-cafe-menu'), 'the café menu card on airport-road');
// H11 (24 Nov 2026): + the reception from the room phone (Airport Road's «اضغط 0»; a card of the H11 migration, not of the seed)
check(JSON.stringify(BRANCH_ONLY) === JSON.stringify(['k-cafe-menu', 'k-cafe-phone', 'k-cafe-breakfast-menu', 'k-reception-room-phone']), "the branch-only cards = Ahmed's list of 14 Nov 2026 + the reception extension (24 Nov 2026)");
for (const k of BRANCH_ONLY.filter((x) => x !== 'k-reception-room-phone')) check(SEED.some((c) => c.id === k && JSON.stringify(c.unit_keys) === '["airport-road"]'), `${k} exists, tagged airport-road`);
check(read('supabase/migrations/20261124100000_guest_hub_h11.sql').includes(`('k-reception-room-phone', '{airport-road}'`), 'k-reception-room-phone exists (the H11 migration), tagged airport-road');
for (const t of [['menu'], ['menu', 'cafe_ordering'], ['cafe_restaurant'], ['breakfast', 'menu'], TOPICS.map((x) => x.key)]) {
  const label = t.length > 3 ? 'every topic' : t.join(',');
  const s = keys('shafa-road', t, cards);
  check(!BRANCH_ONLY.some((k) => s.includes(k)), `shafa-road (${label}), no branch named: never the café menu / ordering cards — ${s.join(', ')}`);
  const n = retrieve(UNITS, TOPICS, cards, 'shafa-road', t, TODAY, 5, 'airport-road').map((c) => c.key);
  if (t.length <= 3 && t.includes('menu')) check(n.includes('k-cafe-menu'), `shafa-road (${label}), Airport Road named: the café menu card — ${n.join(', ')}`);
  const both = retrieve(UNITS, TOPICS, cards, 'shafa-road', t, TODAY, 5, 'both').map((c) => c.key);
  check(!BRANCH_ONLY.some((k) => both.includes(k)), `shafa-road (${label}), «both»: still not the café menu / ordering cards`);
}
check(keys('shafa-road', ['cafe_restaurant'], cards).includes('k-shafa-restaurant'), "Shafa Road's restaurant card on shafa-road");
check(keys('shafa-road', ['cafe_restaurant'], cards).indexOf('k-shafa-restaurant') === 0, "Shafa Road's restaurant first on its own number");
check(JSON.stringify(unitReadKeys(UNITS, 'lobby-cafe').sort()) === '["airport-road","lobby-cafe","rooftop"]' && keys('lobby-cafe', ['menu'], cards).includes('k-cafe-menu'), "the lobby café unit reads its branch's cards");
check(SEED.filter((c) => c.id.startsWith('k-cafe-')).every((c) => JSON.stringify(c.unit_keys) === '["airport-road"]'), 'every café card is tagged airport-road only');

// ── 6. the SQL function (the H5 migration) states the same rule ──
const MIG5 = read('supabase/migrations/20261114200000_guest_hub_assistant.sql');
{
  // H11b (24 Nov 2026): the latest definition of the list
  const m = read('supabase/migrations/20261124200000_guest_hub_h11b.sql').match(/function internal\.hub_branch_only_cards\(\)[^$]*\$\$ select array\[([^\]]*)\] \$\$/);
  const sql = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
  check(JSON.stringify(sql) === JSON.stringify(BRANCH_ONLY), `the SQL list internal.hub_branch_only_cards() = retrieval.ts BRANCH_ONLY — ${sql}`);
}
const fn = MIG5.slice(MIG5.indexOf('create function public.hub_knowledge_for('), MIG5.indexOf('\n$$;', MIG5.indexOf('create function public.hub_knowledge_for(')));
check(/drop function public\.hub_knowledge_for\(text, text\[\], text\);/.test(MIG5), 'SQL: the H4 function is replaced (a new argument, p_branch)');
check(/if u\.knowledge_hidden or cardinality\(coalesce\(p_topics, '\{\}'\)\) = 0 then/.test(fn), 'SQL: a knowledge_hidden unit, or no topic → nothing');
check(/v_hidden text\[\] := array\(select x\.key from public\.hub_units x where x\.knowledge_hidden\)/.test(fn) && /where not \(c\.unit_keys && v_hidden\)/.test(fn), 'SQL: never a card tagged with a knowledge_hidden unit');
check(!/cardinality\(c\.unit_keys\) = 0 or c\.unit_keys && v_keys\)/.test(fn), "SQL: no longer restricted to the number's own units");
check(/v_keys := array\(select x\.key from public\.hub_units x where x\.branch_slug = u\.branch_slug\)/.test(fn), "SQL: the number's branch = every unit of it");
check(/not \(c\.key = any \(internal\.hub_branch_only_cards\(\)\)\) or c\.unit_keys && v_keys or c\.unit_keys && v_named/.test(fn), 'SQL: the café menu / ordering cards on another number only when that branch is named');
check(/select array\['k-cafe-menu', 'k-cafe-phone', 'k-cafe-breakfast-menu'\]/.test(MIG5), 'SQL: internal.hub_branch_only_cards = the same three cards');
check(/k\.status = 'published' and k\.live is not null and not k\.is_test/.test(fn) && /\(k\.live ->> 'expires_on'\)::date >= v_today/.test(fn), 'SQL: published, live, unexpired, never a test card');
check(/case when c\.unit_keys <@ v_focus and cardinality\(c\.unit_keys\) > 0 then 0\s+when c\.unit_keys && v_focus then 1\s+when cardinality\(c\.unit_keys\) = 0 then 2\s+else 3 end as rank_unit/.test(fn)
  && /order by rank_unit, exact desc, related desc, c\.sort, c\.key\s+limit v_n/.test(fn), 'SQL: the same order and the limit');
check(/v_n integer := greatest\(internal\.hub_setting_int\('hub_cards_per_turn', 5\), 1\)/.test(fn), 'SQL: hub_cards_per_turn (5)');
check(/internal\.hub_fill_fees\(z\.live ->> \('a_' \|\| v_lang\), v_lang\)/.test(fn) && /left join public\.hub_faq_topics t on t\.faq_key = f\.key/.test(fn), 'SQL: the FAQ read live through hub_faq_topics, the fees filled from Settings');
check(/revoke execute on function public\.hub_knowledge_for\(text, text\[\], text, text\)[^;]*from public, anon, authenticated;/.test(MIG5) && /grant execute on function public\.hub_knowledge_for\(text, text\[\], text, text\)[^;]*to service_role;/.test(MIG5), 'SQL: service role only');
// the FAQ topics = docs/guest-hub/faq-topics.json
const FT = JSON.parse(read('docs/guest-hub/faq-topics.json')).faq_topics;
const rows = [...MIG5.matchAll(/\('([a-z-]+)', '\{([a-z_,]*)\}', '\{([a-z-,]*)\}'\)/g)].map((m) => [m[1], m[2] ? m[2].split(',') : [], m[3] ? m[3].split(',') : []]);
check(rows.length === Object.keys(FT).length && rows.every(([k, t, u]) => FT[k] && JSON.stringify(FT[k].topics) === JSON.stringify(t) && JSON.stringify(FT[k].unit_keys) === JSON.stringify(u)), 'SQL: hub_faq_topics = docs/guest-hub/faq-topics.json');
const TOPIC_KEYS = new Set(TOPICS.map((t) => t.key));
check(Object.values(FT).every((x) => x.topics.every((t) => TOPIC_KEYS.has(t))), 'every FAQ topic is a known topic');
const T = read('supabase/tests/guest_hub_assistant.sql');
for (const name of ['K1 a Shafa Road card is read on the Airport Road number', 'K2 the café menu card is not read on the Shafa Road number', 'K3 the café menu card on the Shafa Road number when the guest named Airport Road', 'K4 the rooftop is never read', 'K5 the FAQ by its topics']) {
  check(T.includes(name), `the SQL test «${name}» exists`);
}

// ── 7. «لم أعرف الإجابة» holds only real knowledge gaps (H6 gaps, Ahmed 14 Nov 2026) ──
// the real engine (runTurn) with scripted model answers: only a question with no source, or the part of an answer the
// sources did not settle, feeds the queue — never media, out of scope, a request for a person, a complaint or a request
// hand-off; and an answer followed by its hand-off notice is ONE message (payload handoff)
{
  const { runTurn } = await import('../supabase/functions/_shared/hub/engine.ts');
  const { claimFor, knowledgeFor, CONTENT } = await import('./hub-fixtures-lib.mjs');
  const { longDate } = await import('../supabase/functions/booking-request/email.ts');
  const { sarText } = await import('../supabase/functions/booking-request/rules.ts');
  const U = (o) => JSON.stringify({ intents: ['other'], topics: [], new_topic_hint: null, branch: null, check_in: null, check_out: null, nights: null, dates_text: null, dates_calendar: null,
    room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null, guest_name: null, booking_ref: null, language: 'ar', complaint: false,
    confidence: { intents: 0.95, topics: 0.95 }, ...o });
  const turn = async (msg, understanding, composed, o = {}) => {
    const q = { id: 'gap', unit: 'airport-road', language: 'ar', messages: [msg] };
    const claim = claimFor(q);
    if (o.media) claim.messages = [{ id: 'm-gap-0', kind: 'image', body: null, payload: { media_id: 'x' } }];
    const model = async (c) => ({ ok: true, text: c.layer === 'compose' ? JSON.stringify(composed) : understanding, input_tokens: 10, output_tokens: 10, latency_ms: 1 });
    const deps = { model, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [],
      adapter: { source: 'x', roomTypes: async () => [], fromPrice: async () => null, quote: async () => ({ kind: 'not_bookable' }), book: async () => ({ kind: 'not_bookable' }) },
      content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (x, L) => sarText(x, L) };
    return (await runTurn(claim, deps)).finish;
  };
  const NONE = { reply: '', used_card_ids: [], unanswered: ['laundry price'] };
  let f = await turn('هل يوجد مسبح؟', U({ intents: ['facility_question'], topics: ['facilities'] }), NONE);
  check(f.state === 'human' && f.unanswered.length === 1 && f.decision.gap === true, 'gaps: a question with no source → the queue (decision.gap)');
  f = await turn('بكم غسيل الملابس؟', U({ intents: ['price_question'], topics: ['laundry', 'price'] }), { reply: 'لا توجد غسالات في الغرف، ويوجد في الفرع مغسلة مركزية.', used_card_ids: ['k-airport-amenities'], unanswered: ['laundry price'] });
  check(f.state === 'human' && f.unanswered.length === 1 && f.messages.length === 1 && f.messages[0].payload.handoff === true && !f.messages[0].notice
    && /مغسلة مركزية/.test(f.messages[0].body) && /سنتأكد من الفريق/.test(f.messages[0].body), `gaps: the laundry: what the cards say, then the price to the team — ONE message, the part unanswered in the queue — ${JSON.stringify(f.messages.map((m) => m.body))}`);
  check(!/\d+\s*(ريال|SAR)/.test(f.messages[0].body), 'gaps: … and no laundry price');
  f = await turn('أبغى غرفة فيها مطبخ', U({ intents: ['stay_booking', 'facility_question'], topics: ['booking_new', 'kitchen'] }), { reply: 'المطبخ متوفر في جناح بغرفة وصالة.', used_card_ids: ['k-airport-kitchen'], unanswered: [] });
  check(f.state === 'collecting' && f.decision.answered === true && f.unanswered.length === 0 && f.messages.length === 1 && !f.messages[0].notice,
    'gaps / pass 5: a mixed message → the answer, which also asks for the stay details (one composed message); nothing in the queue');
  f = await turn('أبغى غرفة فيها مطبخ', U({ intents: ['stay_booking', 'facility_question'], topics: ['booking_new', 'kitchen'] }), NONE);
  check(f.state === 'collecting' && f.unanswered.length === 1 && f.messages.length === 1 && /متى موعد وصولك/.test(f.messages[0].body), 'gaps / pass 5: … its question with no source is a gap; the stay details are still asked');
  f = await turn('أبغى أحجز من 20 إلى 22 نوفمبر', U({ intents: ['stay_booking'], topics: ['booking_new'], check_in: '2026-11-20', check_out: '2026-11-22' }), NONE);
  check(f.state === 'collecting' && f.unanswered.length === 0 && !f.decision.gap, 'gaps / pass 5: a booking never enters the queue');
  f = await turn('الغرفة غير نظيفة', U({ intents: ['complaint'], complaint: true }), NONE);
  check(f.state === 'human' && f.unanswered.length === 0, 'gaps: … nor a complaint');
  f = await turn('أبغى أكلم موظف', U({ intents: ['human_request'] }), NONE);
  check(f.state === 'human' && f.unanswered.length === 0, 'gaps: … nor a request for a person');
  f = await turn('اكتب لي قصيدة', U({ intents: ['out_of_scope'] }), NONE);
  check(f.unanswered.length === 0, 'gaps: … nor out of scope');
  f = await turn('', U({}), NONE, { media: true });
  check(f.state === 'human' && f.unanswered.length === 0, 'gaps: … nor media');
  f = await turn('كم سعر القاعة؟', U({ intents: ['price_question', 'hall_request'], topics: ['price', 'hall'] }), { reply: 'السعر عن طريق فريق المبيعات على +966 53 662 2288.', used_card_ids: ['k-hall-detail', 'k-sales-contact'], unanswered: [] });
  check(f.state === 'collecting' && /المبيعات/.test(f.messages[0].body) && f.unanswered.length === 0, 'gaps / 15 Nov: the hall price → «عن طريق المبيعات» first, then the hall details asked (never a gap) — was: the hall request to the team');
}
// the database keeps the same rule: a system entry must be a real gap, in a unit that is not off; the cleanup dismisses
// (never deletes) with «خارج نطاق القائمة»
{
  const G = read('supabase/migrations/20261114600000_guest_hub_gaps.sql');
  const add = G.slice(G.indexOf('create or replace function internal.hub_unanswered_add('), G.indexOf('\n$$;', G.indexOf('create or replace function internal.hub_unanswered_add(')));
  check(/if p_by is null and not internal\.hub_unanswered_gap\(c, m\.id\) then return null; end if;/.test(add), 'gaps (SQL): a system entry must pass internal.hub_unanswered_gap; a person\'s mark is unchanged');
  const gap = G.slice(G.indexOf('create function internal.hub_unanswered_gap('), G.indexOf('\n$$;', G.indexOf('create function internal.hub_unanswered_gap(')));
  check(/u\.assistant_mode <> 'off'/.test(gap) && /m\.kind = 'text'/.test(gap) && /t\.kind = 'reply' and t\.mode <> 'test'/.test(gap) && /decision ->> 'gap'/.test(gap), 'gaps (SQL): … a unit not off, a text message, a reply turn (never a test run) that the engine marked a gap');
  check(/update public\.hub_unanswered q\s+set status = 'dismissed', dismiss_reason = 'خارج نطاق القائمة'/.test(G) && !/delete from public\.hub_unanswered/.test(G), 'gaps (SQL): the cleanup dismisses with «خارج نطاق القائمة» and never deletes');
  const T = read('supabase/tests/guest_hub_knowledge.sql');
  for (const name of ['G1 a question with no source', 'G3 never a booking hand-off', 'G3 … never media', 'G4 never a unit whose mode is off', 'G7 the cleanup dismisses']) check(T.includes(name), `the SQL test «${name}» exists`);
}

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-retrieval-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-retrieval-check: ${n} checks passed`);
