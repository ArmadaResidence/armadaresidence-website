// Guest Hub S2e (26 Nov 2026 — Ahmed's approved comment sections of 21 Nov 2026, SOCIAL-SPEC.md §11; DECISIONS.md 2026-11-26
// «Guest Hub S2e»): writes supabase/migrations/20261126500000_guest_hub_s2e.sql. Run ONCE before it is applied; never after.
//   node scripts/hub-s2e-migration.mjs [--force]
//   - Ahmed's public comment texts (§8 of his spec), word for word, into public.hub_comment_texts (version 2026-11-21);
//     the private message is no fixed text any more (§5.3: the assistant's normal answer / the complaint hand-off notice),
//     so internal.hub_comment_texts_problems checks the public texts only;
//   - a reply inside a thread is handled (§5.1 / §5.4): ignored only in a thread a staff member answered («staff_thread»);
//     under our own reply → no public reply (the claim's `thread_ours`); the classifier sees IN_THREAD;
//   - the private answer's model calls counted on «السوشيال»; an answer the engine hands off → a hand-off of the comment;
//   - the audience per channel (§6 «Settings per channel: test / live / standby»): hub_channels.social_mode (NULL = the
//     unit's), internal.hub_channel_audience, public.hub_channel_audience_set (the system admin, audited, «تراجع»);
//   - «التقارير» → conversations per channel (§6);
//   - the knowledge read ranks the cards inside a topic by the guest's own words (Ahmed, 26 Nov 2026): a card that names
//     one of them comes before the others of the cap (hub_knowledge_for / _eval gain p_text; internal.hub_norm,
//     internal.hub_guest_words = _shared/hub/retrieval.ts → guestWords);
//   - the lab: c2-11 (a reply between users — the classifier's argument), c2-15 (a thread a staff member answered — the code
//     rule), c2-16 (a question under our own reply — no public reply, the private answer), s2-03 (the bathroom amenities
//     card on Airport Road's number).
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fnFrom } from './hub-team-migration.mjs';

export const OUT_PATH = 'supabase/migrations/20261126500000_guest_hub_s2e.sql';
const OUT = new URL(`../${OUT_PATH}`, import.meta.url);
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function edit(fn, name, from, to) {
  const n = fn.split(from).length - 1;
  if (n !== 1) throw new Error(`${name}: an edit matched ${n} times — ${from.slice(0, 90)}`);
  return fn.replace(from, () => to);
}
/** the latest definition of a function among the migrations before this one */
function latest(name) {
  const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql') && f < '20261126500000').sort();
  const re = new RegExp(`create (or replace )?function ${name.replace('.', '\\.')}\\(`);
  for (let i = files.length - 1; i >= 0; i--) if (re.test(read(`supabase/migrations/${files[i]}`))) return fnFrom(`supabase/migrations/${files[i]}`, name);
  throw new Error(`${name}: not found`);
}

/** Ahmed's approved texts (his spec §8, 21 Nov 2026) — never reworded, the punctuation kept */
export const TEXTS = {
  public: {
    question: {
      ar: ['أهلًا بك، أرسلنا لك التفاصيل في رسالة خاصة.', 'يسعدنا سؤالك، تجد التفاصيل في رسائلك الخاصة.', 'تم الرد عليك في الخاص، ويسعدنا خدمتك.'],
      en: ["Welcome! We've sent you the details in a private message.", "Thanks for asking. You'll find the details in your messages.", "We've replied to you privately. Happy to help."],
    },
    price: {
      ar: ['الأسعار حسب تاريخ الإقامة، أرسلنا لك رسالة خاصة لنعرف تواريخك.', 'يعتمد السعر على تواريخ إقامتك، تابع رسائلك الخاصة.'],
      en: ["Prices depend on your dates. We've sent you a private message to ask for them.", 'The price depends on your stay dates. Please check your messages.'],
    },
    complaint: {
      ar: ['نأسف لما واجهته، تواصلنا معك في الخاص لمتابعة الأمر.', 'نعتذر منك، أرسلنا لك رسالة خاصة ليتابع الفريق طلبك.'],
      en: ["We're sorry about your experience. We've contacted you privately to follow up.", "We apologise. We've sent you a private message so our team can follow up."],
    },
    praise: {
      ar: ['شكرًا لك على كلماتك الجميلة.', 'شكرًا لك، يسعدنا ذلك كثيرًا.', 'سعداء برأيك، شكرًا لك.'],
      en: ['Thank you for your kind words.', 'Thank you, that means a lot to us.', "We're glad to hear it. Thank you."],
    },
  },
};

