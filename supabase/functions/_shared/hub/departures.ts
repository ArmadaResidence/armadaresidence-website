/**
 * Guest Hub H9 «قائمة المغادرين» (16 Nov 2026, Ahmed — DECISIONS.md 2026-11-16 «Guest Hub H9»). Pure TypeScript with
 * erasable syntax only: the dashboard reads the file with it (admin/src/pages/Departures.tsx — in the browser, the file is
 * never uploaded or stored), wa-automation builds the departure check with it, and scripts/hub-departures-check.mjs tests it
 * under Node on a synthetic file made to match Nazeel's layout.
 *
 *   - readXlsx: a .xlsx (a zip of XML) → the first sheet's cells and merged ranges (DecompressionStream 'deflate-raw' —
 *     the browser, Deno and Node all have it); never a library, never a network call.
 *   - parseNazeel: Nazeel's «تقرير الحجوزات» (المغادرة-غدا): title rows on top and the printing information at the bottom; the
 *     header row found by its labels; ONLY «رقم الجوال» (international format, +), «العميل» (its first word) and «رقم الحجز»
 *     read, by their headers, never by position — a header owns the columns up to the next header (sparse and merged
 *     columns); «الرصيد», «الوحدات» and «الحالة» never read. A row with a booking number and no phone is skipped (its first
 *     name counted); a line without a booking number (a total, the footer, a repeated header) is not a guest.
 *   - phoneLanguage: Saudi and Arab country codes → Arabic, every other code → English (the SQL internal.hub_phone_language).
 *   - checkoutPayload: stay_checkout_check — {{1}} the branch name, {{2}} the check-out time read from policies.json
 *     (content.check_out_line: «12:00 ظهرًا» / "12:00 noon"), its two quick replies' payloads hubo:leave:<id> / hubo:extend:<id>.
 */

// deno-lint-ignore no-explicit-any
type Json = any;

// ═══ the language of a guest (the SQL twin: internal.hub_phone_language) ═══
/** the Arab League's members: Saudi Arabia first */
export const ARAB_CODES = ['966', '971', '965', '974', '973', '968', '967', '962', '961', '963', '964', '970', '20', '249', '218', '216', '213', '212', '222', '252', '253', '269'];
export const phoneLanguage = (e164: string): 'ar' | 'en' => (ARAB_CODES.some((c) => String(e164 ?? '').startsWith(`+${c}`)) ? 'ar' : 'en');

const WEST = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
/** «رقم الجوال» → E.164: an international number (+ or 00); a Saudi mobile written 05… as +9665…; anything else null */
export function normalizePhone(raw: unknown): string | null {
  let s = WEST(String(raw ?? '')).replace(/[\s‎‏‪-‮().-]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^05[0-9]{8}$/.test(s)) s = `+966${s.slice(1)}`;
  if (/^9665[0-9]{8}$/.test(s)) s = `+${s}`;
  return /^\+[1-9][0-9]{7,14}$/.test(s) ? s : null;
}
/** «العميل» → its first word (a title such as «السيد» is a word too: Nazeel writes the guest's name only) */
export function firstWord(raw: unknown): string {
  const s = String(raw ?? '').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  return (s.split(' ')[0] ?? '').slice(0, 40);
}
/** «رقم الحجز»: letters, digits, / _ - and at least one digit */
export const validRef = (raw: unknown): string | null => {
  const s = WEST(String(raw ?? '')).replace(/\s+/g, '').trim();
  return /^[A-Za-z0-9/_-]{1,40}$/.test(s) && /[0-9]/.test(s) ? s : null;
};

// ═══ the header labels ═══
export const HEADERS = { ref: 'رقم الحجز', name: 'العميل', phone: 'رقم الجوال' } as const;
/** read nowhere — named here so the check proves they are never read */
export const IGNORED = ['الرصيد', 'الوحدات', 'الحالة'] as const;
const norm = (s: unknown) => String(s ?? '').replace(/[ً-ٰٟـ‎‏]/g, '').replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim();

