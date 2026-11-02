// «الصور» — the dashboard media module (Ahmed, 31 Oct 2026; DECISIONS.md 2026-11-01). Ahmed uploads, orders, describes
// and publishes every photo of the site and the home hero video here:
//   - the target picker: the home page, then each branch (its cover, the 4 story scenes, its gallery) followed by its room
//     types (cover, gallery), its hall and its dining venues (cover + gallery — 2 Nov 2026, replacing the generic
//     sections), then the Discover Taif places (a cover each, replacing the guide's photo), then «صفحات الشركاء» (a cover
//     per photo slot of the /partners/ pages, replacing the legacy photo at its own ratio — 2 Nov 2026); each
//     target shows whether it is complete, has unpublished changes, or misses a required slot (media_overview — the
//     same rules «نشر» applies);
//   - each slot shows its photo or a drop zone (several files at once into the gallery, with progress); every file is
//     checked before upload (type, size, a long side under 2400 px or a portrait photo with the reason, the same file
//     twice — lib/media.ts); the gallery reorders by drag (and by «تقديم» / «تأخير» from the keyboard);
//   - a photo opens its dialog (MediaItemDialog): focal point with the crop previews, alt ar / en, slot, «إظهار في
//     المعرض» (2 Nov 2026), archive;
//   - «نشر» per target or «نشر الكل» validates first and lists exactly what is missing; a publish creates a job, asks for
//     the site build (site-rebuild, reason media) and shows its status (في الانتظار / جارٍ البناء / منشور / فشل) with the
//     time and the build log link. Drafts and edits never reach the site before their target is published.
// Levels: view (read-only), edit (upload, edit, order, archive), publish (+ «نشر»); the branch scope applies (RLS).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../lib/api';
import type { MediaItem, MediaJob, MediaPublishResult, MediaSlot, MediaTargetRow } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, riyadhDateTime } from '../lib/format';
import {
  ACCEPT_IMAGES, ACCEPT_VIDEO, GALLERY_RANGE, galleryTarget, ITEM_STATUS, JOB_STATUS, missingText, photosWord, previewUrls, SLOT_LABELS, slotsOf, targetId, targetLabel,
  uploadFile, UploadRefused, warningText, type UploadStage,
} from '../lib/media';
import { CancelButton, Empty, ErrorBox, Loading, Modal, Spinner, useToast } from '../components/ui';
import MediaItemDialog from '../components/MediaItemDialog';

interface Upload {
  id: number;
  name: string;
  target: string;
  slot: MediaSlot;
  stage: UploadStage;
  progress: number;
  warnings: string[];
  error: string | null;
}
const STAGE_TEXT: Record<UploadStage, string> = { checking: 'فحص الملف…', hashing: 'فحص التكرار…', uploading: 'رفع…', finishing: 'إنهاء…', done: 'تم الرفع', error: 'لم يُرفع' };

function stateOf(row: MediaTargetRow): { tone: 'missing' | 'pending' | 'live' | 'empty'; text: string } {
  const c = row.check;
  if (c.missing.some((m) => m.code !== 'alt') && (c.items > 0 || row.target === 'branch' || row.target === 'room')) return { tone: 'missing', text: 'ناقصة' };
  if (c.missing.length) return { tone: 'missing', text: 'نص بديل ناقص' };
  if (c.pending) return { tone: 'pending', text: 'غير منشور' };
  if (c.live > 0) return { tone: 'live', text: 'منشورة' };
  return { tone: 'empty', text: 'لا صور' };
}

