/**
 * Country-code selector of a phone field (28 Oct 2026, decision A): ONE behaviour for the booking form and the
 * partners enquiry wizard, bound to the markup of src/components/PhoneField.astro.
 *   - a button showing the flag + dial code opens a searchable listbox; flags (public/flags/, never emoji or a CDN)
 *     are requested only while the list is open; the list data (countries, names, strings) travels in the field's
 *     own JSON, built at build time (src/lib/countries.ts);
 *   - search matches the country name in the page language, the English name, the ISO code and the dial code
 *     (with or without +); Arabic-Indic digits are converted;
 *   - keyboard: arrows move, Enter picks, Esc closes and returns focus to the button, Tab closes; screen readers
 *     get listbox / option / aria-activedescendant / aria-selected and the button's «{label}: {country} +{code}»;
 *   - an outside press closes the list only when the press starts AND ends outside (src/lib/client.ts →
 *     onOutsidePress): selecting text in the search field and releasing outside never closes it;
 *   - the phone input keeps digits (Western), + and separators only; pasting a full international number (+ or 00)
 *     switches the selector to that country and keeps the national part (src/lib/phone.ts → splitInternational).
 * Nationality mode (careers form, 28 Oct 2026 — src/components/CountryField.astro): the same list and search without
 * dial codes (`dial: false` in the field's JSON), no phone input, and no default — the button shows the placeholder
 * and no flag until a country is chosen.
 */
import { onOutsidePress } from './client';
import { latinDigits, loadPhoneLib, splitInternational, type CountryRow } from './phone';

interface Data {
  countries: CountryRow[];
  strings: { none: string; label: string; placeholder?: string };
  /** false: nationality mode — names only, no dial codes, no phone input (default true) */
  dial?: boolean;
  /** the selected code at load and after reset() — '' = none (default 'SA') */
  default?: string;
}
export interface CountrySelect {
  /** the selected ISO code (the hidden input's value) */
  value(): string;
  /** select `cc` (unknown codes are ignored → false); `focusPhone` moves the focus to the number field */
  choose(cc: string, focusPhone?: boolean): boolean;
  /** back to the default (Saudi Arabia; none in nationality mode) */
  reset(): void;
  isOpen(): boolean;
  close(refocus?: boolean): void;
  /** the international number → its country + national part applied to the field (false when not international) */
  applyInternational(raw: string): Promise<boolean>;
  countries: CountryRow[];
}
export interface CountrySelectOptions {
  /** after every country change (user pick, paste, restore) */
  onChange?: (cc: string, source: 'pick' | 'paste' | 'set') => void;
  /** the listbox closes when the page is swapped out (view transitions): abort signal of the page */
  signal?: AbortSignal;
}

const DEFAULT = 'SA';
const norm = (s: string) => s.toLowerCase().replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

