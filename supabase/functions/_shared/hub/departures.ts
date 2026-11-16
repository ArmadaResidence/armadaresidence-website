/**
 * Guest Hub H9 «قائمة المغادرين» (16 Nov 2026, Ahmed — DECISIONS.md 2026-11-16 «Guest Hub H9»). Pure TypeScript with
 * erasable syntax only: the dashboard reads the file with it (admin/src/pages/Departures.tsx — in the browser, the file is
 * never uploaded or stored), wa-automation builds the departure check with it, and scripts/hub-departures-check.mjs tests it
 * under Node on a synthetic file made to match Nazeel's layout.
 *
 *   - readXlsx: a .xlsx (a zip of XML) → the first sheet's cells and merged ranges (DecompressionStream 'deflate-raw' —
 *     the browser, Deno and Node all have it); never a library, never a network call. Since H9 fix 1 (16 Nov 2026) the
 *     XML is read by NAMESPACE and local name (Nazeel prefixes every element x: and starts every part with a BOM; the
 *     sheet and the shared strings are found through the workbook's relationships) — never by tag text or a prefix.
 *   - parseNazeel: Nazeel's «تقرير الحجوزات» (مغادرين اليوم — each morning since H9 fix 1; the evening المغادرة-غدا before): title rows on top and the printing information at the bottom; the
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
  /** not_xlsx: not an Excel file · no_sheet: a workbook without a worksheet · empty: a sheet without a single cell ·
   *  no_header: the three headers not found · no_rows: the header found, no booking line under it */
  error?: 'no_header' | 'not_xlsx' | 'empty' | 'no_sheet' | 'no_rows';
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
  if (!rows.some((r) => r.some((c) => String(c ?? '').trim()))) return { ...out, error: 'empty' };
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
  out.header_row = h;
  if (!out.rows.length && !out.no_phone.length && !out.bad_phone.length) return { ...out, error: 'no_rows' };
  out.ok = true;
  return out;
}

/** what the upload sends the server (never the raw phone, never another column) */
export const uploadRows = (p: Parsed) => p.rows.map((r) => ({ ref: r.ref, first_name: r.first_name, phone: r.phone }));

// ═══ reading a .xlsx ═══
const td = new TextDecoder('utf-8');
/** a part's text, its UTF-8 BOM removed (Nazeel writes one before every part) */
const utf8 = (b: Uint8Array) => td.decode(b).replace(/^\uFEFF/, '');
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
    out.set(name, utf8(data));
  }
  return out;
}

const XML_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, k: string) =>
  k[0] === '#' ? String.fromCodePoint(k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : XML_ENT[k] ?? m);
