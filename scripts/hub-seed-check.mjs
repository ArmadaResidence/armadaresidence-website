// Guest Hub — the knowledge seed (14 Nov 2026, session H4; docs/guest-hub/GUEST-HUB-SPEC.md §4.6, §4.8; DECISIONS.md
// 2026-11-13 «the knowledge seed approved» and 2026-11-14 «Guest Hub H4»). OFFLINE and fast (FAST_CHECKS).
//   1. docs/guest-hub/knowledge-seed.json: 37 cards, each with an id k-…, a source, a source date, both languages (title
//      and text), known units and known topics;
//   2. docs/guest-hub/topics.json: 56 topics, 9 always handed off, every parent known;
//   3. tests/hub-bank/seed.jsonl: 102 questions (a header first), unique ids, a known unit and language, an action; every
//      card id it names exists (the committed cards, or the two Wi-Fi cards that live on production only) and every FAQ
//      id is a question of content/faq.json; {fee:*} / {quote:*} / {card:<id>} are run-time references, never figures;
//   4. the repository is public: no committed file holds a card whose id starts with k-wifi- (other than the public
//      k-wifi-public card), wifi-cards.json is ignored and not tracked;
//   5. the migration seeded exactly these files (its two JSON blocks = the files), its known numbers = content/contact.json,
//      and every FAQ key a topic reads is a question of content/faq.json.
//   node scripts/hub-seed-check.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SEED = JSON.parse(read('docs/guest-hub/knowledge-seed.json'));
const TOPICS = JSON.parse(read('docs/guest-hub/topics.json')).topics;
const BANK = read('tests/hub-bank/seed.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const FAQ = JSON.parse(read('content/faq.json')).items.map((i) => i.id);
const CONTACT = read('content/contact.json');
const MIG = read('supabase/migrations/20261114100000_guest_hub_knowledge.sql');
const UNITS = ['airport-road', 'shafa-road', 'lobby-cafe', 'rooftop'];
// the expected actions of the bank (seed-1): the engine's answer kinds and the fixed flows of copy.md
const ACTIONS = ['answer', 'ask', 'quote', 'handoff', 'refuse', 'greeting', 'third_language', 'booking_status', 'cancel_word_question', 'opt_out', 'send_summary'];
const WIFI_PRODUCTION = ['k-wifi-password-airport', 'k-wifi-password-shafa'];

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ── 1. the cards ──
const cards = SEED.cards;
const topicKeys = new Set(TOPICS.map((t) => t.key));
check(cards.length === 37, `37 committed cards — ${cards.length}`);
check(new Set(cards.map((c) => c.id)).size === cards.length, 'the card ids are unique');
for (const c of cards) {
  const p = [];
  if (!/^k-[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id) || c.id.length > 60) p.push('id');
  if (!String(c.source ?? '').trim()) p.push('source');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.source_date ?? '') || c.source_date > '2026-11-14') p.push('source_date');
  for (const f of ['title_ar', 'title_en', 'text_ar', 'text_en']) if (!String(c[f] ?? '').trim()) p.push(f);
  if (!/[ء-ي]/.test(c.text_ar) || /[ء-ي]/.test(c.text_en)) p.push('language');
  if (c.title_ar.length > 120 || c.title_en.length > 120 || c.text_ar.length > 1200 || c.text_en.length > 1200) p.push('length');
  if (!c.topic_keys?.length || c.topic_keys.some((k) => !topicKeys.has(k))) p.push('topics');
  if (c.unit_keys?.some((k) => !UNITS.includes(k))) p.push('units');
  if (c.expires_on !== null && !/^\d{4}-\d{2}-\d{2}$/.test(c.expires_on)) p.push('expires_on');
  if (/[٠-٩۰-۹]/.test(c.text_ar + c.text_en + c.title_ar + c.title_en)) p.push('indic digits');
  check(p.length === 0, `card ${c.id}: ${p.join(', ')}`);
}
check(!cards.some((c) => c.unit_keys.includes('rooftop')), 'no seed card is about the rooftop restaurant');

// ── 2. the topics ──
check(TOPICS.length === 56 && TOPICS.filter((t) => t.always_handoff).length === 9, `56 topics, 9 always handed off — ${TOPICS.length} / ${TOPICS.filter((t) => t.always_handoff).length}`);
check(new Set(TOPICS.map((t) => t.key)).size === TOPICS.length && TOPICS.every((t) => /^[a-z0-9_]{2,60}$/.test(t.key) && t.label_ar && t.label_en), 'topic keys unique and well formed, both labels');
check(TOPICS.every((t) => t.parent_key === null || topicKeys.has(t.parent_key)), 'every parent topic exists');
check(['complaint', 'compensation', 'deposit', 'rooftop', 'human_request'].every((k) => TOPICS.find((t) => t.key === k)?.always_handoff), 'complaint, compensation, deposit, the rooftop and «a person» are always handed off');

