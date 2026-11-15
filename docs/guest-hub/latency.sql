-- Guest Hub — reply time per stage (15 Nov 2026, Ahmed: «replies feel slow»). Read-only; timings and counts only, no
-- message content. Change the start time to compare before / after a deploy (the speed fix went live 15 Nov 19:05 UTC).
with t as (
  select t.*, g.kind as mkind, g.sent_at as g_sent, g.created_at as g_stored
    from public.hub_turns t join public.hub_messages g on g.id = t.first_inbound_id
   where not t.is_test and t.created_at > '2026-11-15 19:05+00' and t.status = 'done' and t.kind = 'reply'),
o as (
  select t.id,
         (select m.sent_at from public.hub_messages m where m.conversation_id = t.conversation_id and m.direction = 'out' and m.author = 'assistant'
             and m.created_at >= t.claimed_at and m.created_at <= t.finished_at + interval '5 seconds' and m.sent_at is not null order by m.created_at limit 1) as out_sent
    from t),
x as (
  select t.mkind,
    extract(epoch from t.g_stored - t.g_sent) as recv,
    extract(epoch from t.claimed_at - t.created_at) as burst,
    (select coalesce(sum((m ->> 'latency_ms')::numeric), 0) / 1000 from jsonb_array_elements(coalesce(t.models, '[]')) m where m ->> 'layer' = 'understand') as und,
    (select coalesce(sum((m ->> 'latency_ms')::numeric), 0) / 1000 from jsonb_array_elements(coalesce(t.models, '[]')) m where m ->> 'layer' = 'compose') as comp,
    extract(epoch from o.out_sent - t.finished_at) as send,
    extract(epoch from o.out_sent - t.g_stored) as from_webhook,
    extract(epoch from o.out_sent - t.g_sent) as total
  from t join o on o.id = t.id where o.out_sent is not null)
select mkind, count(*) as n,
  round(percentile_cont(0.5) within group (order by recv)::numeric, 1) as recv_p50,
  round(percentile_cont(0.5) within group (order by burst)::numeric, 1) as burst_p50,
  round(percentile_cont(0.5) within group (order by und)::numeric, 1) as understand_p50,
  round(percentile_cont(0.5) within group (order by comp)::numeric, 1) as compose_p50,
  round(percentile_cont(0.5) within group (order by send)::numeric, 1) as send_p50,
  round(percentile_cont(0.5) within group (order by from_webhook)::numeric, 1) as webhook_to_ycloud_p50,
  round(percentile_cont(0.5) within group (order by total)::numeric, 1) as total_p50,
  round(percentile_cont(0.9) within group (order by total)::numeric, 1) as total_p90
from x group by mkind order by n desc;
