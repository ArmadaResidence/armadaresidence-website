/**
 * /partners/enquiry/ — the legacy three-step wizard (moved here from public/legacy/partners.js on 26 Oct 2026 so it
 * can share the booking form's rules). Same steps, buttons and fallbacks as before; what changed:
 *   - contact fields follow supabase/functions/booking-request/rules.ts (the Edge Function runs the same checks):
 *     company (letters required, ≥ 2), contact name (validName), phone (libphonenumber-js → E.164, Saudi Arabia for
 *     national numbers), email; inline messages with aria-invalid / aria-describedby, on blur and on Continue / send;
 *   - the draft (localStorage) is never restored silently: a notice «استعدنا بيانات أدخلتها سابقًا» with
 *     «مسح البيانات»; a draft expires 7 days after its last edit and is deleted after a successful submit. The
 *     unversioned draft of the old script (no timestamp, restored silently) is deleted unread.
 * The URL parameters (?request= / property= / biz= / guests= / rooms=, from /offers and the rooming calculator) still
 * preselect the request; they never carry personal data.
 */
import { E164, riyadhToday, validEmail, validName, validOrganisation, type FieldError } from '../../supabase/functions/booking-request/rules.ts';

export const DRAFT_KEY = 'armada_b2b_enquiry_v2';
const OLD_DRAFT_KEYS = ['armada_b2b_enquiry_v1'];
export const DRAFT_TTL_MS = 7 * 86400000;
/** never saved in a draft: the honeypot */
const NOT_SAVED = new Set(['website']);

interface Draft {
  saved_at: number;
  fields: Record<string, string>;
}
interface Strings {
  required: string;
  organisation: string;
  name: string;
  phone: string;
  email: string;
}
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

type PhoneLib = typeof import('libphonenumber-js/min');
let phoneLib: PhoneLib | null = null;
let phoneLibLoading: Promise<PhoneLib | null> | null = null;
/** libphonenumber-js (min metadata) is loaded on first interaction, not with the page (as in the booking form). */
function loadPhoneLib(): Promise<PhoneLib | null> {
  if (phoneLib) return Promise.resolve(phoneLib);
  phoneLibLoading ??= import('libphonenumber-js/min')
    .then((m) => (phoneLib = m))
    .catch(() => null);
  return phoneLibLoading;
}

/** ٠١٢… / ۰۱۲… → 0-9 */
const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));

/** E.164 for a number typed with +/00 (any country) or in the Saudi national form. */
function phoneToE164(raw: string): string | null {
  const v = latinDigits(raw).replace(/[\s\-().]/g, '').replace(/^00/, '+');
  if (!v) return null;
  if (phoneLib) {
    const n = v.startsWith('+') ? phoneLib.parsePhoneNumberFromString(v) : phoneLib.parsePhoneNumberFromString(v, 'SA');
    return n && n.isValid() ? n.number : null;
  }
  // library not loaded (offline): the server still validates the number
  return E164.test(v) ? v : null;
}

function readDraft(): Draft | null {
  try {
    OLD_DRAFT_KEYS.forEach((k) => localStorage.removeItem(k));
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    const age = Date.now() - Number(d?.saved_at);
    if (!d || typeof d.fields !== 'object' || !Number.isFinite(age) || age < 0 || age > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}
function deleteDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked */
  }
}

