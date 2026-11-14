// «المحادثات» — Guest Hub «مركز الضيوف», session H3 (13 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §5.2, §5.10, §6.2–§6.4;
// copy.md §6; DECISIONS.md 2026-11-13 «Guest Hub H3 — the inbox»). There is no assistant yet: every conversation is
// handled by staff. DESKTOP-FIRST (Ahmed: reception reviews on the reception computer): three panes from 1280 px —
// the list · the thread · the guest panel — and stacked screens below (list → thread → panel).
//   - The list: the tabs «بانتظار موظف» · «مع المساعد» · «مسودات للموافقة» · «الكل» · «مغلقة» (+ «طلبات» once a dining
//     unit is live), the filters (unit, state, owner, language, blocked numbers), the search (name, number, AR- ref), the
//     response timer (green / amber / red from hub_reply_amber_min / hub_reply_red_min), URL parameters ?tab ?unit ?state
//     ?owner ?q ?c.
//   - The thread: guest and outbound bubbles, the booking and «إياب» templates sent to this guest (from their own logs,
//     labelled «قالب»), internal notes, the timeline, delivery ticks, a media viewer (5-minute signed links of hub-media),
//     the window's remaining time.
//   - The composer: free text inside the 24-hour window; after it «إرسال عند رد الضيف» (the answer held, hub_reply_ready
//     now) and «إرسال قالب». A failed send shows «إعادة الإرسال».
//   - The actions: «تولّي المحادثة», «تحويل» (a note required), «إغلاق المحادثة», «ملاحظة», «حظر الرقم» (with «تراجع»),
//     the owner. H5 (14 Nov 2026): «إعادة للمساعد» (T24, only while the unit's assistant may write), «إيقاف المساعد
//     مؤقتًا» (any inbox: edit member), the assistant's drafts («إرسال» · «تعديل ثم إرسال» · «رفض» with a reason — a
//     compare-and-set on the server) with the cards they drew from, its «تجربة» replies (never sent), «الترجمة» of a
//     guest message and «اقتراحات» (three replies; the guard runs on the one sent). «بطاقات الغرف» comes with H8.
//   - Shortcuts (Alt + N / R / T / C), live updates (Realtime on hub_conversations / hub_messages under RLS, and
//     dashboard_signals), Western digits, the shared dialogs and their dirty guard, light and dark, the page tour.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import * as api from '../lib/api';
import { BRANCH_NAMES, riyadhDateTime, shortDate, STATUS_LABELS, west } from '../lib/format';
import tplDefs from '../../../supabase/functions/_shared/hub/hub-templates.json';
import {
  ACTIONS, DRAFT_ACTIONS, LANGUAGE_FILTERS, MARKS, OWNER_FILTERS, REJECT_REASONS, SHORTCUTS, STATE_LABELS, TABS, TAB_LABELS, TAG_LABELS, TEMPLATE_LABELS, approve, assign, assistError, banner,
  block, close, eventText, list, markUnanswered, mediaUrl, needsTranslation, newKey, ownerText, pauseUnit, reject, release, retry, send, sendError, sendSuggestion, statusText, suggest, takeOver,
  thread, timerTone, transfer, translate, waitingText, windowState, addNote,
  type Filters, type HubState, type InboxList, type InboxRow, type Msg, type RejectReason, type Tab, type Thread,
} from '../lib/inbox';
import { CancelButton, Confirm, DirtyScope, ErrorBox, Field, Loading, Modal, Spinner, useToast } from '../components/ui';
import { flagWrong, flaggedIn } from '../lib/lab';

type View = 'list' | 'thread' | 'panel';

