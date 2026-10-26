// «الإعدادات الافتراضية» (phase 2a.2 D, Ahmed 26 Oct 2026) — the last section of Settings, system admin only
// (users:edit; the database refuses anyone else). Save the current state as the default, restore it (or an older
// save) after a dialog that lists exactly what changes (current ← default, the dashboard's RTL arrow), with a tick
// when a per-branch switch would turn ON (Q-D1). The restore is one audited batch: the usual 30 s «تراجع» toast and
// «استرجاع هذا التغيير» in the audit; it asks for the site rebuild when room availability or the extra-bed fee changed.
import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { DefaultsChange, DefaultsDiff, DefaultsSave } from '../lib/api';
import { BRANCH_NAMES, changesWord, countWord, nightsWord, riyadhDateTimeLong, sar, time12, type CountNoun } from '../lib/format';
import { ErrorBox, Field, Loading, Modal, Spinner, useToast } from './ui';

const SWITCH: Record<string, string> = { show_prices: 'إظهار الأسعار', instant_booking: 'الحجز الفوري' };
const GROUPS: { key: DefaultsChange['group']; title: string }[] = [
  { key: 'switches', title: 'مفاتيح الموقع — يؤثر على الموقع فورًا' },
  { key: 'fees', title: 'السرير الإضافي والإفطار' },
  { key: 'limits', title: 'حدود الحجز الفوري' },
  { key: 'rooms', title: 'إتاحة الغرف على الموقع' },
  { key: 'base_rates', title: 'الأسعار الأساسية' },
];

interface Breakfast {
  adult: number;
  child_tiers: { max_age: number; price: number }[];
}
interface Limits {
  same_day_cutoff: string;
  max_nights: number;
}
const YEAR: CountNoun = { zero: 'أقل من سنة', one: 'سنة واحدة', two: 'سنتين', few: 'سنوات', many: 'سنة', gen: 'سنة' };
const tiers = (b: Breakfast | null | undefined) =>
  (b?.child_tiers ?? []).map((t) => `حتى ${countWord(Number(t.max_age), YEAR)}: ${Number(t.price) === 0 ? 'مجانًا' : sar(t.price)}`).join('، ') || '—';

/** one change → its rows («{label}: {current} ← {target}») */
export function changeRows(c: DefaultsChange): { label: string; from: string; to: string }[] {
  const branch = c.branch ? BRANCH_NAMES[c.branch] ?? c.branch : '';
  if (c.group === 'switches') return [{ label: `${SWITCH[c.key] ?? c.key} — ${branch}`, from: c.current ? 'مفعّل' : 'متوقف', to: c.target ? 'مفعّل' : 'متوقف' }];
  if (c.key === 'extra_bed_per_night') return [{ label: 'السرير الإضافي لليلة', from: sar(c.current as number), to: sar(c.target as number) }];
  if (c.key === 'breakfast') {
    const a = c.current as Breakfast;
    const b = c.target as Breakfast;
    const rows = [];
    if (Number(a?.adult) !== Number(b?.adult)) rows.push({ label: 'إفطار البالغ', from: sar(a?.adult), to: sar(b?.adult) });
    if (tiers(a) !== tiers(b)) rows.push({ label: 'إفطار الأطفال', from: tiers(a), to: tiers(b) });
    return rows.length ? rows : [{ label: 'الإفطار', from: '—', to: '—' }];
  }
  if (c.key === 'instant_limits') {
    const a = c.current as Limits;
    const b = c.target as Limits;
    const rows = [];
    if (a?.same_day_cutoff !== b?.same_day_cutoff) rows.push({ label: 'آخر وقت للحجز الفوري لوصول اليوم', from: time12(a?.same_day_cutoff ?? ''), to: time12(b?.same_day_cutoff ?? '') });
    if (Number(a?.max_nights) !== Number(b?.max_nights)) rows.push({ label: 'أقصى مدة للحجز الفوري', from: nightsWord(Number(a?.max_nights)), to: nightsWord(Number(b?.max_nights)) });
    return rows.length ? rows : [{ label: 'حدود الحجز الفوري', from: '—', to: '—' }];
  }
  const room = `${c.name_ar ?? ''} — ${branch}`;
  if (c.key === 'bookable') return [{ label: room, from: c.current ? 'متاحة للحجز' : 'غير متاحة', to: c.target ? 'متاحة للحجز' : 'غير متاحة' }];
  return [{ label: room, from: c.current == null ? 'بلا سعر' : sar(c.current as number), to: c.target == null ? 'بلا سعر' : sar(c.target as number) }];
}

