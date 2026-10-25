-- 25 Oct 2026 — phase 2a test helper (migration so the CLI history stays in sync). Does nothing until called by postgres / the
-- service role; never exposed to the API.
-- QA staff users for admin/tests/dashboard-check.mjs. Addresses end in .qa.invalid (no mailbox, no email ever sent);
-- the password is the one in the test script. Run `create` before the test and `drop` right after — they are real
-- staff rows while they exist (RLS treats them like any user), so never leave them in place.
--
-- create:  select internal.qa_users('create');
-- drop:    select internal.qa_users('drop');
create or replace function internal.qa_users(p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pw text := 'Qa-Armada-2026!x';
  u record;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
begin
  if p_action = 'drop' then
    delete from auth.users where email like '%@qa.invalid';
    return jsonb_build_object('dropped', true);
  end if;
  if p_action <> 'create' then raise exception 'create | drop'; end if;
  delete from auth.users where email like '%@qa.invalid';
  for u in
    select * from (values
      ('admin@qa.invalid', 'QA admin', 'admin'::public.staff_role, null::text),
      ('mgmt@qa.invalid', 'QA management', 'management', null),
      ('rec-air@qa.invalid', 'استقبال طريق المطار', 'reception', 'airport-road'),
      ('rec-shafa@qa.invalid', 'استقبال طريق الشفا', 'reception', 'shafa-road')
    ) t(email, full_name, role, branch)
  loop
    v_id := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
    values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, u.email, 'email', jsonb_build_object('sub', v_id::text, 'email', u.email, 'email_verified', true), now(), now(), now());
    insert into public.staff (user_id, full_name, role, branch, active) values (v_id, u.full_name, u.role, u.branch, true);
    v_out := v_out || jsonb_build_object('email', u.email, 'role', u.role, 'branch', u.branch);
  end loop;
  return v_out;
end;
$$;
revoke all on function internal.qa_users(text) from public, anon, authenticated;
