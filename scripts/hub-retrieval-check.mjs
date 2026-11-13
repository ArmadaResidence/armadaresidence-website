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
//   5. the Airport Road café menu card is never returned for shafa-road; the café's cards are read on airport-road and
//      by the lobby café unit (its branch's cards);
//   6. the SQL function: service role only, the same filters and order, the FAQ read live with the fees filled.
//   node scripts/hub-retrieval-check.mjs
import { readFileSync } from 'node:fs';
import { relatedTopics, retrieve, unitReadKeys } from '../supabase/functions/_shared/hub/retrieval.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SEED = JSON.parse(read('docs/guest-hub/knowledge-seed.json')).cards;
const TOPICS = JSON.parse(read('docs/guest-hub/topics.json')).topics;
const MIG = read('supabase/migrations/20261114100000_guest_hub_knowledge.sql');

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

// ── 1. ranking ──
const loc = keys('airport-road', ['location_directions', 'distances', 'nearby_attractions', 'umrah', 'branch_info', 'branch_compare', 'parking', 'reception_contact']);
check(loc.length === 5, `at most 5 cards — ${loc.length}`);
const unitOf = (k) => all.find((c) => c.key === k).unit_keys;
check(loc.every((k) => JSON.stringify(unitOf(k)) === '["airport-road"]'), `the unit's own cards first — ${loc.join(', ')}`);
const park = keys('airport-road', ['parking', 'location_directions']);
check(park[0] === 'k-airport-address' && park.includes('k-parking-detail'), `own (k-airport-address) before shared (k-parking-detail) — ${park.join(', ')}`);
const exactFirst = keys('airport-road', ['menu']);
check(exactFirst.indexOf('k-cafe-menu') < exactFirst.indexOf('k-cafe-airport') || !exactFirst.includes('k-cafe-airport'), `an exact topic before a related one — ${exactFirst.join(', ')}`);
check(JSON.stringify(relatedTopics(TOPICS, ['cafe_restaurant']).sort()) === JSON.stringify(['cafe_ordering', 'menu']), 'a parent topic relates to its children');
check(relatedTopics(TOPICS, ['menu']).includes('cafe_restaurant'), 'a child topic relates to its parent');
check(keys('airport-road', ['cafe_restaurant']).includes('k-cafe-menu'), 'a parent topic reads its children\'s cards');
check(keys('airport-road', []).length === 0, 'no topic → nothing');
check(keys('shafa-road', ['parking']).includes('k-parking-detail') && keys('airport-road', ['parking']).includes('k-parking-detail'), 'a card tagged with both branches is read on both');
check(!loc.some((k) => JSON.stringify(unitOf(k)) === '["shafa-road"]') && !keys('airport-road', ['jacuzzi_balcony']).includes('k-shafa-jacuzzi-balcony'), 'never a card about the other branch alone');

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

// ── 5. the café ──
check(keys('airport-road', ['menu']).includes('k-cafe-menu'), 'the café menu card on airport-road');
for (const t of [['menu'], ['menu', 'cafe_ordering'], ['cafe_restaurant'], ['breakfast', 'menu'], TOPICS.map((x) => x.key)]) {
  const s = keys('shafa-road', t, cards);
  check(!s.includes('k-cafe-menu') && !s.includes('k-cafe-breakfast-menu') && !s.includes('k-cafe-airport') && !s.includes('k-cafe-phone'), `shafa-road (${t.length > 3 ? 'every topic' : t.join(',')}): never the Airport Road café's cards — ${s.join(', ')}`);
}
check(keys('shafa-road', ['cafe_restaurant'], cards).includes('k-shafa-restaurant') && !keys('airport-road', ['cafe_restaurant'], cards).includes('k-shafa-restaurant'), 'Shafa Road\'s restaurant card on shafa-road only');
check(JSON.stringify(unitReadKeys(UNITS, 'lobby-cafe')) === '["lobby-cafe","airport-road"]' && keys('lobby-cafe', ['menu'], cards).includes('k-cafe-menu'), 'the lobby café unit reads its branch\'s cards');
check(SEED.filter((c) => c.id.startsWith('k-cafe-')).every((c) => JSON.stringify(c.unit_keys) === '["airport-road"]'), 'every café card is tagged airport-road only');

// ── 6. the SQL function states the same rule ──
const fn = MIG.slice(MIG.indexOf('create function public.hub_knowledge_for('), MIG.indexOf('\n$$;', MIG.indexOf('create function public.hub_knowledge_for(')));
check(/if u\.knowledge_hidden or cardinality\(coalesce\(p_topics, '\{\}'\)\) = 0 then/.test(fn), 'SQL: a knowledge_hidden unit, or no topic → nothing');
check(/v_hidden text\[\] := array\(select x\.key from public\.hub_units x where x\.knowledge_hidden\)/.test(fn) && /where not \(c\.unit_keys && v_hidden\)/.test(fn), 'SQL: never a card tagged with a knowledge_hidden unit');
check(/and \(cardinality\(c\.unit_keys\) = 0 or c\.unit_keys && v_keys\)/.test(fn) && /case when u\.kind = 'dining' then array\(select b\.key from public\.hub_units b where b\.kind = 'branch' and b\.branch_slug = u\.branch_slug\)/.test(fn), 'SQL: tagged cards on their units only; a dining unit reads its branch\'s');
check(/k\.status = 'published' and k\.live is not null and not k\.is_test/.test(fn) && /\(k\.live ->> 'expires_on'\)::date >= v_today/.test(fn), 'SQL: published, live, unexpired, never a test card');
check(/case when c\.unit_keys = array\[u\.key\] then 0 when u\.key = any \(c\.unit_keys\) then 1 when c\.unit_keys && v_keys then 2 else 3 end as rank_unit/.test(fn)
  && /order by rank_unit, exact desc, related desc, c\.sort, c\.key\s+limit v_n/.test(fn), 'SQL: the same order and the limit');
check(/v_n integer := greatest\(internal\.hub_setting_int\('hub_cards_per_turn', 5\), 1\)/.test(fn), 'SQL: hub_cards_per_turn (5)');
check(/internal\.hub_fill_fees\(z\.live ->> \('a_' \|\| v_lang\), v_lang\)/.test(fn) && /from public\.faq_items f\s+where f\.live is not null and not coalesce\(\(f\.live ->> 'hidden'\)::boolean, false\) and not f\.is_test/.test(fn), 'SQL: the FAQ read live (published, shown), the fees filled from Settings');
check(/revoke execute on function public\.hub_knowledge_for\(text, text\[\], text\)[^;]*from public, anon, authenticated;/.test(MIG) && /grant execute on function public\.hub_knowledge_for\(text, text\[\], text\)[^;]*to service_role;/.test(MIG), 'SQL: service role only');
const T = read('supabase/tests/guest_hub_knowledge.sql');
for (const name of ['R1 the café menu card on airport-road', 'R2 the Airport Road café menu is never returned for shafa-road', 'R4 at most hub_cards_per_turn (5) cards', 'R7 a card tagged with the rooftop is never returned', 'R9 an expired card is excluded']) {
  check(T.includes(name), `the SQL test «${name}» exists`);
}

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-retrieval-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-retrieval-check: ${n} checks passed`);
