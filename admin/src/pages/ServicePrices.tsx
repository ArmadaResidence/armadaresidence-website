// «أسعار الخدمات» — read-only (Guest Hub H4, 14 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §4.4, §5.5 [مقرر — 12 نوفمبر
// 2026: existing fees only]). Each fee where it is already kept, never copied: breakfast per adult and the child tiers and
// the extra bed from Settings (hub_service_prices → settings) — «تعديل من الإعدادات»; late check-out and the lost key card
// from content/policies.json as the site publishes them — «تعديل من المحتوى»; the hall «عن طريق المبيعات». Nothing is
// editable here; an editable list comes with the first new service Ahmed defines.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { sar } from '../lib/format';
import { POLICY_FEES, servicePrices, type ServicePrices as Prices } from '../lib/knowledge';
import { ErrorBox, Loading } from '../components/ui';

const ageText = (n: number) => (n === 1 ? 'سنة واحدة' : n === 2 ? 'سنتين' : n <= 10 ? `${n} سنوات` : `${n} سنة`);

export default function ServicePrices() {
  const { me } = useSession();
  const [p, setP] = useState<Prices | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    servicePrices().then(setP, (e: Error) => setError(e.message));
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!p) return <Loading />;
  const settings = api.canView(me, 'settings');
  const content = api.canView(me, 'content');
  const edit = (to: '/settings' | '/content', label: string) => (to === '/settings' ? settings : content)
    ? <Link className="btn btn-ghost btn-sm" to={to} data-edit-link={to}>{label}</Link>
    : <span className="text-xs text-ink-muted" data-edit-link={to}>{label}</span>;
  const tiers = [...(p.breakfast?.child_tiers ?? [])].sort((a, b) => a.max_age - b.max_age);
  const rows: { key: string; label: string; value: string; where: ReactNode }[] = [
    { key: 'breakfast_adult', label: 'الإفطار للشخص البالغ، لكل ليلة', value: sar(p.breakfast?.adult), where: edit('/settings', 'تعديل من الإعدادات') },
    ...tiers.map((t, i) => ({
      key: `breakfast_child_${t.max_age}`,
      label: `الإفطار للطفل ${i === 0 ? `حتى ${ageText(t.max_age)}` : `من ${ageText(tiers[i - 1].max_age + 1)} إلى ${ageText(t.max_age)}`}، لكل ليلة`,
      value: Number(t.price) === 0 ? 'مجانًا' : sar(t.price),
      where: edit('/settings', 'تعديل من الإعدادات'),
    })),
    { key: 'extra_bed', label: 'السرير الإضافي، لكل ليلة', value: sar(p.extra_bed_per_night), where: edit('/settings', 'تعديل من الإعدادات') },
    { key: 'late_2pm', label: 'المغادرة المتأخرة حتى الساعة 2:00 ظهرًا (حسب التوافر)', value: sar(POLICY_FEES.late_2pm), where: edit('/content', 'تعديل من المحتوى') },
    { key: 'late_4pm', label: 'المغادرة المتأخرة حتى الساعة 4:00 عصرًا (حسب التوافر)', value: sar(POLICY_FEES.late_4pm), where: edit('/content', 'تعديل من المحتوى') },
    { key: 'key_card', label: 'فقدان بطاقة الغرفة', value: sar(POLICY_FEES.key_card), where: edit('/content', 'تعديل من المحتوى') },
    { key: 'hall', label: 'القاعة', value: 'عن طريق المبيعات', where: <span className="text-xs text-ink-muted">لا يذكر المساعد سعرًا للقاعة</span> },
  ];
  return (
    <div className="grid gap-5 max-w-4xl" data-page="service-prices">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold">أسعار الخدمات</h1>
        <p className="text-sm text-ink-muted mt-1">
          للقراءة فقط: الرسوم كما هي محفوظة في مصادرها، وهي ما يذكره المساعد. الأسعار شاملة الضريبة. خدمة ليس لها سعر هنا يُحيلها المساعد للاستقبال.
        </p>
      </div>
      <div className="card p-2 overflow-x-auto" data-tour="prices-table">
        <table className="kn-prices w-full text-sm">
          <thead>
            <tr><th scope="col">الخدمة</th><th scope="col">السعر</th><th scope="col">مصدره</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-price={r.key}>
                <th scope="row">{r.label}</th>
                <td className="num" data-value>{r.value}</td>
                <td>{r.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
