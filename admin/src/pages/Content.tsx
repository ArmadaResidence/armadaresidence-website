// «المحتوى» — content & visibility (Ahmed, 3 Nov 2026; DASHBOARD-SPEC.md §3.7; DECISIONS.md 2026-11-03 «Content &
// visibility…»). Three tabs, each with draft → «نشر» (the content permission's publish level; the site is rebuilt):
//   - «النصوص»: the curated texts of the site, Arabic and English side by side (the fee placeholders as chips that cannot
//     be removed). Save keeps a draft (every save is a revision); the checks — both languages, the length, the forbidden
//     terms, the Airport Road description's «شقق فندقية» / "hotel apartments", the placeholders, Western digits, no typed
//     rate or phone — show while typing and block «نشر». «السجل» lists the revisions with a word diff against the current
//     draft and «استرجاع» (the restored text becomes the draft; publishing it is a separate step).
//   - «الظهور على الموقع»: show / hide each branch, room type and section; «نشر» opens a confirmation that says what
//     hiding does (no page, not bookable, out of the sitemap and the links, the URL redirects to the parent page). The
//     price switches stay in «الإعدادات» (a link).
//   - «شريط الإعلان»: one system for the bar at the top of the site — a featured offer or a custom text with an optional
//     link, between two dates; one active at a time (publishing refuses an overlap).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, countWord, longDate, riyadhDateTime, type CountNoun } from '../lib/format';
import { copyProblems, placeholdersOf, problemText, type CopyProblem } from '../lib/copy';
import {
  ANN_MISSING, ANN_STATE, announcements, diffWords, fields, GROUPS, liveOffers, publish, publishAnnouncement, publishVisibility, restore, REVISION_LABEL,
  revisions, save, saveAnnouncement, SECTION_EFFECT, setVisible, unpublishAnnouncement, visibility, type Announcement, type AnnouncementFields,
  type ContentField, type PublishResult, type Revision, type Visibility,
} from '../lib/content';
import PlaceholderEditor from '../components/PlaceholderEditor';
import DateField from '../components/DateField';
import { CancelButton, Confirm, Empty, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';

const TEXT: CountNoun = { zero: 'لا نصوص', one: 'نص واحد', two: 'نصان', few: 'نصوص', many: 'نصًا', gen: 'نص' };
type Tab = 'texts' | 'visibility' | 'bar';

/** the toast after a publish: the build was asked for, or will follow */
async function rebuildToast(r: PublishResult, toast: ReturnType<typeof useToast>, what: string) {
  if (!r.job_id) return;
  const rb = await api.siteRebuild('content', r.job_id);
  toast(rb.ok && rb.dispatched ? `${what}: يُبنى الموقع الآن ويظهر التغيير خلال دقائق.` : rb.reason === 'no_token' ? `${what}؛ يظهر على الموقع مع إعادة البناء التالية.` : `${what}، لكن تعذّر بدء البناء؛ يظهر مع إعادة البناء التالية.`, rb.ok && rb.dispatched ? undefined : 'error');
}

export default function Content() {
  const { me } = useSession();
  const [tab, setTab] = useState<Tab>('texts');
  const editable = api.canEdit(me, 'content');
  const publisher = api.canPublish(me, 'content');
  return (
    <div className="grid gap-5 max-w-5xl">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold">المحتوى والظهور</h1>
        <p className="text-sm text-ink-muted mt-1">
          نصوص مختارة من الموقع، وما يظهر منه وما يُخفى، وشريط الإعلان أعلى الصفحات. لا يتغير شيء على الموقع قبل «نشر».
          {!editable ? ' صلاحيتك هنا للعرض فقط.' : !publisher ? ' النشر لمن يملك صلاحية «نشر» في «المحتوى».' : ''}
        </p>
      </div>
      <Segmented value={tab} onChange={setTab} label="أقسام المحتوى" size="md" options={[{ value: 'texts', label: 'النصوص' }, { value: 'visibility', label: 'الظهور على الموقع' }, { value: 'bar', label: 'شريط الإعلان' }]} />
      {tab === 'texts' && <Texts editable={editable} publisher={publisher} />}
      {tab === 'visibility' && <VisibilityTab editable={editable && !me?.branch} publisher={publisher && !me?.branch} />}
      {tab === 'bar' && <Bar editable={editable && !me?.branch} publisher={publisher && !me?.branch} />}
    </div>
  );
}

// ── texts ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Texts({ editable, publisher }: { editable: boolean; publisher: boolean }) {
  const toast = useToast();
  const [list, setList] = useState<ContentField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContentField | null>(null);
  const [history, setHistory] = useState<ContentField | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<PublishResult | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setList(await fields());
    } catch (e) {
      setError((e as Error).message);
      setList([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function doPublish(keys: string[] | null) {
    setPublishing(keys ? keys[0] : 'all');
    try {
      const r = await publish(keys);
      if (r.ok) {
        setBlocked(null);
        await rebuildToast(r, toast, `نُشر ${countWord(r.count ?? 0, TEXT)}`);
        await load();
      } else if (r.reason === 'nothing') toast('لا تعديلات للنشر.');
      else setBlocked(r);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPublishing(null);
    }
  }

  if (list === null) return <Loading />;
  const pending = list.filter((f) => f.pending);
  return (
    <div className="grid gap-4" data-content-texts>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">العربية والإنجليزية جنبًا إلى جنب. «نص الملف» يعني أن الموقع يعرض النص الأصلي ولم يُنشر له تعديل من هنا.</p>
        {publisher && (
          <button type="button" className="btn btn-primary" onClick={() => doPublish(null)} disabled={!!publishing || !pending.length} data-action="content-publish-all">
            {publishing === 'all' && <Spinner />} نشر الكل{pending.length ? ` (${pending.length})` : ''}
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {GROUPS.map((g) => {
        const rows = list.filter((f) => f.grp === g.key);
        if (!rows.length) return null;
        return (
          <section key={g.key} className="card p-4" aria-labelledby={`cg-${g.key}`} data-content-group={g.key}>
            <h2 id={`cg-${g.key}`} className="font-bold text-lg mb-2">{g.label}</h2>
            <ul className="grid">
              {rows.map((f) => (
                <li key={f.key} className="flex flex-wrap items-start justify-between gap-3 border-b border-line last:border-0 py-3" data-content-field={f.key}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{f.label_ar}</div>
                    <p className="text-sm text-ink-muted mt-0.5 line-clamp-2">{f.draft_ar}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className={`chip ${f.live_ar !== null ? 'chip-confirmed' : 'chip-request'}`} data-live>{f.live_ar !== null ? `منشور من اللوحة ${f.published_at ? riyadhDateTime(f.published_at) : ''}` : 'نص الملف'}</span>
                      {f.pending && <span className="chip chip-request" data-pending>تعديلات غير منشورة</span>}
                      {f.pending && f.check.missing.length > 0 && <span className="chip chip-test" data-missing>ملاحظات تمنع النشر</span>}
                      {placeholdersOf(f.draft_ar).map((p) => <span key={p} className="ph-chip">{p === 'breakfast' ? 'سعر الإفطار' : 'رسم السرير الإضافي'}</span>)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHistory(f)} data-action="content-history">السجل</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(f)} data-action="content-edit">{editable ? 'تعديل' : 'عرض'}</button>
                    {publisher && f.pending && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => doPublish([f.key])} disabled={!!publishing} data-action="content-publish">
                        {publishing === f.key && <Spinner />} نشر
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? (editable ? `تعديل: ${editing.label_ar}` : editing.label_ar) : ''} wide busy={busy}>
        {editing && (
          <TextForm key={editing.key} field={editing} editable={editable} busy={busy} setBusy={setBusy}
            onSaved={async () => { setEditing(null); await load(); }} />
        )}
      </Modal>
      <Modal open={!!history} onClose={() => setHistory(null)} title={history ? `السجل: ${history.label_ar}` : ''} wide>
        {history && <History key={history.key} field={history} editable={editable} onRestored={async () => { setHistory(null); await load(); }} />}
      </Modal>
      <Modal open={!!blocked} onClose={() => setBlocked(null)} title="ما يمنع النشر">
        {blocked && (
          <div className="grid gap-3" data-content-blocked>
            <p className="text-sm text-ink-muted">لا يُنشر نص فيه ملاحظة. صحّح ما يلي ثم انشر:</p>
            <ul className="grid gap-2">
              {(blocked.blocked ?? []).map((x) => (
                <li key={x.key} className="text-sm" data-blocked-field={x.key}>
                  <strong>{x.label_ar}</strong>
                  <ul className="list-disc ps-5 text-ink-muted">{x.missing.map((m, i) => <li key={i}>{problemText(m)}</li>)}</ul>
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><CancelButton label="إغلاق" /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TextForm({ field, editable, busy, setBusy, onSaved }: { field: ContentField; editable: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [ar, setAr] = useState(field.draft_ar);
  const [en, setEn] = useState(field.draft_en);
  const [error, setError] = useState<string | null>(null);
  const protect = useMemo(() => placeholdersOf(`${field.seed_ar} ${field.seed_en} ${field.live_ar ?? ''} ${field.live_en ?? ''}`), [field]);
  const problems: CopyProblem[] = copyProblems(ar, en, field.max_len, protect, field.need);
  const dis = !editable || busy;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const r = await save(field.key, ar, en);
      toast(r.already ? 'لا تغيير لحفظه.' : r.check.missing.length ? 'حُفظت المسودة؛ فيها ملاحظات تمنع النشر.' : 'حُفظت المسودة؛ لا تظهر على الموقع قبل «نشر».', r.check.missing.length ? 'error' : undefined);
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const editor = (lang: 'ar' | 'en') => {
    const v = lang === 'ar' ? ar : en;
    return (
      <div className="grid gap-1.5">
        <span className="label" id={`ct-${lang}-label`}>{lang === 'ar' ? 'بالعربية' : 'بالإنجليزية'}</span>
        <PlaceholderEditor id={`ct-${lang}`} lang={lang} value={v} onChange={lang === 'ar' ? setAr : setEn} protect={protect} disabled={dis} singleLine={!field.multiline}
          labelledBy={`ct-${lang}-label`} maxLength={field.max_len} />
        <span className={`text-xs num ${v.length > field.max_len ? 'media-err' : 'text-ink-muted'}`}>{v.length} / {field.max_len}</span>
      </div>
    );
  };
  return (
    <div className="grid gap-4" data-content-form={field.key}>
      {field.live_ar !== null && field.pending && <p className="note-amber text-sm" role="status">فيه تعديلات لم تُنشر بعد؛ الموقع يعرض آخر نسخة منشورة.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {editor('ar')}
        {editor('en')}
      </div>
      {field.multiline && <p className="text-xs text-ink-muted">سطر فارغ بين فقرتين يبدأ فقرة جديدة.</p>}
      {protect.length > 0 && <p className="text-xs text-ink-muted">«سعر الإفطار» و«رسم السرير الإضافي» حقول تُملأ من إعدادات الأسعار عند بناء الموقع، ولا تُحذف من هذا النص.</p>}
      {problems.length > 0 && (
        <div className="note-amber text-sm" role="status" data-content-problems>
          <p className="font-semibold">ملاحظات تمنع النشر (يمكن حفظ المسودة):</p>
          <ul className="list-disc ps-5">{problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}</ul>
        </div>
      )}
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && <button type="button" className="btn btn-primary" onClick={submit} disabled={busy} data-action="content-save">{busy && <Spinner />} حفظ</button>}
      </div>
    </div>
  );
}

function Diff({ from, to }: { from: string; to: string }) {
  return (
    <p className="text-sm leading-7 whitespace-pre-wrap" data-diff>
      {diffWords(from, to).map(([k, t], i) => (k === 'same' ? <span key={i}>{t}</span> : k === 'del' ? <del key={i} className="diff-del">{t}</del> : <ins key={i} className="diff-add">{t}</ins>))}
    </p>
  );
}

function History({ field, editable, onRestored }: { field: ContentField; editable: boolean; onRestored: () => Promise<void> }) {
  const toast = useToast();
  const [list, setList] = useState<Revision[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    revisions(field.key).then(setList).catch(() => setList([]));
  }, [field.key]);
  async function doRestore(r: Revision) {
    setBusy(true);
    try {
      // the original text (the file's) has no revision row: restoring it saves it as the draft
      if (r.id === 0) await save(field.key, field.seed_ar, field.seed_en);
      else await restore(r.id);
      toast('استُرجع النص في المسودة؛ انشره ليظهر على الموقع.');
      setConfirm(null);
      await onRestored();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  if (list === null) return <Loading />;
  const original: Revision = { id: 0, field_key: field.key, kind: 'save', text_ar: field.seed_ar, text_en: field.seed_en, at: '', actor_label: null, restored_from: null };
  const rows = [...list, original];
  return (
    <div className="grid gap-3" data-content-history>
      <p className="text-sm text-ink-muted">الفرق بين كل نسخة والمسودة الحالية: <del className="diff-del">المحذوف</del> و<ins className="diff-add">المضاف</ins>.</p>
      <ol className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className="card p-3 grid gap-2" data-revision={r.id} data-revision-kind={r.id ? r.kind : 'original'}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`chip ${r.kind === 'publish' ? 'chip-confirmed' : 'chip-request'}`}>{r.id ? REVISION_LABEL[r.kind] : 'النص الأصلي (من ملف الموقع)'}</span>
              {r.at && <span className="num text-ink-muted">{riyadhDateTime(r.at)}</span>}
              {r.actor_label && <span className="text-ink-muted">· {r.actor_label}</span>}
              <span className="ms-auto flex gap-1.5">
                <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} data-action="revision-diff">{open === r.id ? 'إخفاء الفرق' : 'عرض الفرق'}</button>
                {editable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(r)} data-action="revision-restore">استرجاع هذه النسخة</button>}
              </span>
            </div>
            {open === r.id && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div dir="rtl" lang="ar"><Diff from={r.text_ar} to={field.draft_ar} /></div>
                <div dir="ltr" lang="en" className="latin"><Diff from={r.text_en} to={field.draft_en} /></div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex justify-end"><CancelButton label="إغلاق" /></div>
      <Confirm open={!!confirm} title="استرجاع نسخة سابقة" body="يصبح نص هذه النسخة هو المسودة الحالية (بالعربية والإنجليزية). لا يتغير الموقع قبل «نشر»." confirmLabel="استرجاع النسخة" onConfirm={() => confirm && doRestore(confirm)} onClose={() => setConfirm(null)} busy={busy} />
    </div>
  );
}

// ── visibility ─────────────────────────────────────────────────────────────────────────────────────────────────

function VisibilityTab({ editable, publisher }: { editable: boolean; publisher: boolean }) {
  const toast = useToast();
  const [list, setList] = useState<Visibility[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(async () => {
    try {
      setError(null);
      setList(await visibility());
    } catch (e) {
      setError((e as Error).message);
      setList([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function toggle(v: Visibility) {
    setBusy(v.key);
    try {
      await setVisible(v.key, !v.visible);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function doPublish() {
    setBusy('publish');
    try {
      const r = await publishVisibility();
      setConfirm(false);
      if (r.ok) await rebuildToast(r, toast, 'نُشر الظهور');
      else toast('لا تغييرات للنشر.');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  if (list === null) return <Loading />;
  const changes = list.filter((v) => v.visible !== v.live_visible);
  const groups: { title: string; rows: Visibility[] }[] = [
    { title: 'الفروع', rows: list.filter((v) => v.kind === 'branch') },
    ...Object.keys(BRANCH_NAMES).map((b) => ({ title: `غرف ${BRANCH_NAMES[b]}`, rows: list.filter((v) => v.kind === 'room' && v.branch === b) })),
    { title: 'الأقسام', rows: list.filter((v) => v.kind === 'section') },
  ];
  const effect = (v: Visibility) => (v.kind === 'branch' ? 'تختفي صفحة الفرع وصفحات غرفه وقاعته ومطاعمه، ويُخرج من نموذج الحجز وزر واتساب، ويُحوَّل رابطه إلى الصفحة الرئيسية.'
    : v.kind === 'room' ? 'تختفي صفحة الغرفة وبطاقتها، ولا تُحجز من الموقع، ويُحوَّل رابطها إلى صفحة الفرع.' : SECTION_EFFECT[v.key] ?? '');
  return (
    <div className="grid gap-4" data-content-visibility>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted max-w-2xl">
          المخفي لا صفحة له على الموقع، ولا يُحجز، ويخرج من خريطة الموقع ومن الروابط، ويُحوَّل رابطه إلى الصفحة الأعلى. إظهار الأسعار وإخفاؤها لكل فرع في{' '}
          <Link to="/settings" className="text-accent-text underline" data-link="settings">الإعدادات</Link>.
        </p>
        {publisher && (
          <button type="button" className="btn btn-primary" onClick={() => setConfirm(true)} disabled={!changes.length || !!busy} data-action="visibility-publish">
            نشر التغييرات{changes.length ? ` (${changes.length})` : ''}
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {groups.filter((g) => g.rows.length).map((g) => (
        <section key={g.title} className="card p-4" aria-label={g.title}>
          <h2 className="font-bold text-lg mb-2">{g.title}</h2>
          <ul className="grid">
            {g.rows.map((v) => (
              <li key={v.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-line last:border-0 py-2.5" data-visibility={v.key} data-visible={v.visible} data-live-visible={v.live_visible}>
                <div className="min-w-0">
                  <div className="font-semibold">{v.label_ar}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <span className={`chip ${v.live_visible ? 'chip-confirmed' : 'chip-cancelled'}`}>على الموقع: {v.live_visible ? 'ظاهر' : 'مخفي'}</span>
                    {v.visible !== v.live_visible && <span className="chip chip-request" data-pending>بانتظار النشر: {v.visible ? 'إظهار' : 'إخفاء'}</span>}
                  </div>
                </div>
                <button type="button" className={`chip-toggle ${v.visible ? 'is-on' : ''}`} aria-pressed={v.visible} disabled={!editable || !!busy} onClick={() => toggle(v)}
                  aria-label={`${v.label_ar}: ${v.visible ? 'ظاهر' : 'مخفي'}`} data-action="visibility-toggle">
                  {busy === v.key && <Spinner />} {v.visible ? 'ظاهر' : 'مخفي'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Confirm open={confirm} title="نشر الظهور على الموقع" confirmLabel="نشر التغييرات" danger={changes.some((c) => !c.visible)} onConfirm={doPublish} onClose={() => setConfirm(false)} busy={busy === 'publish'}
        body={
          <div className="grid gap-2 text-sm" data-visibility-confirm>
            <p>سيُعاد بناء الموقع بهذه التغييرات:</p>
            <ul className="grid gap-1.5">
              {changes.map((c) => (
                <li key={c.key}><strong>{c.visible ? 'إظهار' : 'إخفاء'}: {c.label_ar}</strong>{!c.visible && <span className="block text-ink-muted">{effect(c)}</span>}</li>
              ))}
            </ul>
          </div>
        } />
    </div>
  );
}

// ── the announcement bar ───────────────────────────────────────────────────────────────────────────────────────

const blankAnn = (): AnnouncementFields => ({ kind: 'custom', offer_slug: null, text_ar: '', text_en: '', link: null, link_label_ar: '', link_label_en: '', starts_on: null, ends_on: null });

function Bar({ editable, publisher }: { editable: boolean; publisher: boolean }) {
  const toast = useToast();
  const [list, setList] = useState<Announcement[] | null>(null);
  const [offers, setOffers] = useState<{ slug: string; title_ar: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      setList(await announcements());
    } catch (e) {
      setError((e as Error).message);
      setList([]);
    }
  }, []);
  useEffect(() => {
    void load();
    liveOffers().then(setOffers).catch(() => setOffers([]));
  }, [load]);
  const offerName = (slug: string | null) => offers.find((o) => o.slug === slug)?.title_ar ?? slug ?? '';
  async function act(a: Announcement, kind: 'publish' | 'unpublish') {
    setActing(a.id);
    setProblem(null);
    try {
      const r = kind === 'publish' ? await publishAnnouncement(a.id) : await unpublishAnnouncement(a.id);
      if (r.ok) await rebuildToast(r, toast, kind === 'publish' ? 'نُشر الإعلان' : 'أُوقف الإعلان');
      else if (r.reason === 'overlap' && r.other) setProblem(`يتداخل مع إعلان منشور آخر (${r.other.kind === 'offer' ? offerName(r.other.offer) : r.other.text_ar})${r.other.ends_on ? ` حتى ${longDate(r.other.ends_on)}` : ''}. يظهر إعلان واحد فقط في كل يوم: غيّر التواريخ أو أوقف الإعلان الآخر.`);
      else if (r.reason === 'blocked') setProblem((r.missing ?? []).map((m) => ('lang' in m || m.code === 'required' ? problemText(m as CopyProblem) : ANN_MISSING[m.code])).join(' '));
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setActing(null);
    }
  }
  if (list === null) return <Loading />;
  return (
    <div className="grid gap-4" data-content-bar>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted max-w-2xl">شريط واحد أعلى كل صفحات الموقع: عرض مميز من «العروض» أو نص خاص برابط اختياري، بين تاريخين. يظهر إعلان واحد فقط في كل يوم.</p>
        {editable && <button type="button" className="btn btn-ghost" onClick={() => setEditing('new')} data-action="bar-add">إضافة إعلان</button>}
      </div>
      <ErrorBox error={error} />
      {problem && <p className="note-amber text-sm" role="alert" data-bar-problem>{problem}</p>}
      {!list.length ? <Empty text="لا إعلانات بعد." /> : (
        <ul className="grid gap-2">
          {list.map((a) => (
            <li key={a.id} className="card p-3 flex flex-wrap items-start justify-between gap-3" data-announcement={a.id} data-announcement-state={a.state}>
              <div className="min-w-0">
                <div className="font-semibold">{a.kind === 'offer' ? `عرض مميز: ${offerName(a.offer_slug)}` : a.text_ar}</div>
                <div className="flex flex-wrap gap-1.5 mt-1 text-xs">
                  <span className={`chip ${ANN_STATE[a.state].chip}`}>{ANN_STATE[a.state].label}</span>
                  {a.pending && <span className="chip chip-request">تعديلات غير منشورة</span>}
                  <span className="text-ink-muted num">{a.starts_on ? `من ${longDate(a.starts_on)}` : 'من اليوم'} · {a.ends_on ? `حتى ${longDate(a.ends_on)}` : 'بلا نهاية'}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(a)} data-action="bar-edit">{editable ? 'تعديل' : 'عرض'}</button>
                {publisher && (a.state === 'draft' || a.pending) && <button type="button" className="btn btn-primary btn-sm" disabled={!!acting} onClick={() => act(a, 'publish')} data-action="bar-publish">{acting === a.id && <Spinner />} نشر</button>}
                {publisher && a.live && <button type="button" className="btn btn-ghost btn-sm" disabled={!!acting} onClick={() => act(a, 'unpublish')} data-action="bar-unpublish">إيقاف النشر</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'إضافة إعلان' : 'تعديل الإعلان'} wide busy={busy}>
        {editing !== null && (
          <AnnouncementForm key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing} offers={offers} editable={editable} busy={busy} setBusy={setBusy}
            onSaved={async () => { setEditing(null); await load(); }} />
        )}
      </Modal>
    </div>
  );
}

function AnnouncementForm({ item, offers, editable, busy, setBusy, onSaved }: { item: Announcement | null; offers: { slug: string; title_ar: string }[]; editable: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState<AnnouncementFields>(() => (item ? { kind: item.kind, offer_slug: item.offer_slug, text_ar: item.text_ar, text_en: item.text_en, link: item.link, link_label_ar: item.link_label_ar, link_label_en: item.link_label_en, starts_on: item.starts_on, ends_on: item.ends_on } : blankAnn()));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AnnouncementFields>(k: K, v: AnnouncementFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const dis = !editable || busy;
  const problems = f.kind === 'custom' ? copyProblems(f.text_ar, f.text_en, 140) : [];
  async function submit() {
    setError(null);
    if (f.kind === 'offer' && !f.offer_slug) return setError('اختر العرض.');
    if (f.link && !/^(\/\S*|https:\/\/\S+)$/.test(f.link)) return setError('الرابط مسار في الموقع يبدأ بـ / أو رابط https كامل.');
    setBusy(true);
    try {
      await saveAnnouncement(item?.id ?? null, { ...f, link: f.link?.trim() || null });
      toast('حُفظ؛ لا يظهر على الموقع قبل «نشر».');
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4" data-announcement-form>
      <div>
        <span className="label">النوع</span>
        <Segmented value={f.kind} onChange={(v) => set('kind', v)} label="النوع" disabled={dis} options={[{ value: 'custom', label: 'نص خاص' }, { value: 'offer', label: 'عرض مميز' }]} />
      </div>
      {f.kind === 'offer' ? (
        <Field label="العرض" id="an-offer" hint="عروض «العروض» المنشورة؛ يظهر عنوانه ورابط «التفاصيل».">
          <select id="an-offer" className="field" value={f.offer_slug ?? ''} disabled={dis} onChange={(e) => set('offer_slug', e.target.value || null)} data-field="offer">
            <option value="">اختر عرضًا</option>
            {offers.map((o) => <option key={o.slug} value={o.slug}>{o.title_ar}</option>)}
          </select>
        </Field>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="النص بالعربية" id="an-text-ar" hint="حتى 140 حرفًا.">
              <input id="an-text-ar" className="field" dir="rtl" lang="ar" maxLength={140} value={f.text_ar} disabled={dis} onChange={(e) => set('text_ar', e.target.value)} data-field="text_ar" />
            </Field>
            <Field label="النص بالإنجليزية" id="an-text-en" hint="Up to 140 characters.">
              <input id="an-text-en" className="field latin" dir="ltr" lang="en" maxLength={140} value={f.text_en} disabled={dis} onChange={(e) => set('text_en', e.target.value)} data-field="text_en" />
            </Field>
          </div>
          <Field label="الرابط (اختياري)" id="an-link" hint="مسار في الموقع مثل /offers/ (يتبع لغة الصفحة)، أو رابط https كامل.">
            <input id="an-link" className="field latin" dir="ltr" maxLength={300} value={f.link ?? ''} disabled={dis} onChange={(e) => set('link', e.target.value || null)} data-field="link" />
          </Field>
          {f.link && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="نص الرابط بالعربية" id="an-label-ar">
                <input id="an-label-ar" className="field" dir="rtl" maxLength={30} value={f.link_label_ar} disabled={dis} onChange={(e) => set('link_label_ar', e.target.value)} data-field="link_label_ar" />
              </Field>
              <Field label="نص الرابط بالإنجليزية" id="an-label-en">
                <input id="an-label-en" className="field latin" dir="ltr" maxLength={30} value={f.link_label_en} disabled={dis} onChange={(e) => set('link_label_en', e.target.value)} data-field="link_label_en" />
              </Field>
            </div>
          )}
        </>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <DateField mode="single" label="من" value={f.starts_on ?? ''} onChange={(v) => set('starts_on', v || null)} id="an-from" disabled={dis} />
        <DateField mode="single" label="حتى" value={f.ends_on ?? ''} onChange={(v) => set('ends_on', v || null)} id="an-to" disabled={dis} />
      </div>
      <p className="text-xs text-ink-muted">بلا تاريخ بداية: من يوم النشر. بلا تاريخ نهاية: حتى إيقافه.</p>
      {problems.length > 0 && (
        <div className="note-amber text-sm" role="status" data-bar-problems>
          <ul className="list-disc ps-5">{problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}</ul>
        </div>
      )}
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && <button type="button" className="btn btn-primary" onClick={submit} disabled={busy} data-action="bar-save">{busy && <Spinner />} حفظ</button>}
      </div>
    </div>
  );
}