/** "AB12" → {r: 11, c: 27} (0-based) */
export function cellRef(ref: string): { r: number; c: number } {
  const m = /^\$?([A-Z]+)\$?([0-9]+)$/.exec(String(ref ?? '').toUpperCase());
  if (!m) return { r: -1, c: -1 };
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

// ═══ a namespace-aware reading of the XML parts (H9 fix 1, 16 Nov 2026) ═══
// Nazeel writes every SpreadsheetML element with a prefix (<x:worksheet>, <x:row>, <x:c>, <x:si>, <x:t> — x bound to the
// main namespace), a UTF-8 BOM before each part and random relationship ids. Elements are matched by their NAMESPACE and
// local name, never by tag text or a fixed prefix; Excel's own files (no prefix, a default namespace) read the same way.
const NS = {
  main: ['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main'],
  rel: ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'],
  pkg: ['http://schemas.openxmlformats.org/package/2006/relationships'],
} as const;
export interface XNode {
  ns: string;
  local: string;
  /** attributes: unprefixed by their local name, prefixed by "{namespace}local" */
  attrs: Record<string, string>;
  children: XNode[];
  /** the element's own text (CDATA included), its children's excluded */
  text: string;
}
const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** one XML part → its root element (a BOM and the declaration skipped); throws 'xml' on a part with no element */
export function parseXml(src: string): XNode {
  const s = String(src ?? '').replace(/^﻿/, '');
  const root: XNode = { ns: '', local: '#document', attrs: {}, children: [], text: '' };
  const stack: { node: XNode; scope: Record<string, string> }[] = [{ node: root, scope: { xml: 'http://www.w3.org/XML/1998/namespace' } }];
  for (const m of s.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.node.text += m[1];
      continue;
    }
    if (m[6] !== undefined) {
      if (stack.length > 1) top.node.text += unxml(m[6]);
      continue;
    }
    if (!m[3]) continue; // a comment, a declaration, a doctype
    const qname = m[3];
    if (m[2] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const raw: [string, string][] = [...(m[4] ?? '').matchAll(ATTR)].map((a) => [a[1], unxml(a[2] ?? a[3] ?? '')]);
    const scope = { ...top.scope };
    for (const [k, v] of raw) {
      if (k === 'xmlns') scope[''] = v;
      else if (k.startsWith('xmlns:')) scope[k.slice(6)] = v;
    }
    const i = qname.indexOf(':');
    const node: XNode = { ns: scope[i < 0 ? '' : qname.slice(0, i)] ?? '', local: i < 0 ? qname : qname.slice(i + 1), attrs: {}, children: [], text: '' };
    for (const [k, v] of raw) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) continue;
      const j = k.indexOf(':');
      node.attrs[j < 0 ? k : `{${scope[k.slice(0, j)] ?? ''}}${k.slice(j + 1)}`] = v;
    }
    top.node.children.push(node);
    if (m[5] !== '/') stack.push({ node, scope });
  }
  const el = root.children[0];
  if (!el) throw new Error('xml');
  return el;
}
const isNs = (n: XNode, ns: readonly string[]) => ns.includes(n.ns);
/** the children of an element with this local name in one of these namespaces */
export const kids = (n: XNode | undefined, local: string, ns: readonly string[] = NS.main): XNode[] => (n?.children ?? []).filter((c) => c.local === local && isNs(c, ns));
const kid = (n: XNode | undefined, local: string, ns: readonly string[] = NS.main) => kids(n, local, ns)[0];
/** an attribute in one of these namespaces ("{ns}local") */
const nsAttr = (n: XNode | undefined, local: string, ns: readonly string[]) => ns.map((u) => n?.attrs[`{${u}}${local}`]).find((v) => v !== undefined);
/** a shared or inline string: its <t> plus every run's <t>; the phonetic runs (<rPh>) left out */
function richText(n: XNode | undefined): string {
  if (!n) return '';
  return [...kids(n, 't').map((t) => t.text), ...kids(n, 'r').map((r) => kids(r, 't').map((t) => t.text).join(''))].join('');
}
/** a path inside the zip, relative to the part that names it ("../x", "./x", "/x") */
function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
const relsOf = (part: string) => {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
};
/** a part's relationships: id → {type, target (resolved)} */
function rels(files: Map<string, string>, part: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>();
  const xml = files.get(relsOf(part));
  if (!xml) return out;
  let root: XNode;
  try {
    root = parseXml(xml);
  } catch {
    return out;
  }
  for (const r of kids(root, 'Relationship', NS.pkg)) {
    if (r.attrs.Id && r.attrs.Target && r.attrs.TargetMode !== 'External') out.set(r.attrs.Id, { type: r.attrs.Type ?? '', target: resolvePart(part, r.attrs.Target) });
  }
  return out;
}
const parsed = (xml: string | undefined, err: string): XNode => {
  if (xml === undefined) throw new Error(err);
  try {
    return parseXml(xml);
  } catch {
    throw new Error(err);
  }
};

/** why a file cannot be read: not a zip / an Excel workbook, or a workbook without a worksheet */
export type ReadError = 'not_xlsx' | 'no_sheet';

