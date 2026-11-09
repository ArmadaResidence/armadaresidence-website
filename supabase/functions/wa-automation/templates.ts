/**
 * WhatsApp automation (9 Nov 2026; DECISIONS.md 2026-11-09 «WhatsApp automation»): the four Meta-approved templates of
 * «إياب» and the stay, as read through the YCloud API on 9 Nov 2026 (GET /v2/whatsapp/templates/{waba}/{name}/{lang}) —
 * the same definitions, all APPROVED, on both branch numbers (Airport Road WABA 3187536471439127, Shafa Road
 * 329667206894245). Never edited or resubmitted from here: a new wording is a new template approved by Meta first.
 *
 *   eyab_welcome      MARKETING  no variable; a quick reply «إلغاء الاشتراك» / "Unsubscribe"
 *   eyab_offer        MARKETING  {{1}} title · {{2}} details · {{3}} valid until (30 نوفمبر 2026 / 30 November 2026);
 *                                URL button https://armadaresidence.com/offers/{{1}} (the suffix: the query string and
 *                                the #offer-<slug> anchor; "en/…" for English — the 404 page sends /offers/en/ to
 *                                /en/offers/ with both kept); a quick reply «إلغاء الاشتراك» / "Unsubscribe"
 *   arrival_reminder  UTILITY    {{1}} first name · {{2}} branch name · {{3}} ref · {{4}} the branch's map link (maps_url)
 *   stay_review       UTILITY    {{1}} first name · {{2}} branch name · {{3}} the branch's Google review link
 *
 * Pure TypeScript with erasable syntax only: the Edge Function sends with it, the dashboard previews with it
 * (admin/src/pages/EyabWhatsApp.tsx) and scripts/wa-automation-check.mjs tests it under Node.
 */

// deno-lint-ignore no-explicit-any
type Content = any;
export type Locale = 'ar' | 'en';
export type AutoTemplate = 'eyab_welcome' | 'eyab_offer' | 'arrival_reminder' | 'stay_review';

export interface TemplateDef {
  category: 'MARKETING' | 'UTILITY';
  body: string;
  footer?: string;
  buttons?: { type: 'URL' | 'QUICK_REPLY'; text: string; url?: string }[];
}

export const TEMPLATE_READ_AT = '2026-11-09';
export const TEMPLATES: Record<AutoTemplate, Record<Locale, TemplateDef>> = {
  eyab_welcome: {
    ar: { category: 'MARKETING', body: 'حيّاك دايم. تم تسجيلك في إياب، عضوية أرمادا ريزيدنس. ستصلك عروض الأعضاء الخاصة هنا وعلى بريدك الإلكتروني لزيارتك القادمة.', buttons: [{ type: 'QUICK_REPLY', text: 'إلغاء الاشتراك' }] },
    en: { category: 'MARKETING', body: "Always welcome. You've joined Eyab, the Armada Residence membership. Special member offers will reach you here and by email for your next visit.", buttons: [{ type: 'QUICK_REPLY', text: 'Unsubscribe' }] },
  },
  eyab_offer: {
    ar: {
      category: 'MARKETING',
      body: 'عرض لأعضاء إياب: {{1}}\n{{2}}\nصالح حتى {{3}}.\nللحجز أو الاستفسار، رد على هذه الرسالة.',
      footer: 'إياب — عضوية أرمادا ريزيدنس',
      buttons: [{ type: 'URL', text: 'تفاصيل العرض', url: 'https://armadaresidence.com/offers/{{1}}' }, { type: 'QUICK_REPLY', text: 'إلغاء الاشتراك' }],
    },
    en: {
      category: 'MARKETING',
      body: 'An offer for Eyab members: {{1}}\n{{2}}\nValid until {{3}}.\nTo book or ask, reply to this message.',
      footer: 'Eyab — Armada Residence membership',
      buttons: [{ type: 'URL', text: 'Offer details', url: 'https://armadaresidence.com/offers/{{1}}' }, { type: 'QUICK_REPLY', text: 'Unsubscribe' }],
    },
  },
  arrival_reminder: {
    ar: {
      category: 'UTILITY',
      body: 'مرحبًا {{1}}،\nنذكّرك بوصولك غدًا إلى {{2}}، حجز رقم {{3}}.\nتسجيل الدخول من الساعة 4:00 عصرًا. الموقع على الخريطة: {{4}}\nإذا كنت ستصل بعد منتصف الليل أو تحتاج أي ترتيب، رد على هذه الرسالة.',
      footer: 'إلغاء مجاني حتى 2:00 ظهرًا يوم الوصول',
    },
    en: {
      category: 'UTILITY',
      body: "Hello {{1}},\nA reminder of your arrival tomorrow at {{2}}, booking {{3}}.\nCheck-in is from 4:00 pm. Location: {{4}}\nIf you'll arrive after midnight or need anything arranged, reply to this message.",
      footer: 'Free cancellation until 2:00 pm on arrival day',
    },
  },
  stay_review: {
    ar: { category: 'UTILITY', body: 'مرحبًا {{1}}،\nشكرًا لإقامتك في {{2}}. رأيك يساعدنا ويساعد ضيوفًا غيرك.\nلو تسمح بدقيقة لتقييم إقامتك على خرائط Google: {{3}}\nوإن كان هناك ما لم يعجبك، رد على هذه الرسالة ونحن نتابعه معك.' },
    en: { category: 'UTILITY', body: "Hello {{1}},\nThank you for staying at {{2}}. Your opinion helps us and other guests.\nIf you have a minute to rate your stay on Google Maps: {{3}}\nAnd if anything fell short, reply to this message and we'll follow up with you." },
  },
};
export const PARAM_COUNT: Record<AutoTemplate, number> = { eyab_welcome: 0, eyab_offer: 3, arrival_reminder: 4, stay_review: 3 };

