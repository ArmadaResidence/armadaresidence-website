// Guest Hub H7 (15 Nov 2026): writes supabase/migrations/20261115400000_guest_hub_media.sql from
// scripts/hub-media-migration.src.sql and the LATEST definitions of the functions the session changes, each copied from its
// migration with a few exact edits (every edit must match exactly once, or the script stops). Run ONCE before the migration
// is applied; an applied migration is never edited (CLAUDE.md §12) — after that the script refuses to overwrite it (pass
// --force only for a migration on no database yet). hub-media-check and hub-eval-check assert the result.
//   node scripts/hub-media-migration.mjs [--force]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fnFrom } from './hub-team-migration.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
export const OUT_PATH = 'supabase/migrations/20261115400000_guest_hub_media.sql';
const OUT = new URL(`../${OUT_PATH}`, import.meta.url);

function edit(fn, name, from, to) {
  const n = fn.split(from).length - 1;
  if (n !== 1) throw new Error(`${name}: an edit matched ${n} times — ${from.slice(0, 80)}`);
  return fn.replace(from, () => to);
}

export const SOURCES = {
  'internal.hub_setting_keys': 'supabase/migrations/20261113100000_guest_hub_foundation.sql',
  'internal.hub_setting_int_range': 'supabase/migrations/20261113100000_guest_hub_foundation.sql',
  'internal.hub_setting_check': 'supabase/migrations/20261113100000_guest_hub_foundation.sql',
  'public.hub_setting_set': 'supabase/migrations/20261114200000_guest_hub_assistant.sql',
  'internal.hub_budget_state': 'supabase/migrations/20261114920000_guest_hub_lab_budget.sql',
  'public.hub_turn_claim': 'supabase/migrations/20261115200000_guest_hub_team.sql',
  'public.hub_turn_finish': 'supabase/migrations/20261115200000_guest_hub_team.sql',
  'internal.hub_report_data': 'supabase/migrations/20261115200000_guest_hub_team.sql',
  'public.hub_retention': 'supabase/migrations/20261114200000_guest_hub_assistant.sql',
  'public.hub_thread': 'supabase/migrations/20261114200000_guest_hub_assistant.sql',
  'public.hub_assistant_overview': 'supabase/migrations/20261114400000_guest_hub_lab.sql',
  'public.hub_sim_usage': 'supabase/migrations/20261114400000_guest_hub_lab.sql',
  'public.hub_budget_overview': 'supabase/migrations/20261114200000_guest_hub_assistant.sql',
};

