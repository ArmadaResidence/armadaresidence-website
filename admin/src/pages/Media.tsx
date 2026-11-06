// «الصور» — the dashboard media module (Ahmed, 31 Oct 2026; DECISIONS.md 2026-11-01). Ahmed uploads, orders, describes
// and publishes every photo of the site and the home hero video here:
//   - the target picker (TargetPicker — grouped, collapsible, searchable, 3 Nov 2026): the home page, then each branch (its cover, the 4 story scenes, its gallery) followed by its room
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
import type { MediaItem, MediaJob, MediaPublishResult, MediaSlot, MediaTarget, MediaTargetRow } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, riyadhDateTime } from '../lib/format';
import {
  ACCEPT_IMAGES, ACCEPT_VIDEO, GALLERY_RANGE, galleryTarget, HERO_SLIDES, ITEM_STATUS, JOB_STATUS, missingText, mobileFor, photosWord, previewUrls, sizeGuide, SLOT_LABELS, slotLabel, slotsOf, takesMobile, targetId, targetLabel,
  uploadFile, UploadRefused, warningText, type UploadStage,
} from '../lib/media';
import { CancelButton, Empty, ErrorBox, Loading, Modal, Spinner, useToast } from '../components/ui';
import MediaItemDialog from '../components/MediaItemDialog';
import TargetPicker, { type PickerGroup, type PickerItem } from '../components/TargetPicker';
import ExistingPhotoPicker from '../components/ExistingPhotoPicker';
import { brightWarning, SCRIM_AIM, scrimNeed, type ScrimPlace } from '../lib/scrim';

