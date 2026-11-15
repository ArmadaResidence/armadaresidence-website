// Guest Hub H6c (15 Nov 2026): writes supabase/migrations/20261115200000_guest_hub_team.sql from
// scripts/hub-team-migration.src.sql and the LATEST definitions of the functions the session changes, each copied from
// its migration with a few exact edits (every edit must match exactly once, or the script stops). Run ONCE before the
// migration is applied; an applied migration is never edited (CLAUDE.md §12) — after that the script refuses to overwrite
// it (pass --force only for a migration on no database yet). hub-team-check asserts the result.
//   node scripts/hub-team-migration.mjs [--force]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
export const OUT_PATH = 'supabase/migrations/20261115200000_guest_hub_team.sql';
const OUT = new URL(`../${OUT_PATH}`, import.meta.url);

/** the text of one function as a migration defines it: from its create line to its closing $$; */
export function fnFrom(file, name) {
  const mig = read(file);
  const re = new RegExp(`create (or replace )?function ${name.replace('.', '\\.')}\\(`, 'g');
  const all = [...mig.matchAll(re)];
  if (all.length !== 1) throw new Error(`${file}: ${name} defined ${all.length} times`);
  const a = all[0].index;
  const end = mig.indexOf('\n$$;', a);
  if (end < 0) throw new Error(`${file}: ${name} has no end`);
  return mig.slice(a, end + 4).replace(/^create function /, 'create or replace function ');
}

function edit(fn, name, from, to) {
  const n = fn.split(from).length - 1;
  if (n !== 1) throw new Error(`${name}: an edit matched ${n} times — ${from.slice(0, 80)}`);
  return fn.replace(from, () => to);
}

export const SOURCES = {
  hub_turn_queue: 'supabase/migrations/20261114200000_guest_hub_assistant.sql',
  hub_turn_claim: 'supabase/migrations/20261115100000_guest_hub_conversation.sql',
  hub_turn_finish: 'supabase/migrations/20261114200000_guest_hub_assistant.sql',
  hub_send_finish: 'supabase/migrations/20261114600000_guest_hub_gaps.sql',
  wa_claim: 'supabase/migrations/20261113200000_guest_hub_inbound.sql',
  wa_status_update: 'supabase/migrations/20261113200000_guest_hub_inbound.sql',
  hub_templates_store: 'supabase/migrations/20261113100000_guest_hub_foundation.sql',
};

