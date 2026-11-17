// «قائمة المغادرين» (Guest Hub H9, 16 Nov 2026 — DECISIONS.md 2026-11-16 «Guest Hub H9: departures, departure check,
// reviews, shared limit»; H9 fix 1 the same day — «Guest Hub H9 fix 1»). Each MORNING by 07:00 reception uploads Nazeel's
// «تقرير الحجوزات» (مغادرين اليوم) for one branch: the uploader picks the branch and confirms the departure date with the
// site's date picker (default TODAY — never the date printed in the file). The upload control: a drop zone with the bronze
// «رفع ملف نزيل» button (a tap opens the file picker on a phone), the file's name and size with «تغيير» / «إزالة», a
// reading state, then the preview in the same card — kept and skipped, with the reasons and first names only — and the
// summary line above «حفظ القائمة» (disabled until the branch, the date and a valid file are set). A file that cannot be
// read shows its precise reason inside the card (never a red toast). The file is read here, in the browser, by its headers
// («رقم الجوال»، «العميل» — the first word —، «رقم الحجز»; never «الرصيد»، «الوحدات»، «الحالة») and never sent or stored.
// The departure check at 09:30; a list uploaded after 09:30 and before 11:00 sends within 5 minutes; from 11:00 none that
// day. Per guest until sending time: «استبعاد» and «تمديد» (each with «تراجع»). While a branch's switches are off the page
// shows what WOULD be sent and when (a dry run). Today's list missing: the reminders sent (07:00, 08:00, 08:30). ?branch=
// (the reminder's ?hub_d=) opens on that branch. departures: view to read, edit to upload and mark; branch scope.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { addDays, BRANCH_NAMES, countWord, longDate, riyadhToday, type CountNoun } from '../lib/format';
import * as D from '../lib/departures';
import { ANSWER_AR, CODE_AR, SKIP_AR, STATE_AR } from '../../../supabase/functions/_shared/hub/departures';
import type { Parsed } from '../../../supabase/functions/_shared/hub/departures';
import DateField from '../components/DateField';
import { Icon } from '../components/icons';
import { BranchSelect, Empty, ErrorBox, Loading, Spinner, useToast } from '../components/ui';

const GUEST: CountNoun = { zero: 'لا ضيوف', one: 'ضيف واحد', two: 'ضيفان', few: 'ضيوف', many: 'ضيفًا', gen: 'ضيف' };
const SENT = new Set(['accepted', 'sent', 'delivered', 'read']);

/** a send's line: what happened, or what will happen and when (the dry run while the switch is off) */
export function sendText(s: D.Send, kind: 'check' | 'review'): string {
  const when = kind === 'check' ? s.planned : s.due;
  const at = when ? `${D.timeText(when)}${kind === 'review' && when ? ` (${longDate(new Date(when).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }))})` : ''}` : '';
  const code = s.code ? CODE_AR[s.code] ?? '' : '';
  if (s.state === 'none') return '—';
  if (s.state === 'scheduled' && kind === 'check' && !when) return 'رُفعت القائمة بعد 11:00 — لا رسالة خروج اليوم';
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
/** a reminder's line: when, to whom, how, what happened */
export function reminderText(r: D.Reminder): string {
  const how = r.mode && r.mode !== 'none' ? D.REMINDER_HOW[r.mode] : '';
  const state = SENT.has(r.status) ? 'أُرسل' : r.status === 'failed' ? 'تعذّر الإرسال' : r.status === 'skipped' ? 'لم يُرسل' : 'في الطريق';
  const why = r.code ? D.REMINDER_CODE[r.code] ?? '' : '';
  return [D.REMINDER_ROUND[r.round] ?? '', r.name ?? '', [how, state].filter(Boolean).join(' — '), why].filter(Boolean).join(' · ');
}

type Picked = { name: string; size: number; file: File };
type Phase = 'idle' | 'reading' | 'ready' | 'error';

