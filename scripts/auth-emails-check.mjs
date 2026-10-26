// Dashboard staff emails (Ahmed, 26 Oct 2026) — static, in the mandatory suite: the Supabase Auth templates and the
// sign-in code email share the booking emails' layout and stay correct.
//   - supabase/templates/invite.html + recovery.html equal what scripts/auth-templates.mjs renders (stale → regenerate)
//   - the logo is the hosted PNG over https (never SVG) with width, height and alt «أرمادا ريزيدنس»; porcelain page,
//     navy header, bronze button, the legal footer line; the English part in a dir="ltr" section aligned left; the
//     fallback label «إن لم يعمل الزر، انسخ هذا الرابط:» with the link; GoTrue's placeholders and the right type
//   - no stray Go-template action besides {{ .SiteURL }} / {{ .TokenHash }}
//   - supabase/config.toml declares both templates with the same AR- subjects as ui.json → staff_email
//   - the sign-in code email: AR- subject without the code, code in the body (HTML and text), no code in the preheader
//   - every email (staff, booking, partner): the reversed logo, the two fixed legal lines, CR / VAT never breakable or
//     auto-linked, the number-detection guards (26 Oct 2026)
//   node scripts/auth-emails-check.mjs
import { readFileSync } from 'node:fs';
import { KINDS, goLink, loadContent, renderAuthTemplates } from './auth-templates.mjs';
import { bookingConfirmation, bookingNotification, loginCodeMail, partnerConfirmation } from '../supabase/functions/booking-request/email.ts';

const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};

