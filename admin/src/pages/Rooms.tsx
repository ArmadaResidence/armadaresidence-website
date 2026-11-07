// Room availability on the website (phase 2a.1, item 5): every active room type of each branch — the accessible rooms
// included — with the toggle «متاحة للحجز على الموقع» (room_types.bookable). Off = hidden from the booking form at
// once (site_room_types RPC) and the room page stays «غير متاح حاليًا»; on = bookable like the others and the page
// follows the normal indexing rules after the site rebuild the toggle asks for. Each toggle is one audited batch → a
// 30 s «تراجع» toast. Capacity, extra beds and the base rate are shown for context (names and sizes stay in rooms.json).
// 6 Nov 2026 (the toggle «لا بيقفل ولا بيفتح» — every save had stood; every site build had failed since the evening of
// 5 Nov): the page shows the website's last deploy (نجح / جارٍ / فشل + the time, components/SiteDeployStatus.tsx), and the
// line after a change follows that deploy — saved and waiting, now on the room pages, or saved but NOT on the site
// because the update failed (lib/siteDeployText.ts → roomsNote).
// 7 Nov 2026: «في الصفحة الرئيسية» per room type — the home page's «الغرف والأجنحة» shows the room types switched on here
// that are also bookable on the site; one audited batch, the same «تراجع» toast and site rebuild as the availability.
import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import SiteDeployStatus from '../components/SiteDeployStatus';
import { useSiteDeploy } from '../lib/siteDeploy';
import { barShowsDeploy, roomsNote, type RebuildAsk } from '../lib/siteDeployText';
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
  const [change, setChange] = useState<{ at: number; ask: RebuildAsk } | null>(null);
  const deploy = useSiteDeploy();
  const note = change ? roomsNote(change.ask, deploy.data, change.at) : null;

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

  async function toggle(rt: RoomType, on: boolean, what: 'bookable' | 'home' = 'bookable') {
    setBusy(rt.id);
    try {
      const r = what === 'home' ? await api.setRoomHome(rt.id, on) : await api.setRoomBookable(rt.id, on);
      const label = what === 'home' ? (on ? 'تظهر في الصفحة الرئيسية' : 'لا تظهر في الصفحة الرئيسية') : on ? 'متاحة للحجز على الموقع' : 'غير متاحة على الموقع';
      toast.undo(`${rt.name_ar} — ${label}`, async () => {
        await api.revertBatch(r.batch_id);
        const back = Date.now();
        await load();
        const rbBack = await api.siteRebuild('rooms');
        setChange({ at: back, ask: rbBack.ok && rbBack.dispatched ? 'dispatched' : rbBack.ok ? 'busy' : 'not_requested' });
      });
      const at = Date.now();
      await load();
      const rb = await api.siteRebuild('rooms');
      setChange({ at, ask: rb.ok && rb.dispatched ? 'dispatched' : rb.ok ? 'busy' : 'not_requested' });
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
        <p className="text-sm text-ink-muted mt-1">«متاحة للحجز على الموقع» تعرض نوع الغرفة في نموذج الحجز وتسمح بحجزه. الغرفة غير المتاحة تبقى صفحتها على الموقع بعلامة «غير متاح حاليًا» بلا زر حجز، وتظهر هنا وفي الأسعار والمخزون لتجهيزها قبل تشغيلها. «في الصفحة الرئيسية» تعرض الغرفة في قسم «الغرف والأجنحة» بالصفحة الرئيسية ما دامت متاحة للحجز على الموقع.{editable ? '' : ' صلاحيتك هنا للعرض فقط.'}</p>
        {/* once only (6 Nov 2026): while the update bar shows the site's state, the page leaves its own line out */}
        {!barShowsDeploy(deploy.data, deploy.requestedAt, deploy.now) && <p className="mt-2" data-rooms-deploy><SiteDeployStatus /></p>}
        {note && <p className={`text-sm mt-2 font-semibold ${note.tone === 'error' ? 'text-error' : note.tone === 'ok' ? 'text-ok' : 'text-ink-muted'}`} role="status" data-rooms-note={note.tone}>{note.text}</p>}
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
                    <div className="flex flex-wrap items-center justify-end gap-x-5">
                      <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
                        <span className={rt.show_home ? 'text-ink' : 'text-ink-muted'}>في الصفحة الرئيسية</span>
                        <input type="checkbox" role="switch" className="size-5 accent-bronze-deep" checked={rt.show_home} disabled={!editable || busy === rt.id} aria-checked={rt.show_home} aria-label={`${rt.name_ar}: في الصفحة الرئيسية`} data-home={`${rt.branch}/${rt.slug}`} onChange={(e) => toggle(rt, e.target.checked, 'home')} />
                      </label>
                      <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
                        <span className={rt.bookable ? 'text-ok' : 'text-ink-muted'}>{rt.bookable ? 'متاحة للحجز على الموقع' : 'غير متاحة على الموقع'}</span>
                        <input type="checkbox" role="switch" className="size-5 accent-bronze-deep" checked={rt.bookable} disabled={!editable || busy === rt.id} aria-checked={rt.bookable} data-bookable={`${rt.branch}/${rt.slug}`} onChange={(e) => toggle(rt, e.target.checked)} />
                      </label>
                    </div>
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
