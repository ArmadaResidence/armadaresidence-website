// Audit log (decision 9): who, when, old → new; bulk edits grouped by batch. Reception sees its branch only (RLS).
import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { AuditRow } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, riyadhDateTime } from '../lib/format';
import { Empty, ErrorBox, Field, Loading } from '../components/ui';

const ENTITY: Record<string, string> = { room_types: 'سعر أساسي / نوع غرفة', rate_overrides: 'استثناء سعر', inventory_days: 'مخزون', settings: 'إعدادات', staff: 'مستخدم', reservations: 'حجز' };
const FIELD: Record<string, string> = { base_rate: 'السعر الأساسي', bookable: 'قابل للحجز', active: 'فعّال', slug: 'المعرّف', date_from: 'من', date_to: 'إلى', weekdays: 'أيام الأسبوع', price: 'السعر', label: 'التسمية', night: 'الليلة', rooms_to_sell: 'المتبقي', booked: 'المحجوز', stop_sell: 'موقوف', value: 'القيمة', full_name: 'الاسم', role: 'الدور', branch: 'الفرع', ref: 'رقم الحجز', status: 'الحالة', confirmation: 'التأكيد', fallback_reason: 'السبب', room_type_id: 'نوع الغرفة', check_in: 'الوصول', check_out: 'المغادرة', total: 'الإجمالي', payment_status: 'الدفع', cancel_reason: 'سبب الإلغاء', internal_notes: 'ملاحظات داخلية' };

function diff(row: AuditRow): string[] {
  const keys = new Set([...Object.keys(row.old ?? {}), ...Object.keys(row.new ?? {})]);
  const out: string[] = [];
  for (const k of keys) {
    const a = row.old?.[k];
    const b = row.new?.[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const f = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    out.push(`${FIELD[k] ?? k}: ${row.action === 'insert' ? f(b) : row.action === 'delete' ? f(a) : `${f(a)} ← ${f(b)}`}`);
  }
  return out;
}

export default function Audit() {
  const { me } = useSession();
  const locked = me?.role === 'reception' ? me.branch! : null;
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entity, setEntity] = useState('');
  const [actor, setActor] = useState('');
  const [branch, setBranch] = useState(locked ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    api.audit({ entity: entity || undefined, actor: actor || undefined, branch: branch || undefined, from: from || undefined, to: to || undefined }).then(setRows).catch((e) => { setError(e.message); setRows([]); });
  }, [entity, actor, branch, from, to]);

  // group bulk edits (same batch_id) into one entry that expands per row
  const groups = useMemo(() => {
    const out: { key: string; rows: AuditRow[] }[] = [];
    const idx = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = r.batch_id ?? `single-${r.id}`;
      if (idx.has(k)) out[idx.get(k)!].rows.push(r);
      else {
        idx.set(k, out.length);
        out.push({ key: k, rows: [r] });
      }
    }
    return out;
  }, [rows]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">سجل التدقيق</h1>
      <div className="card p-3 sm:p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <Field label="النوع" id="a-entity">
          <select id="a-entity" className="field" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {!locked && (
          <Field label="الفرع" id="a-branch">
            <select id="a-branch" className="field" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(BRANCH_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
        <Field label="المستخدم" id="a-actor"><input id="a-actor" className="field" value={actor} onChange={(e) => setActor(e.target.value)} /></Field>
        <Field label="من" id="a-from"><input id="a-from" type="date" className="field num" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى" id="a-to"><input id="a-to" type="date" className="field num" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <ErrorBox error={error} />
      {rows === null ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Empty text="لا سجلات." />
      ) : (
        <ul className="grid gap-2" data-list="audit">
          {groups.map((g) => {
            const r = g.rows[0];
            return (
              <li key={g.key} className="card p-3 text-sm">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-ink-muted">
                  <span className="num">{riyadhDateTime(r.at)}</span>
                  <span className="text-ink font-bold">{r.actor_label === 'website' ? 'الموقع' : r.actor_label === 'seed' ? 'الاستيراد الأول' : r.actor_label}</span>
                  <span>{ENTITY[r.entity] ?? r.entity}</span>
                  {r.branch && <span>{BRANCH_NAMES[r.branch]}</span>}
                  <span>{r.action === 'insert' ? 'إضافة' : r.action === 'delete' ? 'حذف' : 'تعديل'}</span>
                  {g.rows.length > 1 && <span className="chip chip-request">تعديل جماعي · {g.rows.length}</span>}
                </div>
                {g.rows.length === 1 ? (
                  <ul className="mt-1 grid gap-0.5">{diff(r).map((d, i) => <li key={i}>{d}</li>)}</ul>
                ) : (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-bronze-text">{diff(r).slice(0, 2).join(' · ')} … (اعرض الكل)</summary>
                    <ul className="mt-1 grid gap-0.5 text-ink-muted">
                      {g.rows.map((x) => <li key={x.id}><span className="num">{x.new?.night as string ?? x.entity_id}</span>: {diff(x).join(' · ')}</li>)}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
