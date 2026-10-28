// Bilingual label pair (decision C4, 28 Oct 2026) — ONE component for every Arabic / English label of the dashboard
// (today the rate labels of «سعر لفترة» and the single-night rate; the offers module reuses it).
//   - focusing either field opens a combobox list of suggested pairs: the pairs already saved on this branch (most
//     recent first, deduplicated — `history`) then the seed glossary (public.label_glossary); filtered as you type,
//     keyboard (arrows, Enter, Esc) and touch; picking fills BOTH fields with the pair;
//   - when one field has text and the other is empty, «اقتراح: {text}» with «استخدام» shows under the empty field:
//     an exact glossary / history match first (instant, no network), else the label-suggest function 600 ms after
//     typing stops, dropped after 4 s or on failure (no error shown); the chip is never applied by itself and never
//     overwrites text (the labels are shown to guests);
//   - the list closes on a press that starts AND ends outside (decision B8, src/lib/client.ts).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { labelGlossary, labelSuggest, type LabelPairRow } from '../lib/api';
import { onOutsidePress } from '../../../src/lib/client';
import { Field } from './ui';

type Side = 'ar' | 'en';
export interface LabelPairProps {
  ar: string;
  en: string;
  onChange: (ar: string, en: string) => void;
  /** pairs saved on this branch, most recent first */
  history?: LabelPairRow[];
  ids: Record<Side, string>;
  labels: Record<Side, string>;
  hints?: Partial<Record<Side, string>>;
  placeholders?: Partial<Record<Side, string>>;
  disabled?: boolean;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const DEBOUNCE_MS = 600;
const TIMEOUT_MS = 4000;
const MAX_LISTED = 12;

let glossaryCache: Promise<LabelPairRow[]> | null = null;
const glossary = () => (glossaryCache ??= labelGlossary().catch(() => [] as LabelPairRow[]));

export default function LabelPair({ ar, en, onChange, history = [], ids, labels, hints = {}, placeholders = {}, disabled }: LabelPairProps) {
  const root = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, '');
  const [seed, setSeed] = useState<LabelPairRow[]>([]);
  const [open, setOpen] = useState<Side | null>(null);
  const [active, setActive] = useState(-1);
  const [chip, setChip] = useState<{ side: Side; text: string } | null>(null);
  const pending = useRef<{ timer: number; ac: AbortController | null }>({ timer: 0, ac: null });
  const values: Record<Side, string> = { ar, en };

  useEffect(() => {
    let on = true;
    glossary().then((g) => on && setSeed(g));
    return () => {
      on = false;
    };
  }, []);