// ── 3. the test bank ──
const [head, ...qs] = BANK;
check(head?._header === true && Array.isArray(head.global_must_not_include), 'seed.jsonl starts with its header');
check(qs.length === 102, `102 test questions — ${qs.length}`);
check(new Set(qs.map((q) => q.id)).size === qs.length, 'the question ids are unique');
const cardIds = new Set([...cards.map((c) => c.id), ...WIFI_PRODUCTION]);
for (const q of qs) {
  const p = [];
  if (!UNITS.includes(q.unit)) p.push('unit');
  // Arabic and English only in v1; a third language is a question of its own kind (the fixed bilingual reply of copy.md §5)
  if (!(['ar', 'en'].includes(q.language) || (q.expect?.action === 'third_language' && /^[a-z]{2,3}$/.test(q.language ?? '')))) p.push('language');
  if (!Array.isArray(q.messages) || !q.messages.length) p.push('messages');
  if (!ACTIONS.includes(q.expect?.action)) p.push(`action ${q.expect?.action}`);
  for (const id of q.expect?.cards ?? []) if (!cardIds.has(id)) p.push(`card ${id}`);
  for (const id of q.expect?.faq ?? []) if (!FAQ.includes(id)) p.push(`faq ${id}`);
  const refs = JSON.stringify(q).match(/\{(card|fee|quote):[^}]+\}/g) ?? [];
  for (const r of refs) if (r.startsWith('{card:') && !cardIds.has(r.slice(6, -1))) p.push(`ref ${r}`);
  check(p.length === 0, `question ${q.id}: ${p.join(', ')}`);
}
check(qs.some((q) => (q.expect?.cards ?? []).includes('k-wifi-password-airport')) && JSON.stringify(qs).includes('{card:k-wifi-password-airport}'), 'the Wi-Fi questions name the production cards and read the password at run time');

// ── 4. no Wi-Fi password card in the repository ──
// the committed files: git's list, or — in the hooks' exported snapshot (not a repository) — every file of the folder
let tracked = [];
let inRepo = true;
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  if (!tracked.length) throw new Error('empty');
} catch {
  inRepo = false;
  tracked = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.astro', '.media-cache', 'screenshots'].includes(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else tracked.push(rel);
    }
  };
  walk('');
}
check(!tracked.some((f) => /(^|\/)wifi-cards\.json$/.test(f)), `wifi-cards.json is not ${inRepo ? 'tracked' : 'in the snapshot'}`);
check(/^wifi-cards\.json$/m.test(read('.gitignore')), 'wifi-cards.json is in .gitignore');
const CARD_ID = /["']?(?:id|key)["']?\s*[:=]\s*["']k-wifi-(?!public["'])[a-z0-9-]+["']/;
const SQL_KEY = /\(\s*'k-wifi-(?!public')[a-z0-9-]+'/;
const bad = [];
for (const f of tracked) {
  if (!/\.(json|jsonl|sql|ts|tsx|mjs|js|md|py|html|txt|csv)$/.test(f) || f === 'scripts/hub-seed-check.mjs') continue;
  let s;
  try {
    s = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  } catch {
    continue;
  }
  if (!s.includes('k-wifi-')) continue;
  if (CARD_ID.test(s) || SQL_KEY.test(s)) bad.push(f);
}
check(bad.length === 0, `no committed file holds a Wi-Fi password card (k-wifi-…) — ${bad.join(', ')}`);

// ── 5. the migration seeded these files ──
const block = (tag) => {
  const m = MIG.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
  return m ? JSON.parse(m[1]) : null;
};
check(JSON.stringify(block('seed_topics')) === JSON.stringify(TOPICS), 'the migration\'s topics = docs/guest-hub/topics.json (an applied migration is never edited — later changes go through the dashboard)');
check(JSON.stringify(block('seed_cards')) === JSON.stringify(cards), 'the migration\'s cards = docs/guest-hub/knowledge-seed.json');
const phones = [...new Set((CONTACT.match(/\+966\d{9}/g) ?? []).map((p) => p.slice(1)))].sort();
const known = (MIG.match(/create function internal\.hub_known_phones\(\)[\s\S]*?array\[([^\]]+)\]/) ?? [])[1]?.match(/\d+/g)?.sort() ?? [];
check(JSON.stringify(phones) === JSON.stringify(known), `the property's numbers = content/contact.json — ${known.join(',')} vs ${phones.join(',')}`);
const faqKeys = [...(MIG.match(/update public\.hub_topics h set faq_keys = m\.keys[\s\S]*?\) as m\(key, keys\)/)?.[0] ?? '').matchAll(/array\[([^\]]+)\]/g)].flatMap((m) => m[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1)));
check(faqKeys.length > 0 && faqKeys.every((k) => FAQ.includes(k)), `every FAQ key a topic reads is a question of content/faq.json — ${faqKeys.filter((k) => !FAQ.includes(k)).join(',')}`);
check(/^-- 14 Nov 2026 — Guest Hub/.test(MIG) && !/k-wifi-password/.test(MIG.replace(/^--.*$/gm, '')), 'the migration holds no Wi-Fi password card');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-seed-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-seed-check: ${n} checks passed`);