export default function Inbox() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const filters: Filters = useMemo(() => ({
    tab: (sp.get('tab') as Tab) || 'waiting',
    unit: sp.get('unit') ?? '',
    state: sp.get('state') ?? '',
    owner: sp.get('owner') ?? '',
    language: sp.get('language') ?? '',
    q: sp.get('q') ?? '',
    blocked: sp.get('blocked') === '1',
  }), [sp]);
  const selected = sp.get('c');
  const [data, setData] = useState<InboxList | null>(null);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState<Thread | null>(null);
  const [tError, setTError] = useState<string | null>(null);
  const [view, setView] = useState<View>(selected ? 'thread' : 'list');
  const [now, setNow] = useState(() => Date.now());
  const [q, setQ] = useState(filters.q ?? '');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [dialog, setDialog] = useState<null | 'transfer' | 'note' | 'close' | 'block' | 'template'>(null);
  const [media, setMedia] = useState<{ url: string; mime: string | null } | null>(null);
  const [draft, setDraft] = useState<{ kind: 'edit' | 'reject'; m: Msg } | null>(null);
  const [engine, setEngine] = useState<{ assistant_on: boolean; capped: boolean; api_credit: boolean; alert: boolean } | null>(null);
  useEffect(() => {
    banner().then(setEngine).catch(() => setEngine(null));
  }, []);

  const setParam = useCallback((patch: Record<string, string | null>) => {
    setSp((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') n.delete(k);
        else n.set(k, v);
      }
      return n;
    }, { replace: true });
  }, [setSp]);

  const loadList = useCallback(async () => {
    try {
      const d = await list(filters);
      setData(d);
      setRows(d.rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filters]);
  const loadThread = useCallback(async () => {
    if (!selected) {
      setT(null);
      return;
    }
    try {
      setT(await thread(selected));
      setTError(null);
    } catch (e) {
      setT(null);
      setTError((e as Error).message);
    }
  }, [selected]);
  useEffect(() => void loadList(), [loadList]);
  useEffect(() => void loadThread(), [loadThread]);
  useEffect(() => setQ(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(i);
  }, []);

  // live: Realtime under RLS + the signals (kind, unit and time only)
  const listRef = useRef(loadList);
  const threadRef = useRef(loadThread);
  listRef.current = loadList;
  threadRef.current = loadThread;
  useEffect(() => {
    let timer = 0;
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void listRef.current();
        void threadRef.current();
      }, 400);
    };
    const ch = supabase
      .channel('inbox-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hub_conversations' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hub_messages' }, bump)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dashboard_signals' }, bump)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, []);

  const open = (id: string) => {
    setParam({ c: id });
    setView('thread');
  };
  const reload = async () => {
    await Promise.all([loadList(), loadThread()]);
  };
  const edit = !!t?.conversation.can_edit;
  const c = t?.conversation;
  const busyRef = useRef(false);

  async function act(label: string, fn: () => Promise<unknown>, done?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await fn();
      if (done) toast(done);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      busyRef.current = false;
    }
    void label;
  }
  const doTakeOver = () => c && act('take', () => takeOver(c.id), 'تولّيت المحادثة.');

  // keyboard shortcuts (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || document.querySelector('dialog[open]')) return;
      const sc = SHORTCUTS.find((s) => s.code === e.code);
      if (!sc) return;
      e.preventDefault();
      if (sc.code === 'KeyN') {
        const next = [...rows].filter((r) => r.waiting_since && r.id !== selected).sort((a, b) => Date.parse(a.waiting_since!) - Date.parse(b.waiting_since!))[0];
        if (next) open(next.id);
        else toast('لا محادثة أخرى تنتظر.');
      } else if (sc.code === 'KeyR') {
        setView('thread');
        composerRef.current?.focus();
      } else if (sc.code === 'KeyT') {
        if (edit && c && c.state !== 'closed') void doTakeOver();
      } else if (sc.code === 'KeyC') {
        if (edit && c && c.state !== 'closed') setDialog('close');
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const unitNames = useMemo(() => Object.fromEntries((data?.units ?? []).map((u) => [u.key, u.name])), [data]);
  const diningLive = (data?.units ?? []).some((u) => u.kind === 'dining' && u.status === 'active');
  const tabs: Tab[] = diningLive ? [...TABS.slice(0, 4), 'orders', 'closed'] : TABS;

  return (
    <div className="inbox grid gap-3" data-page="inbox" data-view={view}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">المحادثات</h1>
          <p className="text-sm text-ink-muted">محادثات واتساب لوحداتك. مسودات المساعد تنتظر موافقتك في «مسودات للموافقة»، وردود «تجربة» لا تصل للضيف.</p>
        </div>
        <p className="text-xs text-ink-muted max-lg:hidden" data-tour="inbox-shortcuts" data-shortcuts>
          {SHORTCUTS.map((s) => <span key={s.code} className="ms-3"><kbd className="num">{s.keys}</kbd> {s.label}</span>)}
        </p>
      </div>
      {engine?.assistant_on && (engine.api_credit || engine.capped) && (
        <p className="note-amber text-sm" role="status" data-engine-banner>
          {engine.api_credit ? 'رصيد كلود انتهى: كل المحادثات الجديدة تذهب إلى الفريق حتى يعود الرصيد.' : 'بلغت تكلفة المساعد الحد: كل المحادثات الجديدة تذهب إلى الفريق حتى تبدأ الفترة التالية.'}
        </p>
      )}
      {data && !data.inbox_on && (
        <p className="note-amber text-sm" role="note" data-inbox-off>«تخزين المحادثات» متوقف: لا تُحفظ الرسائل الجديدة ولا يُرسل شيء من هنا حتى يُشغَّل من «إعدادات المساعد».</p>
      )}
      <ErrorBox error={error} />

      <div className="inbox-grid">
        {/* ── the list ── */}
        <section className="inbox-pane pane-list card" aria-label="قائمة المحادثات" data-pane="list" data-tour="inbox-list">
          <div className="inbox-tabs" role="tablist" aria-label="تبويبات المحادثات" data-tour="inbox-tabs">
            {tabs.map((k) => {
              const n = k === 'orders' ? null : data?.counts[k as keyof InboxList['counts']];
              return (
                <button key={k} type="button" role="tab" aria-selected={filters.tab === k} className={`inbox-tab ${filters.tab === k ? 'is-on' : ''}`}
                  onClick={() => setParam({ tab: k === 'waiting' ? null : k })} data-tab={k}>
                  {TAB_LABELS[k]}{n !== null && n !== undefined ? <span className="num inbox-count" data-count={k}>{n}</span> : null}
                </button>
              );
            })}
          </div>
          <form className="grid gap-2 p-3 border-b border-line" data-tour="inbox-filters" data-filters role="search" onSubmit={(e) => { e.preventDefault(); setParam({ q: west(q).trim() || null }); }}>
            <label className="sr-only" htmlFor="inbox-q">بحث بالاسم أو الرقم أو رقم الحجز</label>
            <input id="inbox-q" className="field" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="الاسم أو الرقم أو AR-…" autoComplete="off" data-no-dirty data-search />
            <div className="grid grid-cols-2 gap-2">
              <select className="field" aria-label="الوحدة" value={filters.unit} onChange={(e) => setParam({ unit: e.target.value || null })} data-no-dirty data-filter="unit">
                <option value="">كل الوحدات</option>
                {(data?.units ?? []).map((u) => <option key={u.id} value={u.key}>{u.name}</option>)}
              </select>
              <select className="field" aria-label="الحالة" value={filters.state} onChange={(e) => setParam({ state: e.target.value || null })} data-no-dirty data-filter="state">
                <option value="">كل الحالات</option>
                {(Object.keys(STATE_LABELS) as HubState[]).map((s) => <option key={s} value={s}>{STATE_LABELS[s]}</option>)}
              </select>
              <select className="field" aria-label="المسؤول" value={filters.owner} onChange={(e) => setParam({ owner: e.target.value || null })} data-no-dirty data-filter="owner">
                {OWNER_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select className="field" aria-label="اللغة" value={filters.language} onChange={(e) => setParam({ language: e.target.value || null })} data-no-dirty data-filter="language">
                {LANGUAGE_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs min-h-8">
              <input type="checkbox" className="size-4 accent-bronze-deep" checked={!!filters.blocked} onChange={(e) => setParam({ blocked: e.target.checked ? '1' : null })} data-no-dirty data-filter="blocked" />
              الأرقام المحظورة فقط
            </label>
          </form>
          <ul className="inbox-rows" data-rows>
            {!data && !error && <li className="p-4"><Loading /></li>}
            {data && rows.length === 0 && <li className="p-4 text-sm text-ink-muted" data-empty>لا محادثات هنا.</li>}
            {rows.map((r) => {
              const tone = r.state === 'human' ? timerTone(r.waiting_since, data!.timers, now) : null;
              return (
                <li key={r.id}>
                  <button type="button" className={`inbox-row ${selected === r.id ? 'is-on' : ''}`} onClick={() => open(r.id)} aria-current={selected === r.id ? 'true' : undefined} data-conv-row={r.id} data-tone={tone ?? 'none'}>
                    <span className="flex items-center justify-between gap-2 min-w-0">
                      <span className="font-semibold truncate" data-row-name>{r.priority === 'high' && <span className="text-error" aria-label="أولوية عالية">● </span>}{r.name}</span>
                      {r.unread > 0 && <span className="inbox-count num" aria-label={`غير مقروءة: ${r.unread}`} data-unread>{r.unread}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-1 text-xs">
                      <span className="inbox-chip" data-row-unit>{r.unit_name}</span>
                      <span className="inbox-chip" title="واتساب">واتساب</span>
                      <span className="inbox-chip" data-row-state>{STATE_LABELS[r.state]}</span>
                      {r.tags.map((g) => <span key={g} className="inbox-chip is-bronze">{TAG_LABELS[g] ?? g}</span>)}
                      {r.is_test && <span className="inbox-chip is-test">{MARKS.test}</span>}
                    </span>
                    <span className="text-xs text-ink-muted truncate" data-row-last>{r.last?.kind === 'template' ? MARKS.template : r.last?.line || (r.last ? 'وسائط أو رسالة بلا نص' : '')}</span>
                    <span className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                      <span>{ownerText(r.owner_kind, r.owner_name)}</span>
                      {r.state === 'human' && r.waiting_since ? <span className={`inbox-timer is-${tone}`} data-timer>{waitingText(r.waiting_since, now)}</span> : <span className="num">{riyadhDateTime(r.last_at)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── the thread ── */}
        <section className="inbox-pane pane-thread card" aria-label="المحادثة" data-pane="thread" data-tour="inbox-thread">
          {!selected ? (
            <p className="p-6 text-sm text-ink-muted" data-no-thread>اختر محادثة من القائمة.</p>
          ) : tError ? (
            <div className="p-4"><ErrorBox error={tError} /></div>
          ) : !t ? (
            <div className="p-6"><Loading /></div>
          ) : (
            <ThreadView t={t} now={now} edit={edit} unitNames={unitNames} composerRef={composerRef}
              onBack={() => setView('list')} onPanel={() => setView('panel')} onChanged={reload}
              onTakeOver={() => void doTakeOver()} onDialog={setDialog} onMedia={setMedia} onDraft={setDraft}
              onRelease={() => c && act('release', () => release(c.id), 'عادت المحادثة إلى المساعد.')}
              onPause={() => c && act('pause', async () => {
                const r = await pauseUnit(c.unit_id);
                toast.undo('أُوقف المساعد في هذه الوحدة مؤقتًا — يعيد تشغيله مدير النظام', async () => {
                  await api.revertBatch(r.batch_id);
                  await reload();
                });
              })}
              onUnanswered={(id) => act('unanswered', () => markUnanswered(id), 'أُضيفت الرسالة إلى «لم أعرف الإجابة».')} />
          )}
        </section>

        {/* ── the guest panel ── */}
        <aside className="inbox-pane pane-panel card" aria-label="الضيف" data-pane="panel" data-tour="inbox-panel">
          {t ? <GuestPanel t={t} edit={edit} onBack={() => setView('thread')} onOpen={open} onAssign={(s) => act('assign', () => assign(t.conversation.id, s), 'أُسند المسؤول.')} /> : <p className="p-6 text-sm text-ink-muted">بيانات الضيف تظهر هنا.</p>}
        </aside>
      </div>

      {t && c && (
        <>
          <TransferDialog open={dialog === 'transfer'} t={t} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await reload(); }} />
          <NoteDialog open={dialog === 'note'} id={c.id} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await reload(); }} />
          <TemplateDialog open={dialog === 'template'} t={t} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await reload(); }} />
          <DraftEditDialog open={draft?.kind === 'edit'} m={draft?.m ?? null} onClose={() => setDraft(null)} onDone={async () => { setDraft(null); await reload(); }} />
          <DraftRejectDialog open={draft?.kind === 'reject'} m={draft?.m ?? null} onClose={() => setDraft(null)} onDone={async () => { setDraft(null); await reload(); }} />
          <Confirm open={dialog === 'close'} title={ACTIONS.close} onClose={() => setDialog(null)} confirmLabel={ACTIONS.close}
            body="تُغلق هذه المحادثة. إن كتب الضيف بعدها تبدأ محادثة جديدة، ولا يُرسل رد مؤجَّل بعد الإغلاق."
            onConfirm={() => { setDialog(null); void act('close', () => close(c.id), 'أُغلقت المحادثة.'); }} />
          <Confirm open={dialog === 'block'} title={ACTIONS.block} danger onClose={() => setDialog(null)} confirmLabel={ACTIONS.block}
            body="لن تنتظر رسائل هذا الرقم ردًّا، ولن يُرسل إليه شيء من «المحادثات»، وتُغلق هذه المحادثة. تبقى رسائله محفوظة، ويمكن إلغاء الحظر."
            onConfirm={() => {
              setDialog(null);
              void act('block', async () => {
                await block(c.id, true);
                toast.undo('حُظر الرقم', async () => {
                  await block(c.id, false);
                  await reload();
                });
              });
            }} />
        </>
      )}
      <Modal open={!!media} onClose={() => setMedia(null)} title="عرض الوسائط" wide>
        {media && (
          <div className="grid gap-3" data-media-viewer>
            {media.mime?.startsWith('image/') ? <img src={media.url} alt="صورة أرسلها الضيف" className="max-h-[70vh] mx-auto" />
              : media.mime?.startsWith('audio/') ? <audio src={media.url} controls className="w-full" />
              : media.mime?.startsWith('video/') ? <video src={media.url} controls className="max-h-[70vh] mx-auto" />
              : <a className="link" href={media.url} target="_blank" rel="noreferrer">فتح الملف</a>}
            <p className="text-xs text-ink-muted">رابط مؤقت لخمس دقائق.</p>
            <div className="flex justify-end"><CancelButton label="إغلاق" /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

type Item = { at: string; kind: 'msg'; m: Msg } | { at: string; kind: 'tpl'; i: Thread['templates'][number] } | { at: string; kind: 'event'; e: Thread['events'][number] };

function ThreadView({ t, now, edit, unitNames, composerRef, onBack, onPanel, onChanged, onTakeOver, onDialog, onMedia, onUnanswered, onDraft, onRelease, onPause }: {
  t: Thread; now: number; edit: boolean; unitNames: Record<string, string>; composerRef: React.RefObject<HTMLTextAreaElement | null>;
  onBack: () => void; onPanel: () => void; onChanged: () => Promise<void>; onTakeOver: () => void;
  onDialog: (d: 'transfer' | 'note' | 'close' | 'block' | 'template') => void; onMedia: (m: { url: string; mime: string | null }) => void; onUnanswered: (id: string) => void;
  onDraft: (d: { kind: 'edit' | 'reject'; m: Msg }) => void; onRelease: () => void; onPause: () => void;
}) {
  const toast = useToast();
  const c = t.conversation;
  const items: Item[] = useMemo(() => [
    ...t.messages.map((m) => ({ at: m.sent_at, kind: 'msg' as const, m })),
    ...t.templates.map((i) => ({ at: i.at, kind: 'tpl' as const, i })),
    ...t.events.map((e) => ({ at: e.at, kind: 'event' as const, e })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [t]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [t.messages.length, c.id]);
  const mine = c.owner_kind === 'staff';
  const closed = c.state === 'closed';
  // H6 (14 Nov 2026): «إبلاغ: رد خاطئ» on an assistant reply that went to the guest — the counters of «التراخيص», an entry
  // in «لم أعرف الإجابة» and one alert to the admins; never a licence change by itself
  const [flagged, setFlagged] = useState<string[]>([]);
  const [flagging, setFlagging] = useState<Msg | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [flagBusy, setFlagBusy] = useState(false);
  useEffect(() => {
    flaggedIn(c.id).then(setFlagged).catch(() => setFlagged([]));
  }, [c.id, t.messages.length]);
  async function doFlag() {
    if (!flagging) return;
    setFlagBusy(true);
    try {
      await flagWrong(flagging.id, flagNote.trim() || null);
      setFlagged((x) => [...x, flagging.id]);
      setFlagging(null);
      setFlagNote('');
      toast('سُجّل أن الرد خاطئ: أُضيف السؤال إلى «لم أعرف الإجابة» ووصل تنبيه لمدير النظام. لم يتغير أي ترخيص.');
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setFlagBusy(false);
    }
  }

  async function openMedia(m: Msg) {
    try {
      onMedia({ url: await mediaUrl(m.media_path!), mime: m.media_mime });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  const [busyDraft, setBusyDraft] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  async function sendDraft(m: Msg) {
    if (busyDraft) return;
    setBusyDraft(m.id);
    try {
      const r = await approve(m.id, null);
      if (!r.ok) toast(sendError(r.error ?? r.results?.[0]?.error_code), 'error');
      else toast(r.existing ? 'هذه المسودة أُرسلت أو تجاوزتها رسالة أحدث.' : 'أُرسل رد المساعد.');
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyDraft(null);
    }
  }
  async function doTranslate(m: Msg) {
    try {
      const r = await translate(m.id);
      if (!r.ok || !r.translation) toast(assistError(r.error), 'error');
      else setTranslations((x) => ({ ...x, [m.id]: r.translation! }));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  async function doRetry(m: Msg) {
    try {
      const r = await retry(m.id);
      if (!r.ok) toast(sendError(r.error ?? r.results?.[0]?.error_code), 'error');
      else toast('أُعيد الإرسال.');
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-thread={c.id} data-state={c.state}>
      <header className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
        <button type="button" className="btn btn-ghost btn-sm inbox-narrow" onClick={onBack} data-action="back-list">رجوع إلى القائمة</button>
        <div className="min-w-0 grow">
          <h2 className="font-bold truncate" data-thread-name>{t.guest.label}</h2>
          <p className="text-xs text-ink-muted">
            {c.unit_name} · {STATE_LABELS[c.state]} · {ownerText(c.owner_kind, c.owner_name)}{c.is_test ? ` · ${MARKS.test}` : ''}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm inbox-narrow" onClick={onPanel} data-action="open-panel">الضيف</button>
      </header>
      {edit && !closed && (
        <div className="flex flex-wrap gap-2 p-2 border-b border-line" data-tour="inbox-actions" data-actions>
          {!(mine && c.owner_staff_id && c.state === 'human') && <button type="button" className="btn btn-ghost btn-sm" onClick={onTakeOver} data-action="take-over" aria-keyshortcuts="Alt+T">{ACTIONS.take_over}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDialog('transfer')} disabled={!t.transfer_units.length} data-action="transfer">{ACTIONS.transfer}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDialog('note')} data-action="note">{ACTIONS.note}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDialog('close')} data-action="close" aria-keyshortcuts="Alt+C">{ACTIONS.close}</button>
          {!t.guest.blocked && <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => onDialog('block')} data-action="block">{ACTIONS.block}</button>}
          {c.can_release && <button type="button" className="btn btn-ghost btn-sm" onClick={onRelease} data-action="release" data-tour="inbox-release">{ACTIONS.release}</button>}
          {c.can_pause && <button type="button" className="btn btn-ghost btn-sm" onClick={onPause} data-action="pause">{ACTIONS.pause}</button>}
        </div>
      )}
      <div className="inbox-scroll" ref={scroller} data-timeline aria-live="polite">
        {items.map((x, k) => {
          if (x.kind === 'event') return <p key={`e${k}`} className="inbox-event" data-event={x.e.kind}>{eventText(x.e, unitNames)} <span className="num">{riyadhDateTime(x.e.at)}</span></p>;
          if (x.kind === 'tpl') {
            return (
              <div key={`t${k}`} className="inbox-bubble is-out is-template" data-template-log={x.i.template}>
                <span className="inbox-chip">{MARKS.template}</span> {TEMPLATE_LABELS[x.i.template] ?? x.i.template}{x.i.ref ? <span className="latin num" dir="ltr"> {x.i.ref}</span> : null}
                <span className="inbox-meta"><span className="num">{riyadhDateTime(x.i.at)}</span> · {statusText({ status: x.i.status, error_code: null }).text}</span>
              </div>
            );
          }
          const m = x.m;
          const out = m.direction === 'out';
          if (m.kind === 'note') {
            return (
              <div key={m.id} className="inbox-note" data-msg={m.id} data-kind="note">
                <span className="inbox-chip is-bronze">{MARKS.note}</span>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <span className="inbox-meta">{m.staff_name ?? ''} · <span className="num">{riyadhDateTime(m.sent_at)}</span></span>
              </div>
            );
          }
          const st = statusText(m);
          return (
            <div key={m.id} className={`inbox-bubble ${out ? 'is-out' : 'is-in'} ${m.status === 'pending_approval' ? 'is-draft' : ''}`} data-msg={m.id} data-author={m.author} data-status={m.status}
              data-tour={m.status === 'pending_approval' ? 'inbox-draft' : undefined}>
              {m.author === 'phone' && <span className="inbox-chip">{MARKS.phone}</span>}
              {m.author === 'assistant' && <span className="inbox-chip" data-assistant-chip>{m.status === 'test' ? MARKS.test : m.status === 'pending_approval' ? 'مسودة المساعد' : 'المساعد'}</span>}
              {m.kind === 'template' && <span className="inbox-chip">{MARKS.template} · {TEMPLATE_LABELS[String(m.payload?.template ?? '')] ?? String(m.payload?.template ?? '')}</span>}
              {m.purged ? <p className="text-ink-muted text-xs">حُذف النص بعد 12 شهرًا.</p> : m.body ? <p className="whitespace-pre-wrap" dir="auto">{m.body}</p> : null}
              {m.media_path && !m.media_purged && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openMedia(m)} data-action="media">عرض الوسائط</button>}
              {(m.media_purged || (!m.media_path && ['image', 'audio', 'video', 'document', 'sticker'].includes(m.kind))) && <p className="text-xs text-ink-muted">{m.media_purged ? MARKS.media_gone : 'وسائط لم تُحفظ'}</p>}
              {m.kind === 'location' && <p className="text-xs text-ink-muted">موقع</p>}
              {m.author === 'assistant' && (m.sources?.length ?? 0) > 0 && (
                <p className="text-xs text-ink-muted" data-msg-sources>المصدر: {m.sources!.map((x) => x.title).join('، ')}</p>
              )}
              {(m.translation || translations[m.id]) && <p className="text-xs border-t border-line pt-1" data-msg-translation>الترجمة: {m.translation || translations[m.id]}</p>}
              {needsTranslation(m) && !m.translation && !translations[m.id] && edit && (
                <button type="button" className="inbox-link" onClick={() => void doTranslate(m)} data-action="translate">{ACTIONS.translate}</button>
              )}
              {m.author === 'assistant' && m.status === 'pending_approval' && edit && !closed && (
                <span className="flex flex-wrap gap-2" data-draft-actions>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!!busyDraft} onClick={() => void sendDraft(m)} data-action="draft-send">{busyDraft === m.id && <Spinner />} {DRAFT_ACTIONS.send}</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busyDraft} onClick={() => onDraft({ kind: 'edit', m })} data-action="draft-edit">{DRAFT_ACTIONS.edit}</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busyDraft} onClick={() => onDraft({ kind: 'reject', m })} data-action="draft-reject">{DRAFT_ACTIONS.reject}</button>
                </span>
              )}
              <span className="inbox-meta">
                {out && m.staff_name ? `${m.staff_name} · ` : ''}<span className="num">{riyadhDateTime(m.sent_at)}</span>
                {out && <> · <span className={st.tone === 'error' ? 'text-error' : st.tone === 'ok' ? 'text-ok' : ''} data-msg-status>{st.text}</span></>}
              </span>
              {out && m.status === 'failed' && edit && !closed && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void doRetry(m)} data-action="retry">{ACTIONS.retry}</button>}
              {m.author === 'assistant' && ['queued', 'accepted', 'sent', 'delivered', 'read'].includes(m.status) && (flagged.includes(m.id)
                ? <span className="text-xs text-ink-muted" data-flagged>أُبلغ أنه رد خاطئ</span>
                : edit && <button type="button" className="inbox-link" onClick={() => setFlagging(m)} data-action="flag-wrong">إبلاغ: رد خاطئ</button>)}
              {!out && edit && m.author === 'guest' && (m.unanswered
                ? <span className="text-xs text-ink-muted" data-unanswered>في «لم أعرف الإجابة»</span>
                : <button type="button" className="inbox-link" onClick={() => onUnanswered(m.id)} data-action="unanswered">{ACTIONS.unanswered}</button>)}
            </div>
          );
        })}
      </div>
      {edit && !closed && <Composer key={c.id} t={t} now={now} composerRef={composerRef} onSent={onChanged} onTemplate={() => onDialog('template')} />}
      {flagging && <Modal open onClose={() => setFlagging(null)} title="إبلاغ: رد خاطئ" busy={flagBusy} draftKey={`flag:${flagging.id}`}>
        {(
          <div className="grid gap-3" data-flag-form>
            <p className="text-sm text-ink-muted">يُضاف سؤال الضيف إلى «لم أعرف الإجابة» لتصحيح البطاقة، ويصل تنبيه لمدير النظام، ويُحسب في أرقام «التراخيص». لا يتغير أي ترخيص تلقائيًا.</p>
            <Field label="ما الخطأ؟ (ملاحظة داخلية، اختيارية)" id="flag-note">
              <textarea id="flag-note" className="field min-h-20" maxLength={500} value={flagNote} onChange={(e) => setFlagNote(e.target.value)} disabled={flagBusy} data-field="flag-note" />
            </Field>
            <div className="flex justify-end gap-2">
              <CancelButton disabled={flagBusy} />
              <button type="button" className="btn btn-primary" onClick={() => void doFlag()} disabled={flagBusy} data-action="flag-save">{flagBusy && <Spinner />} تسجيل أنه خاطئ</button>
            </div>
          </div>
        )}
      </Modal>}
      {!edit && <p className="p-3 text-xs text-ink-muted border-t border-line">صلاحيتك هنا للعرض فقط.</p>}
      {closed && edit && <p className="p-3 text-xs text-ink-muted border-t border-line" data-closed-note>المحادثة مغلقة. إن كتب الضيف تبدأ محادثة جديدة.</p>}
    </div>
  );
}

function Composer({ t, now, composerRef, onSent, onTemplate }: { t: Thread; now: number; composerRef: React.RefObject<HTMLTextAreaElement | null>; onSent: () => Promise<void>; onTemplate: () => void }) {
  const toast = useToast();
  const c = t.conversation;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const key = useRef<string | null>(null);
  const [fromSuggestion, setFromSuggestion] = useState(false);
  const [sugs, setSugs] = useState<{ text: string; ok: boolean; reasons: string[] }[] | null>(null);
  const [sugBusy, setSugBusy] = useState(false);
  const w = windowState(c.window_expires_at, now);
  async function getSuggestions() {
    if (sugBusy) return;
    setSugBusy(true);
    try {
      const r = await suggest(c.id);
      if (!r.ok) toast(assistError(r.error), 'error');
      else setSugs(r.suggestions ?? []);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSugBusy(false);
    }
  }
  const blocker = t.guest.blocked ? 'hub_blocked' : !c.sending_enabled ? 'hub_sending_off' : null;

  async function go(mode: 'text' | 'held') {
    const body = text.trim();
    if (!body || busy) return;
    key.current ??= newKey();
    setBusy(true);
    try {
      const L = c.language === 'en' ? 'en' : 'ar';
      const r = fromSuggestion && mode === 'text' ? await sendSuggestion(c.id, body, key.current, L) : await send(c.id, mode, body, key.current, L);
      if (!r.ok) {
        toast(r.error === 'hub_guard' ? assistError('hub_guard') : sendError(r.error ?? r.results?.find((x) => x.status === 'failed')?.error_code), 'error');
      } else {
        toast(mode === 'held' ? 'أُرسل قالب «لدى الفريق رد»، ويُرسل ردك عندما يكتب الضيف.' : r.existing ? 'أُرسل هذا الرد من قبل.' : 'أُرسل الرد.');
        setText('');
        key.current = null;
        setFromSuggestion(false);
        setSugs(null);
        setVersion((v) => v + 1);
      }
      await onSent();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DirtyScope version={version} draftKey={`inbox:${c.id}`} className="border-t border-line p-3 grid gap-2" data-composer data-window-open={w.open ? 'yes' : 'no'} data-tour="inbox-composer">
      <p className={`text-xs ${w.open ? 'text-ink-muted' : 'text-error'}`} data-window>{w.text}</p>
      {blocker && <p className="note-amber text-xs" role="note" data-blocker={blocker}>{sendError(blocker)}</p>}
      <label className="sr-only" htmlFor={`reply-${c.id}`}>الرد</label>
      <textarea id={`reply-${c.id}`} ref={composerRef} className="field" rows={3} maxLength={4096} value={text} disabled={busy || !!blocker}
        placeholder={w.open ? 'اكتب ردك…' : 'اكتب ردك؛ يُرسل عندما يكتب الضيف'} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void go(w.open ? 'text' : 'held'); } }} data-reply aria-keyshortcuts="Alt+R" />
      {sugs && (
        <ul className="grid gap-1" data-suggestions>
          {sugs.length === 0 && <li className="text-xs text-ink-muted">لا اقتراحات من المعرفة لهذا السؤال.</li>}
          {sugs.map((x, i) => (
            <li key={i} className="inbox-note flex flex-wrap items-start justify-between gap-2" data-suggestion={i} data-suggestion-ok={x.ok ? 'yes' : 'no'}>
              <span className="whitespace-pre-wrap min-w-0" dir="auto">{x.text}</span>
              {x.ok
                ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setText(x.text); setFromSuggestion(true); }} data-action="suggestion-use">استخدام</button>
                : <span className="text-xs text-error">لا يجتاز قواعد الرد</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {w.open && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void getSuggestions()} disabled={busy || sugBusy || !!blocker} data-action="suggestions" data-tour="inbox-suggestions">{sugBusy && <Spinner />} {ACTIONS.suggestions}</button>}
        {!w.open && <button type="button" className="btn btn-ghost btn-sm" onClick={onTemplate} disabled={busy || !!blocker} data-action="template">{ACTIONS.template}</button>}
        {w.open
          ? <button type="button" className="btn btn-primary btn-sm" onClick={() => void go('text')} disabled={busy || !!blocker || !text.trim()} data-action="send">{busy && <Spinner />} {ACTIONS.send}</button>
          : <button type="button" className="btn btn-primary btn-sm" onClick={() => void go('held')} disabled={busy || !!blocker || !text.trim() || !c.templates_approved.length} data-action="held">{busy && <Spinner />} {ACTIONS.held}</button>}
      </div>
    </DirtyScope>
  );
}

function TemplateDialog({ open, t, onClose, onDone }: { open: boolean; t: Thread; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const c = t.conversation;
  const approved = c.templates_approved;
  const [lang, setLang] = useState<'ar' | 'en'>(c.language === 'en' && approved.includes('en') ? 'en' : 'ar');
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const def = (tplDefs as unknown as { hub_reply_ready: Record<'ar' | 'en', { body: string }> }).hub_reply_ready[lang];
  const name = c.unit_kind === 'branch' ? (lang === 'en' ? `Armada Residence – ${c.branch === 'shafa-road' ? 'Shafa Road' : 'Airport Road'}` : `أرمادا ريزيدنس – ${BRANCH_NAMES[c.branch] ?? ''}`) : c.unit_name;
  async function go() {
    key.current ??= newKey();
    setBusy(true);
    try {
      const r = await send(c.id, 'template', null, key.current, lang);
      if (!r.ok) toast(sendError(r.error ?? r.results?.[0]?.error_code), 'error');
      else {
        toast('أُرسل القالب.');
        key.current = null;
        await onDone();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={ACTIONS.template} busy={busy}>
      <div className="grid gap-3" data-template-dialog>
        <p className="text-sm">قالب «لدى الفريق رد» (<span className="latin" dir="ltr">hub_reply_ready</span>) — يُرسل بعد انتهاء نافذة الرد ليدعو الضيف إلى متابعة المحادثة. المعتمد على هذا الرقم فقط.</p>
        <div className="segmented w-fit" role="radiogroup" aria-label="لغة القالب">
          {(['ar', 'en'] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={lang === l} className={`seg ${lang === l ? 'is-on' : ''}`} disabled={!approved.includes(l) || busy} onClick={() => setLang(l)} data-lang={l}>
              {l === 'ar' ? 'العربية' : 'الإنجليزية'}{approved.includes(l) ? '' : ' (غير معتمد)'}
            </button>
          ))}
        </div>
        <blockquote className="inbox-note whitespace-pre-wrap" dir={lang === 'en' ? 'ltr' : 'rtl'} data-template-preview>{def.body.replace('{{1}}', name)}</blockquote>
        <div className="flex justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" onClick={() => void go()} disabled={busy || !approved.includes(lang)} data-action="template-send" data-autofocus>{busy && <Spinner />} إرسال القالب</button>
        </div>
      </div>
    </Modal>
  );
}

function TransferDialog({ open, t, onClose, onDone }: { open: boolean; t: Thread; onClose: () => void; onDone: () => Promise<void> }) {
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (!unit) return setErr('اختر الوحدة.');
    if (note.trim().length < 2) return setErr('اكتب ملاحظة للفريق الآخر.');
    setBusy(true);
    try {
      await transfer(t.conversation.id, unit, note.trim());
      setBusy(false);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={ACTIONS.transfer} busy={busy} draftKey={`inbox-transfer:${t.conversation.id}`}>
      <div className="grid gap-3" data-transfer-dialog>
        <p className="text-sm text-ink-muted">تنتقل المحادثة إلى فريق الوحدة الأخرى، ويبقى الضيف يراسل الرقم نفسه.</p>
        <Field label="إلى الوحدة" id="tr-unit">
          <select id="tr-unit" className="field" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={busy}>
            <option value="">اختر الوحدة</option>
            {t.transfer_units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="ملاحظة للفريق (مطلوبة)" id="tr-note">
          <textarea id="tr-note" className="field" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </Field>
        {err && <p className="text-sm media-err" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" onClick={() => void go()} disabled={busy} data-action="transfer-go">{busy && <Spinner />} {ACTIONS.transfer}</button>
        </div>
      </div>
    </Modal>
  );
}

function NoteDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (!text.trim()) return setErr('اكتب الملاحظة.');
    setBusy(true);
    try {
      await addNote(id, text.trim());
      setText('');
      setBusy(false);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={ACTIONS.note} busy={busy} draftKey={`inbox-note:${id}`}>
      <div className="grid gap-3" data-note-dialog>
        <p className="text-sm text-ink-muted">{MARKS.note}.</p>
        <Field label="الملاحظة" id="note-text">
          <textarea id="note-text" className="field" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        </Field>
        {err && <p className="text-sm media-err" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" onClick={() => void go()} disabled={busy} data-action="note-save">{busy && <Spinner />} حفظ الملاحظة</button>
        </div>
      </div>
    </Modal>
  );
}

function GuestPanel({ t, edit, onBack, onOpen, onAssign }: { t: Thread; edit: boolean; onBack: () => void; onOpen: (id: string) => void; onAssign: (staff: string) => void }) {
  const g = t.guest;
  const c = t.conversation;
  const [owner, setOwner] = useState(c.owner_staff_id ?? '');
  useEffect(() => setOwner(c.owner_staff_id ?? ''), [c.owner_staff_id]);
  return (
    <div className="grid gap-4 p-3" data-guest-panel>
      <button type="button" className="btn btn-ghost btn-sm justify-self-start inbox-narrow" onClick={onBack} data-action="back-thread">رجوع إلى المحادثة</button>
      <section className="grid gap-1">
        <h2 className="font-bold">{g.label}</h2>
        <dl className="inbox-dl text-sm">
          <dt>الجوال</dt><dd className="latin num" dir="ltr">{g.phone ?? '—'}</dd>
          {g.wa_name && g.name && <><dt>اسم واتساب</dt><dd dir="auto">{g.wa_name}</dd></>}
          <dt>اللغة</dt><dd>{(c.language ?? g.language) === 'en' ? 'الإنجليزية' : 'العربية'}</dd>
          <dt>إياب</dt><dd>{g.member ? 'عضو' : 'ليس عضوًا'}</dd>
          <dt>الموافقة</dt><dd>{g.consent === 'granted' ? 'موافق' : g.consent === 'withdrawn' ? 'سحب الموافقة' : 'بلا موافقة'}</dd>
          <dt>رسائل العروض</dt><dd>{g.opted_out ? 'أوقفها' : g.marketing_hold ? 'معلّقة مؤقتًا' : 'تصله'}</dd>
          <dt>الإقامات</dt><dd className="num">{g.stays}{g.stays ? ' · ضيف عائد' : ''}</dd>
          <dt>آخر إقامة</dt><dd className="num">{g.last_stay ? shortDate(g.last_stay) : '—'}</dd>
          {g.blocked && <><dt>الرقم</dt><dd className="text-error" data-blocked>محظور</dd></>}
        </dl>
      </section>
      {c.referral && (
        <section className="grid gap-1" data-referral>
          <h3 className="label">جاء من إعلان</h3>
          <p className="text-sm" dir="auto">{c.referral.headline ?? c.referral.source_type ?? 'إعلان'}</p>
        </section>
      )}
      <section className="grid gap-1">
        <h3 className="label">الحجوزات</h3>
        {!g.bookings.length ? <p className="text-sm text-ink-muted">لا حجوزات تظهر لك.</p> : (
          <ul className="grid gap-1 text-sm" data-guest-bookings>
            {g.bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap gap-x-2">
                <a className="link latin num" dir="ltr" href={`bookings?ref=${encodeURIComponent(b.ref)}`}>{b.ref}</a>
                <span>{STATUS_LABELS[b.status] ?? b.status}</span>
                <span>{BRANCH_NAMES[b.branch] ?? b.branch}</span>
                <span className="num">{shortDate(b.check_in)} ← {shortDate(b.check_out)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {(g.tags.length > 0 || g.notes) && (
        <section className="grid gap-1">
          <h3 className="label">وسوم وملاحظات العميل</h3>
          {g.tags.length > 0 && <p className="text-sm">{g.tags.join('، ')}</p>}
          {g.notes && <p className="text-sm whitespace-pre-wrap">{g.notes}</p>}
        </section>
      )}
      {edit && c.state !== 'closed' && t.team.length > 0 && (
        <section className="grid gap-1" data-assign>
          <label className="label" htmlFor="inbox-owner">المسؤول عن المحادثة</label>
          <div className="flex gap-2">
            <select id="inbox-owner" className="field" value={owner} onChange={(e) => setOwner(e.target.value)} data-no-dirty>
              <option value="">اختر</option>
              {t.team.map((m) => <option key={m.staff_id} value={m.staff_id}>{m.full_name}</option>)}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!owner || owner === c.owner_staff_id} onClick={() => onAssign(owner)} data-action="assign">إسناد</button>
          </div>
        </section>
      )}
      {t.episodes.length > 0 && (
        <section className="grid gap-1">
          <h3 className="label">محادثات سابقة</h3>
          <ul className="grid gap-1 text-sm" data-episodes>
            {t.episodes.map((e) => (
              <li key={e.id}><button type="button" className="inbox-link" onClick={() => onOpen(e.id)}>{e.unit_name} · {STATE_LABELS[e.state]} · <span className="num">{shortDate(e.created_at.slice(0, 10))}</span></button></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** «تعديل ثم إرسال» (H5): the draft's text edited by the staff member, then the same compare-and-set and send */
function DraftEditDialog({ open, m, onClose, onDone }: { open: boolean; m: Msg | null; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState(m?.body ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(m?.body ?? ''), [m?.id]);
  async function go() {
    if (!m || !text.trim()) return;
    setBusy(true);
    try {
      const r = await approve(m.id, text.trim());
      if (!r.ok) toast(sendError(r.error ?? r.results?.[0]?.error_code), 'error');
      else {
        toast(r.existing ? 'هذه المسودة أُرسلت أو تجاوزتها رسالة أحدث.' : 'أُرسل الرد بعد تعديله.');
        setBusy(false);
        await onDone();
        return;
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title={DRAFT_ACTIONS.edit} busy={busy} draftKey={m ? `inbox-draft-edit:${m.id}` : undefined}>
      <div className="grid gap-3" data-draft-edit-dialog>
        <p className="text-sm text-ink-muted">عدّل رد المساعد ثم أرسله. يُرسل باسم الفرع من الرقم نفسه.</p>
        <Field label="الرد" id="draft-edit-text">
          <textarea id="draft-edit-text" className="field" rows={5} maxLength={4096} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} dir="auto" />
        </Field>
        <div className="flex justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" onClick={() => void go()} disabled={busy || !text.trim()} data-action="draft-edit-send">{busy && <Spinner />} {ACTIONS.send}</button>
        </div>
      </div>
    </Modal>
  );
}

/** «رفض» (copy.md §6): a reason from the short list + an optional note; the conversation goes to the staff member */
function DraftRejectDialog({ open, m, onClose, onDone }: { open: boolean; m: Msg | null; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [reason, setReason] = useState<RejectReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setReason('');
    setNote('');
    setErr(null);
  }, [m?.id]);
  async function go() {
    if (!m) return;
    if (!reason) return setErr('اختر سبب الرفض.');
    setBusy(true);
    try {
      await reject(m.id, reason, note.trim() || null);
      toast('رُفضت المسودة، والمحادثة معك الآن.');
      setBusy(false);
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={DRAFT_ACTIONS.reject} busy={busy} draftKey={m ? `inbox-draft-reject:${m.id}` : undefined}>
      <div className="grid gap-3" data-draft-reject-dialog>
        <fieldset className="grid gap-1">
          <legend className="label">سبب الرفض</legend>
          {REJECT_REASONS.map((r) => (
            <label key={r.key} className="flex items-center gap-2 min-h-8 text-sm">
              <input type="radio" name="draft-reason" className="size-4 accent-bronze-deep" checked={reason === r.key} onChange={() => setReason(r.key)} disabled={busy} data-reject-reason={r.key} />
              {r.label}
            </label>
          ))}
        </fieldset>
        <Field label="ملاحظة (اختيارية، لا تصل للضيف)" id="draft-reject-note">
          <textarea id="draft-reject-note" className="field" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </Field>
        {err && <p className="text-sm media-err" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" onClick={() => void go()} disabled={busy} data-action="draft-reject-go">{busy && <Spinner />} {DRAFT_ACTIONS.reject}</button>
        </div>
      </div>
    </Modal>
  );
}
