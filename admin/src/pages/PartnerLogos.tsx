// «شعارات الشركاء» — the dashboard partner logos module (Ahmed, 7 Nov 2026), modelled on «آراء الضيوف» (Reviews.tsx).
// The logos of the home page's logo strip (the strip shows from 3 logos on the home page):
//   - the list in the site's order («تقديم» / «تأخير»), each logo previewed on Warm Porcelain and on Armada Midnight.
//     Chips say what the site shows (منشور / مسودة), unpublished changes, and what blocks publishing;
//   - «إضافة شعار» / «تعديل» opens the form (the shared Modal and its dirty guard): the file (SVG or PNG — an SVG is
//     cleaned and checked in the browser as the database checks it, a PNG read as base64, the size from the file), the
//     partner's name ar / en (the logo's alt text only — never shown on the page), «في الصفحة الرئيسية». The checks
//     show while typing; save keeps a draft, a problem blocks «نشر»;
//   - «حذف الشعار» only for a logo never published; a published one leaves the site by «في الصفحة الرئيسية» off + «نشر»;
//   - «نشر» publishes the whole list (the content permission's publish level) and asks for the site build (reason
//     partner_logos). Nothing reaches the site before «نشر».
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { countWord, type CountNoun } from '../lib/format';
import { LOGO_MAX, logoDelete, logoItems, logoName, logoProblems, logoProblemText, logoPublish, logoReorder, logoSave, logoSrc, pickLogo, readLogoFile, type LogoFields, type LogoPublishResult, type PartnerLogo } from '../lib/partner-logos';
import { CancelButton, Confirm, Empty, ErrorBox, Field, Loading, Modal, Spinner, useToast } from '../components/ui';

const LOGO: CountNoun = { zero: 'لا شعارات', one: 'شعار واحد', two: 'شعاران', few: 'شعارات', many: 'شعارًا', gen: 'شعار' };
/** the home page shows the strip only from this many logos (the site decides; the dashboard says so) */
const STRIP_MIN = 3;

/** the logo on the two backgrounds of the site */
function Previews({ f, name }: { f: { kind: 'svg' | 'png'; data: string }; name: string }) {
  return (
    <div className="flex flex-wrap gap-2" data-logo-previews>
      <span className="flex h-16 w-36 items-center justify-center rounded border border-line bg-porcelain p-2" title="على خلفية فاتحة">
        <img src={logoSrc(f)} alt={`${name} على خلفية فاتحة`} className="max-h-full max-w-full object-contain" />
      </span>
      <span className="flex h-16 w-36 items-center justify-center rounded border border-line bg-midnight p-2" title="على خلفية داكنة">
        <img src={logoSrc(f)} alt={`${name} على خلفية داكنة`} className="max-h-full max-w-full object-contain" />
      </span>
    </div>
  );
}