export default function SiteDefaults({ onRestored }: { onRestored: (rebuild: boolean) => Promise<void> }) {
  const toast = useToast();
  const [list, setList] = useState<api.DefaultsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<DefaultsDiff | null>(null);
  const [diffFor, setDiffFor] = useState<string | undefined>(undefined);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  const load = async () => {
    try {
      setList(await api.defaultsList());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const current = useMemo(() => list?.saves.find((s) => s.is_default) ?? null, [list]);

  async function save() {
    setBusy(true);
    try {
      const r = await api.saveDefaults(label.trim());
      setSaveOpen(false);
      setLabel('');
      toast.undo('حُفظت الإعدادات الافتراضية', async () => {
        await api.revertBatch(r.batch_id);
        await load();
      });
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function openRestore(id?: string) {
    setDiff(null);
    setDiffError(null);
    setAck(false);
    setDiffFor(id ?? current?.id);
    try {
      setDiff(await api.defaultsDiff(id));
    } catch (e) {
      setDiffError((e as Error).message);
    }
  }

  async function restore() {
    if (!diff) return;
    setBusy(true);
    try {
      const r = await api.restoreDefaults(diffFor, diff.hash, ack);
      setDiff(null);
      setDiffFor(undefined);
      toast.undo('استُعيدت الإعدادات الافتراضية', async () => {
        await api.revertBatch(r.batch_id);
        await load();
        await onRestored(r.rebuild_needed);
      });
      await load();
      await onRestored(r.rebuild_needed);
    } catch (e) {
      const raw = (e as { raw?: string }).raw ?? '';
      if (raw.startsWith('defaults_changed')) {
        setDiffError((e as Error).message);
        try {
          setDiff(await api.defaultsDiff(diffFor));
          setAck(false);
        } catch {
          /* keep the message */
        }
      } else toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const who = (s: DefaultsSave) => `${riyadhDateTimeLong(s.saved_at)} · ${s.saved_by}`;
  const open = diffFor !== undefined || diff !== null || diffError !== null;
  const needsAck = (diff?.switch_on.length ?? 0) > 0;
  return (
    <section className="card p-5" aria-labelledby="s-defaults" data-defaults>
      <h2 id="s-defaults" className="font-bold text-lg mb-1">الإعدادات الافتراضية</h2>
      <p className="text-sm text-ink-muted mb-4">
        نسخة محفوظة من إعدادات الموقع يمكن الرجوع إليها بضغطة: مفاتيح الفروع، السرير الإضافي، الإفطار، حدود الحجز الفوري، إتاحة الغرف على الموقع، والأسعار الأساسية. لا تشمل استثناءات الأسعار ولا المخزون ولا الحجوزات.
      </p>
      <ErrorBox error={error} />
      {!list ? (
        <Loading />
      ) : (
        <>
          <p className="text-sm mb-3 num-ar" data-current-default={current?.id ?? ''}>
            {current ? `الافتراضي الحالي: ${current.label ?? 'بلا تسمية'} · حُفظ ${who(current)}` : 'لا توجد إعدادات افتراضية محفوظة بعد.'}
          </p>
          {list.last_restore && <p className="text-xs text-ink-muted mb-3 num-ar">آخر استعادة: {riyadhDateTimeLong(list.last_restore.at)} بواسطة {list.last_restore.by}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={!current} onClick={() => openRestore()} data-action="defaults-restore">استعادة الإعدادات الافتراضية</button>
            <button type="button" className="btn btn-ghost" onClick={() => setSaveOpen(true)} data-action="defaults-save">حفظ الوضع الحالي كإعدادات افتراضية</button>
          </div>
          {list.saves.length > 0 && (
            <details className="mt-4" data-defaults-history>
              <summary className="cursor-pointer text-sm font-semibold">نسخ سابقة</summary>
              <ul className="grid gap-2 mt-2">
                {list.saves.map((s) => (
                  <li key={s.id} className="rounded border border-line p-3 text-sm flex flex-wrap items-center gap-2" data-save={s.id} data-kind={s.kind}>
                    <span className="font-semibold">{s.label ?? 'بلا تسمية'}</span>
                    {s.is_default && <span className="chip chip-flag">الافتراضي</span>}
                    {s.kind === 'auto_before_restore' && <span className="chip chip-request">تلقائية قبل الاستعادة</span>}
                    <span className="text-ink-muted num-ar">{who(s)}</span>
                    <button type="button" className="btn btn-ghost btn-sm ms-auto" onClick={() => openRestore(s.id)} data-action="defaults-restore-this">استعادة هذه النسخة</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="حفظ الوضع الحالي كإعدادات افتراضية">
        <Field label="تسمية (اختياري)" id="d-label" hint="مثل: قبل موسم الشتاء">
          <input id="d-label" className="field" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <p className="text-sm text-ink-muted mt-3">سيحل هذا محل الافتراضي الحالي؛ تبقى النسخ السابقة في السجل.</p>
        <div className="flex gap-2 justify-end mt-5">
          <button type="button" className="btn btn-ghost" onClick={() => setSaveOpen(false)} disabled={busy}>إلغاء</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="defaults-save-go">{busy && <Spinner />} حفظ كإعدادات افتراضية</button>
        </div>
      </Modal>

      <Modal open={open} onClose={() => { setDiff(null); setDiffFor(undefined); setDiffError(null); }} title="استعادة الإعدادات الافتراضية" wide>
        {!diff && !diffError && <Loading />}
        <ErrorBox error={diffError} />
        {diff && diff.ok && (
          <div data-defaults-diff>
            <p className="text-sm text-ink-muted mb-3 num-ar">من: {diff.label ?? (diff.kind === 'auto_before_restore' ? 'نسخة تلقائية قبل الاستعادة' : 'بلا تسمية')} · {riyadhDateTimeLong(diff.saved_at!)} · {diff.saved_by}</p>
            {diff.changes.length === 0 ? (
              <p className="text-sm" data-defaults-empty>الإعدادات الحالية تطابق هذه النسخة؛ لا شيء للاستعادة.</p>
            ) : (
              GROUPS.filter((g) => diff.changes.some((c) => c.group === g.key)).map((g) => (
                <div key={g.key} className="mb-3" data-group={g.key}>
                  <h3 className={`font-bold text-sm mb-1 ${g.key === 'switches' ? 'text-error' : ''}`}>{g.title}</h3>
                  <ul className="grid gap-1 text-sm">
                    {diff.changes.filter((c) => c.group === g.key).flatMap(changeRows).map((r, i) => (
                      <li key={`${g.key}-${i}`} className="num-ar" data-change-row>
                        <span className="text-ink-muted">{r.label}:</span> <span>{r.from}</span> ← <span className="font-semibold">{r.to}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {diff.changes.some((c) => c.group === 'base_rates') && <p className="text-xs text-ink-muted mb-1">استثناءات الأسعار الموسمية لا تتأثر.</p>}
            {diff.not_covered.length > 0 && <p className="text-xs text-ink-muted mb-1" data-not-covered>غرف لم تكن في هذه النسخة وتبقى كما هي: {diff.not_covered.map((r) => `${r.name_ar} — ${BRANCH_NAMES[r.branch] ?? r.branch}`).join('، ')}</p>}
            {diff.skipped.length > 0 && <p className="text-xs text-ink-muted mb-1" data-skipped>غرف في النسخة لم تعد فعّالة فتم تجاوزها: {diff.skipped.map((r) => `${r.name_ar} — ${BRANCH_NAMES[r.branch] ?? r.branch}`).join('، ')}</p>}
            {diff.rebuild_needed && diff.changes.length > 0 && <p className="text-xs text-ink-muted mb-1">سيُعاد بناء الموقع بعد الاستعادة لتظهر الإتاحة والرسوم الجديدة.</p>}
            {needsAck && (
              <label className="flex items-start gap-2 mt-3 text-sm cursor-pointer rounded border border-error/40 bg-error/10 p-3">
                <input type="checkbox" className="size-5 mt-0.5 accent-bronze-deep" checked={ack} onChange={(e) => setAck(e.target.checked)} data-defaults-ack />
                <span>
                  أفهم أن هذه الاستعادة تُفعِّل على الموقع فورًا:{' '}
                  {diff.switch_on.map((s) => `${SWITCH[s.key] ?? s.key} — ${BRANCH_NAMES[s.branch] ?? s.branch}`).join('، ')}
                </span>
              </label>
            )}
            <div className="flex gap-2 justify-end mt-5">
              <button type="button" className="btn btn-ghost" onClick={() => { setDiff(null); setDiffFor(undefined); }} disabled={busy}>إلغاء</button>
              {diff.changes.length > 0 && (
                <button type="button" className="btn btn-primary" onClick={restore} disabled={busy || (needsAck && !ack)} data-action="defaults-restore-go">
                  {busy && <Spinner />} استعادة {changesWord(diff.changes.flatMap(changeRows).length)}
                </button>
              )}
            </div>
          </div>
        )}
        {diff && !diff.ok && <p className="text-sm">لا توجد إعدادات افتراضية محفوظة بعد.</p>}
      </Modal>
    </section>
  );
}
