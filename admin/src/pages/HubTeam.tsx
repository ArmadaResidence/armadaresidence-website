// «الفريق والتقارير» (Guest Hub H6c, 15 Nov 2026 — DECISIONS.md 2026-11-15 «Guest Hub H6c»; CLAUDE.md §14).
//   «فريق الاستقبال» (?tab=team): per branch, up to five staff slots — name, WhatsApp number (the site's phone rules, E.164),
//     role «مدير الاستقبال» / «موظف استقبال», working days (chips) and hours from–to (24-hour; overnight allowed), «نشط»,
//     «يُعامَل كضيف للتجربة», and the required «الموظف موافق على استلام تنبيهات واتساب»; per branch «عودة المساعد بعد صمت
//     الفريق (دقائق)» and «تصعيد إذا لم تُفتح المحادثة خلال (دقائق)»; the live line «في الوردية الآن». hub_team: edit on
//     the branch edits it (a single-branch reception manager edits that branch only — the server checks the scope).
//   «التقارير» (?tab=reports&day=YYYY-MM-DD — ?hub_r= of the WhatsApp report lands here): the day's report with its
//     breakdown for every viewer; the recipients (up to three), the send time and «إرسال تجربة لي» for the system admin.
// Every save returns the row as it was: «تراجع» saves it back. Dialogs close only through × / «إلغاء» (the shared Modal).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DateField from '../components/DateField';
import { CancelButton, Confirm, DirtyScope, Empty, ErrorBox, Field, Loading, Modal, NumberField, Segmented, Spinner, useToast } from '../components/ui';
import { addDays, BRANCH_NAMES, longDate, minutesWord, riyadhDateTime, riyadhToday, west } from '../lib/format';
import * as T from '../lib/team';
import * as D from '../lib/departures';

type Tab = 'team' | 'reports' | 'departures';
const TABS: { key: Tab; label: string }[] = [{ key: 'team', label: 'فريق الاستقبال' }, { key: 'reports', label: 'التقارير' }, { key: 'departures', label: 'قائمة المغادرين' }];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default function HubTeam() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'reports' ? 'reports' : params.get('tab') === 'departures' ? 'departures' : 'team';
  const [data, setData] = useState<T.TeamData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await T.teamGet());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    void T.preparePhone();
  }, [load]);
  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', t);
    if (t === 'team') p.delete('day');
    setParams(p, { replace: true });
  };
  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <div className="grid gap-5 max-w-6xl" data-page="hub-team">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold">الفريق والتقارير</h1>
        <p className="text-sm text-ink-muted mt-1">
          موظفو الاستقبال الذين يصلهم تنبيه واتساب عند تحويل محادثة إلى الفريق خلال ورديتهم، والتقرير اليومي على واتساب.
          {!data.can_edit ? ' صلاحيتك هنا للعرض فقط.' : ''}
        </p>
      </div>
      <ErrorBox error={error} />
      <div className="inbox-tabs" role="tablist" aria-label="أقسام الفريق والتقارير" data-tour="team-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`inbox-tab ${tab === t.key ? 'is-on' : ''}`} onClick={() => setTab(t.key)} data-tab={t.key}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'departures' ? <DeparturesTab /> : tab === 'team' ? <TeamTab data={data} reload={load} /> : <ReportsTab data={data} reload={load} day={ISO_DAY.test(params.get('day') ?? '') ? params.get('day')! : addDays(riyadhToday(), -1)}
        onDay={(d) => { const p = new URLSearchParams(params); p.set('tab', 'reports'); p.set('day', d); setParams(p, { replace: true }); }} />}
    </div>
  );
}

