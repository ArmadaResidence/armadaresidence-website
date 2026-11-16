/**
 * Guest Hub H6c «الفريق والتقارير» (15 Nov 2026, Ahmed — DECISIONS.md 2026-11-15 «Guest Hub H6c»). Pure TypeScript with
 * erasable syntax only (no I/O): wa-automation and hub-agent use it; scripts/hub-team-check.mjs tests it under Node.
 *   - the staff alert hub_staff_alert: its line «المطلوب» ({{5}}: the model's, checked here — summaryOk — or the code's
 *     own line from the hand-off reason), the booking ref or room ({{4}}), the five variables and the URL button ?hub_c=;
 *   - the daily report hub_daily_report: the eleven lines «المطار X · الشفا Y» from the stored figures, the button ?hub_r=;
 *   - a template's body as YCloud stores it, compared with templates.md (hub-templates.json) before the first use;
 *   - the colleague chat of a staff or report number: the user message (prompts.md §9) and its guard (staffGuard —
 *     emoji and dialect allowed, never a phone, an email, a foreign link or a number the FACTS do not hold);
 *   - the shift rule (slotCovers — the SQL internal.hub_slot_covers's twin) and «عودة المساعد» (humanPhase — the SQL
 *     internal.hub_human_phase's twin).
 * Never logs a guest's words, name or number.
 */
import defs from './hub-templates.json' with { type: 'json' };
import text from './text.generated.json' with { type: 'json' };
import { isTeach as teachCommand, learnedLine } from './learn.ts';
import { departureFaults, departuresText } from './departures.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

export const HUB_STAFF_ALERT = 'hub_staff_alert';
export const HUB_DAILY_REPORT = 'hub_daily_report';
export const ADMIN_ORIGIN = 'https://admin.armadaresidence.com';
// deno-lint-ignore no-explicit-any
export const STAFF_TEMPLATE_DEFS = defs as any;
// deno-lint-ignore no-explicit-any
const STAFF_COPY = (text as any).staff as { fallback: { ar: string; en: string } };

