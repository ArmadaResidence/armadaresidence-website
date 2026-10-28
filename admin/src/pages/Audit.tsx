// Audit log (decision 9; phase 2a.1 item 3): who, when, old → new; bulk edits grouped by batch; «استرجاع هذا التغيير»
// per group (revert_batch: refused for booking status changes, for groups the caller may not edit, and when the
// current values moved on — conflict → nothing changes); groups already reverted show «مُسترجَع»; revert groups say
// which change they reversed. Date filter = the site's picker (past allowed); «تحميل المزيد» pages by id.
import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { AuditRow } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, longDate, riyadhDateTimeLong, rowsWord, sar } from '../lib/format';
import DateField from '../components/DateField';
import { CancelButton, Empty, ErrorBox, Field, Loading, Modal, Spinner, useLeaveGuard, useToast } from '../components/ui';

const ENTITY: Record<string, string> = { room_types: 'نوع غرفة (سعر أساسي / توافر)', rate_overrides: 'استثناء سعر', inventory_days: 'مخزون', settings: 'إعدادات', staff: 'مستخدم', staff_permissions: 'صلاحيات', reservations: 'حجز', security_events: 'أمان الدخول', site_defaults: 'الإعدادات الافتراضية' };
// phase 2a.2 (26 Oct 2026): one line per security event (devices, backup codes) — never a code or a token
const REVOKE_REASON: Record<string, string> = { admin: 'بواسطة مدير النظام', self: 'بواسطة المستخدم', password_change: 'بعد تغيير كلمة المرور', deactivated: 'بعد إيقاف الحساب' };
function securityLine(r: AuditRow): string {
  const d = (r.new?.detail ?? {}) as Record<string, unknown>;
  switch (r.new?.event) {
    case 'device_remembered':
      return `تذكّر جهاز: ${String(d.label ?? '')}`;
    case 'devices_revoked':
      return `إلغاء الأجهزة المتذكَّرة (${Number(d.count ?? 0)}) ${REVOKE_REASON[String(d.reason)] ?? ''}`.trim();
    case 'backup_codes_generated':
      return `إنشاء رموز طوارئ (${Number(d.count ?? 10)})${Number(d.replaced ?? 0) ? ` — أُلغي ${Number(d.replaced)} من الرموز السابقة` : ''}`;
    case 'backup_code_used':
      return `دخول برمز طوارئ — المتبقي ${Number(d.left ?? 0)}`;
  }
  return String(r.new?.event ?? '');
}
const ACTOR: Record<string, string> = { website: 'الموقع', seed: 'الاستيراد الأول', migration: 'تحديث النظام', auth: 'نظام الدخول', system: 'النظام' };
const FIELD: Record<string, string> = { is_default: 'الافتراضي', kind: 'النوع', saved_at: 'وقت الحفظ', base_rate: 'السعر الأساسي', bookable: 'متاحة على الموقع', active: 'فعّال', slug: 'المعرّف', date_from: 'من', date_to: 'إلى', weekdays: 'أيام الأسبوع', price: 'السعر', label: 'التسمية', label_en: 'التسمية بالإنجليزية', night: 'الليلة', rooms_to_sell: 'المتبقي', booked: 'المحجوز', stop_sell: 'مغلق', value: 'القيمة', full_name: 'الاسم', role: 'القالب', branch: 'الفرع', ref: 'رقم الحجز', status: 'الحالة', confirmation: 'التأكيد', fallback_reason: 'السبب', room_type_id: 'نوع الغرفة', check_in: 'الوصول', check_out: 'المغادرة', total: 'الإجمالي', payment_status: 'الدفع', cancel_reason: 'سبب الإلغاء', internal_notes: 'ملاحظات داخلية', level: 'المستوى', created_at: 'أُنشئ' };
const LEVEL: Record<string, string> = { none: 'لا شيء', view: 'عرض', edit: 'تعديل' };
const ROLE: Record<string, string> = { admin: 'مدير النظام', management: 'الإدارة', sales: 'المبيعات', reception: 'الاستقبال' };
const SKIP = new Set(['created_at', 'room_type_id']);

