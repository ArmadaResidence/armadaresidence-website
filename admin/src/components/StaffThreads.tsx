// «المحادثات» → «الفريق» (H9 fix 3, Ahmed 17 Nov 2026 — DECISIONS.md 2026-11-17): the conversations of staff and
// management numbers with the WhatsApp line (the last 30 days) — the colleague chat, teaching and reply rules, voice notes
// (their transcript), with what each teaching became. The system admin sees every branch; a user with «الفريق والتقارير»
// edit sees the branches in scope (public.hub_staff_threads / hub_staff_thread decide). Read-only; nothing is sent from here.
import { useEffect, useState } from 'react';
import { ErrorBox, Loading } from './ui';
import { staffThread, staffThreads, type StaffThreadMsg, type StaffThreadRow } from '../lib/inbox';
import { riyadhDateTime } from '../lib/format';

const TEACH_STATUS: Record<string, string> = {
  learned: 'سُجّلت', refused: 'لم تُسجَّل', failed: 'تعذّر التسجيل', asked: 'بانتظار «نعم» / «لا»', link: 'بانتظار الرابط', pending: 'قيد المعالجة', running: 'قيد المعالجة',
};
const BRANCH: Record<string, string> = { 'airport-road': 'طريق المطار', 'shafa-road': 'طريق الشفا' };

export default function StaffThreads() {
  const [rows, setRows] = useState<StaffThreadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<StaffThreadRow | null>(null);
  const [msgs, setMsgs] = useState<StaffThreadMsg[] | null>(null);
  useEffect(() => {
    staffThreads().then((r) => setRows(r)).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (!open) return;
    setMsgs(null);
    staffThread(open.who, open.unit).then(setMsgs).catch((e) => setError((e as Error).message));
  }, [open]);
  return (
    <div className="grid gap-3 lg:grid-cols-[19rem_minmax(0,1fr)]" data-staff-threads>
      <section className="card" aria-label="محادثات الفريق">
        <p className="p-3 text-xs text-ink-muted border-b border-line">محادثات أرقام الفريق والإدارة مع خط واتساب خلال آخر 30 يومًا: التعليم وقواعد الرد والأسئلة، والرسائل الصوتية بنصها. لا يُرسل شيء من هنا.</p>
        <ErrorBox error={error} />
        {!rows && !error && <div className="p-4"><Loading /></div>}
        {rows && rows.length === 0 && <p className="p-4 text-sm text-ink-muted" data-empty>لا محادثات للفريق خلال آخر 30 يومًا.</p>}
        <ul className="inbox-rows">
          {(rows ?? []).map((r) => (
            <li key={`${r.who}|${r.unit}`}>
              <button type="button" className={`inbox-row ${open?.who === r.who && open.unit === r.unit ? 'is-on' : ''}`} onClick={() => setOpen(r)} data-staff-row={r.who}>
                <span className="font-semibold truncate">{r.name}</span>
                <span className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="inbox-chip">{BRANCH[r.branch] ?? r.branch}</span>
                  <span className="inbox-chip">{r.kind === 'report' ? 'الإدارة' : r.role === 'manager' ? 'مدير الاستقبال' : 'الاستقبال'}</span>
                  {r.teachings > 0 && <span className="inbox-chip is-bronze" data-teachings>تعليم: <span className="num">{r.teachings}</span></span>}
                  {r.cards > 0 && <span className="inbox-chip is-bronze">بطاقات: <span className="num">{r.cards}</span></span>}
                </span>
                <span className="text-xs text-ink-muted num">{riyadhDateTime(r.last_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card" aria-label="محادثة الفريق" data-staff-thread>
        {!open ? <p className="p-6 text-sm text-ink-muted">اختر محادثة من القائمة.</p> : !msgs ? <div className="p-6"><Loading /></div> : (
          <ol className="flex flex-col gap-2 p-3">
            {msgs.map((m) => (
              <li key={m.id} className={`inbox-bubble ${m.direction === 'in' ? 'is-in' : 'is-out'}`} data-staff-msg={m.direction}>
                {m.kind === 'audio' && <p className="text-xs text-ink-muted" data-voice>رسالة صوتية{m.audio_seconds ? <> — <span className="num">{Math.round(m.audio_seconds)}</span> ث</> : null} · تفريغ صوتي:</p>}
                <p className="whitespace-pre-wrap">{m.body || (m.kind === 'audio' ? 'تعذّر تفريغها' : '')}</p>
                {m.teach && (
                  <p className="text-xs mt-1" data-teach={m.teach.status}>
                    {TEACH_STATUS[m.teach.status] ?? m.teach.status}
                    {m.teach.card && <> — {m.teach.card.kind === 'rule' ? 'قاعدة رد' : 'معلومة'}: «{m.teach.card.text_ar}»{m.teach.card.status === 'archived' ? ' (مُسحت)' : ''}</>}
                  </p>
                )}
                <p className="text-[11px] text-ink-muted num mt-1">{riyadhDateTime(m.at)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
