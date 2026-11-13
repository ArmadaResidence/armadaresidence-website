/**
 * Guest Hub «مركز الضيوف» — what a staff send from the inbox puts on the wire (session H3, 13 Nov 2026; spec §6.2–§6.4,
 * templates.md §1; DECISIONS.md 2026-11-13 «Guest Hub H3 — the inbox»).
 *
 *   - hub_reply_ready: the only hub template in v1. {{1}} = the unit's name, filled by branchName() — the same function
 *     that fills the branch name in the booking templates (booking-request/whatsapp.ts); a dining unit takes its
 *     venue's name. The quick reply «متابعة المحادثة» carries the payload HUB_REPLY_READY_PAYLOAD: its tap arrives as an
 *     inbound message like any other, so the held answer goes on it (wa-automation → public.hub_held_claim).
 *   - typingUrl(): YCloud's «typing» call for the guest's last message — it marks the message read and shows «يكتب…».
 *     Called only just before a staff send goes out (spec §6.2), never on opening a thread.
 *
 * Pure TypeScript with erasable syntax only: hub-admin and wa-automation use it; scripts/whatsapp-check.mjs and
 * scripts/hub-webhook-check.mjs test it under Node.
 */
import defs from './hub-templates.json' with { type: 'json' };
import { branchName } from '../../booking-request/whatsapp.ts';

// deno-lint-ignore no-explicit-any
type Content = any;
type Locale = 'ar' | 'en';

export const HUB_REPLY_READY = 'hub_reply_ready';
/** the quick reply's payload — any tap is just a guest message (it releases a held answer) */
export const HUB_REPLY_READY_PAYLOAD = 'hub_reply_ready:continue';
export const HUB_TEMPLATE_DEFS = defs;

export interface HubUnitRef {
  kind: 'branch' | 'dining';
  branch: string;
  venue_ar?: string | null;
  venue_en?: string | null;
}

/** WhatsApp refuses a variable with a newline, a tab or more than four spaces in a row */
const clean = (s: string) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();

/** hub_reply_ready's {{1}}: the unit's name in the template's language */
export function unitTemplateName(c: Content, u: HubUnitRef, L: Locale): string {
  if (u.kind === 'dining') {
    const v = L === 'en' ? u.venue_en : u.venue_ar;
    if (v && clean(v)) return clean(v);
  }
  return clean(branchName(c, u.branch, L));
}

export interface TemplatePayload {
  from: string;
  to: string;
  type: 'template';
  externalId?: string;
  template: {
    name: string;
    language: { code: Locale };
    components: (
      | { type: 'body'; parameters: { type: 'text'; text: string }[] }
      | { type: 'button'; sub_type: 'quick_reply'; index: string; parameters: { type: 'payload'; payload: string }[] }
    )[];
  };
}

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** the YCloud body of hub_reply_ready; throws on anything WhatsApp would refuse */
export function hubReplyReadyPayload(c: Content, from: string, to: string, L: Locale, unit: HubUnitRef, externalId?: string): TemplatePayload {
  if (!E164.test(from) || !E164.test(to)) throw new Error('hub_reply_ready: from / to must be E.164');
  const lang: Locale = L === 'en' ? 'en' : 'ar';
  const name = unitTemplateName(c, unit, lang);
  if (!name) throw new Error('hub_reply_ready: the unit has no name');
  return {
    from,
    to,
    type: 'template',
    ...(externalId ? { externalId } : {}),
    template: {
      name: HUB_REPLY_READY,
      language: { code: lang },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: name }] },
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: HUB_REPLY_READY_PAYLOAD }] },
      ],
    },
  };
}

/** YCloud: mark the guest's message read and show «يكتب…» (POST, no body) */
export const typingUrl = (inboundMessageId: string) => `https://api.ycloud.com/v2/whatsapp/inboundMessages/${encodeURIComponent(inboundMessageId)}/typing`;
