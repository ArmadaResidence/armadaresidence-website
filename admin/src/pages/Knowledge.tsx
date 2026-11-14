// «قاعدة المعرفة» — Guest Hub H4 (14 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §4.6, §4.7, §5.4, §5.10; DECISIONS.md
// 2026-11-14 «Guest Hub H4 — the knowledge base»). The facts the assistant may state, each with its source:
//   - «البطاقات»: every card (units, topics, both languages, the source and its date, who verified it, an expiry); its
//     chips say what the engine reads (منشورة / مسودة / منتهية / مؤرشفة) and what blocks publishing. «إضافة بطاقة» /
//     «تعديل» opens the editor (the shared Modal and its dirty guard; the site's date picker for both dates); save keeps a
//     draft; «نشر» publishes every pending card together (knowledge: publish) — never undoable: edit and publish again.
//     «أرشفة» takes a card out of every reply at once («تراجع» brings it back).
//   - «لم أعرف الإجابة»: the questions staff marked «المساعد لم يعرف», grouped by topic and close wording with a count;
//     the guest's words only for the units the user's team covers; «إنشاء بطاقة» (prefilled with the topic and the question
//     — never the guest's details) with «وأضفه للأسئلة الشائعة» (a DRAFT there, content: edit), «ربط ببطاقة», «تجاهل».
//   - «الأسئلة الشائعة»: read-only — what the engine reads from the published FAQ, the fees filled from Settings.
//   - «تنتهي قريبًا»: cards ending within 14 days and offers within 7 (the daily email lists the same).
// H6 (14 Nov 2026): «نشر» goes through the test lab (components/EvalGate.tsx — the estimated cost first, then the bank on
// the candidate cards; a regression blocks with the list); a question answered by a staff member shows the DRAFT card
// written from that reply (prompts.md §7) with «مراجعة ونشر» — the price the reply stated apart, never in the text;
// ?new=<topic>&faq=1 (from «رادار الأسئلة») opens a new card on that topic with «وأضف مسودة للأسئلة الشائعة».
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { countWord, longDate, riyadhToday, type CountNoun } from '../lib/format';
import { FAQ_CATEGORIES } from '../lib/faq';
import * as K from '../lib/knowledge';
import type { Card, CardFields, CardProblem, ExpiringItem, FaqRead, KnowledgeMeta, QueueRow } from '../lib/knowledge';
import DateField from '../components/DateField';
import EvalGate from '../components/EvalGate';
import { faqDraftFromCard } from '../lib/lab';
import { CancelButton, Empty, ErrorBox, Field, Loading, Modal, Segmented, Spinner, useToast } from '../components/ui';

