// «طلبات الشركاء» — partner enquiries (Ahmed, 3 Nov 2026; DASHBOARD-SPEC.md §3.6; DECISIONS.md 2026-11-03 «Partner
// enquiries…»). Every enquiry of /partners/enquiry/ from 3 Nov 2026 on:
//   - the list with filters (type, status, branch, the request date, the owner) and the CSV export (edit; audited);
//   - the details drawer: the contact (quick WhatsApp / email / call links — the first one used is the enquiry's first
//     contact time), the request, the status, the owner, notes, quote PDFs (≤ 10 MB, judged by their bytes on the server)
//     and the timeline. Level view reads everything; edit changes it. The live badge of the sidebar counts «جديد».
// Personal fields are removed 24 months after the last activity (a monthly job); such an enquiry shows its statistics only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { countWord, riyadhDateTime, riyadhToday, shortDate, toCsv, nightsWord, daysBetween, type CountNoun } from '../lib/format';
import {
  addNote, assign, attach, BRANCH_LABEL, detach, enquiries, enquiryEvents, eventText, exportRows, fileUrl, logContact, MAX_PDF, MEAL_LABEL, owners,
  setStatus, STATUS, STATUS_LABEL, TYPE_LABEL, type Enquiry, type EnquiryEvent, type EnquiryFilter, type EnquiryStatus,
} from '../lib/partners';
import { CancelButton, Drawer, Empty, ErrorBox, Field, Loading, Spinner, useToast } from '../components/ui';
import DateField from '../components/DateField';

const ENQUIRY: CountNoun = { zero: 'لا طلبات', one: 'طلب واحد', two: 'طلبان', few: 'طلبات', many: 'طلبًا', gen: 'طلب' };

