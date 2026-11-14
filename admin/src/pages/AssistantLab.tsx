// «إعدادات المساعد» — the tabs of session H6 (14 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §2.9, §2.10, §4.8, §4.9,
// §5.6 items 2, 4, 7, 8; DECISIONS.md 2026-11-14 «Guest Hub H6»):
//   - «الشخصية» (PersonaPanel): per unit — the tone (the five steps of prompts.md §5), emoji on / off, the greetings for a
//     new and a returning guest (copy.md §1 by default); no name field, nothing that presents the assistant. «حفظ» keeps a
//     draft («تراجع» saves the previous one back); «نشر» goes through the test lab (components/EvalGate.tsx).
//   - «التراخيص» (LicencesPanel): per unit × topic — the licence, since when, by whom, why; as information only, the last
//     30 days' drafts, approved unedited (%), edited, rejected, flagged wrong. «تفعيل الرد التلقائي» / «إيقاف الرد
//     التلقائي» with a reason, for the system admin only (the server refuses everyone else); a topic «للفريق دائمًا»
//     never. Nothing changes a licence by itself.
//   - «مختبر الاختبار» (LabPanel): the bank (filters, add, «إيقاف» / «إعادة تفعيل», «فجوة معروفة» with a reason), «تشغيل
//     الآن» with the estimated cost first, the last runs and their results.
//   - «المحاكي» (SimulatorPanel): a phone-shaped chat bound to a unit, always in test mode (nothing sent, no booking),
//     optionally reading the unpublished cards and the persona being edited; beside each reply the understanding, the
//     decision, the sources, the guard's verdict and the cost; «حفظ كسؤال اختبار».
// Western digits, the shared Modal with its dirty guard, counted nouns, RTL; every refusal in Arabic.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { countWord, longDate, riyadhDateTime, type CountNoun } from '../lib/format';
import { usd, type HubOverview, type HubUnit, type Persona, MODE_LABELS } from '../lib/hub';
import * as L from '../lib/lab';
import EvalGate from '../components/EvalGate';
import { CancelButton, DirtyScope, Empty, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';

const Q: CountNoun = { zero: 'لا أسئلة', one: 'سؤال واحد', two: 'سؤالان', few: 'أسئلة', many: 'سؤالًا', gen: 'سؤال' };
const RUN: CountNoun = { zero: 'لا تشغيلات', one: 'تشغيل واحد', two: 'تشغيلان', few: 'تشغيلات', many: 'تشغيلًا', gen: 'تشغيل' };
const usable = (o: HubOverview) => o.units.filter((u) => u.status === 'active' && !u.knowledge_hidden);
const unitName = (o: HubOverview, key: string) => o.units.find((u) => u.key === key)?.name_ar ?? L.UNIT_NAMES[key] ?? key;

function UnitPicker({ o, value, onChange, id, all }: { o: HubOverview; value: string; onChange: (v: string) => void; id: string; all?: boolean }) {
  return (
    <Field label="الوحدة" id={id}>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)} data-unit-picker>
        {all && <option value="">كل الوحدات</option>}
        {usable(o).map((u) => <option key={u.key} value={u.key}>{u.name_ar}</option>)}
      </select>
    </Field>
  );
}

// ══════════════════════════════════ «الشخصية» ══════════════════════════════════

const personaOf = (u: HubUnit): Persona => {
  const d = u.persona_draft as Partial<Persona> | undefined;
  if (d && typeof d.tone === 'number') return { ...L.DEFAULT_PERSONA, ...d } as Persona;
  if (u.persona && typeof u.persona.tone === 'number') return { ...L.DEFAULT_PERSONA, ...u.persona } as Persona;
  return { ...L.DEFAULT_PERSONA };
};
const fillGreeting = (t: string, unit: string, first: string | null) => t.replace(/\{unit_name\}/g, unit).replace(/\{first_name\}/g, first ?? '');