export function initCountrySelect(group: HTMLElement, opts: CountrySelectOptions = {}): CountrySelect | null {
  const data = JSON.parse(group.querySelector('[data-country-data]')?.textContent || 'null') as Data | null;
  const q = <T extends Element>(sel: string) => group.querySelector<T>(sel);
  const [btnEl, flagEl, codeEl, popEl, searchEl, listEl, hiddenEl, phoneEl] = [
    q<HTMLButtonElement>('[data-country-btn]'), q<HTMLImageElement>('[data-country-flag]'), q<HTMLElement>('[data-country-code]'),
    q<HTMLElement>('[data-country-pop]'), q<HTMLInputElement>('[data-country-search]'), q<HTMLElement>('[data-country-list]'),
    q<HTMLInputElement>('[data-country-value]'), q<HTMLInputElement>('[data-phone-input]'),
  ] as const;
  const dial = data?.dial !== false;
  if (!data || !btnEl || !flagEl || !codeEl || !popEl || !searchEl || !listEl || !hiddenEl || (dial && !phoneEl)) return null;
  // non-null from here on, also inside the hoisted function declarations below (narrowing does not reach those)
  const [btn, flag, code, pop, search, list, hidden] = [btnEl, flagEl, codeEl, popEl, searchEl, listEl, hiddenEl];
  const phone = phoneEl;
  const countries = data.countries;
  const fallback = data.default ?? DEFAULT;
  const flagBase = (flag.dataset.flagSrc || '/flags/sa.png').replace(/sa\.png$/, '');
  const flagSrc = (cc: string) => `${flagBase}${cc.toLowerCase()}.png`;
  const optId = (cc: string) => `${phone?.id || hidden.name || 'phone'}-cc-${cc}`;
  let visible: CountryRow[] = [];
  let active = 0;

  function renderList() {
    const q = norm(latinDigits(search.value.trim()).replace(/^\+/, ''));
    // ranked: the exact ISO code, then dial codes starting with the digits, then names starting with the query, then
    // names containing it («eg» lists Egypt before Senegal); ties keep the list order (Saudi Arabia, the GCC, A–Z)
    const rank = ([cc, dc, name, en]: CountryRow): number => {
      if (!q) return 0;
      if (cc.toLowerCase() === q) return 0;
      if (dial && /^\d+$/.test(q) && dc.startsWith(q)) return 1;
      const n = norm(name);
      const e = en ? norm(en) : '';
      if (n.startsWith(q) || e.startsWith(q)) return 2;
      if (n.includes(q) || e.includes(q)) return 3;
      return -1;
    };
    visible = countries
      .map((row, i) => ({ row, i, r: rank(row) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.row);
    active = Math.max(0, visible.findIndex(([cc]) => cc === hidden.value));
    list.replaceChildren();
    if (!visible.length) {
      const li = document.createElement('li');
      li.className = 'country-empty';
      li.textContent = data!.strings.none;
      list.append(li);
      search.removeAttribute('aria-activedescendant');
      return;
    }
    for (const [i, [cc, dc, name]] of visible.entries()) {
      const li = document.createElement('li');
      li.id = optId(cc);
      li.setAttribute('role', 'option');
      li.className = 'country-opt';
      li.dataset.cc = cc;
      li.setAttribute('aria-selected', String(cc === hidden.value));
      if (i === active) li.classList.add('is-active');
      const img = document.createElement('img');
      img.src = flagSrc(cc);
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.width = 24;
      img.height = 18;
      img.loading = 'lazy';
      img.decoding = 'async';
      const n = document.createElement('span');
      n.className = 'flex-1 truncate';
      n.textContent = name;
      const c = document.createElement('span');
      c.className = 'latin text-ink-muted';
      c.dir = 'ltr';
      c.textContent = `+${dc}`;
      if (dial) li.append(img, n, c);
      else li.append(img, n);
      list.append(li);
    }
    setActive(active, false);
  }
  function setActive(i: number, scroll = true) {
    const opts = list.querySelectorAll<HTMLElement>('.country-opt');
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, k) => o.classList.toggle('is-active', k === active));
    const cur = opts[active];
    search.setAttribute('aria-activedescendant', cur.id);
    if (scroll) cur.scrollIntoView({ block: 'nearest' });
  }
  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
  function open() {
    btn.setAttribute('aria-expanded', 'true');
    pop.classList.remove('hidden');
    search.value = '';
    renderList();
    search.focus();
    if (dial) void loadPhoneLib();
  }
  function close(refocus = false) {
    if (!isOpen()) return;
    btn.setAttribute('aria-expanded', 'false');
    pop.classList.add('hidden');
    if (refocus) btn.focus();
  }
  function set(cc: string, source: 'pick' | 'paste' | 'set', focusPhone: boolean): boolean {
    const row = countries.find(([c]) => c === cc);
    if (!row) return false;
    hidden.value = cc;
    flag.src = flagSrc(cc);
    flag.hidden = false;
    code.textContent = dial ? `+${row[1]}` : row[2];
    btn.setAttribute('aria-label', dial ? `${data!.strings.label}: ${row[2]} +${row[1]}` : `${data!.strings.label}: ${row[2]}`);
    close(false);
    if (focusPhone) (phone ?? btn).focus();
    opts.onChange?.(cc, source);
    return true;
  }
  /** nationality mode: no country chosen — the placeholder, no flag */
  function clear() {
    hidden.value = '';
    flag.hidden = true;
    code.textContent = data!.strings.placeholder ?? '';
    btn.setAttribute('aria-label', data!.strings.label);
    close(false);
    opts.onChange?.('', 'set');
  }
  async function applyInternational(raw: string): Promise<boolean> {
    if (!phone) return false;
    await loadPhoneLib();
    const s = splitInternational(raw, countries);
    if (!s) return false;
    phone.value = s.national;
    set(s.country, 'paste', false);
    phone.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  btn.addEventListener('click', () => (isOpen() ? close(true) : open()));
  search.addEventListener('input', renderList);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cc = visible[active]?.[0];
      if (cc) set(cc, 'pick', true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(false);
  });
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.country-opt');
    if (li?.dataset.cc) set(li.dataset.cc, 'pick', true);
  });
  // an outside press closes the list only when it starts AND ends outside (a text-selection drag out of the search
  // field keeps it open); the listener lives on the document for the page's lifetime
  onOutsidePress(() => [pop, btn], () => close(false), { signal: opts.signal, active: isOpen });
  // the number field: Western digits, +, separators; a pasted international number switches the country
  if (phone) {
    phone.addEventListener('input', () => {
      phone.value = latinDigits(phone.value).replace(/[^\d+\s\-()]/g, '');
    });
    phone.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (!/^\s*(\+|00)\s*[\d\s\-().٠-٩۰-۹]{6,}$/.test(text)) return;
      e.preventDefault();
      void applyInternational(text).then((ok) => {
        if (ok) return;
        phone.value = latinDigits(text).replace(/[^\d+\s\-()]/g, '');
        phone.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  return {
    value: () => hidden.value,
    choose: (cc, focusPhone = false) => set(cc, 'set', focusPhone),
    reset: () => (fallback ? void set(fallback, 'set', false) : clear()),
    isOpen,
    close,
    applyInternational,
    countries,
  };
}
