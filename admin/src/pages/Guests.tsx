// «العملاء» — guest profiles (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «Phase 2b session 5», parts D and F):
//   - the club totals by source (all, today, this week — Riyadh, from Sunday);
//   - the list with search (name, phone, email) and filters (consent, member, club source, branch, stays ≥ N, last-stay
//     range, spend range);
//   - the guest drawer: contact, language, stays / nights / spend (confirmed bookings), first and last stay, branches,
//     the club membership and its source, the consent and its history, notes and tags (edit), the bookings; a consent
//     given in person (or withdrawn on the guest's request — source reception, the staff member, now); merging a
//     duplicate into this profile;
//   - «تصدير للإعلانات» (edit): one CSV per platform with SHA-256 hashes of the consented profiles only; the plain CSV of
//     consented contacts («تصدير العملاء» only, after a confirmation). Every export is audited (who, when, filters, rows).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../lib/api';
import { useSession } from '../lib/session';
import { BOOKING, BRANCH_NAMES, countWord, riyadhDateTime, riyadhToday, sar, shortDate, STATUS_LABELS, toCsv, type CountNoun } from '../lib/format';
import {
  audienceCsv, audienceRows, bookingGuest, CLUB_SOURCES, clubSourceLabel, clubTotals, consents, consentText, CONSENT_CHIP, CONSENT_LABEL, contactRows, guest, guestBookings, guests,
  merge, PLATFORMS, recordConsent, save, SOURCE_LABEL, type ClubTotals, type ConsentEvent, type Guest, type GuestBooking, type GuestFilter, type Platform,
} from '../lib/guests';
import { CancelButton, Confirm, Drawer, Empty, ErrorBox, Field, Loading, Modal, Spinner, useToast } from '../components/ui';
import DateField from '../components/DateField';

