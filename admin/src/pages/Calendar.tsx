// Rates + inventory calendar (decisions 1 + 3, DASHBOARD-SPEC §3.2; phase 2a.1 items 1–4): one grid, two modes.
// Rows = room types of the branch (non-bookable ones tagged «غير متاحة على الموقع»), columns = nights (7 / 14 / 31).
// Rates: effective price per night with its source, base-rate editor, single-night and range overrides, override list.
// Inventory: «N متبقية · M محجوزة» per night, ONE meaning of closed (stop-sell or no row: hatched «مغلق»), an explicit
// open / closed control per cell, per row (visible range) and per bulk range, with a legend. The period jumper is the
// site's date picker; past nights are viewable (muted, read-only) and the server refuses edits on them. Every save
// returns its audit batch → a 30 s «تراجع» toast.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../lib/api';
import type { Branch, CalendarCell, RateOverride, RoomType } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, DAY, ROOM_TYPE, WEEKDAY_BITS, WEEKDAY_LABELS, addDays, countWord, dayName, daysBetween, longDate, maskLabel, monthTitle, nightsWord, riyadhToday, roomsBooked, roomsLeft, sar, shortDate } from '../lib/format';
import { ErrorBox, Field, Loading, Modal, NumberField, Segmented, Spinner, Stepper, useToast } from '../components/ui';
import DateField from '../components/DateField';

