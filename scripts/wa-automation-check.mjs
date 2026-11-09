// WhatsApp automation (9 Nov 2026; DECISIONS.md 2026-11-09 «WhatsApp automation») — offline, no key, nothing sent:
//   - the four templates of supabase/functions/wa-automation/templates.ts = the live definitions read through the
//     YCloud API on 9 Nov 2026 (whatsapp-templates.json), on BOTH numbers: body, footer, buttons, category, approved;
//   - the variables: the arrival reminder {{1}} first name · {{2}} branch · {{3}} ref · {{4}} the branch's maps_url (the
//     branch pages' own link), the review request {{3}} the branch's Google review link, the offer's date as the approved
//     sample writes it and its URL button suffix (Arabic /offers/, English via /offers/en/ → /en/offers/), from the
//     branch's own number, single-line parameters, Western digits;
//   - the opt-out words (any case, trimmed, hamza forms, the templates' quick reply) and what is NOT an opt-out;
//   - YCloud's webhook signature (t=…,s=HMAC-SHA256(secret, "t.body")), replay window, tampering;
//   - the opt-out reply copy, the 404 page's /offers/en/ mapping, the migration's schedules and switches (all off).
//   node scripts/wa-automation-check.mjs   (after build.py — it reads supabase/functions/booking-request/content.generated.json)
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  autoParams, autoPayload, firstName, isOptOut, normalizeReply, offerSuffix, PARAM_COUNT, renderTemplate, replyLocale, TEMPLATES, untilText, verifySignature,
} from '../supabase/functions/wa-automation/templates.ts';