export default function Partners() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'partners');
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [people, setPeople] = useState<{ user_id: string; full_name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  // ?status=new / ?ref=AR-… (the overview's «طلبات الشركاء» card and alerts, 4 Nov 2026)
  const [params] = useSearchParams();
  const [f, setF] = useState<EnquiryFilter>(() => (STATUS.some((x) => x.key === params.get('status')) ? { status: params.get('status')! } : {}));
  const [open, setOpen] = useState<Enquiry | null>(null);
  const wanted = useRef(params.get('ref'));
  useEffect(() => {
    if (!wanted.current || !rows) return;
    const r = rows.find((x) => x.ref === wanted.current);
    if (r) setOpen(r);
    wanted.current = null;
  }, [rows]);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await enquiries(f));
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, [f]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    owners().then(setPeople).catch(() => setPeople([]));
  }, []);
  const name = useMemo(() => new Map(people.map((p) => [p.user_id, p.full_name])), [people]);

  async function exportCsv() {
    setExporting(true);
    try {
      const data = (await exportRows(f)).map((r) => ({
        ...r,
        type_ar: TYPE_LABEL[r.request_type] ?? r.request_type,
        status_ar: STATUS_LABEL[r.status],
        branch_ar: BRANCH_LABEL[r.branch] ?? r.branch,
        owner_ar: r.owner ? name.get(r.owner) ?? '' : '',
        meals_ar: r.meals ? MEAL_LABEL[r.meals] ?? r.meals : '',
        created: riyadhDateTime(r.created_at),
        first_contact: r.first_contact_at ? riyadhDateTime(r.first_contact_at) : '',
      }));
      const cols = [
        { key: 'ref', label: 'رقم الطلب' }, { key: 'created', label: 'وقت الطلب' }, { key: 'type_ar', label: 'النوع' }, { key: 'status_ar', label: 'الحالة' },
        { key: 'branch_ar', label: 'الفرع' }, { key: 'organisation', label: 'الجهة' }, { key: 'contact_name', label: 'الاسم' }, { key: 'phone', label: 'الجوال' },
        { key: 'email', label: 'البريد' }, { key: 'check_in', label: 'الوصول' }, { key: 'check_out', label: 'المغادرة' }, { key: 'guests', label: 'الضيوف' },
        { key: 'rooms', label: 'الغرف' }, { key: 'meals_ar', label: 'الوجبات' }, { key: 'owner_ar', label: 'المسؤول' }, { key: 'first_contact', label: 'أول تواصل' },
        { key: 'message', label: 'الرسالة' },
      ];
      const blob = new Blob([toCsv(data, cols)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `partner-enquiries-${riyadhToday()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`صُدّر ${countWord(data.length, ENQUIRY)}؛ سُجّل التصدير في السجل.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  }

  const set = (k: keyof EnquiryFilter, v: string) => setF((x) => ({ ...x, [k]: v || undefined }));
  if (rows === null) return <Loading />;
  return (
    <div className="grid gap-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">طلبات الشركاء</h1>
          <p className="text-sm text-ink-muted mt-1">
            طلبات نموذج الشركاء والوكالات (المجموعات، العمرة، الشركات، القاعة) منذ 3 نوفمبر 2026. تابع كل طلب: الحالة، المسؤول، الملاحظات، وملف عرض السعر.
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : ''}
          </p>
        </div>
        {editable && (
          <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={exporting || !rows.length} data-action="partners-export">
            {exporting && <Spinner />} تصدير Excel (CSV)
          </button>
        )}
      </div>

      <div className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-partners-filters>
        <Field label="النوع" id="pf-type">
          <select id="pf-type" className="field" value={f.type ?? ''} onChange={(e) => set('type', e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="الحالة" id="pf-status">
          <select id="pf-status" className="field" value={f.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">الكل</option>
            {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="الفرع" id="pf-branch">
          <select id="pf-branch" className="field" value={f.branch ?? ''} onChange={(e) => set('branch', e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(BRANCH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="المسؤول" id="pf-owner">
          <select id="pf-owner" className="field" value={f.owner ?? ''} onChange={(e) => set('owner', e.target.value)}>
            <option value="">الكل</option>
            <option value="none">بلا مسؤول</option>
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <DateField mode="range" label="تاريخ الطلب من" endLabel="تاريخ الطلب إلى" start={f.from ?? ''} end={f.to ?? ''} onChange={(a, b) => setF((x) => ({ ...x, from: a || undefined, to: b || undefined }))} min="past" id="pf-created" />
        </div>
      </div>

      <ErrorBox error={error} />
      <p className="text-sm text-ink-muted" data-partners-count>{countWord(rows.length, ENQUIRY)}</p>
      {!rows.length ? (
        <Empty text="لا طلبات تطابق التصفية." />
      ) : (
        <ul className="grid gap-2" data-list="partners">
          {rows.map((r) => {
            const st = STATUS.find((s) => s.key === r.status)!;
            return (
              <li key={r.id}>
                <button type="button" className="card w-full text-start p-3 grid gap-1 hover:border-bronze" onClick={() => setOpen(r)} data-enquiry={r.ref} data-enquiry-status={r.status}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`chip ${st.chip}`}>{st.label}</span>
                    <strong>{r.organisation ?? (r.scrubbed_at ? 'حُذفت البيانات الشخصية' : '—')}</strong>
                    <span className="text-sm text-ink-muted">{TYPE_LABEL[r.request_type]}</span>
                    {r.is_test && <span className="chip chip-test">اختبار</span>}
                  </span>
                  <span className="text-sm text-ink-muted flex flex-wrap gap-x-3">
                    <span className="latin num" dir="ltr">{r.ref}</span>
                    <span className="num">{riyadhDateTime(r.created_at)}</span>
                    <span>{BRANCH_LABEL[r.branch]}</span>
                    {r.check_in && r.check_out && <span className="num">{shortDate(r.check_in)} ← {shortDate(r.check_out)}</span>}
                    <span>{r.owner ? `المسؤول: ${name.get(r.owner) ?? '—'}` : 'بلا مسؤول'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${open.organisation ?? 'طلب شراكة'} — ${open.ref}` : ''}>
        {open && <EnquiryDetails key={open.id} e={open} people={people} editable={editable} onChanged={async () => { await load(); }} />}
      </Drawer>
    </div>
  );
}

function EnquiryDetails({ e: initial, people, editable, onChanged }: { e: Enquiry; people: { user_id: string; full_name: string }[]; editable: boolean; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [e, setE] = useState(initial);
  const [events, setEvents] = useState<EnquiryEvent[] | null>(null);
  const [status, setStatusV] = useState<EnquiryStatus>(initial.status);
  const [owner, setOwner] = useState(initial.owner ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // a successful save re-baselines the drawer's dirty guard (the saved values are the new clean state)
  const [version, setVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrubbed = !!e.scrubbed_at;
  const dis = !editable || scrubbed || !!busy;

  const reload = useCallback(async () => {
    setEvents(await enquiryEvents(e.id).catch(() => []));
  }, [e.id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    try {
      await fn();
      toast(done);
      await Promise.all([reload(), onChanged()]);
      const fresh = (await enquiries({}, 300)).find((x) => x.id === e.id);
      if (fresh) setE(fresh);
      setVersion((v) => v + 1);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function quick(channel: 'whatsapp' | 'email' | 'phone') {
    if (!editable || scrubbed) return;
    try {
      await logContact(e.id, channel);
      await reload();
      if (!e.first_contact_at) setE({ ...e, first_contact_at: new Date().toISOString() });
    } catch { /* the link opens anyway */ }
  }
  async function upload(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_PDF) {
      setFileError('الملف أكبر من 10 ميغابايت.');
      return;
    }
    await run('file', () => attach(e.id, file), 'أُرفق ملف عرض السعر.');
  }
  async function openFile(path: string) {
    try {
      window.open(await fileUrl(path), '_blank', 'noopener');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const nights = e.check_in && e.check_out ? daysBetween(e.check_in, e.check_out) : 0;
  const files = (events ?? []).filter((x) => x.kind === 'attachment' && x.file_path && !x.removed_at && x.to_value !== 'removed');
  const wa = e.phone ? `https://wa.me/${e.phone.replace(/\D/g, '')}` : null;
  return (
    <div className="grid gap-5" data-enquiry-details={e.ref} data-dirty-version={version}>
      {scrubbed && <p className="note-amber text-sm" role="status">حُذفت البيانات الشخصية لهذا الطلب بعد 24 شهرًا من آخر تواصل؛ بقي النوع والفرع والتواريخ والحالة للإحصاءات.</p>}
      <section aria-labelledby="pe-contact" className="grid gap-2">
        <h3 id="pe-contact" className="font-bold">التواصل</h3>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-muted">الجهة</dt><dd>{e.organisation ?? '—'}</dd>
          <dt className="text-ink-muted">الاسم</dt><dd>{e.contact_name ?? '—'}</dd>
          <dt className="text-ink-muted">الجوال</dt><dd className="latin num" dir="ltr">{e.phone ?? '—'}</dd>
          <dt className="text-ink-muted">البريد</dt><dd className="latin" dir="ltr">{e.email ?? '—'}</dd>
          <dt className="text-ink-muted">أول تواصل</dt><dd className="num" data-first-contact>{e.first_contact_at ? riyadhDateTime(e.first_contact_at) : 'لم يُسجَّل بعد'}</dd>
        </dl>
        {!scrubbed && (
          <div className="flex flex-wrap gap-2">
            {wa && <a className="btn btn-ghost btn-sm" href={wa} target="_blank" rel="noreferrer" onClick={() => void quick('whatsapp')} data-action="enquiry-whatsapp">واتساب</a>}
            {e.email && <a className="btn btn-ghost btn-sm" href={`mailto:${e.email}?subject=${encodeURIComponent(`أرمادا ريزيدنس — ${e.ref}`)}`} onClick={() => void quick('email')} data-action="enquiry-email">بريد</a>}
            {e.phone && <a className="btn btn-ghost btn-sm" href={`tel:${e.phone}`} onClick={() => void quick('phone')} data-action="enquiry-call">اتصال</a>}
          </div>
        )}
      </section>

      <section aria-labelledby="pe-request" className="grid gap-2">
        <h3 id="pe-request" className="font-bold">الطلب</h3>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-muted">النوع</dt><dd>{TYPE_LABEL[e.request_type]}</dd>
          <dt className="text-ink-muted">الفرع</dt><dd>{BRANCH_LABEL[e.branch]}</dd>
          <dt className="text-ink-muted">التواريخ</dt><dd className="num">{e.check_in && e.check_out ? `${shortDate(e.check_in)} ← ${shortDate(e.check_out)} · ${nightsWord(nights)}` : '—'}</dd>
          <dt className="text-ink-muted">الضيوف</dt><dd className="num">{e.guests ?? '—'}</dd>
          <dt className="text-ink-muted">الغرف</dt><dd className="num">{e.rooms ?? '—'}</dd>
          <dt className="text-ink-muted">الوجبات</dt><dd>{e.meals ? MEAL_LABEL[e.meals] ?? e.meals : '—'}</dd>
          <dt className="text-ink-muted">وقت الطلب</dt><dd className="num">{riyadhDateTime(e.created_at)}</dd>
          <dt className="text-ink-muted">لغة النموذج</dt><dd>{e.locale === 'en' ? 'الإنجليزية' : 'العربية'}</dd>
        </dl>
        {e.message && <p className="text-sm whitespace-pre-wrap bg-soft rounded p-3" data-enquiry-message>{e.message}</p>}
      </section>

      <section aria-labelledby="pe-follow" className="grid gap-3">
        <h3 id="pe-follow" className="font-bold">المتابعة</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Field label="الحالة" id="pe-status">
              <select id="pe-status" className="field" value={status} disabled={dis} onChange={(x) => setStatusV(x.target.value as EnquiryStatus)}>
                {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            {editable && !scrubbed && (
              <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={dis || status === e.status} onClick={() => run('status', () => setStatus(e.id, status), `الحالة الآن: ${STATUS_LABEL[status]}.`)} data-action="enquiry-status">
                {busy === 'status' && <Spinner />} حفظ الحالة
              </button>
            )}
          </div>
          <div className="grid gap-1.5">
            <Field label="المسؤول" id="pe-owner">
              <select id="pe-owner" className="field" value={owner} disabled={dis} onChange={(x) => setOwner(x.target.value)}>
                <option value="">بلا مسؤول</option>
                {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}
              </select>
            </Field>
            {editable && !scrubbed && (
              <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={dis || owner === (e.owner ?? '')} onClick={() => run('owner', () => assign(e.id, owner || null), owner ? 'عُيّن المسؤول.' : 'أُزيل المسؤول.')} data-action="enquiry-assign">
                {busy === 'owner' && <Spinner />} حفظ المسؤول
              </button>
            )}
          </div>
        </div>
        {editable && !scrubbed && (
          <div className="grid gap-1.5">
            <Field label="ملاحظة جديدة" id="pe-note" hint="تظهر في سجل الطلب مع اسمك ووقتها.">
              <textarea id="pe-note" className="field" rows={3} maxLength={2000} value={note} disabled={dis} onChange={(x) => setNote(x.target.value)} />
            </Field>
            <button type="button" className="btn btn-ghost btn-sm justify-self-start" disabled={dis || !note.trim()} onClick={() => run('note', async () => { await addNote(e.id, note); setNote(''); }, 'أُضيفت الملاحظة.')} data-action="enquiry-note">
              {busy === 'note' && <Spinner />} إضافة الملاحظة
            </button>
          </div>
        )}
      </section>

      <section aria-labelledby="pe-files" className="grid gap-2">
        <h3 id="pe-files" className="font-bold">عرض السعر</h3>
        {!files.length && <p className="text-sm text-ink-muted">لا ملفات مرفقة.</p>}
        <ul className="grid gap-1.5">
          {files.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 text-sm" data-enquiry-file={x.file_name ?? ''}>
              <button type="button" className="text-accent-text underline" onClick={() => openFile(x.file_path!)} data-action="file-open">{x.file_name}</button>
              <span className="text-ink-muted num">{x.file_size ? `${Math.max(1, Math.round(x.file_size / 1024))} ك.ب` : ''} · {riyadhDateTime(x.at)}</span>
              {editable && !scrubbed && <button type="button" className="btn btn-ghost btn-sm" disabled={dis} onClick={() => run('detach', () => detach(x.id), 'أُزيل الملف.')} data-action="file-remove">إزالة الملف</button>}
            </li>
          ))}
        </ul>
        {editable && !scrubbed && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn btn-ghost btn-sm cursor-pointer">
              {busy === 'file' ? <Spinner /> : null} إرفاق ملف PDF
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={dis} data-no-dirty data-enquiry-file-input
                onChange={(x) => { void upload(x.target.files?.[0]); x.target.value = ''; }} />
            </label>
            <span className="text-xs text-ink-muted">ملف PDF واحد حتى 10 ميغابايت.</span>
          </div>
        )}
        {fileError && <p className="text-sm media-err" role="alert" data-file-error>{fileError}</p>}
      </section>

      <section aria-labelledby="pe-timeline" className="grid gap-2">
        <h3 id="pe-timeline" className="font-bold">السجل</h3>
        {events === null ? <Loading /> : (
          <ol className="grid gap-1.5 text-sm" data-enquiry-timeline>
            {events.map((x) => (
              <li key={x.id} className="border-s-2 border-line ps-3" data-event={x.kind}>
                <span className="num text-ink-muted">{riyadhDateTime(x.at)}</span>{x.actor_label && <span className="text-ink-muted"> · {x.actor_label === 'website' ? 'الموقع' : x.actor_label}</span>}
                <p className="whitespace-pre-wrap">{eventText(x)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="flex justify-end">
        <CancelButton label="إغلاق" disabled={!!busy} />
      </div>
    </div>
  );
}
