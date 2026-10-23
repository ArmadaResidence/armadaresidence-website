/**
 * Email layout for the four booking-request emails (Part C, 23 Oct 2026): booking notification, booking
 * "request received" to the guest, partner notification, partner confirmation.
 *
 * One shared, Outlook-safe frame: table layout, inline CSS (plus a <style> block only for the mobile and dark-mode
 * overrides that clients honour), max-width 600 px, bulletproof buttons (VML for Outlook, a styled <a> elsewhere),
 * a hidden preheader, color-scheme meta for dark mode, and a real text/plain part for every message. Brand: navy
 * #142A3B, bronze #A97C50, porcelain #F3EFE7 (emails cannot read the site's CSS variables, so the hex values are
 * inline here). Fonts: IBM Plex Sans Arabic / Manrope with safe fallback stacks. The only image is the logo, a 2x
 * PNG of the approved SVG (emails cannot show SVG — scripts/email-logo.mjs).
 *
 * Pure TypeScript with erasable syntax only and no runtime imports: the Edge Function (Deno) sends it and
 * scripts/email-preview.mjs (Node) renders the same output for review. Copy comes only from content/ (approved);
 * no wording is written here.
 */

// deno-lint-ignore no-explicit-any
type Content = any;
type Locale = 'ar' | 'en';

export interface Mail {
  subject: string;
  html: string;
  text: string;
}

export interface BookingMail {
  ref: string;
  locale: Locale;
  branch: string;
  room: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  breakfast: 'with' | 'without';
  name: string;
  phone: string;
  email: string;
  notes: string;
  receivedAt: string;
}

export interface PartnerMail {
  ref: string;
  locale: Locale;
  requestType: string;
  organisation: string;
  branch: string;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  rooms: number | null;
  meals: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  receivedAt: string;
}

