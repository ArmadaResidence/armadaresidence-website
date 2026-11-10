// «الغرف» — the room types of each branch (10 Nov 2026, DECISIONS.md 2026-11-10 «Room types from the dashboard»; earlier:
// the availability toggle of phase 2a.1, «في الصفحة الرئيسية» of 7 Nov 2026, the site's last deploy of 6 Nov 2026).
//   - «إضافة نوع غرفة» per branch and «تعديل» per type: the shared Modal (its dirty guard; × / «إلغاء» only) with the
//     Arabic and English name, category, size, bed, capacity, extra beds, base rate, physical units, features,
//     equipment and both descriptions. The page address (slug) is made once from the English name and never changes —
//     a rename changes the name only.
//   - «إظهار على الموقع» / «إخفاء من الموقع»: a type is shown only when complete (both names and descriptions, the base
//     rate, the unit count and a published cover in «الصور») — otherwise a dialog lists what is missing. A new type
//     starts hidden and not bookable.
//   - ▲ / ▼ the order inside the branch; «حذف» only for a type that never had a booking (any other is hidden instead,
//     and the dialog says why).
//   - The physical unit count: the branch total the site shows is the sum over the shown types once each has one; the
//     units open on the website (inventory) never exceed it (server: a trigger on inventory_days).
//   - Every change is one audited batch with the 30 s «تراجع» toast and «استرجاع هذا التغيير» in «السجل», and asks
//     for the site rebuild (site-rebuild reason rooms) like the two toggles.
// The server decides every rule (public.room_type_save …); this page words them (lib/rooms.ts).
import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import SiteDeployStatus from '../components/SiteDeployStatus';
import { useSiteDeploy } from '../lib/siteDeploy';
import { barShowsDeploy, roomsNote, type RebuildAsk } from '../lib/siteDeployText';
import type { Branch } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, sar } from '../lib/format';
import { AMENITIES, CATEGORIES, FEATURES, ROOM_MAX, blankRoom, branchUnits, missingText, notReady, pickRoom, roomLocalProblems, roomPayload, roomProblemText, roomProblems, type RoomFields, type RoomProblem, type RoomTypeAdmin } from '../lib/rooms';
import { CancelButton, Confirm, ErrorBox, Field, Loading, Modal, Spinner, useToast } from '../components/ui';

type Editing = { kind: 'new'; branch: string } | { kind: 'edit'; room: RoomTypeAdmin } | null;

