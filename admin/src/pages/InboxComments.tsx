// «المحادثات» → «التعليقات» (Guest Hub S2, 26 Nov 2026 — DECISIONS.md 2026-11-26 «Guest Hub S2 — comments»): the public
// comments under our Instagram and Facebook posts — the post (its picture and link), the comment, our public reply, the
// private message and the state («تم الرد» / «محوَّل للفريق» / «تم تخطيه» / «يحتاج مراجعة» / «تعذّر الرد»). A staff member
// may reply in public (the server's guard of S4: no number, no currency, no link) or send the ONE private message (7 days),
// mark a comment «تمت المراجعة», and the system admin may mark a commenter «حساب تجربة». Nothing is hidden or deleted on
// Meta from here or automatically. A failed action shows its error (never silent).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { riyadhDateTime } from '../lib/format';
import { CancelButton, ErrorBox, Loading, Modal, Spinner, useToast } from '../components/ui';
import {
  CLASS_LABELS, FILTERS, KIND_LABELS, SKIP_LABELS, STATE_LABELS, commentError, listComments, publicProblem, reply, review, setTester,
  type CommentList, type CommentRow,
} from '../lib/comments';

const TONE: Record<string, string> = { replied: 'ok', handed_off: 'amber', review: 'amber', failed: 'error', test: 'muted', skipped: 'muted', new: 'muted', processing: 'muted' };

