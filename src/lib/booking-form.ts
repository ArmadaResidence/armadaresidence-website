/**
 * The booking form's behaviour (BookingForm.astro) — moved out of the component's script on 9 Nov 2026 (mobile LCP):
 * the component's own script is a small loader that imports this module when the form starts (the drawer's form
 * after the first paint or on a booking press, the /booking/ page's form at once), so its code and its imports
 * (date picker, phone and country list, rules, prices) are no longer requested before the first paint.
 */
import { firstTouch } from '@lib/visit';
import { turnstileToken } from '@lib/turnstile';
import { bindOnce } from '@lib/client';
import { initDateRange } from '@lib/daterange';
import {
  bedsNeeded,
  branchMaxAdults,
  branchMaxExtraBeds,
  CHILD_AGE_MAX,
  needsChildAges,
  nightsBetween,
  plural,
  riyadhToday,
  validateBooking,
  type BookingInput,
  type FieldError,
} from '../../supabase/functions/booking-request/rules.ts';
import { money, quoteStay, siteRoomTypes, time12, type Quote, type QuoteResult } from '@lib/prices';
import { latinDigits, loadPhoneLib, phoneToE164 } from '@lib/phone';
import { initCountrySelect } from '@lib/country-select';

type Plurals = Record<'nights' | 'adults' | 'children', Record<'one' | 'two' | 'few' | 'many', string>>;
type QuoteStrings = {
  heading: string;
  loading: string;
  room_line: string;
  breakfast_line: string;
  extra_beds_line: string;
  total_line: string;
  per_night: string;
  pay_at_hotel: string;
  instant_badge: string;
  request_badge: string;
  submit_instant: string;
  pick_room: string;
  unavailable: string;
  price_changed: string;
  ages_heading: string;
  ages_hint: string;
  age_label: string;
  age_choose: string;
  age_under1: string;
  age_years: Record<'one' | 'two' | 'few' | 'many', string>;
  reasons: Record<string, string>;
  offer_line: string;
  discount_line: string;
  base_total_line: string;
  promo_line: string;
  promo: Record<string, string>;
};
type Data = {
  locale: 'ar' | 'en';
  endpoint: string;
  anonKey: string;
  supabaseUrl: string;
  quote: QuoteStrings;
  promo: boolean;
  successPath: string;
  consentVersion: string;
  partnersPath: string;
  branches: { slug: string; name: string; short: string; whatsapp: string }[];
  rooms: { slug: string; branch: string; name: string; capacity: number; extra_beds_max: number; availability: string }[];
  strings: {
    anyRoom: string;
    roomCleared: string;
    sending: string;
    submit: string;
    errors: Record<string, string>;
    whatsappMessage: string;
    breakfastWith: string;
    breakfastWithout: string;
    stayLength: string;
    plural: Plurals;
    capacityBranch: string;
    capacityBranchLink: string;
    bedsAuto: string;
    bedsPlural: Record<'one' | 'two' | 'few' | 'many', string>;
    bedsPluralAcc: Record<'one' | 'two' | 'few' | 'many', string>;
    capacityBeds: string;
    capacityNoBeds: string;
    bedsLabel: string;
    adults: string;
    children: string;
  };
};

