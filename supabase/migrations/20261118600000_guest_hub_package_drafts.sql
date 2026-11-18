-- 18 Nov 2026 — «باقات بسعر خاص» in the Guest Hub (Ahmed, 18 Nov 2026; DECISIONS.md 2026-11-18 «Celebrations…»): a
-- celebration package ordered in the chat is collected as a draft of its own kind — the package, the branch, the
-- occasion's date and whether the guest has a room booking — then handed to reception with them (machine.ts →
-- packageOrder). The draft table takes the kind 'package'; nothing else changes (no new table, no mode, licence or
-- switch touched).
select set_config('app.actor', 'migration', true);

alter table public.hub_drafts drop constraint hub_drafts_kind_check;
alter table public.hub_drafts add constraint hub_drafts_kind_check check (kind in ('stay', 'table', 'hall', 'group', 'package'));