export interface Sheet {
  /** rows[r][c] = the cell's text ('' when empty); r, c from 0 */
  rows: string[][];
  /** merged ranges (0-based, inclusive) */
  merges: { r0: number; c0: number; r1: number; c1: number }[];
}
export interface Parsed {
  ok: boolean;
  error?: 'no_header' | 'not_xlsx' | 'empty';
  header_row?: number;
  rows: { ref: string; first_name: string; phone: string; raw_phone: string }[];
  /** a booking number and no (valid) phone: the first names only */
  no_phone: string[];
  /** the phone was written but is not a number we can use (kept for the server's own check: bad_phone) */
  bad_phone: string[];
  /** lines below the header that are not a guest (a total, the footer, a repeated header) */
  ignored_lines: number;
}

/** Nazeel's sheet → the three columns of each guest (by header, never by position) */
export function parseNazeel(sheet: Sheet): Parsed {
  const out: Parsed = { ok: false, rows: [], no_phone: [], bad_phone: [], ignored_lines: 0 };
  const rows = sheet.rows;
  if (!rows.length) return { ...out, error: 'empty' };
  const want = [HEADERS.ref, HEADERS.name, HEADERS.phone].map(norm);
  const h = rows.findIndex((r) => want.every((w) => r.some((c) => norm(c) === w)));
  if (h < 0) return { ...out, error: 'no_header' };
  const head = rows[h];
  // every header cell of that row, in column order; a header owns its columns up to the next header (a merged header's span
  // included) — the value of a sparse or merged column is the first non-empty cell in that window
  const cells = head.map((v, c) => ({ c, v: norm(v) })).filter((x) => x.v);
  const window = (label: string): [number, number] => {
    const i = cells.findIndex((x) => x.v === norm(label));
    const c0 = cells[i].c;
    const merged = sheet.merges.find((m) => m.r0 <= h && h <= m.r1 && m.c0 <= c0 && c0 <= m.c1);
    const next = cells[i + 1]?.c ?? Math.max(c0 + 1, ...rows.map((r) => r.length));
    return [merged ? merged.c0 : c0, Math.max(merged ? merged.c1 : c0, next - 1)];
  };
  const W = { ref: window(HEADERS.ref), name: window(HEADERS.name), phone: window(HEADERS.phone) };
  const pick = (r: string[], [c0, c1]: [number, number]): string => {
    for (let c = c0; c <= c1; c++) if (String(r[c] ?? '').trim()) return String(r[c]).trim();
    return '';
  };
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => String(c ?? '').trim())) continue;
    // a repeated header (a page break) or the footer: no booking number → not a guest
    if (want.some((w) => r.some((c) => norm(c) === w))) {
      out.ignored_lines++;
      continue;
    }
    const ref = validRef(pick(r, W.ref));
    if (!ref) {
      out.ignored_lines++;
      continue;
    }
    const name = firstWord(pick(r, W.name)) || '—';
    const raw = pick(r, W.phone);
    if (!raw) {
      out.no_phone.push(name);
      continue;
    }
    const phone = normalizePhone(raw);
    if (!phone) {
      out.bad_phone.push(name);
      continue;
    }
    out.rows.push({ ref, first_name: name, phone, raw_phone: raw });
  }
  out.ok = true;
  out.header_row = h;
  return out;
}

/** what the upload sends the server (never the raw phone, never another column) */
export const uploadRows = (p: Parsed) => p.rows.map((r) => ({ ref: r.ref, first_name: r.first_name, phone: r.phone }));

// ═══ reading a .xlsx ═══
const td = new TextDecoder('utf-8');
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** the entries of a zip (the central directory), each read on demand */
export async function unzip(buf: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(buf, i) === 0x06054b50) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new Error('not_xlsx');
  const n = u16(buf, e + 10);
  let p = u32(buf, e + 16);
  for (let k = 0; k < n; k++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('not_xlsx');
    const method = u16(buf, p + 10);
    const csize = u32(buf, p + 20);
    const nlen = u16(buf, p + 28);
    const xlen = u16(buf, p + 30);
    const clen = u16(buf, p + 32);
    const local = u32(buf, p + 42);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!wanted(name)) continue;
    if (u32(buf, local) !== 0x04034b50) throw new Error('not_xlsx');
    const start = local + 30 + u16(buf, local + 26) + u16(buf, local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (!data) throw new Error('not_xlsx');
    out.set(name, td.decode(data));
  }
  return out;
}

