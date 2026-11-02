// The grouped target picker (Ahmed, 2 Nov 2026 — phase 2b session 3, part C): the list of «الصور» (and any other list of
// targets in the dashboard) as sections that scan at a glance.
//   - each group is a header band (a darker surface, a bronze bar on the start side, a bold label and an icon) and a
//     button with aria-expanded that collapses / expands it; next to it a chip «ناقص N» (required slots or alts missing in
//     the group) or «مكتمل ✓»;
//   - the group holding the selected target is always open; the open state is remembered per user (localStorage, a
//     convenience only); the header of the group being scrolled stays sticky at the top of the list;
//   - inside a group, optional sub-headers («الفرع»، «الغرف والأجنحة»، «القاعة والمطاعم») and the items indented with a thin
//     guide line on the start side;
//   - a search box filters the items by name (Arabic, English or key; Arabic-Indic digits accepted) and opens every group
//     that has a match.
// The same component on every width: on phones the list sits in a disclosure under the current target's name.
import { useEffect, useId, useMemo, useState } from 'react';
import { Icon, type IconName } from './icons';
import { west } from '../lib/format';

export type PickerTone = 'missing' | 'pending' | 'live' | 'empty';
export interface PickerItem {
  id: string;
  label: string;
  /** extra text the search matches (the English name, the key…) */
  search?: string;
  tone?: PickerTone;
  toneText?: string;
  /** how many required slots / alts this item still misses (the group chip adds them up) */
  missing?: number;
}
export interface PickerSub {
  title?: string;
  items: PickerItem[];
}
export interface PickerGroup {
  key: string;
  title: string;
  icon: IconName;
  subs: PickerSub[];
  /** false: no «ناقص» / «مكتمل» chip (a list that has no required slots) */
  chip?: boolean;
}

const norm = (s: string) => west(s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();

function readOpen(key: string): string[] | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}
function writeOpen(key: string, open: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(open));
  } catch { /* private mode: the state lasts for this visit */ }
}

export default function TargetPicker({ groups, current, onPick, label, storageKey, currentLabel }: {
  groups: PickerGroup[];
  current: string | null;
  onPick: (id: string) => void;
  /** the list's accessible name, e.g. «صفحات الموقع» */
  label: string;
  /** where the open groups are remembered (per user) */
  storageKey: string;
  /** shown on phones on the disclosure button */
  currentLabel?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState<string[]>(() => readOpen(storageKey) ?? []);
  const [q, setQ] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentGroup = useMemo(() => groups.find((g) => g.subs.some((s) => s.items.some((i) => i.id === current)))?.key ?? null, [groups, current]);

  // the group of the selected target stays open
  useEffect(() => {
    if (currentGroup && !open.includes(currentGroup)) setOpen((o) => [...o, currentGroup]);
  }, [currentGroup]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => writeOpen(storageKey, open), [storageKey, open]);

  const nq = norm(q);
  const shown = useMemo(() => {
    if (!nq) return groups;
    return groups
      .map((g) => ({ ...g, subs: g.subs.map((s) => ({ ...s, items: s.items.filter((i) => norm(`${i.label} ${i.search ?? ''} ${i.id}`).includes(nq)) })).filter((s) => s.items.length) }))
      .filter((g) => g.subs.length || norm(g.title).includes(nq));
  }, [groups, nq]);
  const matches = shown.reduce((n, g) => n + g.subs.reduce((m, s) => m + s.items.length, 0), 0);

  const toggle = (k: string) => setOpen((o) => (o.includes(k) ? (k === currentGroup ? o : o.filter((x) => x !== k)) : [...o, k]));
  const pick = (id: string) => {
    onPick(id);
    setMobileOpen(false);
  };

  return (
    <div className="picker" data-picker>
      <button type="button" className="picker-mobile btn btn-ghost md:hidden" aria-expanded={mobileOpen} aria-controls={`${uid}-panel`} onClick={() => setMobileOpen((v) => !v)} data-action="picker-toggle">
        <span className="min-w-0 truncate">{currentLabel ?? label}</span>
        <Icon name="chevron" size={16} className={`picker-chevron ${mobileOpen ? 'is-open' : ''}`} />
      </button>
      <div id={`${uid}-panel`} className={`picker-panel card ${mobileOpen ? '' : 'max-md:hidden'}`}>
        <div className="picker-search">
          <label htmlFor={`${uid}-q`} className="sr-only">ابحث في {label}</label>
          <Icon name="search" size={16} className="picker-search-icon" />
          <input id={`${uid}-q`} type="search" className="field" placeholder="ابحث بالاسم…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" data-no-dirty data-picker-search />
        </div>
        {nq && <p className="sr-only" role="status">{matches ? `${matches} نتيجة` : 'لا نتائج'}</p>}
        <nav aria-label={label} className="picker-list">
          {!shown.length && <p className="px-3 py-4 text-sm text-ink-muted">لا نتائج لـ«{q}».</p>}
          {shown.map((g) => {
            const missing = g.subs.reduce((n, s) => n + s.items.reduce((m, i) => m + (i.missing ?? 0), 0), 0);
            const isOpen = !!nq || open.includes(g.key) || g.key === currentGroup;
            const listId = `${uid}-${g.key}`;
            return (
              <section key={g.key} className="picker-group" data-picker-group={g.key}>
                <h3 className="picker-head-wrap">
                  <button type="button" className="picker-head" aria-expanded={isOpen} aria-controls={listId} onClick={() => toggle(g.key)} data-group={g.key}>
                    <Icon name={g.icon} size={18} className="picker-icon" />
                    <span className="picker-title">{g.title}</span>
                    {g.chip !== false && (
                      <span className={`picker-chip ${missing ? 'is-missing' : 'is-done'}`} data-chip={missing ? 'missing' : 'done'}>
                        {missing ? `ناقص ${missing}` : 'مكتمل ✓'}
                      </span>
                    )}
                    <Icon name="chevron" size={16} className={`picker-chevron ${isOpen ? 'is-open' : ''}`} />
                  </button>
                </h3>
                <div id={listId} hidden={!isOpen} className="picker-body">
                  {g.subs.map((s, n) => (
                    <div key={s.title ?? n} className="picker-sub">
                      {s.title && <p className="picker-subhead">{s.title}</p>}
                      <ul className="picker-items">
                        {s.items.map((i) => {
                          const on = i.id === current;
                          return (
                            <li key={i.id}>
                              <button type="button" className={`media-target ${on ? 'is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => pick(i.id)} data-target={i.id}>
                                <span className="truncate">{i.label}</span>
                                {i.tone && <span className={`media-dot media-dot-${i.tone}`} title={i.toneText}><span className="sr-only">{i.toneText}</span></span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
