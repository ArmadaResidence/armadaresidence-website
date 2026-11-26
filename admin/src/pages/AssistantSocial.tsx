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
import { CancelButton, Confirm, ErrorBox, Loading, Modal, Spinner, useToast } from '../components/ui';
import { channelLabel, dataDelete, sendError } from '../lib/inbox';
import { withTimeout } from '../lib/errors';
import { KIND_LABELS, commentSettings, setSwitches, type CommentSettings } from '../lib/comments';

type SocialMode = 'test' | 'live' | 'standby';
interface Overview {
  unit: { id: string; key: string; name_ar: string; mode: string; social_mode: SocialMode; standby_minutes: number; human_agent: boolean; status: string } | null;
  channels: { id: string; kind: string; address: string; display_name: string | null; connected: boolean; verified_at: string | null; sending_enabled: boolean;
    /** S2e: the channel's own audience (NULL = the unit's) and the one in force */
    social_mode?: SocialMode | null; audience?: SocialMode }[];
  accounts: { id: string; kind: string; name: string | null; username: string | null; tester: boolean; last_seen_at: string }[];
  system_admin: boolean;
}
interface Deletion {
  id: string; profile_id: string; channel_kind: string | null; via: string; status: 'open' | 'done'; requested_at: string; done_at: string | null;
  done_by_name: string | null; cleared: { messages?: number; media?: number }; notified_at: string | null; label: string; is_test: boolean;
}
export const SOCIAL_MODES: { value: SocialMode; label: string; note: string }[] = [
  { value: 'test', label: 'حسابات التجربة فقط', note: 'يرد المساعد على حسابات التجربة وحدها؛ رسائل غيرها وتعليقاتها تُسجَّل فقط: بلا رد ولا تنبيه ولا إيميل، ويرد عليها فريق السوشيال من Meta Business Suite.' },
  { value: 'live', label: 'الكل', note: 'يرد المساعد على كل من يراسل الصفحة أو حساب انستجرام.' },
  { value: 'standby', label: 'الكل مع وضع الاستعداد', note: 'ينتظر المساعد رد الفريق دقائق قبل أن يرد.' },
];
const audienceError = (m: string) =>
  /hub_system_admin_only/.test(m) ? 'يغيّر الجمهور مدير النظام فقط.' : /nothing to change/.test(m) ? 'لا تغيير: هذا هو الجمهور الحالي.' : /not_found/.test(m) ? 'لم نجد هذه القناة.' : 'تعذّر حفظ الجمهور.';
