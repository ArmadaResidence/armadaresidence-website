-- Breakfast fees (15 Nov 2026 — migration 20261115300000_breakfast_fees; DECISIONS.md 2026-11-15 «Breakfast fees»):
-- Settings is the source; site_fees() hands the child tiers to the build; the assistant's FAQ read fills the three
-- placeholders by the site's rule; the editors accept them; the published FAQ and the policies field carry no typed age
-- or amount. ONE transaction, ROLLED BACK. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml).
begin;
create temp table _r (n serial primary key, test text, ok boolean, detail text);
create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;

-- the values of Ahmed's brief (inside this rolled-back test only)
alter table public.settings disable trigger user;
insert into public.settings (key, value) values ('breakfast', '{"adult": 25, "child_tiers": [{"max_age": 6, "price": 0}, {"max_age": 12, "price": 12.5}]}')
on conflict (key) do update set value = excluded.value;
alter table public.settings enable trigger user;

select pg_temp._check('B1 site_fees: the adult price and the child tiers',
  (public.site_fees() ->> 'breakfast_adult')::numeric = 25 and public.site_fees() -> 'breakfast_child_tiers' = '[{"max_age": 6, "price": 0}, {"max_age": 12, "price": 12.5}]'::jsonb,
  public.site_fees()::text);
select pg_temp._check('B2 the assistant''s fill (ar): 25 ريالًا · 6 · 12 · 12.50 ريال',
  internal.hub_fill_fees('{breakfast} | {breakfast_free_age} | {breakfast_child_age} | {breakfast_child}', 'ar') = '25 ريالًا | 6 | 12 | 12.50 ريال',
  internal.hub_fill_fees('{breakfast} | {breakfast_free_age} | {breakfast_child_age} | {breakfast_child}', 'ar'));
select pg_temp._check('B3 the assistant''s fill (en): SAR 25 · 6 · 12 · SAR 12.50',
  internal.hub_fill_fees('{breakfast} | {breakfast_free_age} | {breakfast_child_age} | {breakfast_child}', 'en') = 'SAR 25 | 6 | 12 | SAR 12.50');
-- a change in Settings changes the texts (nothing typed)
update public.settings set value = '{"adult": 30, "child_tiers": [{"max_age": 4, "price": 0}, {"max_age": 11, "price": 15}]}' where key = 'breakfast';
select pg_temp._check('B4 a change in Settings flows through: 30 ريالًا · 4 · 11 · 15 ريالًا',
  internal.hub_fill_fees('{breakfast} | {breakfast_free_age} | {breakfast_child_age} | {breakfast_child}', 'ar') = '30 ريالًا | 4 | 11 | 15 ريالًا');
select pg_temp._check('B5 the editors accept the three placeholders (copy_problems)',
  not exists (select 1 from jsonb_array_elements(internal.copy_problems('حتى {breakfast_free_age} سنوات و{breakfast_child_age} سنة {breakfast_child} و{breakfast}', 'up to {breakfast_free_age}, {breakfast_child_age} pay {breakfast_child}, {breakfast}', 600)) x
               where x ->> 'code' = 'placeholder_unknown'));
select pg_temp._check('B6 the published FAQ answer «breakfast»: the placeholders, no typed age or amount',
  (select count(*) > 0 and bool_and(a_ar like '%{breakfast_free_age}%' and a_en like '%{breakfast_child}%' and a_ar !~ '(5 سنوات|بنصف|[0-9]+ ريال)'
          and (live is null or (live ->> 'a_ar' = a_ar and live ->> 'a_en' = a_en)))
     from public.faq_items where key = 'breakfast' and not is_test));
select pg_temp._check('B7 the policies field (seed and draft): the placeholders',
  (select bool_and(seed_ar like '%{breakfast_child}%' and seed_en like '%{breakfast_free_age}%' and draft_ar !~ '5 سنوات') from public.content_fields where key = 'policy.guests.body'));

select n, test, ok, detail from _r order by n;
rollback;
