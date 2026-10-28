// Settings (DASHBOARD-SPEC §3.9 + decisions 3 / 5 / Q5 / Q11; phase 2a.1): breakfast prices and child tiers, extra-bed
// fee, the per-branch switches (prices shown, instant booking) and the instant limits. Every save goes through
// set_setting (audited, one batch) → a 30 s «تراجع» toast; a failed switch save snaps the checkbox back. The extra-bed
// fee is also baked into the website, so its save asks for a site rebuild (site-rebuild function). Numbers through the
// digits helper; the cutoff time is two selects (Western digits everywhere) with its 12-hour reading beside. Phase
// 2a.2 D: «الإعدادات الافتراضية» (components/SiteDefaults.tsx) for the system admin.
import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, sar, time12 } from '../lib/format';
import { DirtyScope, ErrorBox, Field, Loading, NumberField, Spinner, useToast } from '../components/ui';
import SiteDefaults from '../components/SiteDefaults';

interface Breakfast {
  adult: number;
  child_tiers: { max_age: number; price: number }[];
}
interface Limits {
  same_day_cutoff: string;
  max_nights: number;
}
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

export default function Settings() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'settings');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [bf, setBf] = useState<Breakfast>({ adult: 0, child_tiers: [] });
  const [bed, setBed] = useState<number | null>(0);
  const [instant, setInstant] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Limits>({ same_day_cutoff: '20:00', max_nights: 30 });
  const [mult, setMult] = useState<number | null>(10);
  const [busy, setBusy] = useState<string | null>(null);
  const [rebuild, setRebuild] = useState<string | null>(null);
  // what the server holds: the baseline of the page-level forms (the leave guard re-baselines on every load)
  const [saved, setSaved] = useState('');

  const load = async () => {
    try {
      const [b, s] = await Promise.all([api.branches(), api.settings()]);
      setBranches(b);
      const get = (k: string) => s.find((x) => x.key === k)?.value;
      setBf((get('breakfast') as Breakfast) ?? { adult: 0, child_tiers: [] });
      setBed(Number(get('extra_bed_per_night') ?? 0));
      setInstant((get('instant_booking') as Record<string, boolean>) ?? {});
      setPrices((get('show_prices') as Record<string, boolean>) ?? {});
      setLimits((get('instant_limits') as Limits) ?? { same_day_cutoff: '20:00', max_nights: 30 });
      setMult(Number(get('rate_high_multiplier') ?? 10));
      setSaved(JSON.stringify([get('breakfast'), get('extra_bed_per_night'), get('instant_limits'), get('rate_high_multiplier')]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  /** save → undo toast → reload; returns false when the save failed (the caller restores its local state) */
  async function save(key: string, value: unknown, label: string, after?: () => Promise<void>): Promise<boolean> {
    setBusy(key);
    try {
      const r = await api.setSetting(key, value);
      toast.undo(`حُفظ: ${label}`, async () => {
        await api.revertBatch(r.batch_id);
        await load();
        if (after) await after();
      });
      if (after) await after();
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function askRebuild() {
    const r = await api.siteRebuild('settings');
    setRebuild(r.ok && r.dispatched ? 'طُلبت إعادة بناء الموقع؛ يظهر السعر الجديد في نموذج الحجز وصفحة السياسات خلال دقائق.' : r.ok ? 'إعادة بناء الموقع قيد التنفيذ من طلب سابق.' : 'سيُطبَّق على الموقع عند إعادة البناء التالية.');
  }

  if (loading) return <Loading />;
  const ro = !editable;
  return (
    <div className="grid gap-5 max-w-3xl">
      <h1 className="text-2xl font-bold">الإعدادات</h1>
      {ro && <p className="text-sm text-ink-muted -mt-3">صلاحيتك هنا للعرض فقط.</p>}
      <ErrorBox error={error} />

      <section className="card p-5" aria-labelledby="s-switches">
        <h2 id="s-switches" className="font-bold text-lg mb-1">مفاتيح الموقع لكل فرع</h2>
        <p className="text-sm text-ink-muted mb-4">«إظهار الأسعار» يعرض السعر في نموذج الحجز وصفحات الغرف. «الحجز الفوري» يؤكد الحجز تلقائيًا عندما تتوفر غرفة وسعر لكل ليلة. يراجع مدير المبيعات كل الأسعار قبل تشغيلهما.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {branches.filter((b) => !me?.branch || b.slug === me.branch).map((b) => (
            <div key={b.slug} className="rounded border border-line p-3">
              <div className="font-bold mb-2">{BRANCH_NAMES[b.slug] ?? b.name_ar}</div>
              <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span>إظهار الأسعار على الموقع</span>
                <input type="checkbox" className="size-5 accent-bronze-deep" checked={!!prices[b.slug]} disabled={ro || busy === 'show_prices'} data-switch={`show_prices:${b.slug}`}
                  onChange={async (e) => { const prev = prices; const v = { ...prices, [b.slug]: e.target.checked }; setPrices(v); if (!(await save('show_prices', v, `إظهار الأسعار — ${BRANCH_NAMES[b.slug]}`, load))) setPrices(prev); }} />
              </label>
              <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span>الحجز الفوري</span>
                <input type="checkbox" className="size-5 accent-bronze-deep" checked={!!instant[b.slug]} disabled={ro || busy === 'instant_booking'} data-switch={`instant_booking:${b.slug}`}
                  onChange={async (e) => { const prev = instant; const v = { ...instant, [b.slug]: e.target.checked }; setInstant(v); if (!(await save('instant_booking', v, `الحجز الفوري — ${BRANCH_NAMES[b.slug]}`, load))) setInstant(prev); }} />
              </label>
            </div>
          ))}
        </div>
      </section>

      <DirtyScope className="card p-5" aria-labelledby="s-bf" version={saved} data-scope="breakfast">
        <h2 id="s-bf" className="font-bold text-lg mb-1">الإفطار</h2>
        <p className="text-sm text-ink-muted mb-4">للشخص في اليوم، شامل الضريبة. شرائح الأطفال بحسب العمر؛ فوق آخر شريحة يُحسب بسعر البالغ.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="البالغ" id="bf-adult"><NumberField id="bf-adult" value={bf.adult} onChange={(n) => setBf({ ...bf, adult: n ?? 0 })} decimal min={0} max={1000} /></Field>
        </div>
        <div className="mt-3 grid gap-2">
          {bf.child_tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <Field label="حتى عمر (سنة)" id={`t-age-${i}`}><NumberField id={`t-age-${i}`} value={t.max_age} onChange={(n) => { const c = [...bf.child_tiers]; c[i] = { ...t, max_age: n ?? 0 }; setBf({ ...bf, child_tiers: c }); }} min={0} max={17} /></Field>
              <Field label="السعر" id={`t-price-${i}`}><NumberField id={`t-price-${i}`} value={t.price} onChange={(n) => { const c = [...bf.child_tiers]; c[i] = { ...t, price: n ?? 0 }; setBf({ ...bf, child_tiers: c }); }} decimal min={0} max={1000} /></Field>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBf({ ...bf, child_tiers: bf.child_tiers.filter((_, j) => j !== i) })} aria-label="حذف الشريحة" disabled={ro}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => setBf({ ...bf, child_tiers: [...bf.child_tiers, { max_age: Math.min(17, (bf.child_tiers.at(-1)?.max_age ?? 0) + 1), price: 0 }] })} disabled={ro}>+ شريحة</button>
        </div>
        <p className="text-xs text-ink-muted mt-2 num-ar">الحالي: البالغ {sar(bf.adult)}{bf.child_tiers.map((t) => ` · حتى ${t.max_age} سنة ${t.price === 0 ? 'مجانًا' : sar(t.price)}`).join('')}.</p>
        {editable && <button type="button" className="btn btn-primary mt-4" onClick={() => save('breakfast', bf, 'الإفطار', load)} disabled={busy === 'breakfast'} data-action="save-breakfast">{busy === 'breakfast' && <Spinner />} حفظ الإفطار</button>}
      </DirtyScope>

      <DirtyScope className="card p-5" aria-labelledby="s-bed" version={saved} data-scope="bed">
        <h2 id="s-bed" className="font-bold text-lg mb-1">السرير الإضافي</h2>
        <p className="text-sm text-ink-muted mb-4">لليلة، شامل الضريبة. يُطبَّق على عرض السعر فورًا، وعلى نموذج الحجز ورسائل البريد وصفحة السياسات بعد إعادة بناء الموقع (تُطلب تلقائيًا عند الحفظ).</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="السعر لليلة" id="bed"><NumberField id="bed" value={bed} onChange={setBed} decimal min={0} max={1000} /></Field>
          {editable && <button type="button" className="btn btn-primary" onClick={() => bed !== null && save('extra_bed_per_night', bed, 'السرير الإضافي', async () => { await load(); await askRebuild(); })} disabled={busy === 'extra_bed_per_night' || bed === null} data-action="save-bed">{busy === 'extra_bed_per_night' && <Spinner />} حفظ</button>}
        </div>
        {rebuild && <p className="text-xs text-ink-muted mt-2" role="status">{rebuild}</p>}
      </DirtyScope>

      <DirtyScope className="card p-5" aria-labelledby="s-limits" version={saved} data-scope="limits">
        <h2 id="s-limits" className="font-bold text-lg mb-1">حدود الحجز الفوري</h2>
        <p className="text-sm text-ink-muted mb-4">بعد وقت الإغلاق يصبح وصول اليوم طلبًا يؤكده الاستقبال؛ والإقامة الأطول من الحد تصبح طلبًا.</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="آخر وقت للحجز الفوري لوصول اليوم (توقيت الرياض)" id="cutoff-h" hint={time12(limits.same_day_cutoff)}>
            <div className="flex items-center gap-1" dir="ltr">
              <select id="cutoff-h" className="field num" value={limits.same_day_cutoff.split(':')[0]} onChange={(e) => setLimits({ ...limits, same_day_cutoff: `${e.target.value}:${limits.same_day_cutoff.split(':')[1] ?? '00'}` })} aria-label="الساعة" disabled={ro}>
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="num">:</span>
              <select className="field num" value={MINUTES.includes(limits.same_day_cutoff.split(':')[1]) ? limits.same_day_cutoff.split(':')[1] : '00'} onChange={(e) => setLimits({ ...limits, same_day_cutoff: `${limits.same_day_cutoff.split(':')[0]}:${e.target.value}` })} aria-label="الدقائق" disabled={ro}>
                {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </Field>
          <Field label="أقصى عدد ليالٍ" id="maxn"><NumberField id="maxn" value={limits.max_nights} onChange={(n) => setLimits({ ...limits, max_nights: n ?? 1 })} min={1} max={366} /></Field>
          {editable && <button type="button" className="btn btn-primary" onClick={() => save('instant_limits', limits, 'حدود الحجز الفوري', load)} disabled={busy === 'instant_limits'} data-action="save-limits">{busy === 'instant_limits' && <Spinner />} حفظ</button>}
        </div>
      </DirtyScope>
      {/* C3 (28 Oct 2026): the high-price warning multiplier — a setting like the others (audited, undoable, in the site defaults) */}
      <DirtyScope className="card p-5" aria-labelledby="s-rate-warn" version={saved} data-scope="rate-warn">
        <h2 id="s-rate-warn" className="font-bold text-lg mb-1">تنبيهات الأسعار</h2>
        <p className="text-sm text-ink-muted mb-4">عند إدخال سعر ليلة يُقارن بالسعر الأساسي لكل نوع غرفة: الأقل منه، أو ما يبلغ هذا المضاعف أو أكثر، يظهر معه تنبيه ويُطلب تأكيد قبل التطبيق. الحفظ لا يُمنع، ويسجّل السجل التنبيه.</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="تنبيه السعر المرتفع: مضاعف السعر الأساسي" id="rate-mult" hint="عدد صحيح، 2 على الأقل؛ الافتراضي 10"><NumberField id="rate-mult" value={mult} onChange={setMult} max={1000} /></Field>
          {editable && <button type="button" className="btn btn-primary" onClick={() => mult !== null && mult >= 2 && save('rate_high_multiplier', Math.floor(mult), 'تنبيه السعر المرتفع', load)} disabled={busy === 'rate_high_multiplier' || mult === null || mult < 2} data-action="save-rate-mult">{busy === 'rate_high_multiplier' && <Spinner />} حفظ</button>}
        </div>
      </DirtyScope>
      {/* phase 2a.2 D: saved defaults, system admin only (the database refuses anyone else) */}
      {me?.is_admin && <SiteDefaults onRestored={async (rebuild) => { await load(); if (rebuild) await askRebuild(); }} />}
    </div>
  );
}
