-- ───────────────────────────────────────────── 1. «التعلّم» switches (the system admin's) ─────────────────────────────────────────────
create table public.hub_learning_config (
  id boolean primary key default true check (id),
  -- «التعلّم من ردود الفريق»: a staff reply to a question in «لم أعرف الإجابة» → its general facts become active cards
  learn_replies boolean not null default true,
  -- «التعليم بـ تعلّم:»: Ahmed and the reception managers teach by WhatsApp
  learn_teach boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
comment on table public.hub_learning_config is 'Guest Hub H7b «التعلّم» (15 Nov 2026): the two learning switches of «الفريق والتقارير» — the system admin only (hub_learning_set).';
insert into public.hub_learning_config (id) values (true) on conflict do nothing;
alter table public.hub_learning_config enable row level security;
revoke all on table public.hub_learning_config from public, anon, authenticated;
grant all on table public.hub_learning_config to service_role;
create trigger hub_learning_config_audit after insert or update or delete on public.hub_learning_config
  for each row execute function internal.audit('learn_replies', 'learn_teach');

-- ───────────────────────────────────────────── 2. what a learned card carries ─────────────────────────────────────────────
alter table public.hub_knowledge_cards add column learn_kind text check (learn_kind is null or learn_kind in ('teach', 'staff_reply'));
-- the branch the fact holds for ('both' = every branch)
alter table public.hub_knowledge_cards add column learn_scope text check (learn_scope is null or learn_scope in ('airport-road', 'shafa-road', 'both'));
-- who taught it: slot:<id> (a «مدير الاستقبال»), recipient:<id> (Ahmed's report number), staff:<user id> (an inbox reply)
alter table public.hub_knowledge_cards add column learn_who text check (learn_who is null or learn_who ~ '^(slot|recipient|staff):[0-9a-f-]{36}$');
alter table public.hub_knowledge_cards add column learn_by_name text check (learn_by_name is null or char_length(learn_by_name) <= 80);
-- the short daily number of the report's «بطاقات معرفة جديدة» line («امسح N»): per Riyadh day, both branches together
alter table public.hub_knowledge_cards add column learn_day date;
alter table public.hub_knowledge_cards add column learn_no smallint check (learn_no is null or learn_no between 1 and 999);
alter table public.hub_knowledge_cards add column learn_short text check (learn_short is null or char_length(learn_short) <= 80);
alter table public.hub_knowledge_cards add column learned_at timestamptz;
alter table public.hub_knowledge_cards add column replaces_keys text[] not null default '{}';
create unique index hub_cards_learn_no on public.hub_knowledge_cards (learn_day, learn_no) where learn_no is not null;
create index hub_cards_learn_who on public.hub_knowledge_cards (learn_who, learned_at desc) where learn_who is not null;
comment on column public.hub_knowledge_cards.learn_kind is 'Guest Hub H7b: learned by WhatsApp («تعلّم:») or from a staff reply — active at once (no «نشر»), removable by «امسح» / «امسح N» or «إيقاف» in «قاعدة المعرفة».';

-- the audit carries who taught it
drop trigger hub_knowledge_cards_audit on public.hub_knowledge_cards;
create trigger hub_knowledge_cards_audit after insert or update or delete on public.hub_knowledge_cards
  for each row execute function internal.audit('key', 'unit_keys', 'topic_keys', 'title_ar', 'title_en', 'text_ar', 'text_en', 'source', 'source_date',
                                               'expires_on', 'status', 'published_at', 'archived_at', 'faq_item_id', 'sort', 'learn_kind', 'learn_scope',
                                               'learn_by_name', 'learn_no', 'replaces_keys');

-- the library view again, so it carries the learn columns (a view keeps the columns it was created with)
drop view public.hub_cards_library;
create view public.hub_cards_library with (security_invoker = true) as
  select c.*, internal.hub_card_pending(c) as pending, internal.hub_card_check(c) as "check",
         case when c.status = 'archived' then 'archived'
              when c.live is null then 'draft'
              when (c.live ->> 'expires_on') is not null and (c.live ->> 'expires_on')::date < internal.riyadh_today() then 'expired'
              else 'published' end as state,
         (select s.full_name from public.staff s where s.user_id = c.verified_by) as verified_by_name
    from public.hub_knowledge_cards c;
comment on view public.hub_cards_library is 'hub_knowledge_cards + pending + check + state (draft | published | expired | archived) + the verifier''s name. RLS of the cards applies (security invoker). H6: + price_note, draft_origin. H7b: + the learn columns.';
revoke all on public.hub_cards_library from public, anon, authenticated;
grant select on public.hub_cards_library to authenticated, service_role;

-- ───────────────────────────────────────────── 3. a staff reply: learned or «يحتاج قرارك» ─────────────────────────────────────────────
alter table public.hub_card_jobs drop constraint hub_card_jobs_status_check;
alter table public.hub_card_jobs add constraint hub_card_jobs_status_check
  check (status in ('pending', 'running', 'done', 'empty', 'rejected', 'failed', 'skipped', 'learned', 'decision'));
-- «يحتاج قرارك»: {kind: price | contradiction, conflicts: [card keys]} — the staff wording stays in hub_messages (its retention)
alter table public.hub_card_jobs add column decision jsonb check (decision is null or jsonb_typeof(decision) = 'object');
alter table public.hub_card_jobs add column learned_ids uuid[] not null default '{}';
comment on table public.hub_card_jobs is 'Guest Hub H6 → H7b (15 Nov 2026): a staff reply to a question in «لم أعرف الإجابة» → its general facts learned as ACTIVE cards for that branch (prompts.md §7); a price or a contradiction → «يحتاج قرارك» (decision).';

-- ───────────────────────────────────────────── 4. «تعلّم:» jobs and the «أستبدل القديمة؟» question ─────────────────────────────────────────────
create table public.hub_teach_jobs (
  id uuid primary key default gen_random_uuid(),
  staff_message_id uuid not null unique references public.hub_staff_messages (id) on delete cascade,
  channel_id uuid references public.hub_channels (id) on delete set null,
  unit_id uuid references public.hub_units (id) on delete set null,
  who text not null check (who ~ '^(slot|recipient):[0-9a-f-]{36}$'),
  scope text not null check (scope in ('airport-road', 'shafa-road', 'both')),
  status text not null default 'pending' check (status in ('pending', 'running', 'learned', 'asked', 'refused', 'failed')),
  reason text check (reason is null or reason ~ '^[a-z_]{2,40}$'),
  card_id uuid references public.hub_knowledge_cards (id) on delete set null,
  attempts integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  claimed_at timestamptz,
  finished_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_teach_jobs is 'Guest Hub H7b: one «تعلّم: …» from Ahmed or a reception manager — the model writes the card (prompts.md §7, hub-agent), the reply quotes the guest wording. The text stays in hub_staff_messages (30 days).';
create trigger hub_teach_jobs_touch before update on public.hub_teach_jobs for each row execute function internal.stamp();
create index hub_teach_jobs_pending on public.hub_teach_jobs (created_at) where status in ('pending', 'running');
alter table public.hub_teach_jobs enable row level security;
revoke all on table public.hub_teach_jobs from public, anon, authenticated;
grant all on table public.hub_teach_jobs to service_role;

create table public.hub_teach_pending (
  who text primary key check (who ~ '^(slot|recipient):[0-9a-f-]{36}$'),
  job_id uuid references public.hub_teach_jobs (id) on delete cascade,
  channel_id uuid references public.hub_channels (id) on delete set null,
  scope text not null check (scope in ('airport-road', 'shafa-road', 'both')),
  candidate jsonb not null check (jsonb_typeof(candidate) = 'object'),
  conflicts text[] not null,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.hub_teach_pending is 'Guest Hub H7b: «أستبدل القديمة؟» waiting for «نعم» / «لا» (24 hours) — nothing changes until the answer.';
alter table public.hub_teach_pending enable row level security;
revoke all on table public.hub_teach_pending from public, anon, authenticated;
grant all on table public.hub_teach_pending to service_role;

-- ───────────────────────────────────────────── 5. helpers ─────────────────────────────────────────────
create function internal.hub_learn_on(p_what text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case p_what when 'teach' then c.learn_teach when 'replies' then c.learn_replies end from public.hub_learning_config c where c.id), true)
$$;

-- «15 نوفمبر 2026»
create function internal.hub_date_ar(d date) returns text
language sql immutable set search_path = '' as $$
  select extract(day from d)::int || ' ' || (array['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'])[extract(month from d)::int]
         || ' ' || extract(year from d)::int
$$;

-- who may teach from this number (Ahmed, 15 Nov 2026): owner = a report recipient linked to the system admin's dashboard
-- account (staff.role admin, active) — any branch, both branches, a service price; manager_branches = the branches of
-- the number's active «مدير الاستقبال» slots. who = the identity the teaching is recorded under.
create function internal.hub_teacher(p_phone text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with o as (select r.id, r.name, r.staff_user_id from public.hub_report_recipients r join public.staff s on s.user_id = r.staff_user_id
              where r.phone = p_phone and r.active and s.active and s.role = 'admin' order by r.position limit 1),
       m as (select s.id, s.name, s.branch_slug from public.hub_staff_slots s where s.phone = p_phone and s.active and s.role = 'manager' order by s.branch_slug, s.position)
  select jsonb_build_object(
    'owner', exists (select 1 from o),
    'owner_user', (select o.staff_user_id from o),
    'manager_branches', coalesce((select jsonb_agg(distinct m.branch_slug) from m), '[]'::jsonb),
    'who', coalesce((select 'recipient:' || o.id from o), (select 'slot:' || m.id from m limit 1)),
    'name', coalesce((select o.name from o), (select m.name from m limit 1)))
   where p_phone is not null
$$;

-- a scope this teacher may teach or remove: 'ok' | 'not_allowed' | 'other_branch' (the twin of learn.ts → scopeVerdict)
create function internal.hub_teach_verdict(t jsonb, p_scope text) returns text
language sql immutable set search_path = '' as $$
  select case when t is null or (not coalesce((t ->> 'owner')::boolean, false) and jsonb_array_length(coalesce(t -> 'manager_branches', '[]'::jsonb)) = 0) then 'not_allowed'
              when coalesce((t ->> 'owner')::boolean, false) then 'ok'
              when p_scope = 'both' then case when (t -> 'manager_branches') @> '["airport-road", "shafa-road"]'::jsonb then 'ok' else 'other_branch' end
              when (t -> 'manager_branches') @> to_jsonb(p_scope) then 'ok'
              else 'other_branch' end
$$;

-- a learned card's scope from its units ('both' when it names no single branch unit)
create function internal.hub_card_scope(c public.hub_knowledge_cards) returns text
language sql stable set search_path = '' as $$
  select coalesce(c.learn_scope, case when cardinality(c.unit_keys) = 1 then (select u.branch_slug from public.hub_units u where u.key = c.unit_keys[1]) end, 'both')
$$;

-- act as the teacher for the audit: their dashboard user when there is one (Ahmed), else the label «تعليم واتساب — {name}»
create function internal.hub_learn_actor(p_user uuid, p_label text) returns text
language plpgsql set search_path = '' as $$
declare v_old text := current_setting('request.jwt.claims', true);
begin
  if p_user is not null then perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'service_role')::text, true); end if;
  perform set_config('app.actor', left(coalesce(p_label, 'تعليم واتساب'), 80), true);
  perform internal.begin_batch();
  return v_old;
end;
$$;
create function internal.hub_learn_actor_end(p_old text) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', coalesce(p_old, ''), true);
  perform set_config('app.actor', '', true);
end;
$$;

-- the published cards the model compares a new fact with (prompts.md §7 EXISTING_CARDS): Arabic, at most 150
create function internal.hub_learn_cards() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'branch', internal.hub_card_scope(c), 'title', c.live ->> 'title_ar', 'text', c.live ->> 'text_ar') order by c.sort), '[]'::jsonb)
    from (select * from public.hub_knowledge_cards k
           where k.status = 'published' and k.live is not null and not k.is_test
             and ((k.live ->> 'expires_on') is null or (k.live ->> 'expires_on')::date >= internal.riyadh_today())
             and not exists (select 1 from public.hub_units u where u.key = any (k.unit_keys) and u.knowledge_hidden)
           order by k.sort limit 150) c