/** = _shared/hub/retrieval.ts → STOP_WORDS (normalised) */
export const STOP_WORDS = ['عندكم', 'عندكو', 'عندكوا', 'عندك', 'عندهم', 'لديكم', 'لديك', 'فيه', 'فيها', 'هل', 'يوجد', 'توجد', 'موجود', 'موجوده', 'متوفر', 'متوفره', 'يتوفر', 'تتوفر',
  'غرف', 'غرفه', 'تجهيزات', 'ايش', 'وش', 'شو', 'ماذا', 'كيف', 'ممكن', 'لو', 'سمحت', 'فندق', 'لكم', 'عن', 'على', 'علي', 'من', 'الى', 'الي', 'مع', 'هذا', 'هذه',
  'ابغى', 'ابغي', 'ابي', 'اريد', 'نبي', 'نبغى', 'نبغي', 'كم', 'متى', 'وين', 'اين', 'انا', 'احنا', 'نحن', 'السلام', 'عليكم', 'مرحبا', 'اهلا', 'لو', 'يا',
  'do', 'does', 'you', 'have', 'the', 'rooms', 'room', 'is', 'are', 'there', 'any', 'what', 'your', 'and', 'for', 'with', 'please', 'hotel', 'can', 'how',
  'hello', 'thanks', 'thank', 'would', 'like', 'want', 'need'];

const NEW_ITEMS = [
  { key: 'c2-15', unit: 'social', language: 'ar', messages: ['طيب وكم سعرها؟'], context: { kind: 'instagram', parent: 'staff' },
    expect: { action: 'comment', skip: 'staff_thread' }, note: 'a reply in a thread a staff member already answered: ignored by the code rule, no model call (SOCIAL-SPEC §5.1)', tags: ['comment', 'social', 'thread', 's2e'] },
  { key: 'c2-16', unit: 'social', language: 'ar', messages: ['طيب هل عندكم مواقف سيارات؟'], context: { kind: 'facebook', parent: 'ours' },
    expect: { action: 'comment', class: 'question', public: false, private: true, handoff: false },
    note: 'a question under our own public reply: never a public reply to our own reply (§5.4), the private answer as for any question', tags: ['comment', 'social', 'thread', 's2e'] },
  { key: 's2-03', unit: 'airport-road', language: 'ar', messages: ['عندكم شامبو في الغرف؟'], context: {},
    expect: { action: 'conversation', steps: [{ outcome: 'answer', must_include: ['شامبو'], must_not_include: ['سيكمل معك'] }] },
    note: 'the bathroom amenities card on Airport Road\'s WhatsApp number: the guest\'s own word ranks it inside the topic (Ahmed, 26 Nov 2026)', tags: ['s2e', 'amenities'] },
  { key: 's2-04', unit: 'shafa-road', language: 'en', messages: ['Is there shampoo in the room?'], context: {},
    expect: { action: 'conversation', steps: [{ outcome: 'answer', must_include: ['shampoo'], must_not_include: ['will continue with you'] }] },
    note: 'the same on Shafa Road\'s number, in English', tags: ['s2e', 'amenities'] },
];
const C211 = { context: { kind: 'instagram', parent: 'user' },
  expect: { action: 'comment', public: false, private: false, handoff: false },
  note: 'a reply in a thread between users (an argument): the classifier sees IN_THREAD and nothing is posted (SOCIAL-SPEC §5.4)' };