  // history first (most recent), then the glossary; one entry per pair
  const pairs = useMemo(() => {
    const seen = new Set<string>();
    const out: LabelPairRow[] = [];
    for (const p of [...history, ...seed]) {
      const a = (p.ar ?? '').trim();
      const e = (p.en ?? '').trim();
      if (!a || !e) continue;
      const k = `${norm(a)}|${norm(e)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ar: a, en: e });
    }
    return out;
  }, [history, seed]);

  const listed = useMemo(() => {
    if (!open) return [];
    const q = norm(values[open]);
    return pairs.filter((p) => !q || norm(p.ar).includes(q) || norm(p.en).includes(q)).slice(0, MAX_LISTED);
  }, [open, pairs, ar, en]); // eslint-disable-line react-hooks/exhaustive-deps

  // the translation chip: exact match first, then the function (debounced, with a timeout; failure = nothing)
  useEffect(() => {
    window.clearTimeout(pending.current.timer);
    pending.current.ac?.abort();
    pending.current.ac = null;
    const a = ar.trim();
    const e = en.trim();
    if ((a && e) || (!a && !e)) {
      setChip(null);
      return;
    }
    const from: Side = a ? 'ar' : 'en';
    const to: Side = a ? 'en' : 'ar';
    const text = a || e;
    const exact = pairs.find((p) => norm(p[from]) === norm(text));
    if (exact) {
      setChip({ side: to, text: exact[to] });
      return;
    }
    setChip(null);
    pending.current.timer = window.setTimeout(async () => {
      const ac = new AbortController();
      pending.current.ac = ac;
      const kill = window.setTimeout(() => ac.abort(), TIMEOUT_MS);
      try {
        const label = await labelSuggest(text, from, ac.signal);
        if (!ac.signal.aborted && label) setChip({ side: to, text: label });
      } catch {
        /* nothing: no chip, no error */
      } finally {
        window.clearTimeout(kill);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(pending.current.timer);
    };
  }, [ar, en, pairs]);

  // an outside press (start AND end outside) closes the list
  useEffect(() => onOutsidePress(() => [root.current], () => setOpen(null), { active: () => open !== null }), [open]);

  const pick = (p: LabelPairRow) => {
    onChange(p.ar, p.en);
    setOpen(null);
    setActive(-1);
  };
  const set = (side: Side, v: string) => (side === 'ar' ? onChange(v, en) : onChange(ar, v));
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;

  const onKey = (side: Side) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open !== side) {
        setOpen(side);
        setActive(0);
      } else setActive((i) => (listed.length ? (i + 1) % listed.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open === side) setActive((i) => (listed.length ? (i - 1 + listed.length) % listed.length : -1));
    } else if (e.key === 'Enter') {
      if (open === side && active >= 0 && listed[active]) {
        e.preventDefault();
        pick(listed[active]);
      }
    } else if (e.key === 'Escape') {
      if (open === side) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(null);
      }
    } else if (e.key === 'Tab') setOpen(null);
  };

  return (
    <div ref={root} className="grid sm:grid-cols-2 gap-3" data-label-pair
      // focus leaving the pair (a programmatic focus, a focus stolen by a confirm) closes the open list; a pointer press on
      // an option or the chip never blurs (preventDefault), Tab and outside presses close it as before
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(null);
      }}>
      {(['ar', 'en'] as Side[]).map((side) => (
        <div key={side} className="relative">
          <Field label={labels[side]} id={ids[side]} hint={hints[side]}>
            <input
              id={ids[side]}
              className={`field ${side === 'en' ? 'latin' : ''}`}
              dir={side === 'en' ? 'ltr' : undefined}
              lang={side === 'en' ? 'en' : 'ar'}
              value={values[side]}
              maxLength={80}
              autoComplete="off"
              disabled={disabled}
              placeholder={placeholders[side]}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open === side}
              aria-controls={listId}
              aria-activedescendant={open === side && active >= 0 && listed[active] ? optId(active) : undefined}
              onChange={(e) => {
                set(side, e.target.value);
                setOpen(side);
                setActive(-1);
              }}
              onFocus={() => {
                setOpen(side);
                setActive(-1);
              }}
              onKeyDown={onKey(side)}
              data-label-input={side}
            />
          </Field>
          {open === side && listed.length > 0 && (
            <ul id={listId} role="listbox" aria-label="تسميات مقترحة" className="label-list" data-label-list>
              {listed.map((p, i) => (
                <li
                  key={`${p.ar}|${p.en}`}
                  id={optId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`label-opt ${i === active ? 'is-active' : ''}`}
                  // a pointer press must not blur the field before the click lands (touch and mouse)
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  data-label-opt
                >
                  <span>{p.ar}</span>
                  <span className="latin text-ink-muted" dir="ltr">{p.en}</span>
                </li>
              ))}
            </ul>
          )}
          {chip?.side === side && !values[side].trim() && (
            <p className="label-chip" role="status" data-suggest-for={side}>
              <span>اقتراح: </span>
              <span className={side === 'en' ? 'latin' : ''} dir={side === 'en' ? 'ltr' : undefined} data-suggest-text>{chip.text}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(side, chip.text)} disabled={disabled} data-action="use-suggestion">استخدام</button>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
