// «إعدادات المساعد» → «السوشيال» (Guest Hub S1, Ahmed 25 Nov 2026 — DECISIONS.md 2026-11-25 «Guest Hub S1»): the brand unit
// that answers Instagram and Messenger direct messages (the same assistant, knowledge and guard as WhatsApp).
//   - the unit's state (off until the system admin switches it on in «الإعدادات»), its channels and «ربط الصفحة وحساب
//     انستجرام» (hub-admin meta_setup: the Graph API subscriptions with the Meta secrets on the server — never shown);
//   - «جمهور الردود»: «حسابات التجربة فقط» (the start) / «الكل» / «الكل مع وضع الاستعداد» and its minutes; «Human Agent»
//     (only once Meta approved it) — the system admin's, audited, with «تراجع»;
//   - «حسابات التجربة»: the accounts that wrote to the Page or the Instagram account, each with «حساب تجربة»;
//   - «طلبات حذف البيانات» (the system admin): the requests, and «حذف بيانات المحادثات» with its confirmation.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import * as api from '../lib/api';
import { riyadhDateTime, west } from '../lib/format';
import { Confirm, ErrorBox, Loading, Spinner, useToast } from '../components/ui';
import { channelLabel, dataDelete, sendError } from '../lib/inbox';

type SocialMode = 'test' | 'live' | 'standby';
interface Overview {
  unit: { id: string; key: string; name_ar: string; mode: string; social_mode: SocialMode; standby_minutes: number; human_agent: boolean; status: string } | null;
  channels: { id: string; kind: string; address: string; display_name: string | null; connected: boolean; verified_at: string | null; sending_enabled: boolean }[];
  accounts: { id: string; kind: string; name: string | null; username: string | null; tester: boolean; last_seen_at: string }[];
  system_admin: boolean;
}
interface Deletion {
  id: string; profile_id: string; channel_kind: string | null; via: string; status: 'open' | 'done'; requested_at: string; done_at: string | null;
  done_by_name: string | null; cleared: { messages?: number; media?: number }; notified_at: string | null; label: string; is_test: boolean;
}
export const SOCIAL_MODES: { value: SocialMode; label: string; note: string }[] = [
  { value: 'test', label: 'حسابات التجربة فقط', note: 'يرد المساعد على حسابات التجربة وحدها؛ رسائل غيرها تذهب للفريق.' },
  { value: 'live', label: 'الكل', note: 'يرد المساعد على كل من يراسل الصفحة أو حساب انستجرام.' },
  { value: 'standby', label: 'الكل مع وضع الاستعداد', note: 'ينتظر المساعد رد الفريق دقائق قبل أن يرد.' },
];
const MODE_LABELS: Record<string, string> = { off: 'متوقف', test: 'تجربة', shadow: 'بموافقة الفريق', licensed: 'يرد تلقائيًا' };
const SETUP_STEPS: Record<string, string> = { pages: 'الصفحة', 'app:page': 'اشتراك ماسنجر', 'app:instagram': 'اشتراك انستجرام', page: 'ربط الصفحة بالتطبيق', store: 'حفظ القنوات' };

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(sendError(/^(hub_[a-z_]+)/.exec(error.message)?.[1] ?? error.message));
  return data as T;
}