type Mode = 'rates' | 'inventory';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function useDays() {
  const [n, setN] = useState(() => (window.innerWidth < 640 ? 7 : window.innerWidth < 1024 ? 14 : 31));
  useEffect(() => {
    const on = () => setN(window.innerWidth < 640 ? 7 : window.innerWidth < 1024 ? 14 : 31);
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return n;
}

export default function Calendar({ mode }: { mode: Mode }) {
  const { me } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const locked = me?.branch ?? null;
  const editable = api.canEdit(me, mode);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branch, setBranch] = useState(locked ?? params.get('branch') ?? 'airport-road');
  const days = useDays();
  const today = riyadhToday();
  const [from, setFrom] = useState(() => (ISO.test(params.get('from') ?? '') ? params.get('from')! : today));
  const [types, setTypes] = useState<RoomType[]>([]);
  const [cells, setCells] = useState<CalendarCell[] | null>(null);
  const [overridesList, setOverridesList] = useState<RateOverride[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ rt: RoomType; cell: CalendarCell } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [rateEdit, setRateEdit] = useState<RoomType | null>(null);
  const [rowMenu, setRowMenu] = useState<RoomType | null>(null);
  const to = addDays(from, days - 1);

  useEffect(() => {
    api.branches().then((b) => {
      setBranches(b);
      if (!locked && !b.some((x) => x.slug === branch) && b[0]) setBranch(b[0].slug);
    }).catch((e) => setError(e.message));
  }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      setError(null);
      const [t, c] = await Promise.all([api.roomTypes(branch), api.calendar(branch, from, to)]);
      setTypes(t);
      setCells(c);
      if (mode === 'rates') setOverridesList(await api.overrides(branch));
    } catch (e) {
      setError((e as Error).message);
      setCells([]);
    }
  }, [branch, from, to, mode]);

  useEffect(() => {
    load();
    const p = new URLSearchParams();
    if (!locked) p.set('branch', branch);
    p.set('from', from);
    setParams(p, { replace: true });
  }, [load, branch, from, locked, setParams]);

  /** a save: toast with undo, then reload */
  const saved = (msg: string, batchId: string) => {
    toast.undo(msg, async () => {
      await api.revertBatch(batchId);
      load();
    });
    load();
  };

  const nights = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);
  const byKey = useMemo(() => {
    const m = new Map<string, CalendarCell>();
    for (const c of cells ?? []) m.set(`${c.room_type_id}|${c.night}`, c);
    return m;
  }, [cells]);
  const visibleEditable = nights.filter((n) => n >= today);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold me-auto">{mode === 'rates' ? 'الأسعار' : 'المخزون'}</h1>
        {!locked && (
          <select className="field w-auto" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="الفرع">
            {branches.map((b) => <option key={b.slug} value={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</option>)}
          </select>
        )}
        <div className="flex items-end gap-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom(addDays(from, -days))} aria-label="الفترة السابقة">‹</button>
          <DateField mode="single" label="من تاريخ" value={from} onChange={(v) => v && setFrom(v)} min="past" id="cal-from" className="w-56" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom(addDays(from, days))} aria-label="الفترة التالية">›</button>
          {from !== today && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom(today)}>اليوم</button>}
        </div>
        {editable && <button type="button" className="btn btn-primary" onClick={() => setBulk(true)} data-action="bulk">{mode === 'rates' ? 'سعر لفترة' : 'تعديل جماعي'}</button>}
      </div>
      <ErrorBox error={error} />
      {cells === null ? (
        <Loading />
      ) : types.length === 0 ? (
        <p className="text-ink-muted text-center py-10">لا أنواع غرف في هذا الفرع.</p>
      ) : (
        <div className="card overflow-x-auto" data-grid={mode}>
          <div className="grid-cal" style={{ gridTemplateColumns: `172px repeat(${days}, minmax(72px, 1fr))` }}>
            <div className="cal-sticky border-b border-line p-2 text-xs font-bold text-ink-muted">{monthTitle(from)}{monthTitle(to) !== monthTitle(from) ? ` – ${monthTitle(to)}` : ''}</div>
            {nights.map((n) => {
              const d = new Date(n + 'T00:00:00Z').getUTCDay();
              return (
                <div key={n} className={`cal-cell font-bold ${d === 5 || d === 6 ? 'bg-soft' : ''} ${n === today ? 'text-bronze-text' : ''}`} data-past={n < today}>
                  <div>{dayName(n, true)}</div>
                  <div className="num-ar text-ink-muted">{shortDate(n)}</div>
                </div>
              );
            })}
            {types.map((rt) => (
              <RowCells key={rt.id} rt={rt} nights={nights} byKey={byKey} mode={mode} today={today} editable={editable}
                onPick={(cell) => editable && cell.night >= today && setSel({ rt, cell })} onRate={() => setRateEdit(rt)} onMenu={() => setRowMenu(rt)} />
            ))}
          </div>
        </div>
      )}

      {mode === 'inventory' ? (
        <div className="legend mt-3" aria-label="مفتاح الرموز">
          <span className="legend-item"><span className="swatch" /> مفتوح: «N متبقية · M محجوزة»</span>
          <span className="legend-item"><span className="swatch swatch-one" /> غرفة واحدة متبقية</span>
          <span className="legend-item"><span className="swatch swatch-zero" /> نفدت (0 متبقية)</span>
          <span className="legend-item"><span className="swatch swatch-closed" /> مغلق: لا يُباع على الموقع</span>
          <span className="legend-item text-ink-muted">الليالي الماضية للعرض فقط.</span>
        </div>
      ) : (
        <p className="text-xs text-ink-muted mt-3">الخلية: السعر الفعلي لليلة شامل الضريبة؛ الاسم تحته = الاستثناء الذي حدده. «—» = بلا سعر. الليالي الماضية للعرض فقط.</p>
      )}

      {mode === 'rates' && editable && <OverridesList list={overridesList} types={types} onSaved={saved} />}

      {sel && mode === 'inventory' && <CellEdit sel={sel} onClose={() => setSel(null)} onSaved={(msg, b) => { setSel(null); saved(msg, b); }} />}
      {sel && mode === 'rates' && <NightRate sel={sel} onClose={() => setSel(null)} onSaved={(msg, b) => { setSel(null); saved(msg, b); }} />}
      {bulk && <Bulk mode={mode} types={types} from={from >= today ? from : today} onClose={() => setBulk(false)} onSaved={(msg, b) => { setBulk(false); saved(msg, b); }} />}
      {rateEdit && <BaseRate rt={rateEdit} onClose={() => setRateEdit(null)} onSaved={(msg, b) => { setRateEdit(null); saved(msg, b); }} />}
      {rowMenu && mode === 'inventory' && (
        <RowOpenClose rt={rowMenu} nights={visibleEditable} onClose={() => setRowMenu(null)} onSaved={(msg, b) => { setRowMenu(null); saved(msg, b); }} />
      )}
    </div>
  );
}

function cellState(c: CalendarCell): 'closed' | 'zero' | 'one' | 'open' {
  if (!c.has_row || c.stop_sell) return 'closed';
  if (c.rooms_to_sell === 0) return 'zero';
  if (c.rooms_to_sell === 1) return 'one';
  return 'open';
}

