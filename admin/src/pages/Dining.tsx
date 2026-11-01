// «المطاعم والمقاهي» — the dashboard dining module (Ahmed, 1 Nov 2026; DASHBOARD-SPEC.md §3.8b; DECISIONS.md 2026-11-02).
// Every dining venue of each branch, addable without code (the rooftop is a second Airport Road venue):
//   - per branch, the venues in their site order (تقديم / تأخير), each with what the site shows now («على الموقع: …» or
//     «لم يُنشر»), unpublished changes, what blocks publishing, and the number of addresses waiting for its opening
//     email (never the addresses themselves);
//   - «إضافة مطعم أو مقهى» / «تعديل» opens the form (the shared Modal and its dirty guard): name ar / en and description
//     ar / en through LabelPair (the translation chip, never auto-filled), kind, branch, location in the hotel, the SVG
//     logo, opening hours (24 hours or per day), audience, phone / WhatsApp / room extension, the menu link (/menu/ or
//     a custom https URL), status (نشط / قريبًا / مخفي) and the page link (fixed once published);
//   - «نشر» (one venue) / «نشر الكل» checks first and lists what is missing; a publish creates a job and asks for the site
//     build (site-rebuild, reason dining), shown under «آخر عمليات النشر». Nothing reaches the site before «نشر»;
//   - photos live in «الصور» (one target per venue: a cover, a gallery of 3–12 suggested) — linked from each row;
//   - «إرسال إشعار الافتتاح» (publish, once the venue is published as active): one email per waiting address through
//     the dining-notify function, then each sent address is deleted.
// Levels: view (read-only), edit (add, edit, order), publish (+ «نشر», the opening notice); the branch scope applies (RLS).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import type { Branch, DiningFields, DiningHours, DiningPublishResult, DiningVenue, MediaJob } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, countWord, riyadhDateTime, type CountNoun } from '../lib/format';
import { JOB_STATUS } from '../lib/media';
import {
  blankVenue, CLOSE_TIMES, DAYS, E164, e164, emptyWeek, hoursMode, KIND_LABELS, liveText, LOCATION_LABELS, MISSING_LABELS, NO_COVER, STATUS_LABELS,
  svgProblem, TIMES, type HoursMode,
} from '../lib/dining';
import LabelPair from '../components/LabelPair';
import { CancelButton, Confirm, Empty, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';

const ADDRESS: CountNoun = { zero: 'لا عناوين', one: 'عنوان واحد', two: 'عنوانان', few: 'عناوين', many: 'عنوانًا', gen: 'عنوان' };
const MESSAGE: CountNoun = { zero: 'لا رسائل', one: 'رسالة واحدة', two: 'رسالتان', few: 'رسائل', many: 'رسالة', gen: 'رسالة' };
export const addressesWord = (n: number) => countWord(n, ADDRESS);
export const messagesWord = (n: number) => countWord(n, MESSAGE);

export default function Dining() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'dining');
  const publisher = api.canPublish(me, 'dining');
  const seesMedia = api.canView(me, 'media');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [venues, setVenues] = useState<DiningVenue[] | null>(null);
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DiningVenue | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ result: DiningPublishResult; all: boolean } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notify, setNotify] = useState<DiningVenue | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [b, v] = await Promise.all([api.branches(), api.diningVenues()]);
      setBranches(b);
      setVenues(v);
    } catch (e) {
      setError((e as Error).message);
      setVenues([]);
    }
    try {
      setJobs(await api.diningJobs());
    } catch { /* the panel keeps the last list */ }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // a job waiting for its build: re-read the list every 15 s
  useEffect(() => {
    if (!jobs.some((j) => j.status === 'queued' || j.status === 'building')) return;
    const t = window.setInterval(async () => setJobs(await api.diningJobs().catch(() => jobs)), 15000);
    return () => window.clearInterval(t);
  }, [jobs]);

  const pendingAll = (venues ?? []).filter((v) => v.pending).length;
  const names = useMemo(() => new Map((venues ?? []).map((v) => [v.slug, v.name_ar])), [venues]);

  async function move(list: DiningVenue[], v: DiningVenue, by: number) {
    const ids = list.map((x) => x.id);
    const at = ids.indexOf(v.id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(at, 1)[0]);
    try {
      await api.diningReorder(v.branch, ids);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
      await load();
    }
  }

  async function publish(ids: string[] | null, skip = false) {
    setPublishing(true);
    try {
      const r = await api.diningPublish(ids, skip);
      if (r.ok && r.job_id) {
        setBlocked(null);
        const rb = await api.siteRebuild('dining', r.job_id);
        const noCover = (r.published ?? []).filter((p) => p.warnings.some((w) => w.code === 'no_cover'));
        toast(
          (rb.ok && rb.dispatched ? 'طُلب النشر: يُبنى الموقع الآن ويظهر التغيير خلال دقائق.' : rb.reason === 'no_token' ? 'حُفظ النشر؛ يظهر على الموقع مع إعادة البناء التالية.' : 'حُفظ النشر لكن تعذّر بدء البناء؛ أعد المحاولة من قائمة النشر.')
            + (noCover.length ? ` ${noCover.map((p) => p.name_ar).join('، ')}: ${NO_COVER}` : ''),
          rb.ok && rb.dispatched ? undefined : 'error',
        );
        await load();
      } else if (r.reason === 'nothing') toast('لا تغييرات للنشر.');
      else setBlocked({ result: r, all: ids === null });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPublishing(false);
    }
  }
  async function retry(job: MediaJob) {
    const rb = await api.siteRebuild('dining', job.id);
    toast(rb.ok && rb.dispatched ? 'طُلب البناء من جديد.' : 'تعذّر بدء البناء؛ أعد المحاولة بعد قليل.', rb.ok && rb.dispatched ? undefined : 'error');
    setJobs(await api.diningJobs().catch(() => jobs));
  }
  async function sendNotice(v: DiningVenue) {
    setSending(true);
    try {
      const r = await api.diningNotifySend(v.id);
      toast(r.failed ? `أُرسلت ${messagesWord(r.sent)}، وتعذّر إرسال ${messagesWord(r.failed)}؛ بقيت عناوينها لإعادة المحاولة.` : `أُرسلت ${messagesWord(r.sent)}، وحُذفت العناوين.`, r.failed ? 'error' : undefined);
      setNotify(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  }

  if (venues === null) return <Loading />;
  const visibleBranches = branches.filter((b) => venues.some((v) => v.branch === b.slug) || editable);
  return (
    <div className="grid gap-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">المطاعم والمقاهي</h1>
          <p className="text-sm text-ink-muted mt-1">
            أضف مطاعم الفرعين ومقاهيها وعدّلها ورتّبها، ثم اضغط «نشر». لا يظهر على الموقع إلا ما نُشر، والمخفي لا يظهر في أي مكان. صور كل مكان في «الصور».
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : !publisher ? ' النشر لمن يملك صلاحية «نشر».' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && <button type="button" className="btn btn-ghost" onClick={() => setEditing('new')} data-action="dining-add">إضافة مطعم أو مقهى</button>}
          {publisher && (
            <button type="button" className="btn btn-primary" onClick={() => publish(null)} disabled={publishing || !pendingAll} data-action="dining-publish-all">
              {publishing && <Spinner />} نشر الكل{pendingAll ? ` (${pendingAll})` : ''}
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {!visibleBranches.length && <Empty text="لا مطاعم أو مقاهٍ ضمن صلاحيتك." />}
      {visibleBranches.map((b) => {
        const list = venues.filter((v) => v.branch === b.slug);
        return (
          <section key={b.slug} className="card p-4" aria-labelledby={`dining-${b.slug}`} data-dining-branch={b.slug}>
            <h2 id={`dining-${b.slug}`} className="font-bold text-lg mb-3">{BRANCH_NAMES[b.slug] ?? b.name_ar}</h2>
            {!list.length ? (
              <p className="text-sm text-ink-muted">لا مطاعم أو مقاهٍ في هذا الفرع بعد.</p>
            ) : (
              <ol className="grid gap-2">
                {list.map((v, n) => (
                  <li key={v.id} className="grid gap-2 border-b border-line last:border-0 py-3" data-venue={v.slug} data-venue-status={v.status} data-venue-live={v.live?.status ?? 'none'}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {v.name_ar} {v.name_en && <span className="latin text-xs text-ink-muted" dir="ltr">{v.name_en}</span>}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {KIND_LABELS[v.kind]} · {LOCATION_LABELS[v.location]} · الحالة في اللوحة: {STATUS_LABELS[v.status]}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className={`chip ${v.live && v.live.status !== 'hidden' ? 'chip-confirmed' : 'chip-request'}`} data-live>{liveText(v)}</span>
                          {v.pending && <span className="chip chip-request" data-pending>تعديلات غير منشورة</span>}
                          {v.check.missing.length > 0 && <span className="chip chip-test" data-missing>ينقص: {v.check.missing.map((m) => MISSING_LABELS[m.code]).join('، ')}</span>}
                          {v.check.warnings.some((w) => w.code === 'no_cover') && <span className="chip chip-flag" data-no-cover>بلا صورة رئيسية منشورة</span>}
                          {(v.notify_count > 0 || v.live?.status === 'coming_soon') && (
                            <span className="chip chip-request" data-notify-count={v.notify_count}>بانتظار إشعار الافتتاح: {addressesWord(v.notify_count)}</span>
                          )}
                          {v.notified_at && <span className="chip chip-confirmed num">أُرسل إشعار الافتتاح {riyadhDateTime(v.notified_at)}</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {editable && list.length > 1 && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={n === 0} onClick={() => move(list, v, -1)} aria-label={`تقديم ${v.name_ar}`} data-action="venue-earlier">تقديم</button>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={n === list.length - 1} onClick={() => move(list, v, 1)} aria-label={`تأخير ${v.name_ar}`} data-action="venue-later">تأخير</button>
                          </>
                        )}
                        {seesMedia && <Link className="btn btn-ghost btn-sm" to={`/media?t=dining:${v.slug}`} data-action="venue-photos">الصور</Link>}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(v)} data-action="venue-edit">{editable ? 'تعديل' : 'عرض'}</button>
                        {publisher && v.pending && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => publish([v.id])} disabled={publishing} data-action="venue-publish">نشر</button>
                        )}
                        {publisher && v.live?.status === 'active' && v.notify_count > 0 && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setNotify(v)} data-action="venue-notify">إرسال إشعار الافتتاح</button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}

      <Jobs jobs={jobs} names={names} publisher={publisher} onRetry={retry} />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'إضافة مطعم أو مقهى' : editing ? (editable ? `تعديل: ${editing.name_ar}` : editing.name_ar) : ''} wide busy={busy}>
        {editing !== null && (
          <VenueForm
            key={editing === 'new' ? 'new' : editing.id}
            venue={editing === 'new' ? null : editing}
            branches={branches}
            editable={editable}
            busy={busy}
            setBusy={setBusy}
            onSaved={async () => {
              setEditing(null);
              await load();
            }}
          />
        )}
      </Modal>
      <Modal open={!!blocked} onClose={() => setBlocked(null)} title="ما ينقص قبل النشر" busy={publishing}>
        {blocked && (
          <div className="grid gap-3" data-dining-blocked>
            <p className="text-sm text-ink-muted">لا يُنشر مطعم أو مقهى ينقصه شيء مطلوب. أكمل ما يلي ثم انشر:</p>
            <ul className="grid gap-2">
              {(blocked.result.blocked ?? []).map((x) => (
                <li key={x.id} className="text-sm" data-blocked-venue={x.slug}>
                  <strong>{x.name_ar}</strong>
                  <ul className="list-disc ps-5 text-ink-muted">
                    {x.missing.map((m) => <li key={m.code}>{MISSING_LABELS[m.code]}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2 mt-2">
              <CancelButton label="إغلاق" disabled={publishing} />
              {blocked.all && (blocked.result.ready?.length ?? 0) > 0 && (
                <button type="button" className="btn btn-primary" onClick={() => publish(null, true)} disabled={publishing} data-action="dining-publish-ready">
                  {publishing && <Spinner />} نشر المكتمل فقط ({blocked.result.ready!.length})
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Confirm
        open={!!notify}
        title="إرسال إشعار الافتتاح"
        body={notify ? `تُرسل رسالة واحدة إلى ${addressesWord(notify.notify_count)} طلبت إشعارها بافتتاح «${notify.name_ar}»، ثم تُحذف كل العناوين التي أُرسلت إليها. لا يمكن التراجع.` : ''}
        confirmLabel="إرسال الرسائل"
        onConfirm={() => notify && sendNotice(notify)}
        onClose={() => setNotify(null)}
        busy={sending}
      />
    </div>
  );
}

function Jobs({ jobs, names, publisher, onRetry }: { jobs: MediaJob[]; names: Map<string, string>; publisher: boolean; onRetry: (j: MediaJob) => void }) {
  if (!jobs.length) return null;
  return (
    <section className="card p-4" aria-labelledby="dining-jobs-title" data-jobs>
      <h2 id="dining-jobs-title" className="font-bold mb-3">آخر عمليات النشر</h2>
      <ul className="grid gap-2">
        {jobs.map((j) => (
          <li key={j.id} className="grid gap-1 border-b border-line last:border-0 pb-2 text-sm" data-job={j.id} data-job-status={j.status}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${j.status === 'published' ? 'chip-confirmed' : j.status === 'failed' ? 'chip-test' : 'chip-request'}`}>{JOB_STATUS[j.status]}</span>
              <span className="num">{riyadhDateTime(j.requested_at)}</span>
              {j.requested_label && <span className="text-ink-muted">· {j.requested_label}</span>}
              {j.finished_at && j.status === 'published' && <span className="text-ink-muted num">· على الموقع {riyadhDateTime(j.finished_at)}</span>}
              {j.run_url && <a className="text-accent-text underline" href={j.run_url} target="_blank" rel="noreferrer" data-run-link>سجل البناء</a>}
            </div>
            <p className="text-ink-muted">{j.targets.map((t) => names.get(t.key) ?? t.key).join('، ')}</p>
            {j.status === 'queued' && j.dispatch === 'no_token' && <p className="text-xs text-ink-muted">لم يُطلب البناء آليًا؛ يُنشر مع إعادة بناء الموقع التالية.</p>}
            {((j.status === 'queued' && j.dispatch === 'failed') || j.status === 'failed') && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs media-err">{j.status === 'failed' ? 'فشل البناء؛ الموقع ما زال على النسخة السابقة.' : 'تعذّر بدء البناء.'}</p>
                {publisher && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(j)} data-action="job-retry">إعادة المحاولة</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── the form ────────────────────────────────────────────────────────────────────────────────────────────────────

function VenueForm({ venue, branches, editable, busy, setBusy, onSaved }: { venue: DiningVenue | null; branches: Branch[]; editable: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void> }) {
  const { me } = useSession();
  const toast = useToast();
  const scoped = me?.branch ?? null;
  const [f, setF] = useState<DiningFields>(() => (venue ? pick(venue) : blankVenue(scoped ?? branches[0]?.slug ?? 'airport-road')));
  const [mode, setMode] = useState<HoursMode>(hoursMode(f.hours));
  const [week, setWeek] = useState(() => (f.hours?.mode === 'weekly' ? f.hours.days : emptyWeek()));
  const [logoError, setLogoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = !!venue?.live;
  const set = <K extends keyof DiningFields>(k: K, v: DiningFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const dis = !editable || busy;
  const phoneOk = (s: string | null) => !s || E164.test(e164(s));

  async function readLogo(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      setLogoError('الشعار ملف SVG فقط.');
      return;
    }
    const text = await file.text();
    const problem = svgProblem(text);
    if (problem) setLogoError(problem);
    else set('logo_svg', text.trim());
  }

  async function save() {
    setError(null);
    const hours: DiningHours = mode === 'unset' ? null : mode === '24h' ? { mode: '24h' } : { mode: 'weekly', days: week };
    if (mode === 'weekly' && !Object.values(week).some(Boolean)) {
      setError('اختر يومًا مفتوحًا واحدًا على الأقل، أو «على مدار الساعة».');
      return;
    }
    if (mode === 'weekly' && Object.values(week).some((d) => d && d.open === d.close)) {
      setError('وقت الفتح والإغلاق في اليوم نفسه لا يتساويان.');
      return;
    }
    if (!phoneOk(f.phone) || !phoneOk(f.whatsapp)) {
      setError('الهاتف وواتساب بالصيغة الدولية، مثل +9665xxxxxxxx (أو 05xxxxxxxx لرقم سعودي).');
      return;
    }
    const payload: DiningFields = {
      ...f,
      slug: f.slug.trim().toLowerCase(),
      hours,
      phone: f.phone ? e164(f.phone) : null,
      whatsapp: f.whatsapp ? e164(f.whatsapp) : null,
      extension: f.extension?.trim() ? f.extension.trim() : null,
      menu_url: f.menu === 'custom' ? (f.menu_url ?? '').trim() : null,
    };
    setBusy(true);
    try {
      await api.diningSave(venue?.id ?? null, payload);
      toast(venue ? 'حُفظت التعديلات؛ لا تظهر على الموقع قبل «نشر».' : 'أُضيف؛ يبقى خارج الموقع حتى تختار حالته وتنشره.');
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4" data-venue-form>
      {venue?.live && venue.pending && <p className="note-amber text-sm" role="status">فيه تعديلات لم تُنشر بعد؛ الموقع يعرض آخر نسخة منشورة.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {scoped || branches.length < 2 ? (
          <div>
            <span className="label" id="v-branch-label">الفرع</span>
            <span className="field-static block" aria-labelledby="v-branch-label" data-branch-static={f.branch}>{BRANCH_NAMES[f.branch] ?? f.branch}</span>
          </div>
        ) : (
          <Field label="الفرع" id="v-branch">
            <select id="v-branch" className="field" value={f.branch} onChange={(e) => set('branch', e.target.value)} disabled={dis} data-field="branch">
              {branches.map((b) => <option key={b.slug} value={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</option>)}
            </select>
          </Field>
        )}
        <Field label="رابط الصفحة" id="v-slug" hint={locked ? `ثابت بعد النشر: /dining/${f.slug}/` : `حروف إنجليزية صغيرة وأرقام وشرطات: /dining/${f.slug || '…'}/`}>
          <input id="v-slug" className="field latin" dir="ltr" value={f.slug} onChange={(e) => set('slug', e.target.value)} maxLength={60} disabled={dis || locked} autoComplete="off" data-field="slug" />
        </Field>
      </div>
      <LabelPair ar={f.name_ar} en={f.name_en} onChange={(a, e) => setF((x) => ({ ...x, name_ar: a, name_en: e }))} ids={{ ar: 'v-name-ar', en: 'v-name-en' }} labels={{ ar: 'الاسم بالعربية', en: 'الاسم بالإنجليزية' }} disabled={dis} />
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <span className="label">النوع</span>
          <Segmented value={f.kind} onChange={(v) => set('kind', v)} label="النوع" disabled={dis} options={(Object.keys(KIND_LABELS) as DiningFields['kind'][]).map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
        </div>
        <div>
          <span className="label">الحالة</span>
          <Segmented value={f.status} onChange={(v) => set('status', v)} label="الحالة" disabled={dis} options={(['active', 'coming_soon', 'hidden'] as const).map((k) => ({ value: k, label: STATUS_LABELS[k] }))} />
          <p className="text-xs text-ink-muted mt-1">نشط: صفحة كاملة وقسم في صفحة الفرع. قريبًا: صفحة تشويق بنموذج «أبلغني عند الافتتاح». مخفي: لا يظهر في أي مكان.</p>
        </div>
      </div>
      <div>
        <span className="label">المكان داخل الفندق</span>
        <Segmented value={f.location} onChange={(v) => set('location', v)} label="المكان داخل الفندق" disabled={dis} options={(Object.keys(LOCATION_LABELS) as DiningFields['location'][]).map((k) => ({ value: k, label: LOCATION_LABELS[k] }))} />
      </div>
      {f.location === 'other' && (
        <LabelPair ar={f.location_note_ar} en={f.location_note_en} onChange={(a, e) => setF((x) => ({ ...x, location_note_ar: a, location_note_en: e }))} ids={{ ar: 'v-loc-ar', en: 'v-loc-en' }} labels={{ ar: 'المكان بالعربية', en: 'المكان بالإنجليزية' }} disabled={dis} />
      )}

      <fieldset className="grid gap-2">
        <legend className="label">ساعات العمل</legend>
        <Segmented value={mode} onChange={(v) => setMode(v)} label="ساعات العمل" disabled={dis} options={[{ value: 'unset', label: 'غير محددة' }, { value: '24h', label: 'على مدار الساعة' }, { value: 'weekly', label: 'حسب الأيام' }]} />
        {mode === 'weekly' && (
          <ul className="grid gap-1.5" data-hours-week>
            {DAYS.map((d) => {
              const v = week[d.key];
              return (
                <li key={d.key} className="grid grid-cols-[6.5rem_auto_1fr] items-center gap-2 text-sm" data-day={d.key}>
                  <label className="flex items-center gap-2 font-semibold min-h-11">
                    <input type="checkbox" className="size-4 accent-bronze-deep" checked={!!v} disabled={dis} onChange={(e) => setWeek((w) => ({ ...w, [d.key]: e.target.checked ? { open: '07:00', close: '23:00' } : null }))} />
                    {d.label}
                  </label>
                  {v ? (
                    <span className="flex items-center gap-1.5 num">
                      <select className="field w-auto" aria-label={`${d.label}: يفتح`} value={v.open} disabled={dis} onChange={(e) => setWeek((w) => ({ ...w, [d.key]: { ...v, open: e.target.value } }))}>
                        {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <span aria-hidden="true">–</span>
                      <select className="field w-auto" aria-label={`${d.label}: يغلق`} value={v.close} disabled={dis} onChange={(e) => setWeek((w) => ({ ...w, [d.key]: { ...v, close: e.target.value } }))}>
                        {CLOSE_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </span>
                  ) : (
                    <span className="text-ink-muted">مغلق</span>
                  )}
                  <span />
                </li>
              );
            })}
            <li className="text-xs text-ink-muted">إغلاق قبل وقت الفتح يعني بعد منتصف الليل (مثل 18:00 – 02:00).</li>
          </ul>
        )}
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <span className="label">من يدخل</span>
          <Segmented value={f.audience ?? 'unset'} onChange={(v) => set('audience', v === 'unset' ? null : v)} label="من يدخل" disabled={dis} options={[{ value: 'unset', label: 'غير محدد' }, { value: 'public', label: 'مفتوح للجميع' }, { value: 'guests', label: 'لنزلاء الفندق' }]} />
        </div>
        <Field label="تحويلة من الغرفة" id="v-ext" hint="أرقام فقط؛ اتركه فارغًا إن لم توجد.">
          <input id="v-ext" className="field latin num w-32" dir="ltr" inputMode="numeric" value={f.extension ?? ''} maxLength={6} onChange={(e) => set('extension', e.target.value.replace(/\D/g, '') || null)} disabled={dis} data-field="extension" />
        </Field>
        <Field label="الهاتف" id="v-phone" hint="بالصيغة الدولية؛ 05xxxxxxxx يُحوَّل تلقائيًا.">
          <input id="v-phone" className="field latin" dir="ltr" inputMode="tel" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value || null)} disabled={dis} data-field="phone" />
        </Field>
        <Field label="واتساب" id="v-wa" hint="بالصيغة الدولية؛ 05xxxxxxxx يُحوَّل تلقائيًا.">
          <input id="v-wa" className="field latin" dir="ltr" inputMode="tel" value={f.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.target.value || null)} disabled={dis} data-field="whatsapp" />
        </Field>
      </div>

      <div className="grid gap-2">
        <span className="label">المنيو</span>
        <Segmented value={f.menu} onChange={(v) => set('menu', v)} label="المنيو" disabled={dis} options={[{ value: 'none', label: 'بلا منيو' }, { value: 'internal', label: 'منيو الموقع /menu/' }, { value: 'custom', label: 'رابط خاص' }]} />
        {f.menu === 'custom' && (
          <Field label="رابط المنيو" id="v-menu-url" hint="يبدأ بـ https://">
            <input id="v-menu-url" className="field latin" dir="ltr" value={f.menu_url ?? ''} maxLength={300} onChange={(e) => set('menu_url', e.target.value)} disabled={dis} data-field="menu_url" />
          </Field>
        )}
      </div>

      <LabelPair kind="text" ar={f.description_ar} en={f.description_en} onChange={(a, e) => setF((x) => ({ ...x, description_ar: a, description_en: e }))} ids={{ ar: 'v-desc-ar', en: 'v-desc-en' }} labels={{ ar: 'الوصف بالعربية', en: 'الوصف بالإنجليزية' }} hints={{ ar: 'جملتان أو ثلاث عمّا يقدّمه المكان فعلًا؛ حتى 600 حرف.' }} disabled={dis} />

      <div className="grid gap-2">
        <span className="label">الشعار (SVG)</span>
        <div className="flex flex-wrap items-center gap-3">
          {f.logo_svg ? (
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.logo_svg)}`} alt={`شعار ${f.name_ar}`} className="h-12 max-w-48 object-contain bg-porcelain rounded p-1" data-logo-preview />
          ) : (
            <span className="text-sm text-ink-muted">لا شعار؛ يظهر الاسم وحده.</span>
          )}
          {editable && (
            <>
              <label className="btn btn-ghost btn-sm cursor-pointer">
                {f.logo_svg ? 'استبدال الشعار' : 'اختيار ملف SVG'}
                <input type="file" accept=".svg,image/svg+xml" className="sr-only" disabled={dis} onChange={(e) => { void readLogo(e.target.files?.[0]); e.target.value = ''; }} data-no-dirty data-logo-input />
              </label>
              {f.logo_svg && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('logo_svg', null)} disabled={dis} data-action="logo-remove">إزالة الشعار</button>}
            </>
          )}
          {/* the logo is part of the dirty state (the file input itself is not) */}
          <input type="hidden" value={f.logo_svg ? String(f.logo_svg.length) + ':' + f.logo_svg.slice(-40) : ''} readOnly data-logo-state />
        </div>
        {logoError && <p className="text-sm media-err" role="alert" data-logo-error>{logoError}</p>}
      </div>

      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="venue-save">
            {busy && <Spinner />} حفظ
          </button>
        )}
      </div>
    </div>
  );
}

function pick(v: DiningVenue): DiningFields {
  return {
    slug: v.slug, branch: v.branch, kind: v.kind, name_ar: v.name_ar, name_en: v.name_en, location: v.location,
    location_note_ar: v.location_note_ar, location_note_en: v.location_note_en, logo_svg: v.logo_svg, hours: v.hours,
    audience: v.audience, phone: v.phone, whatsapp: v.whatsapp, extension: v.extension, menu: v.menu, menu_url: v.menu_url,
    description_ar: v.description_ar, description_en: v.description_en, status: v.status,
  };
}