export function SocialPanel() {
  const toast = useToast();
  const [o, setO] = useState<Overview | null>(null);
  const [del, setDel] = useState<Deletion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [minutes, setMinutes] = useState('5');
  const [ask, setAsk] = useState<Deletion | null>(null);
  const [steps, setSteps] = useState<{ step: string; ok: boolean; code?: string | null }[] | null>(null);
  const load = useCallback(async () => {
    try {
      const ov = await rpc<Overview>('hub_social_overview');
      setO(ov);
      setMinutes(String(ov.unit?.standby_minutes ?? 5));
      setDel(ov.system_admin ? await rpc<Deletion[]>('hub_data_deletions_list') : null);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);
  if (err) return <ErrorBox error={err} />;
  if (!o) return <Loading />;
  if (!o.unit) return <p className="card p-4 text-sm text-ink-muted">وحدة «السوشيال» غير موجودة بعد.</p>;
  const u = o.unit;
  const admin = o.system_admin;

  async function save(p: Record<string, unknown>, label: string) {
    setBusy('save');
    try {
      const r = await rpc<{ batch_id: string; before: Record<string, unknown> }>('hub_social_save', { p });
      toast.undo(label, async () => {
        await rpc('hub_social_save', { p: r.before });
        await load();
      });
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function tester(id: string, on: boolean) {
    setBusy(`t:${id}`);
    try {
      await rpc('hub_social_tester_set', { p_identity: id, p_on: on });
      toast.undo(on ? 'أصبح الحساب حساب تجربة.' : 'لم يعد الحساب حساب تجربة.', async () => {
        await rpc('hub_social_tester_set', { p_identity: id, p_on: !on });
        await load();
      });
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function connect() {
    setBusy('setup');
    setSteps(null);
    try {
      const r = await api.edge<{ ok: boolean; error?: string; missing?: string[]; steps?: { step: string; ok: boolean; code?: string | null }[] }>('hub-admin', { action: 'meta_setup' });
      setSteps(r.steps ?? null);
      if (r.ok) toast('رُبطت الصفحة وحساب انستجرام بالتطبيق.');
      else toast(r.error === 'hub_meta_secrets' ? `مفاتيح ميتا ناقصة على الخادم: ${(r.missing ?? []).join('، ')}` : r.error === 'hub_meta_page' ? 'لم نجد الصفحة في مفتاح مستخدم النظام.' : 'تعذّر الربط؛ راجع الخطوات أدناه.', 'error');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function doDelete() {
    if (!ask) return;
    setBusy('del');
    try {
      const r = await dataDelete(ask.profile_id);
      if (!r.ok) toast(sendError(r.error), 'error');
      else {
        toast(r.notified && r.notified !== 'failed' ? 'حُذفت بيانات المحادثات وأُبلغ الضيف.' : 'حُذفت بيانات المحادثات.');
        setAsk(null);
      }
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4" data-social>
      <section className="card p-4 grid gap-3" data-social-unit>
        <h2 className="font-bold">{u.name_ar} — انستجرام وماسنجر</h2>
        <p className="text-sm text-ink-muted">المساعد نفسه بالمعرفة والقواعد نفسها. حالة الوحدة: <strong data-social-mode>{MODE_LABELS[u.mode] ?? u.mode}</strong>
          {u.mode === 'off' && ' — يشغّلها مدير النظام من «الإعدادات» بعد ربط القنوات.'}</p>
        <ul className="grid gap-1 text-sm" data-social-channels>
          {!o.channels.length && <li className="text-ink-muted">لا قنوات بعد: اضغط «ربط الصفحة وحساب انستجرام».</li>}
          {o.channels.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2" data-channel={c.kind}>
              <span className="inbox-chip">{channelLabel(c.kind)}</span>
              <span dir="auto">{c.display_name ?? '—'}</span>
              <span className="latin num text-xs text-ink-muted" dir="ltr">{c.address}</span>
              <span className={`text-xs ${c.verified_at ? 'text-ink-muted' : 'text-error'}`}>{c.verified_at ? `مربوط منذ ${riyadhDateTime(c.verified_at)}` : 'غير مربوط'}</span>
              <span className="text-xs">{c.sending_enabled ? 'الإرسال مفعّل' : 'الإرسال متوقف'}</span>
            </li>
          ))}
        </ul>
        {admin && (
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void connect()} disabled={!!busy} data-action="meta-setup">{busy === 'setup' && <Spinner />} ربط الصفحة وحساب انستجرام</button>
            <span className="text-xs text-ink-muted">يستخدم مفاتيح ميتا المحفوظة على الخادم فقط.</span>
          </div>
        )}
        {steps && (
          <ul className="grid gap-1 text-xs" data-setup-steps>
            {steps.map((s) => <li key={s.step} className={s.ok ? '' : 'text-error'}>{s.ok ? '✓' : '✗'} {SETUP_STEPS[s.step] ?? s.step}{s.code ? ` (${s.code})` : ''}</li>)}
          </ul>
        )}
      </section>

      <section className="card p-4 grid gap-3" data-social-audience>
        <h3 className="font-bold">جمهور الردود</h3>
        <div className="grid gap-2" role="radiogroup" aria-label="جمهور الردود">
          {SOCIAL_MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-2 text-sm min-h-8">
              <input type="radio" name="social-mode" className="mt-1 accent-bronze-deep" checked={u.social_mode === m.value} disabled={!admin || !!busy} data-no-dirty data-social-option={m.value}
                onChange={() => void save({ social_mode: m.value }, `جمهور الردود: ${m.label}`)} />
              <span><strong>{m.label}</strong><br /><span className="text-xs text-ink-muted">{m.note}</span></span>
            </label>
          ))}
        </div>
        {u.social_mode === 'standby' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">مدة الانتظار (دقائق)
              <input className="field w-24 num" inputMode="numeric" value={minutes} disabled={!admin || !!busy} onChange={(e) => setMinutes(west(e.target.value).trim())} data-no-dirty data-standby-minutes />
            </label>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!admin || !!busy || !/^([1-9]|[12][0-9]|30)$/.test(minutes) || Number(minutes) === u.standby_minutes}
              onClick={() => void save({ standby_minutes: Number(minutes) }, `مدة الانتظار ${minutes} دقائق`)} data-action="standby-save">حفظ المدة</button>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm min-h-8">
          <input type="checkbox" className="mt-1 size-4 accent-bronze-deep" checked={u.human_agent} disabled={!admin || !!busy} data-no-dirty data-human-agent
            onChange={(e) => void save({ human_agent: e.target.checked }, `Human Agent ${e.target.checked ? 'مفعّل' : 'متوقف'}`)} />
          <span><strong>Human Agent</strong> — رد الفريق حتى 7 أيام بعد آخر رسالة للضيف.<br /><span className="text-xs text-ink-muted">لا يُشغَّل إلا بعد موافقة ميتا على هذه الميزة في مراجعة التطبيق.</span></span>
        </label>
        {!admin && <p className="text-xs text-ink-muted">يغيّر هذه الإعدادات مدير النظام فقط.</p>}
      </section>

      <section className="card p-4 grid gap-2" data-social-accounts>
        <h3 className="font-bold">حسابات التجربة</h3>
        <p className="text-xs text-ink-muted">الحسابات التي راسلت الصفحة أو حساب انستجرام. في «حسابات التجربة فقط» يرد المساعد على المعلَّمة منها وحدها.</p>
        {!o.accounts.length ? <p className="text-sm text-ink-muted">لم يراسل أحد بعد.</p> : (
          <ul className="grid gap-1 text-sm">
            {o.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2" data-account={a.id} data-tester={a.tester ? 'yes' : 'no'}>
                <span className="min-w-0"><span className="inbox-chip">{channelLabel(a.kind)}</span> <span dir="auto">{a.name ?? a.username ?? 'حساب بلا اسم'}</span>
                  <span className="text-xs text-ink-muted"> · {riyadhDateTime(a.last_seen_at)}</span></span>
                {admin
                  ? <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void tester(a.id, !a.tester)} aria-pressed={a.tester} data-action="tester">{busy === `t:${a.id}` && <Spinner />} {a.tester ? '✓ حساب تجربة' : 'حساب تجربة'}</button>
                  : <span className="text-xs">{a.tester ? 'حساب تجربة' : ''}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {admin && del && (
        <section className="card p-4 grid gap-2" data-deletions>
          <h3 className="font-bold">طلبات حذف البيانات</h3>
          {!del.length ? <p className="text-sm text-ink-muted">لا طلبات.</p> : (
            <ul className="grid gap-2 text-sm">
              {del.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2" data-deletion={d.status}>
                  <span className="min-w-0">
                    <strong dir="auto">{d.label}</strong> · {d.channel_kind ? channelLabel(d.channel_kind) : d.via === 'staff' ? 'من اللوحة' : '—'} · <span className="num">{riyadhDateTime(d.requested_at)}</span>
                    {d.status === 'done' && <span className="text-xs text-ink-muted"> · حُذفت {d.done_by_name ? `بواسطة ${d.done_by_name}` : ''} <span className="num">{d.done_at ? riyadhDateTime(d.done_at) : ''}</span> · رسائل: <span className="num">{d.cleared?.messages ?? 0}</span>{d.notified_at ? ' · أُبلغ الضيف' : ''}</span>}
                    {d.is_test && <span className="inbox-chip is-test">تجربة</span>}
                  </span>
                  {d.status === 'open' && <button type="button" className="btn btn-ghost btn-sm text-error" disabled={!!busy} onClick={() => setAsk(d)} data-action="data-delete">حذف بيانات المحادثات</button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <Confirm open={!!ask} title="حذف بيانات المحادثات" danger busy={busy === 'del'} onClose={() => setAsk(null)} confirmLabel="حذف بيانات المحادثات" onConfirm={() => void doDelete()}>
        <p className="text-sm">تُحذف نصوص كل محادثات هذا الضيف ووسائطها على كل القنوات، ولا يمكن استرجاعها. تبقى الحجوزات والطلبات كما هي، ويُبلغ الضيف إذا كانت نافذة الرد مفتوحة.</p>
      </Confirm>
    </div>
  );
}
