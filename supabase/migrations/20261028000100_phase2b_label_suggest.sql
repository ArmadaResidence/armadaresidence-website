-- 28 Oct 2026 — Bilingual label suggestions (decision C4, Ahmed 28 Oct 2026).
--
-- Every Arabic / English label pair of the dashboard (today «سعر لفترة» → «تسمية بالعربية» / «التسمية بالإنجليزية»;
-- the offers module reuses the component) offers suggestions from a seed glossary and from the pairs already saved on
-- the branch, and a translation chip for the empty side: an exact glossary / history match first (no network), else
-- the Edge Function `label-suggest` (claude-haiku-5-5). Nothing is ever auto-filled: the labels are shown to guests.
--
--   public.label_glossary          the seed pairs (editable later from the dashboard); staff read it
--   internal.label_suggest_cache   identical requests answered once (input / output token counts per row)
--   internal.label_suggest_calls   the per-user rate limit of the function (60 model calls per hour)
--   public.label_suggest_gate      called AS THE USER by the function: the staff check (internal.me() — a verified
--                                  session, active staff, as every dashboard RPC), the cache lookup, the rate limit
--   public.label_suggest_store     service role only: the function stores a model answer in the cache

create table public.label_glossary (
  id uuid primary key default gen_random_uuid(),
  ar text not null check (char_length(ar) between 1 and 80),
  en text not null check (char_length(en) between 1 and 80),
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  unique (ar, en)
);
comment on table public.label_glossary is 'Seed glossary of rate / offer label pairs (C4, 28 Oct 2026). Suggested in every bilingual label field of the dashboard; never auto-filled.';
alter table public.label_glossary enable row level security;
create policy label_glossary_read on public.label_glossary for select to authenticated using (internal.is_staff());
revoke all on public.label_glossary from public, anon;
grant select on public.label_glossary to authenticated;

insert into public.label_glossary (ar, en, sort) values
  ('موسم الصيف', 'Summer season', 10),
  ('موسم الشتاء', 'Winter season', 20),
  ('نهاية الأسبوع', 'Weekend', 30),
  ('منتصف الأسبوع', 'Midweek', 40),
  ('الموسم المرتفع', 'Peak season', 50),
  ('الموسم المنخفض', 'Low season', 60),
  ('شهر رمضان', 'Ramadan', 70),
  ('عيد الفطر', 'Eid al-Fitr', 80),
  ('عيد الأضحى', 'Eid al-Adha', 90),
  ('اليوم الوطني', 'Saudi National Day', 100),
  ('يوم التأسيس', 'Founding Day', 110),
  ('الإجازة المدرسية', 'School holidays', 120),
  ('موسم الطائف', 'Taif Season', 130),
  ('موسم الورد الطائفي', 'Taif rose season', 140),
  ('موسم العمرة', 'Umrah season', 150),
  ('عرض الحجز المبكر', 'Early booking offer', 160),
  ('عرض اللحظة الأخيرة', 'Last-minute offer', 170),
  ('عرض الإقامة الطويلة', 'Long-stay offer', 180),
  ('عرض نهاية الأسبوع', 'Weekend offer', 190),
  ('سعر خاص', 'Special rate', 200)
on conflict (ar, en) do nothing;

create table internal.label_suggest_cache (
  input_hash text primary key,
  source_lang text not null check (source_lang in ('ar', 'en')),
  input text not null,
  output text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz not null default clock_timestamp(),
  hits integer not null default 0
);
create table internal.label_suggest_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default clock_timestamp()
);
create index label_suggest_calls_user on internal.label_suggest_calls (user_id, at desc);

/** the per-user limit of model calls per hour */
create function internal.label_suggest_limit() returns integer language sql immutable set search_path = '' as $$ select 60 $$;

-- called as the user (the function forwards the JWT): staff check → cache → rate limit; a cache hit costs no quota
create function public.label_suggest_gate(p_hash text, p_from text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.staff := internal.me();
  v_hit internal.label_suggest_cache;
  v_n integer;
begin
  if v_me.user_id is null or not v_me.active then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_hash !~ '^[0-9a-f]{64}$' or p_from not in ('ar', 'en') then raise exception 'invalid' using errcode = '22023'; end if;
  select * into v_hit from internal.label_suggest_cache c where c.input_hash = p_hash;
  if v_hit.input_hash is not null then
    update internal.label_suggest_cache set hits = hits + 1, last_used_at = clock_timestamp() where input_hash = p_hash;
    return jsonb_build_object('ok', true, 'cached', v_hit.output);
  end if;
  select count(*) into v_n from internal.label_suggest_calls c where c.user_id = v_me.user_id and c.at > clock_timestamp() - interval '1 hour';
  if v_n >= internal.label_suggest_limit() then return jsonb_build_object('ok', false, 'reason', 'rate_limit'); end if;
  insert into internal.label_suggest_calls (user_id) values (v_me.user_id);
  return jsonb_build_object('ok', true, 'cached', null);
end;
$$;
revoke execute on function public.label_suggest_gate(text, text) from public, anon;
grant execute on function public.label_suggest_gate(text, text) to authenticated;

-- service role only: the function stores the model's answer with the token counts
create function public.label_suggest_store(p_hash text, p_from text, p_input text, p_output text, p_model text, p_in integer, p_out integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into internal.label_suggest_cache (input_hash, source_lang, input, output, model, input_tokens, output_tokens)
  values (p_hash, p_from, left(p_input, 60), left(p_output, 80), p_model, coalesce(p_in, 0), coalesce(p_out, 0))
  on conflict (input_hash) do update set output = excluded.output, model = excluded.model, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, last_used_at = clock_timestamp();
end;
$$;
revoke execute on function public.label_suggest_store(text, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.label_suggest_store(text, text, text, text, text, integer, integer) to service_role;