function RowCells({ rt, nights, byKey, mode, today, editable, onPick, onRate, onMenu }: { rt: RoomType; nights: string[]; byKey: Map<string, CalendarCell>; mode: Mode; today: string; editable: boolean; onPick: (c: CalendarCell) => void; onRate: () => void; onMenu: () => void }) {
  return (
    <>
      <div className="cal-sticky border-b border-line p-2 text-xs" data-row={rt.slug}>
        <div className="font-bold truncate">{rt.name_ar}</div>
        {!rt.bookable && <span className="chip chip-request mt-0.5" style={{ fontSize: 10 }}>غير متاحة على الموقع</span>}
        {mode === 'rates' ? (
          editable ? (
            <button type="button" className="text-bronze-text underline num-ar block mt-0.5" onClick={onRate} data-action="base-rate">{rt.base_rate === null ? 'بلا سعر أساسي' : `الأساسي ${sar(rt.base_rate)}`}</button>
          ) : (
            <span className="text-ink-muted num-ar block mt-0.5">{rt.base_rate === null ? 'بلا سعر أساسي' : `الأساسي ${sar(rt.base_rate)}`}</span>
          )
        ) : (
          <div className="flex items-center justify-between gap-1 mt-0.5">
            <span className="text-ink-muted num-ar">{rt.capacity} أشخاص{rt.extra_beds_max ? ` · +${rt.extra_beds_max} سرير` : ''}</span>
            {editable && <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 28, padding: '0 6px' }} onClick={onMenu} aria-label={`فتح أو إغلاق الفترة المعروضة — ${rt.name_ar}`} data-action="row-menu">فتح / إغلاق</button>}
          </div>
        )}
      </div>
      {nights.map((n) => {
        const c = byKey.get(`${rt.id}|${n}`) ?? { room_type_id: rt.id, night: n, price: rt.base_rate, override_id: null, override_label: null, override_label_en: null, has_row: false, rooms_to_sell: 0, booked: 0, stop_sell: false };
        const st = cellState(c);
        const past = n < today;
        const label = mode === 'rates'
          ? `${rt.name_ar} ${longDate(n)}: ${c.price === null ? 'بلا سعر' : sar(c.price)}`
          : `${rt.name_ar} ${longDate(n)}: ${st === 'closed' ? 'مغلق' : `${roomsLeft(c.rooms_to_sell)}، ${roomsBooked(c.booked)}`}`;
        return (
          <button
            type="button"
            key={n}
            className="cal-cell"
            data-night={n}
            data-rt={rt.slug}
            data-closed={mode === 'inventory' && st === 'closed'}
            data-stop={c.stop_sell}
            data-missing={!c.has_row}
            data-left={mode === 'inventory' && (st === 'one' || st === 'zero') ? String(c.rooms_to_sell) : undefined}
            data-past={past}
            data-off={!rt.bookable}
            onClick={() => onPick(c)}
            disabled={past || !editable}
            aria-disabled={past || !editable}
            aria-label={label}
          >
            {mode === 'rates' ? (
              <>
                <div className="cal-main num-ar font-bold">{c.price === null ? '—' : Number(c.price)}</div>
                <div className="text-[10px] text-ink-muted truncate">{c.override_label ?? (c.override_id ? 'استثناء' : '')}</div>
              </>
            ) : (
              <>
                <div className="cal-main num-ar font-bold">{st === 'closed' ? (c.booked ? `— · ${c.booked}` : '—') : `${c.rooms_to_sell} · ${c.booked}`}</div>
                <div className="text-[10px] text-ink-muted">{st === 'closed' ? 'مغلق' : st === 'zero' ? 'نفدت' : 'مفتوح'}</div>
              </>
            )}
          </button>
        );
      })}
    </>
  );
}

function WeekdayPicker({ mask, onChange }: { mask: number; onChange: (m: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="أيام الأسبوع">
      {WEEKDAY_LABELS.map((l, i) => {
        const on = (mask & WEEKDAY_BITS[i]) !== 0;
        return (
          <button type="button" key={l} className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={on} onClick={() => onChange(on ? mask & ~WEEKDAY_BITS[i] : mask | WEEKDAY_BITS[i])}>
            {l}
          </button>
        );
      })}
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(127)}>كل الأيام</button>
    </div>
  );
}

type OnSaved = (msg: string, batchId: string) => void;

