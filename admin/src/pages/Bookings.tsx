// Bookings list (DASHBOARD-SPEC §3.5 + decision 6; phase 2a.1): filters (stay and request date through the site's
// picker, past allowed), realtime, details drawer with price breakdown, status history and internal notes; confirm
// (room type pick + per-night checks) and cancel (reason); WhatsApp template; CSV export (Excel-safe). Dates read
// «الأحد 2 نوفمبر 2026»; guests with Arabic agreement. Confirm and cancel send emails and are never undoable (said in
// the drawer). Branch scope locks the branch filter; bookings = view makes everything read-only.
// Task 5 (28 Oct 2026): the drawer lists each WhatsApp message sent to the guest («أُرسلت» / «تعذّر الإرسال» + the
// reason in Arabic) with «إعادة الإرسال» on a failed one (bookings: edit; the RPC checks the branch scope again), and
// «طباعة» prints one A4 sheet of the stored booking with the two signature blocks (PrintSheet, print-only CSS).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import * as api from '../lib/api';
import type { Reservation, RoomType, StatusHistory, CalendarCell, WhatsAppMessage } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_FULL, BRANCH_NAMES, NOTIFY_FAILED, REASON_LABELS, STATUS_LABELS, WA_STATUS_LABELS, WA_TEMPLATE_LABELS, adultsWord, childrenWord, dateRange, longDate, nightsWord, riyadhDateTimeLong, roomsLeft, sar, toCsv, riyadhToday, waError } from '../lib/format';
import { BranchSelect, CancelButton, Confirm, Drawer, Empty, ErrorBox, Field, Loading, Modal, Spinner, useToast } from '../components/ui';
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
        <BranchSelect id="f-branch" branches={branches} value={branch} onChange={setBranch} allLabel="الفرعان" />
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
      {/* keyed by the booking: every open starts from the saved values (decision B — reopening shows the saved values) */}
      <Details key={open?.id ?? 'none'} r={open} roomTypes={roomTypes} editable={editable} onClose={() => setOpen(null)} onChanged={(msg, kind) => { toast(msg, kind); load(); setOpen(null); }} />
    </div>
  );
}