const XML_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, k: string) =>
  k[0] === '#' ? String.fromCodePoint(k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : XML_ENT[k] ?? m);
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');
/** "AB12" → {r: 11, c: 27} (0-based) */
export function cellRef(ref: string): { r: number; c: number } {
  const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
  if (!m) return { r: -1, c: -1 };
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

/** a .xlsx's first sheet → its cells' text and merged ranges */
export async function readXlsx(buf: Uint8Array): Promise<Sheet> {
  if (buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('not_xlsx');
  const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet[0-9]+\.xml$/.test(n));
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // the first sheet of the workbook (its relationship), else sheet1.xml
  let path = 'xl/worksheets/sheet1.xml';
  const first = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(files.get('xl/workbook.xml') ?? '')?.[1];
  if (first) {
    const t = new RegExp(`<Relationship\\b[^>]*\\bId="${first}"[^>]*\\bTarget="([^"]+)"`).exec(files.get('xl/_rels/workbook.xml.rels') ?? '')?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${first}"`).exec(files.get('xl/_rels/workbook.xml.rels') ?? '')?.[1];
    if (t) path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
  }
  const xml = files.get(path) ?? [...files.entries()].find(([k]) => /^xl\/worksheets\/sheet[0-9]+\.xml$/.test(k))?.[1];
  if (!xml) throw new Error('not_xlsx');
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rr = /\br="([0-9]+)"/.exec(rm[1]);
    const r = rr ? Number(rr[1]) - 1 : rows.length;
    const row: string[] = rows[r] ?? [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = cm[1];
      const ref = /\br="([A-Z]+[0-9]+)"/.exec(at)?.[1];
      const c = ref ? cellRef(ref).c : row.length;
      const t = /\bt="([^"]+)"/.exec(at)?.[1] ?? 'n';
      const body = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = texts(body);
      else if (v !== undefined) val = unxml(v);
      while (row.length < c) row.push('');
      row[c] = val;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = row;
  }
  const merges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+[0-9]+):([A-Z]+[0-9]+)"/g)].map((m) => {
    const a = cellRef(m[1]);
    const b = cellRef(m[2]);
    return { r0: a.r, c0: a.c, r1: b.r, c1: b.c };
  });
  return { rows, merges };
}

// ═══ the departure check ═══
export const CHECKOUT_TEMPLATE = 'stay_checkout_check';
/** {{2}}: the check-out time of policies.json («المغادرة حتى الساعة 12:00 ظهرًا» → «12:00 ظهرًا»; "Check-out by 12:00 noon" →
 *  "12:00 noon") — read from the file, never typed here */
export function checkoutTime(c: Json, L: 'ar' | 'en'): string {
  const line = String(c?.check_out_line?.[L] ?? '');
  const m = /([0-9]{1,2}:[0-9]{2}\s*\S+)\s*$/.exec(line);
  if (!m) throw new Error('checkout time: policies.json check_out line');
  return m[1].trim();
}
const E164 = /^\+[1-9][0-9]{7,14}$/;
const clean = (s: unknown) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
/** the YCloud send body of stay_checkout_check: from the branch's own number, in the guest's language; the quick replies
 *  carry the row's id (routed by id — never the opt-out matcher) */
export function checkoutPayload(c: Json, d: { branch: string; language: 'ar' | 'en'; phone: string; id: string }, externalId?: string) {
  const L = d.language === 'en' ? 'en' : 'ar';
  const b = (c?.branches ?? []).find((x: Json) => x.slug === d.branch);
  if (!b) throw new Error(`unknown branch ${d.branch}`);
  if (!E164.test(String(b.whatsapp)) || !E164.test(d.phone)) throw new Error('stay_checkout_check: from / to must be E.164');
  const vars = [clean(b[`name_${L}`]), clean(checkoutTime(c, L))];
  if (vars.some((v) => !v)) throw new Error('stay_checkout_check: an empty variable');
  return {
    from: String(b.whatsapp), to: d.phone, type: 'template' as const, ...(externalId ? { externalId } : {}),
    template: {
      name: CHECKOUT_TEMPLATE, language: { code: L },
      components: [
        { type: 'body', parameters: vars.map((text) => ({ type: 'text', text })) },
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `hubo:leave:${d.id}` }] },
        { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `hubo:extend:${d.id}` }] },
      ],
    },
  };
}