$$;

-- the topics a learned card may carry (never one always handed to the team)
create function internal.hub_learn_topics() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'label_en', t.label_en, 'label_ar', t.label_ar) order by t.sort, t.key), '[]')
    from public.hub_topics t where t.status = 'active' and not t.always_handoff and not t.is_test
$$;

-- a learned fact becomes an ACTIVE card at once (no «نشر»): its source «تعليم واتساب — {name} — {date}» or «رد الفريق —
-- {name} — {date}», the day's number, the card's own check (a problem → nothing stored). p = {title_ar, title_en, text_ar,
-- text_en, short_ar, topic_keys}. p_replaces: the cards it replaces (archived in the same batch).
create function internal.hub_learn_insert(p_kind text, p_scope text, p_who text, p_name text, p_user uuid, p jsonb, p_replaces text[], p_test boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.hub_knowledge_cards;
  v_check jsonb;
  v_today date := internal.riyadh_today();
  v_no smallint;
  v_old text;
  v_topics text[];
begin
  v_topics := array(select distinct x from jsonb_array_elements_text(coalesce(p -> 'topic_keys', '[]'::jsonb)) x
                     where exists (select 1 from public.hub_topics t where t.key = x and t.status = 'active' and not t.always_handoff));
  v.key := 'k-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v.unit_keys := case when p_scope = 'both' then '{}'::text[]
                      else array(select u.key from public.hub_units u where u.kind = 'branch' and u.branch_slug = p_scope and not u.is_test) end;
  v.topic_keys := v_topics;
  v.title_ar := left(btrim(coalesce(p ->> 'title_ar', '')), 120);
  v.title_en := left(btrim(coalesce(p ->> 'title_en', '')), 120);
  v.text_ar := left(btrim(coalesce(p ->> 'text_ar', '')), 1200);
  v.text_en := left(btrim(coalesce(p ->> 'text_en', '')), 1200);
  v.source := left((case p_kind when 'teach' then 'تعليم واتساب — ' else 'رد الفريق — ' end) || coalesce(nullif(btrim(p_name), ''), 'الفريق') || ' — ' || internal.hub_date_ar(v_today), 300);
  v.source_date := v_today;
  v.status := 'draft';
  v_check := internal.hub_card_check(v);
  if jsonb_array_length(v_check -> 'missing') > 0 then return jsonb_build_object('ok', false, 'reason', 'check', 'check', v_check); end if;
  v_old := internal.hub_learn_actor(p_user, case p_kind when 'teach' then 'تعليم واتساب — ' else 'رد الفريق — ' end || coalesce(nullif(btrim(p_name), ''), 'الفريق'));
  perform pg_advisory_xact_lock(hashtext('hub_learn_no'));
  v_no := coalesce((select max(k.learn_no) from public.hub_knowledge_cards k where k.learn_day = v_today), 0) + 1;
  insert into public.hub_knowledge_cards (key, unit_keys, topic_keys, title_ar, title_en, text_ar, text_en, source, source_date, verified_by, verified_at, status, sort,
                                          is_test, learn_kind, learn_scope, learn_who, learn_by_name, learn_day, learn_no, learn_short, learned_at, replaces_keys,
                                          published_at, published_by, first_published_at, created_by, updated_by)
  values (v.key, v.unit_keys, v.topic_keys, v.title_ar, v.title_en, v.text_ar, v.text_en, v.source, v.source_date, p_user, now(), 'draft',
          coalesce((select max(x.sort) + 1 from public.hub_knowledge_cards x), 0), coalesce(p_test, false), p_kind, p_scope, p_who, left(btrim(coalesce(p_name, '')), 80),
          v_today, v_no, nullif(left(btrim(coalesce(p ->> 'short_ar', '')), 80), ''), now(), coalesce(p_replaces, '{}'), now(), p_user, now(), p_user, p_user)
  returning * into v;
  update public.hub_knowledge_cards c set live = internal.hub_card_snapshot(c), status = 'published' where c.id = v.id returning * into v;
  if cardinality(coalesce(p_replaces, '{}')) > 0 then
    update public.hub_knowledge_cards c set status = 'archived', archived_at = now(), archived_by = p_user, updated_by = p_user
     where c.key = any (p_replaces) and c.status <> 'archived';
  end if;
  perform internal.hub_learn_actor_end(v_old);
  return jsonb_build_object('ok', true, 'id', v.id, 'key', v.key, 'n', v_no, 'day', v_today, 'wording', v.text_ar);
end;
$$;

-- a learned card taken out of every reply at once (audited as the remover; «استرجاع» in «قاعدة المعرفة» brings it back)
create function internal.hub_learn_archive(p_card uuid, p_user uuid, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text := internal.hub_learn_actor(p_user, p_label);
begin
  update public.hub_knowledge_cards set status = 'archived', archived_at = now(), archived_by = p_user, updated_by = p_user where id = p_card and status <> 'archived';
  perform internal.hub_learn_actor_end(v_old);
end;
$$;

-- ───────────────────────────────────────────── 6. a learning command (service role — wa-automation's staff path) ─────────────────────────────────────────────
-- every command of copy.md §9.1 that needs no model: «تعلّم:» (checked and queued for hub-agent), «امسح», «امسح N»,
-- «عرض:», and «نعم» / «لا» while «أستبدل القديمة؟» waits. p = {phone, channel, message_id, command: teach | remove_last |
-- remove_n | offer | yes | no, n, scope, body, is_test}. Returns {handled, line, vars} (the reply is a fixed line, filled by
-- code) or {handled: true, queued: true} (hub-agent replies) or {handled: false} (the colleague chat answers).
create function public.hub_learn_command(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t jsonb := internal.hub_teacher(p ->> 'phone');
  v_cmd text := p ->> 'command';
  v_scope text := case when p ->> 'scope' in ('airport-road', 'shafa-road', 'both') then p ->> 'scope' end;
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  v_who text := t ->> 'who';
  v_user uuid := nullif(t ->> 'owner_user', '')::uuid;
  v_label text := 'تعليم واتساب — ' || coalesce(t ->> 'name', '');
  v_verdict text;
  ch public.hub_channels;
  c public.hub_knowledge_cards;
  pd public.hub_teach_pending;
  v_job uuid;
  v_n integer;
  v_r jsonb;
  v_day date;
begin
  select * into ch from public.hub_channels where address = p ->> 'channel' order by created_at limit 1;
  if v_cmd in ('yes', 'no') then
    -- only while «أستبدل القديمة؟» waits for this teacher (24 hours); otherwise the colleague chat answers
    select * into pd from public.hub_teach_pending where who = v_who and created_at > now() - interval '24 hours' for update;
    if pd.who is null then return jsonb_build_object('handled', false); end if;
    delete from public.hub_teach_pending where who = pd.who;
    if v_cmd = 'no' then return jsonb_build_object('handled', true, 'line', 'kept'); end if;
    if internal.hub_teach_verdict(t, pd.scope) <> 'ok' then return jsonb_build_object('handled', true, 'line', 'not_allowed'); end if;
    v_r := internal.hub_learn_insert('teach', pd.scope, v_who, t ->> 'name', v_user, pd.candidate, pd.conflicts, pd.is_test or v_test);
    if not coalesce((v_r ->> 'ok')::boolean, false) then return jsonb_build_object('handled', true, 'line', 'failed', 'reason', v_r ->> 'reason'); end if;
    update public.hub_teach_jobs set status = 'learned', card_id = (v_r ->> 'id')::uuid where id = pd.job_id;
    return jsonb_build_object('handled', true, 'line', 'replaced', 'vars', jsonb_build_object('wording', v_r ->> 'wording', 'n', v_r ->> 'n'), 'card_id', v_r ->> 'id');
  end if;
  if v_cmd = 'offer' then
    -- «عرض:» from Ahmed: offers are added from «العروض» (the same offer feeds the site and the booking price)
    if not coalesce((t ->> 'owner')::boolean, false) then return jsonb_build_object('handled', false); end if;
    return jsonb_build_object('handled', true, 'line', 'offer');
  end if;
  if v_cmd not in ('teach', 'remove_last', 'remove_n') then return jsonb_build_object('handled', false); end if;
  if internal.hub_teach_verdict(t, 'airport-road') = 'not_allowed' then return jsonb_build_object('handled', true, 'line', 'not_allowed'); end if;
  if v_cmd = 'teach' then
    if not internal.hub_learn_on('teach') then return jsonb_build_object('handled', true, 'line', 'teach_off'); end if;
    if v_scope is null then raise exception 'hub_learn_scope' using errcode = '22023'; end if;
    v_verdict := internal.hub_teach_verdict(t, v_scope);
    if v_verdict <> 'ok' then
      return jsonb_build_object('handled', true, 'line', v_verdict,
        'vars', jsonb_build_object('branch', case when v_scope = 'both' then (select b from unnest(array['airport-road', 'shafa-road']) b
                                                   where not coalesce(t -> 'manager_branches', '[]'::jsonb) @> to_jsonb(b) limit 1) else v_scope end));
    end if;
    if char_length(btrim(coalesce(p ->> 'body', ''))) < 3 then return jsonb_build_object('handled', true, 'line', 'empty'); end if;
    if ch.id is null then return jsonb_build_object('handled', true, 'line', 'failed', 'reason', 'no_channel'); end if;
    insert into public.hub_teach_jobs (staff_message_id, channel_id, unit_id, who, scope, is_test)
    values ((p ->> 'message_id')::uuid, ch.id, ch.unit_id, v_who, v_scope, v_test)
    on conflict (staff_message_id) do nothing
    returning id into v_job;
    if v_job is null then return jsonb_build_object('handled', true, 'queued', false, 'reason', 'duplicate'); end if;
    if not v_test then perform internal.hub_agent_post('sweep'); end if;
    return jsonb_build_object('handled', true, 'queued', true, 'job_id', v_job);
  end if;
  if v_cmd = 'remove_last' then
    -- the teacher's latest teaching (24 hours), as long as nothing newer was taught by them
    select * into c from public.hub_knowledge_cards k where k.learn_who = v_who and k.learn_kind = 'teach' and k.learned_at > now() - interval '24 hours'
     order by k.learned_at desc limit 1;
    if c.id is null or c.status = 'archived' then return jsonb_build_object('handled', true, 'line', 'remove_none'); end if;
    perform internal.hub_learn_archive(c.id, v_user, v_label);
    return jsonb_build_object('handled', true, 'line', 'removed', 'vars', jsonb_build_object('wording', c.text_ar), 'card_id', c.id);
  end if;
  -- «امسح N»: the number of the latest daily report's line (the day it covers), else today's, else yesterday's
  v_n := nullif(p ->> 'n', '')::integer;
  if v_n is null or v_n < 1 then return jsonb_build_object('handled', true, 'line', 'remove_n_none', 'vars', jsonb_build_object('n', coalesce(v_n, 0))); end if;
  for v_day in select d from (select (select max(r.day) from public.hub_daily_reports r) as d, 1 as o union all select internal.riyadh_today(), 2
                               union all select internal.riyadh_today() - 1, 3) x where d is not null order by o loop
    select * into c from public.hub_knowledge_cards k where k.learn_day = v_day and k.learn_no = v_n and k.is_test = v_test limit 1;
    exit when c.id is not null;
  end loop;
  if c.id is null then return jsonb_build_object('handled', true, 'line', 'remove_n_none', 'vars', jsonb_build_object('n', v_n)); end if;
  if internal.hub_teach_verdict(t, internal.hub_card_scope(c)) <> 'ok' then return jsonb_build_object('handled', true, 'line', 'remove_n_other', 'vars', jsonb_build_object('n', v_n)); end if;
  perform internal.hub_learn_archive(c.id, v_user, v_label);
  return jsonb_build_object('handled', true, 'line', 'removed_n', 'vars', jsonb_build_object('n', v_n, 'wording', c.text_ar), 'card_id', c.id);
end;
$$;

-- the next «تعلّم:» jobs (service role, hub-agent): the text (the colleague's message), who and the scope, the number to
-- reply from and to, the topics and the published cards. Not at the budget cap.
create function public.hub_teach_claim(p_limit integer default 3) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := internal.hub_budget_state();
  v_ids uuid[];
  v_out jsonb;
begin
  if coalesce((b ->> 'capped')::boolean, false) or coalesce((b ->> 'unset')::boolean, false) then return jsonb_build_object('jobs', '[]'::jsonb, 'reason', 'budget_cap'); end if;
  update public.hub_teach_jobs set status = case when attempts >= 2 then 'failed' else 'pending' end, reason = case when attempts >= 2 then 'stuck' end
   where status = 'running' and claimed_at < now() - interval '4 minutes';
  with picked as (select j.id from public.hub_teach_jobs j where j.status = 'pending' order by j.created_at limit least(greatest(coalesce(p_limit, 3), 1), 10) for update skip locked),
  upd as (update public.hub_teach_jobs j set status = 'running', claimed_at = now(), attempts = attempts + 1 from picked where j.id = picked.id returning j.id)
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', j.id, 'scope', j.scope, 'who', j.who, 'is_test', j.is_test, 'message_id', m.id, 'text', m.body, 'sent_at', m.created_at,
           'from', ch.address,
           'to', coalesce((select r.phone from public.hub_report_recipients r where 'recipient:' || r.id = j.who), (select s.phone from public.hub_staff_slots s where 'slot:' || s.id = j.who)),
           'teacher', internal.hub_teacher(coalesce((select r.phone from public.hub_report_recipients r where 'recipient:' || r.id = j.who),
                                                    (select s.phone from public.hub_staff_slots s where 'slot:' || s.id = j.who))))
           order by j.created_at), '[]'::jsonb)
    into v_out
    from public.hub_teach_jobs j join public.hub_staff_messages m on m.id = j.staff_message_id left join public.hub_channels ch on ch.id = j.channel_id
   where j.id = any (v_ids);
  return jsonb_build_object('jobs', v_out, 'topics', internal.hub_learn_topics(), 'cards', internal.hub_learn_cards(), 'today', internal.riyadh_today(),
    'forbidden', to_jsonb(internal.hub_forbidden_terms()), 'known_phones', to_jsonb(internal.hub_known_phones()),
    'models', (select s.value from public.settings s where s.key = 'hub_models'));
end;
$$;

-- a «تعلّم:» job's outcome (service role): the model call into the budget (layer draft_card, source staff); learned → the
-- card is ACTIVE at once; ask → «أستبدل القديمة؟» waits (nothing changes); refused / failed → nothing stored. p = {status:
-- learned | ask | refused | failed, reason, card {title_ar, title_en, text_ar, text_en, short_ar, topic_keys}, conflicts,
-- models}. Returns what the reply quotes: {line, vars}.
create function public.hub_teach_finish(p_job uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.hub_teach_jobs;
  m jsonb;
  t jsonb;
  v_cost numeric := 0;
  v_status text := case when p ->> 'status' in ('learned', 'ask', 'refused', 'failed') then p ->> 'status' else 'failed' end;
  v_conflicts text[];
  v_r jsonb;
  v_old text;
  v_phone text;
begin
  select * into j from public.hub_teach_jobs where id = p_job for update;
  if j.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if j.status <> 'running' then return jsonb_build_object('ok', false, 'reason', 'not_running'); end if;
  for m in select * from jsonb_array_elements(coalesce(p -> 'models', '[]'::jsonb)) loop
    if j.unit_id is not null and coalesce((m ->> 'input_tokens')::bigint, 0) + coalesce((m ->> 'output_tokens')::bigint, 0) > 0 then
      v_cost := v_cost + internal.hub_usage_add(j.unit_id, 'draft_card', 'staff', m ->> 'model', (m ->> 'input_tokens')::bigint, (m ->> 'output_tokens')::bigint, j.is_test);
    end if;
  end loop;
  v_phone := coalesce((select r.phone from public.hub_report_recipients r where 'recipient:' || r.id = j.who), (select s.phone from public.hub_staff_slots s where 'slot:' || s.id = j.who));
  t := internal.hub_teacher(v_phone);
  -- the teacher may still teach this scope (a slot changed since): checked again
  if v_status in ('learned', 'ask') and internal.hub_teach_verdict(t, j.scope) <> 'ok' then
    update public.hub_teach_jobs set status = 'refused', reason = 'not_allowed', cost_usd = cost_usd + v_cost, finished_at = now() where id = j.id;
    return jsonb_build_object('ok', true, 'line', 'not_allowed');
  end if;
  if v_status = 'ask' then
    v_conflicts := array(select distinct x from jsonb_array_elements_text(coalesce(p -> 'conflicts', '[]'::jsonb)) x
                          where exists (select 1 from public.hub_knowledge_cards k where k.key = x and k.status = 'published'));
    if cardinality(v_conflicts) = 0 then v_status := 'learned'; end if;
  end if;
  if v_status = 'ask' then
    -- a reception manager never replaces a card of both branches or of the other branch (Ahmed's)
    if not coalesce((t ->> 'owner')::boolean, false)
       and exists (select 1 from public.hub_knowledge_cards k where k.key = any (v_conflicts) and internal.hub_teach_verdict(t, internal.hub_card_scope(k)) <> 'ok') then
      update public.hub_teach_jobs set status = 'refused', reason = 'conflict_shared', cost_usd = cost_usd + v_cost, finished_at = now() where id = j.id;
      return jsonb_build_object('ok', true, 'line', 'conflict_shared',
        'vars', jsonb_build_object('old', (select k.text_ar from public.hub_knowledge_cards k where k.key = any (v_conflicts) order by k.sort limit 1)));
    end if;
    insert into public.hub_teach_pending (who, job_id, channel_id, scope, candidate, conflicts, is_test)
    values (j.who, j.id, j.channel_id, j.scope, coalesce(p -> 'card', '{}'::jsonb), v_conflicts, j.is_test)
    on conflict (who) do update set job_id = excluded.job_id, channel_id = excluded.channel_id, scope = excluded.scope, candidate = excluded.candidate,
                                    conflicts = excluded.conflicts, is_test = excluded.is_test, created_at = now();
    update public.hub_teach_jobs set status = 'asked', cost_usd = cost_usd + v_cost, finished_at = now() where id = j.id;
    return jsonb_build_object('ok', true, 'line', 'ask_replace',
      'vars', jsonb_build_object('wording', p #>> '{card,text_ar}', 'old', (select k.text_ar from public.hub_knowledge_cards k where k.key = any (v_conflicts) order by k.sort limit 1)));
  end if;
  if v_status = 'learned' then
    v_r := internal.hub_learn_insert('teach', j.scope, j.who, t ->> 'name', nullif(t ->> 'owner_user', '')::uuid, coalesce(p -> 'card', '{}'::jsonb), '{}', j.is_test);
    if not coalesce((v_r ->> 'ok')::boolean, false) then
      update public.hub_teach_jobs set status = 'failed', reason = 'check', cost_usd = cost_usd + v_cost, finished_at = now() where id = j.id;
      return jsonb_build_object('ok', true, 'line', 'failed', 'check', v_r -> 'check');
    end if;
    update public.hub_teach_jobs set status = 'learned', card_id = (v_r ->> 'id')::uuid, cost_usd = cost_usd + v_cost, finished_at = now() where id = j.id;
    return jsonb_build_object('ok', true, 'line', case when j.scope = 'both' then 'saved_both' else 'saved' end,
      'vars', jsonb_build_object('wording', v_r ->> 'wording', 'n', v_r ->> 'n'), 'card_id', v_r ->> 'id');
  end if;
  update public.hub_teach_jobs set status = v_status, reason = case when p ->> 'reason' ~ '^[a-z_]{2,40}$' then p ->> 'reason' end, cost_usd = cost_usd + v_cost, finished_at = now()
   where id = j.id;
  return jsonb_build_object('ok', true, 'line', null);
end;
$$;

-- ───────────────────────────────────────────── 7. learning from a staff reply (replaces the draft card of 14 Nov 2026) ─────────────────────────────────────────────
-- a job for an open entry of this conversation once a staff member answered after the guest's question — only while
-- «التعلّم من ردود الفريق» is on; at most three tries per cluster; none once a fact of the cluster was learned
create or replace function internal.hub_card_job_add(p_entry public.hub_unanswered, p_reply public.hub_messages) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_entry.id is null or p_reply.id is null or p_entry.status <> 'open' or p_entry.draft_card_id is not null then return null; end if;
  if not internal.hub_learn_on('replies') then return null; end if;
  if exists (select 1 from public.hub_card_jobs j where j.cluster_id = coalesce(p_entry.cluster_id, p_entry.id) and j.status in ('done', 'learned')) then return null; end if;
  if (select count(*) from public.hub_card_jobs j where j.cluster_id = coalesce(p_entry.cluster_id, p_entry.id)) >= 3 then return null; end if;
  insert into public.hub_card_jobs (unanswered_id, cluster_id, conversation_id, unit_id, staff_message_id, is_test)
  values (p_entry.id, coalesce(p_entry.cluster_id, p_entry.id), p_entry.conversation_id, p_entry.unit_id, p_reply.id, p_entry.is_test)
  on conflict (staff_message_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- the next jobs (service role, hub-agent): the guest's question (the queue's excerpt), the staff reply, who answered, the
-- branch, the topics and the published cards (prompts.md §7 EXISTING_CARDS). Not at the budget cap; nothing while
-- «التعلّم من ردود الفريق» is off (the waiting jobs are skipped).
create or replace function public.hub_card_job_claim(p_limit integer default 3) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := internal.hub_budget_state();
  v_out jsonb;
  v_ids uuid[];
begin
  if not internal.hub_learn_on('replies') then
    update public.hub_card_jobs set status = 'skipped', reason = 'learning_off', finished_at = now() where status = 'pending';
    return jsonb_build_object('jobs', '[]'::jsonb, 'reason', 'learning_off');
  end if;
  if coalesce((b ->> 'capped')::boolean, false) or coalesce((b ->> 'unset')::boolean, false) then return jsonb_build_object('jobs', '[]'::jsonb, 'reason', 'budget_cap'); end if;
  update public.hub_card_jobs set status = case when attempts >= 2 then 'failed' else 'pending' end, reason = case when attempts >= 2 then 'stuck' end
   where status = 'running' and claimed_at < now() - interval '4 minutes';
  with picked as (select j.id from public.hub_card_jobs j where j.status = 'pending' order by j.created_at limit least(greatest(coalesce(p_limit, 3), 1), 10) for update skip locked),
  upd as (update public.hub_card_jobs j set status = 'running', claimed_at = now(), attempts = attempts + 1 from picked where j.id = picked.id returning j.id)
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', j.id, 'unit_key', u.key, 'branch', u.branch_slug, 'language', coalesce(c.language, 'ar'),
           'question', q.question_excerpt, 'reply', m.body, 'topic_key', q.topic_key,
           'staff_first_name', case when m.author = 'phone' then null else nullif(split_part(btrim(coalesce(s.full_name, '')), ' ', 1), '') end,
           'date', to_char(coalesce(m.sent_at, m.created_at) at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), 'is_test', j.is_test) order by j.created_at), '[]'::jsonb)
    into v_out
    from public.hub_card_jobs j join public.hub_unanswered q on q.id = j.unanswered_id join public.hub_messages m on m.id = j.staff_message_id
    join public.hub_units u on u.id = j.unit_id join public.hub_conversations c on c.id = j.conversation_id
    left join public.staff s on s.user_id = m.staff_id
   where j.id = any (v_ids);
  return jsonb_build_object('jobs', v_out, 'topics', internal.hub_learn_topics(), 'cards', internal.hub_learn_cards(), 'today', internal.riyadh_today(),
    'forbidden', to_jsonb(internal.hub_forbidden_terms()), 'known_phones', to_jsonb(internal.hub_known_phones()),
    'models', (select s.value from public.settings s where s.key = 'hub_models'));
end;
$$;

-- the job's outcome (service role): the model call into the budget (layer draft_card, source staff). learned → each general
-- fact an ACTIVE card for that branch only (source «رد الفريق — {name} — {date}», the day's number) and the question
-- answered in «لم أعرف الإجابة»; decision → nothing learned, «يحتاج قرارك» (a price or a contradiction): the question
-- stays open with the staff wording; empty / rejected / failed → nothing. p = {status, reason, facts: [{title_ar, title_en,
-- text_ar, text_en, short_ar, topic_keys}], decision: {kind, conflicts}, models}.
create or replace function public.hub_card_job_finish(p_job uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.hub_card_jobs;
  m jsonb;
  f jsonb;
  v_cost numeric := 0;
  v_status text := case when p ->> 'status' in ('learned', 'decision', 'empty', 'rejected', 'failed') then p ->> 'status' else 'failed' end;
  v_msg public.hub_messages;
  v_name text;
  v_branch text;
  v_r jsonb;
  v_ids uuid[] := '{}';
  v_decision jsonb := case when jsonb_typeof(p -> 'decision') = 'object' and p #>> '{decision,kind}' in ('price', 'contradiction')
                           then jsonb_build_object('kind', p #>> '{decision,kind}', 'conflicts', coalesce(p #> '{decision,conflicts}', '[]'::jsonb)) end;
begin
  select * into j from public.hub_card_jobs where id = p_job for update;
  if j.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if j.status <> 'running' then return jsonb_build_object('ok', false, 'reason', 'not_running'); end if;
  for m in select * from jsonb_array_elements(coalesce(p -> 'models', '[]'::jsonb)) loop
    if coalesce((m ->> 'input_tokens')::bigint, 0) + coalesce((m ->> 'output_tokens')::bigint, 0) > 0 then
      v_cost := v_cost + internal.hub_usage_add(j.unit_id, 'draft_card', 'staff', m ->> 'model', (m ->> 'input_tokens')::bigint, (m ->> 'output_tokens')::bigint, j.is_test);
    end if;
  end loop;
  -- one learning per question: a later reply of the same cluster learns nothing more
  if v_status = 'learned' and exists (select 1 from public.hub_card_jobs x where x.cluster_id = j.cluster_id and x.status in ('done', 'learned') and x.id <> j.id) then
    v_status := 'skipped';
  end if;
  if v_status = 'learned' then
    select * into v_msg from public.hub_messages where id = j.staff_message_id;
    select u.branch_slug into v_branch from public.hub_units u where u.id = j.unit_id;
    v_name := coalesce(nullif(btrim(coalesce(p ->> 'staff_name', '')), ''),
                       (select nullif(split_part(btrim(s.full_name), ' ', 1), '') from public.staff s where s.user_id = v_msg.staff_id), 'الفريق');
    for f in select * from jsonb_array_elements(coalesce(p -> 'facts', '[]'::jsonb)) limit 2 loop
      v_r := internal.hub_learn_insert('staff_reply', v_branch, case when v_msg.staff_id is not null then 'staff:' || v_msg.staff_id end, v_name, v_msg.staff_id, f, '{}', j.is_test);
      if coalesce((v_r ->> 'ok')::boolean, false) then v_ids := v_ids || (v_r ->> 'id')::uuid; end if;
    end loop;
    if cardinality(v_ids) = 0 then v_status := case when v_decision is not null then 'decision' else 'rejected' end;
    else
      update public.hub_unanswered set status = 'answered', resolved_card_id = v_ids[1], resolved_by = v_msg.staff_id, resolved_at = now()
       where cluster_id = j.cluster_id and status = 'open';
    end if;
  end if;
  update public.hub_card_jobs set status = v_status, reason = case when v_status = 'skipped' then 'has_learned' when p ->> 'reason' ~ '^[a-z_]{2,40}$' then p ->> 'reason' end,
         decision = case when v_status in ('learned', 'decision') then v_decision end, learned_ids = v_ids, card_id = v_ids[1],
         cost_usd = cost_usd + v_cost, finished_at = now()
   where id = j.id;
  return jsonb_build_object('ok', true, 'status', v_status, 'cards', to_jsonb(v_ids), 'cost_usd', v_cost);
end;
$$;

-- ───────────────────────────────────────────── 7. the dashboard ─────────────────────────────────────────────
-- «الفريق والتقارير» → «التعلّم» (hub_team view reads; the system admin switches) and the learned cards of the day
create function public.hub_learning_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (internal.can('hub_team', 'view') or internal.can('knowledge', 'view')) then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select jsonb_build_object('learn_replies', c.learn_replies, 'learn_teach', c.learn_teach, 'updated_at', c.updated_at,
                                    'updated_by', internal.staff_name(c.updated_by), 'can_edit', internal.is_system_admin())
            from public.hub_learning_config c where c.id);
end;
$$;

-- the two switches (the system admin only); returns the previous values («تراجع» saves them back)
create function public.hub_learning_set(p_replies boolean, p_teach boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.hub_learning_config;
  v_batch uuid;
begin
  if not internal.is_system_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_replies is null or p_teach is null then raise exception 'hub_learning_fields' using errcode = '22023'; end if;
  select * into o from public.hub_learning_config where id for update;
  v_batch := internal.begin_batch();
  update public.hub_learning_config set learn_replies = p_replies, learn_teach = p_teach, updated_at = now(), updated_by = auth.uid() where id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'previous', jsonb_build_object('learn_replies', o.learn_replies, 'learn_teach', o.learn_teach));
end;
$$;

revoke execute on function public.hub_learn_command(jsonb), public.hub_teach_claim(integer), public.hub_teach_finish(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.hub_learn_command(jsonb), public.hub_teach_claim(integer), public.hub_teach_finish(uuid, jsonb) to service_role;
revoke execute on function public.hub_learning_get(), public.hub_learning_set(boolean, boolean) from public, anon;
grant execute on function public.hub_learning_get(), public.hub_learning_set(boolean, boolean) to authenticated;
revoke execute on function internal.hub_teacher(text), internal.hub_learn_insert(text, text, text, text, uuid, jsonb, text[], boolean),
                           internal.hub_learn_archive(uuid, uuid, text), internal.hub_learn_cards(), internal.hub_learn_topics() from public, anon, authenticated;
