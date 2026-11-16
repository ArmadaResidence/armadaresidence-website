// «قائمة المغادرين» (Guest Hub H9, 16 Nov 2026 — DECISIONS.md 2026-11-16 «Guest Hub H9: departures, departure check,
// reviews, shared limit»). Each evening reception uploads Nazeel's «تقرير الحجوزات» (المغادرة-غدا) for one branch: the
// uploader picks the branch and confirms the departure date with the site's date picker (default tomorrow — never the date
// printed in the file). The file is read here, in the browser, by its headers («رقم الجوال»، «العميل» — the first word —،
// «رقم الحجز»; never «الرصيد»، «الوحدات»، «الحالة»), then previewed — kept and skipped, with the reasons and first names only —
// and saved; the file itself is never sent or stored. Per guest until sending time: «استبعاد» and «تمديد» (each with
// «تراجع»). The page shows, per guest, the departure check (scheduled at 09:30, sent, delivered), the answer («خروج» /
// «تمديد» / «لم يرد») and the review request; while a branch's switches are off it shows what WOULD be sent and when (a dry
// run). departures: view to read, edit to upload and mark; branch scope. The switches are the system admin's, in «الفريق
// والتقارير».
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { addDays, BRANCH_NAMES, countWord, longDate, riyadhToday, type CountNoun } from '../lib/format';
import * as D from '../lib/departures';
import { ANSWER_AR, CODE_AR, SKIP_AR, STATE_AR } from '../../../supabase/functions/_shared/hub/departures';
import type { Parsed } from '../../../supabase/functions/_shared/hub/departures';
import DateField from '../components/DateField';
import { BranchSelect, CancelButton, Empty, ErrorBox, Loading, Modal, Spinner, useToast } from '../components/ui';

const GUEST: CountNoun = { zero: 'لا ضيوف', one: 'ضيف واحد', two: 'ضيفان', few: 'ضيوف', many: 'ضيفًا', gen: 'ضيف' };
const SENT = new Set(['accepted', 'sent', 'delivered', 'read']);

/** a send's line: what happened, or what will happen and when (the dry run while the switch is off) */
export function sendText(s: D.Send, kind: 'check' | 'review'): string {
  const when = kind === 'check' ? s.planned : s.due;
  const at = when ? `${D.timeText(when)}${kind === 'review' && when ? ` (${longDate(new Date(when).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }))})` : ''}` : '';
  const code = s.code ? CODE_AR[s.code] ?? '' : '';
  if (s.state === 'none') return '—';
  if (s.state === 'scheduled') return s.switch ? `مجدولة ${at}` : `تجربة: كانت ستُرسل ${at} — المفتاح متوقف`;
  if (s.state === 'dry_run') return `تجربة بدون إرسال — كانت ستُرسل ${D.timeText(s.at)}`;
  if (s.state === 'queued' || s.state === 'pending') return s.deferred ? 'مؤجلة بسبب حد الإرسال المشترك' : 'في الطريق';
  if (SENT.has(s.state)) return `${STATE_AR[s.state]} ${D.timeText(s.at)}`.trim();
  return [STATE_AR[s.state] ?? s.state, code].filter(Boolean).join(' — ');
}
export function answerText(r: D.DepRow): string {
  if (r.answer) return `${ANSWER_AR[r.answer]}${r.answer_via === 'staff' ? ' (من الاستقبال)' : ''}`;
  return SENT.has(r.check.state) ? ANSWER_AR.none : '—';
}

