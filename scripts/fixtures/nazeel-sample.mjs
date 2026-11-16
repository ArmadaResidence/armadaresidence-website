// Guest Hub H9 (16 Nov 2026): a SYNTHETIC «تقرير الحجوزات» (المغادرة-غدا) made to match Nazeel's layout — title rows on
// top, the header labels «رقم الحجز»، «الحالة»، «الوحدات»، «العميل»، «رقم الجوال»، «الرصيد» in sparse and merged columns,
// a row without a phone, a phone on two bookings, a foreign number, a number written with spaces or 00, the printing
// information at the bottom. Fictional names and numbers only (+1 555 01xx and a Saudi test range) — never a real guest.
// Used by scripts/hub-departures-check.mjs (the parser) and admin/tests/hub-departures-ui-check.mjs (the upload).
//   import { nazeelXlsx } from './fixtures/nazeel-sample.mjs'; const bytes = nazeelXlsx({ order: 'nazeel', deflate: true });
import { deflateRawSync } from 'node:zlib';

const enc = new TextEncoder();
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** a zip of {name: string|Uint8Array}; deflate (method 8, as Excel writes it) or stored (method 0) */
export function zip(files, deflate = true) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const comp = deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const nm = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nm.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(8, deflate ? 8 : 0, true);
    v.setUint32(14, crc, true); v.setUint32(18, comp.length, true); v.setUint32(22, data.length, true); v.setUint16(26, nm.length, true);
    local.set(nm, 30);
    const cd = new Uint8Array(46 + nm.length);
    const w = new DataView(cd.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(10, deflate ? 8 : 0, true);
    w.setUint32(16, crc, true); w.setUint32(20, comp.length, true); w.setUint32(24, data.length, true); w.setUint16(28, nm.length, true);
    w.setUint32(42, offset, true);
    cd.set(nm, 46);
    parts.push(local, comp);
    central.push(cd);
    offset += local.length + comp.length;
  }
  const cdLen = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true);
  e.setUint32(12, cdLen, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdLen + 22);
  let p = 0;
  for (const x of [...parts, ...central, end]) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (c) => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** rows (strings, numbers, null) and merged ranges ("E6:F6") → a .xlsx (shared strings for text, numbers as numbers) */