const c = loadContent();
const rendered = renderAuthTemplates(c);
const toml = readFileSync('supabase/config.toml', 'utf8');
const LOGO = /<img src="(https:\/\/[^"]+\/email\/armada-residence-logo-reversed@2x\.png)" width="(\d+)" height="(\d+)" alt="([^"]+)"/;

// every email (26 Oct 2026, Ahmed): the reversed logo on the navy band, two fixed legal lines per language, the CR and VAT
// numbers never breakable and never auto-linked (no-break span in the text colour + zero-width non-joiners), and the
// no-detection meta / styles
const ZWNJ = '&#8204;';
const protectedNumber = (n) => `<span class="nolink" style="white-space:nowrap; color:inherit; text-decoration:none;">${String(n).replace(/(\d{3})(?=\d)/g, `$1${ZWNJ}`)}</span>`;
function footerChecks(kind, html, langs = ['ar', 'en']) {
  check(/armada-residence-logo-reversed@2x\.png/.test(c.email_logo_url) && html.includes(`src="${c.email_logo_url}"`), `${kind}: the header logo is not the reversed PNG`);
  for (const L of langs) {
    const g = c.legal[L];
    check(html.includes(`>${g.entity}</p>`), `${kind}: footer line 1 (${L}) is not the entity alone`);
    const line2 = `<span style="white-space:nowrap;">${g.cr_label} ${protectedNumber(g.cr)}</span> &middot; <span style="white-space:nowrap;">${g.vat_label} ${protectedNumber(g.vat)}</span>`;
    check(html.includes(line2), `${kind}: footer line 2 (${L}) is not «${g.cr_label} … · ${g.vat_label} …» with protected numbers`);
  }
  check(!html.includes(c.legal.ar.cr) && !html.includes(c.legal.ar.vat), `${kind}: a raw CR / VAT number (auto-linkable) in the HTML`);
  check(html.includes('<meta name="format-detection" content="telephone=no') && html.includes('a[x-apple-data-detectors]') && html.includes('<body id="body"'), `${kind}: number-detection guards missing`);
  check(!/©|\{year\}/.test(html.slice(html.lastIndexOf('<tr><td class="pxf" align="center"'))), `${kind}: the old © {year} legal line is back`);
}

for (const kind of KINDS) {
  const file = readFileSync(`supabase/templates/${kind}.html`, 'utf8');
  check(file === `${rendered[kind].html}\n`, `${kind}.html is stale — run: node scripts/auth-templates.mjs`);
  const html = rendered[kind].html;
  const S = { ar: c.staff_email.ar, en: c.staff_email.en };
  const logo = html.match(LOGO);
  check(!!logo, `${kind}: no hosted PNG logo with width / height / alt`);
  if (logo) {
    check(logo[1] === c.email_logo_url, `${kind}: logo URL ${logo[1]} is not the booking emails' hosted PNG ${c.email_logo_url}`);
    check(Number(logo[2]) > 0 && Number(logo[3]) > 0, `${kind}: logo width / height missing`);
    check(logo[4] === 'أرمادا ريزيدنس', `${kind}: logo alt «${logo[4]}»`);
  }
  check(!/\.svg/i.test(html), `${kind}: an SVG reference`);
  check(/bgcolor="#142A3B"/.test(html) && /background:#F3EFE7/.test(html), `${kind}: navy header / porcelain page missing`);
  check(html.includes('background:#976E47'), `${kind}: bronze button missing`);
  footerChecks(kind, html);
  check(/<div dir="ltr" lang="en" style="text-align:left;/.test(html) && /<div dir="rtl" lang="ar" style="text-align:right;/.test(html), `${kind}: the Arabic RTL and English LTR sections are not separate`);
  check(html.includes(S.ar.fallback_label) && html.includes(S.en.fallback_label), `${kind}: fallback label missing`);
  const link = goLink(kind).replace(/&/g, '&amp;');
  check(html.split(link).length - 1 >= 4, `${kind}: the Go-template link should appear in both buttons and both fallbacks`);
  const actions = html.match(/\{\{[^}]*\}\}/g) ?? [];
  check(actions.every((a) => a === '{{ .SiteURL }}' || a === '{{ .TokenHash }}'), `${kind}: unexpected Go-template action ${actions.find((a) => a !== '{{ .SiteURL }}' && a !== '{{ .TokenHash }}')}`);
  check((html.match(/\{\{/g) ?? []).length === actions.length, `${kind}: a lone "{{" in the template`);
  check(html.includes(S.ar[kind].heading) && html.includes(S.en[kind].heading), `${kind}: headings missing`);
  // config.toml: declared, same subject, AR- tag
  const block = toml.match(new RegExp(`\\[auth\\.email\\.template\\.${kind}\\]\\s*\\nsubject = "([^"]+)"\\s*\\ncontent_path = "([^"]+)"`));
  check(!!block, `config.toml: [auth.email.template.${kind}] not declared`);
  if (block) {
    check(block[1] === S.ar[kind].subject, `config.toml: ${kind} subject «${block[1]}» ≠ ui.json «${S.ar[kind].subject}»`);
    check(block[1].includes('AR-'), `config.toml: ${kind} subject has no AR- tag`);
    check(block[2] === `./supabase/templates/${kind}.html`, `config.toml: ${kind} content_path ${block[2]}`);
  }
}

// the sign-in code email
const m = loginCodeMail(c, { code: '482917', requestedAt: '2026-10-26T12:41:00Z', device: 'Chrome · Windows' });
check(m.subject === c.staff_email.ar.login_code.subject && m.subject.includes('AR-') && !/\d{6}/.test(m.subject), `login code: subject «${m.subject}»`);
check(m.html.includes('>482917<') && m.text.includes('482917'), 'login code: the code is not in the HTML and the text part');
check(!c.staff_email.ar.login_code.preheader.match(/\d{6}/), 'login code: a code in the preheader');
check(m.html.includes('3:41 مساءً') && m.html.includes('3:41 pm'), 'login code: request time is not 12-hour Riyadh time');
check(!!m.html.match(LOGO) && /<div dir="ltr" lang="en" style="text-align:left;/.test(m.html), 'login code: logo / English section');
footerChecks('login code', m.html);
check(m.text.includes(`${c.legal.ar.entity}
${c.legal.ar.cr_label} ${c.legal.ar.cr} · ${c.legal.ar.vat_label} ${c.legal.ar.vat}`), 'login code: the text part ends with the two legal lines');

// the booking and partner emails share the same header and footer
const sample = { ref: 'AR-20991231-TEST', locale: 'ar', branch: 'airport-road', room: 'one-bedroom-suite', check_in: '2099-12-01', check_out: '2099-12-04', nights: 3,
  adults: 2, children: 0, extraBeds: 0, extraBedFee: 50, needsCoordination: false, capacity: 2, breakfast: 'without', name: 'تجربة النظام', phone: '+966500000000',
  email: 'guest@example.com', notes: '', receivedAt: 'TEST' };
footerChecks('booking notification', bookingNotification(c, sample).html, ['ar']);
footerChecks('booking confirmation', bookingConfirmation(c, sample).html);
footerChecks('partner confirmation', partnerConfirmation(c, { ...sample, requestType: 'umrah-group', organisation: 'شركة تجربة', roomsRequested: 10, meals: '' }).html);

if (fails.length) {
  console.error(`auth-emails-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`auth-emails-check: ${checks}/${checks} passed`);