const MODE_LABELS: Record<string, string> = { off: 'متوقف', test: 'تجربة', shadow: 'بموافقة الفريق', licensed: 'يرد تلقائيًا' };
const SETUP_STEPS: Record<string, string> = {
  pages: 'الصفحة', 'app:page': 'اشتراك ماسنجر', 'app:instagram': 'اشتراك انستجرام', page: 'ربط الصفحة بالتطبيق', store: 'حفظ القنوات',
  // S2: the comment subscriptions (their own steps — a missing Meta permission shows ✗ here and never stops the messages)
  'app:page:comments': 'اشتراك تعليقات فيسبوك', 'app:instagram:comments': 'اشتراك تعليقات انستجرام', 'page:comments': 'ربط تعليقات الصفحة بالتطبيق',
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // S2 (26 Nov 2026): never a silent press — no answer in 20 s is an error on the screen
  const { data, error } = await withTimeout(Promise.resolve(supabase.rpc(fn, args)));
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
  // S2e (Ahmed's §6 «Settings per channel»): a channel's own audience, or «مثل الوحدة»
  async function audience(id: string, mode: SocialMode | null, before: SocialMode | null, label: string) {
    setBusy(`a:${id}`);
    try {
      await rpc('hub_channel_audience_set', { p_channel: id, p_mode: mode });
      toast.undo(label, async () => {
        await rpc('hub_channel_audience_set', { p_channel: id, p_mode: before });
        await load();
      });
      await load();
    } catch (e) {
      toast(audienceError((e as Error).message), 'error');
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
      const r = await api.edge<{ ok: boolean; comments_ok?: boolean; error?: string; missing?: string[]; steps?: { step: string; ok: boolean; code?: string | null }[] }>('hub-admin', { action: 'meta_setup' });
      setSteps(r.steps ?? null);
      if (r.ok && r.comments_ok === false) toast('رُبطت الرسائل، لكن اشتراك التعليقات لم يكتمل؛ راجع الخطوات أدناه.', 'error');
      else if (r.ok) toast('رُبطت الصفحة وحساب انستجرام بالتطبيق.');
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
      const r = await withTimeout(dataDelete(ask.profile_id));
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
            {steps.map((s) => <li key={s.step} className={s.ok ? '' : 'text-error'}>{s.ok ? '✓' : '✗'} {SETUP_STEPS[s.step] ?? s.step}{s.code === 'not_listed' ? ' (لم يظهر الحقل في اشتراكات التطبيق لدى ميتا)' : s.code ? ` (${s.code})` : ''}</li>)}
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
        {!!o.channels.length && (
          <div className="grid gap-2 border-t border-line pt-3" data-channel-audience>
            <p className="text-sm font-semibold">جمهور كل قناة</p>
            <p className="text-xs text-ink-muted">«مثل الوحدة» يتبع الاختيار أعلاه؛ أي اختيار آخر يخص هذه القناة وحدها.</p>
            {o.channels.map((c) => {
              const own = c.social_mode ?? null;
              return (
                <label key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-sm" data-channel-audience-row={c.kind}>
                  <span className="min-w-0 truncate">{channelLabel(c.kind)}{c.display_name ? ` — ${c.display_name}` : ''}</span>
                  <select className="field min-h-11 w-56 max-w-full" value={own ?? 'unit'} disabled={!admin || !!busy} data-no-dirty data-channel-audience-select={c.kind}
                    aria-label={`جمهور ${channelLabel(c.kind)}`}
                    onChange={(e) => {
                      const v = e.target.value === 'unit' ? null : (e.target.value as SocialMode);
                      const lab = v ? SOCIAL_MODES.find((m) => m.value === v)?.label ?? v : 'مثل الوحدة';
                      void audience(c.id, v, own, `جمهور ${channelLabel(c.kind)}: ${lab}`);
                    }}>
                    <option value="unit">مثل الوحدة ({SOCIAL_MODES.find((m) => m.value === u.social_mode)?.label ?? u.social_mode})</option>
                    {SOCIAL_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        )}
        {(u.social_mode === 'standby' || o.channels.some((c) => c.audience === 'standby')) && (
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

      <SocialTeam />
      <CommentSwitches />
      <section className="card p-4 grid gap-2" data-social-accounts>
        <h3 className="font-bold">حسابات التجربة</h3>
        <p className="text-xs text-ink-muted">الحسابات التي راسلت الصفحة أو حساب انستجرام. في «حسابات التجربة فقط» يرد المساعد على المعلَّمة منها وحدها.</p>
        {!o.accounts.length ? <p className="text-sm text-ink-muted">لم يراسل أحد بعد.</p> : (
          <ul className="grid gap-1 text-sm">
            {o.accounts.map((a) => (
              <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" data-account={a.id} data-tester={a.tester ? 'yes' : 'no'}>
                {/* S2a: the name wraps in its own column and the button keeps its place, on every row and every width */}
                <span className="min-w-0 break-words"><span className="inbox-chip">{channelLabel(a.kind)}</span> <span dir="auto">{a.name ?? a.username ?? 'حساب بلا اسم'}</span>
                  <span className="text-xs text-ink-muted"> · {riyadhDateTime(a.last_seen_at)}</span></span>
                {admin
                  ? <button type="button" className="btn btn-ghost btn-sm whitespace-nowrap" disabled={!!busy} onClick={() => void tester(a.id, !a.tester)} aria-pressed={a.tester} data-action="tester">{busy === `t:${a.id}` && <Spinner />} {a.tester ? '✓ حساب تجربة' : 'حساب تجربة'}</button>
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

/** S2 (26 Nov 2026): «التعليقات» and «الرسائل الخاصة» per account — both OFF; the system admin's, with «تراجع».
 *  «التعليقات» cannot go on before Ahmed's approved public reply texts exist (SOCIAL-SPEC.md §8). */
function CommentSwitches() {
  const toast = useToast();
  const [s, setS] = useState<CommentSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setS(await commentSettings());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);
  if (err) return <ErrorBox error={err} />;
  if (!s) return null;
  async function flip(id: string, comments: boolean, priv: boolean, label: string, which: 'c' | 'p' = 'c') {
    setBusy(which === 'p' ? `${id}:p` : id);
    try {
      const r = await setSwitches(id, comments, priv);
      toast.undo(label, async () => {
        await setSwitches(id, r.before.comments, r.before.private);
        await load();
      });
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card p-4 grid gap-3" data-comment-switches data-tour="social-comments">
      <h3 className="font-bold">التعليقات</h3>
      <p className="text-xs text-ink-muted">الرد على التعليقات العامة تحت منشورات انستجرام وفيسبوك: رد علني قصير بنص معتمد بلا أسعار، ورسالة خاصة واحدة للأسئلة، والشكاوى للفريق، والتعليقات المزعجة للمراجعة. لا يُخفى أو يُحذف شيء تلقائيًا. يتبع وضع الوحدة وجمهورها («حسابات التجربة فقط» الآن).</p>
      {!s.texts_ready && (
        <p className="note-amber text-sm" role="note" data-texts-missing>لم تُعتمد نصوص الردود العامة بعد، فلا يمكن تشغيل «التعليقات». الناقص: <span className="num">{s.texts_missing.length}</span></p>
      )}
      <ul className="grid gap-2 text-sm">
        {s.channels.map((c) => (
          <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" data-comment-channel={c.kind}>
            <span className="min-w-0 break-words"><span className="inbox-chip">{KIND_LABELS[c.kind]}</span> <span dir="auto">{c.name ?? ''}</span></span>
            <span className="flex flex-wrap gap-2 justify-end">
              {s.system_admin ? (
                <>
                  <button type="button" className="btn btn-ghost btn-sm whitespace-nowrap" aria-pressed={c.comments_on} disabled={!!busy || (!c.comments_on && !s.texts_ready)} data-action="comments-switch"
                    onClick={() => void flip(c.id, !c.comments_on, c.comments_on ? false : c.private_on, c.comments_on ? 'أُوقفت التعليقات لهذا الحساب.' : 'شُغّلت التعليقات لهذا الحساب.')}>
                    {busy === c.id && <Spinner />} {c.comments_on ? '✓ التعليقات' : 'التعليقات'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm whitespace-nowrap" aria-pressed={c.private_on} disabled={!!busy || !c.comments_on} data-action="private-switch"
                    title={!c.comments_on ? 'شغّل «التعليقات» أولًا لهذا الحساب.' : undefined}
                    onClick={() => void flip(c.id, c.comments_on, !c.private_on, c.private_on ? 'أُوقفت الرسائل الخاصة للمعلّقين.' : 'شُغّلت الرسائل الخاصة للمعلّقين.', 'p')}>
                    {busy === `${c.id}:p` && <Spinner />} {c.private_on ? '✓ الرسائل الخاصة' : 'الرسائل الخاصة'}
                  </button>
                </>
              ) : (
                <span className="text-xs" data-comment-state>{c.comments_on ? (c.private_on ? 'التعليقات والرسائل الخاصة تعمل' : 'التعليقات تعمل') : 'التعليقات متوقفة'}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {s.system_admin && s.channels.some((c) => !c.comments_on) && (
        <p className="text-xs text-ink-muted" data-private-note>«الرسائل الخاصة» تعمل بعد تشغيل «التعليقات» للحساب نفسه.</p>
      )}
    </section>
  );
}

type TeamMember = { id: string; name: string; has_number: boolean };
type TeamView = { members: TeamMember[]; candidates: TeamMember[]; system_admin: boolean };
const teamError = (m: string) =>
  /hub_system_admin_only/.test(m) ? 'يغيّر فريق السوشيال مدير النظام فقط.' : /hub_social_team_empty/.test(m) ? 'اختر عضوًا واحدًا على الأقل.'
    : /hub_social_team_member/.test(m) ? 'كل عضو يجب أن يكون من فريق وحدة «السوشيال» وليس حساب استقبال.' : /nothing to change/.test(m) ? 'لا تغيير.' : m;

/** S3 (Ahmed, 26 Nov 2026 — S8): who gets the hand-offs of «السوشيال». Reception has no role in the social channels. */
function SocialTeam() {
  const toast = useToast();
  const [t, setT] = useState<TeamView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setT(await rpc<TeamView>('hub_social_team_get'));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);
  if (err) return <ErrorBox error={err} />;
  if (!t) return null;
  async function save() {
    setBusy(true);
    try {
      const r = await rpc<{ before: string[] }>('hub_social_team_set', { p_staff: pick });
      setOpen(false);
      toast.undo('حُفظ فريق السوشيال.', async () => {
        await rpc('hub_social_team_set', { p_staff: r.before });
        await load();
      });
      await load();
    } catch (e) {
      toast(teamError((e as Error).message), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card p-4 grid gap-2" data-social-team data-tour="social-team">
      <h3 className="font-bold">فريق السوشيال</h3>
      <p className="text-xs text-ink-muted">تصلهم كل تحويلات انستجرام وماسنجر والتعليقات: تنبيه واتساب على رقمهم في «التقارير» وإيميل على بريد الدخول. لا يصل الاستقبال شيء منها؛ طلب الحجز وحده يصل استقبال الفرع الذي اختاره الضيف.</p>
      {!t.members.length ? <p className="text-sm text-error" data-team-empty>لا أحد في الفريق: تصل الإيميلات لمدير النظام ولا يصل تنبيه واتساب.</p> : (
        <ul className="grid gap-1 text-sm">
          {t.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2" data-team-member>
              <span dir="auto">{m.name}</span>
              <span className={`text-xs ${m.has_number ? 'text-ink-muted' : 'text-error'}`}>{m.has_number ? 'تنبيه واتساب وإيميل' : 'إيميل فقط: لا رقم له في «التقارير»'}</span>
            </li>
          ))}
        </ul>
      )}
      {t.system_admin && (
        <button type="button" className="btn btn-ghost btn-sm justify-self-start" disabled={busy} data-action="social-team-edit"
          onClick={() => { setPick(t.members.map((m) => m.id)); setOpen(true); }}>تعديل الفريق</button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="فريق السوشيال" busy={busy}>
        <p className="text-sm text-ink-muted mb-3">من أعضاء وحدة «السوشيال»، بلا حسابات الاستقبال.</p>
        <ul className="grid gap-2 text-sm">
          {t.candidates.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 min-h-11">
                <input type="checkbox" className="size-4 accent-bronze-deep" checked={pick.includes(c.id)} data-team-pick={c.id}
                  onChange={(e) => setPick((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                <span dir="auto">{c.name}</span>
                {!c.has_number && <span className="text-xs text-ink-muted">(لا رقم في «التقارير»)</span>}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 justify-end mt-5 dialog-actions">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" disabled={busy || !pick.length} onClick={() => void save()} data-action="confirm-go">
            {busy ? <Spinner /> : null} حفظ الفريق
          </button>
        </div>
      </Modal>
    </section>
  );
}
