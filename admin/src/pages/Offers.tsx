// «العروض» — the dashboard offers module (Ahmed, 2 Nov 2026; DASHBOARD-SPEC.md §3.9b; DECISIONS.md 2026-11-02).
// Three categories managed separately, each its own tab — عروض الأفراد (stays: a percent, a fixed nightly price, free
// breakfast, stay N pay N−1, or a promo code with a percent / fixed effect — the booking engine applies them on the
// server), الشركات والشركاء (never a price: a quote request and the sales WhatsApp) and المطعم والمقهى (linked to a
// dining venue, with its own explicit price) — plus «النافذة المنبثقة», the one pop-up of the site:
//   - per category, the offers in their site order (تقديم / تأخير), each with its state (مسودة / منشور / مجدول / منتهٍ),
//     «تعديلات غير منشورة», what blocks publishing and what only warns; the archive behind «الأرشيف»;
//   - «إضافة عرض» / «تعديل» opens the form (the shared Modal and its dirty guard; LabelPair for every ar / en pair —
//     the translation is a suggestion, never filled in by itself);
//   - «نشر» (one offer) / «نشر كل التعديلات» checks first and lists what is missing; a publish creates a job and asks for
//     the site build (site-rebuild, reason offers). Nothing reaches the site before «نشر»; «إيقاف النشر» and «أرشفة»
//     take an offer off the site the same way;
//   - the offer's photo lives in «الصور» (target offer:<slug>, a cover, required) and is published with the offer;
//   - the pop-up designer: a published offer, the texts, the button's colour / shape, the entrance, on / off, the
//     schedule, the frequency, the delay, the pages, «لا تظهر على الجوال», and a live preview of the site's pop-up.
// Levels: view (read-only), edit (add, edit, order, archive a draft), publish (+ «نشر», «إيقاف النشر», archive a live
// offer); the branch scope applies (an offer on both branches needs both); the pop-up needs all branches.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as api from '../lib/api';
import type { Branch, DiningVenue, MediaJob, RoomType } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, countWord, longDate, riyadhDateTime, sar, type CountNoun } from '../lib/format';
import { JOB_STATUS, previewUrls } from '../lib/media';
import { TIMES } from '../lib/dining';
import {
  blankOffer, blankPopup, CATEGORY_LABELS, CODE, COLOR_LABELS, CTA_LABELS, effectText, ENTRANCE_LABELS, MISSING_LABELS, PAGE_LABELS, PLACEMENTS,
  POPUP_MISSING, QUOTE_LABELS, riyadhParts, riyadhStamp, SHAPE_LABELS, SLUG, slugify, STATE_CHIP, STATE_LABELS, STAY_PAY_MODE_LABELS, TYPE_LABELS, WARNING_LABELS,
  type Offer, type OfferCategory, type OfferFields, type OfferPublishResult, type Popup, type PopupFields, type PopupPage, type QuoteRequest, type StayPayMode, type TypeChoice,
} from '../lib/offers';
import * as off from '../lib/offers';
import LabelPair from '../components/LabelPair';
import DateField from '../components/DateField';
import { CancelButton, Confirm, Empty, ErrorBox, Field, Loading, Modal, NumberField, Segmented, Spinner, useToast } from '../components/ui';

type Tab = OfferCategory | 'popup';
const TABS: { key: Tab; label: string }[] = [
  { key: 'individuals', label: CATEGORY_LABELS.individuals },
  { key: 'b2b', label: CATEGORY_LABELS.b2b },
  { key: 'dining', label: CATEGORY_LABELS.dining },
  { key: 'popup', label: 'النافذة المنبثقة' },
];

function validity(o: Pick<OfferFields, 'valid_from' | 'valid_to'>): string {
  if (o.valid_from && o.valid_to) return `من ${longDate(o.valid_from)} إلى ${longDate(o.valid_to)}`;
  if (o.valid_from) return `من ${longDate(o.valid_from)}، بلا تاريخ نهاية`;
  if (o.valid_to) return `حتى ${longDate(o.valid_to)}`;
  return 'بلا تاريخ نهاية';
}