export default function Media() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'media');
  const publisher = api.canPublish(me, 'media');
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<MediaTargetRow[] | null>(null);
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [archived, setArchived] = useState<MediaItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [blocked, setBlocked] = useState<{ result: MediaPublishResult; all: boolean } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const queue = useRef<{ up: Upload; file: File; target: MediaTargetRow }[]>([]);
  const running = useRef(false);
  const seq = useRef(0);

  const current = useMemo(() => {
    if (!rows?.length) return null;
    return rows.find((r) => targetId(r) === params.get('t')) ?? rows[0];
  }, [rows, params]);

  const loadOverview = useCallback(async () => {
    try {
      setRows(await api.mediaOverview());
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);
  const loadJobs = useCallback(async () => {
    try {
      // the dining venues' publishes share the jobs table; they are listed in «المطاعم والمقاهي»
      setJobs((await api.mediaJobs(16)).filter((j) => !j.targets.some((t) => (t.target as string) === 'venue')).slice(0, 8));
    } catch { /* the panel keeps the last list */ }
  }, []);
  // keyed by the target itself, not by its overview row: a refreshed overview must not reload (and blank) the list
  const curTarget = current?.target;
  const curKey = current?.key;
  const loadItems = useCallback(async () => {
    if (!curTarget || !curKey) return;
    try {
      const [live, arch] = await Promise.all([api.mediaItems(curTarget, curKey), api.mediaItems(curTarget, curKey, true)]);
      setItems(live);
      setArchived(arch);
      setUrls(await previewUrls([...live, ...arch]).catch(() => ({})));
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, [curTarget, curKey]);
  const reload = useCallback(async () => {
    await Promise.all([loadOverview(), loadItems()]);
  }, [loadOverview, loadItems]);

  useEffect(() => {
    void loadOverview();
    void loadJobs();
  }, [loadOverview, loadJobs]);
  useEffect(() => {
    setItems(null);
    void loadItems();
  }, [loadItems]);
  // a job waiting for its build: re-read the list every 15 s
  useEffect(() => {
    if (!jobs.some((j) => j.status === 'queued' || j.status === 'building')) return;
    const t = window.setInterval(loadJobs, 15000);
    return () => window.clearInterval(t);
  }, [jobs, loadJobs]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const galleryIndex = useMemo(() => new Map((items ?? []).filter((i) => i.slot === 'gallery').map((i, n) => [i.id, n + 1])), [items]);

  // ── uploads: one file at a time, in the order dropped ──
  const patch = (id: number, p: Partial<Upload>) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...p } : u)));
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let next = queue.current.shift(); next; next = queue.current.shift()) {
        const { up, file, target } = next;
        try {
          await uploadFile(file, target.target, target.key, up.slot, {
            stage: (s) => patch(up.id, { stage: s }),
            progress: (f) => patch(up.id, { progress: f }),
            warnings: (w) => patch(up.id, { warnings: w }),
          });
        } catch (e) {
          patch(up.id, { stage: 'error', error: e instanceof UploadRefused ? e.message : (e as Error).message || 'تعذّر رفع الملف.' });
        }
        await reload();
      }
    } finally {
      running.current = false;
    }
  }, [reload]);
  const add = (files: FileList | File[], slot: MediaSlot) => {
    if (!current || !editable) return;
    const list = [...files];
    const single = slot !== 'gallery';
    for (const file of single ? list.slice(0, 1) : list) {
      const up: Upload = { id: ++seq.current, name: file.name, target: targetLabel(current), slot, stage: 'checking', progress: 0, warnings: [], error: null };
      setUploads((u) => [...u, up]);
      queue.current.push({ up, file, target: current });
    }
    if (single && list.length > 1) toast('هذه الخانة لصورة واحدة؛ رُفع أول ملف فقط.', 'error');
    void pump();
  };

  // ── gallery order ──
  async function reorder(ids: string[]) {
    if (!current || !items) return;
    const others = items.filter((i) => i.slot !== 'gallery');
    const moved = ids.map((id, n) => ({ ...byId.get(id)!, sort: n }));
    setItems([...others, ...moved]);
    try {
      await api.mediaReorder(current.target, current.key, ids);
      await loadOverview();
      await loadItems();
    } catch (e) {
      toast((e as Error).message, 'error');
      await loadItems();
    }
  }
  const gallery = (items ?? []).filter((i) => i.slot === 'gallery');
  const move = (id: string, by: number) => {
    const ids = gallery.map((i) => i.id);
    const at = ids.indexOf(id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(at, 1)[0]);
    void reorder(ids);
  };
  const dropOn = (targetItem: string) => {
    if (!dragId || dragId === targetItem) return;
    const ids = gallery.map((i) => i.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(targetItem) + (gallery.findIndex((i) => i.id === dragId) < gallery.findIndex((i) => i.id === targetItem) ? 1 : 0), 0, dragId);
    setDragId(null);
    void reorder(ids);
  };

  // ── publish ──
  async function dispatch(result: MediaPublishResult) {
    if (!result.job_id) return;
    const rb = await api.siteRebuild('media', result.job_id);
    toast(rb.ok && rb.dispatched ? 'طُلب النشر: يُبنى الموقع الآن ويظهر التغيير خلال دقائق.' : rb.reason === 'no_token' ? 'حُفظ النشر؛ يظهر على الموقع مع إعادة البناء التالية.' : 'حُفظ النشر لكن تعذّر بدء البناء؛ أعد المحاولة من قائمة النشر.', rb.ok && rb.dispatched ? undefined : 'error');
    await Promise.all([reload(), loadJobs()]);
  }
  async function publish(all: boolean, skip = false) {
    if (!current) return;
    setPublishing(true);
    try {
      const r = await api.mediaPublish(all ? null : [{ target: current.target, key: current.key }], skip);
      if (r.ok) {
        setBlocked(null);
        await dispatch(r);
      } else if (r.reason === 'nothing') toast('لا تغييرات للنشر.');
      else setBlocked({ result: r, all });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPublishing(false);
    }
  }
  // a job whose dispatch failed is dispatched again; a failed build is published again as a new job (its items are
  // already live in the database, the next build carries them)
  async function retry(job: MediaJob) {
    if (job.status === 'failed') {
      try {
        const r = await api.mediaPublish(job.targets);
        if (r.ok) await dispatch(r);
        else if (r.reason === 'blocked') setBlocked({ result: r, all: false });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
      return;
    }
    const rb = await api.siteRebuild('media', job.id);
    toast(rb.ok && rb.dispatched ? 'طُلب البناء من جديد.' : 'تعذّر بدء البناء؛ أعد المحاولة بعد قليل.', rb.ok && rb.dispatched ? undefined : 'error');
    await loadJobs();
  }
  async function restore(it: MediaItem) {
    try {
      const r = await api.mediaRestore(it.id);
      toast((r as { slot?: string }).slot === 'gallery' && it.slot !== 'gallery' ? 'استُعيدت إلى المعرض (خانتها مشغولة).' : 'استُعيدت.');
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (rows === null) return <Loading />;
  if (!rows.length) return <div className="grid gap-4"><h1 className="text-2xl font-bold">الصور</h1><ErrorBox error={error} /><Empty text="لا صفحات ضمن صلاحيتك." /></div>;
  const pendingAll = rows.filter((r) => r.check.pending).length;
  const groups: { title: string; rows: MediaTargetRow[] }[] = [
    { title: 'الصفحة الرئيسية', rows: rows.filter((r) => r.target === 'home') },
    ...[...new Set(rows.filter((r) => r.branch).map((r) => r.branch as string))].map((b) => ({ title: BRANCH_NAMES[b] ?? b, rows: rows.filter((r) => r.branch === b) })),
    { title: 'اكتشف الطائف', rows: rows.filter((r) => r.target === 'place') },
    { title: 'صفحات الشركاء', rows: rows.filter((r) => r.target === 'partners') },
  ].filter((g) => g.rows.length);
  const pick = (r: MediaTargetRow) => setParams({ t: targetId(r) }, { replace: true });
  const st = current ? stateOf(current) : null;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">الصور</h1>
          <p className="text-sm text-ink-muted mt-1">
            ارفع صور الموقع ورتّبها واكتب نصها البديل، ثم اضغط «نشر». لا يظهر على الموقع إلا ما نُشر: المسودات والتعديلات والأرشفة تبقى هنا حتى نشر صفحتها.
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : !publisher ? ' النشر لمن يملك صلاحية «نشر».' : ''}
          </p>
        </div>
        {publisher && (
          <button type="button" className="btn btn-primary" onClick={() => publish(true)} disabled={publishing || !pendingAll} data-action="media-publish-all">
            {publishing && <Spinner />} نشر الكل{pendingAll ? ` (${pendingAll})` : ''}
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="grid gap-5 md:grid-cols-[16rem_minmax(0,1fr)] items-start">
        {/* target picker: a select on phones, a grouped list from md */}
        <div className="md:hidden">
          <label className="label" htmlFor="media-target">الصفحة</label>
          <select id="media-target" className="field" value={current ? targetId(current) : ''} onChange={(e) => setParams({ t: e.target.value }, { replace: true })} data-no-dirty>
            {groups.map((g) => (
              <optgroup key={g.title} label={g.title}>
                {g.rows.map((r) => (
                  <option key={targetId(r)} value={targetId(r)}>{`${targetLabel(r)} — ${stateOf(r).text}`}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <nav className="hidden md:block card p-2 sticky top-4" aria-label="صفحات الموقع">
          {groups.map((g) => (
            <div key={g.title} className="mb-2">
              <p className="px-2 pt-2 pb-1 text-xs font-bold text-ink-muted">{g.title}</p>
              <ul>
                {g.rows.map((r) => {
                  const s = stateOf(r);
                  const on = current && targetId(current) === targetId(r);
                  return (
                    <li key={targetId(r)}>
                      <button type="button" className={`media-target ${on ? 'is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => pick(r)} data-target={targetId(r)}>
                        <span className="truncate">{r.target === 'branch' ? 'الفرع' : r.target === 'room' || r.target === 'hall' ? r.name_ar ?? r.key : targetLabel(r)}</span>
                        <span className={`media-dot media-dot-${s.tone}`} title={s.text}><span className="sr-only">{s.text}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {current && (
          <section className="grid gap-4 min-w-0" aria-labelledby="media-target-title" data-current={targetId(current)}>
            <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="media-target-title" className="text-lg font-bold">{targetLabel(current)}</h2>
                <p className="text-sm mt-1" data-target-state={st?.tone}>
                  {st?.tone === 'missing'
                    ? `ينقص قبل النشر: ${current.check.missing.map((m) => missingText(m, byId, galleryIndex)).join('، ')}`
                    : st?.tone === 'pending'
                      ? 'فيها تغييرات لم تُنشر بعد.'
                      : st?.tone === 'live'
                        ? 'كل ما هنا منشور على الموقع.'
                        : 'لا صور بعد؛ الموقع يعرض العلامة البديلة.'}
                </p>
              </div>
              {publisher && (
                <button type="button" className="btn btn-primary" onClick={() => publish(false)} disabled={publishing || !current.check.pending} data-action="media-publish">
                  {publishing && <Spinner />} نشر هذه الصفحة
                </button>
              )}
            </div>

            {items === null ? (
              <Loading />
            ) : (
              slotsOf(current.target).map((s) => {
                const filled = (items ?? []).filter((i) => i.slot === s.slot);
                if (s.slot === 'gallery') {
                  const range = GALLERY_RANGE[current.target];
                  const warn = current.check.warnings[0];
                  return (
                    <div key={s.slot} className="card p-4 grid gap-3" data-slot="gallery">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-bold">{SLOT_LABELS.gallery} <span className="text-sm font-normal text-ink-muted">· {photosWord(filled.length)}{range ? ` · المقترح ${range[0]} إلى ${range[1]}` : ''}</span></h3>
                        {s.hint && <p className="text-xs text-ink-muted">{s.hint}</p>}
                      </div>
                      {warn && <p className="note-amber text-sm" role="status" data-gallery-warning={warn.code}>{warningText(warn)}</p>}
                      {filled.length > 0 && (
                        <ol className="media-grid" aria-label="صور المعرض بالترتيب">
                          {filled.map((it, n) => (
                            <li
                              key={it.id}
                              className={`media-tile ${dragId === it.id ? 'is-drag' : ''}`}
                              draggable={editable}
                              onDragStart={(e) => {
                                setDragId(it.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', it.id);
                              }}
                              onDragEnd={() => setDragId(null)}
                              onDragOver={(e) => dragId && e.preventDefault()}
                              onDrop={(e) => {
                                if (!dragId) return;
                                e.preventDefault();
                                e.stopPropagation();
                                dropOn(it.id);
                              }}
                              data-item={it.id}
                            >
                              <Tile item={it} url={urls[it.thumb_path ?? '']} n={n + 1} onOpen={() => setOpen(it)} />
                              {editable && filled.length > 1 && (
                                <div className="media-move">
                                  <button type="button" className="btn btn-ghost btn-sm" disabled={n === 0} onClick={() => move(it.id, -1)} aria-label={`تقديم الصورة رقم ${n + 1}`} data-action="move-earlier">تقديم</button>
                                  <button type="button" className="btn btn-ghost btn-sm" disabled={n === filled.length - 1} onClick={() => move(it.id, 1)} aria-label={`تأخير الصورة رقم ${n + 1}`} data-action="move-later">تأخير</button>
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                      {editable && <Drop multiple accept={ACCEPT_IMAGES} onFiles={(f) => add(f, 'gallery')} label="اسحب الصور إلى هنا أو اخترها — يمكن عدة صور معًا" slot="gallery" />}
                    </div>
                  );
                }
                const it = filled[0];
                return (
                  <div key={s.slot} className="card p-4 grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] items-start" data-slot={s.slot}>
                    <div className="grid gap-2">
                      <h3 className="font-bold">
                        {SLOT_LABELS[s.slot]} {s.required && <span className={`chip ${it ? 'chip-request' : 'chip-test'}`} data-required>{it ? 'مطلوبة' : 'مطلوبة — ناقصة'}</span>}
                      </h3>
                      {s.hint && <p className="text-xs text-ink-muted">{s.hint}</p>}
                    </div>
                    <div className="grid gap-2">
                      {it && <div className="max-w-xs"><Tile item={it} url={urls[it.thumb_path ?? '']} onOpen={() => setOpen(it)} /></div>}
                      {editable && (
                        <Drop
                          accept={s.slot === 'hero-video' ? ACCEPT_VIDEO : ACCEPT_IMAGES}
                          onFiles={(f) => add(f, s.slot)}
                          slot={s.slot}
                          label={it ? (s.slot === 'cover' && slotsOf(current.target).some((x) => x.slot === 'gallery') ? 'استبدال: اسحب صورة أو اخترها (تنتقل الحالية إلى المعرض)' : 'استبدال: اسحب ملفًا أو اختره (تُؤرشف الحالية)') : s.slot === 'hero-video' ? 'اسحب الفيديو إلى هنا أو اختره (MP4 أو MOV أو WebM حتى 300 ميغابايت)' : 'اسحب صورة إلى هنا أو اخترها'}
                        />
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {uploads.length > 0 && (
              <div className="card p-4 grid gap-2" aria-live="polite" data-uploads>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold">الرفع</h3>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={uploads.some((u) => !['done', 'error'].includes(u.stage))} onClick={() => setUploads([])} data-action="clear-uploads">مسح القائمة</button>
                </div>
                <ul className="grid gap-2">
                  {uploads.map((u) => (
                    <li key={u.id} className="border-b border-line last:border-0 pb-2" data-upload={u.name} data-stage={u.stage}>
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span className="latin truncate" dir="ltr">{u.name}</span>
                        <span className={u.stage === 'error' ? 'media-err font-semibold' : u.stage === 'done' ? 'media-ok font-semibold' : 'text-ink-muted'}>
                          {STAGE_TEXT[u.stage]}{u.stage === 'uploading' ? ` ${Math.round(u.progress * 100)}%` : ''} · {u.target} · {SLOT_LABELS[u.slot]}
                        </span>
                      </div>
                      {['uploading', 'finishing'].includes(u.stage) && (
                        <div className="media-progress" role="progressbar" aria-label={`رفع ${u.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)}>
                          <span style={{ transform: `scaleX(${u.progress})` }} />
                        </div>
                      )}
                      {u.error && <p className="text-sm media-err" role="alert">{u.error}</p>}
                      {u.warnings.map((w) => (
                        <p key={w} className="note-amber text-xs" data-upload-warning>{w}</p>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {archived.length > 0 && (
              <div className="card p-4 grid gap-3">
                <button type="button" className="btn btn-ghost btn-sm justify-self-start" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)} data-action="toggle-archived">
                  المؤرشفة ({archived.length})
                </button>
                {showArchived && (
                  <ul className="media-grid">
                    {archived.map((it) => (
                      <li key={it.id} className="media-tile" data-archived={it.id}>
                        <Tile item={it} url={urls[it.thumb_path ?? '']} onOpen={() => setOpen(it)} />
                        {it.live && <p className="text-xs text-ink-muted px-1">ما زالت على الموقع حتى نشر هذه الصفحة.</p>}
                        {editable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => restore(it)} data-action="media-restore">استعادة</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <Jobs jobs={jobs} rows={rows} publisher={publisher} onRetry={retry} />

      <MediaItemDialog item={open && open.status !== 'archived' ? open : null} src={open ? urls[open.preview_path ?? ''] ?? urls[open.thumb_path ?? ''] ?? null : null} editable={editable} onClose={() => setOpen(null)} onChanged={() => void reload()} />
      <Modal open={!!open && open.status === 'archived'} onClose={() => setOpen(null)} title="صورة مؤرشفة">
        {open && open.status === 'archived' && (
          <div className="grid gap-3">
            {urls[open.preview_path ?? ''] && <img src={urls[open.preview_path ?? '']} alt={open.alt_ar || 'صورة مؤرشفة'} className="rounded max-h-[50vh] object-contain" />}
            <p className="text-sm">{open.file_name}</p>
            <div className="flex justify-end gap-2">
              <CancelButton label="إغلاق" />
              {editable && <button type="button" className="btn btn-primary" onClick={() => { void restore(open); setOpen(null); }} data-action="media-restore-dialog">استعادة</button>}
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!blocked} onClose={() => setBlocked(null)} title="ما ينقص قبل النشر" busy={publishing}>
        {blocked && (
          <div className="grid gap-3" data-blocked>
            <p className="text-sm text-ink-muted">لا تُنشر صفحة ينقصها شيء مطلوب. أكمل ما يلي ثم انشر:</p>
            <ul className="grid gap-2">
              {(blocked.result.blocked ?? []).map((b) => {
                const row = rows.find((r) => r.target === b.target && r.key === b.key);
                return (
                  <li key={`${b.target}:${b.key}`} className="text-sm" data-blocked-target={`${b.target}:${b.key}`}>
                    <strong>{row ? targetLabel(row) : b.key}</strong>
                    <ul className="list-disc ps-5 text-ink-muted">
                      {b.missing.map((m, i) => (
                        <li key={i}>{missingText(m, row && current && targetId(row) === targetId(current) ? byId : new Map(), row && current && targetId(row) === targetId(current) ? galleryIndex : undefined)}</li>
                      ))}
                      {b.uploading > 0 && <li>ملف ما زال يُرفع</li>}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap justify-end gap-2 mt-2">
              <CancelButton label="إغلاق" disabled={publishing} />
              {blocked.all && (blocked.result.ready?.length ?? 0) > 0 && (
                <button type="button" className="btn btn-primary" onClick={() => publish(true, true)} disabled={publishing} data-action="media-publish-ready">
                  {publishing && <Spinner />} نشر المكتمل فقط ({blocked.result.ready!.length})
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Tile({ item, url, n, onOpen }: { item: MediaItem; url?: string; n?: number; onOpen: () => void }) {
  const noAlt = !item.alt_ar.trim() || !item.alt_en.trim();
  const status = item.status === 'published' && item.pending ? 'تعديلات غير منشورة' : ITEM_STATUS[item.status];
  return (
    <button type="button" className="media-thumb" onClick={onOpen} aria-label={`${n ? `الصورة رقم ${n}: ` : ''}${item.alt_ar || item.file_name} — ${status}${noAlt ? '، بلا نص بديل' : ''}`} data-open={item.id}>
      {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className="media-thumb-none">{item.kind === 'video' ? 'فيديو' : 'لا معاينة'}</span>}
      <span className="media-badges">
        {n && <span className="chip chip-request num">{n}</span>}
        <span className={`chip ${item.status === 'published' && !item.pending ? 'chip-confirmed' : 'chip-request'}`} data-status={item.status}>{status}</span>
        {noAlt && <span className="chip chip-flag" data-no-alt>بلا نص بديل</span>}
        {galleryTarget(item.target) && item.in_gallery === false && <span className="chip chip-request" data-off-gallery>خارج المعرض</span>}
      </span>
    </button>
  );
}

function Drop({ accept, multiple, onFiles, label, slot }: { accept: string; multiple?: boolean; onFiles: (f: FileList) => void; label: string; slot: MediaSlot }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`media-drop ${over ? 'is-over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
      data-drop={slot}
    >
      <p className="text-sm">{label}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} data-action="choose-files">اختيار {multiple ? 'ملفات' : 'ملف'}</button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
        data-no-dirty
        data-file-input={slot}
      />
    </div>
  );
}

function Jobs({ jobs, rows, publisher, onRetry }: { jobs: MediaJob[]; rows: MediaTargetRow[]; publisher: boolean; onRetry: (j: MediaJob) => void }) {
  if (!jobs.length) return null;
  const name = (t: { target: api.MediaTarget; key: string }) => {
    const r = rows.find((x) => x.target === t.target && x.key === t.key);
    return r ? targetLabel(r) : targetLabel({ ...t, name_ar: undefined });
  };
  return (
    <section className="card p-4" aria-labelledby="media-jobs-title" data-jobs>
      <h2 id="media-jobs-title" className="font-bold mb-3">آخر عمليات النشر</h2>
      <ul className="grid gap-2">
        {jobs.map((j) => (
          <li key={j.id} className="grid gap-1 border-b border-line last:border-0 pb-2 text-sm" data-job={j.id} data-job-status={j.status}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${j.status === 'published' ? 'chip-confirmed' : j.status === 'failed' ? 'chip-test' : 'chip-request'}`}>{j.dry_run ? `تجربة: ${JOB_STATUS[j.status]}` : JOB_STATUS[j.status]}</span>
              <span className="num">{riyadhDateTime(j.requested_at)}</span>
              {j.requested_label && <span className="text-ink-muted">· {j.requested_label}</span>}
              {j.finished_at && j.status === 'published' && <span className="text-ink-muted num">· على الموقع {riyadhDateTime(j.finished_at)}</span>}
              {j.run_url && (
                <a className="text-accent-text underline" href={j.run_url} target="_blank" rel="noreferrer" data-run-link>سجل البناء</a>
              )}
            </div>
            <p className="text-ink-muted">{j.targets.map(name).join('، ')}</p>
            {j.status === 'queued' && j.dispatch === 'no_token' && <p className="text-xs text-ink-muted">لم يُطلب البناء آليًا؛ يُنشر مع إعادة بناء الموقع التالية.</p>}
            {(j.status === 'queued' && j.dispatch === 'failed') || j.status === 'failed' ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs media-err">{j.status === 'failed' ? 'فشل البناء؛ الموقع ما زال على النسخة السابقة.' : 'تعذّر بدء البناء.'}</p>
                {publisher && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(j)} data-action="job-retry">إعادة المحاولة</button>}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
