-- Cutover step 5 (Ahmed, 3 Nov 2026): public.club_signups is dropped only after the import was verified — checked again
-- here: the same number of rows as imported profiles, and every row's phone has its club consent with the original
-- time and text version. Anything that does not match raises and nothing is dropped.
do $$
declare
  v_rows integer;
  v_ok integer;
begin
  if to_regclass('public.club_signups') is null then return; end if;
  execute 'select count(*) from public.club_signups' into v_rows;
  execute 'select count(*) from public.club_signups s
            where exists (select 1 from public.guest_profiles g join public.guest_consents c on c.profile_id = g.id
                           where g.phone = s.phone_e164 and not g.is_test and g.merged_into is null and g.club_joined_at is not null
                             and c.source = ''club'' and c.action = ''grant'' and c.at = s.consent_at and c.text_version = s.consent_text_version)' into v_ok;
  if v_ok <> v_rows then raise exception 'club_signups_not_imported: % of % rows verified — nothing dropped', v_ok, v_rows; end if;
  drop table public.club_signups;
  raise notice 'club_signups: % rows verified, table dropped', v_rows;
end $$;