/** the campaign variables of one language (eyab_campaigns.vars[L]) */
export interface OfferVars {
  title: string;
  details: string;
  /** ISO date */
  until: string;
  /** a live offer's slug for #offer-<slug>, or '' */
  offer: string;
}

export interface AutoMessage {
  template: AutoTemplate;
  locale: Locale;
  branch: string;
  /** E.164 */
  to: string;
  /** our log row id — YCloud's externalId */
  logId: string;
  /** a guest's full name (the first name is used) */
  name?: string | null;
  ref?: string | null;
  vars?: OfferVars | null;
  /** the campaign id (utm_campaign) */
  campaign?: string | null;
}

export interface AutoPayload {
  from: string;
  to: string;
  type: 'template';
  externalId: string;
  template: {
    name: AutoTemplate;
    language: { code: Locale };
    components: ({ type: 'body'; parameters: { type: 'text'; text: string }[] } | { type: 'button'; sub_type: 'url'; index: string; parameters: { type: 'text'; text: string }[] })[];
  };
}

// WhatsApp refuses a parameter with a newline, a tab or more than four spaces in a row
export const cleanParam = (s: unknown) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();

export function branchOf(c: Content, slug: string) {
  const b = c.branches.find((x: { slug: string }) => x.slug === slug);
  if (!b) throw new Error(`unknown branch ${slug}`);
  return b;
}

/** the guest's first name: the first word of the stored name (the whole name when that word is a single letter) */
export function firstName(name: string | null | undefined): string {
  const n = cleanParam(name);
  const w = n.split(' ')[0] ?? '';
  return w.length >= 2 ? w : n;
}

/** «30 نوفمبر 2026» / "30 November 2026" (Western digits — the approved samples) */
export function untilText(c: Content, iso: string, L: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) throw new Error('until: an ISO date');
  const months: string[] = c.datepicker[L].months;
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** the URL button's {{1}}: after https://armadaresidence.com/offers/ */
export function offerSuffix(L: Locale, campaign: string | null | undefined, offer: string | null | undefined): string {
  const q = `?utm_source=whatsapp&utm_medium=eyab&utm_campaign=${encodeURIComponent(String(campaign ?? 'eyab').slice(0, 8) || 'eyab')}`;
  const anchor = offer && /^[a-z0-9][a-z0-9-]{0,79}$/.test(offer) ? `#offer-${offer}` : '';
  return `${L === 'en' ? 'en/' : ''}${q}${anchor}`;
}

