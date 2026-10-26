// Supabase Auth email templates (invite, recovery) rendered from the booking emails' layout (Ahmed, 26 Oct 2026):
// supabase/functions/booking-request/email.ts → staffLinkMail with the Go-template link GoTrue fills in. The output is
// committed in supabase/templates/ and pushed with `supabase config push` (declared keys only, supabase/config.toml).
//   node scripts/auth-templates.mjs           write supabase/templates/invite.html + recovery.html
// scripts/auth-emails-check.mjs (mandatory suite, static) fails when the committed files differ from this output.
// Needs supabase/functions/booking-request/content.generated.json (python build.py writes it).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { staffLinkMail } from '../supabase/functions/booking-request/email.ts';

export const KINDS = ['invite', 'recovery'];
/** GoTrue fills {{ .SiteURL }} (Auth → URL configuration: https://admin.armadaresidence.com) and {{ .TokenHash }} */
export const goLink = (kind) => `{{ .SiteURL }}/set-password?token_hash={{ .TokenHash }}&type=${kind}`;

export function loadContent() {
  return JSON.parse(readFileSync('supabase/functions/booking-request/content.generated.json', 'utf8'));
}

/** { invite: {subject, html, text}, recovery: {…} } — html is exactly what the template file holds */
export function renderAuthTemplates(content = loadContent()) {
  return Object.fromEntries(KINDS.map((kind) => [kind, staffLinkMail(content, { kind, link: goLink(kind) })]));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = renderAuthTemplates();
  for (const kind of KINDS) {
    writeFileSync(`supabase/templates/${kind}.html`, `${out[kind].html}\n`);
    console.log(`✓ supabase/templates/${kind}.html — ${out[kind].subject}`);
  }
}