function Details({ r, roomTypes, editable, onClose, onChanged }: { r: Reservation | null; roomTypes: RoomType[]; editable: boolean; onClose: () => void; onChanged: (msg: string, kind?: 'ok' | 'error') => void }) {
  const toast = useToast();
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [notes, setNotes] = useState(r?.internal_notes ?? '');
  const savedNotes = useRef(r?.internal_notes ?? '');
  const [notesVersion, setNotesVersion] = useState(r?.internal_notes ?? '');
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pickRt, setPickRt] = useState<string>(r?.room_type_id ?? '');
  const [nightIssues, setNightIssues] = useState<{ reason: string; nights: CalendarCell[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wa, setWa] = useState<WhatsAppMessage[] | null>(null);
  const [waBusy, setWaBusy] = useState<string | null>(null);
  const [waFail, setWaFail] = useState<string | null>(null);
  const loadWa = useCallback(() => {
    if (r) api.whatsappMessages(r.id).then(setWa).catch(() => setWa([]));
  }, [r]);

  useEffect(() => {
    if (!r) return;
    loadWa();
    setNotes(r.internal_notes ?? '');
    savedNotes.current = r.internal_notes ?? '';
    setNotesVersion(r.internal_notes ?? '');
    setPickRt(r.room_type_id ?? '');
    setNightIssues(null);
    setError(null);
    api.reservationHistory(r.id).then(setHistory).catch(() => setHistory([]));
  }, [r, loadWa]);

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
      // the booking is confirmed either way; a notification that did not go out is never silent
      if (out.notify_failed) onChanged(NOTIFY_FAILED.confirm, 'error');
      else onChanged(`تم تأكيد الحجز ${out.ref}${out.low?.length ? ' — وأُرسل تنبيه المخزون' : ''}`);
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
      const out = await api.cancelReservation(r!.id, reason.trim());
      setCancelOpen(false);
      if (out.notify_failed) return onChanged(NOTIFY_FAILED.cancel, 'error');
      onChanged(`أُلغي الحجز ${r!.ref}${r!.status === 'confirmed' ? ' وأُعيدت الغرف إلى المخزون' : ''}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // 28 Oct 2026 (decision B): the notes save with their own button, never on blur — a blur-save fought the unsaved
  // guard (the confirm itself moved the focus and saved what the user meant to discard)
  async function saveNotes() {
    if (notes === savedNotes.current) return;
    setNotesBusy(true);
    setNotesError(null);
    try {
      await api.saveInternalNotes(r!.id, notes);
      savedNotes.current = notes;
      setNotesVersion(notes);
      toast('حُفظت الملاحظات');
    } catch (e) {
      setNotesError((e as Error).message);
    } finally {
      setNotesBusy(false);
    }
  }
  async function resendWa(template: string) {
    setWaBusy(template);
    setWaFail(null);
    try {
      const out = await api.resendWhatsApp(r!.id, template);
      if (!out.ok) setWaFail(out.reason === 'already_sent' ? 'أُرسلت هذه الرسالة من قبل.' : out.reason === 'status' ? 'تغيّرت حالة الحجز؛ هذه الرسالة لم تعد مناسبة.' : 'لا توجد محاولة فاشلة لإعادتها.');
      else if (out.whatsapp?.accepted) toast(out.whatsapp.status === 'test' ? 'بُنيت الرسالة (حجز تجريبي، لم تُرسل)' : 'أُرسلت رسالة واتساب للضيف');
      else setWaFail(`تعذّر الإرسال مرة أخرى: ${waError(out.whatsapp?.error_code)}`);
    } catch (e) {
      setWaFail((e as Error).message);
    } finally {
      setWaBusy(null);
      loadWa();
    }
  }
  // the latest attempt per template, in the order the guest receives them
  const waLatest = (['booking_request_received', 'booking_confirmed', 'booking_cancelled'] as const)
    .map((t) => ({ t, list: (wa ?? []).filter((m) => m.template === t) }))
    .filter((x) => x.list.length)
    .map((x) => ({ ...x.list[x.list.length - 1], attempts: x.list.length }));
  // each template only while the booking is in its status (public.staff_whatsapp_resend checks the same)
  const WA_STATUS_OF = { booking_request_received: 'request', booking_confirmed: 'confirmed', booking_cancelled: 'cancelled' } as const;
  const waResendable = (m: WhatsAppMessage) => editable && m.status === 'failed' && r.status === WA_STATUS_OF[m.template];
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
    <Drawer open={!!r} onClose={onClose} title={<span>{r.guest_name} <span className="num text-sm text-ink-muted">{r.ref}</span></span>} busy={busy || notesBusy}>
      <div className="flex flex-wrap gap-2 mb-4" data-dirty-version={notesVersion}>
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
        {editable && r.status === 'request' && <button type="button" className="btn btn-primary" onClick={() => { setPickRt(r.room_type_id ?? ''); setNightIssues(null); setError(null); setConfirmOpen(true); }} data-action="confirm">تأكيد الحجز</button>}
        {editable && r.status !== 'cancelled' && <button type="button" className="btn btn-danger" onClick={() => { setReason(''); setError(null); setCancelOpen(true); }} data-action="cancel">إلغاء الحجز</button>}
        <a className="btn btn-ghost" href={waTemplate()} target="_blank" rel="noopener">واتساب الضيف</a>
        <button type="button" className="btn btn-ghost" onClick={() => window.print()} data-action="print">طباعة</button>
      </div>
      {editable && r.status !== 'cancelled' && <p className="text-xs text-ink-muted mb-5">التأكيد والإلغاء يرسلان بريدًا للضيف والاستقبال، لذلك لا يمكن التراجع عنهما.</p>}
      {!editable && <p className="text-xs text-ink-muted mb-5">صلاحيتك هنا للعرض فقط.</p>}

      <section className="card p-3 mb-5" data-wa-section>
        <h3 className="font-bold text-sm mb-2">رسائل واتساب للضيف</h3>
        {wa === null ? (
          <p className="text-sm text-ink-muted">جارٍ التحميل…</p>
        ) : waLatest.length === 0 ? (
          <p className="text-sm text-ink-muted">لم تُرسل رسائل واتساب تلقائية لهذا الحجز.</p>
        ) : (
          <ul className="grid gap-2 text-sm num-ar">
            {waLatest.map((m) => (
              <li key={m.template} className="grid gap-1" data-wa={m.template} data-wa-status={m.status}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{WA_TEMPLATE_LABELS[m.template]}</span>
                  <span className={`chip ${m.status === 'failed' ? 'chip-cancelled' : m.status === 'test' ? 'chip-test' : m.status === 'pending' ? 'chip-request' : 'chip-confirmed'}`}>{WA_STATUS_LABELS[m.status] ?? m.status}</span>
                  <span className="text-xs text-ink-muted">{riyadhDateTimeLong(m.created_at)}{m.attempts > 1 ? ` · المحاولة ${m.attempts}` : ''}</span>
                </span>
                {m.status === 'failed' && <span className="text-ink-muted" data-wa-reason>{waError(m.error_code)}</span>}
                {waResendable(m) && (
                  <span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => resendWa(m.template)} disabled={waBusy !== null} data-action="wa-resend">{waBusy === m.template && <Spinner />} إعادة الإرسال</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorBox error={waFail} />
      </section>

      <Field label="ملاحظات داخلية" id="internal-notes" hint="لا يراها الضيف.">
        <textarea id="internal-notes" className="field min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
      </Field>
      {editable && (
        <div className="flex items-center gap-2 mt-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={saveNotes} disabled={notesBusy || notes === savedNotes.current} data-action="save-notes">{notesBusy && <Spinner />} حفظ الملاحظات</button>
        </div>
      )}
      <ErrorBox error={notesError} />

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

      <Modal open={confirmOpen} onClose={() => { setConfirmOpen(false); setNightIssues(null); setError(null); }} title="تأكيد الحجز" busy={busy}>
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
          <CancelButton label="رجوع" disabled={busy} />
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
      {createPortal(<PrintSheet r={r} room={rtName(r.room_type_id)} />, document.body)}
    </Drawer>
  );
}

/** «طباعة» (task 5 C): one A4 sheet of the STORED booking — logo, branch, ref, status, booking date, the guest's
 * fields, the price breakdown, the notes, the coordination flag and two signature blocks. Hidden on screen; the print
 * stylesheet (styles.css → .print-sheet) shows it alone. Arabic, RTL, Western digits (format.ts). */
function PrintSheet({ r, room }: { r: Reservation; room: string }) {
  const pricing = r.pricing as { nights?: { night: string; price: number }[] } | null;
  const perNight = pricing?.nights && new Set(pricing.nights.map((n) => Number(n.price))).size > 1 ? pricing.nights : [];
  const row = (k: string, v: ReactNode) => (<><dt>{k}</dt><dd>{v}</dd></>);
  const sign = (title: string) => (
    <div className="sheet-sign" data-sign={title}>
      <h3>{title}</h3>
      <p><span>الاسم</span><i /></p>
      <p><span>التوقيع</span><i /></p>
      <p><span>التاريخ</span><i /></p>
    </div>
  );
  return (
    <div className="print-sheet" dir="rtl" lang="ar" aria-hidden="true" data-print-sheet>
      <header className="sheet-head">
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" />
        <div>
          <p className="sheet-branch">{BRANCH_FULL[r.branch] ?? r.branch}</p>
          <p className="sheet-ref">رقم الحجز <b dir="ltr">{r.ref}</b></p>
        </div>
      </header>
      <p className="sheet-meta">
        <span>الحالة: <b>{STATUS_LABELS[r.status]}{r.confirmation === 'instant' ? ' (تأكيد فوري من الموقع)' : ''}</b></span>
        <span>تاريخ الحجز: <b>{riyadhDateTimeLong(r.created_at)}</b></span>
        {r.is_test && <span><b>حجز تجريبي</b></span>}
      </p>
      <dl className="sheet-fields">
        {row('اسم الضيف', r.guest_name)}
        {row('الجوال', <span dir="ltr">{r.phone}</span>)}
        {row('البريد الإلكتروني', r.email ? <span dir="ltr">{r.email}</span> : '—')}
        {row('الوصول', longDate(r.check_in))}
        {row('المغادرة', `${longDate(r.check_out)} · ${nightsWord(r.nights)}`)}
        {row('نوع الغرفة', room)}
        {row('الضيوف', `${adultsWord(r.adults)}${r.children ? ` · ${childrenWord(r.children)}${r.children_ages?.length ? ` (الأعمار: ${r.children_ages.join('، ')})` : ''}` : ''}`)}
        {row('أسرّة إضافية', `${r.extra_beds}${r.extra_beds && r.extra_bed_fee_per_night ? ` (${sar(r.extra_bed_fee_per_night)} لليلة)` : ''}`)}
        {row('الإفطار', r.breakfast === 'with' ? 'مع الإفطار' : 'بدون إفطار')}
        {row('يحتاج تنسيق', r.needs_coordination ? 'نعم — عدد الضيوف أكبر من سعة الغرفة والأسرّة الإضافية' : 'لا')}
      </dl>
      <section className="sheet-price">
        <h2>تفاصيل السعر</h2>
        {r.total === null ? (
          <p>لم يُحسب السعر بعد (يُحسب عند التأكيد).</p>
        ) : (
          <>
            <table>
              <tbody>
                <tr><td>الغرفة · {nightsWord(r.nights)}</td><td>{sar(r.room_total)}</td></tr>
                {r.breakfast === 'with' && <tr><td>الإفطار</td><td>{sar(r.breakfast_total)}</td></tr>}
                {r.extra_beds > 0 && <tr><td>الأسرّة الإضافية · {r.extra_beds}</td><td>{sar(r.extra_beds_total)}</td></tr>}
                <tr className="sheet-total"><td>الإجمالي شامل الضريبة</td><td>{sar(r.total)}</td></tr>
              </tbody>
            </table>
            {perNight.length > 0 && (
              <ul className="sheet-nights">
                {perNight.map((n) => <li key={n.night}>{longDate(n.night)}: {sar(n.price)}</li>)}
              </ul>
            )}
            <p className="sheet-note">الدفع عند الوصول إلى الفندق.</p>
          </>
        )}
      </section>
      <section className="sheet-notes">
        <h2>ملاحظات الضيف</h2>
        <p>{r.notes || '—'}</p>
      </section>
      <div className="sheet-signs">
        {sign('توقيع الضيف')}
        {sign('توقيع موظف الاستقبال')}
      </div>
    </div>
  );
}