/** the body variables, in order ({{1}} first) */
export function autoParams(c: Content, m: AutoMessage): string[] {
  const L: Locale = m.locale === 'en' ? 'en' : 'ar';
  const b = branchOf(c, m.branch);
  const branch = String(b[`name_${L}`]);
  switch (m.template) {
    case 'eyab_welcome':
      return [];
    case 'eyab_offer': {
      if (!m.vars) throw new Error('eyab_offer needs the campaign variables');
      return [m.vars.title, m.vars.details, untilText(c, m.vars.until, L)].map(cleanParam);
    }
    case 'arrival_reminder':
      if (!m.ref) throw new Error('arrival_reminder needs the ref');
      return [firstName(m.name), branch, m.ref, String(b.maps_url)].map(cleanParam);
    case 'stay_review':
      return [firstName(m.name), branch, String(b.google_review_url)].map(cleanParam);
  }
}

/** the YCloud send body: from the branch's own number, in the guest's language */
export function autoPayload(c: Content, m: AutoMessage): AutoPayload {
  const L: Locale = m.locale === 'en' ? 'en' : 'ar';
  const b = branchOf(c, m.branch);
  const params = autoParams(c, m);
  if (params.some((p) => !p) || params.length !== PARAM_COUNT[m.template]) throw new Error(`${m.template}: a variable is empty`);
  const components: AutoPayload['template']['components'] = [];
  if (params.length) components.push({ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) });
  if (m.template === 'eyab_offer') components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: offerSuffix(L, m.campaign, m.vars?.offer) }] });
  return { from: String(b.whatsapp), to: m.to, type: 'template', externalId: m.logId, template: { name: m.template, language: { code: L }, components } };
}

/** what the guest sees: the body with the variables filled, the footer, the buttons (the dashboard's preview) */
export function renderTemplate(template: AutoTemplate, L: Locale, params: string[], suffix = ''): { body: string; footer: string | null; buttons: { text: string; url: string | null }[] } {
  const d = TEMPLATES[template][L];
  const body = d.body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? `{{${i}}}`);
  return {
    body,
    footer: d.footer ?? null,
    buttons: (d.buttons ?? []).map((x) => ({ text: x.text, url: x.url ? x.url.replace('{{1}}', suffix) : null })),
  };
}

/**
 * Is this inbound text an opt-out? «إلغاء» / «إيقاف» / "stop" / "unsubscribe" (Ahmed, 9 Nov 2026) and the templates' own
 * quick reply «إلغاء الاشتراك» — any case, trimmed; the hamza forms of alef, tatweel, diacritics and a trailing
 * punctuation mark are ignored («الغاء», «ايقاف», "STOP.").
 */
const OPT_OUT = new Set(['الغاء', 'ايقاف', 'الغاء الاشتراك', 'stop', 'unsubscribe']);
export function normalizeReply(text: string): string {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .toLowerCase()
    .replace(/[\s‌-‏‪-‮]+/g, ' ')
    .trim()
    .replace(/^[\s.!?؟،,؛:"'«»()-]+|[\s.!?؟،,؛:"'«»()-]+$/g, '')
    .trim();
}
export const isOptOut = (text: string) => OPT_OUT.has(normalizeReply(text));
/** the language of the reply: Arabic when the guest wrote Arabic letters */
export const replyLocale = (text: string): Locale => (/[؀-ۿ]/.test(String(text ?? '')) ? 'ar' : 'en');

/**
 * YCloud's webhook signature (docs: "Implement a webhook receiver"): header `YCloud-Signature: t=<unix s>,s=<hex>`,
 * s = HMAC-SHA256(secret, `${t}.${raw body}`), compared in constant time; older than 5 minutes = refused.
 */
export function parseSignature(h: string | null): { t: string; s: string } | null {
  const parts = Object.fromEntries(String(h ?? '').split(',').map((p) => p.trim().split('=').map((x) => x.trim())).filter((p) => p.length === 2));
  return /^[0-9]{9,11}$/.test(parts.t ?? '') && /^[a-fA-F0-9]{64}$/.test(parts.s ?? '') ? { t: parts.t, s: parts.s.toLowerCase() } : null;
}
export async function verifySignature(secret: string, header: string | null, raw: string, nowMs = Date.now()): Promise<boolean> {
  const sig = parseSignature(header);
  if (!secret || !sig) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - Number(sig.t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${sig.t}.${raw}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  let r = 0;
  for (let i = 0; i < hex.length; i++) r |= hex.charCodeAt(i) ^ sig.s.charCodeAt(i);
  return r === 0;
}