function CellEdit({ sel, onClose, onSaved }: { sel: { rt: RoomType; cell: CalendarCell }; onClose: () => void; onSaved: OnSaved }) {
  const { rt, cell } = sel;
  const [rooms, setRooms] = useState(cell.rooms_to_sell);
  const [state, setState] = useState<'open' | 'closed'>(cell.has_row && !cell.stop_sell ? 'open' : 'closed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.setInventory({ roomTypeIds: [rt.id], from: cell.night, to: cell.night, rooms, stopSell: state === 'closed', expected: cell.has_row ? cell.rooms_to_sell : 0 });
      onSaved(`حُفظت ليلة ${longDate(cell.night)} — ${state === 'closed' ? 'مغلقة' : roomsLeft(rooms)}`, r.batch_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`${rt.name_ar} — ${longDate(cell.night)}`}>
      <p className="text-sm text-ink-muted mb-3">المحجوز: <b className="num-ar">{cell.booked}</b> · الحالة الآن: <b>{cell.has_row && !cell.stop_sell ? 'مفتوحة' : 'مغلقة'}</b></p>
      <Field label="البيع على الموقع" id="cell-state">
        <Segmented value={state} onChange={setState} label="البيع على الموقع" size="md" options={[{ value: 'open', label: 'مفتوح' }, { value: 'closed', label: 'مغلق' }]} />
      </Field>
      <div className="mt-4">
        <Field label="الغرف المتبقية للبيع على الموقع" id="cell-rooms" hint={state === 'closed' ? 'يبقى العدد محفوظًا ويُستخدم عند إعادة الفتح.' : undefined}>
          <Stepper id="cell-rooms" value={rooms} onChange={setRooms} min={0} max={999} label="الغرف المتبقية" />
        </Field>
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="cell-save">{busy && <Spinner />} حفظ</button>
      </div>
    </Modal>
  );
}

/** Open or close every visible (future) night of one room type. */
function RowOpenClose({ rt, nights, onClose, onSaved }: { rt: RoomType; nights: string[]; onClose: () => void; onSaved: OnSaved }) {
  const [busy, setBusy] = useState<'open' | 'closed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = nights[0];
  const to = nights[nights.length - 1];
  async function act(state: 'open' | 'closed') {
    if (!from) return;
    setBusy(state);
    setError(null);
    try {
      const r = await api.setInventory({ roomTypeIds: [rt.id], from, to, stopSell: state === 'closed' });
      onSaved(`${state === 'closed' ? 'أُغلقت' : 'فُتحت'} ${nightsWord(r.count ?? 0)} — ${rt.name_ar}`, r.batch_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal open onClose={onClose} title={`فتح / إغلاق — ${rt.name_ar}`}>
      {from ? (
        <p className="text-sm text-ink-muted mb-4">الفترة المعروضة: من {longDate(from)} إلى {longDate(to)} ({nightsWord(nights.length)}). «إغلاق» يوقف البيع على الموقع ويبقي الأعداد محفوظة؛ «فتح» يعيد البيع بالأعداد المحفوظة (ليلة بلا عدد تُفتح بصفر).</p>
      ) : (
        <p className="text-sm text-ink-muted mb-4">كل الليالي المعروضة ماضية؛ انتقل إلى اليوم أو ما بعده.</p>
      )}
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2 justify-end mt-2">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>رجوع</button>
        <button type="button" className="btn btn-danger" onClick={() => act('closed')} disabled={!from || !!busy} data-action="row-close">{busy === 'closed' && <Spinner />} إغلاق الفترة</button>
        <button type="button" className="btn btn-primary" onClick={() => act('open')} disabled={!from || !!busy} data-action="row-open">{busy === 'open' && <Spinner />} فتح الفترة</button>
      </div>
    </Modal>
  );
}

function NightRate({ sel, onClose, onSaved }: { sel: { rt: RoomType; cell: CalendarCell }; onClose: () => void; onSaved: OnSaved }) {
  const { rt, cell } = sel;
  const [price, setPrice] = useState<number | null>(cell.price === null ? null : Number(cell.price));
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!price || !(price > 0)) return setError('اكتب سعرًا أكبر من صفر.');
    setBusy(true);
    try {
      const r = await api.addOverride([rt.id], cell.night, cell.night, 127, price, label, labelEn, true);
      onSaved(`سعر ليلة ${longDate(cell.night)}: ${sar(price)}`, r.batch_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`${rt.name_ar} — ${longDate(cell.night)}`}>
      <p className="text-sm text-ink-muted mb-3">السعر الحالي: <b>{cell.price === null ? 'بلا سعر' : sar(cell.price)}</b>{cell.override_label ? ` (${cell.override_label})` : ''}. يُحفظ كاستثناء لهذه الليلة فوق السعر الأساسي، ويحل محل استثناء سابق لليلة نفسها.</p>
      <Field label="السعر لليلة (شامل الضريبة)" id="night-price"><NumberField id="night-price" value={price} onChange={setPrice} decimal min={0} max={99999} /></Field>
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <Field label="تسمية بالعربية (اختياري)" id="night-label"><input id="night-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: عطلة" /></Field>
        <Field label="التسمية بالإنجليزية (اختياري)" id="night-label-en" hint="تظهر للضيف في الإنجليزية؛ فارغة = بلا تسمية"><input id="night-label-en" className="field latin" dir="ltr" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} placeholder="e.g. Holiday" /></Field>
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="night-save">{busy && <Spinner />} حفظ</button>
      </div>
    </Modal>
  );
}

