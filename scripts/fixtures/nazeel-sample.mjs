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
