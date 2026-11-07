// «آراء الضيوف» — the dashboard guest reviews module (Ahmed, 7 Nov 2026; DECISIONS.md 2026-11-07 «Home sections»). The
// reviews of the home page's «آراء ضيوفنا»: real Google reviews of the two branches, the text verbatim (a cut as «…»):
//   - the list in the site's order («تقديم» / «تأخير»); the Arabic home page shows the first three Arabic reviews with
//     «في الصفحة الرئيسية» on, the English page the first three English ones. Chips say what the site shows (منشور /
//     مسودة), unpublished changes, and what blocks publishing;
//   - «إضافة تقييم» / «تعديل» opens the form (the shared Modal and its dirty guard): first name, branch, stars, language,
//     text, source link (the branch's Google listing by default), «في الصفحة الرئيسية». The checks show while typing;
//     save keeps a draft, a problem blocks «نشر»;
//   - «حذف التقييم» only for a review never published; a published one leaves the site by «في الصفحة الرئيسية» off + «نشر»;
//   - «نشر» publishes the whole list (the content permission's publish level) and asks for the site build (reason
//     reviews). Nothing reaches the site before «نشر». No structured data is ever made from these reviews.
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { countWord, type CountNoun } from '../lib/format';
import { blankReview, branchLabel, LISTING, pickReview, REVIEW_BRANCHES, REVIEW_LANGS, REVIEW_MAX, reviewDelete, reviewItems, reviewProblems, reviewProblemText, reviewPublish, reviewReorder, reviewSave, type Review, type ReviewFields, type ReviewPublishResult } from '../lib/reviews';
import { CancelButton, Confirm, Empty, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';

const REVIEW: CountNoun = { zero: 'لا تقييمات', one: 'تقييم واحد', two: 'تقييمان', few: 'تقييمات', many: 'تقييمًا', gen: 'تقييم' };
const HOME_MAX = 3;
const STAR: CountNoun = { zero: 'بلا نجوم', one: 'نجمة واحدة', two: 'نجمتان', few: 'نجوم', many: 'نجمة', gen: 'نجمة' };

export default function Reviews() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'content');
  const publisher = api.canPublish(me, 'content');
  const [items, setItems] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Review | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [blocked, setBlocked] = useState<ReviewPublishResult | null>(null);
  const [removing, setRemoving] = useState<Review | null>(null);
  // one reorder at a time: a second «تقديم» before the list reloads would swap against the old order
  const [reordering, setReordering] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await reviewItems());
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const ordered = useMemo(() => [...(items ?? [])].sort((a, b) => a.sort - b.sort), [items]);
  const pending = ordered.filter((r) => r.pending).length;
  /** which reviews the home page shows now (the published ones, first three per language) */
  const onHome = useMemo(() => {
    const s = new Set<string>();
    for (const lang of ['ar', 'en'] as const) {
      ordered.filter((r) => r.live && r.live.show_home && r.live.lang === lang).sort((a, b) => (a.live!.sort - b.live!.sort)).slice(0, HOME_MAX).forEach((r) => s.add(r.id));
    }
    return s;
  }, [ordered]);

  async function move(r: Review, by: number) {
    const ids = ordered.map((x) => x.id);
    const a = ids.indexOf(r.id);
    const b = a + by;
    if (b < 0 || b >= ids.length) return;
    [ids[a], ids[b]] = [ids[b], ids[a]];
    setReordering(true);
    try {
      await reviewReorder(ids);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    await load();
    setReordering(false);
  }

  async function publish() {
    setPublishing(true);
    try {
      const r = await reviewPublish();
      if (r.ok && r.job_id) {
        setBlocked(null);
        const rb = await api.siteRebuild('reviews', r.job_id);
        toast(
          rb.ok && rb.dispatched ? `نُشر ${countWord(r.count ?? 0, REVIEW)}: يُبنى الموقع الآن ويظهر التغيير خلال دقائق.` : rb.reason === 'no_token' ? 'حُفظ النشر؛ يظهر على الموقع مع إعادة البناء التالية.' : 'حُفظ النشر لكن تعذّر بدء البناء؛ يظهر مع إعادة البناء التالية.',
          rb.ok && rb.dispatched ? undefined : 'error',
        );
        await load();
      } else if (r.reason === 'nothing') toast('لا تغييرات للنشر.');
      else setBlocked(r);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPublishing(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await reviewDelete(removing.id);
      toast('حُذف التقييم.');
      setRemoving(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return <Loading />;
  return (
    <div className="grid gap-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">آراء الضيوف</h1>
          <p className="text-sm text-ink-muted mt-1">
            تقييمات حقيقية من خرائط Google تظهر في قسم «آراء ضيوفنا» بالصفحة الرئيسية: الصفحة العربية تعرض أول {HOME_MAX} تقييمات عربية، والإنجليزية أول {HOME_MAX} تقييمات إنجليزية، بهذا الترتيب. انقل نص التقييم كما كتبه الضيف، واكتب «…» مكان أي جزء محذوف. لا يظهر أي تعديل على الموقع قبل «نشر».
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : !publisher ? ' النشر لمن يملك صلاحية «نشر» في «المحتوى».' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && <button type="button" className="btn btn-ghost" onClick={() => setEditing('new')} data-action="review-add">إضافة تقييم</button>}
          {publisher && (
            <button type="button" className="btn btn-primary" onClick={publish} disabled={publishing || !pending} data-action="review-publish">
              {publishing && <Spinner />} نشر{pending ? ` (${pending})` : ''}
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {!ordered.length ? (
        <Empty text="لا تقييمات بعد." />
      ) : (
        <section className="card p-4" aria-label="التقييمات">
          <ol className="grid">
            {ordered.map((r, n) => {
              const state = !r.live ? 'draft' : 'published';
              return (
                <li key={r.id} className="grid gap-1.5 border-b border-line last:border-0 py-3" data-review-row={r.id} data-review-state={state}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">
                        <span className="latin" dir="auto">{r.first_name || '—'}</span> · {branchLabel(r.branch)} · {countWord(r.stars, STAR)} · {r.lang === 'ar' ? 'عربي' : 'إنجليزي'}
                      </div>
                      <p className={`text-sm text-ink-muted mt-0.5 line-clamp-2 ${r.lang === 'en' ? 'latin' : ''}`} dir={r.lang === 'en' ? 'ltr' : 'rtl'} lang={r.lang}>{r.body || 'بلا نص'}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <span className={`chip ${state === 'published' ? 'chip-confirmed' : 'chip-request'}`} data-live>{state === 'published' ? 'منشور' : 'مسودة لم تُنشر'}</span>
                        {r.live && r.pending && <span className="chip chip-request" data-pending>تعديلات غير منشورة</span>}
                        {onHome.has(r.id) && <span className="chip chip-confirmed" data-on-home>يظهر الآن في الصفحة الرئيسية</span>}
                        {!r.show_home && <span className="chip chip-request">ليس في الصفحة الرئيسية</span>}
                        {r.problems.length > 0 && <span className="chip chip-test" data-missing>{countWord(r.problems.length, { zero: '', one: 'ملاحظة تمنع النشر', two: 'ملاحظتان تمنعان النشر', few: 'ملاحظات تمنع النشر', many: 'ملاحظة تمنع النشر', gen: 'ملاحظة' })}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {editable && ordered.length > 1 && (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={n === 0 || reordering} onClick={() => move(r, -1)} aria-label={`تقديم تقييم ${r.first_name}`} data-action="review-earlier">تقديم</button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={n === ordered.length - 1 || reordering} onClick={() => move(r, 1)} aria-label={`تأخير تقييم ${r.first_name}`} data-action="review-later">تأخير</button>
                        </>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(r)} data-action="review-edit">{editable ? 'تعديل' : 'عرض'}</button>
                      {editable && !r.first_published_at && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(r)} aria-label={`حذف تقييم ${r.first_name}`} data-action="review-delete">حذف التقييم</button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'إضافة تقييم' : editing ? (editable ? 'تعديل التقييم' : 'التقييم') : ''} draftKey={editing ? (editing === 'new' ? 'review:new' : `review:${editing.id}`) : undefined} wide busy={busy}>
        {editing !== null && (
          <ReviewForm
            key={editing === 'new' ? 'new' : editing.id}
            item={editing === 'new' ? null : editing}
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
      <Modal open={!!blocked} onClose={() => setBlocked(null)} title="ما يمنع النشر" busy={publishing}>
        {blocked && (
          <div className="grid gap-3" data-review-blocked>
            <p className="text-sm text-ink-muted">لا تُنشر القائمة وفيها تقييم معروض في الصفحة الرئيسية به ملاحظة. صحّح ما يلي ثم انشر:</p>
            <ul className="grid gap-2">
              {(blocked.blocked ?? []).map((x) => (
                <li key={x.id} className="text-sm">
                  <strong>{x.first_name || '—'} · {branchLabel(x.branch)}</strong>
                  <ul className="list-disc ps-5 text-ink-muted">
                    {x.problems.map((p, i) => <li key={i}>{reviewProblemText(p)}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <CancelButton label="إغلاق" />
            </div>
          </div>
        )}
      </Modal>
      <Confirm
        open={!!removing}
        title="حذف التقييم"
        body={removing ? `يُحذف تقييم ${removing.first_name || '—'} (${branchLabel(removing.branch)}) نهائيًا. لم يُنشر هذا التقييم من قبل، فلا يتغير شيء على الموقع.` : ''}
        confirmLabel="حذف التقييم"
        danger
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

function ReviewForm({ item, editable, busy, setBusy, onSaved }: { item: Review | null; editable: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState<ReviewFields>(() => (item ? pickReview(item) : blankReview()));
  const [error, setError] = useState<string | null>(null);
  const dis = !editable || busy;
  const set = <K extends keyof ReviewFields>(k: K, v: ReviewFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const problems = reviewProblems(f);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const r = await reviewSave(item?.id ?? null, f);
      toast(r.problems.length ? 'حُفظت المسودة؛ فيها ملاحظات تمنع النشر.' : 'حُفظ؛ لا يظهر على الموقع قبل «نشر».', r.problems.length ? 'error' : undefined);
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4" data-review-form>
      {item?.live && item.pending && <p className="note-amber text-sm" role="status">فيه تعديلات لم تُنشر بعد؛ الموقع يعرض آخر نسخة منشورة.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="الاسم الأول للضيف" id="review-name" hint="كما يظهر في Google، الاسم الأول فقط.">
          <input id="review-name" className="field" dir="auto" value={f.first_name} maxLength={REVIEW_MAX.name} onChange={(e) => set('first_name', e.target.value)} disabled={dis} autoComplete="off" data-field="first_name" />
        </Field>
        <div>
          <span className="label">النجوم</span>
          <Segmented value={String(f.stars) as '1' | '2' | '3' | '4' | '5'} onChange={(v) => set('stars', Number(v))} label="النجوم" disabled={dis} options={['5', '4', '3', '2', '1'].map((s) => ({ value: s as '1' | '2' | '3' | '4' | '5', label: s }))} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <span className="label">الفرع</span>
          <Segmented
            value={f.branch}
            onChange={(v) => setF((x) => ({ ...x, branch: v, source_url: x.source_url === LISTING[x.branch] || !x.source_url ? LISTING[v] : x.source_url }))}
            label="الفرع"
            disabled={dis}
            options={REVIEW_BRANCHES.map((b) => ({ value: b.key, label: b.label }))}
          />
        </div>
        <div>
          <span className="label">لغة التقييم</span>
          <Segmented value={f.lang} onChange={(v) => set('lang', v)} label="لغة التقييم" disabled={dis} options={REVIEW_LANGS.map((l) => ({ value: l.key, label: l.label }))} />
        </div>
      </div>
      <Field label="نص التقييم" id="review-text" hint="كما كتبه الضيف حرفيًا، و«…» مكان أي جزء محذوف. علامات التنصيص يضيفها الموقع.">
        <textarea id="review-text" className={`field min-h-32 ${f.lang === 'en' ? 'latin' : ''}`} dir={f.lang === 'en' ? 'ltr' : 'rtl'} lang={f.lang} value={f.text} maxLength={REVIEW_MAX.text} onChange={(e) => set('text', e.target.value)} disabled={dis} data-field="text" />
      </Field>
      <div className="flex justify-end -mt-3">
        <span className="text-xs text-ink-muted num">{f.text.length} / {REVIEW_MAX.text}</span>
      </div>
      <Field label="رابط المصدر" id="review-url" hint="صفحة الفرع على خرائط Google؛ يفتحها السهم بجانب التقييم.">
        <input id="review-url" className="field latin" dir="ltr" value={f.source_url} maxLength={REVIEW_MAX.url} onChange={(e) => set('source_url', e.target.value)} disabled={dis} autoComplete="off" data-field="source_url" />
      </Field>
      <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
        <input type="checkbox" className="size-4 accent-bronze-deep" checked={f.show_home} disabled={dis} onChange={(e) => set('show_home', e.target.checked)} data-field="show_home" />
        في الصفحة الرئيسية
      </label>
      {problems.length > 0 && (
        <div className="note-amber text-sm" role="status" data-review-problems>
          <p className="font-semibold">ملاحظات تمنع النشر (يمكن حفظ المسودة):</p>
          <ul className="list-disc ps-5">
            {problems.map((p, i) => <li key={i}>{reviewProblemText(p)}</li>)}
          </ul>
        </div>
      )}
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="review-save">
            {busy && <Spinner />} حفظ
          </button>
        )}
      </div>
    </div>
  );
}
