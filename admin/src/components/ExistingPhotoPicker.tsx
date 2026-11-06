// «اختيار صورة موجودة» (Ahmed, 5 Nov 2026): fill a slot of «الصور» or «المدونة» with a photo already in the dashboard,
// without uploading it again. The dialog lists every ready photo the user may view (newest first; search by its
// description, file name or page), the photos already in this page greyed out; «استخدام هذه الصورة» copies it into the
// slot exactly as an upload (lib/media.ts → copyExisting: the full-size original, the previews and both descriptions; the
// source is never changed). The shared Modal: closes only by ×, «إلغاء» or Esc; busy while copying. A choice is not an
// edit (nothing is lost by closing): the content is [data-no-dirty], so «إلغاء» closes at once.
import { useEffect, useMemo, useState } from 'react';
import { CancelButton, ErrorBox, Loading, Modal, Spinner } from './ui';
import * as api from '../lib/api';
import type { MediaItem, MediaSlot, MediaTarget, MediaTargetRow } from '../lib/api';
import { copyExisting, targetLabel } from '../lib/media';
import { west } from '../lib/format';

const norm = (s: string) => west(s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();

export default function ExistingPhotoPicker({ open, onClose, target, keyName, slot, slotLabel, onDone, mobileOf }: {
  open: boolean;
  onClose: () => void;
  target: MediaTarget;
  keyName: string;
  slot: MediaSlot;
  /** the slot as the user reads it, e.g. «الغلاف» */
  slotLabel: string;
  /** after a successful copy: the new item's id */
  onDone: (id: string) => void;
  /** «صورة الجوال» (7 Nov 2026): the desktop photo the copy belongs to (slot mobile) */
  mobileOf?: string;
}) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<MediaTargetRow[]>([]);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setPick(null);
    setError(null);
    setItems(null);
    let live = true;
    (async () => {
      try {
        const [list, overview] = await Promise.all([api.mediaPickable(), api.mediaOverview()]);
        if (!live) return;
        setRows(overview);
        setItems(list);
        setUrls(await api.mediaSignedUrls(list.map((i) => i.thumb_path ?? '')));
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  // the same file already in this page cannot be added again (the server refuses it too)
  const here = useMemo(() => new Set((items ?? []).filter((i) => i.target === target && i.target_key === keyName).map((i) => i.sha256)), [items, target, keyName]);
  // the page a photo belongs to, by the names the target list uses (a place, a partners slot, an article…)
  const pageOf = (i: MediaItem) => {
    const r = rows.find((x) => x.target === i.target && x.key === i.target_key);
    return targetLabel(r ?? { target: i.target, key: i.target_key, name_ar: undefined });
  };
  const nq = norm(q);
  const shown = useMemo(
    () => (items ?? []).filter((i) => !nq || norm(`${i.alt_ar} ${i.alt_en} ${i.file_name} ${pageOf(i)}`).includes(nq)),
    [items, nq, rows], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const chosen = (items ?? []).find((i) => i.id === pick) ?? null;

  async function use() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const id = await copyExisting(chosen, target, keyName, slot, mobileOf);
      onDone(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`اختيار صورة موجودة — ${slotLabel}`} wide busy={busy}>
      <div className="grid gap-3" data-existing-picker={`${target}:${keyName}:${slot}`} data-no-dirty>
        <p className="text-sm text-ink-muted">تُنسخ الصورة الأصلية بدقتها الكاملة مع وصفيها العربي والإنجليزي إلى هذه الخانة كأنها رُفعت هنا، ولا تتغير الصورة الأصلية في مكانها. تظهر على الموقع بعد «نشر» هذه الصفحة.</p>
        <label htmlFor="existing-q" className="sr-only">ابحث في الصور</label>
        <input id="existing-q" type="search" className="field" placeholder="ابحث بالوصف أو اسم الملف أو الصفحة…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" data-no-dirty data-existing-search />
        <ErrorBox error={error} />
        {items === null ? (
          !error && <Loading />
        ) : !shown.length ? (
          <p className="text-sm text-ink-muted py-4">{items.length ? `لا صور تطابق «${q}».` : 'لا صور في «الصور» بعد.'}</p>
        ) : (
          <div className="media-grid existing-grid" role="radiogroup" aria-label="الصور الموجودة">
            {shown.map((i) => {
              const dup = here.has(i.sha256);
              const where = pageOf(i);
              return (
                <button
                  key={i.id}
                  type="button"
                  role="radio"
                  aria-checked={pick === i.id}
                  aria-disabled={dup || undefined}
                  disabled={dup}
                  className={`media-tile ed-pick ${pick === i.id ? 'is-on' : ''}`}
                  onClick={() => setPick(i.id)}
                  title={dup ? 'موجودة في هذه الصفحة من قبل' : i.alt_ar || i.file_name}
                  data-existing={i.id}
                  data-file={i.file_name}
                >
                  {urls[i.thumb_path ?? ''] ? <img src={urls[i.thumb_path ?? '']} alt="" className="media-thumb" loading="lazy" /> : <span className="media-thumb" />}
                  <span className="text-xs existing-alt">{i.alt_ar || 'بلا وصف'}</span>
                  <span className="text-xs text-ink-muted truncate">{dup ? 'موجودة هنا' : where}</span>
                </button>
              );
            })}
          </div>
        )}
        {chosen && (
          <p className="text-sm" data-existing-chosen>
            المختارة: <span className="latin" dir="ltr">{chosen.file_name}</span> — {pageOf(chosen)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" disabled={!chosen || busy} onClick={() => void use()} data-action="existing-use">
            {busy && <Spinner />} استخدام هذه الصورة
          </button>
        </div>
      </div>
    </Modal>
  );
}
