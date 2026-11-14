/**
 * Guest Hub — the skills (session H5, 14 Nov 2026; spec §1.5). A skill is code with a fixed contract: the intents it
 * handles, the slots it collects, the sources it may read, its hand-off conditions. A unit turns skills on or off (its
 * `skills`); a skill's code never changes per unit. In H5 room_booking, hall_request and group_request are OFF for every
 * unit (a table constraint and LATER below — H8 turns them on).
 */

export interface Skill {
  key: string;
  intents: string[];
  slots: string[];
  sources: string[];
  handoff: string[];
}

export const SKILLS: Record<string, Skill> = {
  shared_knowledge: {
    key: 'shared_knowledge', intents: ['facility_question', 'policy_question', 'location_question', 'eyab_question', 'payment_question', 'offer_question', 'other'],
    slots: [], sources: ['cards', 'faq', 'fees', 'offers'], handoff: ['no_source'],
  },
  room_booking: {
    key: 'room_booking', intents: ['stay_booking', 'price_question', 'availability_question'],
    slots: ['branch', 'dates', 'room_type', 'adults', 'children', 'extra_beds', 'breakfast', 'child_ages', 'guest_name'], sources: ['adapter', 'offers', 'catalog', 'fees'],
    handoff: ['multi_room', 'prices_hidden', 'book_error'],
  },
  stay_services: {
    key: 'stay_services', intents: ['stay_service_request'], slots: [], sources: ['cards', 'fees'], handoff: ['early_extension'],
  },
  hall_request: { key: 'hall_request', intents: ['hall_request'], slots: ['dates', 'adults', 'layout', 'coffee_break', 'organisation', 'guest_name'], sources: ['cards'], handoff: [] },
  group_request: { key: 'group_request', intents: ['group_request'], slots: ['rooms_count', 'dates', 'adults', 'organisation', 'guest_name'], sources: ['cards'], handoff: [] },
  dining_menu: { key: 'dining_menu', intents: ['dining_menu'], slots: [], sources: ['venue', 'cards'], handoff: [] },
  dining_offers: { key: 'dining_offers', intents: ['offer_question'], slots: [], sources: ['offers'], handoff: [] },
  cart_order_routing: { key: 'cart_order_routing', intents: ['dining_order'], slots: [], sources: [], handoff: ['cart_order'] },
};

/** the skills H8 turns on — refused until then (the database refuses them too: hub_units_skills_h8) */
export const LATER = ['room_booking', 'hall_request', 'group_request'];
/** a unit's skills as the engine may use them in this session */
export const usableSkills = (skills: string[]) => (skills ?? []).filter((s) => s in SKILLS && !LATER.includes(s));

/** the /menu/ cart's WhatsApp message (public/menu/index.html → orderMessage, read 14 Nov 2026): the title line, then
 *  «• item» lines and the total line. Recognised by code, never by a model (spec §1.5 cart_order_routing). */
const CART_TITLES = ['طلب من منيو أرمادا ريزيدنس', 'Order from the ARMADA RESIDENCE menu'];
export function isCartMessage(text: string): boolean {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  if (!CART_TITLES.includes(lines[0] ?? '')) return false;
  const items = lines.filter((l) => l.startsWith('•')).length;
  const total = lines.some((l) => /^(الإجمالي|Total): \d+(\.\d+)? (ر\.س|SAR)$/.test(l));
  return items > 0 && total;
}