export default function Departures() {
  const { me } = useSession();
  const toast = useToast();
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [branch, setBranch] = useState(me?.branch ?? 'airport-road');
  const [date, setDate] = useState(() => addDays(riyadhToday(), 1));
  const [data, setData] = useState<D.DepList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [prev, setPrev] = useState<D.Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = api.canEdit(me, 'departures');

  useEffect(() => {
    api.branches().then((b) => setBranches(b.filter((x) => x.slug === 'airport-road' || x.slug === 'shafa-road'))).catch(() => setBranches([]));
  }, []);
  const load = useCallback(async () => {
    try {
      setData(await D.list(branch, date));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [branch, date]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const onFile = async (f: File | null | undefined) => {
    if (!f) return;
    setReading(true);
    try {
      const p = await D.readFile(f);
      if (!p.ok) {
        toast(D.READ_ERRORS[p.error ?? 'not_xlsx'], 'error');
        return;
      }
      setParsed(p);
      setPrev(await D.preview(branch, date, p));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const closePreview = () => {
    setPrev(null);
    setParsed(null);
  };
  const onSave = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      const r = await D.save(branch, date, parsed);
      closePreview();
      const c = r.counts;
      toast(`حُفظت قائمة ${BRANCH_NAMES[branch]} ليوم ${longDate(date)}: ${countWord(c.kept, GUEST)}${c.moved ? `، منهم ${countWord(c.moved, GUEST)} مدّدوا من قائمة سابقة` : ''}${c.removed ? `، وحُذف ${countWord(c.removed, GUEST)} لم يعودوا في القائمة` : ''}.`);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (r: D.DepRow, kind: 'exclude' | 'extend', on: boolean) => {
    setBusyRow(r.id);
    try {
      if (kind === 'exclude') await D.exclude(r.id, on);
      else await D.markExtend(r.id, on);
      await load();
      const text = kind === 'exclude'
        ? on ? `استُبعد ${r.first_name}: لن تصله رسالة الخروج ولا طلب التقييم.` : `أُعيد ${r.first_name} إلى القائمة.`
        : on ? `عُلّم ${r.first_name} «تمديد»: لن يصله طلب التقييم لهذه الإقامة.` : `أُزيل «تمديد» عن ${r.first_name}.`;
      toast.undo(text, async () => {
        if (kind === 'exclude') await D.exclude(r.id, !on);
        else await D.markExtend(r.id, !on);
        await load();
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyRow(null);
    }
  };

  const rows = data?.rows ?? [];
  const sum = (f: (r: D.DepRow) => boolean) => rows.filter(f).length;
  return (
    <div className="grid gap-5 max-w-6xl" data-page="departures">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold">قائمة المغادرين</h1>
        <p className="text-sm text-ink-muted mt-1">
          كل مساء: ارفع «تقرير الحجوزات» من نزيل بفلتر «المغادرة-غدا» لكل فرع. صباح يوم المغادرة 9:30 تصل الضيف رسالة «الخروج أو التمديد» من رقم الفرع، ثم طلب التقييم.
          يُقرأ الملف في المتصفح ولا يُحفظ؛ يُحفظ رقم الجوال والاسم الأول ورقم الحجز فقط، ويُحذف بعد 30 يومًا.
        </p>
      </div>

      <div className="card p-4 grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,18rem)_1fr] items-end" data-tour="dep-date">
        <BranchSelect id="dep-branch" branches={branches} value={branch} onChange={setBranch} />
        <DateField mode="single" id="dep-date" label="تاريخ المغادرة" min="today" max={addDays(riyadhToday(), 7)} value={date} onChange={(v) => v && setDate(v)} />
        {canEdit && (
          <div data-tour="dep-upload">
            <label htmlFor="dep-file" className="block text-sm font-medium mb-1">ملف نزيل (xlsx)</label>
            <input
              id="dep-file" ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block w-full text-sm file:btn file:btn-ghost file:me-3" disabled={reading} onChange={(e) => onFile(e.target.files?.[0])} data-action="upload"
            />
            <p className="text-xs text-ink-muted mt-1">{reading ? 'جارٍ قراءة الملف…' : `يُحفظ لقائمة ${BRANCH_NAMES[branch] ?? ''} ليوم ${longDate(date)} — تأكّد من الفرع والتاريخ قبل الرفع.`}</p>
          </div>
        )}
      </div>

      {data && (!data.check_on || !data.review_on) && (
        <div className="card p-4 border-s-4 border-bronze" role="status" data-dry-run data-tour="dep-switches">
          <p className="font-semibold">تجربة بدون إرسال</p>
          <p className="text-sm mt-1">
            {!data.check_on && !data.review_on ? 'المفتاحان متوقفان لهذا الفرع' : !data.check_on ? '«رسالة الخروج أو التمديد» متوقفة لهذا الفرع' : '«طلبات التقييم من قائمة المغادرين» متوقفة لهذا الفرع'}:
            {' '}تعرض الصفحة ما كان سيُرسل ومتى، ولا يُرسل شيء. يشغّلهما مدير النظام من{' '}
            <Link className="link-bronze" to="/hub-team?tab=departures">«الفريق والتقارير»</Link>.
          </p>
        </div>
      )}

      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="card p-2 overflow-x-auto relative" data-tour="dep-table" tabIndex={0} aria-label="قائمة المغادرين">
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-2 pt-2 pb-3 text-sm" data-summary>
            <span>{countWord(rows.length, GUEST)}</span>
            <span>أُرسلت رسالة الخروج: {sum((r) => SENT.has(r.check.state))}</span>
            <span>خروج: {sum((r) => r.answer === 'leave')}</span>
            <span>تمديد: {sum((r) => r.answer === 'extend')}</span>
            <span>لم يرد: {sum((r) => !r.answer && SENT.has(r.check.state))}</span>
            <span>طلبات التقييم المرسلة: {sum((r) => SENT.has(r.review.state))}</span>
            {data.uploads[0] && <span className="text-ink-muted">آخر رفع: {D.timeText(data.uploads[0].at)}{data.uploads[0].by ? ` — ${data.uploads[0].by}` : ''}</span>}
          </div>
          {!rows.length ? (
            <Empty text={data.uploads.length ? 'لا ضيوف في هذه القائمة.' : 'لم تُرفع قائمة لهذا الفرع وهذا اليوم بعد.'} />
          ) : (
            <table className="w-full text-sm dep-table">
              <thead>
                <tr>
                  <th scope="col">الضيف</th><th scope="col">رقم الحجز</th><th scope="col">الجوال</th><th scope="col">اللغة</th>
                  <th scope="col">رسالة الخروج</th><th scope="col">الجواب</th><th scope="col">طلب التقييم</th>{canEdit && <th scope="col"><span className="sr-only">إجراءات</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-row={r.id} data-check={r.check.state} data-review={r.review.state} data-answer={r.answer ?? ''} className={r.excluded ? 'opacity-60' : ''}>
                    <th scope="row">{r.first_name}{r.excluded && <span className="chip ms-2">مستبعد</span>}{r.cycle > 1 && <span className="chip ms-2">مدّد</span>}</th>
                    <td className="num" dir="ltr">{r.ref}</td>
                    <td className="num" dir="ltr">{r.phone}</td>
                    <td>{r.language === 'en' ? 'الإنجليزية' : 'العربية'}</td>
                    <td data-cell="check">{sendText(r.check, 'check')}</td>
                    <td data-cell="answer">{answerText(r)}</td>
                    <td data-cell="review">{sendText(r.review, 'review')}</td>
                    {canEdit && (
                      <td className="whitespace-nowrap">
                        <div className="flex gap-2 justify-end">
                          {r.excluded ? (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={busyRow === r.id} onClick={() => toggle(r, 'exclude', false)} data-action="unexclude"
                              aria-label={`إعادة ${r.first_name} إلى القائمة`}>إعادة للقائمة</button>
                          ) : r.can_exclude && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={busyRow === r.id} onClick={() => toggle(r, 'exclude', true)} data-action="exclude"
                              aria-label={`استبعاد ${r.first_name}`}>استبعاد</button>
                          )}
                          {r.answer === 'extend' && r.answer_via === 'staff' ? (
                            r.can_extend && <button type="button" className="btn btn-ghost btn-sm" disabled={busyRow === r.id} onClick={() => toggle(r, 'extend', false)} data-action="unextend"
                              aria-label={`إزالة «تمديد» عن ${r.first_name}`}>إزالة التمديد</button>
                          ) : !r.answer && r.can_extend && !r.excluded && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={busyRow === r.id} onClick={() => toggle(r, 'extend', true)} data-action="extend"
                              aria-label={`تعليم ${r.first_name} «تمديد»`}>تمديد</button>
                          )}
                          {busyRow === r.id && <Spinner />}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal open={!!prev} onClose={closePreview} title={`معاينة قائمة ${BRANCH_NAMES[branch] ?? ''} — ${longDate(date)}`} wide busy={saving}>
        {prev && (
          <div className="grid gap-4" data-preview>
            <div>
              <p className="font-semibold" data-kept={prev.counts.kept}>سيُحفظ {countWord(prev.counts.kept, GUEST)}</p>
              <p className="text-sm text-ink-muted mt-1">
                العربية {prev.languages.ar} · الإنجليزية {prev.languages.en}
                {prev.counts.moved ? ` · ${countWord(prev.counts.moved, GUEST)} من قائمة سابقة (تمديد)` : ''}
              </p>
              {prev.kept_names.length > 0 && <p className="text-sm mt-2 leading-7" data-kept-names>{prev.kept_names.join('، ')}</p>}
            </div>
            {Object.entries(prev.skipped).some(([, v]) => v.count > 0) && (
              <div>
                <p className="font-semibold">لن يُحفظ</p>
                <ul className="mt-1 grid gap-1 text-sm">
                  {(Object.entries(prev.skipped) as [keyof typeof SKIP_AR, D.Skipped][]).filter(([, v]) => v.count > 0).map(([k, v]) => (
                    <li key={k} data-skip={k}>
                      <span className="font-medium">{SKIP_AR[k]}: {countWord(v.count, GUEST)}</span>
                      {v.names.length > 0 && <span className="text-ink-muted"> — {v.names.join('، ')}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm">
              {data?.check_on ? `تصل رسالة «الخروج أو التمديد» يوم ${longDate(date)} الساعة 9:30 صباحًا.` : 'المفتاح متوقف: لن يُرسل شيء، وتعرض الصفحة ما كان سيُرسل ومتى.'}
            </p>
            <div className="flex gap-2 justify-end">
              <CancelButton disabled={saving} />
              <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || !prev.counts.kept} data-action="save" data-autofocus>
                {saving ? <Spinner /> : null} حفظ القائمة
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