/** WhatsApp refuses a variable with a newline, a tab or more than four spaces in a row (and an empty one) */
export const oneLine = (s: unknown, max = 200): string => {
  const t = String(s ?? '').replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// ═══ {{5}} «المطلوب» ═══

/** the code's own line from the hand-off reason — when the model's line is refused or unavailable */
export const REASON_LINES: Record<string, string> = {
  no_source: 'سؤال لم نجد إجابته في المعرفة المعتمدة',
  complaint: 'شكوى من الضيف',
  human_request: 'يطلب التحدث مع موظف',
  staff_request: 'طلب خدمة يحتاج الاستقبال',
  booking_change: 'تعديل حجز أو إلغاؤه',
  cancel_booking: 'يريد إلغاء حجزه',
  media: 'أرسل صورة أو رسالة صوتية أو ملفًا',
  multi_room: 'حجز أكثر من غرفة',
  group_request: 'طلب مجموعة',
  hall_request: 'طلب القاعة',
  early_extension: 'وصول مبكر أو تمديد إقامة',
  model_error: 'رسالة لم يتمكن المساعد من الرد عليها',
  engine_error: 'رسالة لم يتمكن المساعد من الرد عليها',
  rate_limit: 'رسائل كثيرة متتالية',
  guard: 'رسالة تحتاج رد الفريق',
  unclear: 'رسالة غير واضحة',
  failed_understanding: 'رسالة غير واضحة',
  third_language: 'رسالة بلغة غير العربية والإنجليزية',
  prices_hidden: 'يسأل عن السعر',
  no_quote: 'يسأل عن السعر أو التوافر لتواريخ محددة',
  always_handoff: 'موضوع يرد عليه الفريق دائمًا',
  compensation: 'يطلب تعويضًا',
  booking_status: 'يسأل عن حالة حجز',
  dining_order: 'طلب طعام',
  order_status: 'يسأل عن حالة طلب',
  table_booking: 'حجز طاولة',
  book_error: 'تعذّر إتمام حجز',
};
export const reasonLine = (reason: string | null | undefined): string => REASON_LINES[String(reason ?? '')] ?? 'محادثة تحتاج رد الاستقبال';

const DIGITS = /[0-9٠-٩]+/g;
const westDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** the model's line passes when it is one Arabic line of ≤ 120 characters with no link, email or number the guest's
 *  messages and the hand-off line do not hold, and no forbidden word */
export function summaryOk(line: string, sources: string[], forbidden: string[] = []): boolean {
  const s = String(line ?? '').trim().replace(/^["«“']+|["»”']+$/g, '').trim();
  if (!s || s.length > 120 || /[\r\n]/.test(s)) return false;
  if (!/[؀-ۿ]/.test(s)) return false;
  if (/https?:|www\.|@|\.com\b/i.test(s)) return false;
  const src = westDigits(sources.join(' '));
  for (const d of westDigits(s).match(DIGITS) ?? []) if (!src.includes(d)) return false;
  const low = s.toLowerCase();
  return !forbidden.some((w) => w && low.includes(String(w).toLowerCase()));
}
export const cleanSummary = (line: string): string => String(line ?? '').trim().replace(/^["«“']+|["»”']+$/g, '').trim();

/** the user message of the alert line (prompts.md §8) */
export function summaryUser(handoffLine: string, guestMessages: string[]): string {
  return `HANDOFF: ${oneLine(handoffLine, 300)}\nGUEST_MESSAGES:\n${guestMessages.map((m) => `- ${oneLine(m, 500)}`).join('\n') || '- (none)'}`;
}

// ═══ {{4}} the booking ref or the room ═══
const REF_RE = /\bAR-[0-9]{8}-[A-Z0-9]{4}\b/i;
const ROOM_RE = /(?:غرفة|غرفتي|الغرفة|شقة|شقتي|الشقة|جناح|room|apartment|suite)\s*(?:رقم|no\.?|number|#)?\s*([0-9٠-٩]{2,5})/i;
/** what the guest gave: a booking ref (the understanding's, or one in the text), else a room or apartment number */
export function refOrRoom(bookingRef: string | null | undefined, texts: string[]): string | null {
  const all = texts.join(' ');
  const r = bookingRef && REF_RE.test(bookingRef) ? bookingRef : REF_RE.exec(all)?.[0] ?? null;
  if (r) return r.toUpperCase();
  const m = ROOM_RE.exec(all);
  return m ? `غرفة ${westDigits(m[1])}` : null;
}

// ═══ the templates ═══
/** the guest's phone as the site writes it: a Saudi mobile spaced (+966 5X XXX XXXX), anything else as E.164 */
export function phoneText(e164: string | null | undefined): string {
  const p = String(e164 ?? '');
  const m = /^\+9665([0-9])([0-9]{3})([0-9]{4})$/.exec(p);
  return m ? `+966 5${m[1]} ${m[2]} ${m[3]}` : p || 'غير معروف';
}

export interface TemplatePayload {
  from: string;
  to: string;
  type: 'template';
  externalId?: string;
  template: { name: string; language: { code: 'ar' | 'en' }; components: Json[] };
}
const E164 = /^\+[1-9][0-9]{7,14}$/;

function templatePayload(name: string, from: string, to: string, vars: string[], buttonSuffix: string, externalId?: string): TemplatePayload {
  if (!E164.test(from) || !E164.test(to)) throw new Error(`${name}: from / to must be E.164`);
  const def = STAFF_TEMPLATE_DEFS[name];
  if (!def) throw new Error(`${name}: no definition`);
  if (vars.length !== def.variables.length) throw new Error(`${name}: ${def.variables.length} variables, ${vars.length} given`);
  const v = vars.map((x) => oneLine(x, 1000));
  if (v.some((x) => !x)) throw new Error(`${name}: an empty variable`);
  if (!/^[0-9a-zA-Z-]{1,64}$/.test(buttonSuffix)) throw new Error(`${name}: the button's suffix`);
  return {
    from, to, type: 'template', ...(externalId ? { externalId } : {}),
    template: {
      name, language: { code: 'ar' },
      components: [
        { type: 'body', parameters: v.map((x) => ({ type: 'text', text: x })) },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: buttonSuffix }] },
      ],
    },
  };
}

export interface AlertItem {
  token: string;
  branch_name: string;
  guest_name: string | null;
  guest_phone: string | null;
  ref: string | null;
  summary: string | null;
  reason: string | null;
}
/** hub_staff_alert's five variables (templates.md §4), one line each */
export function alertVars(a: AlertItem): string[] {
  return [
    oneLine(a.branch_name, 80),
    oneLine(a.guest_name || 'ضيف', 60),
    phoneText(a.guest_phone),
    oneLine(a.ref || 'غير معروف', 40),
    oneLine(a.summary && cleanSummary(a.summary) ? cleanSummary(a.summary) : reasonLine(a.reason), 120),
  ];
}
export const alertPayload = (from: string, to: string, a: AlertItem, externalId?: string) => templatePayload(HUB_STAFF_ALERT, from, to, alertVars(a), a.token, externalId);
export const alertLink = (token: string) => `${ADMIN_ORIGIN}/?hub_c=${token}`;

// ═══ the daily report ═══
const BR = ['airport-road', 'shafa-road'] as const;
const SHORT: Record<string, string> = { 'airport-road': 'المطار', 'shafa-road': 'الشفا' };
const n = (x: unknown) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : 0);
/** «المطار X · الشفا Y» */
export const perBranch = (data: Json, key: string, fmt: (v: unknown) => string = (v) => String(n(v))): string =>
  BR.map((b) => `${SHORT[b]} ${fmt(data?.branches?.[b]?.[key])}`).join(' · ');
/** a count of minutes in Arabic (Western digits): «دقيقة واحدة» · «دقيقتان» · «3 دقائق» · «12 دقيقة»; none → «—» */
export function minutesText(v: unknown): string {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—';
  const m = n(v);
  if (m === 0) return 'أقل من دقيقة';
  if (m === 1) return 'دقيقة واحدة';
  if (m === 2) return 'دقيقتان';
  if (m <= 10) return `${m} دقائق`;
  return `${m} دقيقة`;
}
/** DD/MM/YYYY of an ISO day */
export const dayText = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
};
/** {{11}}: the faults as one short line, or «لا يوجد» */
export function faultsText(data: Json): string {
  const sum = (k: string) => BR.reduce((a, b) => a + n(data?.branches?.[b]?.[k]), 0);
  const parts: string[] = [];
  const model = sum('model_failures');
  const send = sum('send_failures');
  const budget = n(data?.budget_alerts);
  // 15 Nov 2026 (Ahmed): a staff alert or a report refused or failed is a fault too
  const refused = sum('staff_refused') + n(data?.reports_refused);
  if (model) parts.push(`فشل النموذج ${model}`);
  if (send) parts.push(`فشل الإرسال ${send}`);
  // H7: the voice notes and images that failed (download, transcription, an empty or unknown-language note, the vision call)
  const voice = sum('voice_failures');
  const image = sum('image_failures');
  if (voice) parts.push(`فشل الصوت ${voice}`);
  if (image) parts.push(`فشل الصور ${image}`);
  if (refused) parts.push(`رسائل للفريق لم تُرسل ${refused}`);
  if (budget) parts.push(`تنبيه الميزانية ${budget}`);
  // H9: a missing evening list, checks too late to send, sends held back by the shared limit
  parts.push(...departureFaults(data));
  return parts.length ? parts.join(' · ') : 'لا يوجد';
}
/** hub_daily_report's eleven variables (templates.md §5) — never money */
export function reportVars(day: string, data: Json): string[] {
  return [
    dayText(day),
    perBranch(data, 'conversations'),
    perBranch(data, 'assistant'),
    perBranch(data, 'handed'),
    perBranch(data, 'reply_avg_min', minutesText),
    perBranch(data, 'bookings'),
    // H9: «الخروج أو التمديد» — per branch «خروج X · تمديد Y · لم يرد Z», or «لم يُفعَّل بعد»
    departuresText(data),
    perBranch(data, 'reviews'),
    perBranch(data, 'unanswered'),
    // H7b: the facts learned that day, numbered for «امسح N», and what needs Ahmed's decision (learn.ts → learnedLine)
    learnedLine(data),
    faultsText(data),
  ];
}
export const reportPayload = (from: string, to: string, day: string, data: Json, externalId?: string) =>
  templatePayload(HUB_DAILY_REPORT, from, to, reportVars(day, data), String(day).slice(0, 10), externalId);
export const reportLink = (day: string) => `${ADMIN_ORIGIN}/?hub_r=${String(day).slice(0, 10)}`;

// ═══ a template's body as YCloud stores it ═══
/** YCloud's template item → {status, body} (the BODY component's text) */
export function ycloudTemplate(item: Json): { name: string; language: string; status: string; category: string | null; body: string | null } {
  const comps = Array.isArray(item?.components) ? item.components : [];
  const body = comps.find((c: Json) => String(c?.type ?? '').toUpperCase() === 'BODY')?.text ?? null;
  return { name: String(item?.name ?? ''), language: String(item?.language ?? ''), status: String(item?.status ?? '').toUpperCase(), category: item?.category ?? null, body: body === null ? null : String(body) };
}
const norm = (s: string) => String(s ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
/** the body read back equals templates.md's (spaces and line ends aside) */
export const bodyMatches = (stored: string | null | undefined, name: string, language: 'ar' | 'en' = 'ar'): boolean =>
  !!stored && norm(stored) === norm(STAFF_TEMPLATE_DEFS[name]?.[language]?.body ?? '');
/** the template may be sent: APPROVED and the body as approved */
export const templateReady = (t: { status?: string | null; body?: string | null } | null | undefined, name: string, language: 'ar' | 'en' = 'ar'): { ok: boolean; reason: string | null } =>
  !t || !t.status ? { ok: false, reason: 'template_unread' }
    : String(t.status).toUpperCase() !== 'APPROVED' ? { ok: false, reason: 'template_not_approved' }
    : !bodyMatches(t.body, name, language) ? { ok: false, reason: 'template_mismatch' } : { ok: true, reason: null };
/** read the template again before a send (Ahmed, 15 Nov 2026): missing from the list, not «معتمد», no body, a body that
 *  differs from templates.md, or read more than a day ago */
export const templateNeedsRead = (t: { status?: string | null; body?: string | null; read_at?: string | null } | null | undefined, name: string, now: number, maxAgeMs: number,
  language: 'ar' | 'en' = 'ar'): boolean =>
  !t || !t.status || String(t.status).toUpperCase() !== 'APPROVED' || !t.body || !bodyMatches(t.body, name, language) || !t.read_at || now - Date.parse(t.read_at) > maxAgeMs;
/** the reason a staff send was refused or failed, in Arabic (the dashboard and the email) */
export const SEND_REFUSALS: Record<string, string> = {
  template_unread: 'تعذّرت قراءة حالة القالب من YCloud',
  template_not_approved: 'القالب غير معتمد من Meta',
  template_mismatch: 'نص القالب في YCloud يختلف عن النص المعتمد',
  sending_off: '«الإرسال من المركز» متوقف لهذا الرقم',
  payload: 'تعذّر تجهيز الرسالة',
};
export const sendRefusalText = (code: string | null | undefined): string =>
  SEND_REFUSALS[String(code ?? '')] ?? (code ? `رفضت YCloud الإرسال (${String(code).replace(/[^a-z0-9_]/gi, '').slice(0, 40)})` : 'لم يُرسل');
export const templateUrl = (waba: string, name: string, language: string) =>
  `https://api.ycloud.com/v2/whatsapp/templates/${encodeURIComponent(waba)}/${encodeURIComponent(name)}/${encodeURIComponent(language)}`;

// ═══ the colleague chat ═══
export interface StaffChatInput {
  branch: string;
  kind: 'staff' | 'report';
  first_name: string;
  now: string;
  facts: Json;
  history: { author: 'colleague' | 'us'; body: string }[];
  message: string;
}
export function staffUser(i: StaffChatInput): string {
  return [
    `BRANCH_OF_THIS_NUMBER: ${i.branch}`,
    `COLLEAGUE_KIND: ${i.kind === 'report' ? 'management' : 'staff'}`,
    `COLLEAGUE_FIRST_NAME: ${oneLine(i.first_name, 40) || '(unknown)'}`,
    `TIME_NOW_RIYADH: ${i.now}`,
    `FACTS: ${JSON.stringify(i.facts ?? {})}`,
    `LAST_MESSAGES: ${i.history.map((h) => `${h.author}: ${oneLine(h.body, 400)}`).join('\n') || '(none)'}`,
    `COLLEAGUE_MESSAGE: ${oneLine(i.message, 1500)}`,
  ].join('\n');
}
export const staffSystemFor = (tpl: string, branchName: string) => tpl.replace(/\{branch_name\}/g, branchName);

/** «تعلّم:» / «تعلم:» / «علّم:» (learn.ts — H7b) */
export const isTeach = (s: string) => teachCommand(s);

/** every number and link the FACTS hold (the guard's allow-list) */
function factTokens(facts: Json): { numbers: Set<string>; links: Set<string> } {
  const numbers = new Set<string>();
  const links = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'number') numbers.add(String(v));
    else if (typeof v === 'string') {
      if (/^https:\/\//.test(v)) links.add(v);
      for (const d of westDigits(v).match(DIGITS) ?? []) numbers.add(d);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(facts);
  return { numbers, links };
}
const BRAND_FORBIDDEN = ['شقق مخدومة', 'serviced apartment', 'مكواة', 'لاريو', 'lario'];
/** the colleague chat's reply: emoji and dialect allowed; never a phone number, an email, a link the FACTS do not hold or
 *  a number the FACTS and the colleague's message do not hold; the brand's forbidden words */
export function staffGuard(reply: string, facts: Json, message: string, now = ''): { ok: boolean; reasons: string[] } {
  const r: string[] = [];
  const s = String(reply ?? '').trim();
  if (!s) r.push('empty');
  if (s.length > 500) r.push('length');
  for (const m of westDigits(s.replace(/https?:\/\/[^\s)»"']+/g, ' ')).match(/\+?[0-9][0-9 ().-]{6,}[0-9]/g) ?? []) if (m.replace(/\D/g, '').length >= 8) r.push('phone');
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(s)) r.push('email');
  const { numbers, links } = factTokens(facts);
  for (const u of s.match(/https?:\/\/[^\s)»"']+/g) ?? []) if (!links.has(u.replace(/[.,،]+$/, ''))) r.push('link');
  const allowed = new Set([...numbers, ...(westDigits(message).match(DIGITS) ?? []), ...(westDigits(now).match(DIGITS) ?? [])]);
  const withoutLinks = s.replace(/https?:\/\/[^\s)»"']+/g, ' ');
  for (const d of westDigits(withoutLinks).match(DIGITS) ?? []) if (!allowed.has(d)) r.push('number');
  const low = s.toLowerCase();
  if (BRAND_FORBIDDEN.some((w) => low.includes(w))) r.push('forbidden');
  return { ok: r.length === 0, reasons: [...new Set(r)] };
}
export const staffFallback = (message: string): string => (/[؀-ۿ]/.test(message) || !/[a-z]/i.test(message) ? STAFF_COPY.fallback.ar : STAFF_COPY.fallback.en);

// ═══ the shift and «عودة المساعد» (the SQL twins) ═══
export interface Slot { days: number[]; start_time: string; end_time: string; active?: boolean }
const minutes = (hhmm: string) => {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
/** Riyadh's weekday (0 = Sunday) and minute of the day */
export function riyadh(at: Date): { dow: number; min: number } {
  const t = new Date(at.getTime() + 3 * 3600_000);
  return { dow: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
/** internal.hub_slot_covers: the day the shift starts is one of its days; an overnight shift runs into the next morning */
export function slotCovers(s: Slot, at: Date): boolean {
  const { dow, min } = riyadh(at);
  const a = minutes(s.start_time);
  const b = minutes(s.end_time);
  if (a < b) return s.days.includes(dow) && min >= a && min < b;
  return (s.days.includes(dow) && min >= a) || (s.days.includes((dow + 6) % 7) && min < b);
}
/** who gets the alert of a new hand-off: the active slots on shift; nobody → the managers; no slot → nobody (email only) */
export function alertTargets<T extends Slot & { id: string; role: 'manager' | 'staff' }>(slots: T[], at: Date): T[] {
  const active = slots.filter((s) => s.active !== false);
  const on = active.filter((s) => slotCovers(s, at));
  return on.length ? on : active.filter((s) => s.role === 'manager');
}
/** the escalation: the managers not alerted yet, once the branch's minutes passed with the hand-off neither opened nor answered */
export function escalationTargets<T extends Slot & { id: string; role: 'manager' | 'staff' }>(slots: T[], alerted: string[], createdAt: Date, at: Date, minutesLimit: number, opened: boolean, replied: boolean): T[] {
  if (opened || replied || at.getTime() - createdAt.getTime() < minutesLimit * 60_000) return [];
  return slots.filter((s) => s.active !== false && s.role === 'manager' && !alerted.includes(s.id));
}
/** internal.hub_human_phase */
export function humanPhase(c: { state: string; human_reason?: string | null; owner_kind?: string | null; staff_active_at?: Date | null }, at: Date, resumeMinutes = 15): 'waiting' | 'resume' | null {
  if (c.state !== 'human') return null;
  if (['test_mode', 'cart_order', 'abuse'].includes(String(c.human_reason ?? ''))) return null;
  if (!c.owner_kind) return 'waiting';
  if (['staff', 'phone'].includes(c.owner_kind) && c.staff_active_at && at.getTime() - c.staff_active_at.getTime() >= resumeMinutes * 60_000) return 'resume';
  return null;
}

/** the router's decision for a number writing to a branch number (wa-automation): a staff slot → the playful colleague
 *  chat; a report-only number → the respectful one; «يُعامَل كضيف للتجربة», or no match → the guest path */
export function routeNumber(lookup: { kind?: string; test_as_guest?: boolean } | null | undefined): 'staff' | 'report' | 'guest' {
  if (!lookup || lookup.test_as_guest) return 'guest';
  return lookup.kind === 'report' ? 'report' : 'staff';
}
