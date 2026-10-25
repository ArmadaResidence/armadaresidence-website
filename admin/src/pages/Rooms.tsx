// Room availability on the website (phase 2a.1, item 5): every active room type of each branch — the accessible rooms
// included — with the toggle «متاحة للحجز على الموقع» (room_types.bookable). Off = hidden from the booking form at
// once (site_room_types RPC) and the room page stays «غير متاح حاليًا»; on = bookable like the others and the page
// follows the normal indexing rules after the site rebuild the toggle asks for. Each toggle is one audited batch → a
// 30 s «تراجع» toast. Capacity, extra beds and the base rate are shown for context (names and sizes stay in rooms.json).
import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import type { Branch, RoomType } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, sar } from '../lib/format';
import { ErrorBox, Loading, useToast } from '../components/ui';

export default function Rooms() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'rooms');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [types, setTypes] = useState<RoomType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const [b, t] = await Promise.all([api.branches(), api.roomTypes()]);
      setBranches(b);
      setTypes(t);
    } catch (e) {
      setError((e as Error).message);
      setTypes([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  async function toggle(rt: RoomType, on: boolean) {
    setBusy(rt.id);
    try {
      const r = await api.setRoomBookable(rt.id, on);
      toast.undo(`${rt.name_ar} — ${on ? 'متاحة للحجز على الموقع' : 'غير متاحة على الموقع'}`, async () => {
        await api.revertBatch(r.batch_id);
        await load();
        api.siteRebuild('rooms');
      });
      await load();
      const rb = await api.siteRebuild('rooms');
      setNote(rb.ok && rb.dispatched
        ? 'نموذج الحجز يتبع التغيير فورًا؛ صفحة الغرفة (الظهور في البحث وزر الحجز) بعد إعادة بناء الموقع التي طُلبت الآن (دقائق).'
        : rb.ok ? 'نموذج الحجز يتبع التغيير فورًا؛ إعادة بناء الموقع قيد التنفيذ من طلب سابق.' : 'نموذج الحجز يتبع التغيير فورًا؛ صفحة الغرفة تتغير عند إعادة البناء التالية للموقع.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">الغرف</h1>
        <p className="text-sm text-ink-muted mt-1">«متاحة للحجز على الموقع» تعرض نوع الغرفة في نموذج الحجز وتسمح بحجزه. الغرفة غير المتاحة تبقى صفحتها على الموقع بعلامة «غير متاح حاليًا» بلا زر حجز، وتظهر هنا وفي الأسعار والمخزون لتجهيزها قبل تشغيلها.{editable ? '' : ' صلاحيتك هنا للعرض فقط.'}</p>
        {note && <p className="text-xs text-ink-muted mt-2" role="status">{note}</p>}
      </div>
      <ErrorBox error={error} />
      {types === null ? (
        <Loading />
      ) : (
        branches.map((b) => {
          const rows = types.filter((t) => t.branch === b.slug);
          if (!rows.length) return null;
          return (
            <section key={b.slug} className="card p-4" aria-labelledby={`rooms-${b.slug}`}>
              <h2 id={`rooms-${b.slug}`} className="font-bold text-lg mb-3">{BRANCH_NAMES[b.slug] ?? b.name_ar}</h2>
              <ul className="grid gap-2">
                {rows.map((rt) => (
                  <li key={rt.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line last:border-0 py-2" data-room={`${rt.branch}/${rt.slug}`}>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{rt.name_ar} <span className="latin text-xs text-ink-muted" dir="ltr">{rt.name_en}</span></div>
                      <div className="text-xs text-ink-muted num-ar">السعة {rt.capacity}{rt.extra_beds_max ? ` · أسرّة إضافية حتى ${rt.extra_beds_max}` : ' · بلا أسرّة إضافية'} · السعر الأساسي {rt.base_rate === null ? 'بلا سعر' : sar(rt.base_rate)}</div>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
                      <span className={rt.bookable ? 'text-ok' : 'text-ink-muted'}>{rt.bookable ? 'متاحة للحجز على الموقع' : 'غير متاحة على الموقع'}</span>
                      <input type="checkbox" role="switch" className="size-5 accent-bronze-deep" checked={rt.bookable} disabled={!editable || busy === rt.id} aria-checked={rt.bookable} data-bookable={`${rt.branch}/${rt.slug}`} onChange={(e) => toggle(rt, e.target.checked)} />
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