export function initEnquiry(): void {
  const form = document.querySelector<HTMLFormElement>('#enquiry-form');
  if (!form || form.hasAttribute('data-enquiry-bound')) return;
  form.setAttribute('data-enquiry-bound', '');

  const IS_AR = document.documentElement.lang === 'ar';
  let BOOT: { i18n?: Record<string, string>; cfg?: Record<string, string> } = {};
  try {
    BOOT = JSON.parse(document.getElementById('armada-partners-cfg')!.textContent || '{}');
  } catch {
    BOOT = {};
  }
  const T = BOOT.i18n || {};
  const CFG = BOOT.cfg || {};
  const S = JSON.parse(form.querySelector('[data-enquiry-strings]')?.textContent || '{}') as Strings;
  const $ = <E extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<E>(s);
  const $$ = <E extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<E>(s)];
  const field = (name: string) => form.elements.namedItem(name) as Field | null;
  const fsteps = $$('.fstep', form);
  const psteps = $$('.pstep', form);
  const notice = $('[data-draft-notice]', form)!;
  let stepIdx = 0;

  // ── URL preselection (non-personal) ──────────────────────────────────────────────────────────────────
  function paramPrefill() {
    const q = new URLSearchParams(location.search);
    const map: Record<string, string> = { property: 'property', request: 'reqtype', biz: 'biztype' };
    Object.keys(map).forEach((k) => {
      const v = q.get(k);
      const el = field(map[k]);
      if (v && el) el.value = v;
    });
    ['guests', 'rooms'].forEach((k) => {
      const v = q.get(k);
      const el = field(k);
      if (v && el && !el.value) el.value = v;
    });
  }

  // ── draft ───────────────────────────────────────────────────────────────────────────────────────────
  let restoring = false;
  const dateInputs = () => $$<HTMLInputElement>('[data-dr-value]', form);
  function saveDraft() {
    if (restoring || form!.hidden) return;
    const fields: Record<string, string> = {};
    $$<Field>('input,select,textarea', form).forEach((el) => {
      if (el.name && !NOT_SAVED.has(el.name) && el.value.trim()) fields[el.name] = el.value;
    });
    try {
      if (Object.keys(fields).length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ saved_at: Date.now(), fields } satisfies Draft));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* private mode */
    }
  }
  function restoreDraft() {
    const d = readDraft();
    if (!d) return;
    let restored = 0;
    restoring = true;
    Object.keys(d.fields).forEach((k) => {
      const el = field(k);
      if (!el || NOT_SAVED.has(k) || el.value || typeof d.fields[k] !== 'string') return;
      el.value = d.fields[k];
      // the calendar picker re-reads its hidden inputs on change (and drops a past date from an old draft)
      if (el.hasAttribute('data-dr-value')) el.dispatchEvent(new Event('change', { bubbles: true }));
      if (el.value) restored++;
    });
    restoring = false;
    if (restored) notice.hidden = false;
  }
  function clearDraft() {
    deleteDraft();
    restoring = true;
    form!.reset();
    // hidden inputs keep their value through reset(): clear the dates and let the picker repaint
    dateInputs().forEach((el) => {
      el.value = '';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    restoring = false;
    paramPrefill();
    $$('.fld.bad', form).forEach((f) => f.classList.remove('bad'));
    $$('[aria-invalid]', form).forEach((e) => e.setAttribute('aria-invalid', 'false'));
    touched.clear();
    hideError();
    notice.hidden = true;
    stepIdx = 0;
    paintSteps();
    field('company')?.focus();
  }

  // ── steps ───────────────────────────────────────────────────────────────────────────────────────────
  function paintSteps() {
    fsteps.forEach((s, i) => s.classList.toggle('on', i === stepIdx));
    psteps.forEach((p, i) => {
      p.classList.toggle('on', i === stepIdx);
      p.classList.toggle('done', i < stepIdx);
    });
    const last = stepIdx === fsteps.length - 1;
    const back = $('.f-back', form!);
    const next = $('.f-next', form!);
    if (back) back.style.display = stepIdx === 0 ? 'none' : '';
    if (next) next.style.display = last ? 'none' : '';
    ['.f-send', '.f-wa', '.f-mail'].forEach((s) => {
      const b = $(s, form!);
      if (b) b.style.display = last ? '' : 'none';
    });
  }

  // ── validation (rules.ts; the Edge Function re-runs the same checks) ─────────────────────────────────
  const CONTACT = ['company', 'person', 'email', 'phone'];
  const touched = new Set<string>();
  function errorOf(el: Field): FieldError | null {
    const v = el.value.trim();
    if (!v) return el.required ? 'required' : null;
    switch (el.name) {
      case 'company':
        return validOrganisation(v) ? null : 'organisation';
      case 'person':
        return validName(v.replace(/\s+/g, ' ')) ? null : 'name';
      case 'email':
        return validEmail(v) ? null : 'email';
      case 'phone':
        return phoneToE164(v) ? null : 'phone';
      // dates come from the calendar picker (hidden ISO inputs): no past arrival, departure after arrival
      case 'checkin':
        return /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= riyadhToday() ? null : 'past';
      case 'checkout':
        return /^\d{4}-\d{2}-\d{2}$/.test(v) && v > (field('checkin')?.value || '') ? null : 'dates';
      case 'guests':
        return /^\d+$/.test(v) && Number(v) >= 1 ? null : 'required';
    }
    return null;
  }
  function showFieldError(el: Field, err: FieldError | null) {
    const fld = el.closest('.fld');
    fld?.classList.toggle('bad', !!err);
    if (el.type !== 'hidden') el.setAttribute('aria-invalid', err ? 'true' : 'false');
    // the contact fields carry their own message; the other fields keep the legacy «هذا الحقل مطلوب»
    const msg = CONTACT.includes(el.name) ? document.getElementById(`${el.id}-err`) : null;
    if (msg && err) msg.textContent = (S as unknown as Record<string, string>)[err] ?? S.required;
  }
  /** Validates one step; returns the first invalid control (to focus once its step is shown). */
  async function validateStep(i: number): Promise<HTMLElement | null> {
    const els = $$<Field>('[required]', fsteps[i]);
    if (els.some((el) => el.name === 'phone')) await loadPhoneLib();
    let first: HTMLElement | null = null;
    for (const el of els) {
      const err = errorOf(el);
      showFieldError(el, err);
      if (err) touched.add(el.name);
      if (err && !first) first = el.type === 'hidden' ? ($('[data-dr-trigger]', el.closest('.fld') ?? form!) ?? el) : el;
    }
    return first;
  }
  async function validateAll(): Promise<boolean> {
    for (let i = 0; i < fsteps.length; i++) {
      const bad = await validateStep(i);
      if (bad) {
        stepIdx = i;
        paintSteps();
        bad.focus();
        return false;
      }
    }
    return true;
  }

  // ── sending ─────────────────────────────────────────────────────────────────────────────────────────
  function labelFor(name: string) {
    const el = field(name);
    const lab = el?.closest('.fld')?.querySelector('label');
    return lab ? (lab.textContent || '').replace('*', '').trim() : name;
  }
  function readableValue(name: string) {
    const el = field(name);
    if (!el) return '';
    if (el instanceof HTMLSelectElement && el.selectedIndex >= 0) {
      const o = el.options[el.selectedIndex];
      return o && o.value ? (o.textContent || '').trim() : '';
    }
    return (el.value || '').trim();
  }
  function buildMessage() {
    const order = ['company', 'person', 'email', 'phone', 'country', 'biztype', 'reqtype', 'property', 'checkin', 'checkout', 'guests', 'rooms', 'unittype', 'meals', 'notes'];
    const lines = [T.waIntro || 'New B2B enquiry', ''];
    order.forEach((n) => {
      const v = n === 'phone' ? phoneToE164(readableValue(n)) || readableValue(n) : readableValue(n);
      if (v) lines.push(`${labelFor(n)}: ${v}`);
    });
    lines.push('', (IS_AR ? 'أُرسل من ' : 'Sent from ') + location.origin + location.pathname);
    return lines.join('\n');
  }
  function showError(msg: string) {
    const e = $('#enquiry-error');
    if (!e) return;
    e.textContent = msg;
    e.style.display = 'block';
  }
  function hideError() {
    const e = $('#enquiry-error');
    if (e) e.style.display = 'none';
  }
  async function sendVia(channel: 'wa' | 'mail') {
    if (!(await validateAll())) return;
    const msg = buildMessage();
    if (channel === 'wa') {
      window.open(`https://wa.me/${CFG.phone}?text=${encodeURIComponent(msg)}`, '_blank');
    } else {
      const subj = `${T.waIntro || 'B2B enquiry'} — ${readableValue('company')}`;
      location.href = `mailto:${CFG.sales}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(msg)}`;
    }
  }
  function payload() {
    const v = (n: string) => (field(n)?.value || '').trim();
    const extra: string[] = [];
    if (v('biztype')) extra.push(`${labelFor('biztype')}: ${readableValue('biztype')}`);
    if (v('country')) extra.push(`${labelFor('country')}: ${v('country')}`);
    if (v('unittype')) extra.push(`${labelFor('unittype')}: ${v('unittype')}`);
    if (v('notes')) extra.push(v('notes'));
    return {
      locale: CFG.locale || (IS_AR ? 'ar' : 'en'),
      request_type: v('reqtype'),
      organisation: v('company').replace(/\s+/g, ' '),
      branch: v('property') || 'both',
      check_in: v('checkin'),
      check_out: v('checkout'),
      adults: v('guests'),
      children: '0',
      rooms: v('rooms'),
      meals: v('meals'),
      room: '',
      name: v('person').replace(/\s+/g, ' '),
      phone: phoneToE164(v('phone')) || v('phone'),
      email: v('email'),
      notes: extra.join('\n').slice(0, 1000),
      website: v('website'),
      page: location.href,
    };
  }
  async function sendToOffice() {
    hideError();
    if (!(await validateAll())) return;
    if (!CFG.endpoint) {
      showError(T.sendFail || '');
      sendVia('wa');
      return;
    }
    const btn = $<HTMLButtonElement>('.f-send', form!);
    if (btn) btn.disabled = true;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (CFG.anonKey) {
      headers.Authorization = `Bearer ${CFG.anonKey}`;
      headers.apikey = CFG.anonKey;
    }
    const body = payload();
    try {
      const r = await fetch(CFG.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const res = await r.json().catch(() => null);
      if (!r.ok || !res || !res.ok || !res.ref) throw new Error('send failed');
      deleteDraft();
      const box = $('#enquiry-sent')!;
      $('#enquiry-sent-title')!.textContent = T.sentTitle || '';
      $('#enquiry-sent-body')!.textContent = T.sentBody || '';
      $('#enquiry-sent-ref-label')!.textContent = T.sentRef || '';
      $('#enquiry-sent-ref')!.textContent = res.ref;
      box.hidden = false;
      form!.hidden = true;
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const w = window as unknown as { dataLayer?: unknown[] };
      w.dataLayer = w.dataLayer || [];
      w.dataLayer.push({ event: 'partner_enquiry', request_type: body.request_type, branch: body.branch, booking_ref: res.ref });
    } catch {
      showError(T.sendFail || '');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── wiring ──────────────────────────────────────────────────────────────────────────────────────────
  paramPrefill();
  restoreDraft();
  paintSteps();
  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);
  form.addEventListener('focusin', () => void loadPhoneLib(), { once: true });
  $('[data-draft-clear]', form)?.addEventListener('click', clearDraft);
  $('.f-next', form)?.addEventListener('click', async () => {
    const bad = await validateStep(stepIdx);
    if (bad) return bad.focus();
    stepIdx = Math.min(stepIdx + 1, fsteps.length - 1);
    paintSteps();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('.f-back', form)?.addEventListener('click', () => {
    stepIdx = Math.max(stepIdx - 1, 0);
    paintSteps();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // pointerdown comes before the field's blur (also where a tapped button takes no focus, as in iOS Safari)
  let navPressed = false;
  const fnav = $('.fnav', form);
  fnav?.addEventListener('pointerdown', () => (navPressed = true));
  ['pointerup', 'pointercancel'].forEach((t) => window.addEventListener(t, () => setTimeout(() => (navPressed = false), 0)));
  $$<Field>('.fld input, .fld select', form).forEach((el) => {
    el.addEventListener('input', () => {
      if (CONTACT.includes(el.name)) touched.add(el.name);
      // while typing, an error only clears (a new one waits for blur / Continue)
      if (el.closest('.fld')?.classList.contains('bad') && !errorOf(el)) showFieldError(el, null);
      else if (!CONTACT.includes(el.name)) el.closest('.fld')?.classList.remove('bad');
    });
    if (CONTACT.includes(el.name)) {
      el.addEventListener('blur', async (e) => {
        // leaving the field by pressing a wizard button: that button validates; a message shown now would shift the
        // button under the finger and the tap would miss it
        if (navPressed || (e.relatedTarget as Element | null)?.closest?.('.fnav')) return;
        if (!touched.has(el.name)) return;
        if (el.name === 'phone') await loadPhoneLib();
        showFieldError(el, errorOf(el));
      });
    }
  });
  $('.f-wa', form)?.addEventListener('click', (e) => {
    e.preventDefault();
    void sendVia('wa');
  });
  $('.f-mail', form)?.addEventListener('click', (e) => {
    e.preventDefault();
    void sendVia('mail');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void sendToOffice();
  });
}
