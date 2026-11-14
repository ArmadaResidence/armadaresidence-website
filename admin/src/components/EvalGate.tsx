// The test lab's gate before a publish (Guest Hub H6, 14 Nov 2026; spec §4.8, §5.4): «نشر» in «قاعدة المعرفة» and in
// «الشخصية» first shows what the run will judge and its estimated cost (USD, counted in the hub budget), then runs the
// bank on the candidate, shows its progress, and hands back the run id once its verdict is pass. A blocked run lists the
// questions that passed on the live configuration and fail on the candidate; the known gaps (failing on both) are listed
// apart and never block. Nothing is published here: the caller publishes with the run id (the server checks it again).
import { useEffect, useRef, useState } from 'react';
import { countWord, type CountNoun } from '../lib/format';
import { usd } from '../lib/hub';
import * as L from '../lib/lab';
import { CancelButton, Spinner } from './ui';

const Q: CountNoun = { zero: 'لا أسئلة', one: 'سؤال واحد', two: 'سؤالان', few: 'أسئلة', many: 'سؤالًا', gen: 'سؤال' };

export default function EvalGate({ kind, unit, title, onPassed }: { kind: 'knowledge' | 'persona'; unit?: string | null; title: string; onPassed: (run: string) => Promise<void> }) {
  const [plan, setPlan] = useState<L.EvalPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Awaited<ReturnType<typeof L.evalRunDetail>> | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    L.evalPlan(kind, unit).then((p) => (!p || p.ok === false ? setError(L.SIM_ERRORS[p?.error ?? ''] ?? 'تعذّر حساب التكلفة الآن.') : setPlan(p))).catch((e) => setError((e as Error).message));
  }, [kind, unit]);

  // the run's progress, every 3 s until it ends
  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await L.evalRunDetail(runId);
        if (stop) return;
        setRun(r);
        if (r.run.status === 'done' && r.run.verdict === 'pass' && !done.current) {
          done.current = true;
          setBusy(true);
          await onPassed(runId);
          setBusy(false);
          return;
        }
        if (['queued', 'running'].includes(r.run.status)) setTimeout(tick, 3000);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [runId, onPassed]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await L.evalRun(kind, unit);
      if (!r.ok || !r.run_id) setError(r.error === 'hub_eval_cap' ? 'هذا التشغيل يتجاوز ما تبقى من الميزانية، فلم يبدأ.' : r.error === 'hub_eval_busy' ? 'يوجد تشغيل لمختبر الاختبار الآن؛ انتظر حتى ينتهي.' : 'تعذّر بدء الاختبار.');
      else setRunId(r.run_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const r = run?.run;
  const blocked = (r?.blocked ?? []).map((b) => b.key);
  const resultsOf = (key: string) => (run?.results ?? []).filter((x) => x.item_key === key);
  return (
    <div className="grid gap-3" data-eval-gate={kind}>
      <p className="text-sm text-ink-muted">
        قبل {title} تمر أسئلة الاختبار على النسخة الجديدة. يتوقف النشر إذا رسب سؤال كان ينجح في النسخة الحالية؛ والأسئلة الراسبة في النسختين «فجوات معروفة» لا توقفه.
      </p>
      {!plan && !error && <p className="text-sm"><Spinner /> نحسب ما سيُختبر…</p>}
      {plan && !runId && (
        <div className="grid gap-2" data-eval-plan>
          <p className="text-sm">
            سيُختبر <strong>{countWord(plan.items ?? 0, Q)}</strong>
            {plan.kind === 'knowledge' && <> تتأثر بالبطاقات الجديدة</>}
            {plan.live_items ? <> (و{countWord(plan.live_items, Q)} على النسخة الحالية للمقارنة)</> : null}.
          </p>
          <p className="text-sm" data-eval-cost>التكلفة المتوقعة: <span className="num">{usd(plan.est_cost_usd)}</span> تقريبًا، وتُحسب ضمن ميزانية المساعد.</p>
          {plan.would_pass_cap && <p className="note-amber text-sm" role="status" data-eval-cap>هذا التشغيل يتجاوز ما تبقى من الميزانية اليومية أو الشهرية، فلا يبدأ.</p>}
          {plan.busy && <p className="note-amber text-sm" role="status">يوجد تشغيل آخر الآن؛ انتظر حتى ينتهي.</p>}
        </div>
      )}
      {r && (
        <div className="grid gap-2" data-eval-progress={r.status}>
          <p className="text-sm" role="status">
            {['queued', 'running'].includes(r.status) ? <><Spinner /> يعمل: <span className="num">{r.items_done} / {r.items_total}</span></>
              : r.status === 'done' ? (r.verdict === 'pass' ? 'نجح الاختبار.' : 'أوقف الاختبار النشر.')
              : `لم يكتمل الاختبار: ${L.STOP_LABELS[r.stop_reason ?? ''] ?? 'توقف'}.`}
            {' '}التكلفة: <span className="num">{usd(r.cost_usd)}</span>
          </p>
          {r.status === 'done' && blocked.length > 0 && (
            <div className="note-amber text-sm grid gap-1" data-eval-blocked>
              <p className="font-semibold">أسئلة كانت تنجح وترسب الآن:</p>
              <ul className="list-disc ps-5">
                {blocked.map((k) => {
                  const c = resultsOf(k).find((x) => x.config === 'candidate');
                  return (
                    <li key={k} data-blocked-item={k}>
                      «{c?.messages[0] ?? k}» — {(c?.reasons ?? []).map((x) => L.reasonText(x, c?.expect)).join('؛ ') || 'راسب'}
                    </li>
                  );
                })}
              </ul>
              {run?.run.candidate_cards?.length ? <p className="text-xs">البطاقات قيد النشر: {run.run.candidate_cards.map((c) => c.title_ar || c.key).join('، ')}.</p> : null}
            </div>
          )}
          {r.status === 'done' && (r.known_gaps ?? []).length > 0 && (
            <p className="text-xs text-ink-muted" data-eval-gaps>فجوات معروفة لا توقف النشر: {countWord(r.known_gaps.length, Q)}.</p>
          )}
        </div>
      )}
      {error && <p className="text-sm media-err" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={r && r.status === 'done' ? 'إغلاق' : 'إلغاء'} disabled={busy} />
        {plan && !runId && !plan.nothing && (
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy || plan.would_pass_cap || !!plan.busy} data-action="eval-start" data-autofocus>
            {busy && <Spinner />} تشغيل الاختبار ثم النشر
          </button>
        )}
      </div>
    </div>
  );
}