// ═══ the states, in Arabic (the page and the checks) ═══
export const STATE_AR: Record<string, string> = {
  scheduled: 'مجدولة', queued: 'في الطريق', pending: 'في الطريق', accepted: 'أُرسلت', sent: 'أُرسلت', delivered: 'وصلت', read: 'قُرئت',
  failed: 'تعذّر الإرسال', skipped: 'لم تُرسل', dry_run: 'تجربة بدون إرسال', cancelled: 'أُلغيت', test: 'تجربة', none: '—',
};
export const CODE_AR: Record<string, string> = {
  switch_off: 'المفتاح متوقف — ما كان سيُرسل', excluded: 'مستبعد', extended: 'تمديد', late: 'بعد موعد المغادرة', limit_late: 'أُجّلت بسبب حد الإرسال حتى فات موعدها',
  staff_number: 'رقم موظف', blocked: 'رقم محظور', opted_out: 'أوقف الرسائل', site_review: 'أُرسل طلب التقييم من حجز الموقع', duplicate: 'أُرسل لهذا الرقم من حجز آخر',
  template_unread: 'تعذّرت قراءة حالة القالب', template_not_approved: 'القالب غير معتمد', template_mismatch: 'نص القالب مختلف', payload: 'تعذّر تجهيز الرسالة',
};
export const SKIP_AR: Record<string, string> = {
  no_phone: 'بلا رقم جوال', duplicate: 'رقم مكرر على أكثر من حجز (غالبًا شركة أو وكيل)', staff: 'رقم موظف أو إدارة', bad_phone: 'رقم جوال غير صالح', bad_ref: 'رقم حجز غير صالح',
};
export const ANSWER_AR: Record<string, string> = { leave: 'خروج', extend: 'تمديد', none: 'لم يرد' };

// ═══ the daily report (hub_daily_report {{7}} and its faults — staff.ts and the dashboard's lib/team.ts read these) ═══
const BRS = ['airport-road', 'shafa-road'] as const;
const SHORT_AR: Record<string, string> = { 'airport-road': 'المطار', 'shafa-road': 'الشفا' };
const cnt = (x: unknown) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : 0);
/** {{7}} «الخروج أو التمديد»: per branch «خروج X · تمديد Y · لم يرد Z» (the day's departures of the list); a branch that
 *  does not use the list yet «لم يُفعَّل بعد»; neither → «لم يُفعَّل بعد» */
export function departuresText(data: Json): string {
  const on = BRS.filter((b) => data?.branches?.[b]?.dep_on === true);
  if (!on.length) return 'لم يُفعَّل بعد';
  return BRS.map((b) => {
    const x = data?.branches?.[b] ?? {};
    return x.dep_on === true ? `${SHORT_AR[b]}: خروج ${cnt(x.dep_leave)} · تمديد ${cnt(x.dep_extend)} · لم يرد ${cnt(x.dep_none)}` : `${SHORT_AR[b]}: لم يُفعَّل بعد`;
  }).join(' — ');
}
/** the list's faults of the day (after the existing ones): a missing evening list, checks too late to send, sends held
 *  back by the shared limit */
export function departureFaults(data: Json): string[] {
  const out: string[] = [];
  const missing = BRS.filter((b) => data?.branches?.[b]?.dep_missing === true).map((b) => SHORT_AR[b]);
  if (missing.length) out.push(`لم تُرفع قائمة المغادرين: ${missing.join(' و')}`);
  const late = BRS.reduce((a, b) => a + cnt(data?.branches?.[b]?.dep_late), 0);
  if (late) out.push(`رسائل خروج فات موعدها ${late}`);
  const held = cnt(data?.limit_deferred);
  if (held) out.push(`تأجيل بسبب حد الإرسال ${held}`);
  return out;
}
