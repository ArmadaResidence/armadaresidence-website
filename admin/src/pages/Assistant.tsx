// «إعدادات المساعد» — Guest Hub «مركز الضيوف», session H1 (13 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §5.6 items 1,
// 2 «الفريق» and «المفاتيح», 3, 6 and 9; DECISIONS.md 2026-11-13 «Guest Hub H1 — foundations»). The shell of the
// assistant's settings, before any assistant exists:
//   - «الوحدات»: the four units (the lobby café and the rooftop shown «مخفية»), their channel (the number, its WABA,
//     «تحقق من القناة» — YCloud read through hub-admin: quality and messaging limit), each unit's team («تعديل الفريق»,
//     the shared Modal and its dirty guard) and its mode (off · test · shadow · licensed) with what it still lacks —
//     every mode but «متوقف» is refused by the server in H1, and the page says so before asking it;
//   - «المفاتيح العامة»: «المساعد يعمل» (refused until the engine exists) and «تخزين المحادثات» (may be switched on
//     since H2, 13 Nov 2026 — off until Ahmed switches it), with the same note;
//   - «استقبال واتساب» (H2): the events of the one YCloud webhook and, for the system admin only, «تحديث أحداث
//     الاستقبال» (hub-admin update_webhook_events: adds the echo and quality events, never removes one);
//   - «قوالب واتساب»: «تحديث حالة القوالب» (YCloud read) and the table of hub_templates;
//   - «ملخص الصباح»: the recipients of the morning summary (scope hub_summary) — an address is active only once its
//     mailbox filter is confirmed (CLAUDE.md §8); a page-level form with its own «حفظ»;
//   - «التنبيهات»: the open alerts of hub_alerts (none in H1).
// Every change is one audited batch with the 30 s «تراجع» toast (the YCloud reads mirror YCloud and are not undone).
// assistant: view sees everything read-only; edit changes it; the channels, templates, switches and recipients need
// every branch (a single-branch editor sees its branch's units only).
import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { BRANCH_NAMES, ROLE_LABELS, riyadhDateTime } from '../lib/format';
import {
  ALERT_LABELS, CATEGORY_LABELS, EMAIL_RE, KIND_LABELS, LANGUAGE_LABELS, MODES, MODE_LABELS, NOT_YET, STATUS_LABELS, SWITCHES, WEBHOOK_EVENTS, eligible, gateText, gatesOf,
  membersSet, modeSet, overview, phoneText, qualityText, recipientsSet, refreshTemplates, settingSet, templateStatus, unitSave, updateWebhookEvents, verifyChannel, verifyError,
  webhookError, webhookStatus, type HubOverview, type HubUnit, type UnitMode, type WebhookStatus,
} from '../lib/hub';
import { CancelButton, DirtyScope, ErrorBox, Field, Loading, Modal, Spinner, useToast } from '../components/ui';

type Row = { id?: string; email: string; active: boolean; filter_confirmed: boolean };