function initForm(form: HTMLFormElement) {
  const data = JSON.parse(form.querySelector('[data-booking-data]')?.textContent || '{}') as Data;
  const S = data.strings;
  const el = <T extends Element = HTMLInputElement>(name: string) => form.elements.namedItem(name) as unknown as T;
  const branchSel = el<HTMLSelectElement>('branch');
  const roomSel = el<HTMLSelectElement>('room');
  // by name only: on /booking/ the date button's id equals the input name, so namedItem() would return both
  const checkIn = form.querySelector<HTMLInputElement>('input[name="check_in"]')!;
  const checkOut = form.querySelector<HTMLInputElement>('input[name="check_out"]')!;
  const adultsIn = el('adults');
  const childrenIn = el('children');
  const bedsIn = el('extra_beds');
  const bedsWrap = form.querySelector<HTMLElement>('[data-stepper="extra_beds"]')!;
  const bedsAutoNote = form.querySelector<HTMLElement>('[data-beds-auto]')!;
  const bedsFee = form.querySelector<HTMLElement>('[data-beds-fee]')!;
  const nameIn = el('name');
  const phoneIn = form.querySelector<HTMLInputElement>('[data-phone-input]')!;
  const emailIn = el('email');
  const notesIn = el<HTMLTextAreaElement>('notes');
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const submitLabel = form.querySelector<HTMLElement>('[data-submit-label]')!;
  const spinner = form.querySelector<HTMLElement>('[data-spinner]')!;
  const formError = form.querySelector<HTMLElement>('[data-form-error]')!;
  const waSend = form.querySelector<HTMLButtonElement>('[data-wa-send]')!;
  const summary = form.querySelector<HTMLElement>('[data-summary]')!;
  const nightsLine = form.querySelector<HTMLElement>('[data-nights]')!;
  const capNote = form.querySelector<HTMLElement>('[data-capacity-note]')!;
  const agesWrap = form.querySelector<HTMLElement>('[data-ages]')!;
  const agesList = form.querySelector<HTMLElement>('[data-ages-list]')!;
  const quoteBox = form.querySelector<HTMLElement>('[data-quote]')!;
  const promoIn = form.querySelector<HTMLInputElement>('input[name="promo_code"]');
  const promoStatus = form.querySelector<HTMLElement>('[data-promo-status]');
  /** the last promo status the quote gave for the typed code (null = not checked yet) */
  let promoState: string | null = null;
  const touched = new Set<string>();
  let sending = false;
  /** once the guest sets the extra beds themselves, the auto-fill stops overriding them */
  let bedsTouched = false;

  form.addEventListener('focusin', () => void loadPhoneLib(), { once: true });

  // ── dates: the calendar range picker (DateRangeField) writes ISO values into the hidden inputs and dispatches
  // `change`; the past / order / range rules live in the picker and again in rules.ts ─────────────────────
  const dateBtn: Record<string, HTMLButtonElement> = {
    check_in: form.querySelector<HTMLButtonElement>('[data-dr-trigger="start"]')!,
    check_out: form.querySelector<HTMLButtonElement>('[data-dr-trigger="end"]')!,
  };
  let prefilling = false; // dates written by a prefill are not "touched" (no error shown before the guest acts)
  for (const input of [checkIn, checkOut]) {
    input.addEventListener('change', () => {
      if (!prefilling) touched.add(input.name);
      for (const f of ['check_in', 'check_out']) if (touched.has(f)) validateField(f);
      refresh();
    });
  }

  // ── room list filtered by branch ─────────────────────────────────────────────────────────────────────
  /**
   * Select the room option for `slug` that belongs to the selected branch. Room slugs repeat across branches
   * (king-room, one-bedroom-suite, two-bedroom-suite), so `roomSel.value = slug` would pick the first match —
   * often the other branch's option, which is disabled and therefore left out of the submitted form data
   * (bug found in the 23 Oct live test: Shafa Road room CTAs were sent as «أي غرفة متاحة»).
   */
  function selectRoom(slug: string): boolean {
    const b = branchSel.value;
    const opt = Array.from(roomSel.options).find((o) => o.value === slug && !o.disabled && (!o.dataset.branch || !b || o.dataset.branch === b));
    if (opt) opt.selected = true;
    else roomSel.selectedIndex = 0;
    return !!opt;
  }
  const roomNote = form.querySelector<HTMLElement>('[data-room-note]')!;
  /** With no branch every group is offered; with a branch only its group (hidden + disabled, so a hidden room is
   *  never submitted). Returns false when the chosen room was dropped because the new branch has no such type. */
  function filterRooms(): boolean {
    const b = branchSel.value;
    for (const g of Array.from(roomSel.querySelectorAll<HTMLOptGroupElement>('optgroup'))) {
      const off = Boolean(b) && g.dataset.branch !== b;
      g.hidden = off;
      g.disabled = off;
      for (const opt of Array.from(g.querySelectorAll('option'))) {
        opt.hidden = off;
        opt.disabled = off;
      }
    }
    // keep the same room type when the new branch has it, otherwise «أي غرفة متاحة»
    const current = roomSel.selectedOptions[0];
    if (current && current.value && current.disabled) return selectRoom(current.value);
    return true;
  }
  branchSel.addEventListener('change', () => {
    const kept = filterRooms();
    roomNote.textContent = kept ? '' : S.roomCleared;
    roomNote.classList.toggle('hidden', kept);
    bedsTouched = false;
    refresh();
  });
  roomSel.addEventListener('change', () => {
    // a room picked with no branch (or another branch's group) selects its branch
    const ob = roomSel.selectedOptions[0]?.dataset.branch;
    if (ob && branchSel.value !== ob) {
      branchSel.value = ob;
      filterRooms();
      touched.add('branch');
      validateField('branch');
    }
    roomNote.classList.add('hidden');
    bedsTouched = false;
    refresh();
  });

  // ── steppers: digits only, clamped ───────────────────────────────────────────────────────────────────
  form.querySelectorAll<HTMLElement>('[data-stepper]').forEach((wrap) => {
    const input = wrap.querySelector<HTMLInputElement>('input')!;
    const min = Number(input.dataset.min);
    // max is read on every use: the extra-beds stepper's max follows the selected room / branch
    const clamp = (n: number) => Math.min(Number(input.dataset.max), Math.max(min, Number.isFinite(n) ? n : min));
    const key = wrap.dataset.stepper === 'extra_beds' ? 'extra_beds' : 'adults';
    const changed = () => {
      if (key === 'extra_beds') bedsTouched = true;
      touched.add(key);
      refresh();
      validateField('adults');
      validateField('extra_beds');
    };
    wrap.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((btn) =>
      btn.addEventListener('click', () => {
        input.value = String(clamp(Number(input.value || min) + Number(btn.dataset.step)));
        changed();
      }),
    );
    input.addEventListener('input', () => {
      input.value = latinDigits(input.value).replace(/\D/g, '').slice(0, 2);
      refresh();
    });
    input.addEventListener('blur', () => {
      input.value = String(clamp(Number(input.value === '' ? min : input.value)));
      changed();
    });
  });

  // ── country selector: the shared component (src/lib/country-select.ts) — button + searchable listbox, flags
  // loaded only while the list is open, a pasted international number switches the country ─────────────────
  const pageGone = new AbortController();
  document.addEventListener('astro:before-swap', () => pageGone.abort(), { once: true });
  initCountrySelect(form.querySelector<HTMLElement>('[data-phone-group]')!, {
    signal: pageGone.signal,
    onChange: () => {
      if (touched.has('phone')) validateField('phone');
      refresh();
    },
  });

  // ── prefill (?branch=&room=&check_in=&check_out= on the page, or the link that opened the drawer) ─────
  // The link sets the branch and the room exactly: none → «اختر الفرع» / «أي غرفة متاحة» (24 Oct 2026: the header
  // button opened after a room CTA used to keep that room). Dates only when the link carries both; the picker
  // re-reads its hidden inputs on `change` and drops a past or inconsistent pair. Without dates, dates already
  // picked stay.
  type Prefill = { branch?: string | null; room?: string | null; check_in?: string | null; check_out?: string | null; promo?: string | null };
  const prefill = (p: Prefill) => {
    branchSel.value = p.branch && data.branches.some((b) => b.slug === p.branch) ? p.branch : '';
    filterRooms();
    roomNote.classList.add('hidden');
    form.dataset.prefillRoom = p.room ?? '';
    if (p.room) selectRoom(p.room);
    else roomSel.selectedIndex = 0;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (p.check_in && p.check_out && iso.test(p.check_in) && iso.test(p.check_out)) {
      prefilling = true;
      checkIn.value = p.check_in;
      checkOut.value = p.check_out;
      checkIn.dispatchEvent(new Event('change', { bubbles: true }));
      prefilling = false;
    }
    bedsTouched = false;
    // an offer's button carries its code (?promo=); a link without one leaves a typed code alone
    if (promoIn && p.promo) promoIn.value = p.promo.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
    refresh();
  };
  // (applied at the end of initForm, once every helper below exists)

  // ── validation (rules.ts, shared with the Edge Function) ─────────────────────────────────────────────
  const ctx = () => ({
    branches: data.branches.map((b) => b.slug),
    rooms: data.rooms,
    today: riyadhToday(),
    phone: (raw: string, country: string) => phoneToE164(raw, country),
  });
  const collect = (): BookingInput => {
    const fd = new FormData(form);
    const v = (k: string) => String(fd.get(k) ?? '').trim();
    // ages (Q2): sent only when every shown select is chosen — they price breakfast and never block a request;
    // without them the server stores a request with reason needs_ages (the quote badge says so)
    const shown = agesWrap.classList.contains('hidden') ? [] : fd.getAll('children_ages').map((a) => String(a).trim());
    const ages = shown.length && shown.every((a) => a !== '') ? shown : [];
    return {
      branch: v('branch'),
      room: v('room'),
      check_in: v('check_in'),
      check_out: v('check_out'),
      adults: v('adults'),
      children: v('children') || '0',
      extra_beds: v('extra_beds') || '0',
      breakfast: v('breakfast'),
      children_ages: ages,
      name: v('name'),
      phone: v('phone'),
      country: v('country'),
      email: v('email'),
      notes: v('notes'),
      promo_code: v('promo_code'),
    };
  };
  const FIELD_OF: Record<string, string> = { children: 'adults' };
  const message = (field: string, code: FieldError): string => {
    const e = S.errors;
    if (code === 'extra_beds') return e.extra_beds;
    if (code === 'required' && field === 'breakfast') return e.breakfast;
    const map: Partial<Record<FieldError, string>> = {
      required: e.required, branch: e.required, room: e.required, date_format: e.date_format, past: e.past, dates: e.dates,
      adults: e.adults, children: e.adults, extra_beds: e.extra_beds, children_ages: e.children_ages, breakfast: e.breakfast, name: e.name, phone: e.phone, email: e.email,
      format: Q.promo.format,
    };
    return map[code] ?? e.required;
  };
  function control(field: string): HTMLElement | null {
    if (field === 'breakfast') return form.querySelector<HTMLElement>('input[name="breakfast"]');
    if (field === 'phone') return phoneIn;
    if (field === 'children_ages') return agesList.querySelector<HTMLSelectElement>('select:invalid, select') ?? null;
    if (dateBtn[field]) return dateBtn[field];
    return form.elements.namedItem(field) as HTMLElement | null;
  }
  function showError(field: string, msg: string | null) {
    const box = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
    if (box) {
      box.textContent = msg ?? '';
      box.classList.toggle('hidden', !msg);
    }
    if (field === 'breakfast') {
      form.querySelectorAll<HTMLInputElement>('input[name="breakfast"]').forEach((r) => r.setAttribute('aria-invalid', msg ? 'true' : 'false'));
      form.querySelector('[data-breakfast]')?.classList.toggle('is-invalid', !!msg);
    } else if (field === 'adults') {
      [adultsIn, childrenIn].forEach((i) => i.closest('.stepper')?.classList.toggle('is-invalid', !!msg));
      adultsIn.setAttribute('aria-invalid', msg ? 'true' : 'false');
    } else control(field)?.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  const FIELDS = ['branch', 'room', 'check_in', 'check_out', 'adults', 'extra_beds', 'breakfast', 'children_ages', ...(promoIn ? ['promo_code'] : []), 'name', 'phone', 'email'];
  function errorsNow() {
    const r = validateBooking(collect(), ctx());
    return r.ok ? {} : (r.errors as Record<string, FieldError>);
  }
  function validateField(field: string) {
    const errs = errorsNow();
    const f = FIELD_OF[field] ?? field;
    const code = errs[f] ?? (f === 'adults' ? errs.children : undefined);
    showError(f, code ? message(f, code) : null);
  }
  function validateAll(): boolean {
    const errs = errorsNow();
    let first: HTMLElement | null = null;
    for (const f of FIELDS) {
      const code = errs[f] ?? (f === 'adults' ? errs.children : undefined);
      showError(f, code ? message(f, code) : null);
      if (code && !first) first = f === 'adults' ? adultsIn : f === 'extra_beds' ? bedsIn : control(f);
      touched.add(f);
    }
    if (first) first.focus();
    return !first;
  }
  for (const f of ['branch', 'room', 'check_in', 'check_out', 'name', 'email']) {
    const c = control(f);
    c?.addEventListener('blur', () => {
      if (f === 'name' && (c as HTMLInputElement).value.trim() === '' && !touched.has(f)) return;
      if (dateBtn[f] && c.getAttribute('aria-expanded') === 'true') return; // focus moved into the picker
      touched.add(f);
      validateField(f);
    });
    c?.addEventListener('input', () => touched.has(f) && validateField(f));
    c?.addEventListener('change', () => touched.has(f) && validateField(f));
  }
  phoneIn.addEventListener('blur', async () => {
    if (!phoneIn.value.trim() && !touched.has('phone')) return;
    touched.add('phone');
    await loadPhoneLib();
    validateField('phone');
  });
  phoneIn.addEventListener('input', () => touched.has('phone') && validateField('phone'));
  form.querySelectorAll<HTMLInputElement>('input[name="breakfast"]').forEach((r) =>
    r.addEventListener('change', () => {
      touched.add('breakfast');
      validateField('breakfast');
      refresh();
    }),
  );

  // ── live helpers: nights line, capacity note, summary line ───────────────────────────────────────────
  const P = S.plural;
  function nightsNow(): number {
    const a = checkIn.value;
    const b = checkOut.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || b <= a) return 0;
    return nightsBetween(a, b);
  }
  function refresh() {
    const n = nightsNow();
    nightsLine.textContent = n ? S.stayLength.replace('{nights}', plural(P.nights, n)) : '';
    nightsLine.classList.toggle('hidden', !n);

    const adults = Number(adultsIn.value || 0);
    const kids = Number(childrenIn.value || 0);
    const room = data.rooms.find((r) => r.slug === roomSel.value && r.branch === branchSel.value);
    // extra beds: allowed up to the room's extra_beds_max, or the branch's highest with «أي غرفة متاحة»
    const bedsMax = room ? room.extra_beds_max : branchSel.value ? branchMaxExtraBeds(data.rooms, branchSel.value) : 0;
    bedsIn.dataset.max = String(bedsMax);
    bedsWrap.classList.toggle('hidden', bedsMax === 0);
    bedsFee.classList.toggle('hidden', bedsMax === 0);
    if (bedsMax === 0) bedsIn.value = '0';
    else if (Number(bedsIn.value || 0) > bedsMax) bedsIn.value = String(bedsMax);
    // more adults than the room takes → set the extra beds to the difference when it fits, and say so
    bedsAutoNote.classList.add('hidden');
    if (room) {
      const need = bedsNeeded(room, adults);
      if (need > 0 && need <= bedsMax && Number(bedsIn.value || 0) < need && !bedsTouched) {
        bedsIn.value = String(need);
        bedsAutoNote.textContent = S.bedsAuto.replace('{beds}', plural(S.bedsPluralAcc, need)).replace('{capacity}', String(room.capacity));
        bedsAutoNote.classList.remove('hidden');
      } else if (need > 0 && need <= bedsMax && Number(bedsIn.value || 0) === need && !bedsTouched) {
        bedsAutoNote.textContent = S.bedsAuto.replace('{beds}', plural(S.bedsPluralAcc, need)).replace('{capacity}', String(room.capacity));
        bedsAutoNote.classList.remove('hidden');
      }
    }
    const beds = Number(bedsIn.value || 0);
    capNote.replaceChildren();
    capNote.classList.add('hidden');
    // non-blocking notes (rule change 23 Oct 2026): party size never stops the request; reception coordinates
    if (room && adults > room.capacity + beds && bedsAutoNote.classList.contains('hidden')) {
      capNote.textContent =
        room.extra_beds_max === 0
          ? S.capacityNoBeds.replace('{capacity}', String(room.capacity))
          : S.capacityBeds.replace('{adults}', String(adults)).replace('{capacity}', String(room.capacity));
      capNote.classList.remove('hidden');
    }
    if (branchSel.value && !room) {
      const max = branchMaxAdults(data.rooms, branchSel.value);
      if (max && adults > max) {
        capNote.append(S.capacityBranch.replace('{max}', String(max)) + ' ');
        const a = document.createElement('a');
        a.href = data.partnersPath;
        a.className = 'font-semibold link-bronze underline';
        a.textContent = S.capacityBranchLink;
        capNote.append(a);
        capNote.classList.remove('hidden');
      }
    }
    if (touched.has('adults')) validateField('adults');
    if (touched.has('extra_beds')) validateField('extra_beds');

    const b = data.branches.find((x) => x.slug === branchSel.value);
    const breakfast = form.querySelector<HTMLInputElement>('input[name="breakfast"]:checked')?.value;
    const parts: string[] = [];
    if (b) parts.push(b.short);
    if (n) parts.push(plural(P.nights, n));
    if (adults) parts.push(plural(P.adults, adults));
    if (kids) parts.push(plural(P.children, kids));
    if (beds) parts.push(plural(S.bedsPlural, beds));
    if (breakfast) parts.push(breakfast === 'with' ? S.breakfastWith : S.breakfastWithout);
    summary.textContent = parts.join(' · ');
    summary.classList.toggle('hidden', !b);

    syncAges(kids, breakfast ?? '');
    scheduleQuote();
  }

  // ── children's ages (Q2): one select per child, shown only with children > 0 and breakfast = with ──────
  function syncAges(kids: number, breakfast: string) {
    const show = needsChildAges(kids, breakfast);
    agesWrap.classList.toggle('hidden', !show);
    if (!show) return;
    const current = Array.from(agesList.querySelectorAll<HTMLSelectElement>('select'));
    for (let i = current.length; i < kids; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'field field-select';
      const sel = document.createElement('select');
      sel.name = 'children_ages';
      sel.id = `${form.id}-age-${i}`;
      sel.autocomplete = 'off';
      sel.className = 'field-input w-full border border-line rounded bg-white';
      sel.setAttribute('aria-describedby', `${form.id}-children_ages-error`);
      const first = document.createElement('option');
      first.value = '';
      first.textContent = Q.age_choose;
      sel.append(first);
      for (let a = 0; a <= CHILD_AGE_MAX; a++) {
        const o = document.createElement('option');
        o.value = String(a);
        o.textContent = a === 0 ? Q.age_under1 : plural(Q.age_years, a);
        sel.append(o);
      }
      const label = document.createElement('label');
      label.htmlFor = sel.id;
      label.className = 'field-label';
      label.textContent = Q.age_label.replace('{n}', String(i + 1));
      sel.addEventListener('change', () => {
        touched.add('children_ages');
        validateField('children_ages');
        scheduleQuote();
      });
      wrap.append(sel, label);
      agesList.append(wrap);
    }
    while (agesList.children.length > kids) agesList.lastElementChild!.remove();
  }

  // ── room availability (phase 2a.1, dashboard «الغرف»): the static list is the build's snapshot; at runtime a room
  // turned off disappears (its selection clears to «أي غرفة متاحة» with the note) and a room turned on since the last
  // build is added to its branch's group, so the form follows the dashboard without waiting for the rebuild ──────
  const supa = { url: data.supabaseUrl, key: data.anonKey };
  const wanted = () => new URLSearchParams(location.search).get('room') || form.dataset.prefillRoom || '';
  siteRoomTypes(supa).then((rows) => {
    if (!rows) return;
    const groups = Array.from(roomSel.querySelectorAll<HTMLOptGroupElement>('optgroup'));
    let dropped = false;
    for (const r of rows) {
      const g = groups.find((x) => x.dataset.branch === r.branch);
      if (!g) continue;
      const opt = Array.from(g.querySelectorAll('option')).find((o) => o.value === r.slug);
      if (!r.bookable && opt) {
        if (opt.selected) dropped = true;
        opt.remove();
        data.rooms = data.rooms.filter((x) => !(x.slug === r.slug && x.branch === r.branch));
      } else if (r.bookable && !opt) {
        const o = document.createElement('option');
        o.value = r.slug;
        o.dataset.branch = r.branch;
        o.dataset.capacity = String(r.capacity);
        o.textContent = data.locale === 'ar' ? r.name_ar : r.name_en;
        g.append(o);
        data.rooms.push({ slug: r.slug, branch: r.branch, name: o.textContent, capacity: r.capacity, extra_beds_max: r.extra_beds_max, availability: 'available' });
        if (wanted() === r.slug && !roomSel.value) selectRoom(r.slug);
      }
    }
    if (dropped) {
      roomSel.selectedIndex = 0;
      roomNote.textContent = S.roomCleared;
      roomNote.classList.remove('hidden');
    }
    filterRooms();
    refresh();
  });

  // ── price quote (decision 4): quote_stay once a room type and both dates are set; debounced; stale answers
  // dropped; no price at all when the service is off, unreachable or the branch's switch is off ─────────────
  const Q = data.quote;
  const qBadge = quoteBox.querySelector<HTMLElement>('[data-quote-badge]')!;
  const qNote = quoteBox.querySelector<HTMLElement>('[data-quote-note]')!;
  const qTable = quoteBox.querySelector<HTMLElement>('[data-quote-table]')!;
  const qNights = quoteBox.querySelector<HTMLElement>('[data-quote-nights]')!;
  const qNightsList = quoteBox.querySelector<HTMLElement>('[data-quote-nights-list]')!;
  const qPay = quoteBox.querySelector<HTMLElement>('[data-quote-pay]')!;
  const qChanged = quoteBox.querySelector<HTMLElement>('[data-quote-changed]')!;
  const row = (k: string) => quoteBox.querySelector<HTMLTableRowElement>(`[data-quote-row="${k}"]`)!;
  let quoteSeq = 0;
  let quoteTimer: ReturnType<typeof setTimeout> | null = null;
  let quoteAbort: AbortController | null = null;
  /** the total the guest saw (sent as quoted_total; the server refuses to confirm on a different total) */
  let quotedTotal: number | null = null;
  let instant = false;
  const L = data.locale;

  function quoteParams() {
    const kids = Number(childrenIn.value || 0);
    const breakfast = (form.querySelector<HTMLInputElement>('input[name="breakfast"]:checked')?.value ?? '') as 'with' | 'without' | '';
    const ages = agesWrap.classList.contains('hidden') ? [] : Array.from(agesList.querySelectorAll<HTMLSelectElement>('select')).map((s) => s.value);
    const complete = !needsChildAges(kids, breakfast) || (ages.length === kids && ages.every((a) => a !== ''));
    return {
      branch: branchSel.value,
      room: roomSel.value,
      check_in: checkIn.value,
      check_out: checkOut.value,
      adults: Number(adultsIn.value || 0),
      children: kids,
      children_ages: complete && needsChildAges(kids, breakfast) ? ages.map(Number) : null,
      extra_beds: Number(bedsIn.value || 0),
      breakfast,
      promo_code: promoCode(),
    };
  }
  /** the typed code, upper case ('' = none, or not a well-formed code: the field error says so) */
  function promoCode(): string {
    const v = (promoIn?.value ?? '').trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9-]{2,19}$/.test(v) ? v : '';
  }
  const PROMO_OK = ['applied', 'better_offer', 'unpriced'];
  /** the promo line under the field: applied / a better offer / will be checked — or the reason it does not apply */
  function showPromo(state: { code: string; status: string } | null | undefined, offerTitle: string) {
    if (!promoIn || !promoStatus) return;
    const code = promoCode();
    promoState = state && state.code === code ? state.status : null;
    const ok = promoState !== null && PROMO_OK.includes(promoState);
    promoStatus.textContent = ok ? (Q.promo[promoState!] ?? '').replace('{title}', offerTitle) : '';
    promoStatus.classList.toggle('hidden', !ok || !promoStatus.textContent);
    if (promoState && !ok) showError('promo_code', Q.promo[promoState] ?? Q.promo.unknown);
    else if (!errorsNow().promo_code) showError('promo_code', null);
    if (promoState && code && lastPromoEvent !== `${code}|${promoState}`) {
      lastPromoEvent = `${code}|${promoState}`;
      const w = window as unknown as { dataLayer?: unknown[] };
      w.dataLayer = w.dataLayer || [];
      // the status (and the offer when one applies) — never the code itself
      w.dataLayer.push({ event: 'promo_applied', status: promoState, ...(promoState === 'applied' && promoOffer ? { offer_id: promoOffer } : {}) });
    }
  }
  let lastPromoEvent = '';
  let promoOffer = '';
  if (promoIn) {
    promoIn.addEventListener('input', () => {
      const pos = promoIn.selectionStart;
      promoIn.value = promoIn.value.toUpperCase();
      if (pos !== null) promoIn.setSelectionRange(pos, pos);
      promoState = null;
      promoStatus?.classList.add('hidden');
      showError('promo_code', null);
      scheduleQuote();
    });
    promoIn.addEventListener('blur', () => {
      if (!promoIn.value.trim()) return;
      touched.add('promo_code');
      validateField('promo_code');
    });
  }
  function setInstant(on: boolean) {
    instant = on;
    if (!sending) submitLabel.textContent = on ? Q.submit_instant : S.submit;
  }
  function hideQuote(note?: string) {
    quoteSeq++;
    quoteAbort?.abort();
    quotedTotal = null;
    setInstant(false);
    qTable.classList.add('hidden');
    qNights.classList.add('hidden');
    qPay.classList.add('hidden');
    qBadge.classList.add('hidden');
    qBadge.textContent = '';
    qChanged.classList.add('hidden');
    qNote.textContent = note ?? '';
    qNote.classList.toggle('hidden', !note);
    quoteBox.classList.toggle('hidden', !note);
  }
  function scheduleQuote() {
    if (quoteTimer) clearTimeout(quoteTimer);
    const p = quoteParams();
    const n = nightsNow();
    if (!supa.url || !supa.key || !p.branch || !n) return hideQuote();
    if (!p.room) return hideQuote(Q.pick_room);
    if (p.adults < 1) return hideQuote();
    quoteTimer = setTimeout(runQuote, 300);
  }
  async function runQuote() {
    const p = quoteParams();
    const seq = ++quoteSeq;
    quoteAbort?.abort();
    quoteAbort = new AbortController();
    qNote.textContent = Q.loading;
    qNote.classList.remove('hidden');
    quoteBox.classList.remove('hidden');
    const r = await quoteStay(supa, p, quoteAbort.signal);
    if (seq !== quoteSeq) return;
    renderQuote(r);
  }
  function renderQuote(r: QuoteResult | null) {
    qChanged.classList.add('hidden');
    promoOffer = r?.quote?.offer?.slug ?? '';
    showPromo(r?.promo, r?.quote?.offer ? (L === 'en' ? r.quote.offer.title_en : r.quote.offer.title_ar) : '');
    if (!r || !r.ok || !r.prices || !r.quote) {
      // off, unreachable or nothing priced: no price, the request flow as before (no reason shown unless set)
      hideQuote(r && r.ok && r.reason && r.reason !== 'instant_off' ? Q.unavailable : undefined);
      return;
    }
    const q = r.quote;
    const n = q.count;
    row('room').cells[0].textContent = Q.room_line.replace('{nights}', plural(P.nights, n));
    const prices = q.nights.map((x) => Number(x.price));
    const uniform = prices.every((x) => x === prices[0]);
    row('room').cells[1].textContent = q.room_total === null ? '—' : uniform ? `${n} × ${money(prices[0], L)} = ${money(q.room_total, L)}` : money(q.room_total, L);
    row('breakfast').classList.toggle('hidden', q.breakfast !== 'with');
    row('breakfast').cells[1].textContent = q.breakfast_total === null ? Q.ages_hint : money(q.breakfast_total, L);
    row('beds').classList.toggle('hidden', !(q.extra_beds > 0));
    row('beds').cells[0].textContent = Q.extra_beds_line.replace('{beds}', String(q.extra_beds));
    row('beds').cells[1].textContent = money(q.extra_beds_total, L);
    // an offer (applied by the server, never here): its name and discount, the total before it struck through
    const off = q.offer && Number(q.discount) > 0 ? q.offer : null;
    row('discount').classList.toggle('hidden', !off);
    row('discount').cells[0].textContent = off ? Q.offer_line.replace('{title}', L === 'en' ? off.title_en : off.title_ar) : '';
    row('discount').cells[1].textContent = off ? `− ${money(Number(q.discount), L)}` : '';
    if (off && q.total !== null && q.base_total != null) {
      const was = document.createElement('s');
      was.className = 'font-normal text-ink-muted me-2';
      was.setAttribute('aria-label', `${Q.base_total_line}: ${money(Number(q.base_total), L)}`);
      was.textContent = money(Number(q.base_total), L);
      const now = document.createElement('span');
      now.textContent = money(q.total, L);
      row('total').cells[1].replaceChildren(was, now);
    } else row('total').cells[1].textContent = q.total === null ? '—' : money(q.total, L);
    qNightsList.replaceChildren(
      ...q.nights.map((x) => {
        const li = document.createElement('li');
        li.className = 'flex justify-between gap-2';
        const label = (L === 'en' ? x.label_en : x.label) || '';
        li.innerHTML = `<span class="latin" dir="ltr">${x.night}</span><span>${money(Number(x.price), L)}${label ? ` — ${label}` : ''}</span>`;
        return li;
      }),
    );
    qNights.classList.toggle('hidden', uniform);
    qTable.classList.remove('hidden');
    qPay.classList.remove('hidden');
    qNote.classList.add('hidden');
    // breakfast for children cannot be priced without their ages: no total, no instant, the ages block asks for them
    const inst = r.instant && q.total !== null && !q.needs_ages;
    const reasonKey = q.needs_ages ? 'needs_ages' : r.reason;
    const lim = r.limits ?? {};
    const reason = reasonKey ? (Q.reasons[reasonKey] ?? '').replace('{n}', String(lim.max_nights ?? '')).replace('{time}', time12(String(lim.same_day_cutoff ?? ''), L)) : '';
    qBadge.textContent = inst ? Q.instant_badge : `${Q.request_badge}${reason ? ` — ${reason}` : ''}`;
    qBadge.className = `text-xs font-semibold rounded-full px-2.5 py-1 ${inst ? 'bg-midnight text-white' : 'border border-line bg-white text-ink'}`;
    qBadge.classList.remove('hidden');
    quotedTotal = q.total;
    setInstant(inst);
    quoteBox.classList.remove('hidden');
  }
  /** After a 409 price_changed: show the fresh quote and say so; the guest confirms again. */
  function showPriceChanged(q: Quote | null) {
    if (q) renderQuote({ ok: true, prices: true, instant, reason: null, quote: q });
    qChanged.classList.remove('hidden');
    quoteBox.scrollIntoView({ block: 'nearest' });
  }

  // ── WhatsApp hand-off with every field ───────────────────────────────────────────────────────────────
  /** wa.me link to the branch's number with every filled field, one line per field (form labels, page language);
      a line whose field is still empty (dates, breakfast, name, phone, email, notes) is left out. */
  function whatsappUrl(p: BookingInput): string {
    const b = data.branches.find((x) => x.slug === p.branch)!;
    const r = data.rooms.find((x) => x.slug === p.room && x.branch === p.branch);
    const n = nightsNow();
    const phone = p.phone ? (phoneToE164(p.phone, p.country || 'SA') ?? p.phone) : '';
    const vals: Record<string, string> = {
      branch: b.name,
      room: r ? r.name : S.anyRoom,
      check_in: p.check_in,
      check_out: p.check_out,
      nights: n ? plural(P.nights, n) : '',
      adults: String(p.adults || ''),
      children: String(p.children || '0'),
      extra_beds: String(p.extra_beds || '0'),
      breakfast: p.breakfast === 'with' ? S.breakfastWith : p.breakfast === 'without' ? S.breakfastWithout : '',
      name: p.name,
      phone,
      email: p.email ?? '',
      notes: p.notes ?? '',
      promo: (p.promo_code ?? '').toUpperCase(),
    };
    const msg = S.whatsappMessage
      .split('\n')
      .filter((line) => [...line.matchAll(/\{(\w+)\}/g)].every((m) => vals[m[1]]))
      .map((line) => line.replace(/\{(\w+)\}/g, (_, k: string) => vals[k] ?? ''))
      .join('\n');
    return `https://wa.me/${b.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
  }
  /** Hand-off validation: the branch is required; every other field is checked only once the guest filled it. */
  function validateFilled(): boolean {
    const errs = errorsNow();
    const filled = (f: string) => {
      if (f === 'branch' || f === 'adults' || f === 'extra_beds' || f === 'room') return true;
      if (f === 'breakfast') return !!form.querySelector('input[name="breakfast"]:checked');
      if (f === 'phone') return !!phoneIn.value.trim();
      if (dateBtn[f]) return !!(f === 'check_in' ? checkIn : checkOut).value;
      return !!(control(f) as HTMLInputElement | null)?.value.trim();
    };
    let first: HTMLElement | null = null;
    for (const f of FIELDS) {
      const code = errs[f] ?? (f === 'adults' ? errs.children : undefined);
      if (!filled(f)) {
        if (!touched.has(f)) showError(f, null);
        continue;
      }
      showError(f, code ? message(f, code) : null);
      if (code && !first) first = f === 'adults' ? adultsIn : f === 'extra_beds' ? bedsIn : control(f);
    }
    if (first) first.focus();
    return !first;
  }
  // Synchronous from click to window.open (no await): a popup opened later than the click is blocked. On mobile
  // wa.me hands over to the WhatsApp app. The current page is never navigated.
  waSend.addEventListener('click', () => {
    if (!validateFilled()) return;
    const p = collect();
    window.open(whatsappUrl(p), '_blank', 'noopener');
    const w = window as unknown as { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event: 'whatsapp_click', destination: p.branch, source: 'booking_form', page_path: location.pathname, page_location: location.href });
  });
  function showFallback(msg: string) {
    formError.textContent = msg;
    formError.classList.remove('hidden');
    waSend.scrollIntoView({ block: 'nearest' });
  }
  function setSending(on: boolean) {
    sending = on;
    submitBtn.disabled = on;
    submitBtn.setAttribute('aria-busy', String(on));
    spinner.classList.toggle('hidden', !on);
    submitLabel.textContent = on ? S.sending : instant ? Q.submit_instant : S.submit;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return; // no double submit
    formError.classList.add('hidden');
    await loadPhoneLib();
    if (!validateAll()) return;
    const p = collect();
    const r = validateBooking(p, ctx());
    if (!r.ok) return;
    const d = r.data;
    if (promoIn && d.promo_code && promoState && !PROMO_OK.includes(promoState)) {
      showError('promo_code', Q.promo[promoState] ?? Q.promo.unknown);
      promoIn.focus();
      return;
    }
    if (!data.endpoint) {
      // no endpoint configured for this build → point to the WhatsApp hand-off, never a silent failure
      // (no window.open here: after the await above a popup would be blocked)
      showFallback(S.errors.server);
      return;
    }
    setSending(true);
    let leaving = false;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (data.anonKey) {
        headers['Authorization'] = `Bearer ${data.anonKey}`;
        headers['apikey'] = data.anonKey;
      }
      const marketing = Boolean(form.querySelector<HTMLInputElement>('[data-marketing-consent]')?.checked);
      const body = {
        locale: data.locale,
        branch: d.branch,
        room: d.room,
        check_in: d.check_in,
        check_out: d.check_out,
        adults: String(d.adults),
        children: String(d.children),
        children_ages: d.children_ages.map(String),
        extra_beds: String(d.extra_beds),
        breakfast: d.breakfast,
        name: d.name,
        phone: d.phone,
        country: p.country,
        email: d.email,
        notes: d.notes,
        website: String(new FormData(form).get('website') ?? ''),
        page: location.href,
        // the total the guest saw (null without a quote): the server confirms only on the same total
        quoted_total: quotedTotal === null ? null : String(quotedTotal),
        // the offer's code (the server applies the offer, never the browser)
        ...(d.promo_code ? { promo_code: d.promo_code } : {}),
        // the marketing consent (3 Nov 2026): recorded with the version of the text the form showed
        marketing_consent: marketing,
        ...(marketing ? { consent_version: data.consentVersion } : {}),
        // the visit's first-touch source (3 Nov 2026, part G): no personal data (src/lib/visit.ts)
        ...(firstTouch() ? { visit: firstTouch() } : {}),
      };
      // Cloudflare Turnstile (content/turnstile.json — src/lib/turnstile.ts): a fresh token per submission
      const ts = await turnstileToken(form);
      if (ts !== null) (body as Record<string, unknown>).turnstile_token = ts;
      const res = await fetch(data.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; ref?: string; error?: string; status?: string; reason?: string | null; quote?: Quote | null; whatsapp_sent?: boolean; eyab_invite?: string; fields?: Record<string, string> };
      if (res.status === 422 && json.fields?.promo_code && promoIn) {
        // the code does not apply to this request (the database decided): say why, next to the field
        const why = json.fields.promo_code;
        promoState = why;
        showError('promo_code', Q.promo[why] ?? Q.promo.unknown);
        promoIn.focus();
        return;
      }
      if (res.status === 409 && json.status === 'price_changed') {
        // nothing was stored: show the current price, the guest confirms again
        showPriceChanged(json.quote ?? null);
        return;
      }
      if (!res.ok || !json.ok || !json.ref) throw new Error(json.error || `HTTP ${res.status}`);
      const confirmed = json.status === 'confirmed';
      const params = new URLSearchParams({
        ref: json.ref,
        branch: d.branch,
        room: d.room || 'any',
        nights: String(d.nights),
        breakfast: d.breakfast,
        beds: String(d.extra_beds),
        nc: d.needs_coordination ? '1' : '0',
        c: d.email ? 'email' : 'whatsapp',
        // the marketing box was ticked: the success page leaves out the club link
        mc: marketing ? '1' : '0',
        s: confirmed ? 'confirmed' : 'request',
        ...(json.reason && !confirmed ? { reason: json.reason } : {}),
        // YCloud accepted the guest's WhatsApp message: the success page says so (task 5 A)
        ...(json.whatsapp_sent ? { wa: '1' } : {}),
      });
      // the breakdown travels in sessionStorage (never in the URL): the success page renders it once
      try {
        if (confirmed && json.quote) {
          const roomName = data.rooms.find((x) => x.slug === d.room && x.branch === d.branch)?.name ?? '';
          sessionStorage.setItem(`armada_confirmed_${json.ref}`, JSON.stringify({ quote: json.quote, room: roomName, branch: d.branch, check_in: d.check_in, check_out: d.check_out, adults: d.adults, children: d.children, breakfast: d.breakfast, extra_beds: d.extra_beds }));
        }
        // «انضم إلى إياب» (9 Nov 2026): the booking's signed invite (no personal data) for the success page's card;
        // absent for a member or a ticked box
        if (typeof json.eyab_invite === 'string') sessionStorage.setItem(`armada_invite_${json.ref}`, json.eyab_invite);
      } catch {
        /* storage unavailable: the success page shows the ref and the generic text */
      }
      leaving = true;
      location.assign(`${data.successPath}?${params.toString()}`);
    } catch {
      showFallback(S.errors.server);
    } finally {
      if (!leaving) setSending(false);
    }
  });

  const q = new URLSearchParams(location.search);
  prefill({ branch: q.get('branch'), room: q.get('room'), check_in: q.get('check_in'), check_out: q.get('check_out'), promo: q.get('promo') });
  form.addEventListener('booking:prefill', (e) => prefill((e as CustomEvent<Prefill>).detail || {}));
  refresh();
  // last line: the drawer opens this form only once it is ready (src/lib/drawer.ts); `booking:ready` tells a drawer
  // that was asked to open while this code was still arriving (9 Nov 2026)
  form.setAttribute('data-booking-ready', '');
  form.dispatchEvent(new CustomEvent('booking:ready'));
}

/** Start one booking form: its date fields first, then the form (prefill writes the dates the picker shows). */
export function startBookingForm(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>('[data-daterange]').forEach((root) => {
    if (bindOnce(root)) initDateRange(root);
  });
  initForm(form);
}