export function xlsx(rows, merges = [], deflate = true) {
  const strings = [];
  const si = (s) => {
    let i = strings.indexOf(s);
    if (i < 0) i = strings.push(s) - 1;
    return i;
  };
  const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => {
    if (v === null || v === undefined || v === '') return '';
    const ref = `${col(c)}${i + 1}`;
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${si(String(v))}</v></c>`;
  }).join('')}</row>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>${body}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}</worksheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="تقرير الحجوزات" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': sst,
  }, deflate);
}

/** the guests of the sample: [booking number, status, unit, customer, phone, balance] — fictional */
export const GUESTS = [
  ['100901', 'مغادرة غدًا', '101', 'Salem Test Guest', '+15550100901', 1250],
  ['100902', 'مغادرة غدًا', '102', 'عمر التجريبي', '+966500009911', 0],
  ['100903', 'مغادرة غدًا', '103', 'Agent Travel', '+15550100903', 300],
  ['100904', 'مغادرة غدًا', '104', 'Agent Travel', '+15550100903', 300],
  ['100905', 'مغادرة غدًا', '105', 'فهد بلا رقم', '', 0],
  ['100906', 'مغادرة غدًا', '106', 'John Example', '+1 555 010 0906', 75.5],
  ['100907', 'مغادرة غدًا', '107', 'لينا الاختبار', '00966500009912', 0],
];
/** what the parser must keep (by header, whatever the column order) */
export const EXPECT = {
  kept: [
    { ref: '100901', first_name: 'Salem', phone: '+15550100901' },
    { ref: '100902', first_name: 'عمر', phone: '+966500009911' },
    { ref: '100903', first_name: 'Agent', phone: '+15550100903' },
    { ref: '100904', first_name: 'Agent', phone: '+15550100903' },
    { ref: '100906', first_name: 'John', phone: '+15550100906' },
    { ref: '100907', first_name: 'لينا', phone: '+966500009912' },
  ],
  no_phone: ['فهد'],
};

/**
 * order 'nazeel': the report's own look — title rows, a printed date (never read), then the header with sparse merged
 *   columns: A «رقم الحجز» · C «الحالة» · D «الوحدات» · E:F «العميل» (merged) · G «الرصيد» · H:I «رقم الجوال» (merged; the
 *   value sometimes in I, the merge's second column) — and the footer (a total, the printing line).
 * order 'shuffled': the same guests with the columns in another order (phone first, the booking number last), no merges.
 */
export function nazeelRows(order = 'nazeel') {
  if (order === 'shuffled') {
    return {
      rows: [
        ['تقرير الحجوزات'],
        [],
        ['رقم الجوال', 'الرصيد', 'العميل', 'الوحدات', 'الحالة', 'رقم الحجز'],
        ...GUESTS.map((g) => [g[4], g[5], g[3], g[2], g[1], g[0]]),
        [],
        ['طُبع بواسطة: النظام — صفحة 1 من 1'],
      ],
      merges: [],
    };
  }
  const rows = [
    ['أرمادا ريزيدنس – طريق المطار'],
    ['تقرير الحجوزات'],
    ['الفلتر: المغادرة-غدا', null, null, null, 'تاريخ الطباعة: 2026-11-16 21:40'],
    [],
    ['رقم الحجز', null, 'الحالة', 'الوحدات', 'العميل', null, 'الرصيد', 'رقم الجوال', null],
  ];
  const merges = ['A1:I1', 'A2:I2', 'E5:F5', 'H5:I5'];
  GUESTS.forEach((g, i) => {
    const r = 6 + i;
    // the phone in the merge's second column for every other guest (sparse)
    const phoneAt = i % 2 ? 8 : 7;
    const row = [g[0], null, g[1], g[2], g[3], null, g[5], null, null];
    row[phoneAt] = g[4] || null;
    rows.push(row);
    merges.push(`E${r}:F${r}`, `H${r}:I${r}`);
  });
  rows.push([], [null, null, null, null, 'الإجمالي: 7 حجوزات', null, 1925.5], ['طُبع بواسطة: النظام', null, null, null, null, null, null, 'صفحة 1 من 1']);
  return { rows, merges };
}
export const nazeelXlsx = ({ order = 'nazeel', deflate = true } = {}) => {
  const { rows, merges } = nazeelRows(order);
  return xlsx(rows, merges, deflate);
};

// ═══ H9 fix 1 (16 Nov 2026): Nazeel's REAL export structure (inspected in the planning chat — structure only, no guest
// data): an OpenXML package written with the prefix x on EVERY SpreadsheetML element (<x:workbook>, <x:sheet>,
// <x:worksheet>, <x:sheetData>, <x:row>, <x:c>, <x:v>, <x:mergeCell>; <x:sst>, <x:si>, <x:t>), a UTF-8 BOM before every
// XML part, shared strings only (t="s"), random relationship ids, ONE sheet «ReservationDashboard_Ar» with a drawing (the
// logo), 142 merged ranges, 33 columns (A–AG); title rows 1–10 (the filter label and the printed date among them — never
// read), the header on row 12 (C «الرصيد», F «رقم الجوال», I «العميل», P «الوحدات», Y «الحالة», AB «رقم الحجز»), 17 guests
// on rows 13–29, footer text on rows 31 and 33. Fictional data only: a row without a phone, a phone on two bookings, a
// foreign number, a name written as rich-text runs with a phonetic run (never read).
const BOM = '﻿';
const X = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RID = { sheet: 'Rf7efc9b606d64cdf', ss: 'R3a91c0d2e45b4f07', styles: 'Rc0de5a77b19e4e21', drawing: 'R9b1d2f3e4a5c6b7d', image: 'R11aa22bb33cc44dd', wb: 'R0e9d8c7b6a5f4e3d' };
/** the 17 guests: [booking number, customer, phone ('' = none), balance, units, status] — fictional */
export const X_GUESTS = [
  ['2026110101', 'Salem Test Guest', '+15550100901', '1250.00', '101', 'مغادر'],
  ['2026110102', 'عمر التجريبي', '+966500009911', '0.00', '102', 'مغادر'],
  ['2026110103', 'Agent Travel', '+15550100903', '300.00', '103', 'مغادر'],
  ['2026110104', 'Agent Travel', '+15550100903', '300.00', '104', 'مغادر'],
  ['2026110105', 'فهد بلا رقم', '', '0.00', '105', 'مغادر'],
  ['2026110106', 'John Example', '+447700900106', '75.50', '106', 'مغادر'],
  ['2026110107', 'لينا الاختبار', '+966500009912', '0.00', '107', 'مغادر'],
  ['2026110108', 'سارة نموذج', '+966500009913', '0.00', '108', 'مغادر'],
  ['2026110109', 'خالد عينة', '+966500009914', '40.00', '109', 'مغادر'],
  ['2026110110', 'Maria Sample', '+15550100910', '0.00', '110', 'مغادر'],
  ['2026110111', 'نورة تجربة', '+966500009915', '0.00', '201', 'مغادر'],
  ['2026110112', 'ياسر مثال', '+966500009916', '15.00', '202', 'مغادر'],
  ['2026110113', 'ريم اختبار', '+966500009917', '0.00', '203', 'مغادر'],
  ['2026110114', 'Ahmad Demo', '+201000000114', '0.00', '204', 'مغادر'],
  ['2026110115', 'هند نموذجية', '+966500009918', '0.00', '205', 'مغادر'],
  ['2026110116', 'بدر تجريبي', '+966500009919', '0.00', '206', 'مغادر'],
  ['2026110117', 'منى عينة', '+966500009920', '0.00', '207', 'مغادر'],
];
/** what the parser must keep from it */
export const X_EXPECT = {
  kept: X_GUESTS.filter((g) => g[2]).map((g) => ({ ref: g[0], first_name: g[1].split(' ')[0], phone: g[2] })),
  no_phone: ['فهد'],
  header_row: 11,
};
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253, 227, 85, 242, 156, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
/** Nazeel's layout with every element prefixed x: and a BOM before each part ({prefix: false} → the same sheet unprefixed;
 *  {sheet: false} → a workbook whose sheet is missing; {rows: false} → the header and no guest under it) */
export function nazeelPrefixedXlsx({ prefix = true, deflate = true, sheet: withSheet = true, rows: withRows = true } = {}) {
  const p = prefix ? 'x:' : '';
  const nsDecl = prefix ? `xmlns:x="${X}"` : `xmlns="${X}"`;
  const strings = [];
  const si = (s) => {
    let i = strings.findIndex((x) => !x.rich && x.s === s);
    if (i < 0) i = strings.push({ s }) - 1;
    return i;
  };
  // a name written as two rich-text runs and a phonetic run (the parser reads the runs, never the phonetic)
  const richIdx = strings.push({ s: 'John Example', rich: ['Jo', 'hn Example'], phonetic: 'جون' }) - 1;
  const cells = new Map();
  const put = (r, c, v) => {
    if (!cells.has(r)) cells.set(r, new Map());
    cells.get(r).set(c, v);
  };
  const C = (letters) => [...letters].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  // title rows 1–10: the property, the report, the filter label and the printed date (never read)
  put(1, C('A'), 'أرمادا ريزيدنس — طريق الشفا');
  put(2, C('A'), 'تقرير الحجوزات');
  put(4, C('A'), 'الفلتر: مغادرين اليوم');
  put(5, C('A'), 'تاريخ الطباعة: 16/11/2026 06:45 ص');
  put(7, C('Q'), 'المستخدم: الاستقبال');
  put(9, C('A'), 'عدد الحجوزات: 17');
  // the header (row 12)
  const H = { C: 'الرصيد', F: 'رقم الجوال', I: 'العميل', P: 'الوحدات', Y: 'الحالة', AB: 'رقم الحجز' };
  for (const [c, label] of Object.entries(H)) put(12, C(c), label);
  if (withRows) {
    X_GUESTS.forEach((g, i) => {
      const r = 13 + i;
      put(r, C('AB'), g[0]);
      put(r, C('I'), g[1] === 'John Example' ? { idx: richIdx } : g[1]);
      if (g[2]) put(r, C('F'), g[2]);
      put(r, C('C'), g[3]);
      put(r, C('P'), g[4]);
      put(r, C('Y'), g[5]);
    });
  }
  put(31, C('A'), 'الإجمالي: 17 حجزًا');
  put(33, C('A'), 'طُبع بواسطة نزيل — صفحة 1 من 1');
  // 142 merged ranges: rows 1–10 two each (A:P, Q:AG), row 11 ten, rows 12–29 six each, rows 31 and 33 two each
  const merges = [];
  for (let r = 1; r <= 10; r++) merges.push(`A${r}:P${r}`, `Q${r}:AG${r}`);
  for (let k = 0; k < 10; k++) merges.push(`${col(k * 3)}11:${col(k * 3 + 2)}11`);
  const spans = [['C', 'E'], ['F', 'H'], ['I', 'O'], ['P', 'X'], ['Y', 'AA'], ['AB', 'AG']];
  for (let r = 12; r <= 29; r++) for (const [a, b] of spans) merges.push(`${a}${r}:${b}${r}`);
  for (const r of [31, 33]) merges.push(`A${r}:P${r}`, `Q${r}:AG${r}`);
  if (merges.length !== 142) throw new Error(`nazeel fixture: ${merges.length} merges`);
  const body = [...cells.keys()].sort((a, b) => a - b).map((r) => {
    const row = [...cells.get(r).entries()].sort((a, b) => a[0] - b[0]).map(([c, v]) => {
      const idx = typeof v === 'object' ? v.idx : si(String(v));
      return `<${p}c r="${col(c)}${r}" s="1" t="s"><${p}v>${idx}</${p}v></${p}c>`;
    }).join('');
    return `<${p}row r="${r}" spans="1:33">${row}</${p}row>`;
  }).join('');
  const ws = `${BOM}<?xml version="1.0" encoding="utf-8"?><${p}worksheet ${nsDecl} xmlns:r="${R}"><${p}dimension ref="A1:AG33"/><${p}sheetViews><${p}sheetView rightToLeft="1" workbookViewId="0"/></${p}sheetViews><${p}cols><${p}col min="1" max="33" width="4.5" customWidth="1"/></${p}cols><${p}sheetData>${body}</${p}sheetData><${p}mergeCells count="${merges.length}">${merges.map((m) => `<${p}mergeCell ref="${m}"/>`).join('')}</${p}mergeCells><${p}drawing r:id="${RID.drawing}"/></${p}worksheet>`;
  const sst = `${BOM}<?xml version="1.0" encoding="utf-8"?><${p}sst ${nsDecl} count="${strings.length}" uniqueCount="${strings.length}">${strings.map((x) => x.rich
    ? `<${p}si>${x.rich.map((t, k) => `<${p}r>${k ? '' : `<${p}rPr><${p}b/></${p}rPr>`}<${p}t xml:space="preserve">${esc(t)}</${p}t></${p}r>`).join('')}<${p}rPh sb="0" eb="2"><${p}t>${esc(x.phonetic)}</${p}t></${p}rPh></${p}si>`
    : `<${p}si><${p}t>${esc(x.s)}</${p}t></${p}si>`).join('')}</${p}sst>`;
  const wb = `${BOM}<?xml version="1.0" encoding="utf-8"?><${p}workbook ${nsDecl} xmlns:r="${R}"><${p}sheets><${p}sheet name="ReservationDashboard_Ar" sheetId="1" r:id="${RID.sheet}"/></${p}sheets></${p}workbook>`;
  const rel = (id, type, target) => `<Relationship Type="${R}/${type}" Target="${target}" Id="${id}"/>`;
  const rels = (items) => `${BOM}<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;
  const files = {
    '[Content_Types].xml': `${BOM}<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    '_rels/.rels': rels([rel(RID.wb, 'officeDocument', '/xl/workbook.xml')]),
    'xl/workbook.xml': wb,
    'xl/_rels/workbook.xml.rels': rels([rel(RID.styles, 'styles', '/xl/styles.xml'), rel(RID.ss, 'sharedStrings', '/xl/sharedStrings.xml'), rel(RID.sheet, 'worksheet', '/xl/worksheets/sheet1.xml')]),
    'xl/styles.xml': `${BOM}<?xml version="1.0" encoding="utf-8"?><${p}styleSheet ${nsDecl}><${p}cellXfs count="2"><${p}xf/><${p}xf/></${p}cellXfs></${p}styleSheet>`,
    'xl/worksheets/sheet1.xml': ws,
    'xl/worksheets/_rels/sheet1.xml.rels': rels([rel(RID.drawing, 'drawing', '/xl/drawings/drawing.xml')]),
    'xl/drawings/drawing.xml': `${BOM}<?xml version="1.0" encoding="utf-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>`,
    'xl/drawings/_rels/drawing.xml.rels': rels([rel(RID.image, 'image', '/xl/media/logo.png')]),
    'xl/media/logo.png': PNG,
    'xl/sharedStrings.xml': sst,
  };
  if (!withSheet) delete files['xl/worksheets/sheet1.xml'];
  return zip(files, deflate);
}