export default function Assistant() {
  const toast = useToast();
  const [o, setO] = useState<HubOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [team, setTeam] = useState<HubUnit | null>(null);
  const [naming, setNaming] = useState<HubUnit | null>(null);
  const [blocked, setBlocked] = useState<{ title: string; gates: string[] } | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [hook, setHook] = useState<WebhookStatus | null>(null);

  const load = async () => {
    try {
      setError(null);
      setO(await overview());
      // the webhook's events: shown when the server answers (an older server without the RPC simply hides the card)
      setHook(await webhookStatus().catch(() => null));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const edit = !!o?.can_edit;
  const global = edit && !!o?.all_branches;

  /** after a saved change: reload and offer «تراجع» */
  async function after(batch: string, label: string) {
    toast.undo(label, async () => {
      await api.revertBatch(batch);
      await load();
    });
    await load();
  }

  async function setMode(u: HubUnit, mode: UnitMode) {
    if (mode === u.mode) return;
    if (mode !== 'off' && u.gates.length) {
      setBlocked({ title: `لا يُشغَّل المساعد في ${u.name_ar} الآن`, gates: u.gates });
      return;
    }
    setBusy(`mode:${u.id}`);
    try {
      const r = await modeSet(u.id, mode);
      await after(r.batch_id, `${u.name_ar} — ${MODE_LABELS[mode]}`);
    } catch (e) {
      const g = gatesOf(e);
      if (g) setBlocked({ title: `لا يُشغَّل المساعد في ${u.name_ar} الآن`, gates: g });
      else toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function setSwitch(key: string, label: string, on: boolean, gates: string[]) {
    if (on && gates.length) {
      setBlocked({ title: `لا يُشغَّل «${label}» الآن`, gates });
      return;
    }
    setBusy(`switch:${key}`);
    try {
      const r = await settingSet(key, on);
      await after(r.batch_id, `${label} — ${on ? 'يعمل' : 'متوقف'}`);
    } catch (e) {
      const g = gatesOf(e);
      if (g) setBlocked({ title: `لا يُشغَّل «${label}» الآن`, gates: g });
      else toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function verify(u: HubUnit, channelId: string) {
    setBusy(`verify:${channelId}`);
    try {
      const r = await verifyChannel(channelId);
      if (!r.ok) toast(verifyError(r.error), 'error');
      else toast(`تم التحقق من قناة ${u.name_ar} — الجودة: ${qualityText(r.quality_rating ?? null)}، حد الرسائل: ${r.messaging_limit ?? 'غير معروف'}`);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function addWebhookEvents() {
    setBusy('webhook');
    try {
      const r = await updateWebhookEvents();
      if (!r.ok) toast(webhookError(r.error), 'error');
      else if (r.unchanged) toast('الأحداث الأربعة مفعّلة بالفعل في YCloud — لم يتغير شيء.');
      else toast('أُضيف حدثا «الردود من جوال الفرع» و«جودة الرقم» إلى استقبال واتساب، وبقيت الأحداث السابقة كما هي.');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy('templates');
    try {
      const r = await refreshTemplates();
      const n = r.results.reduce((s, x) => s + (x.count ?? 0), 0);
      if (r.ok) toast(`حُدّثت حالة القوالب من YCloud (${n} قالبًا مع لغاته).`);
      else toast('حُدّث بعض القوالب وتعذّر الباقي، أعد المحاولة بعد قليل.', 'error');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (!o) {
    return (
      <div className="grid gap-5 max-w-5xl">
        <h1 className="text-2xl font-bold">إعدادات المساعد</h1>
        <ErrorBox error={error} />
        {!error && <Loading />}
      </div>
    );
  }

  const unitName = (key: string | null) => o.units.find((u) => u.key === key)?.name_ar ?? key ?? 'كل الوحدات';

  return (
    <div className="grid gap-5 max-w-5xl" data-page="assistant">
      <div>
        <h1 className="text-2xl font-bold">إعدادات المساعد</h1>
        <p className="text-sm text-ink-muted mt-1">
          وحدات «مركز الضيوف» وفرقها وقنواتها ومفاتيحها. {o.can_edit ? '' : 'صلاحيتك هنا للعرض فقط.'}
        </p>
        <p className="note-amber text-sm mt-3" role="note" data-hub-not-yet>{NOT_YET}</p>
      </div>
      <ErrorBox error={error} />

      {/* ── المفاتيح العامة ── */}
      <section className="card p-4" aria-labelledby="hub-switches-h" data-tour="hub-switches" data-hub-switches>
        <h2 id="hub-switches-h" className="font-bold text-lg mb-3">المفاتيح العامة</h2>
        <ul className="grid gap-3">
          {SWITCHES.map((s) => {
            const on = o.settings[s.key] === true;
            const gates = o.switch_gates[s.key] ?? [];
            return (
              <li key={s.key} className="grid gap-1 border-b border-line last:border-0 pb-3 last:pb-0" data-switch={s.key}>
                <label className="flex items-center justify-between gap-3 min-h-11">
                  <span className="font-semibold">{s.label}</span>
                  <span className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${on ? 'text-ok' : 'text-ink-muted'}`} data-switch-state>{on ? 'يعمل' : 'متوقف'}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      className="size-5 accent-bronze-deep"
                      checked={on}
                      aria-checked={on}
                      aria-label={s.label}
                      disabled={!global || busy !== null}
                      onChange={(e) => setSwitch(s.key, s.label, e.target.checked, gates)}
                      data-switch-input={s.key}
                    />
                  </span>
                </label>
                <p className="text-xs text-ink-muted">{s.text}</p>
                {!on && gates.length > 0 && (
                  <p className="text-xs text-ink-muted" data-switch-gates={s.key}>قبل التشغيل ينقص: {gates.map(gateText).join('، ')}.</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── استقبال واتساب (H2) ── */}
      {hook && (
        <section className="card p-4 grid gap-3" aria-labelledby="hub-webhook-h" data-tour="hub-webhook" data-hub-webhook>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="hub-webhook-h" className="font-bold text-lg">استقبال واتساب</h2>
            {hook.system_admin && hook.registered && WEBHOOK_EVENTS.some((e) => !hook.events.includes(e.key)) && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={addWebhookEvents} data-action="webhook-events">
                {busy === 'webhook' && <Spinner />} تحديث أحداث الاستقبال
              </button>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            ما يصل من واتساب إلى عنوان الاستقبال الوحيد في YCloud (المسجَّل في «عروض إياب على واتساب»). الزر يضيف الحدثين الجديدين فقط ولا يحذف أي حدث، ويظهر لمدير النظام وحده.
          </p>
          {!hook.registered ? (
            <p className="text-sm text-ink-muted" data-webhook-none>استقبال ردود واتساب غير مسجَّل بعد.</p>
          ) : (
            <ul className="grid gap-1 text-sm" data-webhook-events>
              {WEBHOOK_EVENTS.map((e) => {
                const on = hook.events.includes(e.key);
                return (
                  <li key={e.key} className="flex flex-wrap items-center gap-2" data-webhook-event={e.key} data-on={on ? 'yes' : 'no'}>
                    <span className={`font-semibold ${on ? 'text-ok' : 'text-ink-muted'}`}>{on ? 'مفعّل' : 'غير مفعّل'}</span>
                    <span>{e.label}</span>
                    <span className="latin text-xs text-ink-muted" dir="ltr">{e.key}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ── الوحدات ── */}
      <section className="grid gap-4" aria-labelledby="hub-units-h" data-tour="hub-units">
        <h2 id="hub-units-h" className="font-bold text-lg">الوحدات</h2>
        {o.units.map((u) => (
          <article key={u.id} className="card p-4 grid gap-3" aria-labelledby={`hub-unit-${u.key}`} data-unit={u.key} data-unit-status={u.status}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id={`hub-unit-${u.key}`} className="font-bold text-lg">
                  {u.kind === 'dining' && u.venue ? u.venue.name_ar : u.name_ar}
                  <span className={`ms-2 text-xs font-semibold ${u.status === 'active' ? 'text-ok' : 'text-ink-muted'}`} data-unit-chip>{STATUS_LABELS[u.status]}</span>
                </h3>
                <p className="text-xs text-ink-muted">
                  {KIND_LABELS[u.kind]} · {BRANCH_NAMES[u.branch] ?? u.branch}
                  {u.kind === 'dining' && (u.venue ? ` · المكان في «المطاعم والمقاهي»: ${u.venue.status === 'active' ? 'منشور' : u.venue.status === 'coming_soon' ? 'قريبًا' : 'مخفي'}` : ' · لم يُربط بمكان')}
                </p>
              </div>
              {edit && u.kind === 'branch' && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNaming(u)} data-action="unit-name">تعديل الاسم</button>
              )}
            </div>

            {/* the channel */}
            <div className="grid gap-1" data-unit-channel>
              <h4 className="label">القناة</h4>
              {u.channels.length === 0 ? (
                <p className="text-sm text-ink-muted">بلا رقم واتساب بعد{u.status === 'hidden' ? ' — تُربط القناة عند تشغيل الوحدة' : ''}.</p>
              ) : (
                u.channels.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2" data-channel={c.address}>
                    <div className="text-sm min-w-0">
                      <span className="latin font-semibold" dir="ltr">{phoneText(c.address)}</span>
                      {c.display_name && <span className="ms-2">{c.display_name}</span>}
                      <div className="text-xs text-ink-muted num-ar">
                        {c.connected ? 'متصلة' : 'غير متصلة'} ·{' '}
                        {c.verified_at ? `تم التحقق ${riyadhDateTime(c.verified_at)} · الجودة: ${qualityText(c.quality_rating)} · حد الرسائل: ${c.messaging_limit ?? 'غير معروف'}` : 'لم يتم التحقق بعد'}
                        {' · '}الإرسال من المركز: {c.sending_enabled ? 'مفعّل' : 'متوقف'}
                      </div>
                      {c.waba_id && <div className="text-xs text-ink-muted">حساب واتساب للأعمال: <span className="latin" dir="ltr">{c.waba_id}</span></div>}
                    </div>
                    {global && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => verify(u, c.id)} data-action="channel-verify" data-tour="hub-verify">
                        {busy === `verify:${c.id}` && <Spinner />} تحقق من القناة
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* the team */}
            <div className="grid gap-1" data-unit-team data-tour="hub-team">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="label">الفريق</h4>
                {edit && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTeam(u)} data-action="team-edit">تعديل الفريق</button>
                )}
              </div>
              {u.members.length ? (
                <ul className="flex flex-wrap gap-2" data-members>
                  {u.members.map((m) => (
                    <li key={m.staff_id} className="text-sm rounded-full border border-line px-3 py-1" data-member={m.staff_id}>
                      {m.full_name} <span className="text-xs text-ink-muted">({ROLE_LABELS[m.role] ?? m.role}{m.active ? '' : '، موقوف'})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-muted">لا أحد في فريق هذه الوحدة بعد — لا يرى محادثاتها أحد.</p>
              )}
            </div>

            {/* the mode */}
            <div className="grid gap-2" data-unit-mode={u.mode} data-tour="hub-mode">
              <h4 className="label" id={`hub-mode-${u.key}`}>وضع المساعد</h4>
              <div className="segmented flex-wrap w-fit max-w-full" role="radiogroup" aria-labelledby={`hub-mode-${u.key}`}>
                {MODES.map((m) => (
                  <button
                    type="button"
                    key={m}
                    role="radio"
                    aria-checked={m === u.mode}
                    className={`seg ${m === u.mode ? 'is-on' : ''}`}
                    disabled={!edit || busy !== null}
                    onClick={() => setMode(u, m)}
                    data-mode={m}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
              {u.gates.length > 0 && (
                <p className="text-xs text-ink-muted" data-unit-gates>قبل التشغيل ينقص: {u.gates.map(gateText).join('، ')}.</p>
              )}
            </div>
          </article>
        ))}
      </section>

      {/* ── قوالب واتساب ── */}
      <section className="card p-4 grid gap-3" aria-labelledby="hub-templates-h" data-tour="hub-templates" data-hub-templates>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="hub-templates-h" className="font-bold text-lg">قوالب واتساب</h2>
          {global && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={refresh} data-action="templates-refresh">
              {busy === 'templates' && <Spinner />} تحديث حالة القوالب
            </button>
          )}
        </div>
        <p className="text-xs text-ink-muted">القوالب المعتمدة من Meta لكل رقم كما يعرضها YCloud. القراءة فقط — لا يُنشأ قالب أو يُعدَّل من هنا. لن يرسل المركز إلا قالبًا حالته «معتمد» على رقمه.</p>
        {o.templates.length === 0 ? (
          <p className="text-sm text-ink-muted" data-templates-empty>لم تُقرأ القوالب بعد{global ? ' — اضغط «تحديث حالة القوالب».' : '.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-templates>
              <thead>
                <tr className="text-start text-ink-muted">
                  <th className="text-start font-semibold py-2 pe-3">الرقم</th>
                  <th className="text-start font-semibold py-2 pe-3">القالب</th>
                  <th className="text-start font-semibold py-2 pe-3">اللغة</th>
                  <th className="text-start font-semibold py-2 pe-3">الفئة</th>
                  <th className="text-start font-semibold py-2 pe-3">الحالة</th>
                  <th className="text-start font-semibold py-2">آخر قراءة</th>
                </tr>
              </thead>
              <tbody>
                {o.templates.map((t) => (
                  <tr key={`${t.channel_id}:${t.name}:${t.language}`} className="border-t border-line" data-template={`${t.unit}:${t.name}:${t.language}`} data-template-status={t.status}>
                    <td className="py-2 pe-3">{unitName(t.unit)}</td>
                    <td className="py-2 pe-3"><span className="latin" dir="ltr">{t.name}</span></td>
                    <td className="py-2 pe-3">{LANGUAGE_LABELS[t.language] ?? t.language}</td>
                    <td className="py-2 pe-3">{t.category ? CATEGORY_LABELS[t.category] ?? t.category : '—'}</td>
                    <td className={`py-2 pe-3 font-semibold ${t.status === 'APPROVED' ? 'text-ok' : t.status === 'REJECTED' || t.status === 'PAUSED' || t.status === 'DISABLED' ? 'text-error' : ''}`}>
                      {templateStatus(t.status)}
                    </td>
                    <td className="py-2 num-ar">{riyadhDateTime(t.read_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── ملخص الصباح ── */}
      {o.recipients !== null && <Summary o={o} edit={global} onSaved={after} />}

      {/* ── التنبيهات ── */}
      <section className="card p-4 grid gap-2" aria-labelledby="hub-alerts-h" data-tour="hub-alerts" data-hub-alerts>
        <h2 id="hub-alerts-h" className="font-bold text-lg">التنبيهات</h2>
        {o.alerts.length === 0 ? (
          <p className="text-sm text-ink-muted" data-alerts-empty>لا تنبيهات مفتوحة.</p>
        ) : (
          <ul className="grid gap-2">
            {o.alerts.map((a) => (
              <li key={a.id} className="text-sm" data-alert={a.kind}>
                {ALERT_LABELS[a.kind] ?? a.kind} — {unitName(a.unit)} <span className="text-xs text-ink-muted num-ar">{riyadhDateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={!!team} onClose={() => setTeam(null)} title={team ? `فريق ${team.kind === 'dining' && team.venue ? team.venue.name_ar : team.name_ar}` : ''} draftKey={team ? `hub-team:${team.id}` : undefined} busy={formBusy}>
        {team && (
          <TeamForm
            key={team.id}
            unit={team}
            staff={eligible(o.staff, team)}
            busy={formBusy}
            setBusy={setFormBusy}
            onSaved={async (batch) => {
              const name = team.name_ar;
              setTeam(null);
              await after(batch, `حُفظ فريق ${name}`);
            }}
          />
        )}
      </Modal>

      <Modal open={!!naming} onClose={() => setNaming(null)} title={naming ? `اسم ${naming.name_ar}` : ''} draftKey={naming ? `hub-name:${naming.id}` : undefined} busy={formBusy}>
        {naming && (
          <NameForm
            key={naming.id}
            unit={naming}
            busy={formBusy}
            setBusy={setFormBusy}
            onSaved={async (batch, name) => {
              setNaming(null);
              await after(batch, `حُفظ اسم الوحدة «${name}»`);
            }}
          />
        )}
      </Modal>

      <Modal open={!!blocked} onClose={() => setBlocked(null)} title={blocked?.title ?? ''}>
        {blocked && (
          <div className="grid gap-3" data-hub-blocked>
            <p className="text-sm">ينقص قبل التشغيل:</p>
            <ul className="list-disc ps-5 text-sm">
              {blocked.gates.map((g) => <li key={g} data-gate={g}>{gateText(g)}</li>)}
            </ul>
            <p className="text-xs text-ink-muted">{NOT_YET}</p>
            <div className="flex justify-end">
              <CancelButton label="إغلاق" />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TeamForm({ unit, staff, busy, setBusy, onSaved }: { unit: HubUnit; staff: HubOverview['staff']; busy: boolean; setBusy: (b: boolean) => void; onSaved: (batch: string) => Promise<void> }) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(unit.members.map((m) => m.staff_id)));
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string, on: boolean) => setChosen((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  async function save() {
    setError(null);
    setBusy(true);
    try {
      const r = await membersSet(unit.id, [...chosen]);
      setBusy(false);
      await onSaved(r.batch_id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4" data-team-form>
      <p className="text-sm text-ink-muted">فريق الوحدة وحده يرى محادثاتها ويرد عليها. يظهر هنا من نطاقه فرع الوحدة أو كل الفروع.</p>
      <fieldset className="grid gap-1">
        <legend className="sr-only">أعضاء الفريق</legend>
        {staff.map((s) => (
          <label key={s.staff_id} className="flex items-center gap-3 text-sm min-h-11">
            <input type="checkbox" className="size-4 accent-bronze-deep" checked={chosen.has(s.staff_id)} disabled={busy} onChange={(e) => toggle(s.staff_id, e.target.checked)} data-team-member={s.staff_id} />
            <span>{s.full_name}</span>
            <span className="text-xs text-ink-muted">{ROLE_LABELS[s.role] ?? s.role} · {s.branch ? BRANCH_NAMES[s.branch] ?? s.branch : 'كل الفروع'}</span>
          </label>
        ))}
        {!staff.length && <p className="text-sm text-ink-muted">لا يوجد مستخدمون مفعّلون في نطاق هذا الفرع.</p>}
      </fieldset>
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton disabled={busy} />
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="team-save">{busy && <Spinner />} حفظ الفريق</button>
      </div>
    </div>
  );
}

function NameForm({ unit, busy, setBusy, onSaved }: { unit: HubUnit; busy: boolean; setBusy: (b: boolean) => void; onSaved: (batch: string, name: string) => Promise<void> }) {
  const [ar, setAr] = useState(unit.name_ar);
  const [en, setEn] = useState(unit.name_en);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    if (ar.trim().length < 2 || en.trim().length < 2) {
      setError('الاسمان مطلوبان، من حرفين إلى 80 حرفًا.');
      return;
    }
    setBusy(true);
    try {
      const r = await unitSave(unit.id, ar.trim(), en.trim());
      setBusy(false);
      await onSaved(r.batch_id, ar.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4" data-name-form>
      <p className="text-xs text-ink-muted">اسم الوحدة يظهر للفريق في اللوحة فقط، ولا يصل للضيف. مفتاحها ثابت: <span className="latin" dir="ltr">{unit.key}</span></p>
      <Field label="الاسم بالعربية" id="hub-name-ar">
        <input id="hub-name-ar" className="field" value={ar} maxLength={80} onChange={(e) => setAr(e.target.value)} disabled={busy} autoComplete="off" />
      </Field>
      <Field label="الاسم بالإنجليزية" id="hub-name-en">
        <input id="hub-name-en" className="field latin" dir="ltr" value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} disabled={busy} autoComplete="off" />
      </Field>
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton disabled={busy} />
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="name-save">{busy && <Spinner />} حفظ</button>
      </div>
    </div>
  );
}

function Summary({ o, edit, onSaved }: { o: HubOverview; edit: boolean; onSaved: (batch: string, label: string) => Promise<void> }) {
  const toast = useToast();
  const initial = useMemo<Row[]>(() => (o.recipients ?? []).map((r) => ({ id: r.id, email: r.email, active: r.active, filter_confirmed: !!r.filter_confirmed_at })), [o.recipients]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setRows(initial), [initial]);
  const set = (i: number, patch: Partial<Row>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch, active: patch.filter_confirmed === false ? false : patch.active ?? r.active } : r)));
  const changed = JSON.stringify(rows) !== JSON.stringify(initial);

  function addRow() {
    const e = add.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setProblem('اكتب بريدًا صحيحًا.');
      return;
    }
    if (rows.some((r) => r.email === e)) {
      setProblem('هذا البريد في القائمة من قبل.');
      return;
    }
    if (rows.length >= 10) {
      setProblem('عشرة عناوين على الأكثر.');
      return;
    }
    setProblem(null);
    setRows((l) => [...l, { email: e, active: false, filter_confirmed: false }]);
    setAdd('');
  }

  async function save() {
    setProblem(null);
    setBusy(true);
    try {
      const r = await recipientsSet(rows.map((x) => ({ ...(x.id ? { id: x.id } : {}), email: x.email, active: x.active, filter_confirmed: x.filter_confirmed })));
      await onSaved(r.batch_id, 'حُفظ مستلمو ملخص الصباح');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const time = typeof o.settings.hub_summary_time === 'string' ? o.settings.hub_summary_time : '08:00';
  return (
    <section className="card p-4 grid gap-3" aria-labelledby="hub-summary-h" data-tour="hub-summary" data-hub-summary>
      <h2 id="hub-summary-h" className="font-bold text-lg">ملخص الصباح</h2>
      <p className="text-xs text-ink-muted num-ar">
        بريد يومي للإدارة الساعة {time} بتوقيت الرياض عن أمس، بلا أرقام مالية — يبدأ الإرسال حين يُبنى المساعد. كل عنوان يحتاج قبل تفعيله فلتر «نقل إلى الوارد» في بريد Hostinger (المرسل no-reply والعنوان يحتوي AR-).
      </p>
      <DirtyScope version={JSON.stringify(initial)} data-scope="hub-summary" className="grid gap-2">
        <ul className="grid gap-2" data-recipients>
          {rows.map((r, i) => (
            <li key={r.id ?? r.email} className="grid sm:grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 gap-y-1 border-b border-line last:border-0 pb-2" data-recipient={r.email}>
              <span className="latin text-sm break-all" dir="ltr">{r.email}</span>
              <label className="flex items-center gap-2 text-sm min-h-11">
                <input type="checkbox" className="size-4 accent-bronze-deep" checked={r.filter_confirmed} disabled={!edit || busy} onChange={(e) => set(i, { filter_confirmed: e.target.checked })} data-recipient-filter />
                فلتر البريد مؤكَّد
              </label>
              <label className="flex items-center gap-2 text-sm min-h-11">
                <input type="checkbox" role="switch" className="size-4 accent-bronze-deep" checked={r.active} aria-checked={r.active} disabled={!edit || busy || !r.filter_confirmed} onChange={(e) => set(i, { active: e.target.checked })} data-recipient-active />
                مفعّل
              </label>
              {edit && (
                <button type="button" className="btn btn-ghost btn-sm text-error" disabled={busy} onClick={() => setRows((l) => l.filter((_, j) => j !== i))} aria-label={`إزالة ${r.email}`} data-action="recipient-remove">إزالة</button>
              )}
            </li>
          ))}
          {!rows.length && <li className="text-sm text-ink-muted">لا مستلمين بعد.</li>}
        </ul>
        {edit && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow min-w-[12rem]">
              <Field label="إضافة بريد" id="hub-summary-add">
                <input id="hub-summary-add" className="field latin" dir="ltr" type="email" inputMode="email" value={add} onChange={(e) => setAdd(e.target.value)} disabled={busy} autoComplete="off" />
              </Field>
            </div>
            <button type="button" className="btn btn-ghost" onClick={addRow} disabled={busy || !add.trim()} data-action="recipient-add">إضافة</button>
          </div>
        )}
        {problem && <p className="text-sm media-err" role="alert">{problem}</p>}
        {edit && (
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !changed} data-action="recipients-save">{busy && <Spinner />} حفظ المستلمين</button>
          </div>
        )}
      </DirtyScope>
    </section>
  );
}