const fails = [];
let checks = 0;
const E = (label, ok, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const c = JSON.parse(read('../supabase/functions/booking-request/content.generated.json'));
const live = JSON.parse(read('../supabase/functions/wa-automation/whatsapp-templates.json'));
const AR_DIGITS = /[٠-٩۰-۹]/;

// ── templates = the live definitions, both numbers ──
for (const [branch, acc] of Object.entries(live.accounts)) {
  for (const name of Object.keys(TEMPLATES)) {
    for (const L of ['ar', 'en']) {
      const t = acc.templates[`${name}.${L}`];
      const d = TEMPLATES[name][L];
      E(`${branch} ${name}.${L}: read and APPROVED`, t?.status === 'APPROVED');
      if (!t) continue;
      const comp = (type) => t.components.find((x) => x.type === type);
      E(`${branch} ${name}.${L}: category`, t.category === d.category, t.category);
      E(`${branch} ${name}.${L}: body`, comp('BODY')?.text === d.body);
      E(`${branch} ${name}.${L}: footer`, (comp('FOOTER')?.text ?? undefined) === d.footer);
      const lb = (comp('BUTTONS')?.buttons ?? []).map((b) => `${b.type}|${b.text}|${b.url ?? ''}`).join(';');
      E(`${branch} ${name}.${L}: buttons`, lb === (d.buttons ?? []).map((b) => `${b.type}|${b.text}|${b.url ?? ''}`).join(';'), lb);
      const n = (d.body.match(/\{\{\d+\}\}/g) ?? []).length;
      E(`${branch} ${name}.${L}: ${PARAM_COUNT[name]} variables`, n === PARAM_COUNT[name], String(n));
    }
  }
}

// ── variables and payloads ──
const branches = c.branches;
for (const b of branches) {
  E(`${b.slug}: a Google review link of its own`, /^https:\/\/g\.page\/r\/[A-Za-z0-9_-]+\/review$/.test(b.google_review_url));
  for (const L of ['ar', 'en']) {
    const base = { locale: L, branch: b.slug, to: '+966500000001', logId: '00000000-0000-4000-8000-000000000001' };
    const ar = autoParams(c, { ...base, template: 'arrival_reminder', name: 'محمد عبد الله', ref: 'AR-20261110-ABCD' });
    E(`${b.slug} ${L} arrival: {{1}} first name · {{2}} branch · {{3}} ref · {{4}} maps_url`, JSON.stringify(ar) === JSON.stringify(['محمد', b[`name_${L}`], 'AR-20261110-ABCD', b.maps_url]), JSON.stringify(ar));
    const rv = autoParams(c, { ...base, template: 'stay_review', name: 'Sara Ali' });
    E(`${b.slug} ${L} review: {{3}} = the branch's review link`, JSON.stringify(rv) === JSON.stringify(['Sara', b[`name_${L}`], b.google_review_url]), JSON.stringify(rv));
    const wl = autoPayload(c, { ...base, template: 'eyab_welcome' });
    E(`${b.slug} ${L} welcome: from the branch's own number, no variable`, wl.from === b.whatsapp && wl.template.components.length === 0 && wl.template.language.code === L && wl.template.name === 'eyab_welcome');
    const vars = { title: 'عرض نهاية الأسبوع', details: 'ليلتان بسعر خاص\nللأعضاء', until: '2026-11-30', offer: 'weekend-offer' };
    const op = autoPayload(c, { ...base, template: 'eyab_offer', vars, campaign: '1a2b3c4d-0000-4000-8000-000000000000' });
    const body = op.template.components.find((x) => x.type === 'body').parameters.map((p) => p.text);
    const btn = op.template.components.find((x) => x.type === 'button');
    E(`${b.slug} ${L} offer: single-line variables, the date as approved`, JSON.stringify(body) === JSON.stringify(['عرض نهاية الأسبوع', 'ليلتان بسعر خاص للأعضاء', L === 'ar' ? '30 نوفمبر 2026' : '30 November 2026']), JSON.stringify(body));
    E(`${b.slug} ${L} offer: the URL button's suffix`, btn?.sub_type === 'url' && btn.index === '0' && btn.parameters[0].text === `${L === 'en' ? 'en/' : ''}?utm_source=whatsapp&utm_medium=eyab&utm_campaign=1a2b3c4d#offer-weekend-offer`, btn?.parameters?.[0]?.text);
    E(`${b.slug} ${L}: no Arabic-Indic digit in any variable`, ![...ar, ...rv, ...body].some((x) => AR_DIGITS.test(x)));
  }
}
E('arrival without a ref refuses', (() => { try { autoPayload(c, { template: 'arrival_reminder', locale: 'ar', branch: 'airport-road', to: '+966500000001', logId: 'x', name: 'أحمد' }); return false; } catch { return true; } })());
E('offer without variables refuses', (() => { try { autoPayload(c, { template: 'eyab_offer', locale: 'ar', branch: 'airport-road', to: '+966500000001', logId: 'x' }); return false; } catch { return true; } })());
E('firstName: one letter → the whole name', firstName('M Ali') === 'M Ali' && firstName('  أحمد   محمد ') === 'أحمد');
E('untilText ar / en', untilText(c, '2027-01-05', 'ar') === '5 يناير 2027' && untilText(c, '2027-01-05', 'en') === '5 January 2027');
E('offerSuffix without an offer: no anchor', offerSuffix('ar', 'abcdef123', '') === '?utm_source=whatsapp&utm_medium=eyab&utm_campaign=abcdef12');
const prev = renderTemplate('eyab_offer', 'ar', ['عرض', 'تفاصيل', '30 نوفمبر 2026'], '?x=1');
E('preview: the body as the guest sees it, footer, buttons', prev.body === 'عرض لأعضاء إياب: عرض\nتفاصيل\nصالح حتى 30 نوفمبر 2026.\nللحجز أو الاستفسار، رد على هذه الرسالة.'
  && prev.footer === 'إياب — عضوية أرمادا ريزيدنس' && prev.buttons[0].url === 'https://armadaresidence.com/offers/?x=1' && prev.buttons[1].text === 'إلغاء الاشتراك' && prev.buttons[1].url === null);

// ── opt-out words ──
for (const t of ['إلغاء', ' إلغاء ', 'الغاء', 'إيقاف', 'ايقاف', 'إيقاف.', 'stop', 'STOP', 'Stop!', 'unsubscribe', 'Unsubscribe', 'UNSUBSCRIBE', 'إلغاء الاشتراك', 'الغاء  الاشتراك', 'إِلْغاء', 'إلغـاء']) {
  E(`opt-out: «${t}»`, isOptOut(t), normalizeReply(t));
}
for (const t of ['', 'إلغاء الحجز', 'stop please', 'لا تلغي', 'شكرا', 'stopped', 'أريد الإلغاء', 'unsubscribe me', 'Hello']) E(`not an opt-out: «${t}»`, !isOptOut(t));
E('reply language: Arabic letters → ar, else en', replyLocale('إيقاف') === 'ar' && replyLocale('STOP') === 'en' && replyLocale('Unsubscribe') === 'en');
for (const L of ['ar', 'en']) {
  const r = c.club_whatsapp[L].optout_reply;
  E(`opt-out reply ${L}: the membership's full name, short, one line`, r.includes(L === 'ar' ? 'إياب — عضوية أرمادا ريزيدنس' : 'Eyab — Armada Residence membership') && r.length <= 160 && !/[\r\n]/.test(r));
}
E('opt-out reply ar: singular address, no forbidden term', !/يمكنكم|تواصلوا|حجوزاتكم/.test(c.club_whatsapp.ar.optout_reply) && !/نادي أرمادا|اياب/.test(c.club_whatsapp.ar.optout_reply.replace('إياب', '')));

// ── the webhook signature ──
const secret = 'whsec_test_0123456789abcdef';
const raw = '{"type":"whatsapp.inbound_message.received","whatsappInboundMessage":{"from":"+966500000001","text":{"body":"stop"}}}';
const now = Date.UTC(2026, 10, 9, 10, 0, 0);
const t = String(Math.floor(now / 1000));
const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
E('signature: valid', await verifySignature(secret, `t=${t},s=${sig}`, raw, now));
E('signature: spaces in the header', await verifySignature(secret, `t=${t}, s=${sig}`, raw, now));
E('signature: tampered body refused', !(await verifySignature(secret, `t=${t},s=${sig}`, raw.replace('stop', 'STOP'), now)));
E('signature: another secret refused', !(await verifySignature('whsec_other', `t=${t},s=${sig}`, raw, now)));
E('signature: older than 5 minutes refused', !(await verifySignature(secret, `t=${t},s=${sig}`, raw, now + 301_000)));
E('signature: missing / malformed refused', !(await verifySignature(secret, null, raw, now)) && !(await verifySignature(secret, `t=${t}`, raw, now)) && !(await verifySignature('', `t=${t},s=${sig}`, raw, now)));

// ── the 404 page, the migration ──
const nf = read('../src/pages/404.astro');
E('404: /offers/en/ → /en/offers/ with the query and the anchor', /\/offers\\\/en\(\\\/\|\$\)/.test(nf) && nf.includes("location.replace('/en/offers/' + location.search + location.hash)"));
const mig = read('../supabase/migrations/20261109100000_wa_automation.sql');
E('cron: the arrival reminder at 16:00 Riyadh (13:00 UTC)', mig.includes("cron.schedule('wa-arrival-reminder', '0 13 * * *'"));
E('cron: the review request at 10:00 Riyadh (07:00 UTC)', mig.includes("cron.schedule('wa-stay-review', '0 7 * * *'"));
E('switches: the three automations OFF at both branches', ['wa_eyab_welcome', 'wa_arrival_reminder', 'wa_stay_review'].every((k) => mig.includes(`('${k}', '{"airport-road": false, "shafa-road": false}'::jsonb)`)));
E('review request: confirmed only, departed yesterday, no satisfaction filter', /r\.status = 'confirmed' and r\.check_out = internal\.riyadh_today\(\) - 1/.test(mig) && !/rating|satisf/i.test(mig.split('wa_review_tick')[1].split('$$;')[0]));
const cfg = read('../supabase/config.toml');
E('config: wa-automation verify_jwt = false (cron, webhook)', /\[functions\.wa-automation\]\nverify_jwt = false/.test(cfg));

if (fails.length) {
  console.error(`wa-automation-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`wa-automation-check: ${checks} checks passed`);
