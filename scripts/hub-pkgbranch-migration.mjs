// Guest Hub — the package order's branch (Ahmed, 19 Nov 2026 — DECISIONS.md 2026-11-19 «Package order: the number's branch
// by default»). Writes supabase/migrations/20261119100000_guest_hub_package_branch.sql: public.hub_turn_finish as last
// defined (20261118200000_guest_hub_h10.sql) + ONE block — a finish carrying `handoff_branch` (engine.ts: a package order
// for the other branch) moves the conversation to that branch's unit right before the NEW hand-off, so the hand-off row,
// its staff alert and «المحادثات» belong to that branch's reception (the same move as the inbox's hub_transfer: the replies
// still leave from the number the guest wrote to). Never in a test run. Run ONCE before the migration is applied; never
// after (CLAUDE.md §12) — then it only checks.
//   node scripts/hub-pkgbranch-migration.mjs [--force]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
export const OUT_PATH = 'supabase/migrations/20261119100000_guest_hub_package_branch.sql';
const OUT = new URL(`../${OUT_PATH}`, import.meta.url);
const SRC = 'supabase/migrations/20261118200000_guest_hub_h10.sql';

/** the last definition of a function in a migration (from its create line to the closing $$;) */
function lastDef(sql, head) {
  const at = sql.lastIndexOf(head);
  if (at < 0) throw new Error(`${head} not found in ${SRC}`);
  const end = sql.indexOf('\n$$;', at);
  if (end < 0) throw new Error(`${head}: no closing $$;`);
  return sql.slice(at, end + 4);
}
const once = (s, a, b) => {
  if (s.split(a).length !== 2) throw new Error(`hub-pkgbranch-migration: anchor not found exactly once: ${a.slice(0, 60)}`);
  return s.split(a).join(b);
};

export function migration() {
  let f = lastDef(read(SRC), 'create or replace function public.hub_turn_finish(p_turn uuid, p jsonb) returns jsonb');
  f = once(f, '  v_capped boolean := false;\nbegin\n', '  v_capped boolean := false;\n  v_move public.hub_units;\n  v_here public.hub_units;\nbegin\n');
  f = once(f, '  else\n    v_from := c.state;\n',
    `  else
    v_from := c.state;
    -- 19 Nov 2026 (Ahmed): a package order for the other branch — the conversation moves to that branch's unit right
    -- before the NEW hand-off (its row, staff alert and inbox follow the unit); the channel stays the guest's number
    if v_to = 'human' and (v_from <> 'human' or coalesce((p ->> 'resumed')::boolean, false)) and p ->> 'handoff_branch' in ('airport-road', 'shafa-road') then
      select * into v_move from public.hub_units where kind = 'branch' and branch_slug = p ->> 'handoff_branch' and status = 'active' limit 1;
      select * into v_here from public.hub_units where id = c.unit_id;
      if v_move.id is not null and v_move.id <> c.unit_id then
        insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
        values (c.id, 'transfer', v_here.key, v_move.key, 'package_branch', c.is_test);
        update public.hub_conversations set unit_id = v_move.id where id = c.id;
      end if;
    end if;
`);
  return `-- Guest Hub — the package order's branch (Ahmed, 19 Nov 2026 — DECISIONS.md 2026-11-19): the branch of a package order is
-- the branch of the number the guest wrote to by default; an order the guest names for the other branch is handed to that
-- branch's reception. public.hub_turn_finish as last defined in 20261118200000_guest_hub_h10.sql + the move of the
-- conversation to that branch's unit right before the new hand-off (event kind transfer, reason package_branch). Generated
-- by scripts/hub-pkgbranch-migration.mjs — never edited once applied (CLAUDE.md §12). No mode, licence or switch touched.
select set_config('app.actor', 'migration', true);

${f}
`;
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const out = migration();
  if (existsSync(OUT) && !process.argv.includes('--force')) {
    if (readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') !== out) {
      console.error(`${OUT_PATH} differs from its generator — never regenerate an applied migration (CLAUDE.md §12)`);
      process.exit(1);
    }
    console.log(`✓ ${OUT_PATH} = its generator`);
  } else {
    writeFileSync(OUT, out, 'utf8');
    console.log(`✓ wrote ${OUT_PATH}`);
  }
}
