// Rates + inventory calendar (decisions 1 + 3, DASHBOARD-SPEC §3.2): one grid, two modes. Rows = room types of the
// branch, columns = nights (7 per screen on a phone, 14 / 31 on wider screens). Rates: effective price per night with
// its source (base / override label), base-rate editor, bulk override over a range × weekdays, override list with
// deactivate. Inventory: rooms_to_sell / booked per night, stop-sell hatch, 1-left / 0-left marks, single-cell edit
// with optimistic concurrency, bulk set / add / open / close over a range × weekdays.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../lib/api';
import type { Branch, CalendarCell, RateOverride, RoomType } from '../lib/api';
import { useSession } from '../lib/session';
import { BRANCH_NAMES, WEEKDAY_BITS, WEEKDAY_LABELS, addDays, dayName, daysBetween, maskLabel, monthTitle, riyadhToday, sar, shortDate } from '../lib/format';
import { ErrorBox, Field, Loading, Modal, Spinner, Stepper, useToast } from '../components/ui';

type Mode = 'rates' | 'inventory';

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
  const locked = me?.role === 'reception' ? me.branch! : null;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branch, setBranch] = useState(locked ?? params.get('branch') ?? 'airport-road');
  const days = useDays();
  const [from, setFrom] = useState(params.get('from') && params.get('from')! >= riyadhToday() ? params.get('from')! : riyadhToday());
  const [types, setTypes] = useState<RoomType[]>([]);
  const [cells, setCells] = useState<CalendarCell[] | null>(null);
  const [overridesList, setOverridesList] = useState<RateOverride[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ rt: RoomType; cell: CalendarCell } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [rateEdit, setRateEdit] = useState<RoomType | null>(null);
  const to = addDays(from, days - 1);

  useEffect(() => {
    api.branches().then((b) => {
      setBranches(b);
      if (!locked && !b.some((x) => x.slug === branch) && b[0]) setBranch(b[0].slug);
    }).catch((e) => setError(e.message));
  }, [locked, branch]);

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

  const nights = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);
  const byKey = useMemo(() => {
    const m = new Map<string, CalendarCell>();
    for (const c of cells ?? []) m.set(`${c.room_type_id}|${c.night}`, c);
    return m;
  }, [cells]);
  const rows = types.filter((t) => t.bookable || mode === 'rates');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold me-auto">{mode === 'rates' ? 'الأسعار' : 'المخزون'}</h1>
        {!locked && (
          <select className="field w-auto" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="الفرع">
            {branches.map((b) => <option key={b.slug} value={b.slug}>{BRANCH_NAMES[b.slug] ?? b.name_ar}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom(addDays(from, -days) < riyadhToday() ? riyadhToday() : addDays(from, -days))} aria-label="الفترة السابقة">‹</button>
          <input type="date" className="field num w-auto" value={from} min={riyadhToday()} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="من تاريخ" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom(addDays(from, days))} aria-label="الفترة التالية">›</button>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setBulk(true)} data-action="bulk">{mode === 'rates' ? 'سعر لفترة' : 'تعديل جماعي'}</button>
      </div>
      <ErrorBox error={error} />
      {cells === null ? (
        <Loading />
      ) : (
        <div className="card overflow-x-auto" data-grid={mode}>
          <div className="grid-cal" style={{ gridTemplateColumns: `160px repeat(${days}, minmax(64px, 1fr))` }}>
            <div className="cal-sticky border-b border-line p-2 text-xs font-bold text-ink-muted">{monthTitle(from)}{monthTitle(to) !== monthTitle(from) ? ` – ${monthTitle(to)}` : ''}</div>
            {nights.map((n) => {
              const d = new Date(n + 'T00:00:00Z').getUTCDay();
              return (
                <div key={n} className={`cal-cell font-bold ${d === 5 || d === 6 ? 'bg-soft' : ''}`}>
                  <div>{dayName(n, true)}</div>
                  <div className="num text-ink-muted">{shortDate(n)}</div>
                </div>
              );
            })}
            {rows.map((rt) => (
              <RowCells key={rt.id} rt={rt} nights={nights} byKey={byKey} mode={mode} onPick={(cell) => setSel({ rt, cell })} onRate={() => setRateEdit(rt)} />
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-ink-muted mt-2">
        {mode === 'rates' ? 'الخلية: السعر الفعلي لليلة؛ الاسم تحته = مصدر السعر (استثناء). «—» = بلا سعر.' : 'الخلية: المتبقي للبيع / المحجوز. مخطّط = موقوف. خط برونزي = غرفة واحدة متبقية، خط أحمر = نفدت. «—» = ليلة مغلقة (بلا صف).'}
      </p>

      {mode === 'rates' && <OverridesList list={overridesList} types={types} onChanged={load} />}

      {sel && mode === 'inventory' && <CellEdit sel={sel} onClose={() => setSel(null)} onSaved={(msg) => { toast(msg); setSel(null); load(); }} />}
      {sel && mode === 'rates' && <NightRate sel={sel} onClose={() => setSel(null)} onSaved={(msg) => { toast(msg); setSel(null); load(); }} />}
      {bulk && <Bulk mode={mode} types={rows} from={from} onClose={() => setBulk(false)} onSaved={(msg) => { toast(msg); setBulk(false); load(); }} />}
      {rateEdit && <BaseRate rt={rateEdit} onClose={() => setRateEdit(null)} onSaved={(msg) => { toast(msg); setRateEdit(null); load(); }} />}
    </div>
  );
}

function RowCells({ rt, nights, byKey, mode, onPick, onRate }: { rt: RoomType; nights: string[]; byKey: Map<string, CalendarCell>; mode: Mode; onPick: (c: CalendarCell) => void; onRate: () => void }) {
  return (
    <>
      <div className="cal-sticky border-b border-line p-2 text-xs">
        <div className="font-bold truncate">{rt.name_ar}</div>
        {mode === 'rates' ? (
          <button type="button" className="text-bronze-text underline num" onClick={onRate} data-action="base-rate">{rt.base_rate === null ? 'بلا سعر أساسي' : `الأساسي ${sar(rt.base_rate)}`}</button>
        ) : (
          <span className="text-ink-muted">{rt.capacity} أشخاص{rt.extra_beds_max ? ` · +${rt.extra_beds_max} سرير` : ''}</span>
        )}
      </div>
      {nights.map((n) => {
        const c = byKey.get(`${rt.id}|${n}`) ?? { room_type_id: rt.id, night: n, price: rt.base_rate, override_id: null, override_label: null, override_label_en: null, has_row: false, rooms_to_sell: 0, booked: 0, stop_sell: false };
        const left = c.has_row && !c.stop_sell ? c.rooms_to_sell : null;
        return (
          <button
            type="button"
            key={n}
            className="cal-cell"
            data-night={n}
            data-rt={rt.slug}
            data-stop={c.stop_sell}
            data-missing={!c.has_row}
            data-left={left !== null && left <= 1 ? String(left) : undefined}
            onClick={() => onPick(c)}
            aria-label={`${rt.name_ar} ${n}`}
          >
            {mode === 'rates' ? (
              <>
                <div className="num font-bold">{c.price === null ? '—' : Number(c.price)}</div>
                <div className="text-[10px] text-ink-muted truncate">{c.override_label ?? (c.override_id ? 'استثناء' : '')}</div>
              </>
            ) : (
              <>
                <div className="num font-bold">{c.has_row ? `${c.rooms_to_sell} / ${c.booked}` : '—'}</div>
                <div className="text-[10px] text-ink-muted">{c.stop_sell ? 'موقوف' : c.has_row ? 'مفتوح' : 'مغلق'}</div>
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

function CellEdit({ sel, onClose, onSaved }: { sel: { rt: RoomType; cell: CalendarCell }; onClose: () => void; onSaved: (m: string) => void }) {
  const { rt, cell } = sel;
  const [rooms, setRooms] = useState(cell.rooms_to_sell);
  const [stop, setStop] = useState(cell.stop_sell);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.setInventory({ roomTypeIds: [rt.id], from: cell.night, to: cell.night, rooms, stopSell: stop, expected: cell.has_row ? cell.rooms_to_sell : 0 });
      onSaved(`حُفظت ليلة ${cell.night}`);
    } catch (e) {
      const m = (e as Error).message;
      const changed = m.match(/changed:(\d+)/);
      setError(changed ? `تغيّرت الخلية أثناء التعديل (المتبقي الآن ${changed[1]}). أغلق وأعد الفتح.` : m);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`${rt.name_ar} — ${cell.night}`}>
      <p className="text-sm text-ink-muted mb-3">المحجوز: <b className="num">{cell.booked}</b> · {cell.has_row ? 'الليلة مفتوحة' : 'الليلة مغلقة (بلا صف)'}</p>
      <Field label="الغرف المتبقية للبيع على الموقع" id="cell-rooms">
        <Stepper id="cell-rooms" value={rooms} onChange={setRooms} min={0} max={999} label="الغرف المتبقية" />
      </Field>
      <label className="flex items-center gap-2 mt-4 text-sm font-semibold"><input type="checkbox" className="size-4 accent-bronze-deep" checked={stop} onChange={(e) => setStop(e.target.checked)} /> إيقاف البيع لهذه الليلة (stop-sell)</label>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="cell-save">{busy && <Spinner />} حفظ</button>
      </div>
    </Modal>
  );
}

function NightRate({ sel, onClose, onSaved }: { sel: { rt: RoomType; cell: CalendarCell }; onClose: () => void; onSaved: (m: string) => void }) {
  const { rt, cell } = sel;
  const [price, setPrice] = useState(cell.price === null ? '' : String(cell.price));
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const p = Number(price);
    if (!(p > 0)) return setError('اكتب سعرًا أكبر من صفر.');
    setBusy(true);
    try {
      await api.addOverride([rt.id], cell.night, cell.night, 127, p, label, labelEn);
      onSaved(`سعر ليلة ${cell.night}: ${sar(p)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`${rt.name_ar} — ${cell.night}`}>
      <p className="text-sm text-ink-muted mb-3">السعر الحالي: <b>{cell.price === null ? 'بلا سعر' : sar(cell.price)}</b>{cell.override_label ? ` (${cell.override_label})` : ''}. يُحفظ كاستثناء لهذه الليلة فوق السعر الأساسي.</p>
      <Field label="السعر لليلة (شامل الضريبة)" id="night-price"><input id="night-price" className="field num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <Field label="تسمية بالعربية (اختياري)" id="night-label"><input id="night-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: عطلة" /></Field>
        <Field label="التسمية بالإنجليزية (اختياري)" id="night-label-en" hint="تظهر للضيف في الإنجليزية؛ فارغة = بلا تسمية"><input id="night-label-en" className="field latin" dir="ltr" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} placeholder="e.g. Holiday" /></Field>
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />} حفظ</button>
      </div>
    </Modal>
  );
}

function BaseRate({ rt, onClose, onSaved }: { rt: RoomType; onClose: () => void; onSaved: (m: string) => void }) {
  const [price, setPrice] = useState(rt.base_rate === null ? '' : String(rt.base_rate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const p = price.trim() === '' ? null : Number(price);
    if (p !== null && !(p > 0)) return setError('اكتب سعرًا أكبر من صفر، أو اتركه فارغًا لإزالة السعر.');
    setBusy(true);
    try {
      await api.setBaseRate(rt.id, p);
      onSaved(`السعر الأساسي لـ${rt.name_ar}: ${p === null ? 'بلا سعر' : sar(p)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`السعر الأساسي — ${rt.name_ar}`}>
      <p className="text-sm text-ink-muted mb-3">يُطبَّق على كل ليلة لا يغطيها استثناء. شامل الضريبة.</p>
      <Field label="السعر لليلة" id="base-price"><input id="base-price" className="field num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-field="base-rate" /></Field>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="base-rate-save">{busy && <Spinner />} حفظ</button>
      </div>
    </Modal>
  );
}

function Bulk({ mode, types, from, onClose, onSaved }: { mode: Mode; types: RoomType[]; from: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [ids, setIds] = useState<string[]>(types.map((t) => t.id));
  const [dFrom, setDFrom] = useState(from);
  const [dTo, setDTo] = useState(addDays(from, 6));
  const [mask, setMask] = useState(127);
  const [price, setPrice] = useState('');
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [op, setOp] = useState<'set' | 'delta' | 'open' | 'close'>('set');
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const span = daysBetween(dFrom, dTo) + 1;

  async function save() {
    setError(null);
    if (!ids.length) return setError('اختر نوع غرفة واحدًا على الأقل.');
    if (span < 1 || span > 400) return setError('الفترة من يوم إلى 400 يوم.');
    setBusy(true);
    try {
      if (mode === 'rates') {
        const p = Number(price);
        if (!(p > 0)) throw new Error('اكتب سعرًا أكبر من صفر.');
        const k = await api.addOverride(ids, dFrom, dTo, mask, p, label, labelEn);
        onSaved(`أُضيف سعر ${sar(p)} لـ${k} نوع غرفة (${maskLabel(mask)})`);
      } else {
        const k = await api.setInventory({ roomTypeIds: ids, from: dFrom, to: dTo, weekdays: mask, rooms: op === 'set' ? n : null, delta: op === 'delta' ? n : null, stopSell: op === 'open' ? false : op === 'close' ? true : null });
        onSaved(`عُدّلت ${k} ليلة`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={mode === 'rates' ? 'سعر لفترة' : 'تعديل جماعي للمخزون'} wide>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="من" id="b-from"><input id="b-from" type="date" className="field num" min={riyadhToday()} value={dFrom} onChange={(e) => setDFrom(e.target.value)} /></Field>
        <Field label="إلى" id="b-to"><input id="b-to" type="date" className="field num" min={dFrom} value={dTo} onChange={(e) => setDTo(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><span className="label">أيام الأسبوع</span><WeekdayPicker mask={mask} onChange={setMask} /></div>
      <div className="mt-3">
        <span className="label">أنواع الغرف</span>
        <div className="flex flex-wrap gap-1">
          {types.map((t) => {
            const on = ids.includes(t.id);
            return (
              <button type="button" key={t.id} className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={on} onClick={() => setIds(on ? ids.filter((x) => x !== t.id) : [...ids, t.id])}>{t.name_ar}</button>
            );
          })}
        </div>
      </div>
      {mode === 'rates' ? (
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          <Field label="السعر لليلة (شامل الضريبة)" id="b-price"><input id="b-price" className="field num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-field="bulk-price" /></Field>
          <Field label="تسمية بالعربية" id="b-label" hint="مثال: موسم الصيف، نهاية الأسبوع"><input id="b-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label="التسمية بالإنجليزية (اختياري)" id="b-label-en" hint="للضيوف بالإنجليزية؛ فارغة = بلا تسمية"><input id="b-label-en" className="field latin" dir="ltr" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} placeholder="e.g. Summer season" /></Field>
        </div>
      ) : (
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          <Field label="الإجراء" id="b-op">
            <select id="b-op" className="field" value={op} onChange={(e) => setOp(e.target.value as typeof op)}>
              <option value="set">تحديد المتبقي للبيع = N</option>
              <option value="delta">إضافة / خصم N</option>
              <option value="open">فتح البيع (إلغاء الإيقاف)</option>
              <option value="close">إيقاف البيع (stop-sell)</option>
            </select>
          </Field>
          {(op === 'set' || op === 'delta') && (
            <Field label={op === 'set' ? 'N (الغرف المتبقية)' : 'N (موجب أو سالب)'} id="b-n">
              <Stepper id="b-n" value={n} onChange={setN} min={op === 'delta' ? -999 : 0} max={999} label="N" />
            </Field>
          )}
        </div>
      )}
      <p className="text-xs text-ink-muted mt-3">{span} يوم × {ids.length} نوع — {maskLabel(mask)}</p>
      <ErrorBox error={error} />
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} data-action="bulk-save">{busy && <Spinner />} تطبيق</button>
      </div>
    </Modal>
  );
}

function OverridesList({ list, types, onChanged }: { list: RateOverride[]; types: RoomType[]; onChanged: () => void }) {
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
            <span className="num">{o.date_from} → {o.date_to}</span>
            <span className="text-ink-muted">{maskLabel(o.weekdays)}</span>
            <span className="font-bold">{sar(o.price)}</span>
            {o.label && <span className="chip chip-request">{o.label}</span>}
            {o.label_en && <span className="chip chip-request latin" dir="ltr">{o.label_en}</span>}
            <button type="button" className="btn btn-ghost btn-sm ms-auto" onClick={async () => { try { await api.toggleOverride(o.id, false); toast('أُلغي الاستثناء'); onChanged(); } catch (e) { toast((e as Error).message, 'error'); } }}>إلغاء</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