export function PersonaPanel({ o, edit, onChanged, onEditing }: { o: HubOverview; edit: boolean; onChanged: () => Promise<void>; onEditing: (unit: string, p: Persona) => void }) {
  const toast = useToast();
  const units = usable(o);
  const [key, setKey] = useState(units[0]?.key ?? '');
  const u = units.find((x) => x.key === key) ?? units[0];
  const [p, setP] = useState<Persona>(() => (u ? personaOf(u) : { ...L.DEFAULT_PERSONA }));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<{ code: string; field: string }[]>([]);
  const [gate, setGate] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (u) setP(personaOf(u));
    setProblems([]);
  }, [u?.key, u?.persona_draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (u) onEditing(u.key, p);
  }, [p, u?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const unitLabel = u ? (u.kind === 'dining' && u.venue ? u.venue.name_ar : u.name_ar) : '';
  const publishWith = useCallback(async (run: string) => {
    if (!u) return;
    const r = await L.personaPublish(u.id, run);
    if (r.ok) {
      setGate(false);
      toast(`نُشرت شخصية ${unitLabel} بعد نجاح الاختبار؛ يرد بها المساعد من الآن.`);
      await onChanged();
    } else toast(r.reason === 'nothing' ? 'لا تغييرات للنشر.' : 'تغيّرت الشخصية أثناء الاختبار؛ احفظ ثم انشر من جديد.', 'error');
  }, [u, unitLabel, onChanged, toast]);
  if (!u) return <Empty text="لا وحدة ظاهرة." />;
  const set = <K extends keyof Persona>(k: K, v: Persona[K]) => setP((x) => ({ ...x, [k]: v }));
  const fieldProblem = (f: string) => problems.filter((x) => x.field === f).map((x) => L.PERSONA_PROBLEMS[x.code] ?? x.code);

  async function save() {
    setBusy(true);
    try {
      const r = await L.personaSave(u.id, p);
      setProblems([]);
      const prev = r.previous as Persona;
      setVersion((v) => v + 1);
      toast.undo('حُفظت الشخصية مسودةً؛ لا يراها الضيوف قبل «نشر» بعد نجاح الاختبار.', async () => {
        if (prev && typeof prev.tone === 'number') await L.personaSave(u.id, prev);
        await onChanged();
      });
      await onChanged();
    } catch (e) {
      const pr = L.personaProblemsOf(e);
      if (pr) setProblems(pr);
      else toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  const greetingField = (f: keyof Persona, label: string, lang: 'ar' | 'en') => (
    <Field label={label} id={`persona-${f}`} hint={f.startsWith('greeting_new') ? 'المتغير المسموح: {unit_name}' : 'المتغيران المسموحان: {unit_name} و{first_name}'}>
      <input id={`persona-${f}`} className={`field ${lang === 'en' ? 'latin' : ''}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} maxLength={160} disabled={!edit || busy}
        value={String(p[f] ?? '')} onChange={(e) => set(f, e.target.value as never)} data-field={f} aria-invalid={fieldProblem(f).length > 0} />
      {fieldProblem(f).map((x, i) => <span key={i} className="text-xs media-err block" role="alert">{x}</span>)}
    </Field>
  );

  return (
    <section className="card p-4 grid gap-4" aria-labelledby="persona-h" data-tour="hub-persona" data-hub-persona>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="persona-h" className="text-lg font-bold">الشخصية</h2>
          <p className="text-sm text-ink-muted mt-1">أسلوب الردود وتحية أول رسالة في كل وحدة. لا اسم للمساعد ولا شيء يقدّمه: الرد يتكلم بلسان الفندق («نحن»).</p>
        </div>
        <UnitPicker o={o} value={u.key} onChange={setKey} id="persona-unit" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={`chip ${u.persona_published ? 'chip-confirmed' : 'chip-request'}`} data-persona-state>{u.persona_published ? 'منشورة' : 'لم تُنشر بعد'}</span>
        {u.persona_pending && <span className="chip chip-request" data-persona-pending>تعديلات محفوظة لم تُنشر</span>}
      </div>
      <DirtyScope version={`${u.key}:${version}`} draftKey={`persona:${u.key}`} className="grid gap-4">
        <div>
          <span className="label" id="persona-tone-l">الأسلوب</span>
          <Segmented value={String(p.tone)} onChange={(v) => set('tone', Number(v))} label="الأسلوب" disabled={!edit || busy}
            options={L.TONES.map((t) => ({ value: String(t.step), label: t.label }))} />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
          <input type="checkbox" className="size-4 accent-bronze-deep" checked={p.emoji} disabled={!edit || busy} onChange={(e) => set('emoji', e.target.checked)} data-field="emoji" />
          الرموز التعبيرية في الردود
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          {greetingField('greeting_new_ar', 'تحية ضيف جديد (عربي)', 'ar')}
          {greetingField('greeting_new_en', 'تحية ضيف جديد (إنجليزي)', 'en')}
          {greetingField('greeting_returning_ar', 'تحية ضيف عائد (عربي)', 'ar')}
          {greetingField('greeting_returning_en', 'تحية ضيف عائد (إنجليزي)', 'en')}
        </div>
      </DirtyScope>
      <div className="grid gap-1" data-persona-sample>
        <span className="label">مثال حي</span>
        <div className="kn-bubble" lang="ar" dir="rtl">{fillGreeting(p.greeting_new_ar, unitLabel, null)}{'\n'}نعم، المواقف مجانية للضيوف.</div>
        <div className="kn-bubble" lang="ar" dir="rtl">{fillGreeting(p.greeting_returning_ar, unitLabel, 'سارة')}{'\n'}يسعدنا تواصلك معنا مرة أخرى.</div>
        <p className="text-xs text-ink-muted">الأسلوب «{L.TONES.find((t) => t.step === p.tone)?.label}» يغيّر صياغة الردود نفسها؛ جرّبه في «المحاكي».</p>
      </div>
      {edit && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={save} disabled={busy} data-action="persona-save">{busy && <Spinner />} حفظ</button>
          <button type="button" className="btn btn-primary" onClick={() => setGate(true)} disabled={busy || !u.persona_pending} data-action="persona-publish" data-tour="hub-persona-publish">نشر</button>
        </div>
      )}
      <Modal open={gate} onClose={() => setGate(false)} title={`اختبار قبل نشر شخصية ${unitLabel}`}>
        {gate && <EvalGate kind="persona" unit={u.key} title="نشر الشخصية" onPassed={publishWith} />}
      </Modal>
    </section>
  );
}

// ══════════════════════════════════ «التراخيص» ══════════════════════════════════

export function LicencesPanel({ o }: { o: HubOverview }) {
  const toast = useToast();
  const units = usable(o);
  const [key, setKey] = useState(units[0]?.key ?? '');
  const u = units.find((x) => x.key === key) ?? units[0];
  const [data, setData] = useState<Awaited<ReturnType<typeof L.licences>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [act, setAct] = useState<{ row: L.LicenceRow; to: L.LicenceMode } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!u) return;
    try {
      setError(null);
      setData(await L.licences(u.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [u?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, [load]);
  if (!u) return <Empty text="لا وحدة ظاهرة." />;
  const admin = !!data?.system_admin;
  return (
    <section className="card p-4 grid gap-3 min-w-0" aria-labelledby="lic-h" data-tour="hub-licences" data-hub-licences>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="lic-h" className="text-lg font-bold">التراخيص</h2>
          <p className="text-sm text-ink-muted mt-1">
            في وضع «{MODE_LABELS.licensed}» يرسل المساعد وحده فقط في المواضيع التي عليها «رد تلقائي»، وكل موضوع آخر ينتظر موافقة الفريق. يفعّل الترخيص ويوقفه مدير النظام وحده بيده، ولا يتغير شيء تلقائيًا.
          </p>
        </div>
        <UnitPicker o={o} value={u.key} onChange={setKey} id="lic-unit" />
      </div>
      <p className="text-xs text-ink-muted" data-lic-info>الأرقام لآخر 30 يومًا: <strong>للاطلاع فقط — لا يغيّر الترخيص</strong>.</p>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="overflow-x-auto min-w-0 relative" tabIndex={0} role="region" aria-label="جدول التراخيص">
          <table className="w-full text-sm" data-lic-table>
            <thead>
              <tr className="text-start text-ink-muted">
                <th className="text-start p-2">الموضوع</th><th className="text-start p-2">الترخيص</th><th className="p-2">مسودات</th><th className="p-2">بلا تعديل</th>
                <th className="p-2">مُعدَّلة</th><th className="p-2">مرفوضة</th><th className="p-2">أُبلغ أنها خاطئة</th><th className="p-2"><span className="sr-only">إجراء</span></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.topic} className="border-t border-line" data-lic-row={r.topic} data-lic-mode={r.mode}>
                  <td className="p-2">{r.label_ar}</td>
                  <td className="p-2">
                    <span className={`chip ${r.mode === 'auto' ? 'chip-confirmed' : r.mode === 'blocked' ? 'chip-cancelled' : 'chip-request'}`}>{L.LICENCE_LABELS[r.mode]}</span>
                    {r.mode !== 'shadow' || r.set_by_name ? (
                      <span className="block text-xs text-ink-muted mt-0.5">منذ <span className="num">{longDate(r.since.slice(0, 10))}</span>{r.set_by_name ? ` · ${r.set_by_name}` : ''}{r.reason ? ` · ${r.reason}` : ''}</span>
                    ) : null}
                  </td>
                  <td className="p-2 num text-center">{r.drafts}</td>
                  <td className="p-2 num text-center">{r.approved_unedited}{r.approved_pct !== null ? <span className="text-ink-muted"> ({r.approved_pct}%)</span> : null}</td>
                  <td className="p-2 num text-center">{r.edited}</td>
                  <td className="p-2 num text-center">{r.rejected}</td>
                  <td className="p-2 num text-center">{r.flagged_wrong}</td>
                  <td className="p-2">
                    {r.always_handoff ? <span className="text-xs text-ink-muted">للفريق دائمًا</span>
                      : admin && r.mode === 'shadow' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAct({ row: r, to: 'auto' })} data-action="lic-on" aria-label={`تفعيل الرد التلقائي: ${r.label_ar}`}>تفعيل الرد التلقائي</button>
                      : admin && r.mode === 'auto' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAct({ row: r, to: 'shadow' })} data-action="lic-off" aria-label={`إيقاف الرد التلقائي: ${r.label_ar}`}>إيقاف الرد التلقائي</button>
                      : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!admin && <p className="text-xs text-ink-muted mt-2" data-lic-admin-only>تفعيل الترخيص وإيقافه لمدير النظام وحده.</p>}
        </div>
      )}
      <Modal open={!!act} onClose={() => setAct(null)} title={act?.to === 'auto' ? `تفعيل الرد التلقائي: ${act.row.label_ar}` : `إيقاف الرد التلقائي: ${act?.row.label_ar ?? ''}`} busy={busy}>
        {act && <ReasonForm busy={busy} label={act.to === 'auto' ? 'تفعيل الرد التلقائي' : 'إيقاف الرد التلقائي'}
          note={act.to === 'auto' ? `في وضع «${MODE_LABELS.licensed}» سترسل ردود هذا الموضوع دون موافقة الفريق.` : 'تعود ردود هذا الموضوع لتنتظر موافقة الفريق.'}
          onSubmit={async (reason) => {
            setBusy(true);
            try {
              await L.licenceSet(u.id, act.row.topic, act.to, reason);
              const prev = act.row.mode;
              setAct(null);
              toast.undo(`${act.row.label_ar} — ${L.LICENCE_LABELS[act.to]}`, async () => {
                await L.licenceSet(u.id, act.row.topic, prev, 'تراجع');
                await load();
              });
              await load();
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }} />}
      </Modal>
    </section>
  );
}

function ReasonForm({ busy, label, note, onSubmit }: { busy: boolean; label: string; note?: string; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-3" data-reason-form>
      {note && <p className="text-sm text-ink-muted">{note}</p>}
      <Field label="السبب" id="reason-text">
        <textarea id="reason-text" className="field min-h-20" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} data-field="reason" aria-invalid={!!err} />
      </Field>
      {err && <p className="text-sm media-err" role="alert">{err}</p>}
      <div className="flex justify-end gap-2">
        <CancelButton disabled={busy} />
        <button type="button" className="btn btn-primary" disabled={busy} data-action="reason-save"
          onClick={async () => {
            if (reason.trim().length < 3) return setErr('اكتب السبب (3 أحرف على الأقل).');
            await onSubmit(reason.trim());
          }}>{busy && <Spinner />} {label}</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════ «مختبر الاختبار» ══════════════════════════════════

export function LabPanel({ o, edit, onChanged }: { o: HubOverview; edit: boolean; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [items, setItems] = useState<L.TestItem[] | null>(null);
  const [runs, setRuns] = useState<L.EvalRunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState({ unit: '', language: '', status: 'active', last: '' });
  const [runFor, setRunFor] = useState<string | null>(null);
  const [plan, setPlan] = useState<L.EvalPlan | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [gap, setGap] = useState<L.TestItem | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setError(null);
      const [a, b] = await Promise.all([L.testItems(), L.evalRuns(20)]);
      setItems(a.items);
      setRuns(b.runs);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const active = runs?.find((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  }, [active, runs, load]);
  const shown = useMemo(() => (items ?? []).filter((i) => (!filter.unit || i.unit_key === filter.unit) && (!filter.language || i.language === filter.language)
    && (filter.status === 'all' || i.status === filter.status) && (!filter.last || (filter.last === 'none' ? !i.last : i.last?.status === filter.last))), [items, filter]);

  async function openRun(unit: string) {
    setRunFor(unit);
    setPlan(null);
    try {
      const p = await L.evalPlan('manual', unit || null);
      setPlan(p);
    } catch (e) {
      toast((e as Error).message, 'error');
      setRunFor(null);
    }
  }
  async function start() {
    setBusy(true);
    try {
      const r = await L.evalRun('manual', runFor || null);
      if (!r.ok) toast(r.error === 'hub_eval_cap' ? 'هذا التشغيل يتجاوز ما تبقى من الميزانية، فلم يبدأ.' : r.error === 'hub_eval_busy' ? 'يوجد تشغيل الآن؛ انتظر حتى ينتهي.' : 'تعذّر بدء التشغيل.', 'error');
      else toast('بدأ التشغيل؛ تظهر النتائج هنا حين ينتهي.');
      setRunFor(null);
      await load();
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function retire(i: L.TestItem, on: boolean) {
    try {
      await L.testItemRetire(i.id, on);
      toast.undo(on ? `أُوقف السؤال ${i.key}.` : `أُعيد تفعيل السؤال ${i.key}.`, async () => {
        await L.testItemRetire(i.id, !on);
        await load();
      });
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <section className="grid gap-4" aria-labelledby="lab-h" data-tour="hub-lab" data-hub-lab>
      <div className="card p-4 grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 id="lab-h" className="text-lg font-bold">مختبر الاختبار</h2>
            <p className="text-sm text-ink-muted mt-1">أسئلة تمر على المحرك الحقيقي في وضع التجربة — لا يُرسل شيء ولا يُحجز شيء — ويُصحَّح كل سؤال بالكود: الإجراء المتوقع، والبطاقات، والعبارات المطلوبة والممنوعة، والحارس، واللغة. لا يحكم نموذج بالنجاح أو الرسوب. كل تشغيل يُحسب ضمن الميزانية، وتظهر تكلفته المتوقعة قبل أن يبدأ.</p>
          </div>
          {edit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)} data-action="lab-add">إضافة سؤال</button>
              <button type="button" className="btn btn-primary" onClick={() => openRun('')} disabled={!!active} data-action="lab-run" data-tour="hub-lab-run">تشغيل الآن</button>
            </div>
          )}
        </div>
        <ErrorBox error={error} />
        {active && <p className="note-amber text-sm" role="status" data-lab-active>يعمل تشغيل الآن: <span className="num">{active.items_done} / {active.items_total}</span> · <span className="num">{usd(active.cost_usd)}</span></p>}
      </div>

      <div className="card p-4 grid gap-2" data-lab-runs>
        <h3 className="font-bold">آخر التشغيلات</h3>
        {!runs && <Loading />}
        {runs && !runs.length && <Empty text="لم يُشغَّل المختبر بعد." />}
        <ul className="grid gap-1.5">
          {(runs ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1.5" data-run={r.id} data-run-verdict={r.verdict ?? r.status}>
              <div className="text-sm">
                <strong>{L.TRIGGER_LABELS[r.trigger]}</strong> · {r.units.map((k) => unitName(o, k)).join('، ')} · <span className="num">{riyadhDateTime(r.created_at)}</span>
                <span className="block text-xs text-ink-muted">
                  {L.RUN_STATUS[r.status]}{r.verdict ? ` — ${L.VERDICT_LABELS[r.verdict]}` : ''} · نجح <span className="num">{r.passed}</span> · رسب <span className="num">{r.failed}</span>
                  {r.errors ? <> · أخطاء <span className="num">{r.errors}</span></> : null} · <span className="num">{usd(r.cost_usd)}</span>{r.stop_reason ? ` · ${L.STOP_LABELS[r.stop_reason] ?? r.stop_reason}` : ''}
                </span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetail(r.id)} data-action="run-open">النتائج</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-4 grid gap-3" data-lab-bank>
        <h3 className="font-bold">بنك الأسئلة</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="الوحدة" id="lab-f-unit">
            <select id="lab-f-unit" className="field" value={filter.unit} onChange={(e) => setFilter({ ...filter, unit: e.target.value })}>
              <option value="">كل الوحدات</option>
              {usable(o).map((u) => <option key={u.key} value={u.key}>{u.name_ar}</option>)}
            </select>
          </Field>
          <Field label="اللغة" id="lab-f-lang">
            <select id="lab-f-lang" className="field" value={filter.language} onChange={(e) => setFilter({ ...filter, language: e.target.value })}>
              <option value="">كل اللغات</option><option value="ar">العربية</option><option value="en">الإنجليزية</option>
            </select>
          </Field>
          <Field label="الحالة" id="lab-f-status">
            <select id="lab-f-status" className="field" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="active">مفعّلة</option><option value="retired">موقوفة</option><option value="all">الكل</option>
            </select>
          </Field>
          <Field label="آخر نتيجة" id="lab-f-last">
            <select id="lab-f-last" className="field" value={filter.last} onChange={(e) => setFilter({ ...filter, last: e.target.value })}>
              <option value="">الكل</option><option value="pass">ناجح</option><option value="fail">راسب</option><option value="error">خطأ</option><option value="none">لم يُشغَّل</option>
            </select>
          </Field>
        </div>
        <p className="text-sm text-ink-muted" data-lab-count>{countWord(shown.length, Q)}</p>
        {!items && <Loading />}
        <ul className="grid gap-1.5">
          {shown.map((i) => (
            <li key={i.id} className="border-b border-line pb-2 grid gap-1" data-item={i.key} data-item-last={i.last?.status ?? 'none'}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" lang={i.language} dir={i.language === 'ar' ? 'rtl' : 'ltr'}>{i.messages.join(' ← ')}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <span className="chip num">{i.key}</span>
                    <span className="chip">{unitName(o, i.unit_key)}</span>
                    <span className="chip">{L.ACTION_LABELS[i.expect.action] ?? i.expect.action}</span>
                    {i.router_only && <span className="chip">يعالجه الاستقبال الآلي لا المحرك</span>}
                    {i.last && <span className={`chip ${i.last.status === 'pass' ? 'chip-confirmed' : 'chip-cancelled'}`}>{L.RESULT_LABELS[i.last.status as L.EvalResult['status']] ?? i.last.status}</span>}
                    {i.known_gap && <span className="chip chip-request" title={i.known_gap_reason ?? ''} data-known-gap>فجوة معروفة</span>}
                    {i.status === 'retired' && <span className="chip">موقوف</span>}
                  </div>
                  {i.last && i.last.status !== 'pass' && i.last.reasons.length > 0 && (
                    <p className="text-xs text-ink-muted mt-1">{i.last.reasons.map((r) => L.reasonText(r, i.expect)).join('؛ ')}</p>
                  )}
                </div>
                {edit && (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => (i.known_gap ? L.testItemGap(i.id, false, null).then(load).catch((e) => toast((e as Error).message, 'error')) : setGap(i))} data-action="item-gap">
                      {i.known_gap ? 'إلغاء «فجوة معروفة»' : 'فجوة معروفة'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => retire(i, i.status === 'active')} data-action="item-retire" aria-label={`${i.status === 'active' ? 'إيقاف' : 'إعادة تفعيل'} السؤال ${i.key}`}>
                      {i.status === 'active' ? 'إيقاف السؤال' : 'إعادة تفعيله'}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Modal open={runFor !== null} onClose={() => setRunFor(null)} title="تشغيل مختبر الاختبار" busy={busy}>
        {runFor !== null && (
          <div className="grid gap-3" data-lab-plan>
            <UnitPicker o={o} value={runFor} onChange={(v) => void openRun(v)} id="lab-run-unit" all />
            {!plan ? <Loading label="نحسب التكلفة…" /> : (
              <>
                <p className="text-sm">سيُشغَّل <strong>{countWord(plan.items, Q)}</strong>. التكلفة المتوقعة: <span className="num" data-plan-cost>{usd(plan.est_cost_usd)}</span> تقريبًا، تُحسب ضمن ميزانية المساعد.</p>
                {plan.would_pass_cap && <p className="note-amber text-sm" role="status" data-plan-cap>يتجاوز هذا التشغيل ما تبقى من الميزانية، فلا يبدأ.</p>}
              </>
            )}
            <div className="flex justify-end gap-2">
              <CancelButton disabled={busy} />
              <button type="button" className="btn btn-primary" onClick={start} disabled={busy || !plan || plan.would_pass_cap || !plan.items} data-action="lab-start" data-autofocus>{busy && <Spinner />} تشغيل</button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title="نتائج التشغيل">
        {detail && <RunDetail id={detail} o={o} />}
      </Modal>
      <Modal open={adding} onClose={() => setAdding(false)} wide title="إضافة سؤال اختبار" busy={busy} draftKey="lab:new">
        {adding && <ItemForm o={o} busy={busy} setBusy={setBusy} initial={null} onSaved={async () => { setAdding(false); await load(); }} />}
      </Modal>
      <Modal open={!!gap} onClose={() => setGap(null)} title={`فجوة معروفة: ${gap?.key ?? ''}`} busy={busy}>
        {gap && <ReasonForm busy={busy} label="اعتبارها فجوة معروفة" note="سؤال معروف أن المساعد لا يجيبه بعد. لا يمنع «بموافقة الفريق» ولا النشر، ويبقى في التقارير."
          onSubmit={async (reason) => {
            setBusy(true);
            try {
              await L.testItemGap(gap.id, true, reason);
              const g = gap;
              setGap(null);
              toast.undo(`${g.key} — فجوة معروفة`, async () => {
                await L.testItemGap(g.id, false, null);
                await load();
              });
              await load();
              await onChanged();
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }} />}
      </Modal>
    </section>
  );
}

function RunDetail({ id, o }: { id: string; o: HubOverview }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof L.evalRunDetail>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<'fail' | 'all'>('fail');
  useEffect(() => {
    L.evalRunDetail(id).then(setD).catch((e) => setError((e as Error).message));
  }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const rows = d.results.filter((r) => only === 'all' || r.status !== 'pass');
  return (
    <div className="grid gap-3" data-run-detail>
      <p className="text-sm">{L.TRIGGER_LABELS[d.run.trigger]} · {L.RUN_STATUS[d.run.status]}{d.run.verdict ? ` — ${L.VERDICT_LABELS[d.run.verdict]}` : ''} · نجح <span className="num">{d.run.passed}</span> · رسب <span className="num">{d.run.failed}</span> · <span className="num">{usd(d.run.cost_usd)}</span></p>
      <Segmented value={only} onChange={setOnly} label="الأسئلة المعروضة" options={[{ value: 'fail', label: 'غير الناجحة' }, { value: 'all', label: 'الكل' }]} />
      {!rows.length && <Empty text="لا شيء هنا." />}
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className="border-b border-line pb-2 grid gap-1" data-result={r.item_key} data-result-status={r.status}>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="chip num">{r.item_key}</span>
              <span className="chip">{unitName(o, r.unit)}</span>
              {r.config === 'candidate' && <span className="chip">النسخة الجديدة</span>}
              {r.config === 'live' && d.run.trigger !== 'manual' && d.run.trigger !== 'baseline' && <span className="chip">النسخة الحالية</span>}
              <span className={`chip ${r.status === 'pass' ? 'chip-confirmed' : 'chip-cancelled'}`}>{L.RESULT_LABELS[r.status]}</span>
              {r.known_gap && <span className="chip chip-request">فجوة معروفة</span>}
            </div>
            <p className="text-sm font-semibold" lang={r.language} dir={r.language === 'ar' ? 'rtl' : 'ltr'}>{r.messages.join(' ← ')}</p>
            {r.reasons.length > 0 && <p className="text-xs media-err">{r.reasons.map((x) => L.reasonText(x, r.expect)).join('؛ ')}</p>}
            {r.replies.map((x, i) => <div key={i} className="kn-bubble text-sm" lang={r.language} dir={r.language === 'ar' ? 'rtl' : 'ltr'}>{x}</div>)}
          </li>
        ))}
      </ul>
      <div className="flex justify-end"><CancelButton label="إغلاق" /></div>
    </div>
  );
}

const ACTIONS = ['answer', 'handoff', 'ask', 'booking_status', 'greeting', 'refuse', 'third_language'];
function ItemForm({ o, busy, setBusy, initial, onSaved }: {
  o: HubOverview; busy: boolean; setBusy: (b: boolean) => void;
  initial: { unit_key: string; language: 'ar' | 'en'; messages: string[]; action: string; cards: string[] } | null; onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    unit_key: initial?.unit_key ?? usable(o)[0]?.key ?? 'airport-road', language: initial?.language ?? ('ar' as 'ar' | 'en'),
    messages: (initial?.messages ?? ['']).join('\n'), action: initial?.action ?? 'answer', cards: (initial?.cards ?? []).join(', '),
    must_include: '', must_not_include: '', note: '',
  }));
  const [err, setErr] = useState<string | null>(null);
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  async function save() {
    setErr(null);
    const msgs = lines(f.messages);
    if (!msgs.length) return setErr('اكتب رسالة الضيف.');
    setBusy(true);
    try {
      const expect: Record<string, unknown> = { action: f.action };
      const cards = f.cards.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      if (cards.length) expect.cards = cards;
      if (lines(f.must_include).length) expect.must_include = lines(f.must_include);
      if (lines(f.must_not_include).length) expect.must_not_include = lines(f.must_not_include);
      await L.testItemSave(null, { unit_key: f.unit_key, language: f.language, messages: msgs, expect, note: f.note, added_from: initial ? 'simulator' : 'staff' });
      toast('أُضيف السؤال إلى البنك؛ يدخل التشغيل التالي.');
      setBusy(false);
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3" data-item-form>
      <div className="grid sm:grid-cols-3 gap-3">
        <UnitPicker o={o} value={f.unit_key} onChange={(v) => setF({ ...f, unit_key: v })} id="item-unit" />
        <Field label="اللغة" id="item-lang">
          <select id="item-lang" className="field" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as 'ar' | 'en' })} disabled={busy}>
            <option value="ar">العربية</option><option value="en">الإنجليزية</option>
          </select>
        </Field>
        <Field label="المتوقع" id="item-action">
          <select id="item-action" className="field" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} disabled={busy} data-field="action">
            {ACTIONS.map((a) => <option key={a} value={a}>{L.ACTION_LABELS[a]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="رسائل الضيف (سطر لكل رسالة)" id="item-messages">
        <textarea id="item-messages" className="field min-h-24" dir={f.language === 'ar' ? 'rtl' : 'ltr'} value={f.messages} onChange={(e) => setF({ ...f, messages: e.target.value })} disabled={busy} data-field="messages" />
      </Field>
      <Field label="البطاقات المطلوبة (معرّفاتها، اختياري)" id="item-cards" hint="مثل k-parking-detail">
        <input id="item-cards" className="field latin" dir="ltr" value={f.cards} onChange={(e) => setF({ ...f, cards: e.target.value })} disabled={busy} data-field="cards" />
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="عبارات يجب أن تظهر (سطر لكل عبارة)" id="item-must">
          <textarea id="item-must" className="field min-h-16" value={f.must_include} onChange={(e) => setF({ ...f, must_include: e.target.value })} disabled={busy} data-field="must_include" />
        </Field>
        <Field label="عبارات ممنوعة (سطر لكل عبارة)" id="item-mustnot">
          <textarea id="item-mustnot" className="field min-h-16" value={f.must_not_include} onChange={(e) => setF({ ...f, must_not_include: e.target.value })} disabled={busy} data-field="must_not_include" />
        </Field>
      </div>
      <Field label="ملاحظة (اختياري)" id="item-note">
        <input id="item-note" className="field" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} disabled={busy} />
      </Field>
      {err && <p className="text-sm media-err" role="alert">{err}</p>}
      <div className="flex justify-end gap-2">
        <CancelButton disabled={busy} />
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="item-save">{busy && <Spinner />} حفظ السؤال</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════ «المحاكي» ══════════════════════════════════

type SimTurn = { guest: string; r: L.SimResult | null; error?: string };
export function SimulatorPanel({ o, editingPersona }: { o: HubOverview; editingPersona: Record<string, Persona> }) {
  const toast = useToast();
  const units = usable(o);
  const [key, setKey] = useState(units[0]?.key ?? '');
  const u = units.find((x) => x.key === key) ?? units[0];
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [drafts, setDrafts] = useState(false);
  const [persona, setPersona] = useState<'live' | 'editing'>('live');
  const [sim, setSim] = useState<L.SimState>(L.freshSim());
  const [turns, setTurns] = useState<SimTurn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const reset = () => {
    setSim(L.freshSim());
    setTurns([]);
    setOpen(null);
  };
  useEffect(reset, [key]);
  if (!u) return <Empty text="لا وحدة ظاهرة." />;
  const total = turns.reduce((s, t) => s + (t.r?.cost_usd ?? 0), 0);

  async function send() {
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(true);
    setText('');
    const i = turns.length;
    setTurns((x) => [...x, { guest: msg, r: null }]);
    try {
      const r = await L.simulate(u.key, msg, sim, language, drafts, persona === 'editing' ? editingPersona[u.key] ?? null : null);
      if (!r.ok) {
        setTurns((x) => x.map((t, j) => (j === i ? { ...t, error: L.SIM_ERRORS[r.error ?? ''] ?? 'تعذّر تشغيل المحاكي.' } : t)));
      } else {
        setTurns((x) => x.map((t, j) => (j === i ? { ...t, r } : t)));
        setSim(r.sim);
        setOpen(i);
      }
    } catch (e) {
      setTurns((x) => x.map((t, j) => (j === i ? { ...t, error: (e as Error).message } : t)));
    } finally {
      setBusy(false);
    }
  }
  const last = [...turns].reverse().find((t) => t.r)?.r ?? null;
  const shownTurn = open !== null ? turns[open] : null;
  const outcomeAction = (r: L.SimResult | null) => {
    if (!r) return 'answer';
    if (r.decision.to === 'human') return 'handoff';
    if (r.decision.actions.includes('booking_status')) return 'booking_status';
    if (r.decision.transitions.includes('T4')) return 'greeting';
    return 'answer';
  };

  return (
    <section className="grid gap-4" aria-labelledby="sim-h" data-tour="hub-sim" data-hub-sim>
      <div className="card p-4 grid gap-3">
        <div>
          <h2 id="sim-h" className="text-lg font-bold">المحاكي</h2>
          <p className="text-sm text-ink-muted mt-1">محادثة تجريبية مع المحرك الحقيقي لوحدة واحدة، في وضع التجربة دائمًا: لا يُرسل شيء لأحد ولا يُنشأ حجز. كل رسالة تُحسب ضمن الميزانية (مصدر «المحاكي»).</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4 items-end">
          <UnitPicker o={o} value={u.key} onChange={setKey} id="sim-unit" />
          <Field label="لغة الضيف" id="sim-lang">
            <select id="sim-lang" className="field" value={language} onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}>
              <option value="ar">العربية</option><option value="en">الإنجليزية</option>
            </select>
          </Field>
          <Field label="الشخصية" id="sim-persona">
            <select id="sim-persona" className="field" value={persona} onChange={(e) => setPersona(e.target.value as 'live' | 'editing')} data-field="sim-persona">
              <option value="live">المنشورة</option>
              <option value="editing">ما في «الشخصية» الآن (غير منشور)</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
            <input type="checkbox" className="size-4 accent-bronze-deep" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} data-field="sim-drafts" />
            اقرأ البطاقات غير المنشورة
          </label>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="sim-phone" data-sim-phone>
          <div className="sim-phone-top">{u.name_ar} · <span className="text-xs">تجربة</span></div>
          <div className="sim-phone-body" aria-live="polite" data-sim-thread>
            {!turns.length && <p className="text-xs text-ink-muted text-center p-4">اكتب رسالة كما يكتبها الضيف.</p>}
            {turns.map((t, i) => (
              <div key={i} className="grid gap-1">
                <div className="sim-bubble sim-guest" lang={language} dir="auto" data-sim-guest>{t.guest}</div>
                {t.error && <div className="sim-bubble sim-error" role="alert">{t.error}</div>}
                {!t.r && !t.error && <div className="sim-bubble sim-us"><Spinner /></div>}
                {t.r?.replies.map((m, j) => (
                  <button key={j} type="button" className={`sim-bubble sim-us text-start ${open === i ? 'is-on' : ''}`} onClick={() => setOpen(i)} lang={language} dir="auto" data-sim-reply data-notice={m.notice || undefined}>
                    {m.body}
                    {m.buttons.length > 0 && <span className="sim-buttons">{m.buttons.map((b) => <span key={b} className="sim-btn">{b}</span>)}</span>}
                  </button>
                ))}
                {t.r && !t.r.replies.length && <button type="button" className="sim-bubble sim-note text-start" onClick={() => setOpen(i)}>لا رد — {t.r.decision.to === 'human' ? 'المحادثة للفريق' : 'لا شيء يُرسل'}</button>}
              </div>
            ))}
          </div>
          <div className="sim-phone-input">
            <label htmlFor="sim-text" className="sr-only">رسالة الضيف</label>
            <input id="sim-text" className="field" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} dir="auto" data-field="sim-text" />
            <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !text.trim()} data-action="sim-send">{busy && <Spinner />} إرسال</button>
          </div>
        </div>
        <div className="card p-4 grid gap-3 content-start" data-sim-details>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">ما حدث في الرد</h3>
            <div className="flex flex-wrap gap-2">
              <span className="text-sm">التكلفة حتى الآن: <span className="num" data-sim-cost>{usd(total)}</span></span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy} data-action="sim-reset">إعادة البدء</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving(true)} disabled={busy || !last} data-action="sim-save">حفظ كسؤال اختبار</button>
            </div>
          </div>
          {!shownTurn?.r ? <p className="text-sm text-ink-muted">اختر ردًا لترى تفاصيله.</p> : <SimDetails r={shownTurn.r} />}
        </div>
      </div>
      <Modal open={saving} onClose={() => setSaving(false)} wide title="حفظ كسؤال اختبار" busy={formBusy} draftKey={`sim-save:${u.key}`}>
        {saving && (
          <ItemForm o={o} busy={formBusy} setBusy={setFormBusy}
            initial={{ unit_key: u.key, language, messages: turns.filter((t) => t.r).map((t) => t.guest), action: outcomeAction(last), cards: [...new Set(turns.flatMap((t) => t.r?.sources.cards.map((c) => c.key) ?? []))] }}
            onSaved={async () => { setSaving(false); toast('حُفظ السؤال في «مختبر الاختبار».'); }} />
        )}
      </Modal>
    </section>
  );
}

function SimDetails({ r }: { r: L.SimResult }) {
  const u = (r.understanding ?? {}) as Record<string, unknown>;
  const keys = ['intents', 'topics', 'branch', 'check_in', 'check_out', 'adults', 'children', 'room_type', 'breakfast', 'language', 'complaint', 'new_topic_hint'];
  const LABELS: Record<string, string> = { intents: 'النية', topics: 'المواضيع', branch: 'الفرع', check_in: 'الوصول', check_out: 'المغادرة', adults: 'البالغون', children: 'الأطفال',
    room_type: 'نوع الغرفة', breakfast: 'الإفطار', language: 'اللغة', complaint: 'شكوى', new_topic_hint: 'موضوع جديد مقترح' };
  const v = (x: unknown) => (x === null || x === undefined || (Array.isArray(x) && !x.length) ? '—' : Array.isArray(x) ? x.join('، ') : typeof x === 'boolean' ? (x ? 'نعم' : 'لا') : String(x));
  return (
    <div className="grid gap-3 text-sm" data-sim-detail>
      <div>
        <h4 className="label">الفهم</h4>
        {r.understanding ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-0.5" data-sim-understanding>
            {keys.map((k) => <div key={k} className="contents"><dt className="text-ink-muted">{LABELS[k]}</dt><dd className="latin-ok" dir="auto">{v(u[k])}</dd></div>)}
          </dl>
        ) : <p className="text-ink-muted">لا فهم لهذه الرسالة (وسائط أو زر).</p>}
      </div>
      <div data-sim-decision>
        <h4 className="label">القرار</h4>
        <p>{L.STATE_LABELS[r.decision.from] ?? r.decision.from} ← {L.STATE_LABELS[r.decision.to] ?? r.decision.to}</p>
        <p className="text-ink-muted">{r.decision.actions.map((a) => L.ACTION_CODE_LABELS[a] ?? a).join('، ') || '—'} · <span className="num latin" dir="ltr">{r.decision.transitions.join(' ')}</span>{r.decision.reason ? ` · ${r.decision.reason}` : ''}</p>
        {r.note && <p className="text-xs text-ink-muted mt-1">ملاحظة التحويل: {r.note}</p>}
      </div>
      <div data-sim-sources>
        <h4 className="label">المصادر</h4>
        {r.sources.cards.length ? <ul className="list-disc ps-5">{r.sources.cards.map((c) => <li key={c.key}>{c.title} <span className="num latin text-xs" dir="ltr">{c.key}</span></li>)}</ul> : <p className="text-ink-muted">لم يستند الرد إلى بطاقة.</p>}
        {r.sources.faq.length > 0 && <p className="text-xs text-ink-muted mt-1">قُرئ من الأسئلة الشائعة: {r.sources.faq.map((f) => f.q).join('؛ ')}</p>}
        {r.sources.read.length > r.sources.cards.length && <p className="text-xs text-ink-muted mt-1">بطاقات قُرئت ولم تُستخدم: {r.sources.read.filter((c) => !r.sources.cards.some((x) => x.key === c.key)).map((c) => c.title).join('؛ ')}</p>}
      </div>
      <div data-sim-guard>
        <h4 className="label">الحارس</h4>
        <p>{r.guard.ok ? (r.guard.refusals.length ? 'رفض المحاولة الأولى ثم قبل الرد.' : 'قبل الرد من أول محاولة.') : 'رفض الرد مرتين فحُوّلت المحادثة للفريق.'}</p>
        {r.guard.refusals.length > 0 && <p className="text-xs text-ink-muted latin" dir="ltr">{r.guard.refusals.map((x) => x.join(', ')).join(' | ')}</p>}
      </div>
      <p>تكلفة هذا الرد: <span className="num">{usd(r.cost_usd)}</span></p>
    </div>
  );
}
