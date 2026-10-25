// Settings (DASHBOARD-SPEC §3.9 + decisions 3 / 5 / Q5 / Q11): breakfast prices and child tiers, extra-bed fee, the
// per-branch switches (prices shown, instant booking) and the instant limits. Every save is audited by the database.
import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { BRANCH_NAMES, sar } from '../lib/format';
import { ErrorBox, Field, Loading, Spinner, useToast } from '../components/ui';

interface Breakfast {
  adult: number;
  child_tiers: { max_age: number; price: number }[];
}
interface Limits {
  same_day_cutoff: string;
  max_nights: number;
}

export default function Settings() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<api.Branch[]>([]);
  const [bf, setBf] = useState<Breakfast>({ adult: 0, child_tiers: [] });
  const [bed, setBed] = useState(0);
  const [instant, setInstant] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Limits>({ same_day_cutoff: '20:00', max_nights: 30 });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [b, s] = await Promise.all([api.branches(), api.settings()]);
        setBranches(b);
        const get = (k: string) => s.find((x) => x.key === k)?.value;
        setBf((get('breakfast') as Breakfast) ?? { adult: 0, child_tiers: [] });
        setBed(Number(get('extra_bed_per_night') ?? 0));
        setInstant((get('instant_booking') as Record<string, boolean>) ?? {});
        setPrices((get('show_prices') as Record<string, boolean>) ?? {});
        setLimits((get('instant_limits') as Limits) ?? { same_day_cutoff: '20:00', max_nights: 30 });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(key: string, value: unknown, label: string) {
    setBusy(key);
    try {
      await api.saveSetting(key, value);
      toast(`حُفظ: ${label}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  return (
    <div className="grid gap-5 max-w-3xl">
      <h1 className="text-2xl font-bold">الإعدادات</h1>
      <ErrorBox error={error} />

      <section className="card p-5" aria-labelledby="s-switches">
        <h2 id="s-switches" className="font-bold text-lg mb-1">مفاتيح الموقع لكل فرع</h2>
        <p className="text-sm text-ink-muted mb-4">«إظهار الأسعار» يعرض السعر في نموذج الحجز وصفحات الغرف. «الحجز الفوري» يؤكد الحجز تلقائيًا عندما تتوفر غرفة وسعر لكل ليلة. يراجع مدير المبيعات كل الأسعار قبل تشغيلهما.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {branches.map((b) => (
            <div key={b.slug} className="rounded border border-line p-3">
              <div className="font-bold mb-2">{BRANCH_NAMES[b.slug] ?? b.name_ar}</div>
              <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span>إظهار الأسعار على الموقع</span>
                <input type="checkbox" className="size-5 accent-bronze-deep" checked={!!prices[b.slug]} data-switch={`show_prices:${b.slug}`} onChange={(e) => { const v = { ...prices, [b.slug]: e.target.checked }; setPrices(v); save('show_prices', v, `إظهار الأسعار — ${BRANCH_NAMES[b.slug]}`); }} />
              </label>
              <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span>الحجز الفوري</span>
                <input type="checkbox" className="size-5 accent-bronze-deep" checked={!!instant[b.slug]} data-switch={`instant_booking:${b.slug}`} onChange={(e) => { const v = { ...instant, [b.slug]: e.target.checked }; setInstant(v); save('instant_booking', v, `الحجز الفوري — ${BRANCH_NAMES[b.slug]}`); }} />
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5" aria-labelledby="s-bf">
        <h2 id="s-bf" className="font-bold text-lg mb-1">الإفطار</h2>
        <p className="text-sm text-ink-muted mb-4">للشخص في اليوم، شامل الضريبة. شرائح الأطفال بحسب العمر؛ فوق آخر شريحة يُحسب بسعر البالغ.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="البالغ" id="bf-adult"><input id="bf-adult" className="field num" inputMode="decimal" value={bf.adult} onChange={(e) => setBf({ ...bf, adult: Number(e.target.value) || 0 })} /></Field>
        </div>
        <div className="mt-3 grid gap-2">
          {bf.child_tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <Field label={`حتى عمر (سنة)`} id={`t-age-${i}`}><input id={`t-age-${i}`} className="field num" inputMode="numeric" value={t.max_age} onChange={(e) => { const c = [...bf.child_tiers]; c[i] = { ...t, max_age: Number(e.target.value) || 0 }; setBf({ ...bf, child_tiers: c }); }} /></Field>
              <Field label="السعر" id={`t-price-${i}`}><input id={`t-price-${i}`} className="field num" inputMode="decimal" value={t.price} onChange={(e) => { const c = [...bf.child_tiers]; c[i] = { ...t, price: Number(e.target.value) || 0 }; setBf({ ...bf, child_tiers: c }); }} /></Field>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBf({ ...bf, child_tiers: bf.child_tiers.filter((_, j) => j !== i) })} aria-label="حذف الشريحة">✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => setBf({ ...bf, child_tiers: [...bf.child_tiers, { max_age: (bf.child_tiers.at(-1)?.max_age ?? 0) + 1, price: 0 }] })}>+ شريحة</button>
        </div>
        <p className="text-xs text-ink-muted mt-2">الحالي: البالغ {sar(bf.adult)}{bf.child_tiers.map((t) => ` · حتى ${t.max_age} سنة ${t.price === 0 ? 'مجانًا' : sar(t.price)}`).join('')}.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => save('breakfast', bf, 'الإفطار')} disabled={busy === 'breakfast'} data-action="save-breakfast">{busy === 'breakfast' && <Spinner />} حفظ الإفطار</button>
      </section>

      <section className="card p-5" aria-labelledby="s-bed">
        <h2 id="s-bed" className="font-bold text-lg mb-1">السرير الإضافي</h2>
        <p className="text-sm text-ink-muted mb-4">لليلة، شامل الضريبة. يظهر في نموذج الحجز ورسائل البريد وصفحة السياسات بعد إعادة بناء الموقع.</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="السعر لليلة" id="bed"><input id="bed" className="field num" inputMode="decimal" value={bed} onChange={(e) => setBed(Number(e.target.value) || 0)} /></Field>
          <button type="button" className="btn btn-primary" onClick={() => save('extra_bed_per_night', bed, 'السرير الإضافي')} disabled={busy === 'extra_bed_per_night'}>{busy === 'extra_bed_per_night' && <Spinner />} حفظ</button>
        </div>
      </section>

      <section className="card p-5" aria-labelledby="s-limits">
        <h2 id="s-limits" className="font-bold text-lg mb-1">حدود الحجز الفوري</h2>
        <p className="text-sm text-ink-muted mb-4">بعد وقت الإغلاق يصبح وصول اليوم طلبًا يؤكده الاستقبال؛ والإقامة الأطول من الحد تصبح طلبًا.</p>
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="إغلاق وصول اليوم (توقيت الرياض)" id="cutoff"><input id="cutoff" type="time" className="field num" value={limits.same_day_cutoff} onChange={(e) => setLimits({ ...limits, same_day_cutoff: e.target.value })} /></Field>
          <Field label="أقصى عدد ليالٍ" id="maxn"><input id="maxn" className="field num" inputMode="numeric" value={limits.max_nights} onChange={(e) => setLimits({ ...limits, max_nights: Number(e.target.value) || 1 })} /></Field>
          <button type="button" className="btn btn-primary" onClick={() => save('instant_limits', limits, 'حدود الحجز الفوري')} disabled={busy === 'instant_limits'}>{busy === 'instant_limits' && <Spinner />} حفظ</button>
        </div>
      </section>
    </div>
  );
}