export function replaced() {
  const out = [];
  const get = (n) => fnFrom(SOURCES[n], `public.${n}`);

  let q = get('hub_turn_queue');
  q = edit(q, 'hub_turn_queue', `    v_kind := case when c.test_state in ('human', 'closed') then 'tag' else 'reply' end;
  else
    v_kind := case when c.state = 'human' then 'tag' else 'reply' end;`, `    -- H6c: «بانتظار موظف» (a hand-off with no staff reply yet) is answered by the assistant in a test run as well
    v_kind := case when c.test_state = 'closed' then 'tag' else 'reply' end;
  else
    -- H6c: «بانتظار موظف» → the assistant keeps answering what it can; «مع موظف» → silent (tagging) until the branch's
    -- «عودة المساعد» minutes of staff silence, then the guest's message resumes it
    v_kind := case when c.state = 'human' and internal.hub_human_phase(c, u) is null then 'tag' else 'reply' end;`);
  out.push('-- hub_turn_queue (20261114200000, copied): the two halves of «مع الفريق» (H6c)', q);

  let c = get('hub_turn_claim');
  c = edit(c, 'hub_turn_claim', '  v_text text;\nbegin', '  v_text text;\n  v_phase text;\nbegin');
  c = edit(c, 'hub_turn_claim', `  v_state := case when v_mode = 'test' then coalesce(c.test_state, 'new') else c.state end;`,
    `  v_state := case when v_mode = 'test' then coalesce(c.test_state, 'new') else c.state end;
  -- H6c: waiting (handed, no staff reply) / resume (staff silent for the branch's minutes) / null (silent)
  v_phase := case when v_mode = 'test' then case when v_state = 'human' then 'waiting' end when c.state = 'human' then internal.hub_human_phase(c, u) end;`);
  c = edit(c, 'hub_turn_claim', `kind = case when v_state in ('human', 'closed') then 'tag' else kind end`,
    `kind = case when v_state = 'closed' or (v_state = 'human' and v_phase is null) then 'tag' else kind end`);
  c = edit(c, 'hub_turn_claim', `'state', v_state, 'real_state', c.state, 'state_before_human', c.state_before_human,`,
    `'state', v_state, 'real_state', c.state, 'state_before_human', c.state_before_human, 'human_phase', v_phase,`);
  c = edit(c, 'hub_turn_claim', `'author', case when h.direction = 'in' then 'guest' else 'us' end`,
    `'author', case when h.direction = 'in' then 'guest' when h.author in ('staff', 'phone') then 'staff' else 'us' end`);
  c = edit(c, 'hub_turn_claim', `'failed_max', internal.hub_setting_int('hub_failed_understanding_max', 2),`,
    `'failed_max', internal.hub_setting_int('hub_failed_understanding_max', 2), 'resume_minutes', internal.hub_resume_minutes(u.branch_slug),`);
  out.push('-- hub_turn_claim (20261115100000, copied): the hand-off phase, the staff messages named in the history (H6c)', c);

  let f = get('hub_turn_finish');
  f = edit(f, 'hub_turn_finish', `m ->> 'layer' in ('understand', 'tag', 'compose')`, `m ->> 'layer' in ('understand', 'tag', 'compose', 'summary')`);
  f = edit(f, 'hub_turn_finish', `  else
    v_from := c.state;
    if v_to is not null and v_to <> v_from then`, `  else
    v_from := c.state;
    if v_to = 'human' and v_from = 'human' then
      if coalesce((p ->> 'resumed')::boolean, false) then
        -- resumed after a staff reply and handed again (H6c): a new hand-off, with its own staff alert
        insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
        values (c.id, 'handoff', 'human', 'human', coalesce(nullif(p ->> 'reason', ''), 'handoff'), c.is_test);
        update public.hub_conversations
           set state_changed_at = now(), human_reason = coalesce(nullif(p ->> 'reason', ''), 'handoff'), owner_kind = null, owner_staff_id = null,
               priority = case when p ->> 'priority' = 'high' then 'high' else priority end, waiting_since = coalesce(waiting_since, now())
         where id = c.id;
      elsif p ->> 'resume_state' in ('inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked') then
        -- «بانتظار موظف»: where the assistant's flow stands while it waits (for the resume and «إعادة للمساعد»)
        update public.hub_conversations set state_before_human = p ->> 'resume_state' where id = c.id and state_before_human is distinct from p ->> 'resume_state';
      end if;
      if p ->> 'priority' = 'high' then
        update public.hub_conversations set priority = 'high' where id = c.id and priority <> 'high';
      end if;
    elsif v_to is not null and v_to <> v_from then`);
  f = edit(f, 'hub_turn_finish', `  -- the hand-off note (code-composed, spec §2.6): an internal note at the top of the thread, never sent`,
    `  -- the staff alert's line and the booking ref or room (H6c), on the conversation's waiting hand-off
  if not v_test and (nullif(p ->> 'handoff_summary', '') is not null or nullif(p ->> 'handoff_ref', '') is not null or coalesce((p ->> 'handoff_add')::boolean, false)) then
    update public.hub_handoffs h
       set summary = coalesce(h.summary, nullif(left(btrim(p ->> 'handoff_summary'), 120), '')),
           ref_text = coalesce(h.ref_text, nullif(left(btrim(p ->> 'handoff_ref'), 40), '')),
           additions = h.additions + case when coalesce((p ->> 'handoff_add')::boolean, false) then 1 else 0 end
      from public.hub_conversations x
     where x.id = c.id and h.id = x.handoff_id;
  end if;
  -- the hand-off note (code-composed, spec §2.6): an internal note at the top of the thread, never sent`);
  f = edit(f, 'hub_turn_finish', `return jsonb_build_object('ok', true, 'cost_usd', v_cost, 'messages', v_out, 'send', v_send, 'test', v_test,`,
    `return jsonb_build_object('ok', true, 'cost_usd', v_cost, 'messages', v_out, 'send', v_send, 'test', v_test,
                            'alerts', exists (select 1 from public.hub_staff_sends s where s.status = 'queued' and not s.is_test),`);
  out.push('-- hub_turn_finish (20261114200000, copied): «بانتظار موظف» stays with the team; a resumed hand-off is a new one; the alert line (H6c)', f);

  let s = get('hub_send_finish');
  s = edit(s, 'hub_send_finish', `first_response_at = case when not v_notice then coalesce(first_response_at, case when waiting_since is not null then now() end) else first_response_at end,
           waiting_since = case when v_notice then waiting_since else null end`,
    `first_response_at = case when not v_notice and state <> 'human' then coalesce(first_response_at, case when waiting_since is not null then now() end) else first_response_at end,
           -- H6c: an answer while «بانتظار موظف» keeps the conversation waiting for the team
           waiting_since = case when v_notice or state = 'human' then waiting_since else null end`);
  out.push('-- hub_send_finish (20261114600000, copied): an assistant answer while «بانتظار موظف» never clears the wait (H6c)', s);

  let w = get('wa_claim');
  w = edit(w, 'wa_claim', `    if w.r_status <> 'confirmed'\n`, `    -- H6c: a staff or report number is never a guest (no review, no reminder)
    if internal.hub_staff_excluded(w.phone) then
      update public.whatsapp_messages set status = 'skipped', error_code = 'staff_number', updated_at = now() where id = w.id;
      continue;
    end if;
    if w.r_status <> 'confirmed'\n`);
  w = edit(w, 'wa_claim', `    v_code := null;\n    if e.template = 'optout_reply' then`,
    `    v_code := case when internal.hub_staff_excluded(e.phone) then 'staff_number' end;\n    if v_code is not null then\n      null;\n    elsif e.template = 'optout_reply' then`);
  out.push('-- wa_claim (20261113200000, copied): a staff or report number never gets a guest message (H6c)', w);

  let u = get('wa_status_update');
  u = edit(u, 'wa_status_update', `  get diagnostics v_m = row_count;\n  return v_n + v_m;`, `  get diagnostics v_m = row_count;
  v_n := v_n + v_m;
  -- H6c: the staff alerts and the daily reports
  update public.hub_staff_sends w
     set status = case when p_status = 'failed' then case when w.status in ('delivered', 'read') then w.status else 'failed' end
                       when coalesce((v_rank ->> w.status)::int, -1) < (v_rank ->> p_status)::int then p_status else w.status end,
         error_code = case when p_status = 'failed' and w.status not in ('delivered', 'read') then coalesce(left(p_error_code, 40), w.error_code) else w.error_code end,
         price = coalesce(p_price, w.price), currency = coalesce(p_currency, w.currency), updated_at = now()
   where w.provider_message_id = p_ycloud_id and w.status not in ('test', 'skipped', 'queued');
  get diagnostics v_m = row_count;
  return v_n + v_m;`);
  out.push('-- wa_status_update (20261113200000, copied): + the staff alerts and reports (H6c)', u);

  let t = get('hub_templates_store');
  t = edit(t, 'hub_templates_store', `insert into public.hub_templates as t (channel_id, name, language, category, status, reason, read_at)`,
    `insert into public.hub_templates as t (channel_id, name, language, category, status, reason, read_at, body)`);
  t = edit(t, 'hub_templates_store', `nullif(left(coalesce(r ->> 'reason', ''), 300), ''), now())`,
    `nullif(left(coalesce(r ->> 'reason', ''), 300), ''), now(), nullif(left(coalesce(r ->> 'body', ''), 2000), ''))`);
  t = edit(t, 'hub_templates_store', `set category = excluded.category, status = excluded.status, reason = excluded.reason, read_at = excluded.read_at;`,
    `set category = excluded.category, status = excluded.status, reason = excluded.reason, read_at = excluded.read_at, body = coalesce(excluded.body, t.body);`);
  out.push('-- hub_templates_store (20261113100000, copied): + the body YCloud stores (H6c)', t);

  return out.join('\n\n');
}