export default function Departures() {
  const { me } = useSession();
  const toast = useToast();
  const loc = useLocation();
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [branch, setBranch] = useState(() => {
    const q = new URLSearchParams(loc.search).get('branch');
    return me?.branch ?? (q === 'airport-road' || q === 'shafa-road' ? q : 'airport-road');
  });
  // H9 fix 1: the list of TODAY (each morning by 07:00) — today by default
  const [date, setDate] = useState(() => riyadhToday());
  const [data, setData] = useState<D.DepList | null>(null);
  const [ov, setOv] = useState<D.DepOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [readError, setReadError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [prev, setPrev] = useState<D.Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = api.canEdit(me, 'departures');

  useEffect(() => {
    api.branches().then((b) => setBranches(b.filter((x) => x.slug === 'airport-road' || x.slug === 'shafa-road'))).catch(() => setBranches([]));
  }, []);
  const load = useCallback(async () => {
    try {
      const [l, o] = await Promise.all([D.list(branch, date), D.overview().catch(() => null)]);
      setData(l);
      setOv(o);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [branch, date]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const clearFile = () => {
    setPicked(null);
    setParsed(null);
    setPrev(null);
    setReadError(null);
    setPhase('idle');
    if (fileRef.current) fileRef.current.value = '';
  };
  /** the server's preview of what was read — again when the branch or the date changes */
  const runPreview = useCallback(async (p: Parsed) => {
    setPhase('reading');
    try {
      setPrev(await D.preview(branch, date, p));
      setPhase('ready');
      setReadError(null);
    } catch (e) {
      setPrev(null);
      setPhase('error');
      setReadError((e as Error).message);
    }
  }, [branch, date]);
  useEffect(() => {
    if (parsed?.ok) runPreview(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, date]);

  const onFile = async (f: File | null | undefined) => {
    if (!f) return;
    setPicked({ name: f.name, size: f.size, file: f });
    setPrev(null);
    setParsed(null);
    setReadError(null);
    setPhase('reading');
    try {
      const p = await D.readFile(f);
      if (!p.ok) {
        setPhase('error');
        setReadError(D.READ_ERRORS[p.error ?? 'not_xlsx']);
        return;
      }
      setParsed(p);
      await runPreview(p);
    } catch (e) {
      setPhase('error');
      setReadError((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const onSave = async () => {
    if (!parsed || !prev) return;
    setSaving(true);
    try {
      const r = await D.save(branch, date, parsed);
      clearFile();
      const c = r.counts;
      toast(`حُفظت قائمة فرع ${BRANCH_NAMES[branch]} ليوم ${longDate(date)}: ${countWord(c.kept, GUEST)}${c.moved ? `، منهم ${countWord(c.moved, GUEST)} مدّدوا من قائمة سابقة` : ''}${c.removed ? `، وحُذف ${countWord(c.removed, GUEST)} لم يعودوا في القائمة` : ''}.`);
      await load();
    } catch (e) {
      setReadError((e as Error).message);
      setPhase('error');
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
  const today = riyadhToday();
  const ob = ov?.branches.find((b) => b.branch === branch);
  const ready = !!branch && !!date && phase === 'ready' && !!prev && prev.counts.kept > 0;
  return (
    <div className="grid gap-5 max-w-6xl" data-page="departures">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold">قائمة المغادرين</h1>
        <p className="text-sm text-ink-muted mt-1">
          كل صباح قبل الساعة 7:00: ارفع من نزيل قائمة المغادرة لليوم لكل فرع. الساعة 9:30 تصل الضيف رسالة «الخروج أو التمديد» من رقم الفرع، ثم طلب التقييم.
          إن رُفعت القائمة بعد 9:30 وقبل 11:00 تُرسل الرسائل خلال 5 دقائق، وبعد 11:00 لا تُرسل رسالة الخروج ذلك اليوم.
          يُقرأ الملف في المتصفح ولا يُحفظ؛ يُحفظ رقم الجوال والاسم الأول ورقم الحجز فقط، ويُحذف بعد 30 يومًا.
        </p>
      </div>

      {date === today && data && !data.uploads.length && ob && ob.remind_on !== false && (
        <div className="card p-4 border-s-4 border-bronze" role="status" data-missing-today>
          <p className="font-semibold">لم تُرفع قائمة اليوم لفرع {BRANCH_NAMES[branch]} بعد</p>
          <p className="text-sm mt-1">رسالة الخروج تُرسل الساعة 9:30، ولا تُرسل بعد 11:00. نذكّر الموظفين المناوبين الساعة 7:00 و8:00، ومدير الاستقبال الساعة 8:30.</p>
          {ob.reminders.length > 0 && (
            <ul className="text-xs text-ink-muted mt-2 grid gap-1" data-reminders>
              {ob.reminders.map((r, i) => <li key={i} data-reminder={r.round}>{reminderText(r)}</li>)}
            </ul>
          )}
        </div>
      )}

      <section className="card p-4 grid gap-4" aria-labelledby="dep-upload-h" data-tour="dep-date">
        <h2 id="dep-upload-h" className="sr-only">رفع قائمة المغادرين</h2>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,18rem)] items-end">
          <BranchSelect id="dep-branch" branches={branches} value={branch} onChange={setBranch} />
          <DateField mode="single" id="dep-date" label="تاريخ المغادرة" min="today" max={addDays(today, 7)} value={date} onChange={(v) => v && setDate(v)} />
        </div>

        {canEdit && (
          <div className="grid gap-3" data-tour="dep-upload">
            <input
              id="dep-file" ref={fileRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])} data-action="upload"
            />
            {!picked ? (
              <div
                className={`dep-drop ${drag ? 'is-drag' : ''}`} data-dropzone
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
              >
                <span className="dep-drop-icon" aria-hidden="true"><Icon name="upload" size={26} /></span>
                <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} aria-describedby="dep-drop-hint" data-action="pick">
                  رفع ملف نزيل
                </button>
                <p className="text-sm text-ink-muted">أو اسحب الملف وأفلته هنا</p>
                <p id="dep-drop-hint" className="text-xs text-ink-muted" data-hint>{D.NAZEEL_STEPS}</p>
              </div>
            ) : (
              <div className="dep-file" data-file>
                <span className="dep-drop-icon" aria-hidden="true"><Icon name="upload" size={20} /></span>
                <div className="min-w-0 grow">
                  <p className="font-medium truncate" dir="auto" data-file-name>{picked.name}</p>
                  <p className="text-xs text-ink-muted num-ar" data-file-size>{D.sizeText(picked.size)}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={saving || phase === 'reading'} data-action="change"
                    aria-label={`تغيير الملف ${picked.name}`}>تغيير</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearFile} disabled={saving} data-action="remove" aria-label={`إزالة الملف ${picked.name}`}>إزالة</button>
                </div>
              </div>
            )}

            <div aria-live="polite" className="grid gap-3">
              {phase === 'reading' && <p className="text-sm flex items-center gap-2" data-reading><Spinner /> جارٍ قراءة الملف…</p>}
              {phase === 'error' && readError && (
                <div className="dep-error" role="alert" data-read-error>
                  <p className="font-semibold">تعذّرت قراءة الملف</p>
                  <p className="text-sm mt-1">{readError}</p>
                </div>
              )}
              {phase === 'ready' && prev && (
                <div className="grid gap-3" data-preview>
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
                  {prev.counts.kept === 0 && <p className="text-sm" data-none-kept>لا يوجد في الملف ضيف يمكن حفظه.</p>}
                  <p className="text-sm">
                    {data?.check_on ? `تصل رسالة «الخروج أو التمديد» يوم ${longDate(date)} الساعة 9:30 صباحًا (أو خلال 5 دقائق إن رُفعت بعد 9:30 وقبل 11:00).` : 'المفتاح متوقف: لن يُرسل شيء، وتعرض الصفحة ما كان سيُرسل ومتى.'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 justify-between border-t border-line pt-3">
              <p className="text-sm font-medium" data-summary-line>ستُحفظ قائمة فرع {BRANCH_NAMES[branch] ?? ''} ليوم {longDate(date)}</p>
              <button type="button" className="btn btn-primary" onClick={onSave} disabled={!ready || saving} data-action="save">
                {saving ? <Spinner /> : null} حفظ القائمة
              </button>
            </div>
          </div>
        )}
      </section>

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
    </div>
  );
}