function fmt(k: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? (k === 'stop_sell' ? 'مغلق' : 'نعم') : (k === 'stop_sell' ? 'مفتوح' : 'لا');
  if (k === 'level') return LEVEL[String(v)] ?? String(v);
  if (k === 'role') return ROLE[String(v)] ?? String(v);
  if (k === 'branch') return BRANCH_NAMES[String(v)] ?? String(v);
  if (k === 'night' || k === 'date_from' || k === 'date_to' || k === 'check_in' || k === 'check_out') return longDate(String(v));
  if (k === 'base_rate' || k === 'price' || k === 'total') return sar(v as number);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function diff(row: AuditRow): string[] {
  if (row.entity === 'security_events') return [securityLine(row)];
  const keys = new Set([...Object.keys(row.old ?? {}), ...Object.keys(row.new ?? {})]);
  const out: string[] = [];
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const a = row.old?.[k];
    const b = row.new?.[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push(`${FIELD[k] ?? k}: ${row.action === 'insert' ? fmt(k, b) : row.action === 'delete' ? fmt(k, a) : `${fmt(k, a)} ← ${fmt(k, b)}`}`);
  }
  return out;
}
const rowTitle = (x: AuditRow) => (x.entity === 'inventory_days' ? longDate(x.entity_id.split(':')[1]) : x.entity === 'staff_permissions' ? (x.entity_id.split(':')[1] ?? x.entity_id) : x.entity_id.slice(0, 8));

const PAGE = 300;

export default function Audit() {
  const { me } = useSession();
  const toast = useToast();
  const guard = useLeaveGuard();
  const locked = me?.branch ?? null;
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reverted, setReverted] = useState<Set<string>>(new Set());
  const [restores, setRestores] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [entity, setEntity] = useState('');
  const [actor, setActor] = useState('');
  const [branch, setBranch] = useState(locked ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [confirm, setConfirm] = useState<{ key: string; rows: AuditRow[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const filters = useMemo(() => ({ entity: entity || undefined, actor: actor || undefined, branch: branch || undefined, from: from || undefined, to: to || undefined }), [entity, actor, branch, from, to]);

  const load = async () => {
    try {
      setError(null);
      const r = await api.audit(filters, PAGE);
      setRows(r);
      setMore(r.length === PAGE);
      const ids = Array.from(new Set(r.map((x) => x.batch_id).filter((x): x is string => !!x)));
      setReverted(await api.revertedBatches(ids));
      setRestores(await api.defaultsBatches(ids));
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  };
  useEffect(() => {
    load();
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!rows?.length) return;
    setLoadingMore(true);
    try {
      const r = await api.audit(filters, PAGE, rows[rows.length - 1].id);
      const all = [...rows, ...r];
      setRows(all);
      setMore(r.length === PAGE);
      const ids = Array.from(new Set(all.map((x) => x.batch_id).filter((x): x is string => !!x)));
      setReverted(await api.revertedBatches(ids));
      setRestores(await api.defaultsBatches(ids));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoadingMore(false);
    }
  }

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

  const sectionOf = (r: AuditRow) => (r.entity === 'room_types' ? (JSON.stringify(r.old?.bookable) !== JSON.stringify(r.new?.bookable) ? 'rooms' : 'rates') : r.entity === 'rate_overrides' ? 'rates' : r.entity === 'inventory_days' ? 'inventory' : r.entity === 'settings' ? 'settings' : r.entity === 'staff' || r.entity === 'staff_permissions' || r.entity === 'site_defaults' ? 'users' : null);
  const canRevert = (g: { rows: AuditRow[] }) => {
    const r = g.rows[0];
    if (!r.batch_id || r.entity === 'reservations' || reverted.has(r.batch_id)) return false;
    return g.rows.every((x) => {
      const s = sectionOf(x);
      return !!s && api.canEdit(me, s) && (x.branch === null ? me?.branch === null : !me?.branch || me.branch === x.branch);
    });
  };

  async function doRevert() {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = await api.revertBatch(confirm.key);
      setConfirm(null);
      toast(`استُرجع التغيير (${rowsWord(r.rows)})`);
      await load();
    } catch (e) {
      const err = e as Error & { details?: string };
      setConfirm(null);
      toast(err.message + (err.details ? ` — ${conflictText(err.details)}` : ''), 'error');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">سجل التدقيق</h1>
      <div className="card p-3 sm:p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="النوع" id="a-entity">
          <select id="a-entity" className="field" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {!locked && (
          <Field label="الفرع" id="a-branch">
            <select id="a-branch" className="field" value={branch} onChange={(e) => { const v = e.target.value; guard.run(() => setBranch(v)); }}>
              <option value="">الكل</option>
              {Object.entries(BRANCH_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
        <Field label="المستخدم" id="a-actor"><input id="a-actor" className="field" value={actor} onChange={(e) => setActor(e.target.value)} /></Field>
        <div className="col-span-2 md:col-span-4 lg:col-span-2">
          <DateField mode="range" label="من" endLabel="إلى" start={from} end={to} onChange={(a, b) => { setFrom(a); setTo(b); }} min="past" id="a-dates" />
        </div>
      </div>
      <ErrorBox error={error} />
      {rows === null ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Empty text="لا سجلات." />
      ) : (
        <>
          <ul className="grid gap-2" data-list="audit">
            {groups.map((g) => {
              const r = g.rows[0];
              const isRevert = !!r.reverts_batch;
              const wasReverted = !!r.batch_id && reverted.has(r.batch_id);
              return (
                <li key={g.key} className="card p-3 text-sm" data-batch={r.batch_id ?? undefined} data-reverted={wasReverted || undefined}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
                    <span className="num-ar">{riyadhDateTimeLong(r.at)}</span>
                    <span className="text-ink font-bold">{ACTOR[r.actor_label] ?? r.actor_label}</span>
                    <span>{ENTITY[r.entity] ?? r.entity}</span>
                    {r.branch && <span>{BRANCH_NAMES[r.branch]}</span>}
                    <span>{r.action === 'insert' ? 'إضافة' : r.action === 'delete' ? 'حذف' : 'تعديل'}</span>
                    {g.rows.length > 1 && <span className="chip chip-request">تعديل جماعي · <span className="num-ar">{rowsWord(g.rows.length)}</span></span>}
                    {isRevert && <span className="chip chip-request">استرجاع لتغيير سابق</span>}
                    {!!r.batch_id && restores.has(r.batch_id) && <span className="chip chip-flag" data-restore-batch>استعادة الإعدادات الافتراضية</span>}
                    {wasReverted && <span className="chip chip-cancelled" style={{ textDecoration: 'none' }}>مُسترجَع</span>}
                    {canRevert(g) && (
                      <button type="button" className="btn btn-ghost btn-sm ms-auto" onClick={() => setConfirm(g)} data-action="revert">استرجاع هذا التغيير</button>
                    )}
                  </div>
                  {g.rows.length === 1 ? (
                    <ul className="mt-1 grid gap-0.5 num-ar">{diff(r).map((d, i) => <li key={i}>{d}</li>)}</ul>
                  ) : (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-bronze-text">{diff(r).slice(0, 2).join(' · ')} … (اعرض الكل)</summary>
                      <ul className="mt-1 grid gap-0.5 text-ink-muted num-ar">
                        {g.rows.map((x) => <li key={x.id}>{rowTitle(x)}: {diff(x).join(' · ')}</li>)}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          {more && (
            <div className="text-center mt-4">
              <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore && <Spinner />} تحميل المزيد</button>
            </div>
          )}
        </>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="استرجاع هذا التغيير" busy={busy}>
        {confirm && (
          <>
            <p className="text-sm text-ink-muted mb-3">تُستعاد القيم القديمة فقط إذا كانت القيم الحالية لم تتغير منذ هذا التعديل؛ وإلا يظهر تعارض ولا يتغير شيء. الاسترجاع نفسه يُسجَّل.</p>
            <ul className="text-sm grid gap-0.5 max-h-60 overflow-auto num-ar">
              {confirm.rows.map((x) => <li key={x.id}>{rowTitle(x)}: {diff(x).join(' · ')}</li>)}
            </ul>
            <div className="flex gap-2 justify-end mt-5">
              <CancelButton disabled={busy} />
              <button type="button" className="btn btn-primary" onClick={doRevert} disabled={busy} data-action="revert-go">{busy && <Spinner />} استرجاع</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/** Conflict detail from revert_batch → «المخزون 2027-02-02: المتوقع 3، الحالي 2» */
function conflictText(details: string): string {
  try {
    const list = JSON.parse(details) as { entity: string; id: string; expected?: Record<string, unknown>; current?: Record<string, unknown>; reason?: string }[];
    return list.slice(0, 3).map((c) => {
      const name = `${ENTITY[c.entity] ?? c.entity} ${c.entity === 'inventory_days' ? longDate(c.id.split(':')[1]) : ''}`.trim();
      if (c.reason === 'booked') return `${name}: الليلة فيها حجوزات`;
      const keys = Object.keys({ ...(c.expected ?? {}), ...(c.current ?? {}) }).filter((k) => JSON.stringify(c.expected?.[k]) !== JSON.stringify(c.current?.[k]));
      return `${name}: ${keys.map((k) => `${FIELD[k] ?? k} المتوقع ${fmt(k, c.expected?.[k])}، الحالي ${fmt(k, c.current?.[k])}`).join('، ')}`;
    }).join(' · ');
  } catch {
    return '';
  }
}