// ═══ «قائمة المغادرين» (H9, 16 Nov 2026): the two switches per branch — the system admin's, both OFF; everyone else reads ═══
const DEP_SWITCH = {
  check: { label: 'رسالة الخروج أو التمديد', on: 'تصل كل ضيف في قائمة الفرع رسالة «الخروج أو التمديد» صباح يوم المغادرة الساعة 9:30 من رقم الفرع.' },
  review: { label: 'طلبات التقييم من قائمة المغادرين', on: 'يصل كل ضيف في القائمة طلب التقييم: 7:00 مساءً بعد «سأغادر في موعدي»، أو 10:00 صباح اليوم التالي إن لم يرد — مرة واحدة لكل إقامة، ولا يتكرر مع طلب تقييم حجز الموقع.' },
} as const;
function DeparturesTab() {
  const toast = useToast();
  const [o, setO] = useState<D.DepOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ branch: string; kind: 'check' | 'review' } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setO(await D.overview());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const apply = async (branch: string, kind: 'check' | 'review', on: boolean) => {
    setBusy(true);
    try {
      const r = await D.switchSet(branch, kind === 'check' ? on : null, kind === 'review' ? on : null);
      setAsk(null);
      await load();
      toast.undo(`${on ? 'شُغّل' : 'أُوقف'} «${DEP_SWITCH[kind].label}» لـ${BRANCH_NAMES[branch]}.`, async () => {
        await D.switchSet(branch, r.previous.check_on, r.previous.review_on);
        await load();
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  // H9 fix 3: «تذكير رفع القائمة» — at once, with «تراجع»
  const remind = async (branch: string, on: boolean) => {
    setBusy(true);
    try {
      const r = await D.remindSet(branch, on);
      await load();
      toast.undo(`${on ? 'شُغّل' : 'أُوقف'} «تذكير رفع القائمة» لـ${BRANCH_NAMES[branch]}.`, async () => {
        await D.remindSet(branch, r.previous.remind_on);
        await load();
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (error) return <ErrorBox error={error} />;
  if (!o) return <Loading />;
  return (
    <div className="grid gap-4" data-tour="team-departures">
      <p className="text-sm text-ink-muted max-w-3xl">
        كل صباح قبل الساعة 7:00 يرفع الاستقبال من نزيل قائمة المغادرة لليوم لكل فرع في <Link className="link-bronze" to="/departures">«قائمة المغادرين»</Link>. مفتاحا الإرسال لكل فرع يشغّلهما مدير النظام وحده، وهما متوقفان
        افتراضيًا؛ وما داما متوقفين تعرض القائمة ما كان سيُرسل ومتى دون إرسال. «تذكير رفع القائمة» مفتاح مستقل يعمل افتراضيًا.
      </p>
      {o.branches.map((b) => (
        <div key={b.branch} className="card p-4 grid gap-3" data-dep-branch={b.branch}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{BRANCH_NAMES[b.branch] ?? b.branch}</h2>
            <span className="text-sm text-ink-muted">
              {b.last_upload ? `آخر قائمة: ${longDate(b.last_upload.date)} — ${b.last_upload.kept} ${b.last_upload.kept === 1 ? 'ضيف' : 'ضيوف'}` : 'لم تُرفع قائمة بعد'}
              {b.today_uploaded ? ' · قائمة اليوم مرفوعة' : ' · قائمة اليوم لم تُرفع'}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3" data-switch="remind">
            <div>
              <p className="font-medium">تذكير رفع القائمة</p>
              <p className="text-sm text-ink-muted">{b.remind_on !== false ? 'يعمل — تذكير المناوبين 7:00 و8:00، ومدير الاستقبال و«التنبيهات» 8:30، حتى لو كان مفتاحا الإرسال متوقفين' : 'متوقف — لا تذكير ولا تنبيه لهذا الفرع'}</p>
            </div>
            {o.system_admin ? (
              <button type="button" className={`btn btn-sm ${b.remind_on !== false ? 'btn-ghost' : 'btn-primary'}`} disabled={busy} onClick={() => remind(b.branch, b.remind_on === false)}
                data-action={b.remind_on !== false ? 'remind-off' : 'remind-on'} aria-label={`${b.remind_on !== false ? 'إيقاف' : 'تشغيل'} «تذكير رفع القائمة» لـ${BRANCH_NAMES[b.branch]}`}>
                {b.remind_on !== false ? 'إيقاف' : 'تشغيل'}
              </button>
            ) : <span className="text-xs text-ink-muted">لمدير النظام وحده</span>}
          </div>
          {(['check', 'review'] as const).map((k) => {
            const on = k === 'check' ? b.check_on : b.review_on;
            return (
              <div key={k} className="flex flex-wrap items-center justify-between gap-3" data-switch={k}>
                <div>
                  <p className="font-medium">{DEP_SWITCH[k].label}</p>
                  <p className="text-sm text-ink-muted">{on ? 'يعمل' : 'متوقف — تجربة بدون إرسال'}</p>
                </div>
                {o.system_admin ? (
                  <button type="button" className={`btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}`} disabled={busy}
                    onClick={() => (on ? apply(b.branch, k, false) : setAsk({ branch: b.branch, kind: k }))} data-action={on ? 'switch-off' : 'switch-on'}
                    aria-label={`${on ? 'إيقاف' : 'تشغيل'} «${DEP_SWITCH[k].label}» لـ${BRANCH_NAMES[b.branch]}`}>
                    {on ? 'إيقاف' : 'تشغيل'}
                  </button>
                ) : <span className="text-xs text-ink-muted">لمدير النظام وحده</span>}
              </div>
            );
          })}
        </div>
      ))}
      <Confirm open={!!ask} title={ask ? `تشغيل «${DEP_SWITCH[ask.kind].label}» لـ${BRANCH_NAMES[ask.branch]}؟` : ''} body={ask ? DEP_SWITCH[ask.kind].on : ''}
        confirmLabel="تشغيل" busy={busy} onConfirm={() => ask && apply(ask.branch, ask.kind, true)} onClose={() => setAsk(null)} />
    </div>
  );
}

// ═══ «فريق الاستقبال» ═══
function TeamTab({ data, reload }: { data: T.TeamData; reload: () => Promise<void> }) {
  if (!data.branches.length) return <Empty text="لا فرع ضمن صلاحيتك." />;
  return (
    <div className="grid gap-4">
      {data.branches.map((b, i) => <BranchCard key={b.slug} b={b} reload={reload} first={i === 0} />)}
    </div>
  );
}

function BranchCard({ b, reload, first }: { b: T.TeamBranch; reload: () => Promise<void>; first: boolean }) {
  const toast = useToast();
  const [resume, setResume] = useState<number | null>(b.resume_minutes);
  const [escalate, setEscalate] = useState<number | null>(b.escalate_minutes);
  // «وضع الاستعداد» (Ahmed, 16 Nov 2026)
  const [standbyOn, setStandbyOn] = useState(b.standby_on);
  const [standbyMin, setStandbyMin] = useState<number | null>(b.standby_minutes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<T.Slot | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T.Slot | null>(null);
  useEffect(() => {
    setResume(b.resume_minutes);
    setEscalate(b.escalate_minutes);
  }, [b.resume_minutes, b.escalate_minutes]);
  useEffect(() => {
    setStandbyOn(b.standby_on);
    setStandbyMin(b.standby_minutes);
  }, [b.standby_on, b.standby_minutes]);
  const standbyValid = standbyMin !== null && standbyMin >= T.STANDBY_MIN && standbyMin <= T.STANDBY_MAX;

  async function saveStandby() {
    if (!standbyValid || standbyMin === null) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await T.standbySave(b.slug, standbyOn, standbyMin);
      const prev = r.previous;
      toast.undo(`${b.name} — ${standbyOn ? 'وضع الاستعداد مفعّل' : 'وضع الاستعداد متوقف'}`, async () => {
        if (prev) await T.standbySave(b.slug, prev.standby_on, prev.standby_minutes);
        await reload();
      });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (resume === null || escalate === null) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await T.branchSave(b.slug, resume, escalate);
      const prev = r.previous;
      toast.undo(`${b.name} — حُفظت الإعدادات`, async () => {
        if (prev) await T.branchSave(b.slug, prev.resume_minutes, prev.escalate_minutes);
        await reload();
      });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(s: T.Slot) {
    setBusy(true);
    setErr(null);
    try {
      const r = await T.slotDelete(s.id);
      setDeleting(null);
      const prev = r.previous;
      toast.undo(`حُذف ${s.name}`, async () => {
        if (prev) await T.slotSave(prev);
        await reload();
      });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const full = b.slots.length >= 5;
  return (
    <section className="card p-4 grid gap-4" aria-labelledby={`tb-${b.slug}`} data-team-branch={b.slug}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`tb-${b.slug}`} className="text-lg font-bold">{b.name}</h2>
          <p className="text-sm mt-1" data-on-shift {...(first ? { 'data-tour': 'team-on-shift' } : {})}>{T.onShiftLine(b)}</p>
          {b.channel === false && <p className="text-sm text-error mt-1" data-channel-off>«الإرسال من المركز» متوقف على رقم هذا الفرع، فلن تصل تنبيهات واتساب حتى يُفعَّل من «إعدادات المساعد».</p>}
        </div>
        {b.can_edit && (
          <button type="button" className="btn btn-ghost" disabled={full || busy} onClick={() => setEditing('new')} data-action="slot-add" {...(first ? { 'data-tour': 'team-add' } : {})}>
            إضافة موظف
          </button>
        )}
      </div>
      <ErrorBox error={err} />
      {b.slots.length ? (
        <ul className="grid gap-2" {...(first ? { 'data-tour': 'team-slots' } : {})}>
          {b.slots.map((s) => (
            <li key={s.id} className="rounded-md border border-line p-3 flex flex-wrap items-start justify-between gap-3" data-slot={s.position} data-slot-active={s.active}>
              <div className="grid gap-1 min-w-0">
                <p className="font-semibold">
                  {s.name} <span className="chip chip-request ms-1">{T.ROLE_TEXT[s.role]}</span>
                  {s.on_shift && <span className="chip chip-confirmed ms-1" data-chip="on-shift">في الوردية الآن</span>}
                  {!s.active && <span className="chip chip-request ms-1" data-chip="inactive">غير نشط</span>}
                  {s.test_as_guest && <span className="chip chip-test ms-1" data-chip="test-as-guest">يُعامَل كضيف للتجربة</span>}
                </p>
                <p className="text-sm"><span className="latin num" dir="ltr">{T.phoneShow(s.phone)}</span></p>
                <p className="text-sm text-ink-muted">{T.daysText(s.days)} · <span className="num">{T.hoursText(s.start_time, s.end_time)}</span></p>
              </div>
              {b.can_edit && (
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(s)} data-action="slot-edit">تعديل</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDeleting(s)} data-action="slot-delete">حذف الموظف</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="لم يُضف أي موظف بعد. التحويلات تُرسل بالبريد فقط حتى تضيف موظفًا." />
      )}
      {full && b.can_edit && <p className="text-xs text-ink-muted">خمسة موظفين على الأكثر لكل فرع.</p>}
      <DirtyScope className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end border-t border-line pt-3" version={`${b.resume_minutes}|${b.escalate_minutes}`} {...(first ? { 'data-tour': 'team-settings' } : {})}>
        <Field label="عودة المساعد بعد صمت الفريق (دقائق)" id={`resume-${b.slug}`} hint="بعد رد موظف، يصمت المساعد؛ ويعود من تلقاء نفسه حين يكتب الضيف ولم يكتب أحد من الفريق خلال هذه المدة.">
          <NumberField id={`resume-${b.slug}`} value={resume} onChange={setResume} min={5} max={240} />
        </Field>
        <Field label="تصعيد إذا لم تُفتح المحادثة خلال (دقائق)" id={`esc-${b.slug}`} hint="إن لم يفتح أحد المحادثة ولم يرد خلال هذه المدة، يُرسل التنبيه إلى مدير الاستقبال أيضًا.">
          <NumberField id={`esc-${b.slug}`} value={escalate} onChange={setEscalate} min={2} max={120} />
        </Field>
        {b.can_edit && (
          <button type="button" className="btn btn-primary" disabled={busy || resume === null || escalate === null || (resume === b.resume_minutes && escalate === b.escalate_minutes)} onClick={saveSettings} data-action="team-settings-save">
            {busy && <Spinner />} حفظ الإعدادات
          </button>
        )}
      </DirtyScope>
      <DirtyScope className="grid gap-3 border-t border-line pt-3" version={`${b.standby_on}|${b.standby_minutes}`} data-standby={b.slug} {...(first ? { 'data-tour': 'team-standby' } : {})}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">وضع الاستعداد</h3>
          <span className={`chip ${b.standby_on ? 'chip-confirmed' : 'chip-request'}`} data-chip="standby">{b.standby_on ? `مفعّل · ${minutesWord(b.standby_minutes)}` : 'متوقف'}</span>
        </div>
        {b.standby_now && (
          <p className={`text-sm ${b.standby_now.reason === 'waiting' ? 'text-bronze-text font-semibold' : 'text-ink-muted'}`} role="status" data-standby-now={b.standby_now.reason}>
            {T.standbyNowText(b.standby_now)} <span className="text-xs text-ink-muted">· بتوقيت الرياض <span className="num">{b.standby_now.riyadh}</span></span>
          </p>
        )}
        <label className="flex items-start gap-2 text-sm font-semibold">
          <input type="checkbox" className="mt-1 size-4 accent-bronze-deep" checked={standbyOn} onChange={(e) => setStandbyOn(e.target.checked)} disabled={!b.can_edit || busy} data-field="standby-on" />
          <span>وضع الاستعداد: انتظر رد الفريق قبل رد المساعد</span>
        </label>
        <p className="text-xs text-ink-muted max-w-3xl">
          حين يكون مفعّلًا وفي الوردية موظف واحد على الأقل، ينتظر المساعد هذه المدة قبل أن يرد على أول رسالة في المحادثة وعلى رسالة الضيف بعد رد موظف. لا يظهر للضيف
          أنه يكتب، ولا تُعلَّم الرسالة مقروءة على جوال الفرع. إن رد موظف خلالها يتوقف المساعد؛ وإن لم يرد أحد يرد المساعد على كل ما وصل في رسالة واحدة. ولا انتظار حين
          لا يكون أحد في الوردية، ولا لضغطات أزرار المساعد، ولا لكلمات إيقاف العروض.
        </p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_auto] items-end">
          <Field label="مدة الانتظار (دقائق)" id={`standby-${b.slug}`} hint="من 1 إلى 30 دقيقة.">
            <NumberField id={`standby-${b.slug}`} value={standbyMin} onChange={setStandbyMin} min={T.STANDBY_MIN} max={T.STANDBY_MAX} />
            {!standbyValid && <p className="text-xs text-error mt-1" role="alert" data-error="standby-minutes">اكتب مدة من 1 إلى 30 دقيقة.</p>}
          </Field>
          {b.can_edit && (
            <button type="button" className="btn btn-primary" disabled={busy || !standbyValid || (standbyOn === b.standby_on && standbyMin === b.standby_minutes)} onClick={saveStandby} data-action="team-standby-save">
              {busy && <Spinner />} حفظ وضع الاستعداد
            </button>
          )}
        </div>
      </DirtyScope>
      {editing && <SlotDialog branch={b} slot={editing === 'new' ? null : editing} onClose={() => setEditing(null)} reload={reload} />}
      <Confirm open={!!deleting} title="حذف الموظف" body={deleting ? `لن تصل ${deleting.name} تنبيهات هذا الفرع بعد الحذف.` : ''} confirmLabel="حذف الموظف" danger busy={busy}
        onConfirm={() => deleting && remove(deleting)} onClose={() => setDeleting(null)} />
    </section>
  );
}

function PhoneInput({ id, value, onChange }: { id: string; value: string; onChange: (e164: string | null, raw: string) => void }) {
  const init = useMemo(() => (value ? T.splitE164(value) : { cc: 'SA', national: '' }), [value]);
  const [cc, setCc] = useState(init.cc);
  const [raw, setRaw] = useState(init.national);
  useEffect(() => {
    onChange(T.toE164(raw, cc), raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cc, raw]);
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
      <select className="input" aria-label="الدولة" value={cc} onChange={(e) => setCc(e.target.value)} data-field="phone-country">
        {T.COUNTRIES.map((c) => <option key={c.cc} value={c.cc}>{c.dial ? `${c.name} (+${c.dial})` : c.name}</option>)}
      </select>
      <input id={id} className="input latin num" dir="ltr" inputMode="tel" autoComplete="off" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={cc === 'OTHER' ? '+…' : ''} data-field="phone" />
    </div>
  );
}

function SlotDialog({ branch, slot, onClose, reload }: { branch: T.TeamBranch; slot: T.Slot | null; onClose: () => void; reload: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(slot?.name ?? '');
  const [phone, setPhone] = useState<string | null>(slot?.phone ?? null);
  const [phoneRaw, setPhoneRaw] = useState(slot ? 'x' : '');
  const [role, setRole] = useState<T.Slot['role']>(slot?.role ?? 'staff');
  const [days, setDays] = useState<number[]>(slot?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(slot?.start_time ?? '08:00');
  const [end, setEnd] = useState(slot?.end_time ?? '16:00');
  const [active, setActive] = useState(slot?.active ?? true);
  const [guest, setGuest] = useState(slot?.test_as_guest ?? false);
  const [consent, setConsent] = useState(!!slot?.consent_at);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggleDay = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort((a, b) => a - b)));
  const allDays = days.length === 7;
  const problem = name.trim().length < 2 ? 'اكتب اسم الموظف.' : !phone ? (phoneRaw ? 'رقم واتساب غير صحيح لهذه الدولة.' : 'اكتب رقم واتساب.') : start === end ? 'وقت البداية والنهاية لا يكونان واحدًا.' : !consent ? 'ضع علامة موافقة الموظف على التنبيهات.' : null;
  async function save() {
    if (problem || !phone) return setErr(problem);
    setBusy(true);
    setErr(null);
    try {
      const r = await T.slotSave({ id: slot?.id, position: slot?.position, branch: branch.slug, name: name.trim(), phone, role, days, start_time: start, end_time: end, active, test_as_guest: guest, consent: true });
      const prev = r.previous;
      const id = r.id ?? slot?.id;
      toast.undo(slot ? `حُفظ ${name.trim()}` : `أُضيف ${name.trim()}`, async () => {
        if (prev) await T.slotSave(prev);
        else if (id) await T.slotDelete(id);
        await reload();
      });
      onClose();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={slot ? `تعديل ${slot.name}` : `إضافة موظف — ${branch.name}`} busy={busy} draftKey={`hub-slot-${branch.slug}-${slot?.id ?? 'new'}`}>
      <div className="grid gap-4" data-slot-dialog>
        <Field label="الاسم" id="slot-name">
          <input id="slot-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-field="name" />
        </Field>
        <Field label="رقم واتساب" id="slot-phone" hint="الرقم الذي تصله التنبيهات من رقم الفرع.">
          <PhoneInput id="slot-phone" value={slot?.phone ?? ''} onChange={(e, raw) => { setPhone(e); setPhoneRaw(raw); }} />
        </Field>
        <div>
          <p className="text-sm font-semibold mb-1">الدور</p>
          <Segmented label="الدور" value={role} onChange={setRole} options={[{ value: 'manager', label: 'مدير الاستقبال' }, { value: 'staff', label: 'موظف استقبال' }]} />
        </div>
        <div>
          <p className="text-sm font-semibold mb-1">أيام العمل</p>
          <div className="flex flex-wrap gap-1.5" data-field="days">
            <button type="button" className={`chip-toggle ${allDays ? 'is-on' : ''}`} aria-pressed={allDays} onClick={() => setDays(allDays ? [] : [0, 1, 2, 3, 4, 5, 6])} data-day="all">كل الأيام</button>
            {T.DAYS.map((d) => (
              <button key={d.d} type="button" className={`chip-toggle ${days.includes(d.d) ? 'is-on' : ''}`} aria-pressed={days.includes(d.d)} aria-label={d.name} onClick={() => toggleDay(d.d)} data-day={d.d}>{d.short}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="من" id="slot-from">
            <select id="slot-from" className="input num" value={start} onChange={(e) => setStart(e.target.value)} data-field="start">
              {T.TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="إلى" id="slot-to">
            <select id="slot-to" className="input num" value={end} onChange={(e) => setEnd(e.target.value)} data-field="end">
              {T.TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        {start > end && <p className="text-xs text-ink-muted -mt-2" data-overnight>وردية ليلية: تبدأ في الأيام المختارة وتمتد إلى صباح اليوم التالي.</p>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-field="active" /> نشط</label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={guest} onChange={(e) => setGuest(e.target.checked)} data-field="test-as-guest" />
          <span>يُعامَل كضيف للتجربة <span className="block text-xs text-ink-muted">رسائل هذا الرقم تمر بمسار الضيوف العادي (للتجربة فقط)، بدل محادثة الزملاء.</span></span>
        </label>
        <label className="flex items-start gap-2 rounded-md border border-line p-2">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-field="consent" required />
          <span>الموظف موافق على استلام تنبيهات واتساب</span>
        </label>
        <ErrorBox error={err} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" disabled={busy || !!problem} onClick={save} data-action="slot-save" data-autofocus={undefined}>{busy && <Spinner />} حفظ</button>
        </div>
        {problem && <p className="text-xs text-ink-muted text-end" role="status" data-slot-problem>{problem}</p>}
      </div>
    </Modal>
  );
}

// ═══ «التقارير» ═══
function ReportsTab({ data, reload, day, onDay }: { data: T.TeamData; reload: () => Promise<void>; day: string; onDay: (d: string) => void }) {
  const admin = data.is_system_admin;
  return (
    <div className="grid gap-4">
      {admin && <TestNumbers data={data} reload={reload} />}
      {admin ? <ReportSettings data={data} reload={reload} /> : (
        <section className="card p-4 grid gap-2" data-report-readonly>
          <h2 className="text-lg font-bold">مستلمو التقرير</h2>
          <p className="text-sm text-ink-muted">يُرسل التقرير كل يوم الساعة <span className="num">{data.report.send_time}</span> بتوقيت الرياض. إعداد المستلمين لمدير النظام وحده.</p>
          <ul className="grid gap-1 text-sm">{data.report.recipients.map((r) => <li key={r.id}>{r.name} · <span className="latin num" dir="ltr">{r.phone}</span></li>)}</ul>
        </section>
      )}
      <LearningSection />
      <ReportView day={day} onDay={onDay} />
    </div>
  );
}

/** H9 fix 3 (Ahmed, 17 Nov 2026): «أرقام التجربة» — up to 5 numbers (the system admin's) that go through the GUEST path
 *  but book only TEST reservations; each change at once, removing one with «تراجع» */
function TestNumbers({ data, reload }: { data: T.TeamData; reload: () => Promise<void> }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = data.test_numbers ?? [];
  async function add() {
    setBusy(true);
    setErr(null);
    try {
      await T.testNumberSave(west(phone).replace(/[\s-]/g, ''), label.trim());
      setPhone('');
      setLabel('');
      await reload();
      toast('أُضيف رقم التجربة.');
    } catch (e) {
      const m = (e as Error).message;
      setErr(Object.entries(T.TEST_NUMBER_ERRORS).find(([k]) => m.includes(k))?.[1] ?? m);
    } finally {
      setBusy(false);
    }
  }
  async function remove(n: T.TestNumber) {
    setBusy(true);
    try {
      const r = await T.testNumberDelete(n.id);
      await reload();
      toast.undo('حُذف رقم التجربة', async () => {
        await T.testNumberSave(r.previous.phone, r.previous.label);
        await reload();
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card p-4 grid gap-3" aria-labelledby="tn-h" data-test-numbers>
      <div>
        <h2 id="tn-h" className="text-lg font-bold">أرقام التجربة</h2>
        <p className="text-sm text-ink-muted mt-1">أرقام تمر بمسار الضيف كاملًا، لكن حجوزاتها من المحادثة حجوزات تجربة فقط: لا تحجز غرفة، ولا تصل للاستقبال، وتُلغى وحدها بعد ساعة. خمسة أرقام على الأكثر، ولمدير النظام وحده.</p>
      </div>
      {list.length > 0 && (
        <ul className="grid gap-1 text-sm" data-test-number-list>
          {list.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-2" data-test-number={n.id}>
              <span className="latin num" dir="ltr">{n.phone}</span>
              {n.label && <span className="chip">{n.label}</span>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(n)} disabled={busy} aria-label={`حذف رقم التجربة ${n.label || ''}`.trim()} data-action="test-number-delete">حذف الرقم</button>
            </li>
          ))}
        </ul>
      )}
      {list.length < T.TEST_NUMBERS_MAX && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="الرقم (بالصيغة الدولية)" id="tn-phone">
            <input id="tn-phone" className="field latin" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+9665…" data-no-dirty data-field="test-number-phone" />
          </Field>
          <Field label="وصف قصير (اختياري)" id="tn-label">
            <input id="tn-label" className="field" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} data-no-dirty data-field="test-number-label" />
          </Field>
          <button type="button" className="btn btn-primary" disabled={busy || !west(phone).trim()} onClick={add} data-action="test-number-add">{busy && <Spinner />} إضافة رقم تجربة</button>
        </div>
      )}
      {err && <p className="text-sm text-error" role="alert" data-test-number-error>{err}</p>}
    </section>
  );
}

/** H7b «التعلّم» (Ahmed, 15 Nov 2026): the assistant learns by itself from the team — two switches, the system admin's;
 *  each change at once with «تراجع» (the same as the hub's other switches) */
function LearningSection() {
  const toast = useToast();
  const [cfg, setCfg] = useState<T.Learning | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setCfg(await T.learningGet());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function set(replies: boolean, teach: boolean, msg: string) {
    setBusy(true);
    try {
      const r = await T.learningSet(replies, teach);
      await load();
      toast.undo(msg, async () => {
        await T.learningSet(r.previous.learn_replies, r.previous.learn_teach);
        await load();
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  if (!cfg) return err ? <ErrorBox error={err} /> : null;
  const rows: { key: 'learn_replies' | 'learn_teach'; label: string; hint: string }[] = [
    { key: 'learn_replies', label: 'التعلّم من ردود الفريق', hint: 'إذا رد الفريق على سؤال لم يعرف المساعد إجابته، يتعلّم المعلومة العامة فورًا لفرع المحادثة. الأسعار والتعارض لا يتعلّمها؛ تظهر في التقرير «يحتاج قرارك».' },
    { key: 'learn_teach', label: 'التعليم بـ «تعلّم:»', hint: 'رسالة تبدأ بـ «تعلّم:» من رقمك أو من رقم مدير الاستقبال (لفرعه) إلى رقم الفرع؛ يرد المساعد بالصياغة التي سيقولها للضيوف، و«امسح» يحذفها.' },
  ];
  return (
    <section className="card p-4 grid gap-3" aria-labelledby="learn-h" data-learning data-tour="team-learning">
      <div>
        <h2 id="learn-h" className="text-lg font-bold">التعلّم</h2>
        <p className="text-sm text-ink-muted mt-1">
          المعلومات المتعلَّمة تعمل فورًا وتظهر مرقّمة في سطر «بطاقات معرفة جديدة» بالتقرير اليومي؛ الرد على التقرير بـ «امسح 2» يحذف المعلومة رقم 2.
          تجدها كلها في «قاعدة المعرفة» ← المصدر «تعلّمها المساعد». {cfg.can_edit ? '' : 'تشغيلها وإيقافها لمدير النظام وحده.'}
        </p>
      </div>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.key} className="rounded-md border border-line p-3 flex flex-wrap items-start justify-between gap-3" data-learn-switch={r.key}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.label} <span className={`chip ${cfg[r.key] ? 'chip-confirmed' : 'chip-cancelled'}`} data-state>{cfg[r.key] ? 'يعمل' : 'متوقف'}</span></p>
              <p className="text-sm text-ink-muted mt-0.5">{r.hint}</p>
            </div>
            {cfg.can_edit && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} data-action={`learn-${r.key}`}
                onClick={() => {
                  const on = !cfg[r.key];
                  set(r.key === 'learn_replies' ? on : cfg.learn_replies, r.key === 'learn_teach' ? on : cfg.learn_teach, `${on ? 'شُغِّل' : 'أُوقف'} «${r.label}».`);
                }}>
                {cfg[r.key] ? 'إيقاف' : 'تشغيل'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <Link to="/knowledge?source=learned" className="link-bronze text-sm justify-self-start" data-link="learned-cards">ما تعلّمه المساعد</Link>
    </section>
  );
}

function ReportSettings({ data, reload }: { data: T.TeamData; reload: () => Promise<void> }) {
  const toast = useToast();
  const [time, setTime] = useState(data.report.send_time);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<T.Recipient | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T.Recipient | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => setTime(data.report.send_time), [data.report.send_time]);
  const rs = data.report.recipients;
  const target = rs.find((r) => r.mine) ?? rs[0] ?? null;
  async function saveTime() {
    setBusy(true);
    setErr(null);
    try {
      const r = await T.reportTimeSave(time);
      toast.undo(`وقت التقرير ${time}`, async () => {
        await T.reportTimeSave(r.previous);
        await reload();
      });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(x: T.Recipient) {
    setBusy(true);
    try {
      const r = await T.recipientDelete(x.id);
      setDeleting(null);
      toast.undo(`حُذف ${x.name} من مستلمي التقرير`, async () => {
        if (r.previous) await T.recipientSave(r.previous);
        await reload();
      });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendTest() {
    setBusy(true);
    setErr(null);
    try {
      const r = await T.reportTest();
      // 15 Nov 2026 (Ahmed): never silent — the real outcome, or the reason in Arabic
      const s = r.send_id ? await T.waitSend(r.send_id) : null;
      setTesting(false);
      const to = `${r.recipient}${r.mine ? ' (رقمك)' : ''}`;
      if (s && ['accepted', 'sent', 'delivered', 'read'].includes(s.status)) toast(`أُرسل تقرير اليوم حتى الآن إلى ${to}.`);
      else if (s) {
        const why = `لم يُرسل التقرير إلى ${to}: ${T.sendRefusalText(s.error_code)}. سُجّل ذلك في التنبيهات وفي «أعطال» التقرير اليومي.`;
        setErr(why);
        toast(why, 'error');
      } else {
        const why = 'لم تصل نتيجة الإرسال بعد. افتح «التنبيهات» في «إعدادات المساعد» بعد دقيقة لمعرفة ما حدث.';
        setErr(why);
        toast(why, 'error');
      }
    } catch (e) {
      setErr((e as Error).message);
      setTesting(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card p-4 grid gap-4" aria-labelledby="rep-h" data-report-settings>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="rep-h" className="text-lg font-bold">التقرير اليومي على واتساب</h2>
          <p className="text-sm text-ink-muted mt-1">
            عن اليوم السابق (من 00:00 إلى 24:00 بتوقيت الرياض)، من رقم طريق المطار، بلا أرقام مالية. ونسخة بالبريد إلى <span className="num">{data.report.email_recipients}</span> من مستلمي «ملخص الصباح» للأرشيف.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" disabled={busy || rs.length >= 3} onClick={() => setEditing('new')} data-action="recipient-add" data-tour="team-recipients">إضافة مستلم</button>
          <button type="button" className="btn btn-primary" disabled={busy || !rs.length} onClick={() => setTesting(true)} data-action="report-test" data-tour="team-report-test">إرسال تجربة لي</button>
        </div>
      </div>
      <ErrorBox error={err} />
      {rs.length ? (
        <ul className="grid gap-2">
          {rs.map((r) => (
            <li key={r.id} className="rounded-md border border-line p-3 flex flex-wrap items-start justify-between gap-3" data-recipient={r.position}>
              <div className="grid gap-1">
                <p className="font-semibold">{r.name}
                  {r.staff_name && <span className="chip chip-request ms-1">{r.staff_name}</span>}
                  {!r.active && <span className="chip chip-request ms-1">غير نشط</span>}
                  {r.test_as_guest && <span className="chip chip-test ms-1">يُعامَل كضيف للتجربة</span>}
                </p>
                <p className="text-sm"><span className="latin num" dir="ltr">{T.phoneShow(r.phone)}</span></p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(r)} data-action="recipient-edit">تعديل</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDeleting(r)} data-action="recipient-delete">حذف المستلم</button>
              </div>
            </li>
          ))}
        </ul>
      ) : <Empty text="لا مستلم بعد: أضف حتى ثلاثة أرقام." />}
      <DirtyScope className="flex flex-wrap items-end gap-3 border-t border-line pt-3" version={data.report.send_time} data-tour="team-report-time">
        <Field label="وقت الإرسال (بتوقيت الرياض)" id="rep-time">
          <select id="rep-time" className="input num" value={time} onChange={(e) => setTime(e.target.value)} data-field="report-time">
            {T.REPORT_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <button type="button" className="btn btn-ghost" disabled={busy || time === data.report.send_time} onClick={saveTime} data-action="report-time-save">{busy && <Spinner />} حفظ الوقت</button>
      </DirtyScope>
      {editing && <RecipientDialog data={data} rec={editing === 'new' ? null : editing} onClose={() => setEditing(null)} reload={reload} />}
      <Confirm open={!!deleting} title="حذف المستلم" body={deleting ? `لن يصل التقرير اليومي إلى ${deleting.name}.` : ''} confirmLabel="حذف المستلم" danger busy={busy}
        onConfirm={() => deleting && remove(deleting)} onClose={() => setDeleting(null)} />
      <Confirm open={testing} title="إرسال تجربة لي" busy={busy} confirmLabel="إرسال التجربة" onConfirm={sendTest} onClose={() => setTesting(false)}
        body={target ? `يُرسل تقرير اليوم حتى الآن إلى ${target.name}${target.mine ? ' (رقمك في القائمة)' : ' — رقمك ليس في القائمة، فيُرسل إلى أول مستلم'}، من رقم طريق المطار.` : ''} />
    </section>
  );
}

function RecipientDialog({ data, rec, onClose, reload }: { data: T.TeamData; rec: T.Recipient | null; onClose: () => void; reload: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(rec?.name ?? '');
  const [phone, setPhone] = useState<string | null>(rec?.phone ?? null);
  const [phoneRaw, setPhoneRaw] = useState(rec ? 'x' : '');
  const [user, setUser] = useState(rec?.staff_user_id ?? '');
  const [active, setActive] = useState(rec?.active ?? true);
  const [guest, setGuest] = useState(rec?.test_as_guest ?? false);
  const [consent, setConsent] = useState(!!rec?.consent_at);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const problem = name.trim().length < 2 ? 'اكتب الاسم.' : !phone ? (phoneRaw ? 'رقم واتساب غير صحيح لهذه الدولة.' : 'اكتب رقم واتساب.') : !consent ? 'ضع علامة الموافقة على استلام التقرير.' : null;
  async function save() {
    if (problem || !phone) return setErr(problem);
    setBusy(true);
    setErr(null);
    try {
      const r = await T.recipientSave({ id: rec?.id, position: rec?.position, name: name.trim(), phone, staff_user_id: user || null, active, test_as_guest: guest, consent: true });
      const id = r.id ?? rec?.id;
      toast.undo(rec ? `حُفظ ${name.trim()}` : `أُضيف ${name.trim()} إلى مستلمي التقرير`, async () => {
        if (r.previous) await T.recipientSave(r.previous);
        else if (id) await T.recipientDelete(id);
        await reload();
      });
      onClose();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={rec ? `تعديل ${rec.name}` : 'إضافة مستلم للتقرير'} busy={busy} draftKey={`hub-recipient-${rec?.id ?? 'new'}`}>
      <div className="grid gap-4" data-recipient-dialog>
        <Field label="الاسم" id="rec-name"><input id="rec-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-field="name" /></Field>
        <Field label="رقم واتساب" id="rec-phone"><PhoneInput id="rec-phone" value={rec?.phone ?? ''} onChange={(e, raw) => { setPhone(e); setPhoneRaw(raw); }} /></Field>
        <Field label="مستخدم اللوحة صاحب الرقم (اختياري)" id="rec-user" hint="«إرسال تجربة لي» يُرسل إلى رقم المستخدم المسجّل دخوله إن كان في القائمة.">
          <select id="rec-user" className="input" value={user} onChange={(e) => setUser(e.target.value)} data-field="user">
            <option value="">—</option>
            {(data.report.staff_users ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-field="active" /> نشط</label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={guest} onChange={(e) => setGuest(e.target.checked)} data-field="test-as-guest" />
          <span>يُعامَل كضيف للتجربة <span className="block text-xs text-ink-muted">رسائل هذا الرقم تمر بمسار الضيوف العادي (للتجربة فقط).</span></span>
        </label>
        <label className="flex items-start gap-2 rounded-md border border-line p-2">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-field="consent" required />
          <span>صاحب الرقم موافق على استلام التقرير على واتساب</span>
        </label>
        <ErrorBox error={err} />
        <div className="flex flex-wrap justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" disabled={busy || !!problem} onClick={save} data-action="recipient-save">{busy && <Spinner />} حفظ</button>
        </div>
        {problem && <p className="text-xs text-ink-muted text-end" role="status">{problem}</p>}
      </div>
    </Modal>
  );
}

function ReportView({ day, onDay }: { day: string; onDay: (d: string) => void }) {
  const [r, setR] = useState<T.Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setR(null);
    setErr(null);
    T.reportGet(day).then((x) => live && setR(x)).catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [day]);
  const lines = r ? T.reportLines(r.data) : [];
  return (
    <section className="card p-4 grid gap-4" aria-labelledby="repv-h" data-report-view={day} data-tour="team-report-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="repv-h" className="text-lg font-bold">تقرير يوم {longDate(day)}</h2>
          {r && <p className="text-sm text-ink-muted mt-1" data-report-state>
            {r.stored ? `أُعدّ ${r.built_at ? riyadhDateTime(r.built_at) : ''}` : day === riyadhToday() ? 'اليوم حتى الآن — لم يُرسل بعد' : 'لم يُرسل تقرير عن هذا اليوم؛ الأرقام من السجلات الآن'}
            {r.sends && (r.sends.sent || r.sends.failed) ? ` · أُرسل إلى ${r.sends.sent} · وصل ${r.sends.delivered} · قُرئ ${r.sends.read}${r.sends.failed ? ` · تعذّر ${r.sends.failed}` : ''}` : ''}
          </p>}
        </div>
        <div className="w-64 max-w-full">
          <DateField mode="single" id="report-day" label="اليوم" min="past" max={riyadhToday()} value={day} onChange={(v) => v && onDay(v)} />
        </div>
      </div>
      <ErrorBox error={err} />
      {!r && !err ? <Loading /> : r && (
        <>
          <dl className="grid gap-1.5 sm:grid-cols-2" data-report-lines>
            {lines.map((l) => (
              <div key={l.label} className="rounded-md border border-line px-3 py-2 flex flex-wrap justify-between gap-2">
                <dt className="text-sm text-ink-muted">{l.label}</dt>
                <dd className="text-sm font-semibold num">{l.value}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="تنبيهات الفريق والتحويلات" data-report-breakdown>
            <table className="table text-sm min-w-[36rem]">
              <caption className="text-start font-semibold mb-2">تنبيهات الفريق والتحويلات</caption>
              <thead><tr><th scope="col">الفرع</th><th scope="col">تحويلات</th><th scope="col">تنبيهات أُرسلت</th><th scope="col">وصلت</th><th scope="col">قُرئت</th><th scope="col">فُتحت</th><th scope="col">تصعيد</th><th scope="col">بريد فقط</th><th scope="col">رُد عليها</th></tr></thead>
              <tbody>
                {(['airport-road', 'shafa-road'] as const).map((b) => {
                  const x = r.data.branches?.[b];
                  if (!x) return null;
                  return (
                    <tr key={b}>
                      <th scope="row">{b === 'airport-road' ? 'طريق المطار' : 'طريق الشفا'}</th>
                      {[x.handed, x.alerts_sent, x.alerts_delivered, x.alerts_read, x.opened, x.escalated, x.email_only, x.replied].map((v, i) => <td key={i} className="num">{v ?? 0}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(['airport-road', 'shafa-road'] as const).some((b) => Object.keys(r.data.branches?.[b]?.reasons ?? {}).length > 0) && (
            <div className="grid gap-1 text-sm" data-report-reasons>
              <p className="font-semibold">أسباب التحويل</p>
              {(['airport-road', 'shafa-road'] as const).map((b) => {
                const rs = Object.entries(r.data.branches?.[b]?.reasons ?? {});
                return rs.length ? <p key={b}>{b === 'airport-road' ? 'طريق المطار' : 'طريق الشفا'}: {rs.map(([k, n]) => `${T.REASON_TEXT[k] ?? k} ${n}`).join(' · ')}</p> : null;
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