export function replaced() {
  const out = [];
  const get = (n) => fnFrom(SOURCES[n], n);

  let k = get('internal.hub_setting_keys');
  k = edit(k, 'keys', `'hub_spike_factor', 'hub_spike_min', 'hub_summary_time', 'hub_summary_money']`,
    `'hub_spike_factor', 'hub_spike_min', 'hub_summary_time', 'hub_summary_money', 'hub_voice_daily_minutes']`);
  out.push('-- internal.hub_setting_keys (20261113100000, copied): + hub_voice_daily_minutes (H7)', k);

  let r = get('internal.hub_setting_int_range');
  r = edit(r, 'int_range', `    when 'hub_spike_min' then array[1, 1000]`, `    when 'hub_spike_min' then array[1, 1000]
    -- H7: transcribed minutes per unit per Riyadh day (60 — «الميزانية», the system admin's)
    when 'hub_voice_daily_minutes' then array[1, 1440]`);
  out.push('-- internal.hub_setting_int_range (20261113100000, copied): the voice minutes (H7)', r);

  let c = get('internal.hub_setting_check');
  c = edit(c, 'check', `      if coalesce(jsonb_typeof(v), '') <> 'object' or not (v ?& array['understand', 'tag', 'translate', 'compose'])
         or exists (select 1 from jsonb_each(v) x where jsonb_typeof(x.value) <> 'string' or x.value #>> '{}' !~ '^claude-[a-z0-9.-]{3,60}$') then
        raise exception 'settings.hub_models: understand, tag, translate, compose = claude model ids' using errcode = '22023';
      end if;`, `      -- H7: transcribe is OpenAI's model id (gpt-…); every other layer is Claude's
      if coalesce(jsonb_typeof(v), '') <> 'object' or not (v ?& array['understand', 'tag', 'translate', 'compose'])
         or exists (select 1 from jsonb_each(v) x where jsonb_typeof(x.value) <> 'string'
                      or x.value #>> '{}' !~ case when x.key = 'transcribe' then '^gpt-[a-z0-9.-]{3,60}$' else '^claude-[a-z0-9.-]{3,60}$' end) then
        raise exception 'settings.hub_models: understand, tag, translate, compose = claude model ids (transcribe: an OpenAI id)' using errcode = '22023';
      end if;`);
  c = edit(c, 'check', `      for e in select * from jsonb_each(v) loop
        if e.key !~ '^claude-[a-z0-9.-]{3,60}$' or coalesce(jsonb_typeof(e.value -> 'input'), '') <> 'number' or coalesce(jsonb_typeof(e.value -> 'output'), '') <> 'number'`,
    `      for e in select * from jsonb_each(v) loop
        -- H7: OpenAI's transcription model is priced per minute: {per_minute} (USD)
        if e.key ~ '^gpt-[a-z0-9.-]{3,60}$' then
          if coalesce(jsonb_typeof(e.value -> 'per_minute'), '') <> 'number' or (e.value ->> 'per_minute')::numeric not between 0 and 100 then
            raise exception 'settings.hub_model_prices: null or {model: {input, output}} (an OpenAI model: {per_minute})' using errcode = '22023';
          end if;
          continue;
        end if;
        if e.key !~ '^claude-[a-z0-9.-]{3,60}$' or coalesce(jsonb_typeof(e.value -> 'input'), '') <> 'number' or coalesce(jsonb_typeof(e.value -> 'output'), '') <> 'number'`);
  out.push('-- internal.hub_setting_check (20261113100000, copied): the transcription model and its per-minute price (H7)', c);

  let s = get('public.hub_setting_set');
  s = edit(s, 'set', `  if p_key in ('hub_budget_daily_usd', 'hub_budget_monthly_usd', 'hub_budget_alert_pct') and not internal.is_system_admin() then`,
    `  if p_key in ('hub_budget_daily_usd', 'hub_budget_monthly_usd', 'hub_budget_alert_pct', 'hub_voice_daily_minutes') and not internal.is_system_admin() then`);
  out.push('-- public.hub_setting_set (20261114200000, copied): the voice minutes are the system admin\'s, like the budgets (H7)', s);

  let b = get('internal.hub_budget_state');
  b = edit(b, 'budget', `    into v_ds, v_ms, v_tds, v_tms from public.hub_usage_daily u where u.day >= v_month and u.day <= v_today;`,
    `    into v_ds, v_ms, v_tds, v_tms from public.hub_usage_daily u where u.day >= v_month and u.day <= v_today
     -- H7: OpenAI's transcription is not Anthropic's credit: its own line in «الميزانية», never in the Claude budget
     and u.layer <> 'transcribe';`);
  out.push('-- internal.hub_budget_state (20261114920000, copied): the transcription left out of the Claude budget (H7)', b);

  let cl = get('public.hub_turn_claim');
  cl = edit(cl, 'claim', `      'mode', u.assistant_mode, 'skills', to_jsonb(u.skills), 'persona', u.persona_live,`,
    `      'mode', u.assistant_mode, 'skills', to_jsonb(u.skills), 'persona', u.persona_live,
      -- H7: «الفويس» and «الصور»
      'media', jsonb_build_object('voice', u.voice_on, 'images', u.images_on),`);
  cl = edit(cl, 'claim', `    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'payload', m.payload, 'sent_at', m.sent_at,
                                                              'provider_message_id', m.provider_message_id) order by m.sent_at, m.created_at), '[]')`,
    `    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'payload', m.payload, 'sent_at', m.sent_at,
                                                              'provider_message_id', m.provider_message_id,
                                                              -- H7: the stored file and a transcript already made (a retried turn)
                                                              'media_path', m.media_path, 'media_mime', m.media_mime, 'transcript', m.transcript) order by m.sent_at, m.created_at), '[]')`);
  cl = edit(cl, 'claim', `    'history', (select coalesce(jsonb_agg(jsonb_build_object('author', case when h.direction = 'in' then 'guest' when h.author in ('staff', 'phone') then 'staff' else 'us' end, 'body', h.body) order by h.sent_at), '[]')`,
    `    'history', (select coalesce(jsonb_agg(jsonb_build_object('author', case when h.direction = 'in' then 'guest' when h.author in ('staff', 'phone') then 'staff' else 'us' end, 'body', coalesce(h.body, h.transcript)) order by h.sent_at), '[]')`);
  cl = edit(cl, 'claim', `                         where m.conversation_id = c.id and not (m.id = any (t.inbound_message_ids)) and m.kind <> 'note' and m.body is not null`,
    `                         where m.conversation_id = c.id and not (m.id = any (t.inbound_message_ids)) and m.kind <> 'note' and coalesce(m.body, m.transcript) is not null`);
  cl = edit(cl, 'claim', `    'draft', v_draft,
    -- the guest's own bookings`, `    'draft', v_draft,
    -- H7: the unit's transcribed seconds today and the cap
    'voice', internal.hub_voice_state(u.id),
    -- the guest's own bookings`);
  out.push('-- public.hub_turn_claim (20261115200000, copied): the media switches, the stored file and transcript, the voice minutes; a voice note\'s transcript in the history (H7)', cl);

  let f = get('public.hub_turn_finish');
  f = edit(f, 'finish', `  v_ready boolean;
begin`, `  v_ready boolean;
  x jsonb;
  v_capped boolean := false;
begin`);
  f = edit(f, 'finish', `m ->> 'layer' in ('understand', 'tag', 'compose', 'summary')`, `m ->> 'layer' in ('understand', 'tag', 'compose', 'summary', 'vision')`);
  f = edit(f, 'finish', `      v_cost := v_cost + v_one;
    end if;
  end loop;
  update public.hub_turns`, `      v_cost := v_cost + v_one;
    end if;
  end loop;
  -- H7: the transcriptions (OpenAI, per minute — never in the Claude budget) and what each voice note / image became: the
  -- transcript, its length and language, the image's category, the outcome — never anything read from an image
  for x in select * from jsonb_array_elements(coalesce(p -> 'audio', '[]'::jsonb)) loop
    if coalesce((x ->> 'seconds')::numeric, 0) > 0 and coalesce(x ->> 'model', '') ~ '^gpt-[a-z0-9.-]{3,60}$' then
      perform internal.hub_audio_add(t.unit_id, 'turn', x ->> 'model', (x ->> 'seconds')::numeric, t.is_test);
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'media', '[]'::jsonb)) loop
    if coalesce(x ->> 'id', '') ~ '^[0-9a-f-]{36}$' then
      update public.hub_messages
         set transcript = case when x ->> 'status' = 'transcribed' then left(nullif(btrim(x ->> 'transcript'), ''), 8000) else transcript end,
             transcript_seconds = coalesce(case when jsonb_typeof(x -> 'seconds') = 'number' then round((x ->> 'seconds')::numeric, 2) end, transcript_seconds),
             transcript_language = coalesce(case when coalesce(x ->> 'language', '') ~ '^[a-z]{2,8}$' then x ->> 'language' end, transcript_language),
             media_category = coalesce(case when x ->> 'category' in ('id_document', 'payment', 'screenshot', 'problem', 'place', 'other') then x ->> 'category' end, media_category),
             media_status = case when x ->> 'status' in ('transcribed', 'classified', 'too_long', 'voice_capped', 'failed_download', 'failed_transcribe', 'empty', 'unknown_language', 'failed_vision')
                                 then x ->> 'status' else media_status end
       where id = (x ->> 'id')::uuid and conversation_id = t.conversation_id and direction = 'in';
      if x ->> 'status' = 'voice_capped' then v_capped := true; end if;
    end if;
  end loop;
  -- the unit's daily minutes used up: ONE alert email to the active admins per unit and Riyadh day (hub-agent); an alert
  -- of an earlier day is closed first
  if v_capped and not t.is_test then
    update public.hub_alerts set acknowledged_at = now()
     where kind = 'voice_cap' and unit_id = t.unit_id and acknowledged_at is null and not is_test
       and coalesce(payload ->> 'day', '') <> ((now() at time zone 'Asia/Riyadh')::date)::text;
    insert into public.hub_alerts (kind, unit_id, payload)
    values ('voice_cap', t.unit_id, jsonb_build_object('day', ((now() at time zone 'Asia/Riyadh')::date)::text, 'minutes', internal.hub_setting_int('hub_voice_daily_minutes', 60)))
    on conflict do nothing;
  end if;
  update public.hub_turns`);
  out.push('-- public.hub_turn_finish (20261115200000, copied): the vision layer, the transcriptions, the media outcomes, the voice-minutes alert (H7)', f);

  let rd = get('internal.hub_report_data');
  rd = edit(rd, 'report', `      'alerts_sent', (select count(*) from sends where sends.status in ('accepted', 'sent', 'delivered', 'read')),`,
    `      -- H7: the voice notes and images that failed (never a cap: it has its own email)
      'voice_failures', (select count(*) from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id join public.hub_units u on u.id = c.unit_id
                           where u.branch_slug = b and not c.is_test and m.direction = 'in' and m.kind = 'audio'
                             and m.media_status in ('failed_download', 'failed_transcribe', 'empty', 'unknown_language') and m.created_at >= v_from and m.created_at < v_to),
      'image_failures', (select count(*) from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id join public.hub_units u on u.id = c.unit_id
                           where u.branch_slug = b and not c.is_test and m.direction = 'in' and m.kind = 'image'
                             and m.media_status in ('failed_download', 'failed_vision') and m.created_at >= v_from and m.created_at < v_to),
      'alerts_sent', (select count(*) from sends where sends.status in ('accepted', 'sent', 'delivered', 'read')),`);
  out.push('-- internal.hub_report_data (20261115200000, copied): the voice and image faults (H7)', rd);

  let rt = get('public.hub_retention');
  rt = edit(rt, 'retention', `     set body = null, translation_ar = null, translation_en = null, purged_at = p_now`,
    `     set body = null, translation_ar = null, translation_en = null, transcript = null, purged_at = p_now`);
  out.push('-- public.hub_retention (20261114200000, copied): a voice note\'s transcript is cleared with the message text (H7)', rt);

  let th = get('public.hub_thread');
  th = edit(th, 'thread', `'media_path', m.media_path, 'media_mime', m.media_mime,`,
    `'media_path', m.media_path, 'media_mime', m.media_mime,
                   -- H7: «تفريغ صوتي» and the image's category
                   'transcript', m.transcript, 'transcript_seconds', m.transcript_seconds, 'media_category', m.media_category, 'media_status', m.media_status,`);
  out.push('-- public.hub_thread (20261114200000, copied): the transcript, its length, the image category, the media outcome (H7)', th);

  let ov = get('public.hub_assistant_overview');
  ov = edit(ov, 'overview', `        'knowledge_hidden', u.knowledge_hidden, 'lab', internal.hub_unit_lab(u),`,
    `        'knowledge_hidden', u.knowledge_hidden, 'lab', internal.hub_unit_lab(u),
        -- H7: «الفويس» / «الصور» and today's transcribed seconds
        'voice_on', u.voice_on, 'images_on', u.images_on, 'voice_used_seconds', (internal.hub_voice_state(u.id) ->> 'used_seconds')::numeric,`);
  out.push('-- public.hub_assistant_overview (20261114400000, copied): the media switches (H7)', ov);

  let su = get('public.hub_sim_usage');
  su = edit(su, 'sim_usage', `  if p_layer not in ('understand', 'tag', 'compose') then`, `  if p_layer not in ('understand', 'tag', 'compose', 'vision', 'summary') then`);
  out.push('-- public.hub_sim_usage (20261114400000, copied): «المحاكي»\'s image (H7)', su);

  let bo = get('public.hub_budget_overview');
  bo = edit(bo, 'budget_overview', `from public.hub_usage_daily d where d.day >= v_month and d.day <= v_today group by d.unit_id) x`,
    `from public.hub_usage_daily d where d.day >= v_month and d.day <= v_today and d.layer <> 'transcribe' group by d.unit_id) x`);
  bo = edit(bo, 'budget_overview', `    'by_layer', coalesce((select jsonb_agg(jsonb_build_object('layer', x.layer, 'source', x.source, 'calls', x.calls, 'today', x.today, 'month', x.month) order by x.layer, x.source)
                            from (select d.layer, d.source, sum(d.calls) as calls, sum(d.cost_usd) filter (where d.day = v_today) as today, sum(d.cost_usd) as month`,
    `    -- H7: OpenAI's transcription — its own line (seconds and USD), outside the Claude budget; the daily cap per unit
    'audio', (select jsonb_build_object('today_seconds', coalesce(sum(d.audio_seconds) filter (where d.day = v_today), 0), 'month_seconds', coalesce(sum(d.audio_seconds), 0),
                                        'today_usd', coalesce(sum(d.cost_usd) filter (where d.day = v_today), 0), 'month_usd', coalesce(sum(d.cost_usd), 0),
                                        'cap_minutes', internal.hub_setting_int('hub_voice_daily_minutes', 60))
                from public.hub_usage_daily d join public.hub_units u on u.id = d.unit_id
               where d.layer = 'transcribe' and d.day >= v_month and d.day <= v_today and internal.can_branch(u.branch_slug)),
    'by_layer', coalesce((select jsonb_agg(jsonb_build_object('layer', x.layer, 'source', x.source, 'calls', x.calls, 'today', x.today, 'month', x.month, 'seconds', x.seconds) order by x.layer, x.source)
                            from (select d.layer, d.source, sum(d.calls) as calls, sum(d.cost_usd) filter (where d.day = v_today) as today, sum(d.cost_usd) as month, sum(d.audio_seconds) as seconds`);
  out.push('-- public.hub_budget_overview (20261114200000, copied): the transcription has its own line (H7)', bo);

  return out.join('\n\n');
}