export default function Offers() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'offers');
  const publisher = api.canPublish(me, 'offers');
  const seesMedia = api.canView(me, 'media');
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'individuals') as Tab;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [venues, setVenues] = useState<DiningVenue[]>([]);
  const [list, setList] = useState<Offer[] | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Offer | 'new' | null>(null);
  const [sending, setSending] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ result: OfferPublishResult; all: boolean } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [ask, setAsk] = useState<{ kind: 'unpublish' | 'archive'; offer: Offer } | null>(null);
  const [designing, setDesigning] = useState<Popup | 'new' | null>(null);
  const [popupBlocked, setPopupBlocked] = useState<{ code: string }[] | null>(null);
  const allBranches = !me?.branch;

  const load = useCallback(async () => {
    try {
      setError(null);
      const [b, o, r] = await Promise.all([api.branches(), off.offers(), api.roomTypes()]);
      setBranches(b);
      setList(o);
      setRooms(r.filter((x) => !x.is_test));
    } catch (e) {
      setError((e as Error).message);
      setList([]);
    }
    try {
      setVenues(await api.diningVenues());
    } catch { /* no dining view: the venue list stays empty */ }
    if (allBranches) {
      try {
        setPopups(await off.popups());
      } catch { /* the tab shows the error on its own */ }
    }
    try {
      setJobs(await off.offersJobs());
    } catch { /* the panel keeps the last list */ }
  }, [allBranches]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!jobs.some((j) => j.status === 'queued' || j.status === 'building')) return;
    const t = window.setInterval(async () => setJobs(await off.offersJobs().catch(() => jobs)), 15000);
    return () => window.clearInterval(t);
  }, [jobs]);

  const names = useMemo(() => {
    const m = new Map<string, string>((list ?? []).map((o) => [o.slug, o.title_ar]));
    popups.forEach((p) => m.set(p.id, `النافذة المنبثقة: ${p.name}`));
    return m;
  }, [list, popups]);

  async function rebuilt(jobId: string | null | undefined, done: string) {
    if (!jobId) {
      toast(done);
      return;
    }
    const rb = await api.siteRebuild('offers', jobId);
    toast(
      rb.ok && rb.dispatched ? `${done} يُبنى الموقع الآن ويظهر التغيير خلال دقائق.` : rb.reason === 'no_token' ? `${done} يظهر على الموقع مع إعادة البناء التالية.` : `${done} لكن تعذّر بدء البناء؛ أعد المحاولة من قائمة النشر.`,
      rb.ok && rb.dispatched ? undefined : rb.reason === 'no_token' ? undefined : 'error',
    );
  }

  async function publish(ids: string[] | null, skip = false) {
    setPublishing(true);
    try {
      const r = await off.offersPublish(ids, skip);
      if (r.ok && r.job_id) {
        setBlocked(null);
        await rebuilt(r.job_id, 'نُشر.');
        await load();
      } else if (r.reason === 'nothing') toast('لا تغييرات للنشر.');
      else setBlocked({ result: r, all: ids === null });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPublishing(false);
    }
  }
  async function act(kind: 'unpublish' | 'archive' | 'restore', o: Offer) {
    setBusy(true);
    try {
      const r = kind === 'unpublish' ? await off.offerUnpublish(o.id) : kind === 'archive' ? await off.offerArchive(o.id) : await off.offerRestore(o.id);
      setAsk(null);
      await rebuilt(r.job_id, kind === 'unpublish' ? 'أُوقف نشر العرض.' : kind === 'archive' ? 'أُرشف العرض.' : 'استُرجع العرض مسودةً.');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function move(items: Offer[], o: Offer, by: number) {
    const ids = items.map((x) => x.id);
    const at = ids.indexOf(o.id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(at, 1)[0]);
    try {
      await off.offersReorder(o.category, ids);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    await load();
  }
  async function publishPopup(p: Popup) {
    setPublishing(true);
    try {
      const r = await off.popupPublish(p.id);
      if (r.ok && r.job_id) await rebuilt(r.job_id, p.enabled ? 'نُشرت النافذة المنبثقة.' : 'أُوقفت النافذة المنبثقة على الموقع.');
      else if (r.reason === 'nothing') toast('لا تغييرات للنشر.');
      else setPopupBlocked(r.missing ?? []);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPublishing(false);
    }
  }
  async function deletePopup(p: Popup) {
    try {
      await off.popupDelete(p.id);
      toast('حُذف التصميم.');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (list === null) return <Loading />;
  const category = tab === 'popup' ? null : tab;
  const items = category ? list.filter((o) => o.category === category && (archived ? o.state === 'archived' : o.state !== 'archived')) : [];
  const pendingAll = list.filter((o) => o.pending).length;
  const roomName = (key: string) => {
    const [b, s] = key.split('/');
    const r = rooms.find((x) => x.branch === b && x.slug === s);
    return r ? r.name_ar : s;
  };

  return (
    <div className="grid gap-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">العروض</h1>
          <p className="text-sm text-ink-muted mt-1">
            أضف العروض وعدّلها ورتّبها، ثم اضغط «نشر». لا يظهر على الموقع إلا ما نُشر، والعرض المنتهي يختفي من الموقع وحده. عروض الأفراد يطبّقها نظام الحجز على السعر مباشرة، وعروض الشركات بلا أسعار. صورة كل عرض في «الصور».
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : !publisher ? ' النشر لمن يملك صلاحية «نشر».' : ''}
          </p>
        </div>
        {publisher && (
          <button type="button" className="btn btn-primary" onClick={() => publish(null)} disabled={publishing || !pendingAll} data-action="offers-publish-all">
            {publishing && <Spinner />} نشر كل التعديلات{pendingAll ? ` (${pendingAll})` : ''}
          </button>
        )}
      </div>
      <ErrorBox error={error} />

      <div role="tablist" aria-label="أقسام العروض" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`offers-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="offers-panel"
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px min-h-11 ${tab === t.key ? 'border-bronze-deep text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
            data-tab={t.key}
          >
            {t.label}
            {t.key !== 'popup' && <span className="num text-xs text-ink-muted ms-1">({list.filter((o) => o.category === t.key && o.state !== 'archived').length})</span>}
          </button>
        ))}
      </div>

      <section id="offers-panel" role="tabpanel" aria-labelledby={`offers-tab-${tab}`} className="grid gap-4" data-panel={tab}>
        {category ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm min-h-11">
                <input type="checkbox" className="size-4 accent-bronze-deep" checked={archived} onChange={(e) => setArchived(e.target.checked)} data-no-dirty data-archive-toggle />
                الأرشيف
              </label>
              {editable && !archived && <button type="button" className="btn btn-ghost" onClick={() => setEditing('new')} data-action="offer-add">إضافة عرض</button>}
            </div>
            {!items.length ? (
              <Empty text={archived ? 'لا عروض مؤرشفة في هذه الفئة.' : 'لا عروض في هذه الفئة بعد.'} />
            ) : (
              <ol className="card p-4 grid gap-2">
                {items.map((o, n) => (
                  <li key={o.id} className="grid gap-2 border-b border-line last:border-0 py-3" data-offer={o.slug} data-state={o.state}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {o.title_ar} {o.title_en && <span className="latin text-xs text-ink-muted" dir="ltr">{o.title_en}</span>}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {effectText(o, sar)} · {o.branches.map((b) => BRANCH_NAMES[b] ?? b).join(' و')} · {validity(o)}
                          {o.room_types.length > 0 && ` · ${o.room_types.map(roomName).join('، ')}`}
                          {o.min_nights > 1 && ` · ${o.min_nights} ليالٍ على الأقل`}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className={`chip ${STATE_CHIP[o.state]}`} data-state-chip>{STATE_LABELS[o.state]}</span>
                          {!o.show_site && <span className="chip chip-request" data-hidden-site>مخفي عن الموقع</span>}
                          {o.show_bar && <span className="chip chip-request">شريط الإعلان</span>}
                          {o.pending && <span className="chip chip-request" data-pending>تعديلات غير منشورة</span>}
                          {o.state !== 'archived' && o.check.missing.length > 0 && (
                            <span className="chip chip-test" data-missing>ينقص: {o.check.missing.map((m) => MISSING_LABELS[m.code]).join('، ')}</span>
                          )}
                          {o.state !== 'archived' && o.check.warnings.map((w) => <span key={w.code} className="chip chip-flag" data-warning={w.code}>{WARNING_LABELS[w.code]}</span>)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {editable && !archived && items.length > 1 && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={n === 0} onClick={() => move(items, o, -1)} aria-label={`تقديم ${o.title_ar}`} data-action="offer-earlier">تقديم</button>
                            <button type="button" className="btn btn-ghost btn-sm" disabled={n === items.length - 1} onClick={() => move(items, o, 1)} aria-label={`تأخير ${o.title_ar}`} data-action="offer-later">تأخير</button>
                          </>
                        )}
                        {seesMedia && !archived && <Link className="btn btn-ghost btn-sm" to={`/media?t=offer:${o.slug}`} data-action="offer-photo">الصورة</Link>}
                        {!archived && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(o)} data-action="offer-edit">{editable ? 'تعديل' : 'عرض'}</button>}
                        {publisher && !archived && (o.state === 'draft' || o.pending) && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => publish([o.id])} disabled={publishing} data-action="offer-publish">نشر</button>
                        )}
                        {publisher && !archived && o.live && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsk({ kind: 'unpublish', offer: o })} data-action="offer-unpublish">إيقاف النشر</button>
                        )}
                        {publisher && !archived && (o.live as { audience?: string } | null)?.audience === 'members' && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSending(o)} data-action="offer-members-send">إرسال للأعضاء</button>
                        )}
                        {editable && !archived && (!o.live || publisher) && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsk({ kind: 'archive', offer: o })} data-action="offer-archive">أرشفة</button>
                        )}
                        {editable && archived && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('restore', o)} disabled={busy} data-action="offer-restore">استرجاع</button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : !allBranches ? (
          <Empty text="النافذة المنبثقة تخص الموقع كله؛ تحتاج صلاحية على الفرعين." />
        ) : (
          <PopupList
            popups={popups}
            offers={list}
            editable={editable}
            publisher={publisher}
            publishing={publishing}
            onNew={() => setDesigning('new')}
            onEdit={(p) => setDesigning(p)}
            onPublish={publishPopup}
            onDelete={deletePopup}
          />
        )}
      </section>

      <Jobs jobs={jobs} names={names} publisher={publisher} onRetry={async (j) => { const rb = await api.siteRebuild('offers', j.id); toast(rb.ok && rb.dispatched ? 'طُلب البناء من جديد.' : 'تعذّر بدء البناء؛ أعد المحاولة بعد قليل.', rb.ok && rb.dispatched ? undefined : 'error'); setJobs(await off.offersJobs().catch(() => jobs)); }} />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? `إضافة عرض — ${category ? CATEGORY_LABELS[category] : ''}` : editing ? (editable ? `تعديل: ${editing.title_ar}` : editing.title_ar) : ''} wide busy={busy}>
        {editing !== null && category && (
          <OfferForm
            key={editing === 'new' ? `new-${category}` : editing.id}
            offer={editing === 'new' ? null : editing}
            category={editing === 'new' ? category : editing.category}
            branches={branches}
            rooms={rooms}
            venues={venues}
            editable={editable}
            seesMedia={seesMedia}
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
          <div className="grid gap-3" data-offers-blocked>
            <p className="text-sm text-ink-muted">لا يُنشر عرض ينقصه شيء مطلوب. أكمل ما يلي ثم انشر:</p>
            <ul className="grid gap-2">
              {(blocked.result.blocked ?? []).map((x) => (
                <li key={x.id} className="text-sm" data-blocked-offer={x.slug}>
                  <strong>{x.title_ar}</strong>
                  <ul className="list-disc ps-5 text-ink-muted">
                    {x.missing.map((m, i) => (
                      <li key={`${m.code}-${i}`} data-missing-code={m.code}>
                        {MISSING_LABELS[m.code]}{m.branch ? `: ${BRANCH_NAMES[m.branch] ?? m.branch}` : ''}{m.title_ar ? `: «${m.title_ar}»` : ''}
                      </li>
                    ))}
                  </ul>
                  {seesMedia && x.missing.some((m) => m.code === 'cover') && (
                    <Link className="text-sm text-accent-text underline" to={`/media?t=offer:${x.slug}`} data-action="blocked-photo">رفع صورة العرض في «الصور»</Link>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2 mt-2">
              <CancelButton label="إغلاق" disabled={publishing} />
              {blocked.all && (blocked.result.ready?.length ?? 0) > 0 && (
                <button type="button" className="btn btn-primary" onClick={() => publish(null, true)} disabled={publishing} data-action="offers-publish-ready">
                  {publishing && <Spinner />} نشر المكتمل فقط ({blocked.result.ready!.length})
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
      <MemberSendDialog offer={sending} onClose={() => setSending(null)} />
      <Confirm
        open={!!ask}
        title={ask?.kind === 'unpublish' ? 'إيقاف نشر العرض' : 'أرشفة العرض'}
        body={ask ? (ask.kind === 'unpublish'
          ? `يختفي «${ask.offer.title_ar}» من الموقع بعد إعادة البناء، ويبقى هنا مسودةً يمكن نشرها من جديد.`
          : `يُنقل «${ask.offer.title_ar}» إلى الأرشيف${ask.offer.live ? ' ويختفي من الموقع بعد إعادة البناء' : ''}. يمكن استرجاعه لاحقًا مسودةً.`) : ''}
        confirmLabel={ask?.kind === 'unpublish' ? 'إيقاف النشر' : 'أرشفة العرض'}
        danger
        onConfirm={() => ask && act(ask.kind, ask.offer)}
        onClose={() => setAsk(null)}
        busy={busy}
      />
      <Modal open={designing !== null} onClose={() => setDesigning(null)} title={designing === 'new' ? 'تصميم نافذة منبثقة' : designing ? (editable ? `تعديل: ${designing.name}` : designing.name) : ''} wide busy={busy}>
        {designing !== null && (
          <PopupForm
            key={designing === 'new' ? 'new' : designing.id}
            popup={designing === 'new' ? null : designing}
            offers={list}
            editable={editable}
            busy={busy}
            setBusy={setBusy}
            onSaved={async () => {
              setDesigning(null);
              await load();
            }}
          />
        )}
      </Modal>
      <Modal open={!!popupBlocked} onClose={() => setPopupBlocked(null)} title="ما ينقص قبل النشر">
        {popupBlocked && (
          <div className="grid gap-3" data-popup-blocked>
            <ul className="list-disc ps-5 text-sm">
              {popupBlocked.map((m) => <li key={m.code} data-missing-code={m.code}>{POPUP_MISSING[m.code] ?? m.code}</li>)}
            </ul>
            <div className="flex justify-end"><CancelButton label="إغلاق" /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Jobs({ jobs, names, publisher, onRetry }: { jobs: MediaJob[]; names: Map<string, string>; publisher: boolean; onRetry: (j: MediaJob) => void }) {
  if (!jobs.length) return null;
  return (
    <section className="card p-4" aria-labelledby="offers-jobs-title" data-jobs>
      <h2 id="offers-jobs-title" className="font-bold mb-3">آخر عمليات النشر</h2>
      <ul className="grid gap-2">
        {jobs.map((j) => (
          <li key={j.id} className="grid gap-1 border-b border-line last:border-0 pb-2 text-sm" data-job={j.id} data-job-status={j.status}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${j.status === 'published' ? 'chip-confirmed' : j.status === 'failed' ? 'chip-test' : 'chip-request'}`}>{JOB_STATUS[j.status]}</span>
              <span className="num">{riyadhDateTime(j.requested_at)}</span>
              {j.requested_label && <span className="text-ink-muted">· {j.requested_label}</span>}
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

/** a selectable chip: filled with a check when pressed, outlined when not; aria-pressed always (the dirty guard reads it) */
function Chip({ on, onClick, children, disabled, ...rest }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean } & Record<string, unknown>) {
  return (
    <button type="button" className={`chip-toggle ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={onClick} disabled={disabled} {...(rest as Record<string, unknown>)}>
      {on && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
      {children}
    </button>
  );
}

function Check({ label, checked, onChange, disabled, hint, ...rest }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string } & Record<string, unknown>) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
        <input type="checkbox" className="size-4 accent-bronze-deep" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} {...(rest as Record<string, unknown>)} />
        {label}
      </label>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/** a Riyadh date with a «مسح» button (no date = open) */
function OptionalDate({ label, value, onChange, disabled, id }: { label: string; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; id: string }) {
  return (
    <div className="grid gap-1" data-date={id}>
      <DateField mode="single" id={id} label={label} min="past" value={value ?? ''} onChange={(v) => onChange(v || null)} disabled={disabled} />
      {value && !disabled && <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => onChange(null)} data-action={`${id}-clear`}>مسح التاريخ</button>}
    </div>
  );
}

// ── the offer form ─────────────────────────────────────────────────────────────────────────────────────────────

function OfferForm({ offer, category, branches, rooms, venues, editable, seesMedia, busy, setBusy, onSaved }: {
  offer: Offer | null; category: OfferCategory; branches: Branch[]; rooms: RoomType[]; venues: DiningVenue[]; editable: boolean; seesMedia: boolean;
  busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void>;
}) {
  const { me } = useSession();
  const toast = useToast();
  const scoped = me?.branch ?? null;
  const [f, setF] = useState<OfferFields>(() => (offer ? pick(offer) : blankOffer(category, [scoped ?? branches[0]?.slug ?? 'airport-road'])));
  const [type, setType] = useState<TypeChoice>(() => (f.promo_code ? 'code' : f.kind === 'none' ? 'percent' : (f.kind as TypeChoice)));
  const [codeEffect, setCodeEffect] = useState<'percent' | 'fixed_price'>(() => (f.kind === 'fixed_price' ? 'fixed_price' : 'percent'));
  // «للأعضاء فقط» (3 Nov 2026): a coded individuals offer whose code never reaches the site
  const [members, setMembers] = useState(offer?.audience === 'members');
  const [slugTouched, setSlugTouched] = useState(!!offer);
  const [error, setError] = useState<string | null>(null);
  const locked = !!offer?.published_at;
  const dis = !editable || busy;
  const set = <K extends keyof OfferFields>(k: K, v: OfferFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const effect = type === 'code' ? codeEffect : type;
  const branchRooms = rooms.filter((r) => f.branches.includes(r.branch));
  const branchVenues = venues.filter((v) => f.branches.includes(v.branch));
  const noCover = offer ? offer.check.missing.some((m) => m.code === 'cover') : true;

  function toggleBranch(slug: string) {
    setF((x) => {
      const next = x.branches.includes(slug) ? x.branches.filter((b) => b !== slug) : [...x.branches, slug].sort();
      return { ...x, branches: next, room_types: x.room_types.filter((r) => next.includes(r.split('/')[0])) };
    });
  }
  function toggleRoom(key: string) {
    setF((x) => ({ ...x, room_types: x.room_types.includes(key) ? x.room_types.filter((r) => r !== key) : [...x.room_types, key].sort() }));
  }

  async function save() {
    setError(null);
    const slug = f.slug.trim().toLowerCase();
    if (!f.branches.length) return setError('اختر فرعًا واحدًا على الأقل.');
    if (!SLUG.test(slug) || slug.length < 2) return setError('رابط العرض بحروف إنجليزية صغيرة وأرقام وشرطات فقط (من 2 إلى 60).');
    if (f.valid_from && f.valid_to && f.valid_to < f.valid_from) return setError('تاريخ النهاية لا يسبق تاريخ البداية.');
    const code = type === 'code' ? (f.promo_code ?? '').trim().toUpperCase() : '';
    if (category === 'individuals') {
      if (type === 'code' && !CODE.test(code)) return setError('الكود من 3 إلى 20 حرفًا إنجليزيًا كبيرًا أو رقمًا أو شرطة.');
      if (effect === 'percent' && (f.percent === null || f.percent < 1 || f.percent > 90)) return setError('نسبة الخصم من 1 إلى 90.');
      if (effect === 'fixed_price' && (f.fixed_price === null || f.fixed_price <= 0)) return setError('أدخل السعر الثابت لليلة.');
      if (effect === 'stay_pay' && (f.stay_nights === null || f.stay_nights < 2 || f.stay_nights > 30)) return setError('عدد الليالي (N) من 2 إلى 30.');
    }
    if (category === 'dining' && !f.venue) return setError('اختر المطعم أو المقهى.');
    if (members && (category !== 'individuals' || type !== 'code')) return setError('العرض للأعضاء فقط يحتاج كودًا.');
    const payload: OfferFields = {
      ...f,
      slug,
      kind: category === 'individuals' ? effect : 'none',
      promo_code: code || null,
      percent: category === 'individuals' && effect === 'percent' ? f.percent : null,
      fixed_price: category === 'individuals' && effect === 'fixed_price' ? f.fixed_price : null,
      stay_nights: category === 'individuals' && effect === 'stay_pay' ? f.stay_nights : null,
      stay_pay_mode: category === 'individuals' && effect === 'stay_pay' ? f.stay_pay_mode ?? 'per_booking' : 'per_booking',
      room_types: category === 'individuals' ? f.room_types : [],
      min_nights: category === 'individuals' ? f.min_nights || 1 : 1,
      venue: category === 'dining' ? f.venue : null,
      dining_price: category === 'dining' ? f.dining_price : null,
    };
    setBusy(true);
    try {
      const saved = await off.offerSave(offer?.id ?? null, payload);
      const wantAudience = members && type === 'code' ? 'members' : 'all';
      if (category === 'individuals' && wantAudience !== (offer?.audience ?? 'all')) await off.offerSetAudience(offer?.id ?? saved.id, wantAudience);
      toast(offer ? 'حُفظت التعديلات؛ لا تظهر على الموقع قبل «نشر».' : 'أُضيف العرض مسودةً؛ أضف صورته في «الصور» ثم انشره.');
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const ctas = (category === 'individuals' ? ['book', 'none'] : category === 'b2b' ? ['quote', 'none'] : ['menu', 'none']) as OfferFields['cta'][];
  return (
    <div className="grid gap-4" data-offer-form data-category={category}>
      {offer?.live && offer.pending && <p className="note-amber text-sm" role="status">فيه تعديلات لم تُنشر بعد؛ الموقع يعرض آخر نسخة منشورة.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <span className="label" id="o-branches-label">الفرع</span>
          {scoped || branches.length < 2 ? (
            <span className="field-static block" aria-labelledby="o-branches-label" data-branch-static={f.branches[0]}>{BRANCH_NAMES[f.branches[0]] ?? f.branches[0]}</span>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="o-branches-label">
              {branches.map((b) => (
                <Chip key={b.slug} on={f.branches.includes(b.slug)} onClick={() => toggleBranch(b.slug)} disabled={dis} data-branch-chip={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</Chip>
              ))}
            </div>
          )}
        </div>
        <Field label="رابط العرض" id="o-slug" hint={locked ? `ثابت بعد النشر: /offers/#offer-${f.slug}` : 'حروف إنجليزية صغيرة وأرقام وشرطات؛ يُقترح من العنوان الإنجليزي.'}>
          <input id="o-slug" className="field latin" dir="ltr" value={f.slug} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value); }} maxLength={60} disabled={dis || locked} autoComplete="off" data-field="slug" />
        </Field>
      </div>
      <LabelPair
        ar={f.title_ar}
        en={f.title_en}
        onChange={(a, e) => setF((x) => ({ ...x, title_ar: a, title_en: e, slug: slugTouched || locked ? x.slug : slugify(e) }))}
        ids={{ ar: 'o-title-ar', en: 'o-title-en' }}
        labels={{ ar: 'العنوان بالعربية', en: 'العنوان بالإنجليزية' }}
        disabled={dis}
      />
      <LabelPair kind="text" max={400} rows={3} ar={f.description_ar} en={f.description_en} onChange={(a, e) => setF((x) => ({ ...x, description_ar: a, description_en: e }))} ids={{ ar: 'o-desc-ar', en: 'o-desc-en' }} labels={{ ar: 'الوصف بالعربية', en: 'الوصف بالإنجليزية' }} hints={{ ar: 'ما يحصل عليه الضيف فعلًا؛ حتى 400 حرف. لا تكتب الأسعار هنا: يعرضها الموقع من التقويم.' }} disabled={dis} />

      {category === 'individuals' && (
        <fieldset className="grid gap-3">
          <legend className="label">نوع العرض</legend>
          <Segmented value={type} onChange={(v) => setType(v)} label="نوع العرض" disabled={dis} options={(Object.keys(TYPE_LABELS) as TypeChoice[]).map((k) => ({ value: k, label: TYPE_LABELS[k] }))} />
          {type === 'code' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="الكود" id="o-code" hint="يكتبه الضيف في نموذج الحجز؛ حروف إنجليزية كبيرة وأرقام وشرطات.">
                <input id="o-code" className="field latin" dir="ltr" value={f.promo_code ?? ''} maxLength={20} onChange={(e) => set('promo_code', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} disabled={dis} autoComplete="off" data-field="promo_code" />
              </Field>
              <div>
                <span className="label">أثر الكود</span>
                <Segmented value={codeEffect} onChange={(v) => setCodeEffect(v)} label="أثر الكود" disabled={dis} options={[{ value: 'percent', label: TYPE_LABELS.percent }, { value: 'fixed_price', label: TYPE_LABELS.fixed_price }]} />
              </div>
              <label className="sm:col-span-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={members} onChange={(e) => setMembers(e.target.checked)} disabled={dis} data-field="audience" />
                <span>
                  <strong>للأعضاء فقط</strong> — لا يظهر الكود على الموقع؛ تعرض البطاقة «للأعضاء — انضم لتحصل على الكود»، ويصل الكود إلى أعضاء نادي أرمادا ريزيدنس عبر «إرسال للأعضاء».
                </span>
              </label>
            </div>
          )}
          <div className="grid sm:grid-cols-3 gap-3">
            {effect === 'percent' && (
              <Field label="نسبة الخصم ٪" id="o-percent" hint="من 1 إلى 90، على كل ليلة مؤهلة.">
                <NumberField id="o-percent" value={f.percent} onChange={(v) => set('percent', v)} decimal min={0} max={90} className="w-28" />
              </Field>
            )}
            {effect === 'fixed_price' && (
              <Field label="السعر لليلة (ريال، شامل الضريبة)" id="o-fixed" hint="لا يرفع سعر ليلة أرخص منه.">
                <NumberField id="o-fixed" value={f.fixed_price} onChange={(v) => set('fixed_price', v)} decimal min={0} className="w-32" />
              </Field>
            )}
            {effect === 'stay_pay' && (
              <Field label="أقم N ليالٍ (وادفع N−1)" id="o-stay" hint="الليلة المجانية هي الأرخص بين الليالي المؤهلة.">
                <NumberField id="o-stay" value={f.stay_nights} onChange={(v) => set('stay_nights', v)} min={0} max={30} className="w-24" />
              </Field>
            )}
            {effect === 'stay_pay' && (
              <div className="sm:col-span-2" data-field="stay_pay_mode">
                <span className="label">عدد الليالي المجانية</span>
                <Segmented value={f.stay_pay_mode ?? 'per_booking'} onChange={(v) => set('stay_pay_mode', v)} label="عدد الليالي المجانية" disabled={dis} options={(Object.keys(STAY_PAY_MODE_LABELS) as StayPayMode[]).map((k) => ({ value: k, label: STAY_PAY_MODE_LABELS[k] }))} />
                <p className="text-xs text-ink-muted mt-1">{(f.stay_pay_mode ?? 'per_booking') === 'per_booking' ? 'ليلة مجانية واحدة في الحجز مهما طالت الإقامة، متى بلغت N ليالٍ مؤهلة.' : `ليلة مجانية عن كل ${f.stay_nights || 'N'} ليالٍ مؤهلة كاملة؛ إقامة ضعف المدة = ليلتان.`}</p>
              </div>
            )}
            <Field label="الحد الأدنى للإقامة (ليالٍ)" id="o-min" hint="1 = بلا حد أدنى.">
              <NumberField id="o-min" value={f.min_nights} onChange={(v) => set('min_nights', v ?? 1)} min={1} max={60} className="w-24" />
            </Field>
          </div>
          {effect === 'free_breakfast' && <p className="text-xs text-ink-muted">يصبح الإفطار مجانيًا في الليالي المؤهلة لمن يختار «مع الإفطار».</p>}
          <div>
            <span className="label" id="o-rooms-label">أنواع الغرف</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="o-rooms-label" data-rooms>
              {branchRooms.map((r) => (
                <Chip key={r.id} on={f.room_types.includes(`${r.branch}/${r.slug}`)} onClick={() => toggleRoom(`${r.branch}/${r.slug}`)} disabled={dis} data-room-chip={`${r.branch}/${r.slug}`}>
                  {r.name_ar}{f.branches.length > 1 ? ` — ${BRANCH_NAMES[r.branch] ?? r.branch}` : ''}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-ink-muted mt-1">{f.room_types.length ? 'العرض لهذه الأنواع فقط.' : 'بلا اختيار: كل أنواع الغرف في فروع العرض.'}</p>
          </div>
        </fieldset>
      )}

      {category === 'b2b' && (
        <div className="grid gap-3">
          <Field label="نوع طلب عرض السعر" id="o-quote" hint="يُختار تلقائيًا في نموذج الشركاء حين يضغط الزائر «اطلب عرض سعر».">
            <select id="o-quote" className="field" value={f.quote_request ?? ''} onChange={(e) => set('quote_request', (e.target.value || null) as QuoteRequest | null)} disabled={dis} data-field="quote_request">
              <option value="">بلا اختيار مسبق</option>
              {(Object.keys(QUOTE_LABELS) as QuoteRequest[]).map((k) => <option key={k} value={k}>{QUOTE_LABELS[k]}</option>)}
            </select>
          </Field>
          <Check label="زر واتساب المبيعات" checked={f.whatsapp} onChange={(v) => set('whatsapp', v)} disabled={dis} data-field="whatsapp" hint="يفتح رقم المبيعات برسالة جاهزة." />
          {f.whatsapp && (
            <LabelPair kind="text" max={300} rows={2} ar={f.whatsapp_prefill_ar} en={f.whatsapp_prefill_en} onChange={(a, e) => setF((x) => ({ ...x, whatsapp_prefill_ar: a, whatsapp_prefill_en: e }))} ids={{ ar: 'o-wa-ar', en: 'o-wa-en' }} labels={{ ar: 'رسالة واتساب الجاهزة بالعربية', en: 'رسالة واتساب الجاهزة بالإنجليزية' }} disabled={dis} />
          )}
        </div>
      )}

      {category === 'dining' && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="المطعم أو المقهى" id="o-venue" hint="يُنشر العرض حين يكون المكان منشورًا «نشطًا».">
            <select id="o-venue" className="field" value={f.venue ?? ''} onChange={(e) => set('venue', e.target.value || null)} disabled={dis} data-field="venue">
              <option value="">اختر…</option>
              {branchVenues.map((v) => <option key={v.slug} value={v.slug}>{v.name_ar}</option>)}
            </select>
          </Field>
          <Field label="السعر (ريال، شامل الضريبة)" id="o-dprice" hint="اختياري؛ يظهر كما هو في بطاقة العرض.">
            <NumberField id="o-dprice" value={f.dining_price} onChange={(v) => set('dining_price', v)} decimal min={0} className="w-32" />
          </Field>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <OptionalDate id="o-from" label="يبدأ في" value={f.valid_from} onChange={(v) => set('valid_from', v)} disabled={dis} />
        <OptionalDate id="o-to" label="ينتهي في" value={f.valid_to} onChange={(v) => set('valid_to', v)} disabled={dis} />
      </div>
      <p className="text-xs text-ink-muted -mt-2">بتوقيت الرياض، شاملًا اليومين. بعد يوم النهاية يختفي العرض من الموقع وحده. بلا تاريخ بداية: من يوم النشر.</p>

      <LabelPair kind="text" max={800} rows={3} ar={f.terms_ar} en={f.terms_en} onChange={(a, e) => setF((x) => ({ ...x, terms_ar: a, terms_en: e }))} ids={{ ar: 'o-terms-ar', en: 'o-terms-en' }} labels={{ ar: 'الشروط بالعربية', en: 'الشروط بالإنجليزية' }} hints={{ ar: 'تظهر تحت العرض؛ حتى 800 حرف.' }} disabled={dis} />

      <div>
        <span className="label">زر الإجراء</span>
        <Segmented value={f.cta} onChange={(v) => set('cta', v)} label="زر الإجراء" disabled={dis} options={ctas.map((c) => ({ value: c, label: CTA_LABELS[c] }))} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="label">أين يظهر</legend>
        <Check label="يظهر على الموقع" checked={f.show_site} onChange={(v) => set('show_site', v)} disabled={dis} data-field="show_site" hint={category === 'individuals' ? 'إن أطفأته لا يظهر العرض في أي صفحة؛ ويبقى كوده (إن وُجد) صالحًا في نموذج الحجز.' : 'إن أطفأته لا يظهر العرض في أي صفحة.'} />
        {f.show_site && (
          <div className="flex flex-wrap gap-1.5" data-placements>
            {PLACEMENTS.filter((p) => p.cats.includes(category)).map((p) => (
              <Chip key={p.key} on={!!f[p.key]} onClick={() => set(p.key, !f[p.key] as never)} disabled={dis} data-placement={p.key}>{p.label}</Chip>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-muted">شريط الإعلان أعلى الموقع صار في «المحتوى» ← «شريط الإعلان»، ومنه تختار عرضًا مميزًا.</p>
      </fieldset>

      <div className="card p-3 grid gap-1 text-sm" data-photo-state={noCover ? 'missing' : 'ready'}>
        <span className="font-semibold">صورة العرض</span>
        {!offer ? (
          <span className="text-ink-muted">احفظ العرض أولًا، ثم ارفع صورته في «الصور» (مطلوبة للنشر).</span>
        ) : noCover ? (
          <span className="text-ink-muted">لا صورة بعد؛ مطلوبة للنشر وتُنشر مع العرض.</span>
        ) : (
          <span className="text-ink-muted">الصورة جاهزة؛ تُنشر مع العرض.</span>
        )}
        {offer && seesMedia && <Link className="text-accent-text underline" to={`/media?t=offer:${offer.slug}`} data-action="offer-media-link">إدارة صورة العرض في «الصور»</Link>}
      </div>

      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="offer-save">
            {busy && <Spinner />} حفظ
          </button>
        )}
      </div>
    </div>
  );
}

function pick(o: Offer): OfferFields {
  const keys = Object.keys(blankOffer('individuals', [])) as (keyof OfferFields)[];
  return Object.fromEntries(keys.map((k) => [k, o[k]])) as unknown as OfferFields;
}

// ── the pop-up ─────────────────────────────────────────────────────────────────────────────────────────────────

function PopupList({ popups, offers, editable, publisher, publishing, onNew, onEdit, onPublish, onDelete }: {
  popups: Popup[]; offers: Offer[]; editable: boolean; publisher: boolean; publishing: boolean;
  onNew: () => void; onEdit: (p: Popup) => void; onPublish: (p: Popup) => void; onDelete: (p: Popup) => void;
}) {
  const live = offers.filter((o) => o.live && o.state !== 'archived');
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-ink-muted max-w-2xl">نافذة واحدة فقط تعمل على الموقع في وقت واحد. صمّمها لعرض منشور، وعاينها، ثم شغّلها واضغط «نشر».</p>
        {editable && (
          <button type="button" className="btn btn-ghost" onClick={onNew} disabled={!live.length} data-action="popup-add" title={live.length ? undefined : 'انشر عرضًا أولًا'}>تصميم نافذة جديدة</button>
        )}
      </div>
      {!popups.length ? (
        <Empty text={live.length ? 'لا تصاميم بعد.' : 'لا تصاميم بعد؛ انشر عرضًا أولًا.'} />
      ) : (
        <ul className="card p-4 grid gap-2">
          {popups.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-line last:border-0 py-3" data-popup={p.name} data-enabled={p.enabled}>
              <div className="min-w-0">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-ink-muted mt-0.5">{p.offer_title_ar ?? '—'} · {ENTRANCE_LABELS[p.entrance]} · {p.frequency === 'visit' ? 'مرة لكل زيارة' : `مرة كل ${p.frequency_days} يوم`} · بعد {p.delay_seconds} ث</div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className={`chip ${p.enabled ? 'chip-confirmed' : 'chip-request'}`} data-on>{p.enabled ? 'مفعّلة' : 'متوقفة'}</span>
                  <span className={`chip ${p.live?.enabled ? 'chip-confirmed' : 'chip-request'}`} data-live>{p.live ? (p.live.enabled ? 'على الموقع' : 'ليست على الموقع') : 'لم تُنشر'}</span>
                  {p.pending && <span className="chip chip-request" data-pending>تعديلات غير منشورة</span>}
                  {p.check.missing.length > 0 && <span className="chip chip-test" data-missing>ينقص: {p.check.missing.map((m) => POPUP_MISSING[m.code] ?? m.code).join('، ')}</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(p)} data-action="popup-edit">{editable ? 'تعديل' : 'عرض'}</button>
                {publisher && p.pending && <button type="button" className="btn btn-primary btn-sm" onClick={() => onPublish(p)} disabled={publishing} data-action="popup-publish">نشر</button>}
                {editable && !p.live && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(p)} data-action="popup-delete">حذف التصميم</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PopupForm({ popup, offers, editable, busy, setBusy, onSaved }: { popup: Popup | null; offers: Offer[]; editable: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const choices = offers.filter((o) => (o.live && o.state !== 'archived') || o.id === popup?.offer_id);
  const [f, setF] = useState<PopupFields>(() => (popup ? pickPopup(popup) : blankPopup(choices[0]?.id ?? '')));
  const [error, setError] = useState<string | null>(null);
  const dis = !editable || busy;
  const set = <K extends keyof PopupFields>(k: K, v: PopupFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const start = riyadhParts(f.starts_at);
  const end = riyadhParts(f.ends_at);
  const offer = offers.find((o) => o.id === f.offer_id) ?? null;

  function togglePage(p: PopupPage) {
    setF((x) => {
      if (p === 'all') return { ...x, pages: ['all'] };
      const rest = x.pages.filter((v) => v !== 'all');
      const next = rest.includes(p) ? rest.filter((v) => v !== p) : [...rest, p];
      return { ...x, pages: next.length ? next : ['all'] };
    });
  }

  async function save() {
    setError(null);
    if (!f.offer_id) return setError('اختر عرضًا منشورًا.');
    if (!f.name.trim()) return setError('اسم التصميم مطلوب.');
    if (f.frequency === 'days' && (!f.frequency_days || f.frequency_days < 1 || f.frequency_days > 90)) return setError('عدد الأيام من 1 إلى 90.');
    if (f.starts_at && f.ends_at && f.ends_at <= f.starts_at) return setError('نهاية الجدولة بعد بدايتها.');
    setBusy(true);
    try {
      await off.popupSave(popup?.id ?? null, { ...f, name: f.name.trim(), frequency_days: f.frequency === 'days' ? f.frequency_days : null });
      toast(popup ? 'حُفظ التصميم؛ لا يظهر على الموقع قبل «نشر».' : 'حُفظ التصميم؛ شغّله واضغط «نشر» ليظهر على الموقع.');
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_minmax(0,24rem)] gap-5" data-popup-form>
      <div className="grid gap-4 content-start">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="العرض" id="p-offer" hint="العروض المنشورة فقط.">
            <select id="p-offer" className="field" value={f.offer_id} onChange={(e) => set('offer_id', e.target.value)} disabled={dis} data-field="offer_id">
              {!choices.length && <option value="">لا عروض منشورة</option>}
              {choices.map((o) => <option key={o.id} value={o.id}>{o.title_ar}</option>)}
            </select>
          </Field>
          <Field label="اسم التصميم (للوحة فقط)" id="p-name">
            <input id="p-name" className="field" value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} disabled={dis} data-field="name" />
          </Field>
        </div>
        <Check label="مفعّلة" checked={f.enabled} onChange={(v) => set('enabled', v)} disabled={dis} data-field="enabled" hint="نافذة واحدة فقط تكون مفعّلة. لا تظهر على الموقع قبل «نشر»." />
        <Check label="إظهار صورة العرض" checked={f.show_image} onChange={(v) => set('show_image', v)} disabled={dis} data-field="show_image" />
        <LabelPair max={60} ar={f.title_ar} en={f.title_en} onChange={(a, e) => setF((x) => ({ ...x, title_ar: a, title_en: e }))} ids={{ ar: 'p-title-ar', en: 'p-title-en' }} labels={{ ar: 'العنوان بالعربية', en: 'العنوان بالإنجليزية' }} disabled={dis} />
        <LabelPair kind="text" max={160} rows={2} ar={f.text_ar} en={f.text_en} onChange={(a, e) => setF((x) => ({ ...x, text_ar: a, text_en: e }))} ids={{ ar: 'p-text-ar', en: 'p-text-en' }} labels={{ ar: 'نص قصير بالعربية', en: 'نص قصير بالإنجليزية' }} hints={{ ar: 'حتى 160 حرفًا.' }} disabled={dis} />
        <LabelPair max={24} ar={f.button_ar} en={f.button_en} onChange={(a, e) => setF((x) => ({ ...x, button_ar: a, button_en: e }))} ids={{ ar: 'p-btn-ar', en: 'p-btn-en' }} labels={{ ar: 'نص الزر بالعربية', en: 'نص الزر بالإنجليزية' }} disabled={dis} />
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <span className="label" id="p-color-label">لون الزر</span>
            <div className="flex gap-3" role="group" aria-labelledby="p-color-label">
              {(Object.keys(COLOR_LABELS) as PopupFields['button_color'][]).map((c) => (
                <button key={c} type="button" className="swatch" aria-pressed={f.button_color === c} aria-label={COLOR_LABELS[c]} title={COLOR_LABELS[c]} onClick={() => set('button_color', c)} disabled={dis} data-swatch={c}
                  style={{ background: c === 'bronze' ? '#976e47' : c === 'midnight' ? '#142a3b' : '#f3efe7' }} />
              ))}
            </div>
          </div>
          <div>
            <span className="label">شكل الزر</span>
            <Segmented value={f.button_shape} onChange={(v) => set('button_shape', v)} label="شكل الزر" disabled={dis} options={(Object.keys(SHAPE_LABELS) as PopupFields['button_shape'][]).map((k) => ({ value: k, label: SHAPE_LABELS[k] }))} />
          </div>
        </div>
        <div>
          <span className="label">حركة الظهور</span>
          <Segmented value={f.entrance} onChange={(v) => set('entrance', v)} label="حركة الظهور" disabled={dis} options={(Object.keys(ENTRANCE_LABELS) as PopupFields['entrance'][]).map((k) => ({ value: k, label: ENTRANCE_LABELS[k] }))} />
          <p className="text-xs text-ink-muted mt-1">من يطلب تقليل الحركة في جهازه يرى النافذة بلا حركة.</p>
        </div>
        <fieldset className="grid sm:grid-cols-2 gap-3">
          <legend className="label">الجدولة (بتوقيت الرياض، اختيارية)</legend>
          <div className="grid gap-1" data-schedule="start">
            <DateField mode="single" id="p-start" label="تبدأ في" min="today" value={start.date} onChange={(d) => set('starts_at', d ? riyadhStamp(d, start.time) : null)} disabled={dis} />
            {f.starts_at && (
              <div className="flex items-center gap-2">
                <select className="field w-auto num" aria-label="ساعة البداية" value={start.time} onChange={(e) => set('starts_at', riyadhStamp(start.date, e.target.value))} disabled={dis}>
                  {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {!dis && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('starts_at', null)}>مسح</button>}
              </div>
            )}
          </div>
          <div className="grid gap-1" data-schedule="end">
            <DateField mode="single" id="p-end" label="تنتهي في" min="today" value={end.date} onChange={(d) => set('ends_at', d ? riyadhStamp(d, end.time === '00:00' ? '23:30' : end.time) : null)} disabled={dis} />
            {f.ends_at && (
              <div className="flex items-center gap-2">
                <select className="field w-auto num" aria-label="ساعة النهاية" value={end.time} onChange={(e) => set('ends_at', riyadhStamp(end.date, e.target.value))} disabled={dis}>
                  {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {!dis && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('ends_at', null)}>مسح</button>}
              </div>
            )}
          </div>
        </fieldset>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <span className="label">التكرار</span>
            <Segmented value={f.frequency} onChange={(v) => set('frequency', v)} label="التكرار" disabled={dis} options={[{ value: 'visit', label: 'مرة لكل زيارة' }, { value: 'days', label: 'مرة كل عدة أيام' }]} />
            {f.frequency === 'days' && (
              <div className="mt-2">
                <Field label="كل كم يومًا" id="p-days">
                  <NumberField id="p-days" value={f.frequency_days} onChange={(v) => set('frequency_days', v)} min={0} max={90} className="w-24" />
                </Field>
              </div>
            )}
          </div>
          <Field label="تظهر بعد (ثوانٍ)" id="p-delay" hint="من 0 إلى 60.">
            <NumberField id="p-delay" value={f.delay_seconds} onChange={(v) => set('delay_seconds', v ?? 0)} min={0} max={60} className="w-24" />
          </Field>
        </div>
        <div>
          <span className="label" id="p-pages-label">الصفحات</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="p-pages-label" data-pages>
            <Chip on={f.pages.includes('all')} onClick={() => togglePage('all')} disabled={dis} data-page="all">كل الصفحات</Chip>
            {(Object.keys(PAGE_LABELS) as Exclude<PopupPage, 'all'>[]).map((p) => (
              <Chip key={p} on={f.pages.includes(p)} onClick={() => togglePage(p)} disabled={dis} data-page={p}>{PAGE_LABELS[p]}</Chip>
            ))}
          </div>
          <p className="text-xs text-ink-muted mt-1">لا تظهر أبدًا في صفحة الحجز وصفحات التأكيد، ولا فوق نموذج مفتوح.</p>
        </div>
        <Check label="لا تظهر على الجوال" checked={f.hide_on_mobile} onChange={(v) => set('hide_on_mobile', v)} disabled={dis} data-field="hide_on_mobile" />
        {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
          {editable && (
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="popup-save">
              {busy && <Spinner />} حفظ
            </button>
          )}
        </div>
      </div>
      <PopupPreview f={f} offer={offer} />
    </div>
  );
}

function pickPopup(p: Popup): PopupFields {
  const keys = Object.keys(blankPopup('')) as (keyof PopupFields)[];
  return Object.fromEntries(keys.map((k) => [k, p[k]])) as unknown as PopupFields;
}

/** the site's pop-up as the visitor will see it (CONTRACT: same surface, image, button and entrance) */
function PopupPreview({ f, offer }: { f: PopupFields; offer: Offer | null }) {
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [replay, setReplay] = useState(0);
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setImg(null);
    if (!offer) return;
    api.mediaItems('offer', offer.slug)
      .then(async (items) => {
        const cover = items.find((i) => i.slot === 'cover');
        if (!cover) return;
        const urls = await previewUrls([cover]);
        if (live) setImg(urls[cover.preview_path ?? ''] ?? urls[cover.thumb_path ?? ''] ?? null);
      })
      .catch(() => { /* no media view: the pattern block stands in */ });
    return () => {
      live = false;
    };
  }, [offer]);
  const t = (ar: string, en: string) => (lang === 'ar' ? ar : en);
  return (
    <aside className="grid gap-2 content-start lg:sticky lg:top-4" aria-label="معاينة حيّة" data-preview>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">معاينة حيّة</span>
        {/* the preview's own switches are not part of the design (data-no-dirty keeps the dirty guard out of them) */}
        <div data-no-dirty className="contents">
          <Segmented value={lang} onChange={setLang} label="لغة المعاينة" options={[{ value: 'ar', label: 'عربي' }, { value: 'en', label: 'English' }]} />
          <Segmented value={width} onChange={setWidth} label="عرض الشاشة" options={[{ value: 'desktop', label: 'كمبيوتر' }, { value: 'mobile', label: 'جوال' }]} />
          <Segmented value={scheme} onChange={setScheme} label="الوضع" options={[{ value: 'light', label: 'فاتح' }, { value: 'dark', label: 'داكن' }]} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplay((n) => n + 1)} data-action="preview-replay">إعادة الحركة</button>
        </div>
      </div>
      <div className="pp-frame" style={{ width: width === 'mobile' ? 'min(100%, 375px)' : '100%' }} data-scheme={scheme} data-width={width}>
        <div className="pp-backdrop">
          <div key={`${replay}-${f.entrance}`} className="pp-dialog" role="group" aria-label="معاينة النافذة المنبثقة" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} data-entrance={f.entrance} data-preview-dialog>
            {f.show_image && (img ? <img className="pp-img" src={img} alt="" /> : <div className="pp-img" aria-hidden="true" data-preview-placeholder />)}
            <span className="pp-close" aria-hidden="true">×</span>
            <div className="pp-body">
              <p className="pp-title" data-preview-title>{t(f.title_ar, f.title_en) || t('عنوان النافذة', 'Pop-up title')}</p>
              {(lang === 'ar' ? f.text_ar : f.text_en) && <p className="pp-text" data-preview-text>{t(f.text_ar, f.text_en)}</p>}
              <span className="pp-btn" data-color={f.button_color} data-shape={f.button_shape} data-preview-button>{t(f.button_ar, f.button_en) || t('نص الزر', 'Button')}</span>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-ink-muted">الزر يفتح وجهة العرض نفسها ({offer ? CTA_LABELS[offer.cta] : '—'}).</p>
    </aside>
  );
}

// ── «إرسال للأعضاء» (3 Nov 2026) ─────────────────────────────────────────────────────────────────────────────
// A live member-only offer by email to the club members whose consent is granted and who gave an email (Resend, with
// List-Unsubscribe). Preview first, then a test to the user's own address — the real send is refused before a test
// made since the offer's last publish. Each send is audited. WhatsApp comes later (Meta-approved marketing templates).
function MemberSendDialog({ offer, onClose }: { offer: Offer | null; onClose: () => void }) {
  const toast = useToast();
  const [gate, setGate] = useState<off.MemberGate | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!offer) return;
    try {
      setError(null);
      setGate(await off.memberGate(offer.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [offer]);
  useEffect(() => {
    setGate(null);
    setPreview(null);
    setConfirm(false);
    void load();
  }, [load]);
  async function go(mode: 'preview' | 'test' | 'send') {
    if (!offer) return;
    setBusy(mode);
    setError(null);
    try {
      const r = await off.memberSend(offer.id, mode);
      if (mode === 'preview') setPreview(r.html ?? '');
      if (mode === 'test') toast(`أُرسلت النسخة التجريبية إلى ${r.to ?? 'بريدك'}.`);
      if (mode === 'send') {
        toast(`أُرسل العرض إلى ${countWord(r.sent ?? 0, MEMBER_NOUN)}${r.failed ? `، وتعذّر الإرسال إلى ${r.failed}` : ''}.`, r.failed ? 'error' : 'ok');
        setConfirm(false);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal open={!!offer} onClose={onClose} title={offer ? `إرسال للأعضاء — ${offer.title_ar}` : ''} busy={!!busy} wide>
      <div className="grid gap-3 text-sm" data-member-send>
        <p>يصل العرض وكوده بالبريد الإلكتروني إلى أعضاء نادي أرمادا ريزيدنس الذين وافقوا على العروض وأدخلوا بريدهم، مع رابط لإلغاء الاشتراك. الإرسال عبر الواتساب لاحقًا بعد اعتماد قوالب تسويقية من ميتا.</p>
        <ErrorBox error={error} />
        {!gate && !error ? <Loading /> : gate && (
          <>
            <p data-member-recipients>المستلمون الآن: <strong>{countWord(gate.recipients, MEMBER_NOUN)}</strong></p>
            {!!gate.sends.length && (
              <ul className="grid gap-1 text-ink-muted" data-member-sends>
                {gate.sends.map((x, i) => (
                  <li key={i} className="num">{x.kind === 'test' ? 'تجريبي' : 'إرسال'} · {riyadhDateTime(x.at)} · {x.by} · أُرسل {x.sent}{x.failed ? ` · تعذّر ${x.failed}` : ''}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void go('preview')} data-action="member-preview">{busy === 'preview' && <Spinner />} معاينة</button>
              <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void go('test')} data-action="member-test">{busy === 'test' && <Spinner />} إرسال تجريبي إلى بريدي</button>
              <button type="button" className="btn btn-primary" disabled={!!busy || !gate.tested || !gate.recipients} onClick={() => setConfirm(true)} data-action="member-send">
                إرسال إلى {countWord(gate.recipients, MEMBER_NOUN)}
              </button>
            </div>
            {!gate.tested && <p className="text-ink-muted" data-member-test-first>أرسل نسخة تجريبية إلى بريدك أولًا؛ يُفعَّل الإرسال بعدها.</p>}
            {preview !== null && <iframe title="معاينة الرسالة" className="w-full h-[28rem] border border-line rounded bg-white" sandbox="" srcDoc={preview} data-member-preview />}
          </>
        )}
        <div className="flex justify-end"><CancelButton label="إغلاق" disabled={!!busy} /></div>
      </div>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="إرسال العرض إلى الأعضاء"
        body={gate ? `سيُرسل العرض وكوده إلى ${countWord(gate.recipients, MEMBER_NOUN)} الآن. لا يمكن التراجع عن الإرسال.` : ''}
        confirmLabel="إرسال الآن"
        onConfirm={() => void go('send')}
        busy={busy === 'send'}
      />
    </Modal>
  );
}
const MEMBER_NOUN: CountNoun = { zero: 'لا أعضاء', one: 'عضو واحد', two: 'عضوين', few: 'أعضاء', many: 'عضوًا', gen: 'عضو' };