/** the guest conversations of the team bank (kind guest — the staff chat and the alert rules are not engine items) */
export function teamBankItems() {
  return read('tests/hub-bank/conversations-team.jsonl').split(String.fromCharCode(10)).filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((x) => !x._header && (x.kind ?? 'guest') === 'guest')
    .map((x) => ({ id: x.id, unit: x.unit, language: x.language, messages: x.messages, expect: x.expect, note: x.note ?? null, tags: x.tags }));
}
export function migration() {
  const src = read('scripts/hub-team-migration.src.sql');
  if (!src.includes('/*@REPLACED@*/') || !src.includes('/*@TEAM_BANK@*/')) throw new Error('a marker moved');
  const bank = JSON.stringify(teamBankItems());
  if (bank.includes('$team_bank$')) throw new Error('a dollar-quote tag inside the bank');
  // function replacers: a replacement string would read `$'` / `$$` as patterns
  return src.replace('/*@REPLACED@*/', () => replaced()).replace('/*@TEAM_BANK@*/', () => bank);
}

if (process.argv[1]?.endsWith('hub-team-migration.mjs')) {
  if (existsSync(OUT) && !process.argv.includes('--force')) {
    const now = migration();
    if (read(OUT_PATH) === now) {
      console.log(`✓ ${OUT_PATH} is current`);
      process.exit(0);
    }
    console.error(`${OUT_PATH} exists and differs — an applied migration is never edited (pass --force only before it is applied)`);
    process.exit(1);
  }
  writeFileSync(OUT, migration(), 'utf8');
  console.log(`✓ wrote ${OUT_PATH}`);
}
