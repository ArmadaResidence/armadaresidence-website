// «رادار الأسئلة» — Guest Hub H6 (14 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §5.7, §4.7; DECISIONS.md 2026-11-14
// «Guest Hub H6»). What guests ask, by topic: this week (from Sunday, Riyadh), this month, or a custom range (the site's
// date picker); filters by unit and channel. Per topic: asked, answered by the assistant, handed off, unanswered, the
// trend against the previous period of the same length, a red mark on a spike (hub_spike_factor × the daily average and
// at least hub_spike_min in 24 hours — the alert email goes to the admins). Samples of the questions only for the units
// the user's team reads (the server decides — internal.can_unit). Proposed topics (a new_topic_hint repeated) to accept,
// merge or dismiss (knowledge: edit). One click from a topic to «إنشاء بطاقة» with an optional FAQ draft.
// Counts only, test rows never; a turn of «تجربة» counts as asked (the assistant answered nobody).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { addDays, countWord, longDate, riyadhToday, type CountNoun } from '../lib/format';
import { phoneText } from '../lib/hub';
import * as L from '../lib/lab';
import DateField from '../components/DateField';
import { CancelButton, Empty, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';

const TIMES: CountNoun = { zero: 'لا مرات', one: 'مرة واحدة', two: 'مرتان', few: 'مرات', many: 'مرة', gen: 'مرة' };
type Period = 'week' | 'month' | 'custom';

function periodOf(p: Period, custom: { from: string; to: string }): { from: string; to: string } {
  const today = riyadhToday();
  if (p === 'custom') return custom;
  if (p === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  const dow = new Date(today + 'T00:00:00Z').getUTCDay(); // 0 = Sunday — the week starts on Sunday
  return { from: addDays(today, -dow), to: today };
}

export default function Radar() {
  const { me } = useSession();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('week');
  const [custom, setCustom] = useState(() => ({ from: addDays(riyadhToday(), -29), to: riyadhToday() }));
  const [unit, setUnit] = useState('');
  const [channel, setChannel] = useState('');
  const [r, setR] = useState<L.Radar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hint, setHint] = useState<{ hint: string; action: 'accept' | 'merge' } | null>(null);
  const [busy, setBusy] = useState(false);
  const range = useMemo(() => periodOf(period, custom), [period, custom]);
  const knowledgeEdit = api.canEdit(me, 'knowledge');

  const load = useCallback(async () => {
    try {
      setError(null);
      setR(await L.radar(range.from, range.to, unit || null, channel || null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [range, unit, channel]);
  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(h: string) {
    try {
      await L.hintDecide(h, { action: 'dismiss' });
      toast('تجاهلنا هذا الموضوع المقترح.');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="grid gap-5 max-w-6xl min-w-0 [&>*]:min-w-0" data-page="radar">
      <div>
        <h1 className="text-2xl font-bold">رادار الأسئلة</h1>
        <p className="text-sm text-ink-muted mt-1">ما يسأل عنه الضيوف في واتساب، مرتّبًا بالمواضيع: كم سُئل، وكم أجاب المساعد، وكم حُوّل للفريق، وكم لم يجد له جوابًا. أرقام فقط؛ نص الأسئلة لفريق الوحدة وحده.</p>
      </div>
      <div className="card p-3 grid gap-3 sm:grid-cols-4 items-end" data-tour="radar-filters">
        <div className="sm:col-span-2">
          <span className="label">الفترة</span>
          <Segmented value={period} onChange={setPeriod} label="الفترة" options={[{ value: 'week', label: 'هذا الأسبوع' }, { value: 'month', label: 'هذا الشهر' }, { value: 'custom', label: 'فترة أخرى' }]} />
        </div>
        <Field label="الوحدة" id="radar-unit">
          <select id="radar-unit" className="field" value={unit} onChange={(e) => { setUnit(e.target.value); setChannel(''); }} data-field="radar-unit">
            <option value="">كل الوحدات</option>
            {(r?.units ?? []).map((u) => <option key={u.key} value={u.key}>{u.name_ar}</option>)}
          </select>
        </Field>
        <Field label="القناة" id="radar-channel">
          <select id="radar-channel" className="field" value={channel} onChange={(e) => setChannel(e.target.value)} data-field="radar-channel">
            <option value="">كل القنوات</option>
            {(r?.channels ?? []).filter((c) => !unit || c.unit === unit).map((c) => <option key={c.id} value={c.id}>واتساب {phoneText(c.address)}</option>)}
          </select>
        </Field>
        {period === 'custom' && (
          <div className="sm:col-span-4 min-w-[280px]">
            <DateField mode="range" label="من" endLabel="إلى" start={custom.from} end={custom.to} min="past" max={riyadhToday()} id="radar-range" onChange={(a, b) => a && b && setCustom({ from: a, to: b })} />
          </div>
        )}
      </div>
      <ErrorBox error={error} />
      {!r && !error && <Loading />}
      {r && (
        <>
          <p className="text-sm text-ink-muted" data-radar-range>
            من <span className="num">{longDate(r.from)}</span> إلى <span className="num">{longDate(r.to)}</span>، والمقارنة بالفترة السابقة من <span className="num">{longDate(r.previous_from)}</span> إلى <span className="num">{longDate(r.previous_to)}</span>.
          </p>
          <section className="card p-0 overflow-x-auto min-w-0 relative" aria-label="المواضيع" tabIndex={0} data-tour="radar-table">
            {!r.rows.length ? <div className="p-4"><Empty text="لا أسئلة في هذه الفترة." /></div> : (
              <table className="w-full text-sm" data-radar-table>
                <thead>
                  <tr className="text-ink-muted">
                    <th className="text-start p-2">الموضوع</th><th className="p-2">سُئل</th><th className="p-2">أجاب المساعد</th><th className="p-2">حُوّل للفريق</th>
                    <th className="p-2">لم يجد جوابًا</th><th className="p-2">مقارنة بالفترة السابقة</th><th className="p-2"><span className="sr-only">إجراء</span></th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.topic} className="border-t border-line align-top" data-radar-row={x.topic} data-spike={x.spike || undefined}>
                      <td className="p-2">
                        <div className="font-semibold">{x.label_ar}{x.spike && <span className="chip chip-cancelled ms-2" data-spike-mark>ارتفاع مفاجئ</span>}</div>
                        {x.always_handoff && <div className="text-xs text-ink-muted">للفريق دائمًا</div>}
                        {x.samples.length > 0 && (
                          <button type="button" className="inbox-link text-xs" onClick={() => setOpen(open === x.topic ? null : x.topic)} aria-expanded={open === x.topic} data-action="radar-samples">
                            {open === x.topic ? 'إخفاء الأمثلة' : 'أمثلة من الأسئلة'}
                          </button>
                        )}
                        {open === x.topic && <ul className="mt-1 grid gap-1" data-radar-samples>{x.samples.map((s, i) => <li key={i} className="kn-bubble text-xs" dir="auto">«{s}»</li>)}</ul>}
                      </td>
                      <td className="p-2 num text-center">{x.asked}</td>
                      <td className="p-2 num text-center">{x.answered}</td>
                      <td className="p-2 num text-center">{x.handed_off}</td>
                      <td className="p-2 num text-center">{x.unanswered}</td>
                      <td className="p-2 text-center" data-trend>
                        {x.trend_pct === null ? <span className="text-ink-muted">{x.previous ? '—' : 'جديد'}</span>
                          : <span className={x.trend_pct > 0 ? 'text-error' : x.trend_pct < 0 ? 'text-ok' : ''}><span className="num">{x.trend_pct > 0 ? '+' : ''}{x.trend_pct}%</span></span>}
                        <span className="block text-xs text-ink-muted">قبلها {countWord(x.previous, TIMES)}</span>
                      </td>
                      <td className="p-2">
                        {knowledgeEdit && <Link className="btn btn-ghost btn-sm" to={`/knowledge?new=${encodeURIComponent(x.topic)}&faq=1`} data-action="radar-card">إنشاء بطاقة</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <p className="text-xs text-ink-muted">الارتفاع المفاجئ: موضوع سُئل خلال 24 ساعة أكثر من <span className="num">{r.spike.factor}</span> أضعاف معدله اليومي في الأسابيع الأربعة السابقة، و<span className="num">{r.spike.min}</span> مرات على الأقل. يصل تنبيهه بالبريد لمدير النظام.</p>
          <section className="card p-4 grid gap-2" aria-labelledby="radar-proposed-h" data-tour="radar-proposed" data-radar-proposed>
            <h2 id="radar-proposed-h" className="font-bold">مواضيع مقترحة</h2>
            <p className="text-sm text-ink-muted">مواضيع جديدة لاحظها الفهم ثلاث مرات على الأقل في آخر 30 يومًا ولا تطابق موضوعًا موجودًا.</p>
            {!r.proposed.length && <Empty text="لا مواضيع مقترحة الآن." />}
            <ul className="grid gap-1.5">
              {r.proposed.map((p) => (
                <li key={p.hint} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1.5" data-hint={p.hint}>
                  <span><span className="latin" dir="ltr">{p.hint}</span> · {countWord(p.count, TIMES)}</span>
                  {r.can_decide && (
                    <span className="flex flex-wrap gap-1.5">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHint({ hint: p.hint, action: 'accept' })} data-action="hint-accept">قبول</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHint({ hint: p.hint, action: 'merge' })} data-action="hint-merge">دمج في موضوع</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dismiss(p.hint)} data-action="hint-dismiss" aria-label={`تجاهل الموضوع المقترح ${p.hint}`}>تجاهل</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <Modal open={!!hint} onClose={() => setHint(null)} title={hint?.action === 'accept' ? 'قبول موضوع مقترح' : 'دمج في موضوع موجود'} busy={busy} draftKey={hint ? `hint:${hint.hint}` : undefined}>
        {hint && r && <HintForm hint={hint.hint} action={hint.action} topics={r.rows} busy={busy} setBusy={setBusy} onDone={async () => { setHint(null); await load(); }} />}
      </Modal>
    </div>
  );
}

function HintForm({ hint, action, topics, busy, setBusy, onDone }: { hint: string; action: 'accept' | 'merge'; topics: L.RadarRow[]; busy: boolean; setBusy: (b: boolean) => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ key: hint.replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 60), label_ar: '', label_en: hint.slice(0, 80), parent_key: '', topic_key: '' });
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState<{ key: string; label_ar: string; parent_key: string | null }[]>([]);
  useEffect(() => {
    // every active topic (the knowledge base's list), for the parent and the merge
    import('../lib/knowledge').then((K) => K.meta()).then((m) => setAll(m.topics)).catch(() => setAll(topics.map((t) => ({ key: t.topic, label_ar: t.label_ar, parent_key: t.parent_key }))));
  }, [topics]);
  async function go() {
    setErr(null);
    setBusy(true);
    try {
      if (action === 'accept') await L.hintDecide(hint, { action: 'accept', key: f.key, label_ar: f.label_ar, label_en: f.label_en, parent_key: f.parent_key || null });
      else {
        if (!f.topic_key) {
          setBusy(false);
          return setErr('اختر الموضوع.');
        }
        await L.hintDecide(hint, { action: 'merge', topic_key: f.topic_key });
      }
      toast(action === 'accept' ? 'أُضيف الموضوع؛ يبدأ ترخيصه «بموافقة الفريق».' : 'دُمج الموضوع المقترح.');
      setBusy(false);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3" data-hint-form={action}>
      <p className="text-sm">الموضوع المقترح: <span className="latin" dir="ltr">{hint}</span></p>
      {action === 'accept' ? (
        <>
          <Field label="المعرّف" id="hint-key" hint="حروف إنجليزية صغيرة وأرقام وشرطة سفلية">
            <input id="hint-key" className="field latin" dir="ltr" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} disabled={busy} data-field="hint-key" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="الاسم بالعربية" id="hint-ar"><input id="hint-ar" className="field" value={f.label_ar} onChange={(e) => setF({ ...f, label_ar: e.target.value })} disabled={busy} data-field="hint-ar" /></Field>
            <Field label="الاسم بالإنجليزية" id="hint-en"><input id="hint-en" className="field latin" dir="ltr" value={f.label_en} onChange={(e) => setF({ ...f, label_en: e.target.value })} disabled={busy} data-field="hint-en" /></Field>
          </div>
          <Field label="تحت موضوع (اختياري)" id="hint-parent">
            <select id="hint-parent" className="field" value={f.parent_key} onChange={(e) => setF({ ...f, parent_key: e.target.value })} disabled={busy}>
              <option value="">موضوع رئيسي</option>
              {all.filter((t) => !t.parent_key).map((t) => <option key={t.key} value={t.key}>{t.label_ar}</option>)}
            </select>
          </Field>
        </>
      ) : (
        <Field label="الموضوع" id="hint-topic">
          <select id="hint-topic" className="field" value={f.topic_key} onChange={(e) => setF({ ...f, topic_key: e.target.value })} disabled={busy} data-field="hint-topic">
            <option value="">اختر موضوعًا…</option>
            {all.map((t) => <option key={t.key} value={t.key}>{t.label_ar}</option>)}
          </select>
        </Field>
      )}
      {err && <p className="text-sm media-err" role="alert">{err}</p>}
      <div className="flex justify-end gap-2">
        <CancelButton disabled={busy} />
        <button type="button" className="btn btn-primary" onClick={go} disabled={busy} data-action="hint-save">{busy && <Spinner />} {action === 'accept' ? 'قبول' : 'دمج'}</button>
      </div>
    </div>
  );
}
