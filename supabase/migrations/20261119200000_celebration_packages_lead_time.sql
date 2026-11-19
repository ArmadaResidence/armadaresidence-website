-- 19 Nov 2026 — «باقات العرسان والمناسبات»: the lead time is one day, not a strict 24 hours (Ahmed, 19 Nov 2026;
-- DECISIONS.md 2026-11-19 «Package lead time»). A reviewed data migration (Ahmed's approved path for production data
-- since 14 Nov 2026 — a session never borrows a staff session to call the dashboard's RPCs): ONLY the lead-time sentence
-- of the common note changes, in both languages, written as public.offers_save stores the draft and published as
-- public.offers_publish publishes it (internal.offer_check first — nothing may be missing; live = internal.offer_snapshot).
-- Audited by the offers trigger (actor «migration», one batch). Nothing else in the offer, no price, booking, announcement,
-- mode, licence or switch changes. Stops if the sentence is not there exactly once (an edit from the dashboard since) or
-- the draft holds unpublished changes; a second run finds nothing to change and does nothing.

select set_config('app.actor', 'migration', true);

do $$
declare
  c_old_ar constant text := 'اطلب الباقة قبل موعد مناسبتك بـ24 ساعة على الأقل.';
  c_new_ar constant text := 'اطلب الباقة قبل موعد مناسبتك بيوم على الأقل.';
  c_old_en constant text := 'Order your package at least 24 hours before your occasion.';
  c_new_en constant text := 'Order your package at least one day before your occasion.';
  o public.offers;
  v_check jsonb;
begin
  select * into o from public.offers where slug = 'celebration-packages';
  if not found then
    raise exception 'celebration-packages does not exist — nothing written';
  end if;
  if position(c_new_ar in o.note_ar) > 0 and position(c_new_en in o.note_en) > 0 and position(c_old_ar in o.note_ar) = 0 and position(c_old_en in o.note_en) = 0 then
    raise notice 'celebration-packages already carries the one-day sentence — nothing written';
    return;
  end if;
  if (length(o.note_ar) - length(replace(o.note_ar, c_old_ar, ''))) / length(c_old_ar) <> 1
     or (length(o.note_en) - length(replace(o.note_en, c_old_en, ''))) / length(c_old_en) <> 1 then
    raise exception 'celebration-packages: the 24-hour sentence is not there exactly once in both languages — nothing written';
  end if;
  if internal.offer_pending(o) then
    raise exception 'celebration-packages has unpublished changes in the dashboard — nothing written';
  end if;

  perform internal.begin_batch();
  update public.offers x
     set note_ar = replace(x.note_ar, c_old_ar, c_new_ar),
         note_en = replace(x.note_en, c_old_en, c_new_en)
   where x.id = o.id
  returning * into o;
  v_check := internal.offer_check(o);
  if jsonb_array_length(v_check -> 'missing') > 0 then
    raise exception 'celebration-packages is not ready: %', v_check -> 'missing';
  end if;
  update public.offers x set live = internal.offer_snapshot(x), published_at = now() where x.id = o.id;
end;
$$;
