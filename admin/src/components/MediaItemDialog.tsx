// One photo (or the hero video) of the media module «الصور» (1 Nov 2026): the focal point picker with live previews of
// the crops the site will make of it (lib/media.ts → cropsOf: 3:2 for rooms and branches, 16:9 + 4:5 for the hero
// poster, the social-sharing crop for covers — the build's own cropBox rule), its alt texts in both languages (required
// before publishing, ≤ 150 characters, the label-suggest translation chip — never auto-filled), the slot it fills,
// «إظهار في المعرض» (2 Nov 2026: branch, room, dining and hall photos — the site's /gallery/; on by default), and
// «أرشفة» (never a hard delete). The shared Modal: the dirty guard covers the alts, the slot and the focal point
// (hidden inputs); a save is the «حفظ» button only.
import { useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { MediaItem, MediaSlot } from '../lib/api';
import { cropStyle, cropsOf, galleryTarget, ITEM_STATUS, megabytes, MIN_LONG_SIDE, SLOT_LABELS, slotsOf } from '../lib/media';
import { riyadhDateTime } from '../lib/format';
import LabelPair from './LabelPair';
import { CancelButton, Field, Modal, Spinner, useToast } from './ui';

export interface MediaItemDialogProps {
  item: MediaItem | null;
  /** signed URL of the 1600 px preview (else the thumb), or null when the browser could not make one */
  src: string | null;
  editable: boolean;
  onClose: () => void;
  /** after a save or an archive: reload the target */
  onChanged: () => void;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export default function MediaItemDialog({ item, src, editable, onClose, onChanged }: MediaItemDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!item} onClose={onClose} title={item?.kind === 'video' ? 'تفاصيل الفيديو' : 'تفاصيل الصورة'} wide busy={busy}>
      {/* keyed by the item: the first render already holds its values (the dirty guard's baseline is never another photo's) */}
      {item && <ItemBody key={item.id} item={item} src={src} editable={editable} onClose={onClose} onChanged={onChanged} busy={busy} setBusy={setBusy} />}
    </Modal>
  );
}