export function CommentsTab() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const filter = sp.get('cstate') ?? '';
  const focus = sp.get('cm');
  const [data, setData] = useState<CommentList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ row: CommentRow; mode: 'public' | 'private' } | null>(null);
  const [text, setText] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await listComments({ state: filter || null }));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [filter]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!focus || !data) return;
    document.querySelector(`[data-comment="${focus}"]`)?.scrollIntoView({ block: 'center' });
  }, [focus, data]);

  async function run(key: string, f: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await f();
      if (ok) toast(ok);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function send() {
    if (!dlg) return;
    const t = text.trim();
    const problem = dlg.mode === 'public' ? publicProblem(t) : !t ? 'اكتب الرسالة.' : null;
    if (problem) {
      toast(problem, 'error');
      return;
    }
    setBusy('send');
    try {
      const r = await reply(dlg.row.id, dlg.mode, t);
      if (!r.ok) {
        toast(commentError(r.error === 'hub_comment_guard' ? r.error : r.error_code ?? r.error), 'error');
      } else {
        toast(dlg.mode === 'public' ? (r.status === 'test' ? 'سُجّل الرد العام (تعليق تجربة، لم يُنشر).' : 'نُشر الرد تحت التعليق.') : (r.status === 'test' ? 'سُجّلت الرسالة الخاصة (تجربة، لم تُرسل).' : 'أُرسلت الرسالة الخاصة.'));
        setDlg(null);
        setText('');
      }
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (err) return <ErrorBox error={err} />;
  if (!data) return <Loading />;
  return (
    <div className="grid gap-3" data-comments-tab data-tour="comments-list">
      <div className="card p-3 flex flex-wrap items-center gap-2" role="group" aria-label="تصفية التعليقات" data-tour="comments-filters">
        {FILTERS.map((f) => {
          const n = f.value === 'needs_review' ? data.counts.needs_review : f.value === 'handed_off' ? data.counts.handed_off : null;
          return (
            <button key={f.value || 'all'} type="button" className={`inbox-tab ${filter === f.value ? 'is-on' : ''}`} aria-pressed={filter === f.value} data-cfilter={f.value || 'all'}
              onClick={() => { const p = new URLSearchParams(sp); if (f.value) p.set('cstate', f.value); else p.delete('cstate'); p.delete('cm'); setSp(p, { replace: true }); }}>
              {f.label}{n ? <span className="num inbox-count">{n}</span> : null}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted">لا يُخفى أي تعليق ولا يُحذف من هنا أو تلقائيًا. الرد العام بلا أرقام أو أسعار، والرسالة الخاصة مرة واحدة خلال 7 أيام من التعليق.</p>
      {!data.rows.length ? <p className="card p-4 text-sm text-ink-muted" data-comments-empty>لا تعليقات هنا بعد.</p> : (
        <ul className="grid gap-2">
          {data.rows.map((r) => (
            <li key={r.id} className={`card p-3 grid gap-2 ${focus === r.id ? 'ring-2 ring-bronze' : ''}`} data-comment={r.id} data-state={r.state}>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 items-start">
                {r.post_thumb
                  ? <img src={r.post_thumb} alt="صورة المنشور" width={56} height={56} className="size-14 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  : <span className="size-14 rounded border border-line grid place-items-center text-xs text-ink-muted" aria-hidden="true">منشور</span>}
                <div className="min-w-0 grid gap-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inbox-chip">{KIND_LABELS[r.kind]}</span>
                    {r.is_ad && <span className="inbox-chip" data-ad>إعلان</span>}
                    {r.class && <span className="inbox-chip" data-class={r.class}>{CLASS_LABELS[r.class]}</span>}
                    <span className={`inbox-chip tone-${TONE[r.state] ?? 'muted'}`} data-state-chip>{r.state === 'review' && r.reviewed_at ? 'تمت المراجعة' : STATE_LABELS[r.state]}</span>
                    {r.tester && <span className="inbox-chip">حساب تجربة</span>}
                    <span className="text-ink-muted num">{riyadhDateTime(r.commented_at)}</span>
                    {r.post_permalink && <a className="link-bronze" href={r.post_permalink} target="_blank" rel="noreferrer noopener" data-post-link>فتح المنشور</a>}
                  </div>
                  <p className="text-sm break-words"><span className="font-bold" dir="auto">{r.author_name ?? 'حساب بلا اسم'}</span>: <span dir="auto">{r.body ?? '—'}</span></p>
                  {r.skip_reason && <p className="text-xs text-ink-muted" data-skip>{SKIP_LABELS[r.skip_reason] ?? r.skip_reason}</p>}
                  {r.public_body && (
                    <p className="text-sm border-s-2 border-bronze ps-2" data-public>
                      <span className="text-xs text-ink-muted">ردنا العام{r.public_status === 'test' ? ' (تجربة — لم يُنشر)' : r.public_status === 'failed' ? ` — ${commentError(r.public_error)}` : ''}: </span>
                      <span dir="auto">{r.public_body}</span>
                    </p>
                  )}
                  {r.public_status === 'failed' && !r.public_body && <p className="text-xs text-error" data-public-error>{commentError(r.public_error)}</p>}
                  {(r.private_body || r.private_status) && (
                    <p className="text-sm border-s-2 border-line ps-2" data-private>
                      <span className="text-xs text-ink-muted">الرسالة الخاصة{r.private_status === 'test' ? ' (تجربة — لم تُرسل)' : r.private_status === 'failed' ? ` — ${commentError(r.private_error)}` : ''}: </span>
                      <span dir="auto">{r.private_body ?? '—'}</span>
                    </p>
                  )}
                </div>
              </div>
              {data.can_edit && (
                <div className="flex flex-wrap gap-2" data-comment-actions data-tour="comments-actions">
                  {r.can_public && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => { setText(''); setDlg({ row: r, mode: 'public' }); }} data-action="reply-public">رد علني</button>}
                  {r.can_private && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => { setText(''); setDlg({ row: r, mode: 'private' }); }} data-action="reply-private">رسالة خاصة</button>}
                  {r.state === 'review' && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} data-action="reviewed"
                      onClick={() => void run(`r:${r.id}`, () => review(r.id, !r.reviewed_at), r.reviewed_at ? 'أعيد التعليق إلى «يحتاج مراجعة».' : 'سُجّل أن التعليق تمت مراجعته.')}>
                      {busy === `r:${r.id}` && <Spinner />} {r.reviewed_at ? 'إعادة للمراجعة' : 'تمت المراجعة'}
                    </button>
                  )}
                  {data.system_admin && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} aria-pressed={r.tester} data-action="comment-tester"
                      onClick={() => void run(`t:${r.id}`, () => setTester(r.id, !r.tester), r.tester ? 'لم يعد المعلّق حساب تجربة.' : 'أصبح المعلّق حساب تجربة.')}>
                      {busy === `t:${r.id}` && <Spinner />} {r.tester ? '✓ حساب تجربة' : 'حساب تجربة'}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!dlg} onClose={() => setDlg(null)} title={dlg?.mode === 'private' ? 'رسالة خاصة للمعلّق' : 'رد علني على التعليق'} busy={busy === 'send'} draftKey={dlg ? `comment:${dlg.row.id}:${dlg.mode}` : undefined}>
        {dlg && (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <p className="text-sm text-ink-muted" dir="auto">{dlg.row.body}</p>
            <label className="grid gap-1 text-sm">
              <span>{dlg.mode === 'private' ? 'نص الرسالة (مرة واحدة فقط، وتفتح محادثة خاصة إذا رد المعلّق)' : 'نص الرد (يظهر للجميع؛ بلا أرقام أو أسعار أو روابط)'}</span>
              <textarea className="field min-h-24" value={text} onChange={(e) => setText(e.target.value)} maxLength={dlg.mode === 'public' ? 300 : 1000} dir="auto" data-comment-text required />
            </label>
            {dlg.mode === 'public' && text.trim() && publicProblem(text) && <p className="text-xs text-error" role="alert" data-guard>{publicProblem(text)}</p>}
            <div className="flex gap-2 justify-end">
              <CancelButton disabled={busy === 'send'} />
              <button type="submit" className="btn btn-primary" disabled={busy === 'send' || (dlg.mode === 'public' && !!publicProblem(text))} data-action="comment-send">
                {busy === 'send' && <Spinner />} {dlg.mode === 'private' ? 'إرسال الرسالة' : 'نشر الرد'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