export default function Rooms() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'rooms');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [types, setTypes] = useState<RoomTypeAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [missing, setMissing] = useState<{ room: RoomTypeAdmin; codes: string[] } | null>(null);
  const [removing, setRemoving] = useState<RoomTypeAdmin | null>(null);
  const [change, setChange] = useState<{ at: number; ask: RebuildAsk } | null>(null);
  const deploy = useSiteDeploy();
  const note = change ? roomsNote(change.ask, deploy.data, change.at) : null;

  const load = async () => {
    try {
      setError(null);
      const [b, t] = await Promise.all([api.branches(), api.roomTypesAdmin()]);
      setBranches(b);
      setTypes(t.filter((x) => !x.is_test));
    } catch (e) {
      setError((e as Error).message);
      setTypes([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  /** after a saved change: reload, ask for the site rebuild, offer «تراجع» */
  async function after(batch: string, label: string) {
    toast.undo(label, async () => {
      await api.revertBatch(batch);
      const back = Date.now();
      await load();
      const rbBack = await api.siteRebuild('rooms');
      setChange({ at: back, ask: rbBack.ok && rbBack.dispatched ? 'dispatched' : rbBack.ok ? 'busy' : 'not_requested' });
    });
    const at = Date.now();
    await load();
    const rb = await api.siteRebuild('rooms');
    setChange({ at, ask: rb.ok && rb.dispatched ? 'dispatched' : rb.ok ? 'busy' : 'not_requested' });
  }

  async function act(id: string, fn: () => Promise<{ batch_id: string }>, label: string) {
    setBusy(id);
    try {
      const r = await fn();
      await after(r.batch_id, label);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(rt: RoomTypeAdmin, on: boolean, what: 'bookable' | 'home') {
    const label = what === 'home' ? (on ? 'تظهر في الصفحة الرئيسية' : 'لا تظهر في الصفحة الرئيسية') : on ? 'متاحة للحجز على الموقع' : 'غير متاحة على الموقع';
    await act(rt.id, () => (what === 'home' ? api.setRoomHome(rt.id, on) : api.setRoomBookable(rt.id, on)), `${rt.name_ar} — ${label}`);
  }

  async function setOnSite(rt: RoomTypeAdmin, on: boolean) {
    if (on && rt.missing.length) {
      setMissing({ room: rt, codes: rt.missing });
      return;
    }
    setBusy(rt.id);
    try {
      const r = await api.roomTypeSetOnSite(rt.id, on);
      await after(r.batch_id, `${rt.name_ar} — ${on ? 'ظاهر على الموقع' : 'مخفي من الموقع'}`);
    } catch (e) {
      const codes = notReady(e);
      if (codes) setMissing({ room: rt, codes });
      else toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function move(rows: RoomTypeAdmin[], i: number, d: -1 | 1) {
    const ids = rows.map((r) => r.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    await act(rows[i].id, () => api.roomTypesReorder(rows[i].branch, ids), `ترتيب أنواع الغرف — ${BRANCH_NAMES[rows[i].branch] ?? rows[i].branch}`);
  }

  async function remove() {
    const rt = removing;
    if (!rt) return;
    setFormBusy(true);
    try {
      const r = await api.roomTypeDelete(rt.id);
      setRemoving(null);
      await after(r.batch_id, `حُذف نوع الغرفة «${rt.name_ar}»`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <div className="grid gap-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">الغرف</h1>
        <p className="text-sm text-ink-muted mt-1">
          أنواع الغرف في كل فرع: أضف نوعًا جديدًا أو عدّل بياناته، وأظهره على الموقع أو أخفِه، ورتّبها. رابط صفحة النوع يُصنع مرة واحدة من الاسم الإنجليزي ولا يتغير بتغيير الاسم. «متاحة للحجز على الموقع» تعرض النوع الظاهر في نموذج الحجز وتسمح بحجزه، و«في الصفحة الرئيسية» تعرضه في قسم «الغرف والأجنحة». كل تغيير يصل إلى الموقع بعد تحديثه.{editable ? '' : ' صلاحيتك هنا للعرض فقط.'}
        </p>
        {/* once only (6 Nov 2026): while the update bar shows the site's state, the page leaves its own line out */}
        {!barShowsDeploy(deploy.data, deploy.requestedAt, deploy.now, me?.role === 'admin') && <p className="mt-2" data-rooms-deploy><SiteDeployStatus /></p>}
        {note && <p className={`text-sm mt-2 font-semibold ${note.tone === 'error' ? 'text-error' : note.tone === 'ok' ? 'text-ok' : 'text-ink-muted'}`} role="status" data-rooms-note={note.tone}>{note.text}</p>}
      </div>
      <ErrorBox error={error} />
      {types === null ? (
        <Loading />
      ) : (
        branches.filter((b) => types.some((t) => t.branch === b.slug) || (editable && api.canBranch(me, b.slug))).map((b) => {
          const rows = types.filter((t) => t.branch === b.slug);
          const u = branchUnits(rows);
          return (
            <section key={b.slug} className="card p-4" aria-labelledby={`rooms-${b.slug}`} data-rooms-branch={b.slug}>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <h2 id={`rooms-${b.slug}`} className="font-bold text-lg">{BRANCH_NAMES[b.slug] ?? b.name_ar}</h2>
                  <p className="text-xs text-ink-muted num-ar" data-units-total={b.slug} data-tour="room-units">
                    {u.complete
                      ? `إجمالي الوحدات الفعلية للأنواع الظاهرة: ${u.sum} — وهو العدد الذي يعرضه الموقع لهذا الفرع.`
                      : `إجمالي ما أُدخل للأنواع الظاهرة: ${u.sum}. ينقص عدد الوحدات في ${u.missing} من الأنواع الظاهرة، فيبقى الإجمالي على الموقع كما هو حتى يُدخل عدد كل نوع ظاهر.`}
                  </p>
                </div>
                {editable && (
                  <button type="button" className="btn btn-primary" onClick={() => setEditing({ kind: 'new', branch: b.slug })} data-action="room-add" data-tour="room-add">
                    إضافة نوع غرفة
                  </button>
                )}
              </div>
              <ul className="grid gap-2">
                {rows.map((rt, i) => (
                  <li key={rt.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto] items-center gap-3 border-b border-line last:border-0 py-2" data-room={`${rt.branch}/${rt.slug}`} data-tour="room-row">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {rt.name_ar} <span className="latin text-xs text-ink-muted" dir="ltr">{rt.name_en}</span>
                        <span className={`ms-2 text-xs font-semibold ${rt.on_site ? 'text-ok' : 'text-ink-muted'}`} data-on-site={rt.on_site ? 'yes' : 'no'}>{rt.on_site ? (rt.visible ? 'ظاهر على الموقع' : 'مخفي في «المحتوى والظهور»') : 'مخفي من الموقع'}</span>
                      </div>
                      <div className="text-xs text-ink-muted num-ar">
                        السعة {rt.capacity}{rt.extra_beds_max ? ` · أسرّة إضافية حتى ${rt.extra_beds_max}` : ' · بلا أسرّة إضافية'} · السعر الأساسي {rt.base_rate === null ? 'بلا سعر' : sar(rt.base_rate)} · الوحدات الفعلية {rt.units ?? 'لم تُدخل'}
                      </div>
                      <div className="text-xs text-ink-muted"><span>رابط الصفحة: </span><span className="latin" dir="ltr" data-room-slug>/{rt.branch}/{rt.slug}/</span></div>
                      {!rt.on_site && rt.missing.length > 0 && <div className="text-xs text-error mt-1" data-room-missing>ينقصه للظهور: {rt.missing.map(missingText).join('، ')}</div>}
                    </div>
                    <div className="grid gap-1 justify-items-end">
                      <div className="flex flex-wrap items-center justify-end gap-x-5">
                        <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
                          <span className={rt.show_home ? 'text-ink' : 'text-ink-muted'}>في الصفحة الرئيسية</span>
                          <input type="checkbox" role="switch" className="size-5 accent-bronze-deep" checked={rt.show_home} disabled={!editable || busy === rt.id} aria-checked={rt.show_home} aria-label={`${rt.name_ar}: في الصفحة الرئيسية`} data-home={`${rt.branch}/${rt.slug}`} onChange={(e) => toggle(rt, e.target.checked, 'home')} />
                        </label>
                        <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
                          <span className={rt.bookable ? 'text-ok' : 'text-ink-muted'}>{rt.bookable ? 'متاحة للحجز على الموقع' : 'غير متاحة على الموقع'}</span>
                          <input type="checkbox" role="switch" className="size-5 accent-bronze-deep" checked={rt.bookable} disabled={!editable || busy === rt.id} aria-checked={rt.bookable} aria-label={`${rt.name_ar}: متاحة للحجز على الموقع`} data-bookable={`${rt.branch}/${rt.slug}`} onChange={(e) => toggle(rt, e.target.checked, 'bookable')} />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ kind: 'edit', room: rt })} data-action="room-edit" data-tour="room-edit" aria-label={`${editable ? 'تعديل' : 'عرض'} ${rt.name_ar}`}>{editable ? 'تعديل' : 'عرض'}</button>
                        {editable && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={busy === rt.id} onClick={() => setOnSite(rt, !rt.on_site)} data-action={rt.on_site ? 'room-hide' : 'room-show'} data-tour="room-visibility">
                              {rt.on_site ? 'إخفاء من الموقع' : 'إظهار على الموقع'}
                            </button>
                            <span className="inline-flex" data-tour="room-order">
                              <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0 || busy !== null} onClick={() => move(rows, i, -1)} aria-label={`تحريك ${rt.name_ar} لأعلى`} data-action="room-up">▲</button>
                              <button type="button" className="btn btn-ghost btn-sm" disabled={i === rows.length - 1 || busy !== null} onClick={() => move(rows, i, 1)} aria-label={`تحريك ${rt.name_ar} لأسفل`} data-action="room-down">▼</button>
                            </span>
                            <button type="button" className="btn btn-ghost btn-sm text-error" disabled={busy === rt.id} onClick={() => setRemoving(rt)} data-action="room-delete" data-tour="room-delete">حذف النوع</button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
                {!rows.length && <li className="text-sm text-ink-muted py-2">لا توجد أنواع غرف في هذا الفرع بعد.</li>}
              </ul>
            </section>
          );
        })
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.kind === 'new' ? `إضافة نوع غرفة — ${BRANCH_NAMES[editing.branch] ?? editing.branch}` : editing ? (editable ? `تعديل ${editing.room.name_ar}` : editing.room.name_ar) : ''}
        draftKey={editing ? (editing.kind === 'new' ? `room:new:${editing.branch}` : `room:${editing.room.id}`) : undefined}
        wide
        busy={formBusy}
      >
        {editing !== null && (
          <RoomForm
            key={editing.kind === 'new' ? `new-${editing.branch}` : editing.room.id}
            room={editing.kind === 'edit' ? editing.room : null}
            branch={editing.kind === 'new' ? editing.branch : editing.room.branch}
            editable={editable}
            canRates={api.canEdit(me, 'rates')}
            busy={formBusy}
            setBusy={setFormBusy}
            onSaved={async (batch, label) => {
              setEditing(null);
              await after(batch, label);
            }}
          />
        )}
      </Modal>

      <Modal open={!!missing} onClose={() => setMissing(null)} title="لا يظهر على الموقع بعد">
        {missing && (
          <div className="grid gap-3" data-room-missing-dialog>
            <p className="text-sm">لا يظهر «{missing.room.name_ar}» على الموقع قبل أن تكتمل صفحته. ينقصه:</p>
            <ul className="list-disc ps-5 text-sm">
              {missing.codes.map((c) => <li key={c} data-missing={c}>{missingText(c)}</li>)}
            </ul>
            <p className="text-xs text-ink-muted">الصورة تُرفع وتُنشر من «الصور» ← نوع الغرفة نفسه. بعد استكمال الباقي من «تعديل» اضغط «إظهار على الموقع» مرة أخرى.</p>
            <div className="flex justify-end">
              <CancelButton label="إغلاق" />
            </div>
          </div>
        )}
      </Modal>

      {removing && removing.booked ? (
        <Confirm
          open
          title="لا يُحذف هذا النوع"
          body={`لـ«${removing.name_ar}» حجوزات سابقة، ونوع الغرفة الذي له حجز لا يُحذف أبدًا حتى تبقى الحجوزات القديمة وأسماؤها وتقاريرها كما هي. ${removing.on_site ? 'يمكنك إخفاؤه من الموقع بدلًا من ذلك: تختفي صفحته ولا يظهر في نموذج الحجز.' : 'هو مخفي من الموقع بالفعل.'}`}
          confirmLabel={removing.on_site ? 'إخفاء من الموقع' : 'حسنًا'}
          busy={formBusy}
          onConfirm={async () => {
            const rt = removing;
            setRemoving(null);
            if (rt.on_site) await setOnSite(rt, false);
          }}
          onClose={() => setRemoving(null)}
        />
      ) : (
        <Confirm
          open={!!removing}
          title="حذف نوع الغرفة"
          body={removing ? `يُحذف «${removing.name_ar}» من ${BRANCH_NAMES[removing.branch] ?? removing.branch} مع أسعاره الاستثنائية ومخزونه. لم يُحجز هذا النوع من قبل. ${removing.on_site ? 'صفحته على الموقع تختفي بعد التحديث.' : ''} يمكن استرجاعه خلال 30 ثانية من «تراجع» أو لاحقًا من «السجل».` : ''}
          confirmLabel="حذف نوع الغرفة"
          danger
          busy={formBusy}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function RoomForm({ room, branch, editable, canRates, busy, setBusy, onSaved }: { room: RoomTypeAdmin | null; branch: string; editable: boolean; canRates: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: (batch: string, label: string) => Promise<void> }) {
  const [f, setF] = useState<RoomFields>(() => (room ? pickRoom(room) : blankRoom()));
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<RoomProblem[]>([]);
  const [tried, setTried] = useState(false);
  const dis = !editable || busy;
  const set = <K extends keyof RoomFields>(k: K, v: RoomFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleKey = (k: 'features' | 'amenities', key: string, on: boolean) => setF((x) => ({ ...x, [k]: on ? [...x[k], key] : x[k].filter((y) => y !== key) }));
  const local = useMemo(() => roomLocalProblems(f), [f]);
  const problems = tried ? [...local, ...server.filter((s) => !local.some((l) => l.field === s.field && l.code === s.code))] : server;
  const rateLocked = !canRates && !!room;

  async function save() {
    setTried(true);
    setError(null);
    setServer([]);
    if (local.length) return;
    setBusy(true);
    try {
      const r = await api.roomTypeSave(room?.id ?? null, roomPayload(f, room ? undefined : branch));
      setBusy(false);
      await onSaved(r.batch_id, room ? `حُفظ «${f.name_ar.trim()}»` : `أُضيف «${f.name_ar.trim()}» (مخفي من الموقع حتى تُظهره)`);
    } catch (e) {
      const list = roomProblems(e);
      if (list.length) setServer(list);
      else setError((e as Error).message);
      setBusy(false);
    }
  }

  const input = (k: keyof RoomFields, label: string, opts: { latin?: boolean; num?: boolean; hint?: string; max?: number; disabled?: boolean } = {}) => (
    <Field label={label} id={`room-${k}`} hint={opts.hint}>
      <input
        id={`room-${k}`}
        className={`field ${opts.latin || opts.num ? 'latin' : ''}`}
        dir={opts.latin || opts.num ? 'ltr' : 'rtl'}
        inputMode={opts.num ? 'decimal' : undefined}
        value={f[k] as string}
        maxLength={opts.max}
        onChange={(e) => set(k, e.target.value as never)}
        disabled={dis || opts.disabled}
        autoComplete="off"
        data-field={k}
      />
    </Field>
  );

  return (
    <div className="grid gap-4" data-room-form>
      {room && (
        <p className="text-xs text-ink-muted">
          رابط الصفحة ثابت: <span className="latin" dir="ltr">/{room.branch}/{room.slug}/</span> — تغيير الاسم يغيّر ما يظهر فقط، لا الرابط.
        </p>
      )}
      {!room && <p className="text-xs text-ink-muted">يُصنع رابط الصفحة من الاسم الإنجليزي عند الحفظ ولا يتغير بعدها. يبدأ النوع الجديد مخفيًا من الموقع وغير متاح للحجز.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {input('name_ar', 'الاسم بالعربية', { max: ROOM_MAX.name })}
        {input('name_en', 'الاسم بالإنجليزية', { latin: true, max: ROOM_MAX.name })}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="الفئة" id="room-category">
          <select id="room-category" className="field" value={f.category} onChange={(e) => set('category', e.target.value as RoomFields['category'])} disabled={dis} data-field="category">
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        {input('size_m2', 'المساحة (م²)', { num: true })}
        {input('units', 'عدد الوحدات الفعلي', { num: true, hint: room && room.max_inventory ? `لا يقل عن ${room.max_inventory} (المعروض على الموقع في ليلة قادمة).` : 'عدد الغرف من هذا النوع في الفرع.' })}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {input('bed_ar', 'السرير بالعربية', { max: ROOM_MAX.bed })}
        {input('bed_en', 'السرير بالإنجليزية', { latin: true, max: ROOM_MAX.bed })}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {input('capacity', 'السعة (بالغون)', { num: true })}
        {input('extra_beds_max', 'أقصى عدد للأسرّة الإضافية (0–2)', { num: true })}
        {input('base_rate', 'السعر الأساسي لليلة (ريال، شامل الضريبة)', { num: true, disabled: rateLocked, hint: rateLocked ? 'تعديل السعر يحتاج صلاحية «الأسعار».' : undefined })}
      </div>
      <fieldset className="grid gap-2">
        <legend className="label">المزايا</legend>
        <div className="flex flex-wrap gap-x-5">
          {FEATURES.map((x) => (
            <label key={x.key} className="flex items-center gap-2 text-sm min-h-11">
              <input type="checkbox" className="size-4 accent-bronze-deep" checked={f.features.includes(x.key)} disabled={dis} onChange={(e) => toggleKey('features', x.key, e.target.checked)} data-feature={x.key} />
              {x.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="label">التجهيزات داخل الغرفة</legend>
        <div className="flex flex-wrap gap-x-5">
          {AMENITIES.map((x) => (
            <label key={x.key} className="flex items-center gap-2 text-sm min-h-11">
              <input type="checkbox" className="size-4 accent-bronze-deep" checked={f.amenities.includes(x.key)} disabled={dis} onChange={(e) => toggleKey('amenities', x.key, e.target.checked)} data-amenity={x.key} />
              {x.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="الوصف بالعربية" id="room-description_ar" hint="فقرة أو فقرتان؛ سطر فارغ بين الفقرتين. بلا أسعار أو أرقام هواتف.">
        <textarea id="room-description_ar" className="field min-h-32" dir="rtl" value={f.description_ar} maxLength={ROOM_MAX.description} onChange={(e) => set('description_ar', e.target.value)} disabled={dis} data-field="description_ar" />
      </Field>
      <Field label="الوصف بالإنجليزية" id="room-description_en">
        <textarea id="room-description_en" className="field min-h-32 latin" dir="ltr" lang="en" value={f.description_en} maxLength={ROOM_MAX.description} onChange={(e) => set('description_en', e.target.value)} disabled={dis} data-field="description_en" />
      </Field>
      {problems.length > 0 && (
        <div className="note-amber text-sm" role="alert" data-room-problems>
          <p className="font-semibold">لم يُحفظ — صحّح ما يلي:</p>
          <ul className="list-disc ps-5">
            {problems.map((p, i) => <li key={i}>{roomProblemText(p)}</li>)}
          </ul>
        </div>
      )}
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="room-save">
            {busy && <Spinner />} {room ? 'حفظ' : 'إضافة'}
          </button>
        )}
      </div>
    </div>
  );
}