/** a .xlsx's first sheet → its cells' text and merged ranges (throws 'not_xlsx' or 'no_sheet') */
export async function readXlsx(buf: Uint8Array): Promise<Sheet> {
  if (buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('not_xlsx');
  const files = await unzip(buf, (n) => /\.(xml|rels)$/i.test(n));
  // the workbook: the package's officeDocument relationship, else xl/workbook.xml
  let wbPath = 'xl/workbook.xml';
  for (const r of rels(files, '').values()) if (/\/officeDocument$/.test(r.type) && files.has(r.target)) wbPath = r.target;
  const wb = parsed(files.get(wbPath), 'not_xlsx');
  if (wb.local !== 'workbook' || !isNs(wb, NS.main)) throw new Error('not_xlsx');
  const wbRels = rels(files, wbPath);
  // the first sheet of the workbook, through its relationship (the ids are random in Nazeel's file)
  const first = kids(kid(wb, 'sheets'), 'sheet')[0];
  const rid = nsAttr(first, 'id', NS.rel);
  let path = rid ? wbRels.get(rid)?.target : undefined;
  if (!path || !files.has(path)) path = [...wbRels.values()].find((r) => /\/worksheet$/.test(r.type) && files.has(r.target))?.target;
  if (!path) throw new Error('no_sheet');
  // the shared strings, through the workbook's relationship (else the usual path)
  const ssPath = [...wbRels.values()].find((r) => /\/sharedStrings$/.test(r.type))?.target ?? 'xl/sharedStrings.xml';
  const shared = files.has(ssPath) ? kids(parsed(files.get(ssPath), 'not_xlsx'), 'si').map((si) => richText(si)) : [];
  const ws = parsed(files.get(path), 'no_sheet');
  if (ws.local !== 'worksheet' || !isNs(ws, NS.main)) throw new Error('no_sheet');
  const rows: string[][] = [];
  for (const rowEl of kids(kid(ws, 'sheetData'), 'row')) {
    const r = rowEl.attrs.r ? Number(rowEl.attrs.r) - 1 : rows.length;
    if (!Number.isInteger(r) || r < 0 || r > 100000) continue;
    const row: string[] = rows[r] ?? [];
    for (const cEl of kids(rowEl, 'c')) {
      const ref = cEl.attrs.r;
      const c = ref ? cellRef(ref).c : row.length;
      if (c < 0 || c > 16383) continue;
      const t = cEl.attrs.t ?? 'n';
      const v = kid(cEl, 'v')?.text;
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = richText(kid(cEl, 'is'));
      else if (v !== undefined) val = v;
      while (row.length < c) row.push('');
      row[c] = val;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = row;
  }
  const merges = kids(kid(ws, 'mergeCells'), 'mergeCell').map((m) => String(m.attrs.ref ?? '').split(':')).filter((x) => x.length === 2).map(([x, y]) => {
    const a = cellRef(x);
    const b = cellRef(y);
    return { r0: a.r, c0: a.c, r1: b.r, c1: b.c };
  }).filter((m) => m.r0 >= 0 && m.c0 >= 0 && m.r1 >= 0 && m.c1 >= 0);
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
  switch_off: 'المفتاح متوقف — ما كان سيُرسل', excluded: 'مستبعد', extended: 'تمديد', late: 'فات موعد رسالة الخروج (11:00)', limit_late: 'أُجّلت بسبب حد الإرسال حتى فات موعدها',
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
  if (missing.length) out.push(`لم تُرفع قائمة المغادرين حتى 8:30: ${missing.join(' و')}`);
  const late = BRS.reduce((a, b) => a + cnt(data?.branches?.[b]?.dep_late), 0);
  if (late) out.push(`رسائل خروج فات موعدها ${late}`);
  const held = cnt(data?.limit_deferred);
  if (held) out.push(`تأجيل بسبب حد الإرسال ${held}`);
  return out;
}