const CARD: CountNoun = { zero: 'لا بطاقات', one: 'بطاقة واحدة', two: 'بطاقتان', few: 'بطاقات', many: 'بطاقة', gen: 'بطاقة' };
const TIMES: CountNoun = { zero: 'لم يُسأل', one: 'سُئل مرة واحدة', two: 'سُئل مرتين', few: 'مرات', many: 'مرة', gen: 'مرة' };
const DAYS: CountNoun = { zero: 'اليوم', one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا', gen: 'يوم' };
const PROBLEM: CountNoun = { zero: '', one: 'ملاحظة تمنع النشر', two: 'ملاحظتان تمنعان النشر', few: 'ملاحظات تمنع النشر', many: 'ملاحظة تمنع النشر', gen: 'ملاحظة' };
type Tab = 'cards' | 'queue' | 'faq' | 'expiring';
const TABS: { key: Tab; label: string }[] = [
  { key: 'cards', label: 'البطاقات' },
  { key: 'queue', label: 'لم أعرف الإجابة' },
  { key: 'faq', label: 'الأسئلة الشائعة' },
  { key: 'expiring', label: 'تنتهي قريبًا' },
];
const timesText = (n: number) => (n <= 2 ? countWord(n, TIMES) : `سُئل ${countWord(n, TIMES)}`);

type Editing = { card: Card | null; from?: QueueRow; topic?: string | null; offerFaq?: boolean };

export default function Knowledge() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'knowledge');
  const publisher = api.canPublish(me, 'knowledge');
  const contentEdit = api.canEdit(me, 'content');
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'cards') as Tab;
  const [m, setM] = useState<KnowledgeMeta | null>(null);
  const [list, setList] = useState<Card[] | null>(null);
  const [q, setQ] = useState<{ rows: QueueRow[]; open: number } | null>(null);
  const [qStatus, setQStatus] = useState<'open' | 'answered' | 'dismissed'>('open');
  const [faq, setFaq] = useState<FaqRead[] | null>(null);
  const [exp, setExp] = useState<{ today: string; card_days: number; offer_days: number; items: ExpiringItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [blocked, setBlocked] = useState<K.PublishResult | null>(null);
  const [link, setLink] = useState<QueueRow | null>(null);
  const [gate, setGate] = useState(false);
  const [filter, setFilter] = useState({ unit: 'all', topic: '', state: 'live', search: '' });

  const load = useCallback(async () => {
    try {
      setError(null);
      const [mm, cc, qq, ff, ee] = await Promise.all([K.meta(), K.cards(), K.queue(qStatus), K.faqRead(), K.expiring()]);
      setM(mm);
      setList(cc);
      setQ(qq);
      setFaq(ff);
      setExp(ee);
    } catch (e) {
      setError((e as Error).message);
      setList((x) => x ?? []);
    }
  }, [qStatus]);
  useEffect(() => {
    void load();
  }, [load]);
  // «إنشاء بطاقة» from «رادار الأسئلة»: ?new=<topic>[&faq=1] opens the editor once
  useEffect(() => {
    const t = params.get('new');
    if (t === null || !editable) return;
    setEditing({ card: null, topic: t || null, offerFaq: params.get('faq') === '1' });
    const p = new URLSearchParams(params);
    p.delete('new');
    p.delete('faq');
    setParams(p, { replace: true });
  }, [params, editable, setParams]);

  const shown = useMemo(() => {
    const s = filter.search.trim().toLowerCase();
    return (list ?? []).filter((c) =>
      (filter.state === 'all' || (filter.state === 'live' ? c.state !== 'archived' : c.state === filter.state))
      && (filter.unit === 'all' || (filter.unit === 'shared' ? c.unit_keys.length !== 1 : c.unit_keys.includes(filter.unit)))
      && (!filter.topic || c.topic_keys.includes(filter.topic))
      && (!s || `${c.title_ar} ${c.title_en} ${c.text_ar} ${c.text_en} ${c.key}`.toLowerCase().includes(s)));
  }, [list, filter]);
  const pending = (list ?? []).filter((c) => c.pending).length;

  function setTab(t: Tab) {
    const p = new URLSearchParams(params);
    if (t === 'cards') p.delete('tab');
    else p.set('tab', t);
    setParams(p, { replace: true });
  }

  async function doPublish() {
    setPublishing(true);
    try {
      // the problems first; then the test lab (spec §4.8) — the publish itself names the run that passed
      const r = await K.publishCheck();
      if (r.reason === 'nothing') toast('لا تغييرات للنشر.');
      else if (r.reason === 'blocked') setBlocked(r);
      else setGate(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPublishing(false);
    }
  }
  const publishWith = useCallback(async (run: string) => {
    try {
      const r = await K.publish(run);
      if (r.ok) {
        setGate(false);
        setBlocked(null);
        toast(`نُشرت ${countWord(r.count ?? 0, CARD)} بعد نجاح الاختبار؛ يقرؤها المساعد من الآن. لا تراجع عن النشر: عدّل ثم انشر من جديد.`);
        await load();
      } else if (r.reason === 'blocked') {
        setGate(false);
        setBlocked(r);
      } else toast('تغيّرت البطاقات أثناء الاختبار؛ اضغط «نشر» من جديد.', 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }, [load, toast]);
  async function archive(c: Card) {
    try {
      await K.archiveCard(c.id);
      toast.undo(`أُرشفت «${c.title_ar}» وخرجت من الردود.`, async () => {
        await K.restoreCard(c.id);
        await load();
      });
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  async function restore(c: Card) {
    try {
      await K.restoreCard(c.id);
      toast.undo(`استُرجعت «${c.title_ar}».`, async () => {
        await K.archiveCard(c.id);
        await load();
      });
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  async function setTopic(r: QueueRow, topic: string) {
    try {
      await K.setQueueTopic(r.id, topic || null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  async function dismiss(r: QueueRow) {
    try {
      await K.resolve(r.id, { action: 'dismiss' });
      toast('تجاهلنا هذا السؤال؛ يبقى في «متجاهلة».');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (list === null || m === null) return error ? <ErrorBox error={error} /> : <Loading />;
  const openCount = q?.open ?? 0;
  return (
    <div className="grid gap-5 max-w-6xl" data-page="knowledge">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">قاعدة المعرفة</h1>
          <p className="text-sm text-ink-muted mt-1">
            المعلومات التي يجيب منها المساعد، كل بطاقة بمصدرها وتاريخه. لا يقرأ المساعد أي بطاقة قبل «نشر»، ولا يذكر سعر غرفة أو رسمًا من بطاقة: الأسعار من التقويم والرسوم من الإعدادات.
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : !publisher ? ' النشر لمن يملك صلاحية «نشر» في «قاعدة المعرفة».' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && <button type="button" className="btn btn-ghost" onClick={() => setEditing({ card: null })} data-action="card-add" data-tour="kn-add">إضافة بطاقة</button>}
          {publisher && (
            <button type="button" className="btn btn-primary" onClick={doPublish} disabled={publishing || !pending} data-action="kn-publish" data-tour="kn-publish">
              {publishing && <Spinner />} نشر{pending ? <span className="num"> ({pending})</span> : ''}
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="inbox-tabs" role="tablist" aria-label="أقسام قاعدة المعرفة" data-tour="kn-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`inbox-tab ${tab === t.key ? 'is-on' : ''}`} onClick={() => setTab(t.key)} data-tab={t.key}>
            {t.label}
            {t.key === 'queue' && openCount > 0 && <span className="num inbox-count" data-count="queue">{openCount}</span>}
            {t.key === 'expiring' && (exp?.items.length ?? 0) > 0 && <span className="num inbox-count" data-count="expiring">{exp?.items.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'cards' && (
        <section className="grid gap-3" aria-label="البطاقات" data-tour="kn-cards">
          <div className="card p-3 grid gap-3 sm:grid-cols-4" data-kn-filters>
            <Field label="الوحدة" id="kn-unit">
              <select id="kn-unit" className="field" value={filter.unit} onChange={(e) => setFilter({ ...filter, unit: e.target.value })}>
                <option value="all">كل البطاقات</option>
                <option value="shared">المشتركة</option>
                {m.units.map((u) => <option key={u.key} value={u.key}>{u.name_ar}</option>)}
              </select>
            </Field>
            <Field label="الموضوع" id="kn-topic">
              <select id="kn-topic" className="field" value={filter.topic} onChange={(e) => setFilter({ ...filter, topic: e.target.value })}>
                <option value="">كل المواضيع</option>
                {m.topics.map((t) => <option key={t.key} value={t.key}>{t.label_ar}</option>)}
              </select>
            </Field>
            <Field label="الحالة" id="kn-state">
              <select id="kn-state" className="field" value={filter.state} onChange={(e) => setFilter({ ...filter, state: e.target.value })}>
                <option value="live">غير المؤرشفة</option>
                <option value="published">منشورة</option>
                <option value="draft">مسودة</option>
                <option value="expired">منتهية</option>
                <option value="archived">مؤرشفة</option>
                <option value="all">الكل</option>
              </select>
            </Field>
            <Field label="بحث" id="kn-search">
              <input id="kn-search" className="field" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} placeholder="العنوان أو النص" />
            </Field>
          </div>
          <p className="text-sm text-ink-muted" data-kn-count>{countWord(shown.length, CARD)}</p>
          {!shown.length && <Empty text="لا بطاقات بهذه التصفية." />}
          <ul className="grid gap-2">
            {shown.map((c) => (
              <li key={c.id} className="card p-3 grid gap-1.5" data-card={c.key} data-card-state={c.state}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{c.title_ar || <span className="text-ink-muted">بلا عنوان بالعربية</span>}</div>
                    <div className="latin text-xs text-ink-muted mt-0.5" dir="ltr">{c.title_en}</div>
                    <p className="text-sm mt-1 kn-text">{c.text_ar}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className={`chip ${c.state === 'published' ? 'chip-confirmed' : c.state === 'archived' ? 'chip-cancelled' : 'chip-request'}`} data-state>{K.STATE_LABEL[c.state]}</span>
                      {c.live && c.pending && c.state !== 'archived' && <span className="chip chip-request" data-pending>تعديلات غير منشورة</span>}
                      {c.check.missing.length > 0 && c.state !== 'archived' && <span className="chip chip-test" data-missing>{countWord(c.check.missing.length, PROBLEM)}</span>}
                      <span className="chip" data-units>{K.unitsText(c.unit_keys, m.units)}</span>
                      {c.topic_keys.map((t) => <span key={t} className="chip" data-topic={t}>{K.topicLabel(t, m.topics)}</span>)}
                    </div>
                    <p className="text-xs text-ink-muted mt-1">
                      المصدر: {c.source || '—'}{c.source_date ? <> · <span className="num">{longDate(c.source_date)}</span></> : null}
                      {c.verified_by_name ? <> · تحقّق منها {c.verified_by_name}</> : null}
                      {c.expires_on ? <> · تنتهي <span className="num">{longDate(c.expires_on)}</span></> : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ card: c })} data-action="card-edit">{editable && c.status !== 'archived' ? 'تعديل' : 'عرض'}</button>
                    {editable && c.status !== 'archived' && (!c.live || publisher) && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => archive(c)} aria-label={`أرشفة «${c.title_ar}»`} data-action="card-archive">أرشفة</button>
                    )}
                    {editable && c.status === 'archived' && (!c.live || publisher) && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => restore(c)} aria-label={`استرجاع «${c.title_ar}»`} data-action="card-restore">استرجاع</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'queue' && (
        <section className="grid gap-3" aria-label="لم أعرف الإجابة" data-tour="kn-queue">
          <p className="text-sm text-ink-muted">أسئلة ضغط عليها الفريق «المساعد لم يعرف» في «المحادثات»، مجمّعة بالموضوع والصياغة القريبة. نص السؤال يظهر لفريق الوحدة فقط، ولا يُنسخ إلى البطاقة إلا ما تكتبه أنت.</p>
          <Segmented value={qStatus} onChange={(v) => setQStatus(v)} label="حالة الأسئلة" options={K.QUEUE_STATUS} />
          {!q?.rows.length && <Empty text={qStatus === 'open' ? 'لا أسئلة تنتظر إجابة.' : 'لا شيء هنا.'} />}
          <ul className="grid gap-2">
            {(q?.rows ?? []).map((r) => (
              <li key={r.id} className="card p-3 grid gap-2" data-queue={r.id}>
                <div className="grid gap-1">
                  {r.excerpts.length ? r.excerpts.map((x, i) => <p key={i} className="font-semibold kn-text" data-excerpt>«{x}»</p>)
                    : <p className="text-sm text-ink-muted" data-excerpt-hidden>نص السؤال متاح لفريق الوحدة فقط.</p>}
                  {r.excerpts.length > 0 && r.hidden_excerpts > 0 && <p className="text-xs text-ink-muted">وصيغ أخرى من وحدات لست في فريقها.</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="chip" data-times>{timesText(r.count)}</span>
                  {(r.units ?? []).map((u) => <span key={u} className="chip">{u}</span>)}
                  <span className="text-xs text-ink-muted">آخر مرة <span className="num">{longDate(K.riyadhDay(r.last_at))}</span></span>
                </div>
                {qStatus === 'open' && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="الموضوع" id={`q-topic-${r.id}`}>
                      <select id={`q-topic-${r.id}`} className="field" value={r.topic_key ?? ''} disabled={!editable} onChange={(e) => setTopic(r, e.target.value)} data-queue-topic>
                        <option value="">بلا موضوع</option>
                        {m.topics.map((t) => <option key={t.key} value={t.key}>{t.label_ar}</option>)}
                      </select>
                    </Field>
                    {editable && (
                      <>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ card: null, from: r })} data-action="queue-card">إنشاء بطاقة</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLink(r)} data-action="queue-link">ربط ببطاقة موجودة</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss(r)} aria-label="تجاهل هذا السؤال" data-action="queue-dismiss">تجاهل</button>
                      </>
                    )}
                  </div>
                )}
                {qStatus === 'open' && r.draft_card && (
                  <div className="kn-draft grid gap-1 p-2 rounded-lg" data-draft-card={r.draft_card.key}>
                    <p className="text-xs font-semibold">مسودة بطاقة من رد الفريق — تحتاج اعتمادك</p>
                    <p className="font-semibold">{r.draft_card.title_ar || r.draft_card.title_en}</p>
                    <p className="text-xs text-ink-muted">{r.draft_card.source}</p>
                    {r.draft_card.price_note && <p className="text-xs note-amber" data-price-note>سعر ذكره الرد (لا يُكتب في البطاقة): {r.draft_card.price_note}</p>}
                    {r.draft_card.problems > 0 && <p className="text-xs">{countWord(r.draft_card.problems, PROBLEM)}</p>}
                    {editable && (
                      <button type="button" className="btn btn-primary btn-sm justify-self-start" onClick={() => setEditing({ card: list.find((c) => c.id === r.draft_card!.id) ?? null, from: r })} data-action="draft-review">مراجعة ونشر</button>
                    )}
                  </div>
                )}
                {qStatus !== 'open' && r.resolved_card_id && <p className="text-xs text-ink-muted">أُجيب ببطاقة{r.resolved_faq_id ? ' وسؤال في «الأسئلة الشائعة»' : ''}.</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'faq' && (
        <section className="grid gap-3" aria-label="الأسئلة الشائعة كما يقرؤها المساعد" data-tour="kn-faq">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">للقراءة فقط: الأسئلة المنشورة في /faq/ كما يقرؤها المساعد، والرسوم من الإعدادات. تُعدَّل وتُنشر من «الأسئلة الشائعة».</p>
            {api.canView(me, 'content') && <Link className="btn btn-ghost btn-sm" to="/faq" data-action="faq-open">فتح «الأسئلة الشائعة»</Link>}
          </div>
          {!faq?.length && <Empty text="لا أسئلة منشورة." />}
          <ul className="grid gap-2">
            {(faq ?? []).map((f) => (
              <li key={f.id} className="card p-3 grid gap-1" data-faq-read={f.key}>
                <div className="font-semibold">{f.q_ar}</div>
                <p className="text-sm kn-text">{f.a_ar}</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="chip">{FAQ_CATEGORIES.find((c) => c.key === f.category)?.label ?? f.category}</span>
                  {f.topics.length ? f.topics.map((t) => <span key={t} className="chip">{K.topicLabel(t, m.topics)}</span>) : <span className="chip chip-request" data-no-topic>لا يقرؤه أي موضوع</span>}
                  {f.pending && <span className="chip chip-request">تعديلات لم تُنشر في «الأسئلة الشائعة»</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'expiring' && (
        <section className="grid gap-3" aria-label="تنتهي قريبًا" data-tour="kn-expiring">
          <p className="text-sm text-ink-muted">بطاقات تنتهي خلال <span className="num">{exp?.card_days ?? m.card_days}</span> يومًا وعروض تنتهي خلال <span className="num">{exp?.offer_days ?? m.offer_days}</span> أيام. يصل مديري النظام بريد كل صباح حين يظهر فيها جديد.</p>
          {!exp?.items.length && <Empty text="لا شيء ينتهي قريبًا." />}
          <ul className="grid gap-2">
            {(exp?.items ?? []).map((x) => {
              const d = K.daysUntil(exp?.today ?? riyadhToday(), x.ends);
              return (
                <li key={`${x.kind}-${x.id}`} className="card p-3 flex flex-wrap items-center justify-between gap-2" data-expiring={x.kind}>
                  <div>
                    <div className="font-semibold">{x.kind === 'card' ? 'بطاقة' : 'عرض'}: {x.title ?? x.key}</div>
                    <div className="text-sm text-ink-muted">{x.kind === 'card' ? 'تنتهي' : 'ينتهي'} <span className="num">{longDate(x.ends)}</span> · {d <= 0 ? 'اليوم' : `بعد ${countWord(d, DAYS)}`}</div>
                  </div>
                  {x.kind === 'card'
                    ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ card: list.find((c) => c.id === x.id) ?? null })} data-action="expiring-card">{editable ? 'تعديل البطاقة' : 'عرض البطاقة'}</button>
                    : api.canView(me, 'offers') && <Link className="btn btn-ghost btn-sm" to="/offers">فتح «العروض»</Link>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} wide busy={busy}
        title={editing?.from && editing.card ? 'مراجعة مسودة من رد الفريق' : editing?.from ? 'بطاقة من سؤال لم يُعرف' : editing?.card ? (editable && editing.card.status !== 'archived' ? 'تعديل البطاقة' : 'البطاقة') : 'إضافة بطاقة'}
        draftKey={editing ? (editing.card ? `card:${editing.card.id}` : editing.from ? `card:queue:${editing.from.id}` : 'card:new') : undefined}>
        {editing !== null && (
          <CardForm key={editing.card?.id ?? editing.from?.id ?? 'new'} card={editing.card} from={editing.from} topic={editing.topic} offerFaq={editing.offerFaq} meta={m} me={me}
            editable={editable && editing.card?.status !== 'archived'} contentEdit={contentEdit} busy={busy} setBusy={setBusy}
            onSaved={async () => {
              setEditing(null);
              await load();
            }} />
        )}
      </Modal>
      <Modal open={!!link} onClose={() => setLink(null)} title="ربط السؤال ببطاقة موجودة" busy={busy}>
        {link && <LinkForm row={link} cards={(list ?? []).filter((c) => c.status !== 'archived')} busy={busy} setBusy={setBusy} onDone={async () => { setLink(null); await load(); }} />}
      </Modal>
      <Modal open={gate} onClose={() => setGate(false)} title="اختبار قبل النشر">
        {gate && <EvalGate kind="knowledge" title="نشر البطاقات" onPassed={publishWith} />}
      </Modal>
      <Modal open={!!blocked} onClose={() => setBlocked(null)} title="ما يمنع النشر" busy={publishing}>
        {blocked && (
          <div className="grid gap-3" data-kn-blocked>
            <p className="text-sm text-ink-muted">{blocked.reason === 'gate' ? 'أوقف مختبر الاختبار النشر.' : 'لا تُنشر البطاقات وفيها بطاقة بها ملاحظة. صحّح ما يلي ثم انشر:'}</p>
            <ul className="grid gap-2">
              {(blocked.blocked ?? []).map((x) => (
                <li key={x.id} className="text-sm" data-blocked-card={x.key}>
                  <strong>{x.title_ar || x.key}</strong>
                  <ul className="list-disc ps-5 text-ink-muted">{x.missing.map((p, i) => <li key={i}>{K.cardProblemText(p)}</li>)}</ul>
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><CancelButton label="إغلاق" /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CardForm({ card, from, topic, offerFaq, meta, me, editable, contentEdit, busy, setBusy, onSaved }: {
  card: Card | null; from?: QueueRow; topic?: string | null; offerFaq?: boolean; meta: KnowledgeMeta; me: api.Me | null; editable: boolean; contentEdit: boolean; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [f, setF] = useState<CardFields>(() => (card ? K.pickCard(card) : K.blankCard(from?.topic_key ?? topic ?? null, from?.excerpts[0] ?? '')));
  const [toFaq, setToFaq] = useState(false);
  const [faqCat, setFaqCat] = useState<K.FaqDraft['category']>('stay');
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<CardProblem[]>(card?.status !== 'archived' ? card?.check.missing ?? [] : []);
  const dis = !editable || busy;
  const set = <Key extends keyof CardFields>(k: Key, v: CardFields[Key]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'unit_keys' | 'topic_keys', v: string) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v].sort() }));
  const local: string[] = [];
  if (!f.source.trim()) local.push('اكتب المصدر.');
  if (!f.source_date) local.push('اختر تاريخ المصدر.');
  if (!f.topic_keys.length) local.push('اختر موضوعًا واحدًا على الأقل.');
  if (!f.title_ar.trim() || !f.title_en.trim() || !f.text_ar.trim() || !f.text_en.trim()) local.push('العنوان والنص مطلوبان بالعربية والإنجليزية.');
  const roots = meta.topics.filter((t) => !t.parent_key);

  async function save() {
    setError(null);
    if (!f.title_ar.trim() && !f.title_en.trim()) {
      setError('اكتب عنوان البطاقة.');
      return;
    }
    setBusy(true);
    try {
      const r = await K.saveCard(card?.id ?? null, f);
      if (from) {
        const both = toFaq && contentEdit;
        await K.resolve(from.id, { action: both ? 'both' : 'card', card_id: r.id, ...(both ? { faq: { category: faqCat, q_ar: f.title_ar, q_en: f.title_en, a_ar: f.text_ar, a_en: f.text_en } } : {}) });
      } else if (offerFaq && toFaq && contentEdit) {
        await faqDraftFromCard(r.id, faqCat);
      }
      setProblems(r.check.missing);
      toast(r.check.missing.length ? 'حُفظت المسودة؛ فيها ملاحظات تمنع النشر.' : from && toFaq ? 'حُفظت البطاقة وأُضيف السؤال مسودةً في «الأسئلة الشائعة»؛ لا تصل للمساعد قبل «نشر».' : 'حُفظت؛ لا يقرؤها المساعد قبل «نشر».', r.check.missing.length ? 'error' : undefined);
      setBusy(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const text = (lang: 'ar' | 'en') => (
    <Field label={lang === 'ar' ? 'النص بالعربية' : 'النص بالإنجليزية'} id={`card-text-${lang}`}>
      <textarea id={`card-text-${lang}`} className={`field min-h-32 ${lang === 'en' ? 'latin' : ''}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} maxLength={K.CARD_MAX.text} disabled={dis}
        value={lang === 'ar' ? f.text_ar : f.text_en} onChange={(e) => set(lang === 'ar' ? 'text_ar' : 'text_en', e.target.value)} data-field={`text_${lang}`} />
      <span className="text-xs text-ink-muted num block text-end">{(lang === 'ar' ? f.text_ar : f.text_en).length} / {K.CARD_MAX.text}</span>
    </Field>
  );

  return (
    <div className="grid gap-4" data-card-form>
      {card?.live && card.pending && <p className="note-amber text-sm" role="status">فيها تعديلات لم تُنشر؛ المساعد يقرأ آخر نسخة منشورة.</p>}
      {from && <p className="text-sm text-ink-muted" data-from-queue>من سؤال {timesText(from.count)}. اكتب الإجابة كما تعرفها من مصدرها؛ لا تنسخ بيانات الضيف.</p>}
      {card?.draft_origin?.kind === 'staff_reply' && (
        <p className="note-amber text-sm" role="note" data-draft-origin>كتبها النظام من رد الفريق على الضيف. راجع كل جملة قبل الحفظ والنشر: لا يُنشر شيء وحده، ولا يقرؤها المساعد قبل «نشر» بعد نجاح الاختبار.</p>
      )}
      {card?.price_note && (
        <p className="text-sm kn-price-note" data-price-note>سعر ذكره رد الفريق: <strong>{card.price_note}</strong> — لا يُكتب في نص البطاقة؛ الأسعار من التقويم والرسوم من الإعدادات.</p>
      )}
      <fieldset className="grid gap-1.5">
        <legend className="label">الوحدات</legend>
        <p className="text-xs text-ink-muted">بلا اختيار = كل الوحدات. البطاقة الموسومة بوحدة تأتي أولًا على رقم تلك الوحدة، وتُقرأ على رقم الفرع الآخر أيضًا.</p>
        <div className="flex flex-wrap gap-1.5">
          {meta.units.filter((u) => !u.knowledge_hidden).map((u) => (
            <button key={u.key} type="button" className={`chip-toggle ${f.unit_keys.includes(u.key) ? 'is-on' : ''}`} aria-pressed={f.unit_keys.includes(u.key)} disabled={dis} onClick={() => toggle('unit_keys', u.key)} data-unit-toggle={u.key}>
              {u.name_ar}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-1.5">
        <legend className="label">المواضيع</legend>
        <div className="flex flex-wrap gap-1.5" data-topics-selected>
          {f.topic_keys.map((k) => (
            <span key={k} className="chip">
              {K.topicLabel(k, meta.topics)}
              {!dis && <button type="button" className="ms-1 underline" onClick={() => toggle('topic_keys', k)} aria-label={`إزالة الموضوع «${K.topicLabel(k, meta.topics)}»`}>×</button>}
            </span>
          ))}
          {!f.topic_keys.length && <span className="text-xs text-ink-muted">لا موضوع بعد.</span>}
        </div>
        {!dis && (
          <select className="field" aria-label="إضافة موضوع" value="" onChange={(e) => { if (e.target.value) toggle('topic_keys', e.target.value); }} data-field="topic-add">
            <option value="">إضافة موضوع…</option>
            {roots.map((r) => (
              <optgroup key={r.key} label={r.label_ar}>
                {[r, ...meta.topics.filter((t) => t.parent_key === r.key)].filter((t) => !f.topic_keys.includes(t.key)).map((t) => (
                  <option key={t.key} value={t.key}>{t.label_ar}{t.always_handoff ? ' (للفريق دائمًا)' : ''}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </fieldset>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="العنوان بالعربية" id="card-title-ar">
          <input id="card-title-ar" className="field" dir="rtl" lang="ar" maxLength={K.CARD_MAX.title} value={f.title_ar} disabled={dis} onChange={(e) => set('title_ar', e.target.value)} data-field="title_ar" />
        </Field>
        <Field label="العنوان بالإنجليزية" id="card-title-en">
          <input id="card-title-en" className="field latin" dir="ltr" lang="en" maxLength={K.CARD_MAX.title} value={f.title_en} disabled={dis} onChange={(e) => set('title_en', e.target.value)} data-field="title_en" />
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {text('ar')}
        {text('en')}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="المصدر" id="card-source" hint="من أين جاءت المعلومة: «أحمد، 30 أكتوبر 2026» أو «branches.json».">
          <input id="card-source" className="field" maxLength={K.CARD_MAX.source} value={f.source} disabled={dis} onChange={(e) => set('source', e.target.value)} data-field="source" />
        </Field>
        <DateField mode="single" id="card-source-date" label="تاريخ المصدر" min="past" max={riyadhToday()} value={f.source_date ?? ''} onChange={(v) => set('source_date', v || null)} disabled={dis} />
        <div className="grid gap-1">
          <DateField mode="single" id="card-expires" label="تنتهي في (اختياري)" value={f.expires_on ?? ''} onChange={(v) => set('expires_on', v || null)} disabled={dis} />
          {f.expires_on && !dis && <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => set('expires_on', null)} data-action="card-no-expiry">بلا تاريخ انتهاء</button>}
        </div>
      </div>
      <p className="text-xs text-ink-muted" data-verified>
        {editable ? `يُسجَّل التحقق باسمك عند الحفظ: ${me?.full_name ?? ''}.` : ''}
        {card?.verified_by_name && card.verified_at ? ` آخر تحقق: ${card.verified_by_name}، ${longDate(K.riyadhDay(card.verified_at))}.` : ''}
      </p>
      <div className="grid gap-1" data-preview>
        <span className="label">كيف تُقرأ في الرد</span>
        <div className="kn-bubble" lang="ar" dir="rtl">{f.text_ar || '—'}</div>
      </div>
      {(from || offerFaq) && contentEdit && editable && (
        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold min-h-11">
            <input type="checkbox" className="size-4 accent-bronze-deep" checked={toFaq} onChange={(e) => setToFaq(e.target.checked)} data-field="to-faq" />
            وأضفه للأسئلة الشائعة
          </label>
          {toFaq && (
            <div>
              <span className="label">فئته في «الأسئلة الشائعة»</span>
              <Segmented value={faqCat} onChange={(v) => setFaqCat(v)} label="فئة السؤال" options={FAQ_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))} />
              <p className="text-xs text-ink-muted mt-1">يُضاف مسودةً بعنوان البطاقة سؤالًا ونصها إجابةً، ويُنشر من «الأسئلة الشائعة» بزر «نشر» هناك.</p>
            </div>
          )}
        </div>
      )}
      {(problems.length > 0 || (editable && local.length > 0)) && (
        <div className="note-amber text-sm" role="status" data-card-problems>
          <p className="font-semibold">ملاحظات تمنع النشر (يمكن حفظ المسودة):</p>
          <ul className="list-disc ps-5">
            {editable && local.map((x, i) => <li key={`l${i}`}>{x}</li>)}
            {problems.filter((p) => !['source_required', 'source_date_required', 'topic_required', 'required'].includes(p.code)).map((p, i) => <li key={i}>{K.cardProblemText(p)}</li>)}
          </ul>
        </div>
      )}
      {error && <p className="text-sm media-err" role="alert" data-form-error>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <CancelButton label={editable ? 'إلغاء' : 'إغلاق'} disabled={busy} />
        {editable && (
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="card-save">
            {busy && <Spinner />} {from ? 'حفظ البطاقة وإغلاق السؤال' : 'حفظ'}
          </button>
        )}
      </div>
    </div>
  );
}

function LinkForm({ row, cards, busy, setBusy, onDone }: { row: QueueRow; cards: Card[]; busy: boolean; setBusy: (b: boolean) => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [id, setId] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (!id) {
      setError('اختر بطاقة.');
      return;
    }
    setBusy(true);
    try {
      await K.resolve(row.id, { action: 'card', card_id: id });
      toast('رُبط السؤال بالبطاقة وأُغلق.');
      setBusy(false);
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3" data-link-form>
      <Field label="البطاقة" id="link-card">
        <select id="link-card" className="field" value={id} onChange={(e) => setId(e.target.value)} disabled={busy}>
          <option value="">اختر بطاقة…</option>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.title_ar || c.key}</option>)}
        </select>
      </Field>
      {error && <p className="text-sm media-err" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <CancelButton disabled={busy} />
        <button type="button" className="btn btn-primary" onClick={go} disabled={busy} data-action="link-save">{busy && <Spinner />} ربط وإغلاق السؤال</button>
      </div>
    </div>
  );
}