const GUEST: CountNoun = { zero: 'لا عملاء', one: 'عميل واحد', two: 'عميلان', few: 'عملاء', many: 'عميلًا', gen: 'عميل' };
const MEMBER: CountNoun = { zero: 'لا أعضاء', one: 'عضو واحد', two: 'عضوان', few: 'أعضاء', many: 'عضوًا', gen: 'عضو' };
const STAY: CountNoun = { zero: 'لا إقامات', one: 'إقامة واحدة', two: 'إقامتان', few: 'إقامات', many: 'إقامة', gen: 'إقامة' };
const NIGHTS: CountNoun = { zero: 'لا ليالي', one: 'ليلة واحدة', two: 'ليلتان', few: 'ليالٍ', many: 'ليلة', gen: 'ليلة' };

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Guests() {
  const { me } = useSession();
  const toast = useToast();
  const editable = api.canEdit(me, 'guests');
  const canPlain = api.canView(me, 'guests_export');
  const [rows, setRows] = useState<Guest[] | null>(null);
  const [totals, setTotals] = useState<ClubTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<GuestFilter>({});
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [plainOpen, setPlainOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // filters change faster than the database answers: only the latest request may fill the list
  const latest = useRef(0);
  const load = useCallback(async () => {
    const n = ++latest.current;
    try {
      setError(null);
      const [list, t] = await Promise.all([guests(f), clubTotals()]);
      if (n !== latest.current) return;
      setRows(list);
      setTotals(t);
    } catch (e) {
      if (n !== latest.current) return;
      setError((e as Error).message);
      setRows([]);
    }
  }, [f]);
  useEffect(() => {
    void load();
  }, [load]);
  // the search box runs 300 ms after the last key
  useEffect(() => {
    const t = setTimeout(() => setF((x) => ({ ...x, q: q.trim() || undefined })), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (id) setOpen(id);
  }, []);

  const set = (k: keyof GuestFilter, v: string) => setF((x) => ({ ...x, [k]: v || undefined }));
  const consented = useMemo(() => (rows ?? []).filter((r) => r.consent === 'granted').length, [rows]);

  async function exportPlatform(p: Platform) {
    setBusy(p);
    try {
      const data = await audienceRows(p, f);
      download(`audience-${p}-${riyadhToday()}.csv`, audienceCsv(p, data));
      toast(`صُدّر ملف ${PLATFORMS.find((x) => x.key === p)!.label}: ${countWord(data.length, GUEST)} بموافقة سارية؛ سُجّل التصدير في السجل.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function exportPlain() {
    setBusy('plain');
    try {
      const data = (await contactRows(f)).map((r) => ({ ...r, consent_time: riyadhDateTime(r.consent_at), source_ar: SOURCE_LABEL[r.consent_source] ?? r.consent_source, member_ar: r.member ? 'نعم' : 'لا', club_ar: clubSourceLabel(r.club_source), language_ar: r.language === 'en' ? 'الإنجليزية' : 'العربية' }));
      const cols = [
        { key: 'name', label: 'الاسم' }, { key: 'phone', label: 'الجوال' }, { key: 'email', label: 'البريد' }, { key: 'language_ar', label: 'اللغة' },
        { key: 'consent_time', label: 'وقت الموافقة' }, { key: 'source_ar', label: 'مصدر الموافقة' }, { key: 'member_ar', label: 'عضو النادي' }, { key: 'club_ar', label: 'مصدر العضوية' },
      ];
      download(`contacts-${riyadhToday()}.csv`, toCsv(data, cols));
      toast(`صُدّرت ${countWord(data.length, GUEST)} بموافقة سارية؛ سُجّل التصدير في السجل.`);
      setPlainOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) return <Loading />;
  return (
    <div className="grid gap-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold">العملاء</h1>
          <p className="text-sm text-ink-muted mt-1">
            ملف لكل ضيف يُبنى من الحجوزات والتسجيل في نادي أرمادا ريزيدنس، مع موافقته على العروض والإعلانات وسجلها.
            {!editable ? ' صلاحيتك هنا للعرض فقط.' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <button type="button" className="btn btn-ghost" onClick={() => setExportOpen(true)} data-action="guests-export-ads">تصدير للإعلانات</button>
          )}
          {canPlain && (
            <button type="button" className="btn btn-ghost" onClick={() => setPlainOpen(true)} data-action="guests-export-plain">تصدير جهات الاتصال</button>
          )}
        </div>
      </div>

      {totals && (
        <section className="card p-4 grid gap-3" aria-labelledby="club-totals" data-club-totals>
          <h2 id="club-totals" className="font-bold">نادي أرمادا ريزيدنس</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <p className="stat"><span className="text-sm text-ink-muted">كل الأعضاء</span> <strong className="num text-2xl" data-total="all">{totals.all}</strong></p>
            <p className="stat"><span className="text-sm text-ink-muted">اليوم</span> <strong className="num text-2xl" data-total="today">{totals.today_all}</strong></p>
            <p className="stat"><span className="text-sm text-ink-muted">هذا الأسبوع (منذ الأحد {shortDate(totals.week_from)})</span> <strong className="num text-2xl" data-total="week">{totals.week_all}</strong></p>
          </div>
          <table className="table text-sm" data-club-sources>
            <thead><tr><th scope="col">المصدر</th><th scope="col">الكل</th><th scope="col">اليوم</th><th scope="col">هذا الأسبوع</th></tr></thead>
            <tbody>
              {[...CLUB_SOURCES, { key: 'other', label: 'مصادر أخرى' }].map((s) => {
                const v = totals.sources[s.key] ?? { all: 0, today: 0, week: 0 };
                return (
                  <tr key={s.key} data-source={s.key}>
                    <th scope="row">{s.label}</th><td className="num">{v.all}</td><td className="num">{v.today}</td><td className="num">{v.week}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <div className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-guests-filters>
        <div className="sm:col-span-2">
          <Field label="بحث بالاسم أو الجوال أو البريد" id="gf-q">
            <input id="gf-q" type="search" className="field" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" data-no-dirty />
          </Field>
        </div>
        <Field label="الموافقة" id="gf-consent">
          <select id="gf-consent" className="field" value={f.consent ?? ''} onChange={(e) => set('consent', e.target.value)}>
            <option value="">الكل</option>
            <option value="granted">موافق</option>
            <option value="withdrawn">سحب الموافقة</option>
            <option value="none">بلا موافقة</option>
          </select>
        </Field>
        <Field label="عضوية النادي" id="gf-member">
          <select id="gf-member" className="field" value={f.member ?? ''} onChange={(e) => set('member', e.target.value)}>
            <option value="">الكل</option>
            <option value="true">أعضاء</option>
            <option value="false">غير أعضاء</option>
          </select>
        </Field>
        <Field label="مصدر العضوية" id="gf-source">
          <select id="gf-source" className="field" value={f.source ?? ''} onChange={(e) => set('source', e.target.value)}>
            <option value="">الكل</option>
            {CLUB_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="الفرع" id="gf-branch">
          <select id="gf-branch" className="field" value={f.branch ?? ''} onChange={(e) => set('branch', e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(BRANCH_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="عدد الإقامات على الأقل" id="gf-stays">
          <input id="gf-stays" className="field num" inputMode="numeric" value={f.stays_min ?? ''} onChange={(e) => set('stays_min', e.target.value.replace(/[^0-9]/g, ''))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="الإنفاق من" id="gf-spend-min">
            <input id="gf-spend-min" className="field num" inputMode="numeric" value={f.spend_min ?? ''} onChange={(e) => set('spend_min', e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
          <Field label="إلى" id="gf-spend-max">
            <input id="gf-spend-max" className="field num" inputMode="numeric" value={f.spend_max ?? ''} onChange={(e) => set('spend_max', e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <DateField mode="range" label="آخر إقامة من" endLabel="آخر إقامة إلى" start={f.last_from ?? ''} end={f.last_to ?? ''} onChange={(a, b) => setF((x) => ({ ...x, last_from: a || undefined, last_to: b || undefined }))} min="past" id="gf-last" />
        </div>
      </div>

      <ErrorBox error={error} />
      <p className="text-sm text-ink-muted" data-guests-count>{countWord(rows.length, GUEST)} · بموافقة سارية: <span className="num">{consented}</span></p>
      {!rows.length ? (
        <Empty text="لا عملاء يطابقون البحث والتصفية." />
      ) : (
        <ul className="grid gap-2" data-list="guests">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="card w-full text-start p-3 grid gap-1 hover:border-bronze" onClick={() => setOpen(r.id)} data-guest={r.phone ?? r.id}>
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{r.name ?? 'بلا اسم'}</strong>
                  <span className={`chip ${CONSENT_CHIP[r.consent]}`} data-consent={r.consent}>{CONSENT_LABEL[r.consent]}</span>
                  {r.member && <span className="chip chip-confirmed" data-member>عضو النادي</span>}
                  {r.is_test && <span className="chip chip-test">اختبار</span>}
                </span>
                <span className="text-sm text-ink-muted flex flex-wrap gap-x-3">
                  <span className="latin num" dir="ltr">{r.phone ?? '—'}</span>
                  {r.email && <span className="latin" dir="ltr">{r.email}</span>}
                  <span>{countWord(r.stays, STAY)}</span>
                  {r.spend > 0 && <span className="num">{sar(r.spend)}</span>}
                  {r.last_stay && <span className="num">آخر إقامة {shortDate(r.last_stay)}</span>}
                  {r.member && <span>{clubSourceLabel(r.club_source)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title="ملف العميل">
        {open && <GuestDetails key={open} id={open} editable={editable} onChanged={load} onOpen={(id) => setOpen(id)} />}
      </Drawer>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="تصدير للإعلانات" busy={!!busy}>
        <div className="grid gap-3 text-sm" data-export-ads>
          <p>يشمل الملف فقط العملاء الذين وافقوا على العروض والإعلانات وما زالت موافقتهم سارية، بحسب التصفية الحالية. يُشفَّر الجوال والبريد بخوارزمية SHA-256 قبل التصدير، ولا يُصدَّر أي منهما نصًا واضحًا.</p>
          <ul className="grid gap-2">
            {PLATFORMS.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 border border-line rounded p-2">
                <span><strong>{p.label}</strong> <span className="text-ink-muted latin" dir="ltr">{p.email}, {p.phone}</span></span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void exportPlatform(p.key)} data-action={`export-${p.key}`}>
                  {busy === p.key && <Spinner />} تنزيل الملف
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">يُسجَّل كل تصدير في السجل: من صدّر، ومتى، والتصفية، وعدد الصفوف.</p>
          <div className="flex justify-end"><CancelButton label="إغلاق" disabled={!!busy} /></div>
        </div>
      </Modal>

      <Confirm
        open={plainOpen}
        onClose={() => setPlainOpen(false)}
        title="تصدير جهات الاتصال بنص واضح"
        body={<>ستُصدَّر أسماء العملاء الذين وافقوا على العروض وأرقام جوالاتهم وبريدهم الإلكتروني بنص واضح، بحسب التصفية الحالية، لاستخدامها في المراسلة فقط. احفظ الملف في مكان آمن واحذفه بعد الاستخدام. يُسجَّل التصدير في السجل.</>}
        confirmLabel="تصدير الملف"
        onConfirm={() => void exportPlain()}
        busy={busy === 'plain'}
      />
    </div>
  );
}

function GuestDetails({ id, editable, onChanged, onOpen }: { id: string; editable: boolean; onChanged: () => Promise<void>; onOpen: (id: string) => void }) {
  const toast = useToast();
  const [g, setG] = useState<Guest | null | undefined>(undefined);
  const [events, setEvents] = useState<ConsentEvent[]>([]);
  const [bookings, setBookings] = useState<GuestBooking[]>([]);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState<'grant' | 'withdraw' | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    const x = await guest(id);
    setG(x);
    if (x) {
      setNotes(x.notes ?? '');
      setTags(x.tags.join('، '));
      const [ev, bk] = await Promise.all([consents(id).catch(() => []), guestBookings(id)]);
      setEvents(ev);
      setBookings(bk);
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    try {
      await fn();
      toast(done);
      await Promise.all([reload(), onChanged()]);
      setVersion((v) => v + 1);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  if (g === undefined) return <Loading />;
  if (g === null) return <Empty text="هذا الملف غير متاح لك." />;
  const tagList = tags.split(/[،,]/).map((t) => t.trim()).filter(Boolean);
  const dirty = (notes.trim() || '') !== (g.notes ?? '') || tagList.join('|') !== g.tags.join('|');
  return (
    <div className="grid gap-5" data-guest-details={g.phone ?? g.id} data-dirty-version={version}>
      <section aria-labelledby="gd-contact" className="grid gap-2">
        <h3 id="gd-contact" className="font-bold">{g.name ?? 'بلا اسم'}</h3>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-muted">الجوال</dt><dd className="latin num" dir="ltr">{g.phone ?? '—'}</dd>
          <dt className="text-ink-muted">البريد</dt><dd className="latin" dir="ltr">{g.email ?? '—'}</dd>
          <dt className="text-ink-muted">اللغة</dt><dd>{g.language === 'en' ? 'الإنجليزية' : 'العربية'}</dd>
          <dt className="text-ink-muted">الإقامات</dt><dd data-stays>{countWord(g.stays, STAY)} · {countWord(g.nights, NIGHTS)}</dd>
          <dt className="text-ink-muted">إجمالي الإنفاق</dt><dd className="num" data-spend>{sar(g.spend)} <span className="text-ink-muted text-xs">(الحجوزات المؤكدة فقط)</span></dd>
          <dt className="text-ink-muted">أول إقامة</dt><dd className="num">{g.first_stay ? shortDate(g.first_stay) : '—'}</dd>
          <dt className="text-ink-muted">آخر إقامة</dt><dd className="num">{g.last_stay ? shortDate(g.last_stay) : '—'}</dd>
          <dt className="text-ink-muted">الفروع</dt><dd>{g.branches.length ? g.branches.map((b) => BRANCH_NAMES[b] ?? b).join('، ') : '—'}</dd>
          <dt className="text-ink-muted">نادي أرمادا ريزيدنس</dt>
          <dd data-club>{g.member ? `عضو منذ ${riyadhDateTime(g.club_joined_at!)} · ${clubSourceLabel(g.club_source)}` : 'ليس عضوًا'}</dd>
          <dt className="text-ink-muted">آخر نشاط</dt><dd className="num">{riyadhDateTime(g.last_activity_at)}</dd>
        </dl>
      </section>

      <section aria-labelledby="gd-consent" className="grid gap-2">
        <h3 id="gd-consent" className="font-bold">الموافقة على العروض والإعلانات</h3>
        <p className="text-sm flex flex-wrap items-center gap-2">
          <span className={`chip ${CONSENT_CHIP[g.consent]}`} data-consent-now={g.consent}>{CONSENT_LABEL[g.consent]}</span>
          {g.consent_at && <span className="text-ink-muted num">{riyadhDateTime(g.consent_at)} · {SOURCE_LABEL[g.consent_source ?? ''] ?? g.consent_source}</span>}
        </p>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {g.consent !== 'granted' && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setConsentOpen('grant')} data-action="consent-record">تسجيل موافقة حضورية</button>}
            {g.consent === 'granted' && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setConsentOpen('withdraw')} data-action="consent-withdraw">سحب الموافقة بطلب الضيف</button>}
          </div>
        )}
        <ol className="grid gap-1.5 text-sm" data-consent-history>
          {!events.length && <li className="text-ink-muted">لا سجل موافقة.</li>}
          {events.map((e) => (
            <li key={e.id} className="border-s-2 border-line ps-3" data-consent-event={`${e.action}:${e.source}`}>
              <span className="num text-ink-muted">{riyadhDateTime(e.at)}</span>
              <p>
                {e.action === 'grant' ? 'موافقة' : 'سحب الموافقة'} — {SOURCE_LABEL[e.source] ?? e.source}
                {e.staff_label ? ` (${e.staff_label})` : ''}
                {e.text_version ? ` · نص ${e.text_version}` : ''}{e.language ? ` · ${e.language === 'en' ? 'بالإنجليزية' : 'بالعربية'}` : ''}{e.src ? ` · ${clubSourceLabel(e.src)}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="gd-notes" className="grid gap-2">
        <h3 id="gd-notes" className="font-bold">ملاحظات ووسوم داخلية</h3>
        <Field label="ملاحظات" id="gd-notes-text" hint="لا تظهر للضيف.">
          <textarea id="gd-notes-text" className="field" rows={3} maxLength={2000} value={notes} disabled={!editable || !!busy} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="الوسوم" id="gd-tags" hint="افصل بينها بفاصلة، حتى 12 وسمًا.">
          <input id="gd-tags" className="field" value={tags} disabled={!editable || !!busy} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {editable && (
          <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={!dirty || !!busy} onClick={() => run('save', () => save(g.id, notes, tagList), 'حُفظت الملاحظات والوسوم.')} data-action="guest-save">
            {busy === 'save' && <Spinner />} حفظ الملاحظات والوسوم
          </button>
        )}
      </section>

      <section aria-labelledby="gd-bookings" className="grid gap-2">
        <h3 id="gd-bookings" className="font-bold">الحجوزات <span className="text-sm text-ink-muted font-normal">({countWord(g.bookings, BOOKING)})</span></h3>
        {!bookings.length ? <p className="text-sm text-ink-muted">لا حجوزات تظهر لك.</p> : (
          <ul className="grid gap-1.5 text-sm" data-guest-bookings>
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap gap-x-3">
                <a className="link latin num" dir="ltr" href={`bookings?ref=${encodeURIComponent(b.ref)}`}>{b.ref}</a>
                <span>{STATUS_LABELS[b.status] ?? b.status}</span>
                <span>{BRANCH_NAMES[b.branch] ?? b.branch}</span>
                <span className="num">{shortDate(b.check_in)} ← {shortDate(b.check_out)}</span>
                {b.total !== null && <span className="num">{sar(b.total)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editable && (
        <section aria-labelledby="gd-merge" className="grid gap-2">
          <h3 id="gd-merge" className="font-bold">ملف مكرر؟</h3>
          <p className="text-sm text-ink-muted">ادمج ملفًا آخر للضيف نفسه في هذا الملف: تنتقل حجوزاته وسجل موافقته إليه.</p>
          <button type="button" className="btn btn-ghost btn-sm justify-self-start" disabled={!!busy} onClick={() => setMergeOpen(true)} data-action="guest-merge-open">دمج ملف مكرر</button>
        </section>
      )}
      <div className="flex justify-end"><CancelButton label="إغلاق" disabled={!!busy} /></div>

      <ConsentDialog open={!!consentOpen} action={consentOpen ?? 'grant'} onClose={() => setConsentOpen(null)}
        onSave={(language, version) => run('consent', () => recordConsent({ profile: g.id, action: consentOpen!, language, version }), consentOpen === 'grant' ? 'سُجّلت الموافقة.' : 'سُحبت الموافقة.').then(() => setConsentOpen(null))}
        busy={busy === 'consent'} versionHint={g.consent_version} />
      <MergeDialog open={mergeOpen} keep={g} onClose={() => setMergeOpen(false)}
        onMerge={(dup) => run('merge', () => merge(g.id, dup.id), `دُمج الملف المكرر في هذا الملف.`).then(() => { setMergeOpen(false); onOpen(g.id); })} busy={busy === 'merge'} />
    </div>
  );
}

/** the text the guest agrees to, shown in both languages; the language they read it in is recorded */
export function ConsentDialog({ open, action, onClose, onSave, busy, versionHint }: { open: boolean; action: 'grant' | 'withdraw'; onClose: () => void; onSave: (language: 'ar' | 'en', version: string) => void; busy: boolean; versionHint?: string | null }) {
  const [text, setText] = useState<{ version: string; text_ar: string; text_en: string } | null>(null);
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [said, setSaid] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSaid(false);
    const v = versionHint || '2026-11-03';
    consentText(v).then((t) => setText(t ? { version: v, ...t } : null)).catch(() => setText(null));
  }, [open, versionHint]);
  const grant = action === 'grant';
  return (
    <Modal open={open} onClose={onClose} title={grant ? 'تسجيل موافقة حضورية' : 'سحب الموافقة بطلب الضيف'} busy={busy}>
      <div className="grid gap-3 text-sm" data-consent-dialog={action}>
        {grant ? (
          <>
            <p>اعرض النص على الضيف واطلب موافقته الصريحة. تُسجَّل الموافقة باسمك ووقتها، ويُضم الضيف إلى نادي أرمادا ريزيدنس.</p>
            {text ? (
              <>
                <blockquote className="bg-soft rounded p-3" lang="ar" dir="rtl" data-consent-text-ar>{text.text_ar}</blockquote>
                <blockquote className="bg-soft rounded p-3" lang="en" dir="ltr" data-consent-text-en>{text.text_en}</blockquote>
              </>
            ) : <Loading />}
            <Field label="اللغة التي قرأ بها الضيف النص" id="cd-lang">
              <select id="cd-lang" className="field" value={language} onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}>
                <option value="ar">العربية</option>
                <option value="en">الإنجليزية</option>
              </select>
            </Field>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={said} onChange={(e) => setSaid(e.target.checked)} className="mt-1" data-consent-confirm />
              <span>وافق الضيف على هذا النص أمامي.</span>
            </label>
          </>
        ) : (
          <p>سيتوقف إرسال العروض إلى هذا الضيف ورفع بياناته إلى منصات الإعلان. يُسجَّل السحب باسمك ووقته.</p>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <CancelButton disabled={busy} />
          <button type="button" className={`btn ${grant ? 'btn-primary' : 'btn-danger'}`} disabled={busy || (grant && (!said || !text))} onClick={() => onSave(language, text?.version ?? '2026-11-03')} data-action="consent-save">
            {busy && <Spinner />} {grant ? 'تسجيل الموافقة' : 'سحب الموافقة'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MergeDialog({ open, keep, onClose, onMerge, busy }: { open: boolean; keep: Guest; onClose: () => void; onMerge: (dup: Guest) => void; busy: boolean }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Guest[]>([]);
  const [pick, setPick] = useState<Guest | null>(null);
  useEffect(() => {
    if (!open) {
      setQ('');
      setFound([]);
      setPick(null);
    }
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 3) {
      setFound([]);
      return;
    }
    const t = setTimeout(() => guests({ q }, 20).then((r) => setFound(r.filter((x) => x.id !== keep.id))).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q, keep.id]);
  return (
    <Modal open={open} onClose={onClose} title="دمج ملف مكرر" busy={busy}>
      <div className="grid gap-3 text-sm" data-merge-dialog>
        <p>ابحث عن الملف المكرر بالاسم أو الجوال أو البريد. يبقى ملف «{keep.name ?? keep.phone}» وتنتقل إليه حجوزات الملف الآخر وسجل موافقته وملاحظاته ووسومه.</p>
        <Field label="بحث" id="md-q">
          <input id="md-q" type="search" className="field" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" data-no-dirty />
        </Field>
        <ul className="grid gap-1.5">
          {found.map((x) => (
            <li key={x.id}>
              <label className="flex items-center gap-2 border border-line rounded p-2">
                <input type="radio" name="merge-pick" checked={pick?.id === x.id} onChange={() => setPick(x)} data-no-dirty />
                <span><strong>{x.name ?? 'بلا اسم'}</strong> <span className="latin num" dir="ltr">{x.phone ?? ''}</span> <span className="latin" dir="ltr">{x.email ?? ''}</span> · {countWord(x.bookings, BOOKING)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 mt-2">
          <CancelButton disabled={busy} />
          <button type="button" className="btn btn-primary" disabled={busy || !pick} onClick={() => pick && onMerge(pick)} data-action="merge-go">
            {busy && <Spinner />} دمج في هذا الملف
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** the booking details' guest line: the badges and, for reception, the consent given in person (bookings edit) */
export function BookingGuestBadges({ reservation, editable }: { reservation: string; editable: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<Awaited<ReturnType<typeof bookingGuest>> | null>(null);
  const [dialog, setDialog] = useState<'grant' | 'withdraw' | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => bookingGuest(reservation).then(setS).catch(() => setS(null)), [reservation]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!s || s.profile === undefined) return null;
  async function saveConsent(language: 'ar' | 'en', version: string) {
    setBusy(true);
    try {
      await recordConsent({ reservation, action: dialog!, language, version });
      toast(dialog === 'grant' ? 'سُجّلت الموافقة.' : 'سُحبت الموافقة.');
      setDialog(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-booking-guest>
      {s.member && <span className="chip chip-confirmed" data-badge="member">عضو نادي أرمادا ريزيدنس</span>}
      {!!s.returning && <span className="chip chip-request" data-badge="returning">ضيف عائد ({s.returning})</span>}
      {s.consent && <span className={`chip ${CONSENT_CHIP[s.consent]}`} data-badge="consent">{s.consent === 'granted' ? 'موافق على العروض' : s.consent === 'withdrawn' ? 'سحب موافقته على العروض' : 'لم يوافق على العروض'}</span>}
      {s.profile && <a className="link" href={`guests?id=${s.profile}`} data-action="open-guest">ملف العميل</a>}
      {editable && s.consent !== 'granted' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('grant')} data-action="booking-consent-record">تسجيل موافقة حضورية</button>}
      {editable && s.consent === 'granted' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('withdraw')} data-action="booking-consent-withdraw">سحب الموافقة بطلب الضيف</button>}
      <ConsentDialog open={!!dialog} action={dialog ?? 'grant'} onClose={() => setDialog(null)} onSave={(l, v) => void saveConsent(l, v)} busy={busy} versionHint={s.version} />
    </div>
  );
}