// ── palette (brand 2026) ──────────────────────────────────────────────────────────────────────────────────────
const NAVY = '#142A3B';
const BRONZE = '#A97C50';
const BRONZE_DEEP = '#976E47'; // white text ≥ 4.5:1
const PORCELAIN = '#F3EFE7';
const WHITE = '#FFFFFF';
const INK = '#142A3B';
const MUTED = '#4A5A66'; // 7.1:1 on white, 6.3:1 on porcelain
const LINE = '#E3DBCF';
const FONT = {
  ar: "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif",
  en: "Manrope, 'Segoe UI', Helvetica, Arial, sans-serif",
};
/** Branch tag colours for the reception notification (distinct per branch, white text ≥ 4.5:1). */
const BRANCH_TAG: Record<string, string> = { 'airport-road': BRONZE_DEEP, 'shafa-road': NAVY };

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
export function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
function fill(t: string, vars: Record<string, string>): string {
  return String(t ?? '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
function pluralForm(forms: Record<string, string>, n: number): string {
  const k = n === 1 ? 'one' : n === 2 ? 'two' : n >= 3 && n <= 10 ? 'few' : 'many';
  return String(forms[k] ?? '{n}').replace('{n}', String(n));
}
const wa = (e164: string, text?: string) => `https://wa.me/${String(e164).replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
const tel = (e164: string) => `tel:${String(e164).replace(/[^\d+]/g, '')}`;
const year = () => String(new Date().getFullYear());

function branchOf(c: Content, slug: string) {
  return c.branches.find((b: { slug: string }) => b.slug === slug) ?? c.branches[0];
}
function branchName(c: Content, slug: string, L: Locale): string {
  if (slug === 'both') return c.branches.map((b: Record<string, string>) => b[`name_${L}`]).join(' + ');
  return branchOf(c, slug)[`name_${L}`];
}
function roomName(c: Content, slug: string, branch: string, L: Locale): string {
  const r = slug ? c.rooms.find((x: { slug: string; branch: string }) => x.slug === slug && x.branch === branch) : null;
  return r ? r[`name_${L}`] : c.labels[L].any_room;
}
function guestsLine(c: Content, adults: number, children: number, L: Locale): string {
  const P = c.labels[L].plural;
  return children ? `${pluralForm(P.adults, adults)} · ${pluralForm(P.children, children)}` : pluralForm(P.adults, adults);
}

// ── frame ─────────────────────────────────────────────────────────────────────────────────────────────────────
function doc(opts: { lang: Locale; title: string; preheader: string; body: string }): string {
  const dir = opts.lang === 'ar' ? 'rtl' : 'ltr';
  // the preheader is followed by invisible spacers so clients do not pull body text into the preview line
  const spacer = '&#8199;&#65279;&#847;'.repeat(40);
  return `<!DOCTYPE html>
<html lang="${opts.lang}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(opts.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media (max-width: 520px) {
    .container { width:100% !important; }
    .px { padding-left:20px !important; padding-right:20px !important; }
    .stack, .stack > tbody, .stack > tbody > tr, .stack td.btn-cell { display:block !important; width:100% !important; }
    .stack td.btn-cell { padding:0 0 10px 0 !important; }
    .stack td.btn-cell a { display:block !important; }
    .kv td { display:block !important; width:100% !important; padding:2px 0 !important; }
    .kv td.k { padding-top:10px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg-page { background:#0F1F2B !important; }
    .bg-card { background:#182F41 !important; }
    .bg-soft { background:#0F1F2B !important; }
    .t-ink { color:#F3EFE7 !important; }
    .t-muted { color:#C7CFD6 !important; }
    .t-bronze { color:#C9A27A !important; }
    .bd { border-color:#2A4357 !important; }
    .pill { background:#0F1F2B !important; color:#F3EFE7 !important; }
    .btn-ghost { background:#182F41 !important; color:#F3EFE7 !important; }
    .btn-solid { background:#976E47 !important; border-color:#976E47 !important; }
  }
  [data-ogsc] .bg-page { background:#0F1F2B !important; }
  [data-ogsc] .bg-card { background:#182F41 !important; }
  [data-ogsc] .bg-soft { background:#0F1F2B !important; }
  [data-ogsc] .t-ink { color:#F3EFE7 !important; }
  [data-ogsc] .t-muted { color:#C7CFD6 !important; }
</style>
</head>
<body class="bg-page" style="margin:0; padding:0; background:${PORCELAIN};">
<div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${esc(opts.preheader)}${spacer}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" bgcolor="${PORCELAIN}" style="background:${PORCELAIN};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;">
${opts.body}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

function header(c: Content): string {
  const alt = `${c.brand.ar} | ${c.brand.en}`;
  return `<tr><td bgcolor="${NAVY}" align="center" style="background:${NAVY}; padding:28px 24px;">
<img src="${esc(c.email_logo_url)}" width="180" height="41" alt="${esc(alt)}" style="display:block; margin:0 auto; width:180px; max-width:180px; height:auto; color:${PORCELAIN}; font-family:${FONT.en}; font-size:18px;">
</td></tr>
<tr><td bgcolor="${BRONZE}" height="2" style="background:${BRONZE}; height:2px; font-size:0; line-height:0;">&nbsp;</td></tr>`;
}

function card(inner: string): string {
  return `<tr><td class="bg-card px" bgcolor="${WHITE}" style="background:${WHITE}; padding:32px 36px;">${inner}</td></tr>`;
}

function footer(c: Content, langs: Locale[]): string {
  const lines = langs
    .map((L) => `<p dir="${L === 'ar' ? 'rtl' : 'ltr'}" class="t-muted" style="margin:0 0 6px; font-family:${FONT[L]}; font-size:12px; line-height:18px; color:${MUTED};">${esc(fill(c.legal_line[L], { year: year() }))}</p>`)
    .join('');
  return `<tr><td class="px" align="center" style="padding:20px 36px 8px; text-align:center;">${lines}</td></tr>`;
}

function section(L: Locale, inner: string): string {
  const dir = L === 'ar' ? 'rtl' : 'ltr';
  const align = L === 'ar' ? 'right' : 'left';
  return `<div dir="${dir}" lang="${L}" style="text-align:${align}; font-family:${FONT[L]};">${inner}</div>`;
}

function headline(L: Locale, text: string): string {
  return `<h1 class="t-ink" style="margin:0 0 12px; font-family:${FONT[L]}; font-size:24px; line-height:32px; font-weight:700; color:${INK};">${esc(text)}</h1>`;
}
function para(L: Locale, text: string, opts: { muted?: boolean; size?: number } = {}): string {
  const color = opts.muted ? MUTED : INK;
  return `<p class="${opts.muted ? 't-muted' : 't-ink'}" style="margin:0 0 14px; font-family:${FONT[L]}; font-size:${opts.size ?? 16}px; line-height:${(opts.size ?? 16) + 10}px; color:${color};">${esc(text)}</p>`;
}
function subhead(L: Locale, text: string): string {
  return `<h2 class="t-bronze" style="margin:24px 0 10px; font-family:${FONT[L]}; font-size:13px; line-height:18px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#8A6239;">${esc(text)}</h2>`;
}
function refPill(L: Locale, label: string, ref: string): string {
  return `<p style="margin:0 0 20px; font-family:${FONT[L]};"><span class="t-muted" style="font-size:13px; color:${MUTED};">${esc(label)}</span><br>
<span class="pill" dir="ltr" style="display:inline-block; margin-top:6px; padding:7px 16px; border:1px solid ${BRONZE}; border-radius:999px; background:${PORCELAIN}; color:${INK}; font-family:${FONT.en}; font-size:16px; font-weight:700; letter-spacing:0.5px;">${esc(ref)}</span></p>`;
}
function hairline(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px; background:${BRONZE}; font-size:0; line-height:0;">&nbsp;</td></tr></table>`;
}
/** Values with no Arabic letters (phone, email, ref, dates, times) are isolated left-to-right so an RTL cell does
 *  not reorder them (e.g. "+966…" rendering as "…966+"). */
function ltrSafe(val: string): string {
  return /[؀-ۿ]/.test(val) ? esc(val) : `<span dir="ltr" style="unicode-bidi:isolate; direction:ltr;">${esc(val)}</span>`;
}
/** Key/value rows inside a soft card; stacks to one column on phones. */
function kvCard(L: Locale, rows: [string, string][]): string {
  const k = L === 'ar' ? 'right' : 'left';
  const body = rows
    .map(
      ([key, val], i) => `<tr>
<td class="k t-muted" width="38%" valign="top" style="padding:${i ? 9 : 0}px 0 0; text-align:${k}; font-family:${FONT[L]}; font-size:14px; line-height:20px; color:${MUTED};">${esc(key)}</td>
<td class="t-ink" valign="top" style="padding:${i ? 9 : 0}px 0 0; text-align:${k}; font-family:${FONT[L]}; font-size:15px; line-height:21px; font-weight:600; color:${INK};">${ltrSafe(val)}</td>
</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-soft bd" style="background:${PORCELAIN}; border:1px solid ${LINE}; border-radius:8px;">
<tr><td style="padding:16px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="kv" dir="${L === 'ar' ? 'rtl' : 'ltr'}">${body}</table></td></tr></table>`;
}
/** Bulletproof button: VML roundrect for Outlook, a padded <a> everywhere else. */
function button(L: Locale, href: string, label: string, variant: 'solid' | 'bronze' | 'ghost' = 'solid'): string {
  const bg = variant === 'solid' ? NAVY : variant === 'bronze' ? BRONZE_DEEP : WHITE;
  const fg = variant === 'ghost' ? INK : WHITE;
  const stroke = variant === 'ghost' ? `strokecolor="${BRONZE}" strokeweight="1px"` : 'stroke="f"';
  const border = variant === 'ghost' ? `border:1px solid ${BRONZE};` : `border:1px solid ${bg};`;
  const width = Math.max(150, Math.min(260, label.length * 9 + 48));
  return `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(href)}" style="height:44px; v-text-anchor:middle; width:${width}px;" arcsize="10%" ${stroke} fillcolor="${bg}"><w:anchorlock/><center style="color:${fg}; font-family:Arial, sans-serif; font-size:15px; font-weight:bold;">${esc(label)}</center></v:roundrect><![endif]--><!--[if !mso]><!-- --><a href="${esc(href)}" target="_blank" class="${variant === 'ghost' ? 'btn-ghost' : 'btn-solid'}" style="display:inline-block; padding:12px 22px; ${border} border-radius:4px; background:${bg}; color:${fg}; font-family:${FONT[L]}; font-size:15px; line-height:20px; font-weight:700; text-decoration:none; text-align:center;">${esc(label)}</a><!--<![endif]-->`;
}
function buttons(L: Locale, items: string[]): string {
  const cells = items.map((b) => `<td class="btn-cell" style="padding-${L === 'ar' ? 'left' : 'right'}:10px;">${b}</td>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="stack" dir="${L === 'ar' ? 'rtl' : 'ltr'}" style="margin:6px 0 4px;"><tr>${cells}</tr></table>`;
}
/** Between the Arabic and the English block: one bronze hairline with air around it. */
function langDivider(): string {
  return `<div style="height:28px; line-height:28px; font-size:0;">&nbsp;</div>${hairline()}<div style="height:28px; line-height:28px; font-size:0;">&nbsp;</div>`;
}
/** Form labels carry "(اختياري)" / "(optional)"; in a summary the hint is noise. */
const plainLabel = (s: string) => String(s ?? '').replace(/\s*[(（][^)）]*[)）]\s*$/, '');

// ── plain-text helpers ────────────────────────────────────────────────────────────────────────────────────────
const textRows = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join('\n');
const RULE = '----------------------------------------';

// ══ 1. Booking notification (reception, Arabic, work tool) ═══════════════════════════════════════════════════
export function bookingNotification(c: Content, d: BookingMail): Mail {
  const L: Locale = 'ar';
  const lab = c.labels.ar;
  const M = c.email.ar;
  const b = branchOf(c, d.branch);
  const tagBg = BRANCH_TAG[d.branch] ?? NAVY;
  const breakfast = d.breakfast === 'with' ? lab.breakfast_with : lab.breakfast_without;
  const rows: [string, string][] = [
    [M.ref, d.ref],
    [lab.branch, b.name_ar],
    [lab.check_in, d.check_in],
    [lab.check_out, d.check_out],
    [lab.nights, pluralForm(lab.plural.nights, d.nights)],
    [lab.adults, String(d.adults)],
    [lab.children, String(d.children)],
    [plainLabel(lab.room_type), roomName(c, d.room, d.branch, 'ar')],
    [lab.breakfast, breakfast],
    [lab.full_name, d.name],
    [lab.phone, d.phone],
    [plainLabel(lab.email), d.email || '—'],
    [plainLabel(lab.notes), d.notes || '—'],
    [M.language, d.locale],
    [M.received_at, d.receivedAt],
  ];
  const subject = fill(M.hotel_subject, { branch: b.name_ar, ref: d.ref });
  const inner = section(
    L,
    `<p style="margin:0 0 14px;"><span style="display:inline-block; padding:5px 12px; border-radius:999px; background:${tagBg}; color:${WHITE}; font-family:${FONT.ar}; font-size:13px; font-weight:700;">${esc(b.name_ar)}</span>
<span class="t-muted" dir="ltr" style="display:inline-block; margin-inline-start:8px; font-family:${FONT.en}; font-size:13px; color:${MUTED};">${esc(d.ref)} · ${esc(d.receivedAt)}</span></p>
${headline(L, M.hotel_intro)}
${buttons(L, [button(L, wa(d.phone), M.notif_wa_guest, 'solid'), button(L, tel(d.phone), M.notif_call, 'ghost')])}
<div style="height:18px; line-height:18px; font-size:0;">&nbsp;</div>
${kvCard(L, rows)}
<div style="height:16px; line-height:16px; font-size:0;">&nbsp;</div>
${para(L, d.email ? M.notif_reply_hint : M.notif_no_email, { muted: true, size: 13 })}
${para(L, M.hotel_footer, { muted: true, size: 12 })}`,
  );
  const html = doc({ lang: 'ar', title: subject, preheader: `${b.name_ar} · ${pluralForm(lab.plural.nights, d.nights)} · ${breakfast} — ${d.ref}`, body: header(c) + card(inner) + footer(c, ['ar']) });
  const text = [
    M.hotel_intro,
    '',
    textRows(rows),
    '',
    `${M.notif_wa_guest}: ${wa(d.phone)}`,
    `${M.notif_call}: ${tel(d.phone)}`,
    '',
    d.email ? M.notif_reply_hint : M.notif_no_email,
    M.hotel_footer,
  ].join('\n');
  return { subject, html, text };
}

// ══ 2. Booking "request received" (guest, Arabic first then English, premium) ════════════════════════════════
export function bookingConfirmation(c: Content, d: BookingMail): Mail {
  const b = branchOf(c, d.branch);
  const block = (L: Locale) => {
    const lab = c.labels[L];
    const M = c.email[L];
    const breakfast = d.breakfast === 'with' ? lab.breakfast_with : lab.breakfast_without;
    const rows: [string, string][] = [
      [lab.branch, b[`name_${L}`]],
      [lab.check_in, d.check_in],
      [lab.check_out, d.check_out],
      [lab.nights, pluralForm(lab.plural.nights, d.nights)],
      [M.guests, guestsLine(c, d.adults, d.children, L)],
      [plainLabel(lab.room_type), roomName(c, d.room, d.branch, L)],
      [lab.breakfast, breakfast],
    ];
    const waText = fill(c.wa_prefill[L].branch, { branch: b[`name_${L}`] });
    const html = section(
      L,
      `${headline(L, c.success_heading[L])}
${para(L, fill(M.guest_greeting, { name: d.name }))}
${para(L, fill(M.guest_body, { branch: b[`name_${L}`] }))}
${refPill(L, M.ref, d.ref)}
${subhead(L, M.guest_summary)}
${kvCard(L, rows)}
${subhead(L, M.next_heading)}
${para(L, M.next_guest)}
${subhead(L, M.branch_card)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bd" style="border:1px solid ${LINE}; border-radius:8px;"><tr><td style="padding:16px 18px;">
<p class="t-ink" style="margin:0 0 4px; font-family:${FONT[L]}; font-size:16px; line-height:24px; font-weight:700; color:${INK};">${esc(b[`name_${L}`])}</p>
<p class="t-muted" style="margin:0 0 6px; font-family:${FONT[L]}; font-size:14px; line-height:21px; color:${MUTED};">${esc(b[`address_${L}`])}</p>
<p class="t-muted" style="margin:0 0 12px; font-family:${FONT[L]}; font-size:14px; line-height:21px; color:${MUTED};">${esc(c.check_in_line[L])} · ${esc(c.check_out_line[L])}</p>
${buttons(L, [button(L, wa(b.whatsapp, waText), M.wa_button, 'solid'), button(L, b.maps_url, M.map_button, 'ghost')])}
</td></tr></table>
<div style="height:18px; line-height:18px; font-size:0;">&nbsp;</div>
${para(L, c.cancellation_line[L], { muted: true, size: 14 })}
${para(L, M.guest_footer, { muted: true, size: 13 })}`,
    );
    const text = [
      c.success_heading[L],
      fill(M.guest_greeting, { name: d.name }),
      fill(M.guest_body, { branch: b[`name_${L}`] }),
      '',
      `${M.ref}: ${d.ref}`,
      '',
      M.guest_summary,
      textRows(rows),
      '',
      M.next_heading,
      M.next_guest,
      '',
      `${M.branch_card}: ${b[`name_${L}`]}`,
      b[`address_${L}`],
      `${c.check_in_line[L]} · ${c.check_out_line[L]}`,
      `${M.wa_button}: ${wa(b.whatsapp, waText)}`,
      `${M.map_button}: ${b.maps_url}`,
      '',
      c.cancellation_line[L],
      M.guest_footer,
    ].join('\n');
    return { html, text };
  };
  const ar = block('ar');
  const en = block('en');
  const subject = `${fill(c.email.ar.guest_subject, { ref: d.ref })} | ${String(c.email.en.guest_subject).replace(' ({ref})', '')}`;
  const html = doc({
    lang: 'ar',
    title: subject,
    preheader: fill(c.email.ar.preheader_guest, { ref: d.ref }),
    body: header(c) + card(`${ar.html}${langDivider()}${en.html}`) + footer(c, ['ar', 'en']),
  });
  const text = `${ar.text}\n\n${RULE}\n\n${en.text}\n\n${fill(c.legal_line.ar, { year: year() })}\n${fill(c.legal_line.en, { year: year() })}`;
  return { subject, html, text };
}

// ══ 3. Partner notification (sales, Arabic, work tool) ═══════════════════════════════════════════════════════
export function partnerNotification(c: Content, d: PartnerMail): Mail {
  const L: Locale = 'ar';
  const pl = c.partner_labels.ar;
  const M = c.email.ar;
  const typeName = c.request_types.ar[d.requestType] ?? d.requestType;
  const rows: [string, string][] = [
    [M.ref, d.ref],
    [pl.reqtype, typeName],
    [pl.company, d.organisation || '—'],
    [pl.person, d.name],
    [pl.email, d.email || '—'],
    [pl.phone, d.phone],
    [pl.property, branchName(c, d.branch, 'ar')],
    [pl.checkin, d.check_in],
    [pl.checkout, d.check_out],
    [c.labels.ar.nights, pluralForm(c.labels.ar.plural.nights, d.nights)],
    [pl.guests, String(d.guests)],
    [pl.rooms, d.rooms === null ? '—' : String(d.rooms)],
    [pl.meals, d.meals ? (c.meal_labels?.ar?.[d.meals] ?? d.meals) : '—'],
    [pl.notes, d.notes || '—'],
    [M.language, d.locale],
    [M.received_at, d.receivedAt],
  ];
  const subject = fill(M.partner_subject, { organisation: d.organisation || d.name, ref: d.ref });
  const inner = section(
    L,
    `<p style="margin:0 0 14px;"><span style="display:inline-block; padding:5px 12px; border-radius:999px; background:${PORCELAIN}; border:1px solid ${BRONZE}; color:${INK}; font-family:${FONT.ar}; font-size:13px; font-weight:700;">${esc(typeName)}</span>
<span class="t-muted" dir="ltr" style="display:inline-block; margin-inline-start:8px; font-family:${FONT.en}; font-size:13px; color:${MUTED};">${esc(d.ref)} · ${esc(d.receivedAt)}</span></p>
${headline(L, M.partner_intro)}
${buttons(L, [button(L, wa(d.phone), M.notif_wa_guest, 'solid'), button(L, tel(d.phone), M.notif_call, 'ghost')])}
<div style="height:18px; line-height:18px; font-size:0;">&nbsp;</div>
${kvCard(L, rows)}
<div style="height:16px; line-height:16px; font-size:0;">&nbsp;</div>
${para(L, M.notif_reply_hint, { muted: true, size: 13 })}
${para(L, M.hotel_footer, { muted: true, size: 12 })}`,
  );
  const html = doc({ lang: 'ar', title: subject, preheader: `${typeName} · ${d.organisation || d.name} — ${d.ref}`, body: header(c) + card(inner) + footer(c, ['ar']) });
  const text = [M.partner_intro, '', textRows(rows), '', `${M.notif_wa_guest}: ${wa(d.phone)}`, `${M.notif_call}: ${tel(d.phone)}`, '', M.notif_reply_hint, M.hotel_footer].join('\n');
  return { subject, html, text };
}

// ══ 4. Partner confirmation (partner, Arabic first then English, premium) ════════════════════════════════════
export function partnerConfirmation(c: Content, d: PartnerMail): Mail {
  const block = (L: Locale) => {
    const M = c.email[L];
    const pl = c.partner_labels[L];
    const typeName = c.request_types[L][d.requestType] ?? d.requestType;
    const rows: [string, string][] = [
      [pl.company, d.organisation || '—'],
      [pl.person, d.name],
      [pl.reqtype, typeName],
      [pl.property, branchName(c, d.branch, L)],
      [pl.checkin, d.check_in],
      [pl.checkout, d.check_out],
      [c.labels[L].nights, pluralForm(c.labels[L].plural.nights, d.nights)],
      [pl.guests, String(d.guests)],
      [pl.rooms, d.rooms === null ? '—' : String(d.rooms)],
      [pl.meals, d.meals ? (c.meal_labels?.[L]?.[d.meals] ?? d.meals) : '—'],
      [pl.notes, d.notes || '—'],
    ];
    const waText = c.wa_prefill[L].partners;
    const html = section(
      L,
      `${headline(L, c.success_heading[L])}
${para(L, fill(M.guest_greeting, { name: d.name }))}
${para(L, M.partner_guest_body)}
${refPill(L, M.ref, d.ref)}
${subhead(L, M.partner_guest_summary)}
${kvCard(L, rows)}
${subhead(L, M.next_heading)}
${para(L, c.partner_reply_line[L])}
<p class="t-muted" style="margin:0 0 14px; font-family:${FONT[L]}; font-size:14px; line-height:24px; color:${MUTED};">${esc(M.partner_guest_whatsapp)} ${ltrSafe(c.sales_phone_display)}</p>
${buttons(L, [button(L, wa(c.sales_whatsapp, waText), M.wa_sales_button, 'solid')])}
<div style="height:14px; line-height:14px; font-size:0;">&nbsp;</div>
${para(L, M.partner_guest_footer, { muted: true, size: 13 })}`,
    );
    const text = [
      c.success_heading[L],
      fill(M.guest_greeting, { name: d.name }),
      M.partner_guest_body,
      '',
      `${M.ref}: ${d.ref}`,
      '',
      M.partner_guest_summary,
      textRows(rows),
      '',
      M.next_heading,
      c.partner_reply_line[L],
      `${M.partner_guest_whatsapp} ${c.sales_phone_display} — ${wa(c.sales_whatsapp, waText)}`,
      '',
      M.partner_guest_footer,
    ].join('\n');
    return { html, text };
  };
  const ar = block('ar');
  const en = block('en');
  const subject = `${fill(c.email.ar.partner_guest_subject, { ref: d.ref })} | ${c.email.en.partner_guest_subject}`;
  const html = doc({
    lang: 'ar',
    title: subject,
    preheader: fill(c.email.ar.preheader_partner, { ref: d.ref }),
    body: header(c) + card(`${ar.html}${langDivider()}${en.html}`) + footer(c, ['ar', 'en']),
  });
  const text = `${ar.text}\n\n${RULE}\n\n${en.text}\n\n${fill(c.legal_line.ar, { year: year() })}\n${fill(c.legal_line.en, { year: year() })}`;
  return { subject, html, text };
}
