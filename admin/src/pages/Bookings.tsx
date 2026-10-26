// Bookings list (DASHBOARD-SPEC §3.5 + decision 6; phase 2a.1): filters (stay and request date through the site's
// picker, past allowed), realtime, details drawer with price breakdown, status history and internal notes; confirm
// (room type pick + per-night checks) and cancel (reason); WhatsApp template; CSV export (Excel-safe). Dates read
// «الأحد 2 نوفمبر 2026»; guests with Arabic agreement. Confirm and cancel send emails and are never undoable (said in
// the drawer). Branch scope locks the branch filter; bookings = view makes everything read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import * as api from '../lib/api';
import type { Reservation, RoomType, StatusHistory, CalendarCell } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, REASON_LABELS, STATUS_LABELS, adultsWord, childrenWord, dateRange, longDate, nightsWord, riyadhDateTimeLong, roomsLeft, sar, toCsv, riyadhToday } from '../lib/format';
import { Confirm, Drawer, Empty, ErrorBox, Field, Loading, Modal, Spinner, useToast } from '../components/ui';
import DateField from '../components/DateField';

type Status = '' | 'request' | 'confirmed' | 'cancelled';

export default function Bookings() {
  const { me } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const locked = me?.branch ?? null;
  const editable = api.canEdit(me, 'bookings');
  const [branch, setBranch] = useState(locked ?? params.get('branch') ?? '');
  const [status, setStatus] = useState<Status>((params.get('status') as Status) ?? '');
  const [coord, setCoord] = useState(params.get('coord') === '1');
  const [kind, setKind] = useState<'' | 'instant' | 'staff' | 'request'>((params.get('kind') as '' | 'instant' | 'staff' | 'request') ?? '');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [stayFrom, setStayFrom] = useState('');
  const [stayTo, setStayTo] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [open, setOpen] = useState<Reservation | null>(null);
  const [branches, setBranches] = useState<api.Branch[]>([]);

  useEffect(() => {
    api.branches().then(setBranches).catch(() => {});
    api.roomTypes().then(setRoomTypes).catch(() => {});
  }, []);

  // search is debounced: one query per pause, not per keystroke
  const timer = useRef(0);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(timer.current);
  }, [search]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await api.reservations({ branch: branch || undefined, status: status || undefined, needsCoordination: coord, confirmation: kind || undefined, search: query, stayFrom: stayFrom || undefined, stayTo: stayTo || undefined, createdFrom: createdFrom || undefined, createdTo: createdTo || undefined });
      setRows(list);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, [branch, status, coord, kind, query, stayFrom, stayTo, createdFrom, createdTo]);

  useEffect(() => {
    load();
    const p = new URLSearchParams();
    if (branch && !locked) p.set('branch', branch);
    if (status) p.set('status', status);
    if (coord) p.set('coord', '1');
    if (kind) p.set('kind', kind);
    setParams(p, { replace: true });
  }, [load, branch, status, coord, kind, locked, setParams]);

  // realtime: a new or changed booking refreshes the list (RLS filters what each user receives)
  useEffect(() => {
    const ch = supabase
      .channel('reservations-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => load())
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [load]);

  const rtName = useCallback((id: string | null) => (id ? roomTypes.find((r) => r.id === id)?.name_ar ?? '—' : 'أي غرفة متاحة'), [roomTypes]);

  const counts = useMemo(() => {
    const c = { request: 0, confirmed: 0, cancelled: 0, coord: 0 };
    for (const r of rows ?? []) {
      c[r.status]++;
      if (r.needs_coordination && r.status !== 'cancelled') c.coord++;
    }
    return c;
  }, [rows]);

  function exportCsv() {
    if (!rows?.length) return;
    const cols = [
      { key: 'ref', label: 'رقم الحجز' }, { key: 'status_ar', label: 'الحالة' }, { key: 'branch_ar', label: 'الفرع' }, { key: 'room', label: 'نوع الغرفة' },
      { key: 'check_in', label: 'الوصول' }, { key: 'check_out', label: 'المغادرة' }, { key: 'nights', label: 'الليالي' }, { key: 'adults', label: 'البالغون' },
      { key: 'children', label: 'الأطفال' }, { key: 'extra_beds', label: 'أسرّة إضافية' }, { key: 'breakfast_ar', label: 'الإفطار' }, { key: 'guest_name', label: 'الاسم' },
      { key: 'phone', label: 'الجوال' }, { key: 'email', label: 'البريد' }, { key: 'total', label: 'الإجمالي' }, { key: 'needs_coordination', label: 'يحتاج تنسيق' },
      { key: 'fallback_ar', label: 'سبب الطلب' }, { key: 'created', label: 'وقت الطلب' }, { key: 'notes', label: 'ملاحظات الضيف' }, { key: 'internal_notes', label: 'ملاحظات داخلية' },
    ];
    const data = rows.map((r) => ({
      ...r,
      status_ar: STATUS_LABELS[r.status],
      branch_ar: BRANCH_NAMES[r.branch] ?? r.branch,
      room: rtName(r.room_type_id),
      breakfast_ar: r.breakfast === 'with' ? 'مع الإفطار' : 'بدون إفطار',
      needs_coordination: r.needs_coordination ? 'نعم' : '',
      fallback_ar: r.fallback_reason ? REASON_LABELS[r.fallback_reason] ?? r.fallback_reason : '',
      created: riyadhDateTimeLong(r.created_at),
    }));
    const blob = new Blob([toCsv(data, cols)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bookings-${riyadhToday()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <h1 className="text-2xl font-bold me-auto">الحجوزات</h1>
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!rows?.length}>تصدير Excel (CSV)</button>
      </div>
      <div className="card p-3 sm:p-4 mb-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Field label="الفرع" id="f-branch">
          <select id="f-branch" className="field" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!!locked}>
            {!locked && <option value="">الفرعان</option>}
            {branches.filter((b) => !locked || b.slug === locked).map((b) => (
              <option key={b.slug} value={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</option>
            ))}
          </select>
        </Field>
        <Field label="الحالة" id="f-status">
          <select id="f-status" className="field" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="">الكل</option>
            <option value="request">طلب</option>
            <option value="confirmed">مؤكد</option>
            <option value="cancelled">ملغي</option>
          </select>
        </Field>
        <Field label="النوع" id="f-kind">
          <select id="f-kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">الكل</option>
            <option value="instant">تأكيد فوري</option>
            <option value="staff">أكّده الفريق</option>
            <option value="request">طلبات</option>
          </select>
        </Field>
        <Field label="بحث" id="f-q" hint="رقم الحجز، الاسم أو الجوال">
          <input id="f-q" className="field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="AR-… / اسم / 05…" />
        </Field>
        <div className="col-span-2">
          <DateField mode="range" label="الإقامة من" endLabel="الإقامة إلى" start={stayFrom} end={stayTo} onChange={(a, b) => { setStayFrom(a); setStayTo(b); }} min="past" id="f-stay" />
        </div>
        <div className="col-span-2">
          <DateField mode="range" label="تاريخ الطلب من" endLabel="تاريخ الطلب إلى" start={createdFrom} end={createdTo} onChange={(a, b) => { setCreatedFrom(a); setCreatedTo(b); }} min="past" id="f-created" />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold col-span-2 md:col-span-1 self-end min-h-11">
          <input type="checkbox" checked={coord} onChange={(e) => setCoord(e.target.checked)} className="size-4 accent-bronze-deep" /> يحتاج تنسيق فقط
        </label>
      </div>
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <span className="chip chip-request">طلبات: <b className="num-ar">{counts.request}</b></span>
        <span className="chip chip-confirmed">مؤكد: <b className="num-ar">{counts.confirmed}</b></span>
        <span className="chip chip-cancelled">ملغي: <b className="num-ar">{counts.cancelled}</b></span>
        {counts.coord > 0 && <span className="chip chip-flag">يحتاج تنسيق: <b className="num-ar">{counts.coord}</b></span>}
      </div>
      <ErrorBox error={error} />
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text="لا حجوزات تطابق الفلتر." />
      ) : (
        <ul className="grid gap-2" data-list="bookings">
          {rows.map((r, i) => (
            <li key={r.id} className="reveal" style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}>
              <button type="button" onClick={() => setOpen(r)} className="card w-full text-start p-3 sm:p-4 hover:border-bronze transition-colors grid grid-cols-[auto_1fr_auto] gap-3 items-center" data-ref={r.ref} data-status={r.status}>
                <span className={`chip chip-${r.status}`}>{STATUS_LABELS[r.status]}</span>
                <span className="min-w-0">
                  <span className="block font-bold truncate">
                    {r.guest_name} <span className="num text-ink-muted font-semibold text-xs">{r.ref}</span>
                    {r.is_test && <span className="chip chip-test ms-2">تجربة</span>}
                  </span>
                  <span className="block text-sm text-ink-muted truncate num-ar">
                    {BRANCH_NAMES[r.branch]} · {rtName(r.room_type_id)} · {dateRange(r.check_in, r.check_out)} · {nightsWord(r.nights)}
                  </span>
                  <span className="flex flex-wrap gap-1 mt-1">
                    {r.needs_coordination && r.status !== 'cancelled' && <span className="chip chip-flag">يحتاج تنسيق</span>}
                    {r.confirmation === 'instant' && <span className="chip chip-request">تأكيد فوري</span>}
                    {r.status === 'request' && r.fallback_reason && <span className="chip chip-request">{REASON_LABELS[r.fallback_reason] ?? r.fallback_reason}</span>}
                    {r.extra_beds > 0 && <span className="chip chip-request num-ar">أسرّة إضافية: {r.extra_beds}</span>}
                  </span>
                </span>
                <span className="text-end">
                  <span className="block font-bold num-ar">{r.total !== null ? sar(r.total) : '—'}</span>
                  <span className="block text-xs text-ink-muted num-ar">{riyadhDateTimeLong(r.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Details r={open} roomTypes={roomTypes} editable={editable} onClose={() => setOpen(null)} onChanged={(msg) => { toast(msg); load(); setOpen(null); }} />
    </div>
  );
}

function Details({ r, roomTypes, editable, onClose, onChanged }: { r: Reservation | null; roomTypes: RoomType[]; editable: boolean; onClose: () => void; onChanged: (msg: string) => void }) {
  const toast = useToast();
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [notes, setNotes] = useState('');
  const savedNotes = useRef('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pickRt, setPickRt] = useState<string>('');
  const [nightIssues, setNightIssues] = useState<{ reason: string; nights: CalendarCell[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!r) return;
    setNotes(r.internal_notes ?? '');
    savedNotes.current = r.internal_notes ?? '';
    setPickRt(r.room_type_id ?? '');
    setNightIssues(null);
    setError(null);
    api.reservationHistory(r.id).then(setHistory).catch(() => setHistory([]));
  }, [r]);

  if (!r) return null;
  const rts = roomTypes.filter((t) => t.branch === r.branch && t.bookable);
  const rtName = (id: string | null) => (id ? roomTypes.find((t) => t.id === id)?.name_ar ?? '—' : 'أي غرفة متاحة');
  const pricing = r.pricing as { nights?: { night: string; price: number; label?: string }[]; breakfast_adult?: number } | null;

  async function doConfirm() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.confirmReservation(r!.id, pickRt || null);
      if (!out.ok) {
        if (out.reason === 'needs_ages') setError('أعمار الأطفال ناقصة: لا يمكن حساب الإفطار. تواصل مع الضيف وسجّل الأعمار في الملاحظات ثم أكّد بدون إفطار أو أضف السعر يدويًا.');
        else setNightIssues({ reason: out.reason ?? '', nights: out.nights ?? [] });
        return;
      }
      setConfirmOpen(false);
      onChanged(`تم تأكيد الحجز ${out.ref}${out.low?.length ? ' — وأُرسل تنبيه المخزون' : ''}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function doCancel() {
    if (reason.trim().length < 3) return setError('اكتب سبب الإلغاء.');
    setBusy(true);
    setError(null);
    try {
      await api.cancelReservation(r!.id, reason.trim());
      setCancelOpen(false);
      onChanged(`أُلغي الحجز ${r!.ref}${r!.status === 'confirmed' ? ' وأُعيدت الغرف إلى المخزون' : ''}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveNotes() {
    if (notes === savedNotes.current) return;
    try {
      await api.saveInternalNotes(r!.id, notes);
      savedNotes.current = notes;
      toast('حُفظت الملاحظات');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  const waTemplate = () => {
    const lines = [
      `السلام عليكم ${r.guest_name}،`,
      r.status === 'confirmed' ? `تم تأكيد حجزك رقم ${r.ref} في ${BRANCH_NAMES[r.branch]}.` : `بخصوص طلب الحجز رقم ${r.ref} في ${BRANCH_NAMES[r.branch]}:`,
      `نوع الغرفة: ${rtName(r.room_type_id)}`,
      `الوصول: ${longDate(r.check_in)} — المغادرة: ${longDate(r.check_out)} (${nightsWord(r.nights)})`,
      r.total !== null ? `الإجمالي شامل الضريبة: ${sar(r.total)} — الدفع عند الوصول.` : '',
      'أرمادا ريزيدنس',
    ].filter(Boolean);
    return `https://wa.me/${r.phone.replace(/\D/g, '')}?text=${encodeURIComponent(lines.join('\n'))}`;
  };

  return (
    <Drawer open={!!r} onClose={onClose} title={<span>{r.guest_name} <span className="num text-sm text-ink-muted">{r.ref}</span></span>}>
      <div className="flex flex-wrap gap-2 mb-4">
        <span className={`chip chip-${r.status}`}>{STATUS_LABELS[r.status]}</span>
        {r.confirmation === 'instant' && <span className="chip chip-request">تأكيد فوري من الموقع</span>}
        {r.needs_coordination && <span className="chip chip-flag">يحتاج تنسيق</span>}
        {r.is_test && <span className="chip chip-test">تجربة</span>}
        {r.status === 'request' && r.fallback_reason && <span className="chip chip-request">{REASON_LABELS[r.fallback_reason] ?? r.fallback_reason}</span>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm mb-5 num-ar">
        <dt className="text-ink-muted">الفرع</dt><dd className="font-semibold">{BRANCH_NAMES[r.branch]}</dd>
        <dt className="text-ink-muted">نوع الغرفة</dt><dd className="font-semibold">{rtName(r.room_type_id)}</dd>
        <dt className="text-ink-muted">الوصول</dt><dd className="font-semibold">{longDate(r.check_in)}</dd>
        <dt className="text-ink-muted">المغادرة</dt><dd className="font-semibold">{longDate(r.check_out)} · {nightsWord(r.nights)}</dd>
        <dt className="text-ink-muted">الضيوف</dt><dd className="font-semibold">{adultsWord(r.adults)}{r.children ? ` · ${childrenWord(r.children)}${r.children_ages?.length ? ` (الأعمار: ${r.children_ages.join('، ')})` : ''}` : ''}{r.capacity_at_request ? <span className="text-ink-muted"> · سعة الغرفة {r.capacity_at_request}</span> : null}</dd>
        <dt className="text-ink-muted">أسرّة إضافية</dt><dd className="font-semibold">{r.extra_beds}{r.extra_bed_fee_per_night ? ` (${sar(r.extra_bed_fee_per_night)} لليلة)` : ''}</dd>
        <dt className="text-ink-muted">الإفطار</dt><dd className="font-semibold">{r.breakfast === 'with' ? 'مع الإفطار' : 'بدون إفطار'}</dd>
        <dt className="text-ink-muted">الجوال</dt><dd className="font-semibold num"><a className="underline" href={`tel:${r.phone}`}>{r.phone}</a></dd>
        <dt className="text-ink-muted">البريد</dt><dd className="font-semibold latin">{r.email ? <a className="underline" href={`mailto:${r.email}`}>{r.email}</a> : '—'}</dd>
        {r.notes && (<><dt className="text-ink-muted">ملاحظات الضيف</dt><dd className="whitespace-pre-wrap">{r.notes}</dd></>)}
        <dt className="text-ink-muted">المصدر</dt><dd>{r.source === 'website' ? 'الموقع' : 'اللوحة'} · {r.locale === 'en' ? 'النسخة الإنجليزية' : 'النسخة العربية'} · {riyadhDateTimeLong(r.created_at)}</dd>
        {r.cancel_reason && (<><dt className="text-ink-muted">سبب الإلغاء</dt><dd>{r.cancel_reason}</dd></>)}
      </dl>

      {r.total !== null && (
        <div className="card p-3 mb-5 bg-soft">
          <h3 className="font-bold text-sm mb-2">تفاصيل السعر</h3>
          <table className="w-full text-sm num-ar">
            <tbody>
              <tr><td>الغرفة · {nightsWord(r.nights)}</td><td className="text-end font-semibold">{sar(r.room_total)}</td></tr>
              {pricing?.nights && new Set(pricing.nights.map((n) => Number(n.price))).size > 1 && pricing.nights.map((n) => (
                <tr key={n.night} className="text-ink-muted"><td className="ps-3">{longDate(n.night)}{n.label ? ` — ${n.label}` : ''}</td><td className="text-end">{sar(n.price)}</td></tr>
              ))}
              {r.breakfast === 'with' && <tr><td>الإفطار</td><td className="text-end font-semibold">{sar(r.breakfast_total)}</td></tr>}
              {r.extra_beds > 0 && <tr><td>الأسرّة الإضافية · {r.extra_beds}</td><td className="text-end font-semibold">{sar(r.extra_beds_total)}</td></tr>}
              <tr className="border-t border-line"><td className="pt-1 font-bold">الإجمالي شامل الضريبة</td><td className="pt-1 text-end font-bold">{sar(r.total)}</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-ink-muted mt-2">الدفع عند الوصول إلى الفندق.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-1">
        {editable && r.status === 'request' && <button type="button" className="btn btn-primary" onClick={() => setConfirmOpen(true)} data-action="confirm">تأكيد الحجز</button>}
        {editable && r.status !== 'cancelled' && <button type="button" className="btn btn-danger" onClick={() => setCancelOpen(true)} data-action="cancel">إلغاء الحجز</button>}
        <a className="btn btn-ghost" href={waTemplate()} target="_blank" rel="noopener">واتساب الضيف</a>
      </div>
      {editable && r.status !== 'cancelled' && <p className="text-xs text-ink-muted mb-5">التأكيد والإلغاء يرسلان بريدًا للضيف والاستقبال، لذلك لا يمكن التراجع عنهما.</p>}
      {!editable && <p className="text-xs text-ink-muted mb-5">صلاحيتك هنا للعرض فقط.</p>}

      <Field label="ملاحظات داخلية" id="internal-notes" hint="لا يراها الضيف.">
        <textarea id="internal-notes" className="field min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} disabled={!editable} />
      </Field>

      <h3 className="font-bold text-sm mt-5 mb-2">سجل الحالة</h3>
      <ol className="text-sm grid gap-1 num-ar">
        {history.map((h) => (
          <li key={h.id} className="flex flex-wrap gap-x-2 text-ink-muted">
            <span>{riyadhDateTimeLong(h.at)}</span>
            <span className="text-ink font-semibold">{h.from_status ? `${STATUS_LABELS[h.from_status]} ← ` : ''}{STATUS_LABELS[h.to_status]}</span>
            <span>· {h.actor_label === 'website' ? 'الموقع' : h.actor_label}</span>
            {h.note && <span>· {REASON_LABELS[h.note] ?? h.note}</span>}
          </li>
        ))}
      </ol>

      <Modal open={confirmOpen} onClose={() => { setConfirmOpen(false); setNightIssues(null); setError(null); }} title="تأكيد الحجز">
        <p className="text-sm text-ink-muted mb-3">يُخصم من مخزون كل ليلة ويُرسل التأكيد للضيف (إن كان له بريد) وإشعار للاستقبال. لا يمكن التراجع بعد الإرسال.</p>
        <Field label="نوع الغرفة" id="confirm-rt">
          <select id="confirm-rt" className="field" value={pickRt} onChange={(e) => { setPickRt(e.target.value); setNightIssues(null); }}>
            <option value="">— اختر —</option>
            {rts.map((t) => <option key={t.id} value={t.id}>{t.name_ar}</option>)}
          </select>
        </Field>
        {nightIssues && (
          <div className="mt-3 rounded border border-error/40 bg-error/10 p-3 text-sm">
            <p className="font-bold text-error mb-1">{REASON_LABELS[nightIssues.reason] ?? nightIssues.reason} — تحقق من الليالي:</p>
            <ul className="grid gap-0.5 num-ar">
              {nightIssues.nights.map((n) => (
                <li key={n.night} className="flex justify-between"><span>{longDate(n.night)}</span><span>{n.price === null ? 'بلا سعر' : sar(n.price)} · {!n.has_row || n.stop_sell ? 'مغلقة' : roomsLeft(n.rooms_to_sell)}</span></li>
              ))}
            </ul>
            <p className="mt-2 text-ink-muted">افتح تقويم الأسعار / المخزون، صحّح الليالي، ثم أعد التأكيد.</p>
          </div>
        )}
        <ErrorBox error={error} />
        <div className="flex gap-2 justify-end mt-5">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>رجوع</button>
          <button type="button" className="btn btn-primary" onClick={doConfirm} disabled={busy || !pickRt} data-action="confirm-go">{busy && <Spinner />} تأكيد</button>
        </div>
      </Modal>

      <Confirm open={cancelOpen} onClose={() => { setCancelOpen(false); setError(null); }} title="إلغاء الحجز" confirmLabel="إلغاء الحجز" danger onConfirm={doCancel} busy={busy}
        body={r.status === 'confirmed' ? 'سيُعاد المخزون لكل ليلة ويُرسل للضيف بريد الإلغاء إن كان له بريد. لا يمكن التراجع بعد الإرسال.' : 'سيُغلق الطلب. لا يمكن التراجع.'}>
        <Field label="السبب (إلزامي)" id="cancel-reason">
          <input id="cancel-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
      </Confirm>
    </Drawer>
  );
}