function BaseRate({ rt, onClose, onSaved }: { rt: RoomType; onClose: () => void; onSaved: OnSaved }) {
  const [price, setPrice] = useState<number | null>(rt.base_rate === null ? null : Number(rt.base_rate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (price !== null && !(price > 0)) return setError('اكتب سعرًا أكبر من صفر، أو اتركه فارغًا لإزالة السعر.');
    setBusy(true);
    try {
      const r = await api.setBaseRate(rt.id, price);
      onSaved(`السعر الأساسي لـ${rt.name_ar}: ${price === null ? 'بلا سعر' : sar(price)}`, r.batch_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`السعر الأساسي — ${rt.name_ar}`}>
      <p className="text-sm text-ink-muted mb-3">يُطبَّق على كل ليلة لا يغطيها استثناء. شامل الضريبة.</p>
      <Field label="السعر لليلة" id="base-price"><NumberField id="base-price" value={price} onChange={setPrice} decimal min={0} max={99999} /></Field>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="base-rate-save">{busy && <Spinner />} حفظ</button>
      </div>
    </Modal>
  );
}

function Bulk({ mode, types, from, onClose, onSaved }: { mode: Mode; types: RoomType[]; from: string; onClose: () => void; onSaved: OnSaved }) {
  const [ids, setIds] = useState<string[]>(types.map((t) => t.id));
  const [dFrom, setDFrom] = useState(from);
  const [dTo, setDTo] = useState(addDays(from, 6));
  const [mask, setMask] = useState(127);
  const [price, setPrice] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [op, setOp] = useState<'set' | 'delta' | 'open' | 'close'>('set');
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const span = dFrom && dTo ? daysBetween(dFrom, dTo) + 1 : 0;

  async function save() {
    setError(null);
    if (!ids.length) return setError('اختر نوع غرفة واحدًا على الأقل.');
    if (!dFrom || !dTo) return setError('اختر تاريخ البداية والنهاية.');
    if (span < 1 || span > 400) return setError('الفترة من يوم إلى 400 يوم.');
    setBusy(true);
    try {
      if (mode === 'rates') {
        if (!price || !(price > 0)) throw new Error('اكتب سعرًا أكبر من صفر.');
        const r = await api.addOverride(ids, dFrom, dTo, mask, price, label, labelEn);
        onSaved(`أُضيف سعر ${sar(price)} — ${countWord(r.count ?? 0, ROOM_TYPE)} من الغرف (${maskLabel(mask)})`, r.batch_id);
      } else {
        const r = await api.setInventory({ roomTypeIds: ids, from: dFrom, to: dTo, weekdays: mask, rooms: op === 'set' ? n : null, delta: op === 'delta' ? n : null, stopSell: op === 'open' ? false : op === 'close' ? true : null });
        onSaved(`${op === 'close' ? 'أُغلقت' : op === 'open' ? 'فُتحت' : 'عُدّلت'} ${nightsWord(r.count ?? 0)}`, r.batch_id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const OPS: { value: typeof op; label: string; hint: string }[] = [
    { value: 'set', label: 'تحديد المتبقي', hint: 'يجعل الغرف المتبقية للبيع = N في كل ليلة مختارة (الليالي المغلقة تبقى مغلقة).' },
    { value: 'delta', label: 'إضافة أو خصم', hint: 'يزيد أو ينقص المتبقي بـ N (لا ينزل تحت الصفر).' },
    { value: 'open', label: 'فتح', hint: 'يعيد البيع على الموقع بالأعداد المحفوظة؛ ليلة بلا عدد تُفتح بصفر.' },
    { value: 'close', label: 'إغلاق', hint: 'يوقف البيع على الموقع ويبقي الأعداد محفوظة.' },
  ];
  return (
    <Modal open onClose={onClose} title={mode === 'rates' ? 'سعر لفترة' : 'تعديل جماعي للمخزون'} wide>
      <DateField mode="range" label="من" endLabel="إلى" start={dFrom} end={dTo} onChange={(a, b) => { setDFrom(a); setDTo(b); }} id="bulk-dates" />
      <div className="mt-3"><span className="label">أيام الأسبوع</span><WeekdayPicker mask={mask} onChange={setMask} /></div>
      <div className="mt-3">
        <span className="label">أنواع الغرف</span>
        <div className="flex flex-wrap gap-1">
          {types.map((t) => {
            const on = ids.includes(t.id);
            return (
              <button type="button" key={t.id} className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={on} onClick={() => setIds(on ? ids.filter((x) => x !== t.id) : [...ids, t.id])}>{t.name_ar}{t.bookable ? '' : ' (غير متاحة على الموقع)'}</button>
            );
          })}
        </div>
      </div>
      {mode === 'rates' ? (
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          <Field label="السعر لليلة (شامل الضريبة)" id="b-price"><NumberField id="b-price" value={price} onChange={setPrice} decimal min={0} max={99999} /></Field>
          <Field label="تسمية بالعربية" id="b-label" hint="مثال: موسم الصيف، نهاية الأسبوع"><input id="b-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label="التسمية بالإنجليزية (اختياري)" id="b-label-en" hint="للضيوف بالإنجليزية؛ فارغة = بلا تسمية"><input id="b-label-en" className="field latin" dir="ltr" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} placeholder="e.g. Summer season" /></Field>
        </div>
      ) : (
        <div className="mt-3">
          <span className="label">الإجراء</span>
          <Segmented value={op} onChange={setOp} label="الإجراء" size="md" options={OPS.map((o) => ({ value: o.value, label: o.label }))} />
          <p className="text-xs text-ink-muted mt-1">{OPS.find((o) => o.value === op)?.hint}</p>
          {(op === 'set' || op === 'delta') && (
            <div className="mt-3">
              <Field label={op === 'set' ? 'N (الغرف المتبقية)' : 'N (موجب أو سالب)'} id="b-n">
                <Stepper id="b-n" value={n} onChange={setN} min={op === 'delta' ? -999 : 0} max={999} label="N" />
              </Field>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-ink-muted mt-3 num-ar">{countWord(span, DAY)} × {countWord(ids.length, ROOM_TYPE)} — {maskLabel(mask)}</p>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="bulk-save">{busy && <Spinner />} تطبيق</button>
      </div>
    </Modal>
  );
}

function OverridesList({ list, types, onSaved }: { list: RateOverride[]; types: RoomType[]; onSaved: OnSaved }) {
  const toast = useToast();
  const active = list.filter((o) => o.active);
  if (!active.length) return null;
  return (
    <div className="card p-4 mt-5">
      <h2 className="font-bold mb-2">الاستثناءات الفعّالة</h2>
      <ul className="grid gap-1 text-sm">
        {active.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-1.5 last:border-0">
            <span className="font-semibold">{types.find((t) => t.id === o.room_type_id)?.name_ar ?? '—'}</span>
            <span className="num-ar">{o.date_from === o.date_to ? longDate(o.date_from) : `${longDate(o.date_from)} ← ${longDate(o.date_to)}`}</span>
            <span className="text-ink-muted">{maskLabel(o.weekdays)}</span>
            <span className="font-bold">{sar(o.price)}</span>
            {o.label && <span className="chip chip-request">{o.label}</span>}
            {o.label_en && <span className="chip chip-request latin" dir="ltr">{o.label_en}</span>}
            <button type="button" className="btn btn-ghost btn-sm ms-auto" onClick={async () => { try { const r = await api.setOverrideActive(o.id, false); onSaved('أُلغي الاستثناء', r.batch_id); } catch (e) { toast((e as Error).message, 'error'); } }} data-action="override-off">إلغاء</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
