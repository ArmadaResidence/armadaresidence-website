// «المدونة» — the blog module (Ahmed, 2 Nov 2026; DASHBOARD-SPEC.md §3.10; DECISIONS.md 2026-11-03).
//   - the list: every article with its languages, state (مسودة / مجدول / منشور) and date; «مقال جديد».
//   - the editor (/blog/new, /blog/<id>): title, excerpt, SEO title / description with live counters and the Google
//     snippet, the readable slug (suggested from the English title, unique, fixed after the first publish), the text in
//     a formatted editor per language (components/RichEditor), tags, the linked branch (or both, or none) and Discover
//     Taif place, the cover and the text's photos from «الصور» (target blog:<slug>; both alts required), the OG image,
//     the canonical, the dates. The label-suggest translation chip on the title, the excerpt and the SEO fields only —
//     never filled by itself. An article may exist in one language only.
//   - «معاينة» before publishing; «نشر الآن» or «جدولة» (a date and time, Riyadh); «إيقاف النشر». Warnings while
//     editing: a missing description, a missing alt, no internal link, a duplicate slug; the server's blocked list on
//     publish. A publish that changes the site now rebuilds it (site-rebuild, reason blog); a scheduled one goes live
//     with the hourly check (pg_cron) or the daily build.
// Levels: view (read-only), edit (write drafts), publish (+ «نشر», «جدولة», «إيقاف النشر»). Everything is audited.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as api from '../lib/api';
import type { MediaItem, RoomType } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, longDate, riyadhDateTime } from '../lib/format';
import {
  articlePhotos, articles as loadArticles, blankArticle, blogPublish, blogSave, blogUnpublish, BRANCH_CHOICES, figureHtml, hasInternalLink, LANG_LABELS,
  langsOf, markdownToHtml as markdownPreview, missingText, photoDirective, pickFields, SEO_DESC_MAX, SEO_TITLE_MAX, sitePath, SLUG, slugify, STATE_CHIP, STATE_LABELS, WARNING_TEXT,
  type Article, type ArticleFields, type ArticleMissing, type Lang,
} from '../lib/blog';
import { offers as loadOffers } from '../lib/offers';
import { previewUrls } from '../lib/media';
import { riyadhParts, riyadhStamp } from '../lib/offers';
import { TIMES } from '../lib/dining';
import { CancelButton, Confirm, DirtyScope, Empty, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';
import LabelPair from '../components/LabelPair';
import DateField from '../components/DateField';
import RichEditor, { type RichEditorHandle } from '../components/RichEditor';
import { usePageCrumbs } from '../components/Shell';
import taif from '../../../content/taif-guide.json';

const PLACES = (taif as { places: { key: string; name_ar: string; name_en: string }[] }).places;

export default function Blog() {
  const { id } = useParams();
  return id ? <Editor key={id} id={id === 'new' ? null : id} /> : <BlogList />;
}

// ── the list ───────────────────────────────────────────────────────────────────────────────────────────────────

function BlogList() {
  const { me } = useSession();
  const navigate = useNavigate();
  const editable = api.canEdit(me, 'blog');
  const [rows, setRows] = useState<Article[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadArticles().then(setRows).catch((e) => { setError((e as Error).message); setRows([]); });
  }, []);
  if (rows === null) return <Loading />;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">المدونة</h1>
          <p className="text-sm text-ink-muted mt-1">
            مقالات الموقع بالعربية والإنجليزية، أو بلغة واحدة. لا يظهر على الموقع إلا ما نُشر؛ التعديل بعد النشر يبقى هنا حتى «نشر» من جديد.
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : !api.canPublish(me, 'blog') ? ' النشر لمن يملك صلاحية «نشر».' : ''}
          </p>
        </div>
        {editable && <button type="button" className="btn btn-primary" onClick={() => navigate('/blog/new')} data-action="blog-new">مقال جديد</button>}
      </div>
      <ErrorBox error={error} />
      {!rows.length ? (
        <Empty text="لا مقالات بعد." />
      ) : (
        <ul className="grid gap-2" data-list="articles">
          {rows.map((a) => (
            <li key={a.id} className="card p-4 flex flex-wrap items-center gap-3" data-article={a.slug}>
              <div className="min-w-0 flex-1">
                <Link to={`/blog/${a.id}`} className="font-semibold link block truncate" data-action="blog-open">{a.title_ar || a.title_en || a.slug}</Link>
                <p className="text-xs text-ink-muted mt-1 num" dir="ltr">/blog/{a.slug}/</p>
              </div>
              <span className="flex gap-1" aria-label="اللغات">
                {(['ar', 'en'] as Lang[]).map((l) => (
                  <span key={l} className={`chip ${a.check.langs.includes(l) ? 'chip-request' : 'chip-cancelled'}`} data-lang-chip={l}>{l === 'ar' ? 'ع' : 'EN'}<span className="sr-only">{a.check.langs.includes(l) ? ` ${LANG_LABELS[l]}` : ` لا نسخة ${LANG_LABELS[l]}`}</span></span>
                ))}
              </span>
              <span className={`chip ${STATE_CHIP[a.state]}`} data-state={a.state}>{STATE_LABELS[a.state]}{a.pending ? ' · تعديلات غير منشورة' : ''}</span>
              <span className="text-xs text-ink-muted num">{a.state === 'scheduled' && a.publish_at ? `ينشر ${riyadhDateTime(a.publish_at)}` : a.date_published ? longDate(a.date_published) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── the editor ─────────────────────────────────────────────────────────────────────────────────────────────────

interface LinkChoice {
  group: string;
  label: string;
  path: string;
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = [...value].length;
  return <span className={`text-xs num ${n > max ? 'text-error font-bold' : 'text-ink-muted'}`} data-counter>{n} / {max}</span>;
}

function Snippet({ lang, title, desc, slug }: { lang: Lang; title: string; desc: string; slug: string }) {
  return (
    <div className="snippet" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} data-snippet={lang}>
      <p className="snippet-url latin" dir="ltr">armadaresidence.com › {lang === 'en' ? 'en › ' : ''}blog › {slug || '…'}</p>
      <p className={`snippet-title ${lang === 'en' ? 'font-en' : ''}`}>{title || (lang === 'ar' ? 'عنوان الصفحة' : 'Page title')}</p>
      <p className={`snippet-desc ${lang === 'en' ? 'font-en' : ''}`}>{desc || (lang === 'ar' ? 'وصف الصفحة كما يظهر في نتائج البحث.' : 'The page description as search results show it.')}</p>
    </div>
  );
}

function Editor({ id }: { id: string | null }) {
  const { me } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const editable = api.canEdit(me, 'blog');
  const publisher = api.canPublish(me, 'blog');
  const seesMedia = api.canView(me, 'media');
  const [article, setArticle] = useState<Article | null>(null);
  const [all, setAll] = useState<Article[]>([]);
  const [f, setF] = useState<ArticleFields>(blankArticle());
  const [loaded, setLoaded] = useState(id === null);
  const [version, setVersion] = useState(0);
  const [lang, setLang] = useState<Lang>('ar');
  const [slugTouched, setSlugTouched] = useState(id !== null);
  const [tagsRaw, setTagsRaw] = useState<Record<Lang, string>>({ ar: '', en: '' });
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [offerLinks, setOfferLinks] = useState<LinkChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ArticleMissing[] | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const editor = useRef<RichEditorHandle>(null);
  usePageCrumbs([{ label: 'المدونة', to: '/blog' }, { label: id ? 'تعديل مقال' : 'مقال جديد' }]);

  const set = <K extends keyof ArticleFields>(k: K, v: ArticleFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const locked = !!article?.first_published_at;
  const dis = !editable || busy;

  const load = useCallback(async () => {
    try {
      const list = await loadArticles();
      setAll(list);
      if (id) {
        const a = list.find((x) => x.id === id) ?? null;
        if (!a) {
          setError('هذا المقال غير موجود أو ليس ضمن صلاحيتك.');
        } else {
          setArticle(a);
          const fields = pickFields(a);
          setF(fields);
          setTagsRaw({ ar: fields.tags_ar.join('، '), en: fields.tags_en.join(', ') });
          if (seesMedia) {
            const items = articlePhotos(await api.mediaItems('blog', a.slug).catch(() => [] as MediaItem[]));
            setPhotos(items);
            setUrls(await previewUrls(items).catch(() => ({})));
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [id, seesMedia]);
  useEffect(() => {
    void load();
    api.roomTypes().then(setRooms).catch(() => setRooms([]));
    loadOffers()
      .then((list) => setOfferLinks(list.filter((o) => o.live && o.state !== 'expired' && o.state !== 'archived').map((o) => ({ group: 'العروض', label: o.title_ar, path: `/offers/#offer-${o.slug}` }))))
      .catch(() => setOfferLinks([]));
  }, [load]);

  // the preview of a photo directive inside the editor: the dashboard's own thumbnail for media:<id>
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const preview = useCallback((src: string) => {
    const m = src.match(/^media:([0-9a-f-]{36})$/);
    if (m) {
      const it = byId.get(m[1]);
      return { url: it ? urls[it.thumb_path ?? ''] ?? urls[it.preview_path ?? ''] : undefined, alt: it ? (lang === 'ar' ? it.alt_ar : it.alt_en) || it.alt_ar : 'صورة من «الصور»' };
    }
    return { alt: src };
  }, [byId, urls, lang]);

  // ── live warnings (the server's own check decides at «نشر») ──
  const langs = langsOf(f);
  const slugOk = SLUG.test(f.slug) && f.slug.length >= 2;
  const slugTaken = all.some((a) => a.slug === f.slug && a.id !== id);
  const cover = photos.find((p) => p.slot === 'cover' && p.status !== 'archived');
  const warnings: string[] = [];
  if (!langs.length) warnings.push('اكتب العنوان والنص بلغة واحدة على الأقل.');
  if (slugTaken) warnings.push('الرابط مستخدم في مقال آخر؛ اختر رابطًا غيره.');
  for (const l of langs) {
    if (!f[`seo_description_${l}`].trim()) warnings.push(`وصف SEO ناقص (${LANG_LABELS[l]}).`);
    if (!hasInternalLink(f[`body_${l}`])) warnings.push(WARNING_TEXT.no_internal_link(l));
    if (!cover && !f[`cover_alt_${l}`].trim()) warnings.push(`النص البديل لصورة الغلاف ناقص (${LANG_LABELS[l]}).`);
  }
  const altMissing = photos.filter((p) => p.status !== 'archived' && (!p.alt_ar.trim() || !p.alt_en.trim())).length;
  if (altMissing) warnings.push(`صور بلا نص بديل كامل في «الصور»: ${altMissing}.`);
  for (const l of (['ar', 'en'] as Lang[])) if (!!f[`title_${l}`].trim() !== !!f[`body_${l}`].trim()) warnings.push(`النسخة ${LANG_LABELS[l]} ناقصة: العنوان والنص معًا أو لا شيء.`);

  // ── links ──
  const linkChoices = useMemo<LinkChoice[]>(() => {
    const pages: LinkChoice[] = [
      { group: 'صفحات', label: 'الرئيسية', path: '/' },
      { group: 'صفحات', label: 'العروض', path: '/offers/' },
      { group: 'صفحات', label: 'اكتشف الطائف', path: '/discover-taif/' },
      { group: 'صفحات', label: 'تواصل معنا', path: '/contact/' },
      { group: 'صفحات', label: 'الشركاء', path: '/partners/' },
      { group: 'صفحات', label: 'السياسات', path: '/policies/' },
      { group: 'صفحات', label: 'المدونة', path: '/blog/' },
    ];
    const branches: LinkChoice[] = Object.entries(BRANCH_NAMES).flatMap(([slug, name]) => [
      { group: 'الفروع', label: name, path: `/${slug}/` },
      { group: 'الفروع', label: `طلب حجز — ${name}`, path: `/booking/?branch=${slug}` },
    ]);
    const roomLinks: LinkChoice[] = rooms.filter((r) => !r.is_test).map((r) => ({ group: 'الغرف والأجنحة', label: `${r.name_ar} — ${BRANCH_NAMES[r.branch] ?? r.branch}`, path: `/${r.branch}/${r.slug}/` }));
    const placeLinks: LinkChoice[] = PLACES.map((p) => ({ group: 'اكتشف الطائف', label: p.name_ar, path: `/discover-taif/#place-${p.key}` }));
    const articleLinks: LinkChoice[] = all
      .filter((a) => a.id !== id && a.live && (a.live.langs ?? []).includes(lang))
      .map((a) => ({ group: 'مقالات أخرى', label: (lang === 'ar' ? a.live?.title_ar : a.live?.title_en) || a.slug, path: `/blog/${a.slug}/` }));
    return [...branches, ...roomLinks, ...offerLinks, ...placeLinks, ...articleLinks, ...pages];
  }, [rooms, offerLinks, all, id, lang]);

  // ── save / publish ──
  async function save(): Promise<string | null> {
    if (!editable) return null;
    setError(null);
    if (!slugOk) {
      setError('الرابط: حروف إنجليزية صغيرة وأرقام وشرطات، من حرفين على الأقل.');
      return null;
    }
    if (slugTaken) {
      setError('الرابط مستخدم في مقال آخر.');
      return null;
    }
    if (!f.title_ar.trim() && !f.title_en.trim()) {
      setError('اكتب عنوان المقال بلغة واحدة على الأقل.');
      return null;
    }
    setBusy(true);
    try {
      const r = await blogSave(id, f);
      setVersion((v) => v + 1);
      if (!id) {
        toast('حُفظ المقال مسودة.');
        navigate(`/blog/${r.id}`, { replace: true });
        return r.id;
      }
      await load();
      toast('حُفظت التعديلات.');
      return r.id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function rebuild(job: string | null | undefined, done: string) {
    if (!job) {
      toast(done);
      return;
    }
    const rb = await api.siteRebuild('blog', job).catch(() => ({ ok: false, reason: 'failed' as const }));
    toast(
      rb.ok && 'dispatched' in rb && rb.dispatched ? `${done} يُبنى الموقع الآن ويظهر التغيير خلال دقائق.` : rb.reason === 'no_token' ? `${done} يظهر على الموقع مع إعادة البناء التالية.` : `${done} لكن تعذّر بدء البناء؛ يظهر مع البناء التالي.`,
      rb.ok ? undefined : rb.reason === 'no_token' ? undefined : 'error',
    );
  }
  async function publish(at: string | null) {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      const r = await blogPublish(saved, at);
      if (!r.ok) {
        setBlocked(r.missing ?? []);
        return;
      }
      setBlocked(null);
      setScheduleOpen(false);
      await rebuild(r.job_id, r.state === 'scheduled' ? `جُدول المقال: ينشر ${riyadhDateTime(r.publish_at ?? '')}.` : 'نُشر المقال.');
      await load();
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unpublish() {
    if (!id) return;
    setBusy(true);
    try {
      const r = await blogUnpublish(id);
      setUnpublishOpen(false);
      await rebuild(r.job_id, 'أُوقف نشر المقال.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <Loading />;
  if (id && !article) return <div className="grid gap-4"><h1 className="text-2xl font-bold">المدونة</h1><ErrorBox error={error} /><Link to="/blog" className="link">العودة إلى المقالات</Link></div>;
  const photoIndex = new Map(photos.filter((p) => p.slot === 'gallery').map((p, n) => [p.id, n + 1]));
  const state = article?.state ?? 'draft';

  return (
    <div className="grid gap-5 pb-24" data-blog-editor>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{id ? f.title_ar || f.title_en || f.slug : 'مقال جديد'}</h1>
          <p className="text-sm text-ink-muted mt-1">
            <span className={`chip ${STATE_CHIP[state]}`} data-state={state}>{STATE_LABELS[state]}</span>
            {article?.pending && <span className="ms-2">فيه تعديلات لم تُنشر بعد.</span>}
            {state === 'scheduled' && article?.publish_at && <span className="ms-2 num">ينشر {riyadhDateTime(article.publish_at)} (بتوقيت الرياض).</span>}
          </p>
        </div>
        <Link to="/blog" className="btn btn-ghost">كل المقالات</Link>
      </div>
      <ErrorBox error={error} />
      {blocked && (
        <div className="card p-4 border-error" role="alert" data-blocked>
          <p className="font-semibold">لا يُنشر المقال قبل إكمال:</p>
          <ul className="list-disc ps-5 mt-2 text-sm">{blocked.map((m, i) => <li key={i}>{missingText(m, photoIndex)}</li>)}</ul>
        </div>
      )}

      <DirtyScope version={version} className="grid gap-5" data-blog-form>
        <section className="card p-4 grid gap-4" aria-labelledby="b-sec-title">
          <h2 id="b-sec-title" className="font-bold">العنوان والرابط</h2>
          <LabelPair kind="text" rows={1} max={120} ar={f.title_ar} en={f.title_en}
            onChange={(a, e) => setF((x) => ({ ...x, title_ar: a, title_en: e, slug: slugTouched || locked ? x.slug : slugify(e) }))}
            ids={{ ar: 'b-title-ar', en: 'b-title-en' }} labels={{ ar: 'العنوان بالعربية', en: 'العنوان بالإنجليزية' }} disabled={dis} />
          <Field label="الرابط" id="b-slug" hint={locked ? `ثابت بعد النشر: /blog/${f.slug}/` : 'حروف إنجليزية صغيرة وأرقام وشرطات؛ يُقترح من العنوان الإنجليزي.'}>
            <input id="b-slug" className="field latin" dir="ltr" value={f.slug} maxLength={80} disabled={dis || locked} autoComplete="off" data-field="slug"
              aria-invalid={(!!f.slug && !slugOk) || slugTaken || undefined}
              onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} />
          </Field>
          {(f.slug && !slugOk) && <p className="text-sm text-error">الرابط: حروف إنجليزية صغيرة وأرقام وشرطات فقط.</p>}
          {slugTaken && <p className="text-sm text-error" data-warning="slug_taken">الرابط مستخدم في مقال آخر.</p>}
          <LabelPair kind="text" rows={2} max={300} ar={f.excerpt_ar} en={f.excerpt_en} onChange={(a, e) => setF((x) => ({ ...x, excerpt_ar: a, excerpt_en: e }))}
            ids={{ ar: 'b-excerpt-ar', en: 'b-excerpt-en' }} labels={{ ar: 'المقتطف بالعربية', en: 'المقتطف بالإنجليزية' }}
            hints={{ ar: 'سطران يعرّفان بالمقال في بطاقته؛ اختياري — بدونه تعرض البطاقة وصف SEO.' }} disabled={dis} />
        </section>

        <section className="card p-4 grid gap-3" aria-labelledby="b-sec-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="b-sec-body" className="font-bold">النص</h2>
            <Segmented value={lang} onChange={setLang} label="لغة النص" options={[{ value: 'ar', label: `العربية${langs.includes('ar') ? ' ✓' : ''}` }, { value: 'en', label: `English${langs.includes('en') ? ' ✓' : ''}` }]} />
          </div>
          <p className="text-xs text-ink-muted">العناوين الرئيسية تقسّم المقال إلى أقسام. يمكن أن يكون المقال بلغة واحدة فقط: اترك عنوان اللغة الأخرى ونصها فارغين.</p>
          <RichEditor
            key={`${lang}-${version}`}
            ref={editor}
            id={`b-body-${lang}`}
            lang={lang}
            value={f[`body_${lang}`]}
            onChange={(md) => set(`body_${lang}`, md)}
            preview={preview}
            onLink={() => setLinkOpen(true)}
            onImage={() => setImageOpen(true)}
            disabled={dis}
          />
          {/* the Markdown of both languages, so the page's unsaved-changes guard sees the text */}
          <textarea id="b-body-ar-md" className="sr-only" aria-hidden="true" tabIndex={-1} readOnly value={f.body_ar} />
          <textarea id="b-body-en-md" className="sr-only" aria-hidden="true" tabIndex={-1} readOnly value={f.body_en} />
          <div className="grid sm:grid-cols-2 gap-3">
            {(['ar', 'en'] as Lang[]).map((l) => (
              <Field key={l} label={`الوسوم (${LANG_LABELS[l]})`} id={`b-tags-${l}`} hint="افصل بين الوسوم بفاصلة؛ حتى 8 وسوم. تُصفّى بها قائمة المدونة وتُختار بها المقالات ذات الصلة.">
                <input id={`b-tags-${l}`} className={`field ${l === 'en' ? 'latin' : ''}`} dir={l === 'ar' ? 'rtl' : 'ltr'} lang={l} value={tagsRaw[l]} disabled={dis} data-field={`tags_${l}`}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setTagsRaw((t) => ({ ...t, [l]: raw }));
                    set(`tags_${l}`, [...new Set(raw.split(/[,،]/).map((s) => s.trim()).filter(Boolean))].slice(0, 8));
                  }} />
              </Field>
            ))}
          </div>
        </section>

        <section className="card p-4 grid gap-4" aria-labelledby="b-sec-links">
          <h2 id="b-sec-links" className="font-bold">الارتباط والصور</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="الفرع المرتبط" id="b-branch" hint="مربّع الحجز في نهاية المقال يفتح النموذج بهذا الفرع؛ «بلا فرع» = بلا فرع محدد.">
              <select id="b-branch" className="field" value={f.branch ?? ''} disabled={dis} onChange={(e) => set('branch', (e.target.value || null) as ArticleFields['branch'])} data-field="branch">
                {BRANCH_CHOICES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </Field>
            <Field label="مكان مرتبط من «اكتشف الطائف»" id="b-place">
              <select id="b-place" className="field" value={f.related_place ?? ''} disabled={dis} onChange={(e) => set('related_place', e.target.value || null)} data-field="related_place">
                <option value="">بلا مكان</option>
                {PLACES.map((p) => <option key={p.key} value={p.key}>{p.name_ar}</option>)}
              </select>
            </Field>
            <Field label="الكاتب" id="b-author">
              <input id="b-author" className="field" value={f.author} maxLength={80} disabled={dis} onChange={(e) => set('author', e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-2" data-cover>
            <p className="label">صورة الغلاف وصور النص</p>
            {cover ? (
              <div className="flex items-center gap-3">
                {urls[cover.thumb_path ?? ''] && <img src={urls[cover.thumb_path ?? '']} alt={cover.alt_ar} className="w-28 aspect-[3/2] object-cover rounded" />}
                <p className="text-sm">الغلاف من «الصور»{cover.status !== 'published' ? ' (يُنشر مع المقال)' : ''}.</p>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">{article?.cover_path ? <>الصورة الحالية على الموقع: <span className="latin num" dir="ltr">{article.cover_path}</span> — تحل محلها صورة غلاف تُرفع في «الصور».</> : 'لا صورة غلاف: يعرض الموقع العلامة البديلة حتى تُرفع صورة في «الصور».'}</p>
            )}
            {!cover && (
              <LabelPair kind="alt" ar={f.cover_alt_ar} en={f.cover_alt_en} onChange={(a, e) => setF((x) => ({ ...x, cover_alt_ar: a, cover_alt_en: e }))}
                ids={{ ar: 'b-cover-alt-ar', en: 'b-cover-alt-en' }} labels={{ ar: 'وصف الغلاف بالعربية', en: 'وصف الغلاف بالإنجليزية' }} disabled={dis} />
            )}
            {id && seesMedia ? (
              <Link to={`/media?t=blog:${article?.slug ?? f.slug}`} className="link text-sm" data-action="blog-media">إدارة صور المقال في «الصور» ({photos.length})</Link>
            ) : (
              <p className="text-xs text-ink-muted">{id ? 'رفع الصور يحتاج صلاحية «الصور».' : 'احفظ المقال أولًا لرفع صوره في «الصور».'}</p>
            )}
            <Field label="صورة المشاركة (OG)" id="b-og" hint="تظهر عند مشاركة رابط المقال؛ الافتراضي صورة الغلاف.">
              <select id="b-og" className="field" value={f.og_media ?? ''} disabled={dis} onChange={(e) => set('og_media', e.target.value || null)} data-field="og_media">
                <option value="">صورة الغلاف</option>
                {photos.filter((p) => p.slot === 'gallery').map((p, n) => <option key={p.id} value={p.id}>{`صورة النص رقم ${n + 1}${p.alt_ar ? ` — ${p.alt_ar}` : ''}`}</option>)}
              </select>
            </Field>
          </div>
        </section>

        <section className="card p-4 grid gap-4" aria-labelledby="b-sec-seo">
          <h2 id="b-sec-seo" className="font-bold">محركات البحث (SEO)</h2>
          <LabelPair kind="text" rows={1} max={SEO_TITLE_MAX} ar={f.seo_title_ar} en={f.seo_title_en} onChange={(a, e) => setF((x) => ({ ...x, seo_title_ar: a, seo_title_en: e }))}
            ids={{ ar: 'b-seo-title-ar', en: 'b-seo-title-en' }} labels={{ ar: 'عنوان SEO بالعربية', en: 'عنوان SEO بالإنجليزية' }} disabled={dis} />
          <div className="flex justify-between gap-3 text-xs"><span>العربية: <Counter value={f.seo_title_ar} max={SEO_TITLE_MAX} /></span><span>English: <Counter value={f.seo_title_en} max={SEO_TITLE_MAX} /></span></div>
          <LabelPair kind="text" rows={3} max={SEO_DESC_MAX} ar={f.seo_description_ar} en={f.seo_description_en} onChange={(a, e) => setF((x) => ({ ...x, seo_description_ar: a, seo_description_en: e }))}
            ids={{ ar: 'b-seo-desc-ar', en: 'b-seo-desc-en' }} labels={{ ar: 'وصف SEO بالعربية', en: 'وصف SEO بالإنجليزية' }} disabled={dis} />
          <div className="flex justify-between gap-3 text-xs"><span>العربية: <Counter value={f.seo_description_ar} max={SEO_DESC_MAX} /></span><span>English: <Counter value={f.seo_description_en} max={SEO_DESC_MAX} /></span></div>
          <div className="grid md:grid-cols-2 gap-3" aria-label="معاينة نتيجة البحث">
            {(['ar', 'en'] as Lang[]).filter((l) => langs.includes(l) || !langs.length).map((l) => (
              <Snippet key={l} lang={l} title={f[`seo_title_${l}`] || f[`title_${l}`]} desc={f[`seo_description_${l}`]} slug={f.slug} />
            ))}
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="الرابط الأساسي (canonical)" id="b-canonical" hint="فارغ = صفحة المقال نفسها. رابط https كامل أو مسار في الموقع.">
              <input id="b-canonical" className="field latin" dir="ltr" value={f.canonical ?? ''} maxLength={300} disabled={dis} onChange={(e) => set('canonical', e.target.value.trim() || null)} data-field="canonical" />
            </Field>
            <div>
              <DateField mode="single" id="b-date" label="تاريخ النشر الظاهر" min="past" value={f.date_published ?? ''} onChange={(v) => set('date_published', v || null)} disabled={dis} />
              <p className="text-xs text-ink-muted mt-1">فارغ = يوم النشر.</p>
            </div>
            <div>
              <DateField mode="single" id="b-updated" label="تاريخ التحديث (اختياري)" min="past" value={f.date_updated ?? ''} onChange={(v) => set('date_updated', v || null)} disabled={dis} />
            </div>
          </div>
        </section>
      </DirtyScope>

      {warnings.length > 0 && (
        <section className="card p-4" aria-labelledby="b-warn" data-warnings>
          <h2 id="b-warn" className="font-bold text-sm">تنبيهات</h2>
          <ul className="list-disc ps-5 mt-2 text-sm grid gap-1">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}

      <div className="blog-actions" role="group" aria-label="إجراءات المقال">
        {editable && <button type="button" className="btn btn-ghost" onClick={() => void save()} disabled={busy} data-action="blog-save">{busy && <Spinner />} حفظ</button>}
        <button type="button" className="btn btn-ghost" onClick={() => setPreviewOpen(true)} disabled={!langs.length} data-action="blog-preview">معاينة</button>
        {publisher && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => void publish(null)} disabled={busy || slugTaken} data-action="blog-publish">{busy && <Spinner />} {article?.live ? 'نشر التعديلات الآن' : 'نشر الآن'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setScheduleOpen(true)} disabled={busy || slugTaken} data-action="blog-schedule">جدولة…</button>
            {article?.live && <button type="button" className="btn btn-ghost" onClick={() => setUnpublishOpen(true)} disabled={busy} data-action="blog-unpublish">إيقاف النشر</button>}
          </>
        )}
      </div>

      <LinkDialog open={linkOpen} onClose={() => setLinkOpen(false)} choices={linkChoices} lang={lang}
        onPick={(href, text) => { setLinkOpen(false); window.setTimeout(() => editor.current?.insertLink(href, text), 30); }} />
      <ImageDialog open={imageOpen} onClose={() => setImageOpen(false)} photos={photos.filter((p) => p.slot === 'gallery' || p.slot === 'cover')} urls={urls} lang={lang}
        mediaLink={id && seesMedia ? `/media?t=blog:${article?.slug ?? f.slug}` : null}
        onPick={(p, caption) => { setImageOpen(false); window.setTimeout(() => editor.current?.insertBlock(figureHtml(photoDirective(p.id, caption), preview)), 30); }} />
      <PreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} f={f} langs={langs} preview={preview} />
      <ScheduleDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} busy={busy} current={article?.state === 'scheduled' ? article.publish_at : null} onSchedule={(at) => void publish(at)} />
      <Confirm open={unpublishOpen} title="إيقاف نشر المقال" body="يختفي المقال من الموقع مع البناء التالي ويبقى هنا مسودة؛ رابطه ثابت ويعود عند نشره من جديد." confirmLabel="إيقاف النشر" danger busy={busy} onConfirm={() => void unpublish()} onClose={() => setUnpublishOpen(false)} />
    </div>
  );
}

// ── the dialogs ────────────────────────────────────────────────────────────────────────────────────────────────

function LinkDialog({ open, onClose, choices, lang, onPick }: { open: boolean; onClose: () => void; choices: LinkChoice[]; lang: Lang; onPick: (href: string, text: string) => void }) {
  const [q, setQ] = useState('');
  const [href, setHref] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) {
      setQ('');
      setHref('');
      setText('');
    }
  }, [open]);
  const shown = choices.filter((c) => !q.trim() || `${c.label} ${c.group} ${c.path}`.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = [...new Set(shown.map((c) => c.group))];
  const valid = /^(https:\/\/\S+|\/\S*|mailto:\S+|tel:\+?\d+)$/.test(href.trim());
  return (
    <Modal open={open} onClose={onClose} title="إدراج رابط">
      <div className="grid gap-3" data-link-dialog>
        <Field label="العنوان (رابط خارجي https أو مسار في الموقع)" id="ld-href">
          <input id="ld-href" className="field latin" dir="ltr" value={href} onChange={(e) => setHref(e.target.value)} placeholder="/airport-road/" />
        </Field>
        <Field label="نص الرابط (إن لم يُحدَّد نص في المحرر)" id="ld-text">
          <input id="ld-text" className="field" dir={lang === 'ar' ? 'rtl' : 'ltr'} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div>
          <label htmlFor="ld-q" className="label">رابط داخلي: فرع، غرفة، عرض، مكان، مقال</label>
          <input id="ld-q" type="search" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث…" data-no-dirty />
          <div className="ld-list mt-2" role="listbox" aria-label="الروابط الداخلية">
            {groups.map((g) => (
              <div key={g} role="group" aria-label={g}>
                <p className="picker-subhead">{g}</p>
                {shown.filter((c) => c.group === g).map((c) => {
                  const path = sitePath(lang, c.path);
                  return (
                    <button key={c.group + c.path} type="button" role="option" aria-selected={href === path} className={`media-target ${href === path ? 'is-on' : ''}`} onClick={() => { setHref(path); if (!text) setText(c.label); }} data-link={path}>
                      <span className="truncate">{c.label}</span>
                      <span className="text-xs opacity-75 latin num" dir="ltr">{path}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!groups.length && <p className="text-sm text-ink-muted px-2 py-3">لا نتائج.</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <CancelButton />
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => onPick(href.trim(), text.trim())} data-action="link-insert">إدراج</button>
        </div>
      </div>
    </Modal>
  );
}

function ImageDialog({ open, onClose, photos, urls, lang, mediaLink, onPick }: { open: boolean; onClose: () => void; photos: MediaItem[]; urls: Record<string, string>; lang: Lang; mediaLink: string | null; onPick: (p: MediaItem, caption: string) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  useEffect(() => {
    if (open) {
      setPick(null);
      setCaption('');
    }
  }, [open]);
  const chosen = photos.find((p) => p.id === pick);
  return (
    <Modal open={open} onClose={onClose} title="إدراج صورة من «الصور»" wide>
      <div className="grid gap-3" data-image-dialog>
        {!photos.length ? (
          <p className="text-sm text-ink-muted">لا صور لهذا المقال بعد. {mediaLink ? <Link to={mediaLink} className="link">ارفعها في «الصور»</Link> : 'احفظ المقال ثم ارفع صوره في «الصور».'}</p>
        ) : (
          <div className="media-grid" role="radiogroup" aria-label="صور المقال">
            {photos.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} className={`media-tile ed-pick ${pick === p.id ? 'is-on' : ''}`} onClick={() => setPick(p.id)} data-photo={p.id}>
                {urls[p.thumb_path ?? ''] ? <img src={urls[p.thumb_path ?? '']} alt="" className="media-thumb" /> : <span className="media-thumb" />}
                <span className="text-xs truncate">{(lang === 'ar' ? p.alt_ar : p.alt_en) || 'بلا نص بديل'}</span>
              </button>
            ))}
          </div>
        )}
        {chosen && (!chosen.alt_ar.trim() || !chosen.alt_en.trim()) && <p className="text-sm text-error">هذه الصورة بلا نص بديل كامل؛ أكمله في «الصور» قبل النشر.</p>}
        <Field label="تعليق تحت الصورة (اختياري)" id="id-caption">
          <input id="id-caption" className="field" dir={lang === 'ar' ? 'rtl' : 'ltr'} value={caption} maxLength={160} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <CancelButton />
          <button type="button" className="btn btn-primary" disabled={!chosen} onClick={() => chosen && onPick(chosen, caption.trim())} data-action="image-insert">إدراج</button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewDialog({ open, onClose, f, langs, preview }: { open: boolean; onClose: () => void; f: ArticleFields; langs: Lang[]; preview: (src: string) => { url?: string; alt: string } }) {
  const [lang, setLang] = useState<Lang>(langs[0] ?? 'ar');
  useEffect(() => {
    if (open) setLang(langs[0] ?? 'ar');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // the same conversion the editor uses (sanitised, raw HTML dropped)
  const html = useMemo(() => (open ? markdownPreview(f[`body_${lang}`], preview) : ''), [open, f, lang, preview]);
  return (
    <Modal open={open} onClose={onClose} title="معاينة المقال" wide>
      <div className="grid gap-4" data-preview>
        {langs.length > 1 && <Segmented value={lang} onChange={setLang} label="لغة المعاينة" options={langs.map((l) => ({ value: l, label: LANG_LABELS[l] }))} />}
        <Snippet lang={lang} title={f[`seo_title_${lang}`] || f[`title_${lang}`]} desc={f[`seo_description_${lang}`]} slug={f.slug} />
        <article className={`ed-preview ${lang === 'en' ? 'font-en' : ''}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
          <p className="text-xs text-ink-muted">{f[`tags_${lang}`].join(' · ')}</p>
          <h1>{f[`title_${lang}`]}</h1>
          {f[`excerpt_${lang}`] && <p className="ed-lead">{f[`excerpt_${lang}`]}</p>}
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
        <div className="flex justify-end"><CancelButton label="إغلاق" /></div>
      </div>
    </Modal>
  );
}

function ScheduleDialog({ open, onClose, busy, current, onSchedule }: { open: boolean; onClose: () => void; busy: boolean; current: string | null; onSchedule: (at: string) => void }) {
  const init = riyadhParts(current);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.date ? init.time : '09:00');
  useEffect(() => {
    if (!open) return;
    const p = riyadhParts(current);
    setDate(p.date);
    setTime(p.date ? p.time : '09:00');
  }, [open, current]);
  const at = date ? riyadhStamp(date, time) : '';
  const future = !!at && new Date(at).getTime() > Date.now();
  return (
    <Modal open={open} onClose={onClose} title="جدولة النشر" busy={busy}>
      <div className="grid gap-3" data-schedule-dialog>
        <p className="text-sm text-ink-muted">يظهر المقال على الموقع في الموعد (بتوقيت الرياض) — خلال ساعة منه على الأكثر.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <DateField mode="single" id="s-date" label="اليوم" min="today" value={date} onChange={setDate} />
          <Field label="الساعة" id="s-time">
            <select id="s-time" className="field num" value={time} onChange={(e) => setTime(e.target.value)}>
              {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        {date && !future && <p className="text-sm text-error">اختر موعدًا لاحقًا، أو استخدم «نشر الآن».</p>}
        <div className="flex justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" disabled={!future || busy} onClick={() => onSchedule(at)} data-action="schedule-go">{busy && <Spinner />} جدولة</button>
        </div>
      </div>
    </Modal>
  );
}
