// «الأسئلة الشائعة» — the dashboard FAQ module (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «FAQ…»). The questions of
// /faq/ under their four categories, in the site's order:
//   - drag a question within its category to reorder it («تقديم» / «تأخير» from the keyboard); its chips say what the
//     site shows (منشور / مخفي / مسودة), unpublished changes, and what blocks publishing;
//   - «إضافة سؤال» / «تعديل» opens the form (the shared Modal and its dirty guard): the deep-link key (fixed once
//     published), the category, «إخفاء من الموقع», the question and the answer in Arabic and English side by side. The
//     fees are chips — {breakfast} / {extra_bed}, filled from the pricing settings when the site is built — and a chip of
//     the published answer cannot be deleted. The checks (both languages, length, forbidden terms, placeholders, digits,
//     no typed rate or phone) show while typing; save keeps a draft, a problem blocks «نشر»;
//   - «نشر» publishes the whole page (the content permission's publish level) and asks for the site build (site-rebuild,
//     reason faq). Nothing reaches the site before «نشر».
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { countWord, type CountNoun } from '../lib/format';
import { blankFaq, FAQ_CATEGORIES, FAQ_MAX, faqItems, faqPublish, faqReorder, faqSave, keyFrom, KEY_RE, liveState, pickFaq, type FaqCategory, type FaqFields, type FaqItem, type FaqPublishResult } from '../lib/faq';
import { copyProblems, placeholdersOf, problemText, type CopyProblem } from '../lib/copy';
import PlaceholderEditor, { insertPlaceholder, PLACEHOLDERS } from '../components/PlaceholderEditor';
import { CancelButton, Empty, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';

const QUESTION: CountNoun = { zero: 'لا أسئلة', one: 'سؤال واحد', two: 'سؤالان', few: 'أسئلة', many: 'سؤالًا', gen: 'سؤال' };
const LIVE_LABEL = { draft: 'مسودة لم تُنشر', published: 'منشور', hidden: 'مخفي من الموقع' } as const;

export default function Faq() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'content');
  const publisher = api.canPublish(me, 'content');
  const [items, setItems] = useState<FaqItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FaqItem | { new: FaqCategory } | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [blocked, setBlocked] = useState<FaqPublishResult | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await faqItems());
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const ordered = useMemo(() => {
    const list = items ?? [];
    return FAQ_CATEGORIES.flatMap((c) => list.filter((i) => i.category === c.key).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key)));
  }, [items]);
  const pending = ordered.filter((i) => i.pending).length;

  async function reorder(ids: string[]) {
    try {
      await faqReorder(ids);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    await load();
  }
  function move(item: FaqItem, by: number) {
    const inCat = ordered.filter((i) => i.category === item.category);
    const at = inCat.indexOf(item);
    const to = at + by;
    if (to < 0 || to >= inCat.length) return;
    const ids = ordered.map((i) => i.id);
    const a = ids.indexOf(item.id);
    const b = ids.indexOf(inCat[to].id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    void reorder(ids);
  }
  function drop(target: FaqItem) {
    const dragged = ordered.find((i) => i.id === dragId);
    setDragId(null);
    setOverId(null);
    if (!dragged || dragged.id === target.id || dragged.category !== target.category) return;
    const ids = ordered.map((i) => i.id).filter((x) => x !== dragged.id);
    const down = ordered.indexOf(dragged) < ordered.indexOf(target);
    ids.splice(ids.indexOf(target.id) + (down ? 1 : 0), 0, dragged.id);
    void reorder(ids);
  }

  async function publish() {
    setPublishing(true);
    try {
      const r = await faqPublish();
      if (r.ok && r.job_id) {
        setBlocked(null);
        const rb = await api.siteRebuild('faq', r.job_id);
        toast(
          rb.ok && rb.dispatched ? `نُشر ${countWord(r.count ?? 0, QUESTION)}: يُبنى الموقع الآن ويظهر التغيير خلال دقائق.` : rb.reason === 'no_token' ? 'حُفظ النشر؛ يظهر على الموقع مع إعادة البناء التالية.' : 'حُفظ النشر لكن تعذّر بدء البناء؛ يظهر مع إعادة البناء التالية.',
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

  if (items === null) return <Loading />;
  return (
    <div className="grid gap-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">الأسئلة الشائعة</h1>
          <p className="text-sm text-ink-muted mt-1">
            أسئلة صفحة /faq/ وإجاباتها بالعربية والإنجليزية، في أربع فئات. اسحب السؤال لتغيير ترتيبه داخل فئته. لا يظهر أي تعديل على الموقع قبل «نشر».
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : !publisher ? ' النشر لمن يملك صلاحية «نشر» في «المحتوى».' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && <button type="button" className="btn btn-ghost" onClick={() => setEditing({ new: 'booking' })} data-action="faq-add">إضافة سؤال</button>}
          {publisher && (
            <button type="button" className="btn btn-primary" onClick={publish} disabled={publishing || !pending} data-action="faq-publish">
              {publishing && <Spinner />} نشر{pending ? ` (${pending})` : ''}
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {!ordered.length && <Empty text="لا أسئلة بعد." />}
      {FAQ_CATEGORIES.map((c) => {
        const list = ordered.filter((i) => i.category === c.key);
        return (
          <section key={c.key} className="card p-4" aria-labelledby={`faq-cat-${c.key}`} data-faq-category={c.key}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 id={`faq-cat-${c.key}`} className="font-bold text-lg">{c.label} <span className="text-sm font-normal text-ink-muted">· {countWord(list.length, QUESTION)}</span></h2>
              {editable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ new: c.key })} aria-label={`إضافة سؤال في «${c.label}»`} data-action="faq-add-here">إضافة سؤال</button>}
            </div>
            {!list.length ? (
              <p className="text-sm text-ink-muted">لا أسئلة في هذه الفئة.</p>
            ) : (
              <ol className="grid">
                {list.map((f, n) => {
                  const state = liveState(f);
                  return (
                    <li
                      key={f.id}
                      className={`drag-row grid gap-1.5 border-b border-line last:border-0 py-3 ${dragId === f.id ? 'is-drag' : ''} ${overId === f.id && dragId !== f.id ? 'is-over' : ''}`}
                      draggable={editable}
                      onDragStart={(e) => {
                        setDragId(f.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', f.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      onDragOver={(e) => {
                        const d = ordered.find((i) => i.id === dragId);
                        if (d && d.category === f.category) {
                          e.preventDefault();
                          setOverId(f.id);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        drop(f);
                      }}
                      data-faq-row={f.key}
                      data-faq-state={state}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{f.q_ar || <span className="text-ink-muted">بلا سؤال بالعربية</span>}</div>
                          <div className="latin text-xs text-ink-muted mt-0.5" dir="ltr">{f.q_en}</div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            <span className={`chip ${state === 'published' ? 'chip-confirmed' : 'chip-request'}`} data-live>{LIVE_LABEL[state]}</span>
                            {f.live && f.pending && <span className="chip chip-request" data-pending>تعديلات غير منشورة</span>}
                            {!f.live && <span className="chip chip-request" data-pending>بانتظار النشر</span>}
                            {f.check.missing.length > 0 && <span className="chip chip-test" data-missing>{countWord(f.check.missing.length, { zero: '', one: 'ملاحظة تمنع النشر', two: 'ملاحظتان تمنعان النشر', few: 'ملاحظات تمنع النشر', many: 'ملاحظة تمنع النشر', gen: 'ملاحظة' })}</span>}
                            {placeholdersOf(f.a_ar).map((p) => <span key={p} className="ph-chip">{PLACEHOLDERS[p] ?? p}</span>)}
                            <span className="text-xs text-ink-muted latin num" dir="ltr">/faq/#{f.key}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {editable && list.length > 1 && (
                            <>
                              <button type="button" className="btn btn-ghost btn-sm" disabled={n === 0} onClick={() => move(f, -1)} aria-label={`تقديم «${f.q_ar}»`} data-action="faq-earlier">تقديم</button>
                              <button type="button" className="btn btn-ghost btn-sm" disabled={n === list.length - 1} onClick={() => move(f, 1)} aria-label={`تأخير «${f.q_ar}»`} data-action="faq-later">تأخير</button>
                            </>
                          )}
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(f)} data-action="faq-edit">{editable ? 'تعديل' : 'عرض'}</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing && 'new' in editing ? 'إضافة سؤال' : editing ? (editable ? 'تعديل السؤال' : 'السؤال') : ''} wide busy={busy}>
        {editing !== null && (
          <FaqForm
            key={'new' in editing ? `new-${editing.new}` : editing.id}
            item={'new' in editing ? null : editing}
            category={'new' in editing ? editing.new : editing.category}
            taken={new Set(ordered.map((i) => i.key))}
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
          <div className="grid gap-3" data-faq-blocked>
            <p className="text-sm text-ink-muted">لا تُنشر الصفحة وفيها سؤال ظاهر به ملاحظة. صحّح ما يلي ثم انشر:</p>
            <ul className="grid gap-2">
              {(blocked.blocked ?? []).map((x) => (
                <li key={x.id} className="text-sm" data-blocked-faq={x.key}>
                  <strong>{x.q_ar || x.key}</strong>
                  <ul className="list-disc ps-5 text-ink-muted">
                    {x.missing.map((m, i) => <li key={i}>{m.part === 'q' ? 'السؤال: ' : 'الإجابة: '}{problemText(m)}</li>)}
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
    </div>
  );
}

function FaqForm({ item, category, taken, editable, busy, setBusy, onSaved }: { item: FaqItem | null; category: FaqCategory; taken: Set<string>; editable: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState<FaqFields>(() => (item ? pickFaq(item) : blankFaq(category)));
  const [error, setError] = useState<string | null>(null);
  const locked = !!item?.first_published_at;
  const dis = !editable || busy;
  const set = <K extends keyof FaqFields>(k: K, v: FaqFields[K]) => setF((x) => ({ ...x, [k]: v }));
  // the placeholders of the published answer can never be removed
  const protect = useMemo(() => placeholdersOf(`${item?.live?.a_ar ?? ''} ${item?.live?.a_en ?? ''}`), [item]);
  const problems: CopyProblem[] = f.hidden ? [] : [
    ...copyProblems(f.q_ar, f.q_en, FAQ_MAX.q).map((p) => ({ ...p, part: 'q' as const })),
    ...copyProblems(f.a_ar, f.a_en, FAQ_MAX.a, protect).map((p) => ({ ...p, part: 'a' as const })),
  ];
  const keyProblem = !KEY_RE.test(f.key) || f.key.length < 2 || f.key.length > 60 ? 'الرابط: حروف إنجليزية صغيرة وأرقام وشرطات (حرفان على الأقل).'
    : f.key !== item?.key && taken.has(f.key) ? 'هذا الرابط مستخدم لسؤال آخر.' : null;

  async function save() {
    setError(null);
    if (keyProblem) {
      setError(keyProblem);
      return;
    }
    setBusy(true);
    try {
      const r = await faqSave(item?.id ?? null, f);
      toast(r.check.missing.length ? 'حُفظت المسودة؛ فيها ملاحظات تمنع النشر.' : 'حُفظ؛ لا يظهر على الموقع قبل «نشر».', r.check.missing.length ? 'error' : undefined);
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const answer = (lang: 'ar' | 'en') => (
    <div className="grid gap-1.5">
      <span className="label" id={`faq-a-${lang}-label`}>{lang === 'ar' ? 'الإجابة بالعربية' : 'الإجابة بالإنجليزية'}</span>
      <PlaceholderEditor id={`faq-a-${lang}`} lang={lang} value={lang === 'ar' ? f.a_ar : f.a_en} onChange={(v) => set(lang === 'ar' ? 'a_ar' : 'a_en', v)} protect={protect} disabled={dis} labelledBy={`faq-a-${lang}-label`} maxLength={FAQ_MAX.a} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editable ? (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PLACEHOLDERS).map(([k, label]) => (
              <button key={k} type="button" className="btn btn-ghost btn-sm" disabled={dis} onClick={() => insertPlaceholder(`faq-a-${lang}`, k)} data-action={`faq-insert-${k}-${lang}`}>إدراج: {label}</button>
            ))}
          </div>
        ) : <span />}
        <span className="text-xs text-ink-muted num">{(lang === 'ar' ? f.a_ar : f.a_en).length} / {FAQ_MAX.a}</span>
      </div>
    </div>
  );

  return (
    <div className="grid gap-4" data-faq-form>
      {item?.live && item.pending && <p className="note-amber text-sm" role="status">فيه تعديلات لم تُنشر بعد؛ الموقع يعرض آخر نسخة منشورة.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="رابط السؤال" id="faq-key" hint={locked ? `ثابت بعد النشر: /faq/#${f.key}` : `حروف إنجليزية صغيرة وأرقام وشرطات: /faq/#${f.key || '…'}`}>
          <input id="faq-key" className="field latin" dir="ltr" value={f.key} maxLength={60} disabled={dis || locked} autoComplete="off"
            onChange={(e) => set('key', e.target.value.toLowerCase())}
            onFocus={() => { if (!f.key && f.q_en) set('key', keyFrom(f.q_en)); }} data-field="key" />
        </Field>
        <div>
          <span className="label">الفئة</span>
          <Segmented value={f.category} onChange={(v) => set('category', v)} label="الفئة" disabled={dis} options={FAQ_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="السؤال بالعربية" id="faq-q-ar">
          <input id="faq-q-ar" className="field" dir="rtl" lang="ar" value={f.q_ar} maxLength={FAQ_MAX.q} onChange={(e) => set('q_ar', e.target.value)} disabled={dis} data-field="q_ar" />
        </Field>
        <Field label="السؤال بالإنجليزية" id="faq-q-en">
          <input id="faq-q-en" className="field latin" dir="ltr" lang="en" value={f.q_en} maxLength={FAQ_MAX.q} onChange={(e) => set('q_en', e.target.value)} disabled={dis} data-field="q_en" />
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {answer('ar')}
        {answer('en')}
      </div>
      <p className="text-xs text-ink-muted">«{PLACEHOLDERS.breakfast}» و«{PLACEHOLDERS.extra_bed}» حقول تُملأ من إعدادات الأسعار عند بناء الموقع؛ لا تكتب المبلغ نفسه.{protect.length ? ' الحقول الموجودة في الإجابة المنشورة لا تُحذف.' : ''}</p>
      <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
        <input type="checkbox" className="size-4 accent-bronze-deep" checked={f.hidden} disabled={dis} onChange={(e) => set('hidden', e.target.checked)} data-field="hidden" />
        إخفاء هذا السؤال من الموقع
      </label>
      {problems.length > 0 && (
        <div className="note-amber text-sm" role="status" data-faq-problems>
          <p className="font-semibold">ملاحظات تمنع النشر (يمكن حفظ المسودة):</p>
          <ul className="list-disc ps-5">
            {problems.map((p, i) => <li key={i}>{p.part === 'q' ? 'السؤال: ' : 'الإجابة: '}{problemText(p)}</li>)}
          </ul>
        </div>
      )}
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="faq-save">
            {busy && <Spinner />} حفظ
          </button>
        )}
      </div>
    </div>
  );
}