export default function PartnerLogos() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'content');
  const publisher = api.canPublish(me, 'content');
  const [items, setItems] = useState<PartnerLogo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PartnerLogo | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [blocked, setBlocked] = useState<LogoPublishResult | null>(null);
  const [removing, setRemoving] = useState<PartnerLogo | null>(null);
  // one reorder at a time: a second «تقديم» before the list reloads would swap against the old order
  const [reordering, setReordering] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await logoItems());
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
  /** the logos the home page shows now (published with «في الصفحة الرئيسية» on) */
  const onHome = ordered.filter((r) => r.published && r.live_show_home).length;

  async function move(r: PartnerLogo, by: number) {
    const ids = ordered.map((x) => x.id);
    const a = ids.indexOf(r.id);
    const b = a + by;
    if (b < 0 || b >= ids.length) return;
    [ids[a], ids[b]] = [ids[b], ids[a]];
    setReordering(true);
    try {
      await logoReorder(ids);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    await load();
    setReordering(false);
  }

  async function publish() {
    setPublishing(true);
    try {
      const r = await logoPublish();
      if (r.ok && r.job_id) {
        setBlocked(null);
        const rb = await api.siteRebuild('partner_logos', r.job_id);
        toast(
          rb.ok && rb.dispatched ? `نُشر ${countWord(r.count ?? 0, LOGO)}: يُبنى الموقع الآن ويظهر التغيير خلال دقائق.` : rb.reason === 'no_token' ? 'حُفظ النشر؛ يظهر على الموقع مع إعادة البناء التالية.' : 'حُفظ النشر لكن تعذّر بدء البناء؛ يظهر مع إعادة البناء التالية.',
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
      await logoDelete(removing.id);
      toast('حُذف الشعار.');
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
          <h1 className="text-2xl font-bold">شعارات الشركاء</h1>
          <p className="text-sm text-ink-muted mt-1" data-logo-strip-note>يظهر الشريط في الصفحة الرئيسية عندما تكون {STRIP_MIN} شعارات أو أكثر في الصفحة الرئيسية.</p>
          <p className="text-sm text-ink-muted mt-1">
            شعارات الشركاء بالترتيب الذي تظهر به. ارفع الشعار بصيغة SVG (الأفضل) أو PNG بخلفية شفافة. اسم الشريك نص بديل للشعار يقرؤه قارئ الشاشة ومحركات البحث، ولا يظهر على الصفحة. لا يظهر أي تعديل على الموقع قبل «نشر».
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : !publisher ? ' النشر لمن يملك صلاحية «نشر» في «المحتوى».' : ''}
          </p>
          <p className="text-sm mt-1" data-logo-home-count>
            في الصفحة الرئيسية الآن: {countWord(onHome, LOGO)}{onHome && onHome < STRIP_MIN ? '؛ لا يظهر الشريط بعد.' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && <button type="button" className="btn btn-ghost" onClick={() => setEditing('new')} data-action="logo-add">إضافة شعار</button>}
          {publisher && (
            <button type="button" className="btn btn-primary" onClick={publish} disabled={publishing || !pending} data-action="logo-publish">
              {publishing && <Spinner />} نشر{pending ? ` (${pending})` : ''}
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {!ordered.length ? (
        <Empty text="لا شعارات بعد." />
      ) : (
        <section className="card p-4" aria-label="الشعارات">
          <ol className="grid">
            {ordered.map((r, n) => {
              const state = r.published ? 'published' : 'draft';
              const name = logoName(r);
              return (
                <li key={r.id} className="grid gap-1.5 border-b border-line last:border-0 py-3" data-logo-row={r.id} data-state={state}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3">
                      <Previews f={r} name={name} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{r.name_ar || '—'}</div>
                        <div className="text-sm text-ink-muted latin" dir="ltr" lang="en">{r.name_en || '—'}</div>
                        <div className="text-xs text-ink-muted mt-0.5 num">{r.kind === 'svg' ? 'SVG' : 'PNG'} · {r.width} × {r.height}</div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className={`chip ${state === 'published' ? 'chip-confirmed' : 'chip-request'}`} data-live>{state === 'published' ? 'منشور' : 'مسودة لم تُنشر'}</span>
                          {r.published && r.pending && <span className="chip chip-request" data-pending>تعديلات غير منشورة</span>}
                          {r.published && r.live_show_home && <span className="chip chip-confirmed" data-on-home>يظهر الآن في الصفحة الرئيسية</span>}
                          {!r.show_home && <span className="chip chip-request">ليس في الصفحة الرئيسية</span>}
                          {r.problems.length > 0 && <span className="chip chip-test" data-missing>{countWord(r.problems.length, { zero: '', one: 'ملاحظة تمنع النشر', two: 'ملاحظتان تمنعان النشر', few: 'ملاحظات تمنع النشر', many: 'ملاحظة تمنع النشر', gen: 'ملاحظة' })}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {editable && ordered.length > 1 && (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={n === 0 || reordering} onClick={() => move(r, -1)} aria-label={`تقديم شعار ${name}`} data-action="logo-earlier">تقديم</button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={n === ordered.length - 1 || reordering} onClick={() => move(r, 1)} aria-label={`تأخير شعار ${name}`} data-action="logo-later">تأخير</button>
                        </>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(r)} data-action="logo-edit">{editable ? 'تعديل' : 'عرض'}</button>
                      {editable && !r.first_published_at && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(r)} aria-label={`حذف شعار ${name}`} data-action="logo-delete">حذف الشعار</button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'إضافة شعار' : editing ? (editable ? 'تعديل الشعار' : 'الشعار') : ''} draftKey={editing ? (editing === 'new' ? 'partner-logo:new' : `partner-logo:${editing.id}`) : undefined} wide busy={busy}>
        {editing !== null && (
          <LogoForm
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
          <div className="grid gap-3" data-logo-blocked>
            <p className="text-sm text-ink-muted">لا تُنشر القائمة وفيها شعار معروض في الصفحة الرئيسية به ملاحظة. صحّح ما يلي ثم انشر:</p>
            <ul className="grid gap-2">
              {(blocked.blocked ?? []).map((x) => (
                <li key={x.id} className="text-sm">
                  <strong>{logoName(x)}</strong>
                  <ul className="list-disc ps-5 text-ink-muted">
                    {x.problems.map((p, i) => <li key={i}>{logoProblemText(p)}</li>)}
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
        title="حذف الشعار"
        body={removing ? `يُحذف شعار ${logoName(removing)} نهائيًا. لم يُنشر هذا الشعار من قبل، فلا يتغير شيء على الموقع.` : ''}
        confirmLabel="حذف الشعار"
        danger
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

const blank = (): LogoFields => ({ name_ar: '', name_en: '', kind: 'svg', data: '', width: 1, height: 1, show_home: true });

function LogoForm({ item, editable, busy, setBusy, onSaved }: { item: PartnerLogo | null; editable: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState<LogoFields>(() => (item ? pickLogo(item) : blank()));
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dis = !editable || busy;
  const set = <K extends keyof LogoFields>(k: K, v: LogoFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const problems = f.data ? logoProblems(f) : [];

  async function readFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    setReading(true);
    try {
      const logo = await readLogoFile(file);
      setF((x) => ({ ...x, ...logo }));
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function save() {
    setError(null);
    if (!f.data) {
      setError('اختر ملف الشعار (SVG أو PNG).');
      return;
    }
    setBusy(true);
    try {
      const r = await logoSave(item?.id ?? null, f);
      toast(r.problems.length ? 'حُفظت المسودة؛ فيها ملاحظات تمنع النشر.' : 'حُفظ؛ لا يظهر على الموقع قبل «نشر».', r.problems.length ? 'error' : undefined);
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4" data-logo-form>
      {item?.published && item.pending && <p className="note-amber text-sm" role="status">فيه تعديلات لم تُنشر بعد؛ الموقع يعرض آخر نسخة منشورة.</p>}
      <div className="grid gap-2">
        <span className="label">ملف الشعار (SVG أو PNG)</span>
        {f.data ? (
          <>
            <Previews f={f} name={logoName(f)} />
            <span className="text-xs text-ink-muted num" data-logo-size>{f.kind === 'svg' ? 'SVG' : 'PNG'} · {f.width} × {f.height}</span>
          </>
        ) : (
          <span className="text-sm text-ink-muted">لم يُختر ملف بعد.</span>
        )}
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn btn-ghost btn-sm cursor-pointer">
              {reading && <Spinner />} {f.data ? 'استبدال الملف' : 'اختيار ملف'}
              <input type="file" accept=".svg,.png,image/svg+xml,image/png" className="sr-only" disabled={dis || reading} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} data-no-dirty data-logo-input />
            </label>
            <span className="text-xs text-ink-muted">SVG حتى 200 كيلوبايت (أشكال متجهة، بلا صور مضمَّنة)، أو PNG بخلفية شفافة حتى 300 كيلوبايت.</span>
          </div>
        )}
        {/* the file is part of the dirty state (the file input itself is not) */}
        <input type="hidden" value={f.data ? `${f.kind}:${f.data.length}:${f.data.slice(-40)}` : ''} readOnly data-logo-file-state data-no-draft />
        {fileError && <p className="text-sm media-err" role="alert" data-logo-error>{fileError}</p>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="اسم الشريك بالعربية (نص بديل للشعار)" id="logo-name-ar" hint="لا يظهر على الصفحة؛ يقرؤه قارئ الشاشة في الصفحة العربية.">
          <input id="logo-name-ar" className="field" dir="rtl" lang="ar" value={f.name_ar} maxLength={LOGO_MAX.name} onChange={(e) => set('name_ar', e.target.value)} disabled={dis} autoComplete="off" data-field="name_ar" />
        </Field>
        <Field label="اسم الشريك بالإنجليزية (نص بديل للشعار)" id="logo-name-en" hint="لا يظهر على الصفحة؛ يقرؤه قارئ الشاشة في الصفحة الإنجليزية.">
          <input id="logo-name-en" className="field latin" dir="ltr" lang="en" value={f.name_en} maxLength={LOGO_MAX.name} onChange={(e) => set('name_en', e.target.value)} disabled={dis} autoComplete="off" data-field="name_en" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
        <input type="checkbox" className="size-4 accent-bronze-deep" checked={f.show_home} disabled={dis} onChange={(e) => set('show_home', e.target.checked)} data-field="show_home" />
        في الصفحة الرئيسية
      </label>
      {problems.length > 0 && (
        <div className="note-amber text-sm" role="status" data-logo-problems>
          <p className="font-semibold">ملاحظات تمنع النشر (يمكن حفظ المسودة):</p>
          <ul className="list-disc ps-5">
            {problems.map((p, i) => <li key={i}>{logoProblemText(p)}</li>)}
          </ul>
        </div>
      )}
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || reading} data-action="logo-save">
            {busy && <Spinner />} حفظ
          </button>
        )}
      </div>
    </div>
  );
}