interface Upload {
  id: number;
  name: string;
  target: string;
  slot: MediaSlot;
  /** «صورة الجوال» (7 Nov 2026): the desktop photo it belongs to */
  mobileOf?: string;
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
  // «اختيار صورة موجودة» (5 Nov 2026): the slot the picker fills
  const [existing, setExisting] = useState<MediaSlot | null>(null);
  /** «اختيار صورة موجودة» for a «صورة الجوال» (7 Nov 2026): the desktop photo it is for */
  const [existingMobile, setExistingMobile] = useState<string | null>(null);
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
      // the dining venues' and the articles' publishes share the jobs table; they are listed in their own modules
      setJobs((await api.mediaJobs(16)).filter((j) => !j.targets.some((t) => (t.target as string) === 'venue' || (t.target as string) === 'article')).slice(0, 8));
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
          }, up.mobileOf);
        } catch (e) {
          patch(up.id, { stage: 'error', error: e instanceof UploadRefused ? e.message : (e as Error).message || 'تعذّر رفع الملف.' });
        }
        await reload();
      }
    } finally {
      running.current = false;
    }
  }, [reload]);
  const add = (files: FileList | File[], slot: MediaSlot, mobileOf?: string) => {
    if (!current || !editable) return;
    const list = [...files];
    const single = slot !== 'gallery';
    for (const file of single ? list.slice(0, 1) : list) {
      const up: Upload = { id: ++seq.current, name: file.name, target: targetLabel(current), slot, mobileOf, stage: 'checking', progress: 0, warnings: [], error: null };
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
  // the home hero (6 Nov 2026): «فيديو» or «صور متتابعة» — a draft until «نشر هذه الصفحة»
  const heroMode = current?.target === 'home' ? (current.check.mode?.mode ?? 'video') : 'video';
  const heroLive = current?.target === 'home' ? (current.check.mode?.live_mode ?? 'video') : 'video';
  const [modeBusy, setModeBusy] = useState(false);
  async function chooseMode(mode: api.HeroMode) {
    if (!editable || mode === heroMode || modeBusy) return;
    setModeBusy(true);
    try {
      await api.mediaSetHeroMode(mode);
      await loadOverview();
      toast(mode === 'photos' ? 'تم اختيار «صور متتابعة» للواجهة؛ يظهر على الموقع بعد «نشر هذه الصفحة».' : 'تم اختيار «فيديو» للواجهة؛ يظهر على الموقع بعد «نشر هذه الصفحة».');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setModeBusy(false);
    }
  }
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
  const item = (r: MediaTargetRow, label?: string): PickerItem => {
    const t = stateOf(r);
    return { id: targetId(r), label: label ?? targetLabel(r), search: `${targetLabel(r)} ${r.key}`, tone: t.tone, toneText: t.text, missing: t.tone === 'missing' ? r.check.missing.length : 0 };
  };
  const of = (pred: (r: MediaTargetRow) => boolean) => rows.filter(pred);
  const branchKeys = [...new Set(rows.filter((r) => r.branch && r.target !== 'offer').map((r) => r.branch as string))];
  const groups: PickerGroup[] = [
    { key: 'home', title: 'الصفحة الرئيسية', icon: 'home' as const, subs: [{ items: of((r) => r.target === 'home').map((r) => item(r)) }] },
    ...branchKeys.map((b) => {
      const mine = of((r) => r.branch === b && r.target !== 'offer');
      return {
        key: `branch:${b}`, title: BRANCH_NAMES[b] ?? b, icon: 'branch' as const,
        subs: [
          { title: 'الفرع', items: mine.filter((r) => r.target !== 'room' && r.target !== 'hall' && r.target !== 'dining').map((r) => item(r, r.target === 'branch' ? 'صور الفرع' : undefined)) },
          { title: 'الغرف والأجنحة', items: mine.filter((r) => r.target === 'room').map((r) => item(r, r.name_ar ?? r.key)) },
          { title: 'القاعة والمطاعم', items: mine.filter((r) => r.target === 'hall' || r.target === 'dining').map((r) => item(r, r.target === 'hall' ? r.name_ar ?? 'القاعة' : undefined)) },
        ].filter((s) => s.items.length),
      };
    }),
    { key: 'places', title: 'اكتشف الطائف', icon: 'place' as const, subs: [{ items: of((r) => r.target === 'place').map((r) => item(r)) }] },
    { key: 'partners', title: 'صفحات الشركاء', icon: 'partners' as const, subs: [{ items: of((r) => r.target === 'partners').map((r) => item(r)) }] },
    { key: 'offers', title: 'العروض', icon: 'offers' as const, subs: [{ items: of((r) => r.target === 'offer').map((r) => item(r)) }] },
    { key: 'blog', title: 'المدونة', icon: 'blog' as const, subs: [{ items: of((r) => r.target === 'blog').map((r) => item(r, r.name_ar ?? r.key)) }] },
  ].filter((g) => g.subs.some((s) => s.items.length));
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
      <div className="grid gap-5 md:grid-cols-[18rem_minmax(0,1fr)] items-start">
        {/* the grouped target picker (3 Nov 2026): the same list on every width, in a disclosure on phones */}
        <TargetPicker
          groups={groups}
          current={current ? targetId(current) : null}
          onPick={(id) => setParams({ t: id }, { replace: true })}
          label="صفحات الموقع"
          storageKey={`armada-media-groups:${me?.email ?? ''}`}
          currentLabel={current ? `الصفحة: ${targetLabel(current)}` : undefined}
        />

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
              <>
              {current.target === 'home' && (
                <div className="card p-4 grid gap-3" data-hero-mode={heroMode} data-tour="media-hero-mode">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-bold" id="hero-mode-title">واجهة الصفحة الرئيسية</h3>
                    {heroMode !== heroLive && <p className="note-amber text-xs" role="status" data-hero-mode-pending>اختيار غير منشور بعد: الموقع يعرض الآن «{heroLive === 'photos' ? 'صور متتابعة' : 'فيديو'}» حتى «نشر هذه الصفحة».</p>}
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-labelledby="hero-mode-title">
                    {(['video', 'photos'] as const).map((m) => (
                      <button key={m} type="button" className={`chip-toggle ${heroMode === m ? 'is-on' : ''}`} aria-pressed={heroMode === m} disabled={!editable || modeBusy} onClick={() => void chooseMode(m)} data-hero-mode-option={m}>
                        {heroMode === m && <span aria-hidden="true">✓ </span>}{m === 'video' ? 'فيديو' : 'صور متتابعة'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-ink-muted">
                    {heroMode === 'photos'
                      ? 'من 3 إلى 8 صور بترتيبك، تتبدل بتلاشٍ هادئ مع حركة تقريب بطيئة، وتعمل على الجوال أيضًا. للزائر زر لإيقاف الحركة.'
                      : 'مقطع بلا صوت يعمل بعد تحميل الصفحة، وصورة الواجهة تظهر قبله وعند تقليل الحركة.'}
                  </p>
                </div>
              )}
              {slotsOf(current.target, heroMode).map((s) => {
                const filled = (items ?? []).filter((i) => i.slot === s.slot);
                if (s.slot === 'gallery') {
                  const range = current.target === 'home' ? HERO_SLIDES : GALLERY_RANGE[current.target];
                  const slidesMissing = current.target === 'home' && current.check.missing.find((m) => m.code === 'hero-slides');
                  const warn = current.check.warnings[0];
                  return (
                    <div key={s.slot} className="card p-4 grid gap-3" data-slot="gallery">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-bold">{current.target === 'home' ? 'صور الواجهة المتتابعة' : SLOT_LABELS.gallery} <span className="text-sm font-normal text-ink-muted">· {photosWord(filled.length)}{range ? ` · ${current.target === 'home' ? 'المطلوب' : 'المقترح'} ${range[0]} إلى ${range[1]}` : ''}</span></h3>
                        {s.hint && <p className="text-xs text-ink-muted">{s.hint}</p>}
                      </div>
                      <SizeGuide target={current.target} slot={s.slot} />
                      {warn && <p className="note-amber text-sm" role="status" data-gallery-warning={warn.code}>{warningText(warn)}</p>}
                      {slidesMissing && <p className="note-amber text-sm" role="status" data-hero-slides-missing>{missingText(slidesMissing, byId)}</p>}
                      {filled.length > 0 && (
                        <ol className="media-grid" aria-label={current.target === 'home' ? 'صور الواجهة بالترتيب' : 'صور المعرض بالترتيب'}>
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
                              <BrightNote item={it} url={urls[it.preview_path ?? ''] ?? urls[it.thumb_path ?? '']} />
                              {takesMobile(it) && (
                                <MobileSlot parent={it} items={items ?? []} urls={urls} editable={editable} onFiles={(f) => add(f, 'mobile', it.id)} onExisting={() => setExistingMobile(it.id)} onOpen={setOpen} />
                              )}
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
                      {editable && <Drop multiple accept={ACCEPT_IMAGES} onFiles={(f) => add(f, 'gallery')} label="اسحب الصور إلى هنا أو اخترها — يمكن عدة صور معًا" slot="gallery" onExisting={() => setExisting('gallery')} />}
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
                      <SizeGuide target={current.target} slot={s.slot} />
                    </div>
                    <div className="grid gap-2">
                      {it && (
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="max-w-xs grow grid gap-2">
                            <Tile item={it} url={urls[it.thumb_path ?? '']} onOpen={() => setOpen(it)} />
                            <BrightNote item={it} url={urls[it.preview_path ?? ''] ?? urls[it.thumb_path ?? '']} />
                          </div>
                          {takesMobile(it) && (
                            <div className="w-40"><MobileSlot parent={it} items={items ?? []} urls={urls} editable={editable} onFiles={(f) => add(f, 'mobile', it.id)} onExisting={() => setExistingMobile(it.id)} onOpen={setOpen} /></div>
                          )}
                        </div>
                      )}
                      {editable && (
                        <Drop
                          accept={s.slot === 'hero-video' ? ACCEPT_VIDEO : ACCEPT_IMAGES}
                          onFiles={(f) => add(f, s.slot)}
                          slot={s.slot}
                          onExisting={s.slot === 'hero-video' ? undefined : () => setExisting(s.slot)}
                          label={it ? (s.slot === 'cover' && slotsOf(current.target, heroMode).some((x) => x.slot === 'gallery') ? 'استبدال: اسحب صورة أو اخترها (تنتقل الحالية إلى المعرض)' : 'استبدال: اسحب ملفًا أو اختره (تُؤرشف الحالية)') : s.slot === 'hero-video' ? 'اسحب الفيديو إلى هنا أو اختره (MP4 أو MOV أو WebM حتى 300 ميغابايت)' : 'اسحب صورة إلى هنا أو اخترها'}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              </>
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
                          {STAGE_TEXT[u.stage]}{u.stage === 'uploading' ? ` ${Math.round(u.progress * 100)}%` : ''} · {u.target} · {u.target === 'الصفحة الرئيسية' ? slotLabel(u.slot, 'home') : SLOT_LABELS[u.slot]}
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

      {current && (
        <ExistingPhotoPicker
          open={existing !== null}
          onClose={() => setExisting(null)}
          target={current.target}
          keyName={current.key}
          slot={existing ?? 'cover'}
          slotLabel={existing ? `${targetLabel(current)} · ${slotLabel(existing, current.target)}` : ''}
          onDone={() => {
            setExisting(null);
            toast('أُضيفت الصورة إلى هذه الخانة مع وصفيها؛ اضغط «نشر» لتظهر على الموقع.');
            void reload();
          }}
        />
      )}
      {current && (
        <ExistingPhotoPicker
          open={existingMobile !== null}
          onClose={() => setExistingMobile(null)}
          target={current.target}
          keyName={current.key}
          slot="mobile"
          mobileOf={existingMobile ?? undefined}
          slotLabel={`${targetLabel(current)} · ${SLOT_LABELS.mobile}`}
          onDone={() => {
            setExistingMobile(null);
            toast('أُضيفت صورة الجوال؛ اضغط «نشر» لتظهر على الموقع.');
            void reload();
          }}
        />
      )}
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

/** where a photo carries text on the site (7 Nov 2026): the hero's photos, a branch cover (the «فرعانا» card) and a branch
 *  cover's phone photo (the card on a phone) */
function scrimPlace(it: MediaItem): ScrimPlace | null {
  if (it.kind !== 'image') return null;
  if (it.target === 'home' && (it.slot === 'gallery' || it.slot === 'hero-poster')) return 'hero';
  if (it.target === 'branch' && it.slot === 'cover') return 'card';
  if (it.target === 'branch' && it.slot === 'mobile') return 'card-phone';
  return null;
}
/** «الصورة فاتحة خلف النص» (Ahmed, 7 Nov 2026): the navy layer this photo needs behind the text, from its preview — a
 *  warning above the aim (0.6); the site still gives the photo what AA needs */
function BrightNote({ item, url }: { item: MediaItem; url?: string }) {
  const place = scrimPlace(item);
  const [need, setNeed] = useState<number | null>(null);
  useEffect(() => {
    if (!place || !url) return;
    let live = true;
    void scrimNeed(url, place, { x: Number(item.focal_x), y: Number(item.focal_y) }).then((a) => live && setNeed(a));
    return () => {
      live = false;
    };
  }, [place, url, item.focal_x, item.focal_y]);
  if (!place || need === null || need <= SCRIM_AIM) return null;
  return <p className="note-amber text-xs" role="status" data-bright-warning={need}>{brightWarning(need, place)}</p>;
}

/** what to prepare for a slot (7 Nov 2026): the size and the area the text covers, for the computer and the phone */
function SizeGuide({ target, slot }: { target: MediaTarget; slot: MediaSlot }) {
  const g = sizeGuide(target, slot);
  if (!g) return null;
  return (
    <div className="text-xs text-ink-muted grid gap-1" data-size-guide={slot}>
      <p className="font-semibold text-ink">{g.mobile ? 'الكمبيوتر' : 'المقاس المطلوب'}</p>
      <ul className="grid gap-1 list-disc ps-4">{g.desktop.map((l) => <li key={l}>{l}</li>)}</ul>
      {g.mobile && (
        <>
          <p className="font-semibold text-ink mt-1">الجوال (صورة الجوال، اختيارية)</p>
          <ul className="grid gap-1 list-disc ps-4">{g.mobile.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}
    </div>
  );
}

/** «صورة الجوال» beside its desktop photo (7 Nov 2026): optional; without it the phone gets the desktop photo cropped */
function MobileSlot({ parent, items, urls, editable, onFiles, onExisting, onOpen }: {
  parent: MediaItem; items: MediaItem[]; urls: Record<string, string>; editable: boolean;
  onFiles: (f: FileList) => void; onExisting: () => void; onOpen: (it: MediaItem) => void;
}) {
  const mob = mobileFor(items, parent.id);
  return (
    <div className="media-mobile grid gap-1" data-mobile-slot={parent.id}>
      <p className="text-xs font-semibold">صورة الجوال <span className="font-normal text-ink-muted">(اختيارية)</span></p>
      {mob ? (
        <>
          <div className="max-w-[7rem]"><Tile item={mob} url={urls[mob.thumb_path ?? '']} onOpen={() => onOpen(mob)} /></div>
          <BrightNote item={mob} url={urls[mob.preview_path ?? ''] ?? urls[mob.thumb_path ?? '']} />
        </>
      ) : (
        <p className="text-xs text-ink-muted">بدونها يعرض الجوال الصورة نفسها مقصوصة حول نقطة التركيز.</p>
      )}
      {editable && <Drop accept={ACCEPT_IMAGES} onFiles={onFiles} label={mob ? 'استبدال صورة الجوال' : 'إضافة صورة الجوال'} slot="mobile" onExisting={onExisting} />}
    </div>
  );
}

function Tile({ item, url, n, onOpen }: { item: MediaItem; url?: string; n?: number; onOpen: () => void }) {
  // a phone photo shows its desktop photo's descriptions (7 Nov 2026)
  const noAlt = item.slot !== 'mobile' && (!item.alt_ar.trim() || !item.alt_en.trim());
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

function Drop({ accept, multiple, onFiles, label, slot, onExisting }: { accept: string; multiple?: boolean; onFiles: (f: FileList) => void; label: string; slot: MediaSlot; onExisting?: () => void }) {
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
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} data-action="choose-files">اختيار {multiple ? 'ملفات' : 'ملف'}</button>
        {onExisting && <button type="button" className="btn btn-ghost btn-sm" onClick={onExisting} data-action="choose-existing">اختيار صورة موجودة</button>}
      </div>
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