const HEAD = `-- Guest Hub S2e (26 Nov 2026 — Ahmed's approved comment sections of 21 Nov 2026, SOCIAL-SPEC.md §11; DECISIONS.md 2026-11-26
-- «Guest Hub S2e»). Generated by scripts/hub-s2e-migration.mjs — never edited once applied (CLAUDE.md §12). No unit mode,
-- licence or switch changes: the comment switches stay OFF (the system admin's). Every UPDATE / DELETE carries a WHERE.
`;

export function migration() {
  const out = [];
  // ── 1. the texts ──
  out.push(`-- ── 1. Ahmed's approved public texts (his spec §8, 21 Nov 2026), word for word ──
create or replace function internal.hub_comment_texts_problems(t jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  v text[] := '{}';
  c text;
  l text;
  x text;
  i integer;
begin
  if t is null or jsonb_typeof(t) <> 'object' then return array['missing']; end if;
  foreach c in array array['question', 'price', 'complaint', 'praise'] loop
    foreach l in array array['ar', 'en'] loop
      if jsonb_typeof(t #> array['public', c, l]) <> 'array' or jsonb_array_length(t #> array['public', c, l]) = 0 then
        v := v || ('public.' || c || '.' || l);
      else
        i := 0;
        for x in select jsonb_array_elements_text(t #> array['public', c, l]) loop
          if coalesce(btrim(x), '') = '' then v := v || ('public.' || c || '.' || l || '.' || i || ':empty');
          elsif x ~ '[0-9٠-٩۰-۹]' then v := v || ('public.' || c || '.' || l || '.' || i || ':digit');
          elsif x ~* '(ريال|ر\\.س|﷼|درهم|دولار|\\msar\\M|\\msr\\M|\\musd\\M|\\$|€|£|%|٪|يبدأ من|ابتداءً من|ابتداء من|\\mstarting (at|from)\\M)' then v := v || ('public.' || c || '.' || l || '.' || i || ':price');
          elsif char_length(x) > 300 then v := v || ('public.' || c || '.' || l || '.' || i || ':long');
          elsif x ~* '(https?://|www\\.)' then v := v || ('public.' || c || '.' || l || '.' || i || ':link');
          end if;
          i := i + 1;
        end loop;
      end if;
    end loop;
  end loop;
  -- S2e: no fixed private text (SOCIAL-SPEC §5.3 — the assistant's answer, the complaint hand-off notice)
  return v;
end;
$$;
comment on table public.hub_comment_texts is 'S2: Ahmed''s approved public comment texts (his spec §8, 21 Nov 2026 — SOCIAL-SPEC.md §11): {public: {question|price|complaint|praise: {ar: [variants], en: [variants]}}}. Written only by a migration, word for word. The private message is the assistant''s answer (S2e).';
update public.hub_comment_texts
   set texts = $s2e$${JSON.stringify(TEXTS)}$s2e$::jsonb, version = '2026-11-21', approved_by = 'Ahmed, 21 Nov 2026', set_at = now()
 where id = 1;
do $$
begin
  if cardinality(internal.hub_comment_texts_problems((select t.texts from public.hub_comment_texts t where t.id = 1))) > 0 then
    raise exception 's2e: the approved texts do not pass their own check';
  end if;
end $$;`);

  // ── 2. the audience per channel ──
  out.push(`-- ── 2. the audience per channel (Ahmed's §6: «Settings per channel: test / live / standby») — NULL = the unit's ──
alter table public.hub_channels add column if not exists social_mode text;
alter table public.hub_channels drop constraint if exists hub_channels_social_mode;
alter table public.hub_channels add constraint hub_channels_social_mode check (social_mode is null or (social_mode in ('test', 'live', 'standby') and provider = 'meta'));
comment on column public.hub_channels.social_mode is 'S2e: a Meta channel''s own audience (test «حسابات التجربة فقط» · live «الكل» · standby «الكل مع وضع الاستعداد»); NULL = its unit''s social_mode.';
create or replace function internal.hub_channel_audience(p_channel uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(ch.social_mode, u.social_mode) from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where ch.id = p_channel
$$;
create or replace function public.hub_channel_audience_set(p_channel uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.hub_channels;
  v_batch uuid;
begin
  if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = '42501'; end if;
  select * into ch from public.hub_channels where id = p_channel for update;
  if ch.id is null or ch.provider <> 'meta' then raise exception 'not_found' using errcode = '22023'; end if;
  if p_mode is not null and p_mode not in ('test', 'live', 'standby') then raise exception 'invalid' using errcode = '22023'; end if;
  if ch.social_mode is not distinct from p_mode then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.hub_channels set social_mode = p_mode where id = ch.id;
  -- the channels' audit trigger names its columns (not this one): the change is written here, one row of the batch
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (auth.uid(), coalesce((select st.full_name from public.staff st where st.user_id = auth.uid()), 'system'), 'hub_channels', ch.id::text, null, 'update',
          jsonb_build_object('social_mode', ch.social_mode), jsonb_build_object('social_mode', p_mode), v_batch);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'before', ch.social_mode);
end;
$$;
revoke execute on function public.hub_channel_audience_set(uuid, text) from public, anon;
grant execute on function public.hub_channel_audience_set(uuid, text) to authenticated, service_role;
revoke execute on function internal.hub_channel_audience(uuid) from public, anon, authenticated;`);

  let may = latest('internal.hub_social_may_reply');
  may = edit(may, 'may_reply', `    when cu.social_mode in ('live', 'standby') then true`, `    -- S2e: the channel's own audience, else its unit's
    when coalesce(ch.social_mode, cu.social_mode) in ('live', 'standby') then true`);
  out.push(may);

  let sb = latest('internal.hub_standby_reason');
  sb = edit(sb, 'standby_reason', `    when u.kind = 'brand' and u.social_mode <> 'standby' then 'off'`,
    `    -- S2e: the conversation's channel's own audience, else the unit's
    when u.kind = 'brand' and coalesce(internal.hub_channel_audience(c.channel_id), u.social_mode) <> 'standby' then 'off'`);
  out.push(sb);

  let ov = latest('public.hub_social_overview');
  ov = edit(ov, 'overview', `'verified_at', c.verified_at, 'sending_enabled', c.sending_enabled) order by c.kind)`,
    `'verified_at', c.verified_at, 'sending_enabled', c.sending_enabled,
                                                         'social_mode', c.social_mode, 'audience', coalesce(c.social_mode, u.social_mode)) order by c.kind)`);
  out.push(ov);

  // ── 3. the comments: threads, the audience, the private answer ──
  let ing = latest('public.hub_comment_ingest');
  ing = edit(ing, 'ingest', `  if v_skip is null then
    if not ch.comments_on then v_skip := 'switch_off';
    elsif u.assistant_mode = 'off' then v_skip := 'unit_off';
    elsif u.social_mode = 'test' and not v_tester then v_skip := 'not_tester';
    end if;
  end if;`, `  -- S2e (SOCIAL-SPEC §5.1): a reply inside a thread a staff member already answered is ignored
  if v_skip is null and nullif(p ->> 'parent_id', '') is not null
     and exists (select 1 from public.hub_comments x where x.channel_id = ch.id and x.comment_id = p ->> 'parent_id' and x.staff_answered_at is not null) then
    v_skip := 'staff_thread';
  end if;
  if v_skip is null then
    if not ch.comments_on then v_skip := 'switch_off';
    elsif u.assistant_mode = 'off' then v_skip := 'unit_off';
    elsif coalesce(ch.social_mode, u.social_mode) = 'test' and not v_tester then v_skip := 'not_tester';
    end if;
  end if;`);
  out.push(ing);

  let cl = latest('public.hub_comment_claim');
  cl = edit(cl, 'claim', `  if not ch.comments_on or u.assistant_mode = 'off' or (u.social_mode = 'test' and not c.tester) or c.staff_answered_at is not null then
    update public.hub_comments set state = 'skipped', done_at = now(),
           skip_reason = case when not ch.comments_on then 'switch_off' when u.assistant_mode = 'off' then 'unit_off' when c.staff_answered_at is not null then 'staff_answered' else 'not_tester' end
     where id = c.id;`, `  -- S2e: the channel's own audience; a thread a staff member answered (the comment's own, or its parent's)
  v_thread_staff := c.parent_id is not null and exists (select 1 from public.hub_comments x where x.channel_id = c.channel_id and x.comment_id = c.parent_id and x.staff_answered_at is not null);
  if not ch.comments_on or u.assistant_mode = 'off' or (coalesce(ch.social_mode, u.social_mode) = 'test' and not c.tester) or c.staff_answered_at is not null or v_thread_staff then
    update public.hub_comments set state = 'skipped', done_at = now(),
           skip_reason = case when not ch.comments_on then 'switch_off' when u.assistant_mode = 'off' then 'unit_off' when c.staff_answered_at is not null then 'staff_answered'
                              when v_thread_staff then 'staff_thread' else 'not_tester' end
     where id = c.id;`);
  cl = edit(cl, 'claim_decl', `  u public.hub_units;
begin`, `  u public.hub_units;
  v_thread_staff boolean;
begin`);
  cl = edit(cl, 'claim_out', `                                  'commented_at', c.commented_at, 'has_post', c.post_permalink is not null or c.post_thumb is not null, 'is_test', c.is_test),`,
    `                                  'commented_at', c.commented_at, 'has_post', c.post_permalink is not null or c.post_thumb is not null, 'is_test', c.is_test,
                                  -- S2e: a reply inside a thread; under our own public reply (never a public reply to our own reply)
                                  'in_thread', c.parent_id is not null,
                                  'thread_ours', c.parent_id is not null and exists (select 1 from public.hub_comments x where x.channel_id = c.channel_id
                                                   and x.comment_id = c.parent_id and x.public_status = 'sent')),`);
  cl = edit(cl, 'claim_unit', `    'unit', jsonb_build_object('id', u.id, 'mode', u.assistant_mode),`,
    `    'unit', jsonb_build_object('id', u.id, 'key', u.key, 'mode', u.assistant_mode),
    'budget', internal.hub_budget_state(),`);
  out.push(cl);

  let dn = latest('public.hub_comment_done');
  dn = edit(dn, 'done_cost', `  if (p ->> 'input_tokens') is not null then
    perform internal.hub_usage_add(ch.unit_id, 'tag', 'turn', coalesce(p ->> 'model', 'claude-sonnet-5-5'), (p ->> 'input_tokens')::bigint, coalesce((p ->> 'output_tokens')::bigint, 0), c.is_test);
  end if;`, `  if (p ->> 'input_tokens') is not null then
    perform internal.hub_usage_add(ch.unit_id, 'tag', 'turn', coalesce(p ->> 'model', 'claude-sonnet-5-5'), (p ->> 'input_tokens')::bigint, coalesce((p ->> 'output_tokens')::bigint, 0), c.is_test);
  end if;
  -- S2e: the private answer's model calls (the engine on «السوشيال»)
  for m in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'models') = 'array' then p -> 'models' else '[]'::jsonb end) loop
    if coalesce((m ->> 'input_tokens')::bigint, 0) + coalesce((m ->> 'output_tokens')::bigint, 0) > 0 then
      perform internal.hub_usage_add(ch.unit_id, case when m ->> 'layer' in ('understand', 'compose', 'tag', 'vision', 'summary') then m ->> 'layer' else 'understand' end, 'turn',
                                     coalesce(m ->> 'model', 'claude-sonnet-5-5'), coalesce((m ->> 'input_tokens')::bigint, 0), coalesce((m ->> 'output_tokens')::bigint, 0), c.is_test);
    end if;
  end loop;`);
  dn = edit(dn, 'done_decl', `  v_handoff uuid;
begin`, `  v_handoff uuid;
  m jsonb;
  v_question boolean := (p ->> 'handoff_reason') = 'comment_question';
begin`);
  dn = edit(dn, 'done_handoff', `    values (v_handoff, null, c.id, ch.unit_id, 'airport-road', 'comment_complaint',
            case when c.kind = 'instagram' then 'شكوى في تعليق على انستجرام' else 'شكوى في تعليق على فيسبوك' end, 'تعليق', c.is_test, not c.tester);`,
    `    values (v_handoff, null, c.id, ch.unit_id, 'airport-road', case when v_question then 'comment_question' else 'comment_complaint' end,
            case when v_question then (case when c.kind = 'instagram' then 'سؤال في تعليق على انستجرام يحتاج الفريق' else 'سؤال في تعليق على فيسبوك يحتاج الفريق' end)
                 when c.kind = 'instagram' then 'شكوى في تعليق على انستجرام' else 'شكوى في تعليق على فيسبوك' end, 'تعليق', c.is_test, not c.tester);`);
  out.push(dn);

  // ── 4. «التقارير»: conversations per channel ──
  let rh = latest('public.report_hub');
  rh = edit(rh, 'report_hub', `    'whatsapp', (select jsonb_build_object('templates', n,`, `    -- S2e (Ahmed's §6): the conversations per channel (WhatsApp, Instagram, Messenger); «السوشيال» counted by its
    -- conversation's branch, or — branch unknown — for a user who sees every branch
    'by_channel', (select jsonb_build_object('whatsapp', count(*) filter (where ch.kind not in ('instagram', 'messenger')),
                                             'instagram', count(*) filter (where ch.kind = 'instagram'), 'messenger', count(*) filter (where ch.kind = 'messenger'))
                     from public.hub_conversations c join public.hub_channels ch on ch.id = c.channel_id join public.hub_units u on u.id = c.unit_id
                    where not c.is_test and c.created_at >= v_a and c.created_at < v_b and not u.is_test
                      and (u.branch_slug = any (v_br) or (u.branch_slug is null and (c.branch_slug = any (v_br) or (c.branch_slug is null and cardinality(v_br) >= 2))))),
    'whatsapp', (select jsonb_build_object('templates', n,`);
  out.push(rh);

  // ── 5. the knowledge read: the guest's own words rank the cards inside a topic ──
  out.push(`-- ── 5. the guest's own words rank the cards inside a topic (Ahmed, 26 Nov 2026) — = retrieval.ts → normWords / guestWords ──
create or replace function internal.hub_norm(t text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(translate(lower(coalesce(t, '')), 'أإآةى', 'اااهي'), '[\\u064B-\\u0652\\u0640]', '', 'g'),
                              '[[:punct:]؟،؛«»“”‘’…]+', ' ', 'g'))
$$;
create or replace function internal.hub_stop_words() returns text[]
language sql immutable set search_path = '' as $$
  select array[${STOP_WORDS.map((w) => `'${w}'`).join(', ')}]::text[]
$$;
create or replace function internal.hub_guest_words(t text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct y.w order by y.w), '{}') from (
    select case when char_length(x) >= 5 and x ~ '^(وال|بال|فال|كال|لل|ال)' then regexp_replace(x, '^(وال|بال|فال|كال|لل|ال)', '') else x end as w
      from regexp_split_to_table(internal.hub_norm(t), '\\s+') x) y
   where char_length(y.w) >= 3 and not (y.w = any (internal.hub_stop_words()))
$$;
revoke execute on function internal.hub_norm(text), internal.hub_stop_words(), internal.hub_guest_words(text) from public, anon, authenticated;
drop function if exists public.hub_knowledge_for(text, text[], text, text);
drop function if exists public.hub_knowledge_for_eval(text, text[], text, text, uuid[]);`);
  const words = (fn, name, sig) => {
    let f = fn.replace(/^create or replace function /, 'create function ');
    f = edit(f, `${name}_sig`, sig.from, sig.to);
    f = edit(f, `${name}_decl`, `  v_cards jsonb;\n`, `  v_cards jsonb;\n  -- S2e: the guest's own words (a card naming one of them ranks first inside the cap)\n  v_words text[] := internal.hub_guest_words(p_text);\n`);
    f = edit(f, `${name}_order`, `) order by z.rank_unit, z.exact desc, z.related desc, z.sort, z.key), '[]'::jsonb)`,
      `) order by z.word_first, z.rank_unit, z.words desc, z.exact desc, z.related desc, z.sort, z.key), '[]'::jsonb)`);
    const hit = `internal.hub_norm(concat_ws(' ', c.live ->> 'title_ar', c.live ->> 'text_ar', c.live ->> 'title_en', c.live ->> 'text_en')) like '%' || w || '%'`;
    f = edit(f, `${name}_rank`, `             (select count(*) from unnest(c.topic_keys) k where k = any (p_topics)) as exact,`,
      `             (select count(*) from unnest(c.topic_keys) k where k = any (p_topics)) as exact,
             (select count(*) from unnest(v_words) w where ${hit}) as words,
             case when (cardinality(c.unit_keys) = 0 or c.unit_keys && v_focus) and exists (select 1 from unnest(v_words) w where ${hit}) then 0 else 1 end as word_first,`);
    f = edit(f, `${name}_limit`, `       order by rank_unit, exact desc, related desc, c.sort, c.key
       limit v_n) z;`, `       order by word_first, rank_unit, words desc, exact desc, related desc, c.sort, c.key
       limit v_n) z;`);
    return f;
  };
  let kf = latest('public.hub_knowledge_for');
  kf = words(kf, 'kf', { from: `public.hub_knowledge_for(p_unit text, p_topics text[], p_language text, p_branch text default null) returns jsonb`,
    to: `public.hub_knowledge_for(p_unit text, p_topics text[], p_language text, p_branch text default null, p_text text default null) returns jsonb` });
  out.push(kf);
  let ke = latest('public.hub_knowledge_for_eval');
  ke = words(ke, 'ke', { from: `public.hub_knowledge_for_eval(p_unit text, p_topics text[], p_language text, p_branch text default null, p_cards uuid[] default null) returns jsonb`,
    to: `public.hub_knowledge_for_eval(p_unit text, p_topics text[], p_language text, p_branch text default null, p_cards uuid[] default null, p_text text default null) returns jsonb` });
  out.push(ke);
  out.push(`revoke execute on function public.hub_knowledge_for(text, text[], text, text, text), public.hub_knowledge_for_eval(text, text[], text, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.hub_knowledge_for(text, text[], text, text, text), public.hub_knowledge_for_eval(text, text[], text, text, uuid[], text) to service_role;`);

  // ── 6. the lab ──
  out.push(`-- ── 6. the lab: the thread cases and the amenities card on the branch numbers ──
update public.hub_test_items
   set context = $s2e$${JSON.stringify(C211.context)}$s2e$::jsonb, expect = $s2e$${JSON.stringify(C211.expect)}$s2e$::jsonb, note = $s2e$${C211.note}$s2e$
 where key = 'c2-11';
do $$
declare v_sort integer := coalesce((select max(sort) from public.hub_test_items), 0) + 1;
begin
  insert into public.hub_test_items (key, unit_key, language, messages, context, expect, note, tags, added_from, sort)
  select e ->> 'key', e ->> 'unit', e ->> 'language', e -> 'messages', coalesce(e -> 'context', '{}'::jsonb), e -> 'expect', e ->> 'note',
         array(select jsonb_array_elements_text(e -> 'tags')), 'seed', v_sort + (o - 1)::integer
    from jsonb_array_elements($s2e$${JSON.stringify(NEW_ITEMS)}$s2e$::jsonb) with ordinality as x(e, o)
  on conflict (key) do nothing;
end $$;`);
  return `${HEAD}\n${out.join('\n\n')}\n`;
}
export { NEW_ITEMS, C211 };

if (process.argv[1]?.endsWith('hub-s2e-migration.mjs')) {
  const sql = migration();
  if (existsSync(OUT) && !process.argv.includes('--force')) {
    const cur = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
    if (cur !== sql) { console.error(`✗ ${OUT_PATH} differs from its generator`); process.exit(1); }
    console.log(`✓ ${OUT_PATH} = its generator`);
  } else {
    writeFileSync(OUT, sql, 'utf8');
    console.log(`✓ wrote ${OUT_PATH}`);
  }
}