/** the H7 conversations of the conversation bank (tag media) — the lab items */
export function mediaBankItems() {
  return read('tests/hub-bank/conversations.jsonl').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((x) => !x._header && (x.tags ?? []).includes('h7'))
    .map((x) => ({ id: x.id, unit: x.unit, language: x.language, messages: x.messages, expect: x.expect, note: x.note ?? null, tags: x.tags }));
}
export function migration() {
  const src = read('scripts/hub-media-migration.src.sql');
  if (!src.includes('/*@REPLACED@*/') || !src.includes('/*@MEDIA_BANK@*/')) throw new Error('a marker moved');
  const bank = JSON.stringify(mediaBankItems());
  if (bank.includes('$media_bank$')) throw new Error('a dollar-quote tag inside the bank');
  // function replacers: a replacement string would read `$'` / `$$` as patterns
  return src.replace('/*@REPLACED@*/', () => replaced()).replace('/*@MEDIA_BANK@*/', () => bank);
}

if (process.argv[1]?.endsWith('hub-media-migration.mjs')) {
  if (existsSync(OUT) && !process.argv.includes('--force')) {
    if (read(OUT_PATH) === migration()) {
      console.log(`✓ ${OUT_PATH} is current`);
      process.exit(0);
    }
    console.error(`${OUT_PATH} exists and differs — an applied migration is never edited (pass --force only before it is applied)`);
    process.exit(1);
  }
  writeFileSync(OUT, migration(), 'utf8');
  console.log(`✓ wrote ${OUT_PATH}`);
}
