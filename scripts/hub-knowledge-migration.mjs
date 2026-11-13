// Guest Hub H4 (14 Nov 2026): writes supabase/migrations/20261114100000_guest_hub_knowledge.sql from
// scripts/hub-knowledge-migration.src.sql, the approved seed (docs/guest-hub/topics.json, docs/guest-hub/knowledge-seed.json —
// Ahmed, 13 Nov 2026) and the latest internal.audit (20261113100000, with the knowledge tables added). Run ONCE, before the
// migration is applied; an applied migration is never edited (CLAUDE.md §12) — so after 14 Nov 2026 this script refuses to
// overwrite the file unless --force is given for a migration that is not yet on any database.
//   node scripts/hub-knowledge-migration.mjs [--force]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const OUT = new URL('../supabase/migrations/20261114100000_guest_hub_knowledge.sql', import.meta.url);
if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error('hub-knowledge-migration: the migration exists — an applied migration is never edited (pass --force only before it is applied)');
  process.exit(1);
}
const src = read('scripts/hub-knowledge-migration.src.sql');
const topics = JSON.parse(read('docs/guest-hub/topics.json')).topics;
const cards = JSON.parse(read('docs/guest-hub/knowledge-seed.json')).cards;
if (cards.some((c) => /^k-wifi-password/.test(c.id))) throw new Error('a Wi-Fi password card is in the committed seed');

const found = read('supabase/migrations/20261113100000_guest_hub_foundation.sql');
const a = found.indexOf('create or replace function internal.audit() returns trigger');
const audit = found.slice(a, found.indexOf('\n$$;\n', a) + 4);
const ELSE = "    else v_id := coalesce(v_row ->> 'id', '?');";
if (!audit.includes(ELSE)) throw new Error('internal.audit: the else branch moved');
const added = [
  '    -- 14 Nov 2026 (H4): the knowledge base — cards and topics have no branch; the queue takes its unit\'s',
  "    when 'hub_knowledge_cards' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;",
  "    when 'hub_topics' then v_id := v_row ->> 'key'; v_test := (v_row ->> 'is_test')::boolean;",
  "    when 'hub_unanswered' then",
  "      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;",
  "      select u.branch_slug into v_branch from public.hub_units u where u.id = (v_row ->> 'unit_id')::uuid;",
].join('\n');
const auditH4 = audit.replace(ELSE, `${added}\n${ELSE}`);

const lit = (o) => {
  const s = JSON.stringify(o);
  if (/\$seed_(topics|cards)\$/.test(s)) throw new Error('a dollar-quote tag inside the seed');
  return s;
};
const out = src
  .replace('__AUDIT_FN__', () => auditH4)
  .replace('__TOPICS_JSON__', () => lit(topics))
  .replace('__CARDS_JSON__', () => lit(cards));
if (/__[A-Z_]+__/.test(out)) throw new Error('a placeholder left');
writeFileSync(OUT, out, 'utf8');
console.log(`hub-knowledge-migration: ${topics.length} topics, ${cards.length} cards → supabase/migrations/20261114100000_guest_hub_knowledge.sql`);