function ItemBody({ item, src, editable, onClose, onChanged, busy, setBusy }: Omit<MediaItemDialogProps, 'item'> & { item: MediaItem; busy: boolean; setBusy: (b: boolean) => void }) {
  const toast = useToast();
  const [altAr, setAltAr] = useState(item.alt_ar);
  const [altEn, setAltEn] = useState(item.alt_en);
  const [fx, setFx] = useState(Number(item.focal_x));
  const [fy, setFy] = useState(Number(item.focal_y));
  const [slot, setSlot] = useState<MediaSlot>(item.slot);
  const [inGallery, setInGallery] = useState(item.in_gallery !== false);
  const offersGallery = galleryTarget(item.target) && item.kind === 'image';
  const [error, setError] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // the crop math needs the photo's displayed proportions: the stored size (EXIF orientation applied by the browser at
  // upload), else the preview's own
  const w = item.width ?? natural?.w ?? 0;
  const h = item.height ?? natural?.h ?? 0;
  const slots = useMemo(() => slotsOf(item.target).filter((s) => (s.slot === 'hero-video') === (item.kind === 'video')), [item]);
  const warnings: string[] = [];
  if (item.kind === 'image' && w && h) {
    if (Math.max(w, h) < MIN_LONG_SIDE) warnings.push(`الضلع الأطول ${Math.max(w, h)} بكسل، أقل من ${MIN_LONG_SIDE}: قد تبدو أقل حدة على الشاشات الكبيرة.`);
    if (h > w) warnings.push('صورة طولية: يضيع جزء كبير منها في القص الأفقي — اختر نقطة التركيز بعناية.');
  }

  const setFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editable) return;
    const r = e.currentTarget.getBoundingClientRect();
    setFx(clamp((e.clientX - r.left) / r.width));
    setFy(clamp((e.clientY - r.top) / r.height));
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    // the arrows move the point on the photo itself (left is left, whatever the page direction)
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!d[e.key]) return;
    e.preventDefault();
    setFx((v) => clamp(v + d[e.key][0]));
    setFy((v) => clamp(v + d[e.key][1]));
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const galleryChanged = offersGallery && inGallery !== (item.in_gallery !== false);
      if (altAr.trim() !== item.alt_ar || altEn.trim() !== item.alt_en || Math.abs(fx - Number(item.focal_x)) > 1e-4 || Math.abs(fy - Number(item.focal_y)) > 1e-4 || galleryChanged) {
        await api.mediaUpdate(item.id, altAr.trim(), altEn.trim(), Math.round(fx * 10000) / 10000, Math.round(fy * 10000) / 10000, galleryChanged ? inGallery : undefined);
      }
      if (slot !== item.slot) await api.mediaSetSlot(item.id, slot);
      toast('حُفظت التعديلات؛ تظهر على الموقع بعد «نشر».');
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await api.mediaArchive(item.id);
      toast(item.live ? 'أُرشفت؛ تبقى على الموقع حتى «نشر» هذه الصفحة.' : 'أُرشفت.');
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = item.status === 'published' && item.pending ? 'منشورة — تعديلات غير منشورة' : ITEM_STATUS[item.status];
  return (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" data-media-dialog={item.id}>
          <div className="grid gap-3 content-start">
            <div>
              <p className="label" id="focal-label">نقطة التركيز</p>
              <p className="text-xs text-ink-muted mb-2" id="focal-hint">
                {editable ? 'اضغط على أهم جزء في الصورة؛ يبقى ظاهرًا في كل قص. الأسهم تحرّك النقطة (مع Shift أسرع).' : 'النقطة التي يبقى حولها كل قص.'}
              </p>
              {src ? (
                <div
                  className="media-focal"
                  tabIndex={editable ? 0 : -1}
                  role="group"
                  aria-labelledby="focal-label"
                  aria-describedby="focal-hint"
                  onPointerDown={(e) => {
                    setFrom(e);
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => e.buttons === 1 && setFrom(e)}
                  onKeyDown={onKey}
                  data-focal
                >
                  <img src={src} alt="" draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
                  <span className="media-focal-dot" style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }} aria-hidden="true" />
                </div>
              ) : (
                <div className="media-noprev">لا تتوفر معاينة لهذا الملف في هذا المتصفح؛ تُطبَّق نقطة التركيز عند البناء.</div>
              )}
              <input type="hidden" id="focal-x" value={fx.toFixed(3)} readOnly />
              <input type="hidden" id="focal-y" value={fy.toFixed(3)} readOnly />
              <p className="text-xs text-ink-muted mt-1 num" data-focal-value>{`${Math.round(fx * 100)}% · ${Math.round(fy * 100)}%`}</p>
            </div>
            {src && w > 0 && h > 0 && (
              <div>
                <p className="label">كيف ستظهر على الموقع</p>
                <div className="media-crops">
                  {cropsOf(slot, item.target, item.target_key).map((c) => (
                    <figure key={c.label} className="media-crop" data-crop={c.ratio.toFixed(3)}>
                      <div style={{ aspectRatio: String(c.ratio), backgroundImage: `url("${src}")`, ...cropStyle(w, h, c.ratio, fx, fy) }} />
                      <figcaption>{c.label}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="grid gap-3 content-start">
            <p className="text-sm"><span className="chip chip-request" data-item-status>{status}</span></p>
            <LabelPair
              kind="alt"
              ar={altAr}
              en={altEn}
              onChange={(a, e) => {
                setAltAr(a);
                setAltEn(e);
              }}
              ids={{ ar: 'alt-ar', en: 'alt-en' }}
              labels={{ ar: 'النص البديل بالعربية', en: 'النص البديل بالإنجليزية' }}
              hints={{ ar: 'وصف ما في الصورة لمن لا يراها، حتى 150 حرفًا. مطلوب قبل النشر.', en: 'Describe the photo in English, up to 150 characters.' }}
              disabled={!editable}
            />
            {slots.length > 1 && (
              <Field label="الخانة" id="media-slot" hint={slot !== item.slot && slot !== 'gallery' ? 'إن كانت الخانة مشغولة تنتقل صورتها إلى المعرض.' : undefined}>
                <select id="media-slot" className="field" value={slot} disabled={!editable} onChange={(e) => setSlot(e.target.value as MediaSlot)}>
                  {slots.map((s) => (
                    <option key={s.slot} value={s.slot}>{SLOT_LABELS[s.slot]}</option>
                  ))}
                </select>
              </Field>
            )}
            {offersGallery && (
              <label className="flex items-start gap-2 text-sm" htmlFor="media-in-gallery">
                <input type="checkbox" id="media-in-gallery" className="mt-1" checked={inGallery} disabled={!editable} onChange={(e) => setInGallery(e.target.checked)} aria-describedby="media-in-gallery-hint" />
                <span>
                  <span className="font-semibold">إظهار في المعرض</span>
                  <span className="block text-xs text-ink-muted" id="media-in-gallery-hint">تظهر الصورة في صفحة «المعرض» على الموقع بعد «نشر» هذه الصفحة.</span>
                </span>
              </label>
            )}
            <dl className="media-facts">
              <dt>الملف</dt>
              <dd className="latin" dir="ltr">{item.file_name}</dd>
              {item.width && item.height ? (<><dt>الأبعاد</dt><dd className="num">{`${item.width} × ${item.height}`}</dd></>) : null}
              <dt>الحجم</dt>
              <dd>{megabytes(item.bytes)}</dd>
              {item.duration ? (<><dt>المدة</dt><dd className="num">{`${Math.round(Number(item.duration))} ث`}</dd></>) : null}
              <dt>رُفعت</dt>
              <dd className="num">{riyadhDateTime(item.created_at)}</dd>
              {item.published_at && (<><dt>آخر نشر</dt><dd className="num">{riyadhDateTime(item.published_at)}</dd></>)}
            </dl>
            {warnings.map((x) => (
              <p key={x} className="note-amber text-xs" role="status">{x}</p>
            ))}
            {error && <p className="text-sm media-err" role="alert">{error}</p>}
          </div>
          <div className="lg:col-span-2 flex flex-wrap gap-2 justify-between items-center border-t border-line pt-4">
            {editable ? (
              <button type="button" className="btn btn-ghost media-err" onClick={archive} disabled={busy} data-action="media-archive">أرشفة {item.kind === 'video' ? 'الفيديو' : 'الصورة'}</button>
            ) : <span />}
            <div className="flex gap-2">
              <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
              {editable && (
                <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="media-save">
                  {busy && <Spinner />} حفظ
                </button>
              )}
            </div>
          </div>
        </div>
  );
}
